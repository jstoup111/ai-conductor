// Covers: task:32, task:33
//
// FINISH-boundary tests for the stacked `rebase` step.  Each test drives the
// conductor's engine-native `runRebaseStep` (daemon mode) — or, for the
// re-kick, `resumeRebaseFirst` — against a throwaway local Git repository with
// a real durable stack: closed children 1 and 2, and the active leaf child 3 on
// `feat/daemon-demo`.  No remote exists (base resolves to local `main`), and
// the step runner is a fake whose `run` is never reached.
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner, type StepRunResult } from '../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { resumeRebaseFirst, REKICK_SENTINEL } from '../../src/engine/daemon-rekick.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import { readBaseAdvanceHistory, resolveBaseAdvanceForFailure } from '../../src/engine/test-suite-remediation.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const persisters: EventPersister[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  for (const persister of persisters.splice(0)) persister.stop();
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface StackOptions {
  /** Commit a default-branch advance on `main` before child 1 branches. */
  readonly preBranchAdvance?: { readonly path: string; readonly value: string };
}

async function stackedFixture(options: StackOptions = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'stacked-finish-rebase-'));
  repositories.push(repo);
  const git = async (args: string[]) => (await execFile('git', args, { cwd: repo })).stdout.trim();
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return git(['rev-parse', 'HEAD']);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'finish@example.test']);
  await git(['config', 'user.name', 'Stacked finish']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n.ai-conductor/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'src/base.ts', 'export const base = 1;\n');
  await commit('feature plan', '.docs/plans/demo.md', '# demo plan\n');
  const preAdvanceBase = await git(['rev-parse', 'HEAD']);
  if (options.preBranchAdvance) {
    await commit('pre-branch advance', options.preBranchAdvance.path, options.preBranchAdvance.value);
  }
  const base = await git(['rev-parse', 'HEAD']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closedOne = await commit('closed one', 'src/one.ts', 'export const one = 1;\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closedOne]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const closedTwo = await commit('closed two', 'src/two.ts', 'export const two = 2;\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', closedTwo]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  const leaf = await commit('leaf', 'src/leaf.ts', 'export const leaf = 3;\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n');
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);

  const statePath = join(repo, '.pipeline', 'conduct-state.json');
  const state: ConductState = { feature_desc: 'demo' };
  for (const step of ALL_STEPS) {
    if (step.name === 'rebase') break;
    (state as Record<string, unknown>)[step.name] = 'done';
  }
  await writeState(statePath, state);

  /** Advance `main` by one commit while keeping the leaf checked out. */
  const advanceDefault = async (path: string, value: string) => {
    await git(['checkout', '-q', 'main']);
    const advanced = await commit('base advance', path, value);
    await git(['checkout', '-q', 'feat/daemon-demo']);
    return advanced;
  };
  /** Append an operator commit past `closed/c1` on child 1's branch. */
  const appendOperatorCommit = async (path: string, value: string) => {
    await git(['checkout', '-q', 'feat/c1/demo']);
    const operator = await commit('operator change', path, value);
    await git(['checkout', '-q', 'feat/daemon-demo']);
    return operator;
  };
  const refSnapshot = () => git(['for-each-ref', '--format=%(refname) %(objectname)']);

  return { repo, git, statePath, base, preAdvanceBase, closedOne, closedTwo, leaf, advanceDefault, appendOperatorCommit, refSnapshot };
}

type Fixture = Awaited<ReturnType<typeof stackedFixture>>;

interface RecordedEvent { readonly type: string; readonly [key: string]: unknown }

function observe(events: ConductorEventEmitter, types: readonly string[]): RecordedEvent[] {
  const seen: RecordedEvent[] = [];
  for (const type of types) {
    events.on(type as never, ((event: RecordedEvent) => { seen.push(event); }) as never);
  }
  return seen;
}

/** Run the FINISH `rebase` step through a real daemon-mode conductor. */
async function runFinishRebaseStep(subject: Fixture, events: ConductorEventEmitter): Promise<{ result: StepRunResult; runner: StepRunner }> {
  const runner: StepRunner = { run: vi.fn<StepRunner['run']>().mockResolvedValue({ success: true }) };
  const conductor = new Conductor({
    stateFilePath: subject.statePath,
    stepRunner: runner,
    events,
    projectRoot: subject.repo,
    daemon: true,
    mode: 'auto',
  });
  const state = await readState(subject.statePath);
  if (!state.ok) throw new Error(state.error.message);
  const step = conductor as unknown as {
    persistedStateSnapshot: ConductState;
    runRebaseStep(state: ConductState): Promise<StepRunResult>;
  };
  // `run()` loads this baseline before dispatching any step; mirror that load.
  step.persistedStateSnapshot = { ...state.value };
  const result = await step.runRebaseStep(state.value);
  return { result, runner };
}

