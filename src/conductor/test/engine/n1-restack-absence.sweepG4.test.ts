// N=1 (no durable child state) stays on today's flat rebase path at FINISH,
// re-kick and resume, and a refused N=1 force push adds only the lease event.
//
// The engine Git runner (`makeGitRunner`) is wrapped, not replaced, so every
// argv and stdin the engine sends to Git during the N=1 run is observable at
// the process boundary.  `runRestack` and `runStackPreflight` are spies over
// their real implementations.
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitRunner } from '../../src/engine/rebase.js';

const boundary = vi.hoisted(() => ({ calls: [] as Array<{ args: string[]; input?: string }> }));

vi.mock('../../src/engine/rebase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/rebase.js')>();
  return {
    ...actual,
    makeGitRunner: (cwd: string): GitRunner => {
      const real = actual.makeGitRunner(cwd);
      return async (args, opts) => {
        boundary.calls.push({ args: [...args], input: opts?.input });
        return real(args, opts);
      };
    },
  };
});

vi.mock('../../src/engine/restack/restack-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/restack-executor.js')>();
  return { ...actual, runRestack: vi.fn(actual.runRestack) };
});

vi.mock('../../src/engine/restack/stack-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/restack/stack-preflight.js')>();
  return { ...actual, runStackPreflight: vi.fn(actual.runStackPreflight) };
});

import { Conductor } from '../test-conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { loadConfig } from '../../src/engine/config.js';
import { REKICK_SENTINEL, resumeRebaseFirst } from '../../src/engine/daemon-rekick.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { readVerdict } from '../../src/engine/gate-verdicts.js';
import type { GitRunner as ProductionGitRunner } from '../../src/engine/pr-labels.js';
import { emitRebaseEvent, performRebase, type RebaseOutcome } from '../../src/engine/rebase.js';
import { runRestack } from '../../src/engine/restack/restack-executor.js';
import { runStackPreflight } from '../../src/engine/restack/stack-preflight.js';
import { openShipDraftPr } from '../../src/engine/ship-draft-pr.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { CELLS, type Cell } from './n1-golden-shared.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const SLUG = 'n1-golden';
const LEAF = `feat/daemon-${SLUG}`;

beforeEach(() => {
  boundary.calls.length = 0;
  vi.mocked(runRestack).mockClear();
  vi.mocked(runStackPreflight).mockClear();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function commitFile(root: string, path: string, contents: string, message: string): Promise<string> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), contents);
  await git(root, 'add', path);
  await git(root, 'commit', '-qm', message);
  return git(root, 'rev-parse', 'HEAD');
}

async function persistedEvents(path: string): Promise<Array<{ type: string; [key: string]: unknown }>> {
  const raw = await readFile(path, 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string });
}

const REBASE_RESULT_EVENTS = ['rebase_changed', 'rebase_noop', 'rebase_mergeable_skip', 'rebase_conflict_halt'] as const;

/** The events today's emitter writes for one rebase outcome. */
async function todaysRebaseEvents(outcome: RebaseOutcome): Promise<Array<Record<string, unknown>>> {
  const emitter = new ConductorEventEmitter();
  const seen: Array<Record<string, unknown>> = [];
  for (const type of REBASE_RESULT_EVENTS) {
    emitter.on(type as never, ((event: Record<string, unknown>) => { seen.push(event); }) as never);
  }
  await emitRebaseEvent(emitter, outcome);
  return seen;
}

/** A conductor/feature refs created by the N=1 run other than the push lease records. */
function nonLeaseConductorRef(ref: string): boolean {
  return ref.startsWith(`refs/conductor/${SLUG}/`)
    && !ref.startsWith(`refs/conductor/${SLUG}/pushed/`)
    && !ref.startsWith(`refs/conductor/${SLUG}/push-intent/`);
}

