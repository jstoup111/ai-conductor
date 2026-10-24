// Covers: task:30
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../../src/engine/coverage-binding-envelope.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, readRestackJournal, writeRestackJournalBlob } from '../../../src/engine/restack/restack-journal.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, value: string) => {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'preflight@example.test']);
  await git(['config', 'user.name', 'Stack preflight']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closedOne = await commit('closed one', 'one.txt', 'one\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closedOne]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const closedTwo = await commit('closed two', 'two.txt', 'two\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c2', closedTwo]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n  route_whole_feature_fixes: false\n');
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  return { repo, git, commit, closedOne };
}

describe('runStackPreflight (real local Git)', () => {
  it('repairs an appended closed child, moves its closure, and replays every descendant', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('operator change', 'operator.txt', 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'repaired' });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim())
      .toBe((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim());
    expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toThrow();
  });

  it('does not replay a closed branch extended only by a halt record', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('halt record', '.docs/halted/demo.md', 'Status: halted\n');
    const before = (await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim();
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'clear' });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(before);
  });

  it('halts closed-child rewrites without moving their closure', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.git(['reset', '--hard', 'HEAD^']);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => { refusals.push(event); });

    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'halted' });
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(subject.closedOne);
    expect(refusals).toEqual([expect.objectContaining({ reason: 'closed-child-rewritten', child: 1 })]);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('chains a base refresh behind the repair and consumes its re-kick before the durable hand-off', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'main']);
    await subject.commit('base advance', 'base.txt', 'advanced\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('operator change', 'operator.txt', 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const events = new ConductorEventEmitter();
    const planned: { cause?: string; opId?: string }[] = [];
    events.on('restack_planned', (event) => { planned.push(event as { cause?: string; opId?: string }); });
    const phases: string[] = [];

    await expect(runStackPreflight({
      worktree: subject.repo, slug: 'demo', baseRefreshDue: true,
      consumeRekick: async () => { phases.push('consume'); }, events, git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'repaired' });
    expect(phases).toEqual(['consume']);
    expect(planned.map(({ cause }) => cause)).toEqual(['feature-repair', 'base-refresh']);
    expect(planned[0]!.opId).not.toBe(planned[1]!.opId);
  });

  // Covers: task:rem-vg5-s10-2
  it('emits deferred-base-refresh once when a routed round opens after the repair applies', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'main']);
    await subject.commit('base advance', 'base.txt', 'advanced\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('operator change', 'operator.txt', 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const rearmed: string[] = [];

    const { result, records } = await withPersistedEvents(subject.repo, (events) => runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      baseRefreshDue: true,
      rearmRekick: async () => { rearmed.push('rearm'); },
      // The routing record can be admitted after the early preflight probe
      // but before the repair hands off its base-refresh journal.
      routedRoundOpen: async () => true,
      events,
      git: makeGitRunner(subject.repo),
    }));

    expect(result).toEqual({ kind: 'repaired' });
    expect(rearmed).toEqual(['rearm']);
    expect(records.filter((record) => record.type === 'restack_refused' && record.reason === 'deferred-base-refresh'))
      .toHaveLength(1);
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  });

  async function withPersistedEvents<T>(repo: string, run: (events: ConductorEventEmitter) => Promise<T>) {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    let result: T;
    try {
      result = await run(events);
    } finally {
      persister.stop();
    }
    const records = (await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as { type: string; reason?: string; cause?: string; opId?: string });
    return { result, records };
  }

  async function advanceDefaultAndAppendOperatorCommit(subject: Awaited<ReturnType<typeof fixture>>, operatorPath: string) {
    await subject.git(['checkout', '-q', 'main']);
    const advanced = await subject.commit('base advance', 'main.txt', 'advanced\n');
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('operator change', operatorPath, 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    return advanced;
  }

  // Covers: S9.9, task:rem-prd-audit-R4
  it('persists deferred-base-refresh and runs no base refresh when a due repair is refused for a dirty overlap', async () => {
    const subject = await fixture();
    const advanced = await advanceDefaultAndAppendOperatorCommit(subject, 'base.txt');
    // The checked-out leaf must move to carry base.txt; an uncommitted edit to it refuses the repair.
    await writeFile(join(subject.repo, 'base.txt'), 'operator wip\n');
    const closedBefore = (await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim();
    const consumed: string[] = [];

    const { result, records } = await withPersistedEvents(subject.repo, (events) => runStackPreflight({
      worktree: subject.repo, slug: 'demo', baseRefreshDue: true,
      consumeRekick: async () => { consumed.push('consume'); }, events, git: makeGitRunner(subject.repo),
    }));

    expect(result).toEqual({ kind: 'halted' });
    expect(records.filter((record) => record.type === 'restack_refused').map((record) => record.reason))
      .toEqual(['dirty-overlap', 'deferred-base-refresh']);
    expect(records.filter((record) => record.type === 'restack_planned').map((record) => record.cause))
      .not.toContain('base-refresh');
    expect(consumed).toEqual([]);
    await expect(subject.git(['merge-base', '--is-ancestor', advanced, 'feat/c1/demo'])).rejects.toBeDefined();
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(closedBefore);
  });

  // Covers: S9.10, task:rem-prd-audit-R5
  it('persists deferred-base-refresh when the repair applies but the follow-on base refresh is refused checked-out-elsewhere', async () => {
    const subject = await fixture();
    const advanced = await advanceDefaultAndAppendOperatorCommit(subject, 'operator.txt');
    const elsewhere = await mkdtemp(join(tmpdir(), 'stack-preflight-elsewhere-'));
    repositories.push(elsewhere);
    await subject.git(['worktree', 'add', '-q', elsewhere, 'feat/c1/demo']);
    const operatorTip = (await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim();

    const { result, records } = await withPersistedEvents(subject.repo, (events) => runStackPreflight({
      worktree: subject.repo, slug: 'demo', baseRefreshDue: true, events, git: makeGitRunner(subject.repo),
    }));

    expect(result).toEqual({ kind: 'halted' });
    // The repair applied: child 1's closure moved to the operator commit and the leaf carries it.
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(operatorTip);
    expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
    expect(records.filter((record) => record.type === 'restack_applied').map((record) => record.cause))
      .toContain('feature-repair');
    expect(records.filter((record) => record.type === 'restack_applied').map((record) => record.cause))
      .not.toContain('base-refresh');
    expect(records.filter((record) => record.type === 'restack_refused').map((record) => record.reason))
      .toEqual(['checked-out-elsewhere', 'deferred-base-refresh']);
    expect((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim()).toBe(operatorTip);
    await expect(subject.git(['merge-base', '--is-ancestor', advanced, 'feat/c1/demo'])).rejects.toBeDefined();
  });

  // Covers: S9.12, task:rem-prd-audit-R6
  it('runs the durable base-refresh follow-on with a distinct opId when the process died after the repair journal reached applied', async () => {
    const subject = await fixture();
    const advanced = await advanceDefaultAndAppendOperatorCommit(subject, 'operator.txt');
    const childOne = parseChildId(1);
    if (!childOne) throw new Error('child id should parse');
    // The repair half of a due resume, exactly as the preflight starts it.
    const repair = await runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [childOne],
      followOnCause: 'base-refresh', git: makeGitRunner(subject.repo),
    });
    expect(repair.kind).toBe('applied');
    const applied = await readRestackJournal(subject.repo, 'demo');
    if (applied.kind !== 'journal') throw new Error('repair journal should remain');
    expect(applied.journal).toMatchObject({ state: 'applied', cause: 'feature-repair', followOnCause: 'base-refresh' });
    // Simulate the process dying before the follow-on started: the journal's owner is no longer alive.
    const deadBlob = await writeRestackJournalBlob(subject.repo, {
      ...applied.journal, owner: { host: 'dead-preflight-host', pid: 1, processStartTime: '0' },
    });
    await subject.git(['update-ref', journalRefFor('demo'), deadBlob, applied.blob]);
    const repairOpId = applied.journal.opId;

    const nativeGit = makeGitRunner(subject.repo);
    const transactions: string[] = [];
    const git: GitRunner = async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input !== undefined) transactions.push(options.input);
      return nativeGit(args, options);
    };
    const { result, records } = await withPersistedEvents(subject.repo, (events) => runStackPreflight({
      worktree: subject.repo, slug: 'demo', events, git,
    }));

    // Recovery completed the follow-on, so the cursor then judges a coherent stack.
    expect(result).toEqual({ kind: 'clear' });
    const planned = records.filter((record) => record.type === 'restack_planned');
    expect(planned.map((record) => record.cause)).toEqual(['base-refresh']);
    expect(planned[0]!.opId).not.toBe(repairOpId);
    // The follow-on journal replaced the dead repair's applied journal by CAS on its blob.
    expect(transactions.some((input) => new RegExp(`^update ${journalRefFor('demo')} [0-9a-f]{40} ${deadBlob}$`, 'm').test(input)))
      .toBe(true);
    expect((await subject.git(['merge-base', '--is-ancestor', advanced, 'feat/c1/demo'])).stdout).toBe('');
    expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  });

  // Covers: S10.3, task:33
  it('repairs without chaining a base refresh when a due re-kick finds the default already inside child 1', async () => {
    const subject = await fixture();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.commit('operator change', 'operator.txt', 'X\n');
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const operatorCommit = (await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim();
    const consumed: string[] = [];

    const { result, records } = await withPersistedEvents(subject.repo, (events) => runStackPreflight({
      worktree: subject.repo, slug: 'demo', baseRefreshDue: true,
      consumeRekick: async () => { consumed.push('consume'); }, events, git: makeGitRunner(subject.repo),
    }));

    expect(result).toEqual({ kind: 'repaired' });
    expect(records.filter((record) => record.type === 'restack_planned').map((record) => record.cause))
      .toEqual(['feature-repair']);
    expect(consumed).toEqual(['consume']);
    // The repair adopts X into child 1 as-is; no base refresh rewrites it.
    expect((await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).stdout.trim()).toBe(operatorCommit);
    expect((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim()).toBe(operatorCommit);
  });

  // Covers: S10.3, task:33
  it('finds the default inside the first sealed position when the stack starts at child 2, chaining no base refresh', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-gap-'));
    repositories.push(repo);
    const git = (args: string[]) => execFile('git', args, { cwd: repo });
    const commit = async (message: string, path: string, value: string) => {
      await writeFile(join(repo, path), value);
      await git(['add', path]);
      await git(['commit', '-qm', message]);
      return (await git(['rev-parse', 'HEAD'])).stdout.trim();
    };
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'preflight@example.test']);
    await git(['config', 'user.name', 'Stack preflight']);
    await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
    await git(['add', '.gitignore']);
    await git(['commit', '-qm', 'ignore pipeline']);
    await commit('base', 'base.txt', 'base\n');
    await git(['checkout', '-qb', 'feat/c2/demo']);
    await git(['update-ref', 'refs/conductor/demo/closed/c2', await commit('closed two', 'two.txt', 'two\n')]);
    await git(['checkout', '-qb', 'feat/c4/demo']);
    await git(['update-ref', 'refs/conductor/demo/closed/c4', await commit('closed four', 'four.txt', 'four\n')]);
    await git(['checkout', '-qb', 'feat/daemon-demo']);
    await commit('leaf', 'leaf.txt', 'leaf\n');
    await mkdir(join(repo, '.ai-conductor'), { recursive: true });
    await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n');
    await writeCoverageBindingEnvelope(repo, {
      version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
      sliceMembership: { taskSlices: { a: 2, b: 4, c: 7 }, titles: ['two', 'four', 'leaf'] },
      storyOwnership: { S1: 2, S2: 4, S3: 7 },
    }, envelopeFilesystem);
    await git(['checkout', '-q', 'feat/c2/demo']);
    await commit('operator change', 'operator.txt', 'X\n');
    await git(['checkout', '-q', 'feat/daemon-demo']);
    const consumed: string[] = [];

    const { result, records } = await withPersistedEvents(repo, (events) => runStackPreflight({
      worktree: repo, slug: 'demo', baseRefreshDue: true,
      consumeRekick: async () => { consumed.push('consume'); }, events, git: makeGitRunner(repo),
    }));

    expect(result).toEqual({ kind: 'repaired' });
    expect(records.filter((record) => record.type === 'restack_planned').map((record) => record.cause))
      .toEqual(['feature-repair']);
    expect(consumed).toEqual(['consume']);
  });
});