const OBSERVED = [
  'restack_planned', 'restack_applied', 'restack_refused',
  'rebase_changed', 'rebase_noop', 'rebase_mergeable_skip',
] as const;

describe('FINISH rebase step on a stacked feature (real local Git)', () => {
  // Covers: S10.1, task:rem-prd-audit-R7, task:32
  it('base-refreshes the whole three-child stack onto the advanced default and records the whole-stack tuple', async () => {
    const subject = await stackedFixture();
    const advanced = await subject.advanceDefault('src/upstream.ts', 'export const upstream = 1;\n');
    const events = new ConductorEventEmitter();
    const seen = observe(events, OBSERVED);

    const { result, runner } = await runFinishRebaseStep(subject, events);

    expect(result).toEqual({ success: true });
    expect(runner.run).not.toHaveBeenCalled();
    expect(seen.filter((event) => event.type === 'restack_planned').map((event) => event.cause)).toEqual(['base-refresh']);
    const [childOne, childTwo, newLeaf] = await Promise.all([
      subject.git(['rev-parse', 'feat/c1/demo']),
      subject.git(['rev-parse', 'feat/c2/demo']),
      subject.git(['rev-parse', 'feat/daemon-demo']),
    ]);
    // Child 1 now sits on B', child 2 on the new child 1, the leaf on the new child 2.
    expect(await subject.git(['rev-parse', 'feat/c1/demo^'])).toBe(advanced);
    expect(childOne).not.toBe(subject.closedOne);
    expect(await subject.git(['rev-parse', 'feat/c2/demo^'])).toBe(childOne);
    expect(childTwo).not.toBe(subject.closedTwo);
    expect(await subject.git(['rev-parse', 'feat/daemon-demo^'])).toBe(childTwo);
    expect(newLeaf).not.toBe(subject.leaf);
    expect(await subject.git(['rev-parse', 'HEAD'])).toBe(newLeaf);

    const verdict = await readVerdict(subject.repo, 'rebase');
    expect(verdict?.rebaseOperation).toMatchObject({
      status: 'applied',
      cause: 'base-refresh',
      replay: {
        preRebaseHead: subject.leaf,
        mergeBase: await subject.git(['merge-base', subject.closedOne, subject.base]),
        target: advanced,
        completedHead: newLeaf,
      },
    });
    expect(verdict?.rebaseOperation?.replay.mergeBase).toBe(subject.base);
    const state = await readState(subject.statePath);
    expect(state.ok && state.value.rebase).toBe('done');
  });

  // Covers: S10.4, task:rem-prd-audit-R8-2, task:32
  it('persists rebase_changed with the B..B-prime delta and attributes a failure on that path to the base advance', async () => {
    const subject = await stackedFixture();
    await subject.advanceDefault('src/upstream.ts', 'export const upstream = 1;\n');
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    persisters.push(persister);
    const seen = observe(events, OBSERVED);

    const { result } = await runFinishRebaseStep(subject, events);
    expect(result).toEqual({ success: true });
    expect(seen.some((event) => event.type === 'restack_applied')).toBe(true);
    await (persister as unknown as { drain?: () => Promise<void> }).drain?.();

    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .split('\n').filter(Boolean).map((line) => JSON.parse(line) as RecordedEvent);
    const changed = persisted.filter((event) => event.type === 'rebase_changed');
    expect(changed).toHaveLength(1);
    // The whole-stack delta from B to B' — not the feature's own files.
    expect(changed[0]!.allChangedPaths).toEqual(['src/upstream.ts']);

    const history = await readBaseAdvanceHistory(subject.repo);
    const observedAt = Date.parse(String(changed[0]!.ts)) + 1;
    expect(resolveBaseAdvanceForFailure(history, {
      diagnostic: 'FAIL src/upstream.ts > upstream export changed',
      observedAt,
    })).toEqual({ paths: ['src/upstream.ts'], ts: changed[0]!.ts });
    // A failure in the feature's own code is not the base advance's.
    expect(resolveBaseAdvanceForFailure(history, {
      diagnostic: 'FAIL src/leaf.ts > leaf export',
      observedAt,
    })).toBeUndefined();
  });

  // Covers: S10.5, task:rem-prd-audit-R9-2, task:32
  it('takes the mergeable-skip without restacking when the base advance touches neither code nor review inputs', async () => {
    const subject = await stackedFixture();
    const advanced = await subject.advanceDefault('docs/guide.md', '# guide\n');
    const before = await subject.refSnapshot();
    const events = new ConductorEventEmitter();
    const seen = observe(events, OBSERVED);

    const { result } = await runFinishRebaseStep(subject, events);

    expect(result).toEqual({ success: true });
    expect(seen.map((event) => event.type)).toEqual(['rebase_mergeable_skip']);
    expect(seen[0]).toMatchObject({ baseRef: 'main', baseSha: advanced });
    expect(await subject.refSnapshot()).toBe(before);
    const state = await readState(subject.statePath);
    expect(state.ok && state.value.rebase).toBe('done');
  });

  // Covers: S10.5, task:rem-prd-audit-R9-2, task:32
  it('runs a base-refresh restack despite a mergeable leaf when the base advance changes an active review input', async () => {
    const subject = await stackedFixture();
    const advanced = await subject.advanceDefault('.docs/plans/demo.md', '# demo plan, amended upstream\n');
    // The leaf merges cleanly onto B' — mergeability alone would allow the skip.
    expect((await execFile('git', ['merge-tree', '--write-tree', '--quiet', 'main', 'HEAD'], { cwd: subject.repo }).then(() => 0, () => 1))).toBe(0);
    const events = new ConductorEventEmitter();
    const seen = observe(events, OBSERVED);

    const { result } = await runFinishRebaseStep(subject, events);

    expect(result).toEqual({ success: true });
    expect(seen.some((event) => event.type === 'rebase_mergeable_skip')).toBe(false);
    expect(seen.filter((event) => event.type === 'restack_planned').map((event) => event.cause)).toEqual(['base-refresh']);
    expect(await subject.git(['rev-parse', 'feat/c1/demo^'])).toBe(advanced);
    expect(await subject.git(['merge-base', '--is-ancestor', advanced, 'feat/daemon-demo']).then(() => true, () => false)).toBe(true);
    expect((await readVerdict(subject.repo, 'rebase'))?.rebaseOperation?.cause).toBe('base-refresh');
  });

  // Covers: S10.5, task:rem-prd-audit-R9-2, task:32
  it('runs the stack preflight feature-repair before the mergeable-skip classification and earns no refund credit', async () => {
    const subject = await stackedFixture();
    // X edits child 1's own code, so the repair's whole-stack replay reopens build_review.
    const operator = await subject.appendOperatorCommit('src/one.ts', 'export const one = "X";\n');
    await subject.advanceDefault('docs/guide.md', '# guide\n');
    const ledger = { version: 1, gates: { build_review: { count: 2, cumulative: 2, laps: 2 } } };
    const leafStore = join(subject.repo, '.pipeline', 'children', '3');
    await mkdir(leafStore, { recursive: true });
    await writeState(join(leafStore, 'conduct-state.json'), { build: 'done', build_review: 'done', test_suite: 'done' } as ConductState);
    for (const store of [join(subject.repo, '.pipeline'), leafStore]) {
      await writeFile(join(store, 'kickback-ledger.json'), JSON.stringify(ledger));
    }
    const events = new ConductorEventEmitter();
    const seen = observe(events, [...OBSERVED, 'rebase_gate_invalidated']);

    const { result } = await runFinishRebaseStep(subject, events);

    expect(result).toEqual({ success: true });
    const order = [...new Set(seen.map((event) => event.type).filter((type) => type !== 'rebase_gate_invalidated'))];
    expect(order).toEqual(['restack_planned', 'restack_applied', 'rebase_mergeable_skip']);
    expect(seen.find((event) => event.type === 'restack_planned')?.cause).toBe('feature-repair');
    // The repair applied: closure adopted X, and X is carried into every child above.
    expect(await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).toBe(operator);
    for (const branch of ['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']) {
      expect(await subject.git(['show', `${branch}:src/one.ts`])).toBe('export const one = "X";');
    }
    // The preflight repair inside FINISH carries no convergence refund credit.
    expect(seen.some((event) => event.type === 'rebase_gate_invalidated' && 'convergenceCredit' in event && event.convergenceCredit !== undefined)).toBe(false);
    for (const store of [join(subject.repo, '.pipeline'), leafStore]) {
      const after = JSON.parse(await readFile(join(store, 'kickback-ledger.json'), 'utf8')) as Record<string, unknown>;
      expect(after.convergenceCreditReceipts).toBeUndefined();
      expect(after).toMatchObject({ gates: ledger.gates });
    }
  });

  // Covers: S10.1, task:32
  it('applies feature-repair then base-refresh so operator commit X survives in every child through FINISH', async () => {
    const subject = await stackedFixture();
    const operator = await subject.appendOperatorCommit('src/operator.ts', 'export const operator = "X";\n');
    const advanced = await subject.advanceDefault('src/upstream.ts', 'export const upstream = 1;\n');
    const events = new ConductorEventEmitter();
    const seen = observe(events, OBSERVED);

    const { result } = await runFinishRebaseStep(subject, events);

    expect(result).toEqual({ success: true });
    expect(seen.filter((event) => event.type === 'restack_planned').map((event) => event.cause))
      .toEqual(['feature-repair', 'base-refresh']);
    expect([...new Set(seen.filter((event) => event.type === 'restack_applied').map((event) => event.opId))]).toHaveLength(2);
    expect(await subject.git(['merge-base', '--is-ancestor', advanced, 'feat/c1/demo']).then(() => true, () => false)).toBe(true);
    for (const branch of ['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']) {
      expect(await subject.git(['show', `${branch}:src/operator.ts`])).toBe('export const operator = "X";');
      expect(await subject.git(['show', `${branch}:src/upstream.ts`])).toBe('export const upstream = 1;');
    }
    // The base refresh replayed X: child 1's tip is a new commit carrying X's change.
    expect(await subject.git(['rev-parse', 'feat/c1/demo'])).not.toBe(operator);
    expect((await readVerdict(subject.repo, 'rebase'))?.rebaseOperation?.cause).toBe('base-refresh');
  });
});