async function n1FeatureRepo(cell: Cell) {
  const root = await tempRoot(`n1-restack-absence-sweepG4-${cell.name}-`);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), cell.configYaml);
  await writeFile(join(root, '.docs', 'plans', `${SLUG}.md`), cell.planMd);
  await writeFile(join(root, 'README.md'), 'base\n');
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'n1@example.test');
  await git(root, 'config', 'user.name', 'N1 Test');
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'base');
  await git(root, 'checkout', '-qb', LEAF);
  await commitFile(root, 'src/feature.ts', 'export const feature = 1;\n', 'feature work');
  const advanceDefault = async (path: string, value: string) => {
    await git(root, 'checkout', '-q', 'main');
    const advanced = await commitFile(root, path, value, `advance ${path}`);
    await git(root, 'checkout', '-q', LEAF);
    return advanced;
  };
  const statePath = join(root, '.pipeline', 'conduct-state.json');
  const state: ConductState = { feature_desc: SLUG };
  for (const step of ALL_STEPS) {
    if (step.name === 'rebase') break;
    (state as Record<string, unknown>)[step.name] = 'done';
  }
  // The completed-BUILD evidence gate after a changed rebase is orthogonal to
  // the stack/flat routing under test; keep BUILD open so it is not consulted.
  (state as Record<string, unknown>).build = 'pending';
  await writeState(statePath, state);
  return { root, statePath, advanceDefault };
}

describe('N=1 restack absence across FINISH, re-kick and resume (sweep G4)', () => {
  // Covers: task:39
  it.each(CELLS)('keeps $name on the flat performRebase path at FINISH, re-kick and resume with no restack event or non-lease conductor ref', async (cell) => {
    const subject = await n1FeatureRepo(cell);
    const events = new ConductorEventEmitter();
    const eventsPath = join(subject.root, '.pipeline', 'events.jsonl');
    const persister = new EventPersister(eventsPath, events);
    persister.start();
    const loaded = await loadConfig(subject.root);
    const outcomes: RebaseOutcome[] = [];
    const performRebaseSpy = vi.fn<typeof performRebase>(async (...args) => {
      const outcome = await performRebase(...args);
      outcomes.push(outcome);
      return outcome;
    });

    // FINISH: the engine-native rebase step through a daemon-mode conductor.
    const advanced = await subject.advanceDefault('src/upstream.ts', 'export const upstream = 1;\n');
    const finishRunner: StepRunner = { run: vi.fn<StepRunner['run']>().mockResolvedValue({ success: true }) };
    const finish = new Conductor({
      stateFilePath: subject.statePath, stepRunner: finishRunner, events, projectRoot: subject.root,
      daemon: true, mode: 'auto', featureSlug: SLUG, baseBranch: 'main', performRebase: performRebaseSpy,
      config: loaded.ok ? loaded.config : undefined,
    });
    const before = await readState(subject.statePath);
    if (!before.ok) throw new Error(before.error.message);
    const step = finish as unknown as {
      persistedStateSnapshot: ConductState;
      runRebaseStep(state: ConductState): Promise<StepRunResult>;
    };
    step.persistedStateSnapshot = { ...before.value };
    await expect(step.runRebaseStep(before.value)).resolves.toEqual({ success: true });

    expect(performRebaseSpy).toHaveBeenCalledTimes(1);
    expect(outcomes[0]).toMatchObject({ kind: 'changed', baseSha: advanced });
    expect(runStackPreflight).not.toHaveBeenCalled();
    expect(runRestack).not.toHaveBeenCalled();
    // Today's rebase step verdict: the flat operation, with no restack cause.
    const verdict = await readVerdict(subject.root, 'rebase');
    expect(verdict).toBeDefined();
    expect(verdict?.rebaseOperation ?? {}).not.toHaveProperty('cause');
    const afterFinish = await readState(subject.statePath);
    expect(afterFinish.ok && afterFinish.value.rebase).toBe('done');
    // Today's rebase events: exactly what emitRebaseEvent writes for the outcome.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const finishRebaseEvents = (await persistedEvents(eventsPath))
      .filter((event) => (REBASE_RESULT_EVENTS as readonly string[]).includes(event.type))
      .map(({ ts: _ts, ...event }) => event);
    expect(finishRebaseEvents).toEqual(await todaysRebaseEvents(outcomes[0]!));

    // Re-kick: today's one-shot sentinel and single-branch rebase.
    await subject.advanceDefault('src/second.ts', 'export const second = 2;\n');
    await writeFile(join(subject.root, REKICK_SENTINEL), 'rekick\n');
    await expect(resumeRebaseFirst({
      worktreePath: subject.root, localBase: 'main', slug: SLUG, events, ranManualTest: false,
      performRebase: performRebaseSpy, preVerify: async () => ({ done: true }),
    })).resolves.toBe('rebased');
    expect(performRebaseSpy).toHaveBeenCalledTimes(2);
    expect(outcomes[1]).toMatchObject({ kind: 'changed' });
    expect(runRestack).not.toHaveBeenCalled();

    // Resume: the preflight runs only its guarded journal probe.
    const resumeRunner: StepRunner = {
      run: async (name) => { throw new Error(`resume stops at ${name}`); },
    };
    const resume = new Conductor({
      stateFilePath: subject.statePath, stepRunner: resumeRunner, events, projectRoot: subject.root,
      daemon: true, mode: 'auto', resume: true, featureSlug: SLUG, baseBranch: 'main',
      verifyArtifacts: false, performRebase: performRebaseSpy,
      config: loaded.ok ? loaded.config : undefined,
    });
    await resume.run().catch(() => undefined);
    expect(runStackPreflight).toHaveBeenCalledTimes(1);
    await expect(vi.mocked(runStackPreflight).mock.results[0]!.value).resolves.toEqual({ kind: 'no-stack' });
    expect(runRestack).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    persister.stop();

    // No restack event and no non-lease feature conductor ref, observed both
    // in the repository and at the engine's Git process boundary.
    expect(await readFile(eventsPath, 'utf8')).not.toContain('"type":"restack_');
    const refs = (await git(subject.root, 'for-each-ref', '--format=%(refname)', `refs/conductor/${SLUG}/`))
      .split('\n').filter(Boolean);
    expect(refs.filter(nonLeaseConductorRef)).toEqual([]);
    const updateRefWrites = boundary.calls.filter(({ args }) => args[0] === 'update-ref');
    expect(updateRefWrites.filter(({ args }) => args.some(nonLeaseConductorRef))).toEqual([]);
    expect(updateRefWrites.filter(({ input }) => (input ?? '').split('\n')
      .some((line) => line.split(/\s+/).some(nonLeaseConductorRef)))).toEqual([]);
    // The boundary really observed the N=1 run's Git traffic.
    expect(boundary.calls.some(({ args }) => args[0] === 'rebase' || args.includes('rebase'))).toBe(true);
  });
});

const ONE_STORY = `# Stories: n1-golden

## Story 1: Golden coverage

### Acceptance Criteria

- Given a golden cell, when it runs, then it remains stable.
`;

const TWO_STORIES = `${ONE_STORY}

## Story 2: Golden coverage follow-up

### Acceptance Criteria

- Given a golden cell, when it runs, then it remains stable.
`;

/** The #3019 golden cell run up to its park boundary, as n1-golden-state runs it. */
async function runGoldenCell(cell: Cell, root: string, events: ConductorEventEmitter) {
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), cell.configYaml);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', `${SLUG}.md`), cell.planMd);
  const writeTopologyInputs = async () => {
    if (!cell.fixtureSeed) return;
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await mkdir(join(root, '.docs', 'complexity'), { recursive: true });
    await mkdir(join(root, 'skills', 'tdd'), { recursive: true });
    await writeFile(join(root, '.docs', 'stories', `${SLUG}.md`), cell.storiesFixture === 'two' ? TWO_STORIES : ONE_STORY);
    await writeFile(join(root, '.docs', 'complexity', `${SLUG}.md`), cell.complexityMd ?? '');
    await writeFile(join(root, 'skills', 'tdd', 'SKILL.md'), '# tdd\n');
  };
  if (cell.fixtureSeed === 'initial-commit') await writeTopologyInputs();
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'Test User');
  await writeFile(join(root, 'README.md'), '# n1-golden\n');
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await git(root, 'add',
    'README.md',
    '.gitignore',
    '.ai-conductor/config.yml',
    `.docs/plans/${SLUG}.md`,
    ...(cell.fixtureSeed === 'initial-commit'
      ? [`.docs/stories/${SLUG}.md`, `.docs/complexity/${SLUG}.md`, 'skills/tdd/SKILL.md']
      : []),
  );
  await git(root, 'commit', '-qm', 'init');
  if (cell.fixtureSeed === 'workspace') await writeTopologyInputs();
  const pipeline = join(root, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  const statePath = join(pipeline, 'conduct-state.json');
  await writeState(statePath, {
    worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
    conflict_check: 'done', plan: 'done', coherence_check: 'done', coverage_binding: 'done',
    architecture_diagram: 'done', architecture_review: 'done', prd: 'done', prd_audit: 'done',
    acceptance_specs: 'pending', build: 'pending', test_suite: 'pending', build_review: 'pending',
    manual_test: 'pending', architecture_review_as_built: 'pending', finish: 'pending',
    complexity_tier: 'S', track: 'technical', feature_desc: SLUG,
  } as never);
  const completed = new Set<string>();
  const runner: StepRunner = {
    run: async (name) => {
      if (['acceptance_specs', 'build', 'test_suite', 'build_review'].includes(name)) {
        completed.add(name);
        return { success: true };
      }
      throw new Error(`sentinel failure at ${name}`);
    },
  };
  const loaded = await loadConfig(root);
  const conductor = new Conductor({
    stateFilePath: statePath, stepRunner: runner, events, projectRoot: root,
    fromStep: 'acceptance_specs', mode: 'auto', daemon: true, verifyArtifacts: false,
    featureSlug: SLUG, baseBranch: 'main',
    operatorParkBoundary: async () => completed.has('build_review'),
    config: loaded.ok ? loaded.config : undefined,
  });
  await conductor.run().catch(() => undefined);
}