describe('stacked no-op when B-prime is already contained (real local Git)', () => {
  // Covers: S10.3, task:rem-prd-audit-R10, task:33
  it('moves no ref from the FINISH rebase step when B-prime is already an ancestor of feat/c1/demo', async () => {
    const subject = await stackedFixture({ preBranchAdvance: { path: 'src/upstream.ts', value: 'export const upstream = 1;\n' } });
    const advanced = await subject.git(['rev-parse', 'main']);
    expect(advanced).not.toBe(subject.preAdvanceBase);
    await subject.git(['merge-base', '--is-ancestor', advanced, 'feat/c1/demo']);
    const before = await subject.refSnapshot();
    const events = new ConductorEventEmitter();
    const seen = observe(events, OBSERVED);

    const { result } = await runFinishRebaseStep(subject, events);

    expect(result).toEqual({ success: true });
    expect(await subject.refSnapshot()).toBe(before);
    expect(seen.some((event) => event.type === 'restack_planned')).toBe(false);
    expect(seen.filter((event) => event.type === 'rebase_changed')).toEqual([
      expect.objectContaining({ allChangedPaths: [], baseSha: advanced }),
    ]);
    const state = await readState(subject.statePath);
    expect(state.ok && state.value.rebase).toBe('done');
  });

  // Covers: S10.3, task:rem-prd-audit-R10, task:33
  it('moves no ref from the daemon re-kick when B-prime is already an ancestor of feat/c1/demo', async () => {
    const subject = await stackedFixture({ preBranchAdvance: { path: 'src/upstream.ts', value: 'export const upstream = 1;\n' } });
    const advanced = await subject.git(['rev-parse', 'main']);
    await subject.git(['merge-base', '--is-ancestor', advanced, 'feat/c1/demo']);
    await writeFile(join(subject.repo, REKICK_SENTINEL), '');
    const before = await subject.refSnapshot();
    const events = new ConductorEventEmitter();
    const seen = observe(events, OBSERVED);
    const performRebase = vi.fn();

    const outcome = await resumeRebaseFirst({
      worktreePath: subject.repo,
      localBase: 'main',
      events,
      ranManualTest: false,
      slug: 'demo',
      performRebase: performRebase as never,
    });

    expect(outcome).toBe('rebased');
    expect(performRebase).not.toHaveBeenCalled();
    expect(await subject.refSnapshot()).toBe(before);
    expect(seen.some((event) => event.type === 'restack_planned')).toBe(false);
    expect(seen.filter((event) => event.type === 'rebase_changed')).toEqual([
      expect.objectContaining({ allChangedPaths: [], baseSha: advanced }),
    ]);
  });
});