function fixtureEventTypes(cellName: string): Promise<Set<string>> {
  return readFile(join(import.meta.dirname, '..', 'fixtures', 'n1-golden', `${cellName}-events.golden`), 'utf8')
    .then((raw) => new Set(raw.split('\n').filter((line) => line.startsWith('{'))
      .map((line) => (JSON.parse(line) as { type: string }).type)));
}

describe('N=1 refused force push adds only the lease event (sweep G4)', () => {
  // Covers: task:39
  it.each(CELLS)('adds push_lease_refused as the only new event type relative to the $name golden events when its draft-refresh force push is refused', async (cell) => {
    const root = await tempRoot(`n1-lease-refused-sweepG4-${cell.name}-`);
    const events = new ConductorEventEmitter();
    const eventsPath = join(root, '.pipeline', 'events.jsonl');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const persister = new EventPersister(eventsPath, events);
    persister.start();
    await runGoldenCell(cell, root, events);

    // Publish the N=1 leaf, let a human advance it, then rewrite locally.
    const remoteRoot = await tempRoot('n1-lease-refused-sweepG4-origin-');
    const remote = join(remoteRoot, 'origin.git');
    await git(remoteRoot, 'init', '-q', '--bare', '--initial-branch=main', remote);
    await git(root, 'remote', 'add', 'origin', remote);
    await git(root, 'checkout', '-qb', LEAF);
    await commitFile(root, 'src/feature.ts', 'export const feature = 1;\n', 'feature work');
    await git(root, 'push', '-q', 'origin', 'main', `HEAD:refs/heads/${LEAF}`);
    await git(root, 'fetch', '-q', 'origin', `+refs/heads/${LEAF}:refs/remotes/origin/${LEAF}`);
    const human = join(remoteRoot, 'human');
    await git(remoteRoot, 'clone', '-q', '-b', LEAF, remote, human);
    await git(human, 'config', 'user.email', 'human@example.test');
    await git(human, 'config', 'user.name', 'Human');
    const humanTip = await commitFile(human, 'src/human.ts', 'export const human = 1;\n', 'human work');
    await git(human, 'push', '-q', 'origin', `HEAD:refs/heads/${LEAF}`);
    await git(root, 'commit', '-q', '--amend', '-m', 'feature work, rebased');

    const productionShapedGit: ProductionGitRunner = async (args, opts) => {
      const result = await execFile('git', args, { cwd: opts.cwd });
      return { stdout: String(result.stdout) };
    };
    const published = await openShipDraftPr({
      cwd: root, branch: LEAF, baseBranch: 'main', featureDesc: SLUG, pushMode: 'lease',
      git: productionShapedGit,
      gh: async () => { throw new Error('no PR work after a refused push'); },
      events: events as never,
    });
    expect(published.outcome).not.toBe('published');
    expect(await git(remote, 'rev-parse', `refs/heads/${LEAF}`)).toBe(humanTip);
    await new Promise((resolve) => setTimeout(resolve, 20));
    persister.stop();

    const actualTypes = new Set((await persistedEvents(eventsPath)).map(({ type }) => type));
    const todaysTypes = await fixtureEventTypes(cell.name);
    expect([...actualTypes].filter((type) => !todaysTypes.has(type))).toEqual(['push_lease_refused']);
    expect([...todaysTypes].filter((type) => !actualTypes.has(type))).toEqual([]);
  });
});
