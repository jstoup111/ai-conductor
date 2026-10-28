// Covers: task:30, task:rem-prd-audit-rem-v3-intent-restack
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveActiveChild } from '../../../src/engine/child-cursor.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { cascadesRefFor, checkCascadeCap } from '../../../src/engine/restack/cascade-cap.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import {
  journalRefFor,
  readRestackJournal,
  replaceAppliedJournalWithFollowOn,
  writeRestackJournalBlob,
} from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { writePublicationRecord } from '../../../src/engine/stack-publication-record.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

// Pass-through spies: production behaviour is unchanged, the spies only record
// which preflight phases were reached and with which cause.
vi.mock('../../../src/engine/restack/restack-executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-executor.js')>();
  return { ...actual, runRestack: vi.fn(actual.runRestack) };
});
vi.mock('../../../src/engine/restack/restack-journal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-journal.js')>();
  return { ...actual, replaceAppliedJournalWithFollowOn: vi.fn(actual.replaceAppliedJournalWithFollowOn) };
});
vi.mock('../../../src/engine/restack/restack-recovery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-recovery.js')>();
  return { ...actual, recoverRestackJournal: vi.fn(actual.recoverRestackJournal) };
});
vi.mock('../../../src/engine/child-cursor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/child-cursor.js')>();
  return { ...actual, resolveActiveChild: vi.fn(actual.resolveActiveChild) };
});
vi.mock('../../../src/engine/restack/cascade-cap.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/restack/cascade-cap.js')>();
  return { ...actual, checkCascadeCap: vi.fn(actual.checkCascadeCap) };
});

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => { await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

type EventRecord = { type: string; reason?: string; cause?: string; opId?: string; child?: number };

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-sweep-'));
  repositories.push(repo);
  const git = async (args: string[], cwd = repo) => execFile('git', args, { cwd });
  const commit = async (message: string, path: string, value: string, cwd = repo) => {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), value);
    await git(['add', path], cwd);
    await git(['commit', '-qm', message], cwd);
    return (await git(['rev-parse', 'HEAD'], cwd)).stdout.trim();
  };
  const rev = async (ref: string) => (await git(['rev-parse', ref])).stdout.trim();
  const isAncestor = async (ancestor: string, descendant: string) =>
    git(['merge-base', '--is-ancestor', ancestor, descendant]).then(() => true, () => false);
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
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { a: 1, b: 2, c: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  const onBranch = async <T>(branch: string, run: () => Promise<T>): Promise<T> => {
    await git(['checkout', '-q', branch]);
    try { return await run(); } finally { await git(['checkout', '-q', 'feat/daemon-demo']); }
  };
  const refs = async () => (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout;
  return { repo, git, commit, rev, isAncestor, onBranch, refs, closedOne, closedTwo };
}

type Subject = Awaited<ReturnType<typeof fixture>>;

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
  const raw = await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8').catch(() => '');
  const records = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as EventRecord);
  return { result, records };
}

const ofType = (records: readonly EventRecord[], type: string) => records.filter((record) => record.type === type);
const exists = (path: string) => access(path).then(() => true, () => false);
const restackCauses = () => vi.mocked(runRestack).mock.calls.map(([options]) => options.cause);

async function preflight(subject: Subject, extra: Partial<Parameters<typeof runStackPreflight>[0]> = {}) {
  return withPersistedEvents(subject.repo, (events) => runStackPreflight({
    worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo), ...extra,
  }));
}

async function advanceDefault(subject: Subject) {
  return subject.onBranch('main', () => subject.commit('base advance', 'main.txt', 'advanced\n'));
}

describe('runStackPreflight Task 30 sweep (real local Git)', () => {
  it('lets a published stack with no pending repair resume without a halt', async () => {
    const subject = await fixture();
    await expect(writePublicationRecord(subject.repo, 'demo', undefined, {
      version: 1,
      members: [{ position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 }],
    })).resolves.toEqual({ kind: 'updated' });
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => { refusals.push(event); });

    await expect(runStackPreflight({
      worktree: subject.repo, slug: 'demo', events, git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'clear' });

    expect(recoverRestackJournal).toHaveBeenCalledTimes(2);
    expect(runRestack).not.toHaveBeenCalled();
    expect(refusals).toEqual([]);
  });

  // Covers: S6.4, task:rem-prd-audit-rem-s6-4-preflight-freeze-scope
  it('resumes an interrupted ready_pr publication after partial flips without a halt', async () => {
    const subject = await fixture();
    await expect(writePublicationRecord(subject.repo, 'demo', undefined, {
      version: 1,
      members: [
        { position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 },
        { position: parseChildId(2)!, branch: 'feat/c2/demo', pr: 102 },
        { position: parseChildId(3)!, branch: 'feat/daemon-demo', pr: 103 },
      ],
    })).resolves.toEqual({ kind: 'updated' });

    const { result, records } = await preflight(subject);

    expect(result).toEqual({ kind: 'clear' });
    expect(ofType(records, 'restack_refused')).toEqual([]);
    expect(await exists(join(subject.repo, '.pipeline', 'HALT'))).toBe(false);
  });

  // Covers: S9.1, task:30
  it('sweepG4: an appended operator commit is repaired by one feature-repair restack that moves closed/c1 and replays child 2 and the leaf, for one or two appended children, another worktree, and a trailing halt record', async () => {
    // (a) X appended on feat/c1/demo in this worktree.
    {
      const subject = await fixture();
      const x = await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'operator.txt', 'X\n'));
      const { result, records } = await preflight(subject);
      expect(result).toEqual({ kind: 'repaired' });
      expect(restackCauses()).toEqual(['feature-repair']);
      expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(x);
      expect(await subject.isAncestor(x, 'feat/c2/demo')).toBe(true);
      expect(await subject.isAncestor(x, 'refs/conductor/demo/closed/c2')).toBe(true);
      expect(await subject.isAncestor('feat/c2/demo', 'feat/daemon-demo')).toBe(true);
      expect((await subject.git(['show', 'feat/c2/demo:two.txt'])).stdout).toBe('two\n');
      expect((await subject.git(['show', 'feat/daemon-demo:leaf.txt'])).stdout).toBe('leaf\n');
      expect(await subject.rev('feat/c2/demo')).not.toBe(subject.closedTwo);
      expect(ofType(records, 'restack_refused')).toEqual([]);
      expect(await exists(join(subject.repo, '.pipeline', 'HALT'))).toBe(false);
      vi.mocked(runRestack).mockClear();
    }
    // (b) Child 1 and child 2 both have appended commits: one restack repairs both.
    {
      const subject = await fixture();
      const x1 = await subject.onBranch('feat/c1/demo', () => subject.commit('operator one', 'operator-one.txt', 'X1\n'));
      await subject.onBranch('feat/c2/demo', () => subject.commit('operator two', 'operator-two.txt', 'X2\n'));
      const { result, records } = await preflight(subject);
      expect(result).toEqual({ kind: 'repaired' });
      expect(restackCauses()).toEqual(['feature-repair']);
      expect(vi.mocked(runRestack).mock.calls[0]![0].originatingChildren).toEqual([1, 2]);
      expect(ofType(records, 'restack_planned').map((record) => record.cause)).toEqual(['feature-repair']);
      expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(x1);
      expect(await subject.isAncestor(x1, 'feat/c2/demo')).toBe(true);
      expect((await subject.git(['show', 'refs/conductor/demo/closed/c2:operator-two.txt'])).stdout).toBe('X2\n');
      expect((await subject.git(['show', 'feat/daemon-demo:operator-one.txt'])).stdout).toBe('X1\n');
      expect((await subject.git(['show', 'feat/daemon-demo:operator-two.txt'])).stdout).toBe('X2\n');
      expect(ofType(records, 'restack_refused')).toEqual([]);
      expect(await exists(join(subject.repo, '.pipeline', 'HALT'))).toBe(false);
      vi.mocked(runRestack).mockClear();
    }
    // (c) X committed from another worktree that still has feat/c1/demo checked out.
    {
      const subject = await fixture();
      const elsewhere = await mkdtemp(join(tmpdir(), 'stack-preflight-sweep-elsewhere-'));
      repositories.push(elsewhere);
      await rm(elsewhere, { recursive: true, force: true });
      await subject.git(['worktree', 'add', '-q', elsewhere, 'feat/c1/demo']);
      const x = await subject.commit('operator elsewhere', 'operator.txt', 'X\n', elsewhere);
      const { result, records } = await preflight(subject);
      expect(result).toEqual({ kind: 'repaired' });
      expect(restackCauses()).toEqual(['feature-repair']);
      expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(x);
      expect(await subject.rev('feat/c1/demo')).toBe(x);
      expect(await subject.isAncestor(x, 'feat/c2/demo')).toBe(true);
      expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
      expect(ofType(records, 'restack_refused')).toEqual([]);
      expect(await exists(join(subject.repo, '.pipeline', 'HALT'))).toBe(false);
      vi.mocked(runRestack).mockClear();
    }
    // (d) X followed by a halt-record commit: closed/c1 moves to the halt-record commit.
    {
      const subject = await fixture();
      const haltRecord = await subject.onBranch('feat/c1/demo', async () => {
        await subject.commit('operator change', 'operator.txt', 'X\n');
        return subject.commit('halt record', '.docs/halted/demo.md', 'Status: halted\n');
      });
      const { result, records } = await preflight(subject);
      expect(result).toEqual({ kind: 'repaired' });
      expect(restackCauses()).toEqual(['feature-repair']);
      expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(haltRecord);
      expect(await subject.isAncestor(haltRecord, 'feat/c2/demo')).toBe(true);
      expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
      expect(ofType(records, 'restack_refused')).toEqual([]);
      expect(await exists(join(subject.repo, '.pipeline', 'HALT'))).toBe(false);
    }
  });

  // Covers: S9.3, S9.4, task:30
  it('sweepG4: halt-record-only appends run no repair, and closed-child rewrites or a non-ancestor child range halt needs-human naming the child without any restack', async () => {
    // (a) Only .docs/halted/demo.md past closed/c1: no repair.
    {
      const subject = await fixture();
      await subject.onBranch('feat/c1/demo', () => subject.commit('halt record', '.docs/halted/demo.md', 'Status: halted\n'));
      const refsBefore = await subject.refs();
      const { result, records } = await preflight(subject);
      expect(result).toEqual({ kind: 'clear' });
      expect(runRestack).not.toHaveBeenCalled();
      expect(ofType(records, 'restack_planned')).toEqual([]);
      expect(await subject.refs()).toBe(refsBefore);
    }
    // (b) A2 amended, (c) feat/c1/demo reset behind closed/c1.
    for (const rewrite of [
      (subject: Subject) => subject.onBranch('feat/c1/demo', () => subject.git(['commit', '-q', '--amend', '-m', 'closed one amended'])),
      (subject: Subject) => subject.onBranch('feat/c1/demo', () => subject.git(['reset', '-q', '--hard', 'HEAD^'])),
    ]) {
      const subject = await fixture();
      await rewrite(subject);
      expect(await subject.isAncestor(subject.closedOne, 'feat/c1/demo')).toBe(false);
      const c2Before = await subject.rev('feat/c2/demo');
      const { result, records } = await preflight(subject);
      expect(result).toMatchObject({ kind: 'halted', detail: expect.stringContaining('closed-child-rewritten') });
      expect(runRestack).not.toHaveBeenCalled();
      expect(ofType(records, 'restack_planned')).toEqual([]);
      expect(ofType(records, 'restack_refused')).toEqual([expect.objectContaining({ reason: 'closed-child-rewritten', child: 1 })]);
      expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(subject.closedOne);
      expect(await subject.rev('feat/c2/demo')).toBe(c2Before);
      await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    }
    // (d) closed/c1 is not an ancestor of feat/c2/demo.
    {
      const subject = await fixture();
      const rebuiltTwo = await subject.onBranch('feat/c2/demo', async () => {
        await subject.git(['reset', '-q', '--hard', 'main']);
        return subject.commit('closed two rebuilt', 'two.txt', 'two\n');
      });
      await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', rebuiltTwo]);
      const closedBefore = await subject.rev('refs/conductor/demo/closed/c1');
      const { result, records } = await preflight(subject);
      expect(result).toMatchObject({ kind: 'halted', detail: expect.any(String) });
      expect(runRestack).not.toHaveBeenCalled();
      expect(ofType(records, 'restack_planned')).toEqual([]);
      expect(ofType(records, 'restack_refused')).toEqual([expect.objectContaining({ reason: 'range-not-ancestor', child: 2 })]);
      expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(closedBefore);
      expect(await subject.rev('feat/c2/demo')).toBe(rebuiltTwo);
      await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    }
  });

  // Covers: S9.11, S9.12, task:30
  it('sweepG4: a due base refresh runs as a distinct-opId follow-on after the repair, and after a crash at applied the next preflight recovers it through replaceAppliedJournalWithFollowOn', async () => {
    // (a) Live: feature-repair first, base-refresh second, distinct opIds.
    {
      const subject = await fixture();
      const advanced = await advanceDefault(subject);
      await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'operator.txt', 'X\n'));
      const { result, records } = await preflight(subject, { baseRefreshDue: true });
      expect(result).toEqual({ kind: 'repaired' });
      expect(restackCauses()).toEqual(['feature-repair', 'base-refresh']);
      const planned = ofType(records, 'restack_planned');
      expect(planned.map((record) => record.cause)).toEqual(['feature-repair', 'base-refresh']);
      expect(planned[0]!.opId).not.toBe(planned[1]!.opId);
      const applied = ofType(records, 'restack_applied');
      const lastRepair = applied.map((record) => record.cause).lastIndexOf('feature-repair');
      const firstRefresh = applied.map((record) => record.cause).indexOf('base-refresh');
      expect(lastRepair).toBeGreaterThanOrEqual(0);
      expect(firstRefresh).toBeGreaterThan(lastRepair);
      expect(applied.filter((record) => record.cause === 'feature-repair').every((record) => record.opId === planned[0]!.opId)).toBe(true);
      expect(applied.filter((record) => record.cause === 'base-refresh').every((record) => record.opId === planned[1]!.opId)).toBe(true);
      expect(await subject.isAncestor(advanced, 'feat/c1/demo')).toBe(true);
      expect((await subject.git(['show', 'feat/daemon-demo:operator.txt'])).stdout).toBe('X\n');
      vi.mocked(runRestack).mockClear();
      vi.mocked(replaceAppliedJournalWithFollowOn).mockClear();
    }
    // (b) Crash after the repair reached applied: recovery runs the follow-on.
    {
      const subject = await fixture();
      const advanced = await advanceDefault(subject);
      await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'operator.txt', 'X\n'));
      const childOne = parseChildId(1);
      if (!childOne) throw new Error('child id should parse');
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [childOne],
        followOnCause: 'base-refresh', git: makeGitRunner(subject.repo),
      })).resolves.toMatchObject({ kind: 'applied' });
      const applied = await readRestackJournal(subject.repo, 'demo');
      if (applied.kind !== 'journal') throw new Error('repair journal should remain');
      const deadBlob = await writeRestackJournalBlob(subject.repo, {
        ...applied.journal, owner: { host: 'dead-preflight-host', pid: 1, processStartTime: '0' },
      });
      await subject.git(['update-ref', journalRefFor('demo'), deadBlob, applied.blob]);
      vi.mocked(runRestack).mockClear();
      vi.mocked(replaceAppliedJournalWithFollowOn).mockClear();

      const { result, records } = await preflight(subject);

      expect(result).toEqual({ kind: 'clear' });
      // The only restack in this preflight is recovery's base-refresh follow-on.
      expect(vi.mocked(runRestack).mock.calls).toHaveLength(1);
      const followOn = vi.mocked(runRestack).mock.calls[0]![0];
      expect(followOn.cause).toBe('base-refresh');
      expect(followOn.replacesAppliedJournal).toMatchObject({ blob: deadBlob, journal: { state: 'applied', followOnCause: 'base-refresh' } });
      expect(vi.mocked(replaceAppliedJournalWithFollowOn)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(replaceAppliedJournalWithFollowOn).mock.calls[0]![2]).toMatchObject({ blob: deadBlob });
      const planned = ofType(records, 'restack_planned');
      expect(planned.map((record) => record.cause)).toEqual(['base-refresh']);
      expect(planned[0]!.opId).not.toBe(applied.journal.opId);
      expect(ofType(records, 'restack_applied').map((record) => record.cause)).toContain('base-refresh');
      expect(await subject.isAncestor(advanced, 'feat/c1/demo')).toBe(true);
      expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    }
    // (c) Publication after the repair reached applied keeps that repair but
    // drops the recovery-owned base-refresh follow-on.
    {
      const subject = await fixture();
      await advanceDefault(subject);
      await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'operator.txt', 'X\n'));
      const childOne = parseChildId(1);
      if (!childOne) throw new Error('child id should parse');
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [childOne],
        followOnCause: 'base-refresh', git: makeGitRunner(subject.repo),
      })).resolves.toMatchObject({ kind: 'applied' });
      const applied = await readRestackJournal(subject.repo, 'demo');
      if (applied.kind !== 'journal') throw new Error('repair journal should remain');
      const deadBlob = await writeRestackJournalBlob(subject.repo, {
        ...applied.journal, owner: { host: 'dead-preflight-host', pid: 1, processStartTime: '0' },
      });
      await subject.git(['update-ref', journalRefFor('demo'), deadBlob, applied.blob]);
      await expect(writePublicationRecord(subject.repo, 'demo', undefined, {
        version: 1,
        members: [{ position: childOne, branch: 'feat/c1/demo', pr: 101 }],
      })).resolves.toEqual({ kind: 'updated' });
      vi.mocked(runRestack).mockClear();

      const { result, records } = await preflight(subject);

      expect(result).toEqual({ kind: 'clear' });
      expect(vi.mocked(runRestack)).not.toHaveBeenCalled();
      expect(ofType(records, 'restack_refused')).toEqual([]);
      expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
      expect(await exists(join(subject.repo, '.pipeline', 'HALT'))).toBe(false);
    }
  });

  // Covers: S6.4, task:rem-prd-audit-rem-s6-4-preflight-freeze-scope
  it('suppresses a follow-on when publication arrives after feature-repair applies', async () => {
    const subject = await fixture();
    await advanceDefault(subject);
    await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'operator.txt', 'X\n'));
    let published = false;
    const { result, records } = await withPersistedEvents(subject.repo, async (events) => {
      events.on('restack_applied', async (event) => {
        if (event.type !== 'restack_applied' || event.cause !== 'feature-repair' || published) return;
        published = true;
        await writePublicationRecord(subject.repo, 'demo', undefined, {
          version: 1,
          members: [{ position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 }],
        });
      });
      return runStackPreflight({
        worktree: subject.repo, slug: 'demo', baseRefreshDue: true, events, git: makeGitRunner(subject.repo),
      });
    });

    expect(result).toEqual({ kind: 'repaired' });
    expect(restackCauses()).toEqual(['feature-repair']);
    expect(ofType(records, 'restack_refused')).toEqual([]);
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    expect(await exists(join(subject.repo, '.pipeline', 'HALT'))).toBe(false);
  });

  // Covers: S9.9, S9.10, task:30
  it('sweepG4: deferred-base-refresh is persisted and no base refresh runs when the repair is refused for cascade cap, dirty overlap or conflict, or when the follow-on is refused checked-out-elsewhere', async () => {
    const expectNoBaseRefresh = async (subject: Subject, records: readonly EventRecord[], advanced: string) => {
      expect(restackCauses()).not.toContain('base-refresh');
      expect(ofType(records, 'restack_planned').map((record) => record.cause)).not.toContain('base-refresh');
      expect(ofType(records, 'restack_applied').map((record) => record.cause)).not.toContain('base-refresh');
      expect(await subject.isAncestor(advanced, 'feat/c1/demo')).toBe(false);
    };
    // (a) Cascade cap exhausted for child 1.
    {
      const subject = await fixture();
      const advanced = await advanceDefault(subject);
      await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'operator.txt', 'X\n'));
      const blob = (await makeGitRunner(subject.repo)(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ version: 1, counts: { 1: 3 } }) })).stdout.trim();
      await subject.git(['update-ref', cascadesRefFor('demo'), blob]);
      const consumed: string[] = [];
      const { result, records } = await preflight(subject, { baseRefreshDue: true, consumeRekick: async () => { consumed.push('x'); } });
      expect(result).toMatchObject({ kind: 'halted', detail: expect.any(String) });
      expect(ofType(records, 'restack_refused').map((record) => record.reason)).toEqual(['cascade-cap', 'deferred-base-refresh']);
      expect(consumed).toEqual([]);
      await expectNoBaseRefresh(subject, records, advanced);
      vi.mocked(runRestack).mockClear();
    }
    // (b) Dirty overlap with the checked-out leaf.
    {
      const subject = await fixture();
      await subject.onBranch('main', () => subject.commit('base advance', 'main.txt', 'advanced\n'));
      const advanced = await subject.rev('main');
      await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'base.txt', 'X\n'));
      await writeFile(join(subject.repo, 'base.txt'), 'operator wip\n');
      const { result, records } = await preflight(subject, { baseRefreshDue: true });
      expect(result).toMatchObject({ kind: 'halted', detail: expect.any(String) });
      expect(ofType(records, 'restack_refused').map((record) => record.reason)).toEqual(['dirty-overlap', 'deferred-base-refresh']);
      await expectNoBaseRefresh(subject, records, advanced);
      vi.mocked(runRestack).mockClear();
    }
    // (c) Replay conflict the resolver cannot resolve.
    {
      const subject = await fixture();
      const advanced = await advanceDefault(subject);
      await subject.onBranch('feat/c1/demo', () => subject.commit('operator conflicting change', 'two.txt', 'operator\n'));
      const { result, records } = await preflight(subject, {
        baseRefreshDue: true, resolver: async () => ({ resolved: false, reason: 'cannot resolve' }), resolverCap: 1,
      });
      expect(result).toMatchObject({ kind: 'halted', detail: expect.any(String) });
      expect(ofType(records, 'restack_conflict').length).toBeGreaterThan(0);
      expect(ofType(records, 'restack_refused').map((record) => record.reason)).toContain('deferred-base-refresh');
      expect(ofType(records, 'restack_applied')).toEqual([]);
      await expectNoBaseRefresh(subject, records, advanced);
      vi.mocked(runRestack).mockClear();
    }
    // (d) Repair applies; the follow-on is refused checked-out-elsewhere.
    {
      const subject = await fixture();
      const advanced = await advanceDefault(subject);
      const x = await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'operator.txt', 'X\n'));
      const elsewhere = await mkdtemp(join(tmpdir(), 'stack-preflight-sweep-elsewhere-'));
      repositories.push(elsewhere);
      await rm(elsewhere, { recursive: true, force: true });
      await subject.git(['worktree', 'add', '-q', elsewhere, 'feat/c1/demo']);
      const { result, records } = await preflight(subject, { baseRefreshDue: true });
      expect(result).toMatchObject({ kind: 'halted', detail: expect.any(String) });
      expect(await subject.rev('refs/conductor/demo/closed/c1')).toBe(x);
      expect(ofType(records, 'restack_applied').map((record) => record.cause)).toContain('feature-repair');
      expect(ofType(records, 'restack_applied').map((record) => record.cause)).not.toContain('base-refresh');
      expect(ofType(records, 'restack_refused').map((record) => record.reason)).toEqual(['checked-out-elsewhere', 'deferred-base-refresh']);
      expect(await subject.isAncestor(advanced, 'feat/c1/demo')).toBe(false);
    }
  });

  // Covers: S9.13, task:30
  it('sweepG4: an unrelated restack against an applied repair journal with a pending follow-on is refused restack-outstanding while the follow-on still applies, and a flat feature gets only the journal probe', async () => {
    // (a) Applied journal with a pending follow-on.
    {
      const subject = await fixture();
      const advanced = await advanceDefault(subject);
      await subject.onBranch('feat/c1/demo', () => subject.commit('operator change', 'operator.txt', 'X\n'));
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'feature-repair', followOnCause: 'base-refresh', git: makeGitRunner(subject.repo),
      })).resolves.toMatchObject({ kind: 'applied' });
      const applied = await readRestackJournal(subject.repo, 'demo');
      if (applied.kind !== 'journal') throw new Error('repair journal should remain for its follow-on');
      expect(applied.journal).toMatchObject({ state: 'applied', followOnCause: 'base-refresh' });
      const orphaned = await writeRestackJournalBlob(subject.repo, {
        ...applied.journal, owner: { host: 'exited-repair-host', pid: 1, processStartTime: '0' },
      });
      await subject.git(['update-ref', journalRefFor('demo'), orphaned, applied.blob]);
      const refsBefore = await subject.refs();

      const unrelated = await withPersistedEvents(subject.repo, (events) => runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, events, git: makeGitRunner(subject.repo),
      }));
      expect(unrelated.result).toEqual({ kind: 'refused', reason: 'restack-outstanding' });
      expect(ofType(unrelated.records, 'restack_refused').map((record) => record.reason)).toEqual(['restack-outstanding']);
      expect(ofType(unrelated.records, 'restack_planned')).toEqual([]);
      expect(await subject.refs()).toBe(refsBefore);

      const { result, records } = await preflight(subject);
      expect(result).toEqual({ kind: 'clear' });
      const planned = ofType(records, 'restack_planned').filter((record) => record.cause === 'base-refresh');
      expect(planned).toHaveLength(1);
      expect(planned[0]!.opId).not.toBe(applied.journal.opId);
      const followOnApplied = ofType(records, 'restack_applied').filter((record) => record.opId === planned[0]!.opId);
      expect(followOnApplied.length).toBeGreaterThan(0);
      expect(followOnApplied.every((record) => record.cause === 'base-refresh')).toBe(true);
      expect(await subject.isAncestor(advanced, 'feat/c1/demo')).toBe(true);
      expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
      vi.clearAllMocks();
    }
    // (b) No durable child state: only the guarded journal probe runs.
    {
      const repo = await mkdtemp(join(tmpdir(), 'stack-preflight-sweep-flat-'));
      repositories.push(repo);
      const git = (args: string[]) => execFile('git', args, { cwd: repo });
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'preflight@example.test']);
      await git(['config', 'user.name', 'Stack preflight']);
      await writeFile(join(repo, 'base.txt'), 'base\n');
      await git(['add', 'base.txt']);
      await git(['commit', '-qm', 'base']);
      await git(['checkout', '-qb', 'feat/daemon-demo']);
      await writeFile(join(repo, 'leaf.txt'), 'leaf\n');
      await git(['add', 'leaf.txt']);
      await git(['commit', '-qm', 'leaf']);
      const refsBefore = (await git(['for-each-ref'])).stdout;

      await expect(runStackPreflight({ worktree: repo, slug: 'demo', baseRefreshDue: true, git: makeGitRunner(repo) }))
        .resolves.toEqual({ kind: 'no-stack' });

      expect(recoverRestackJournal).toHaveBeenCalled();
      expect(resolveActiveChild).not.toHaveBeenCalled();
      expect(checkCascadeCap).not.toHaveBeenCalled();
      expect(runRestack).not.toHaveBeenCalled();
      expect((await git(['for-each-ref'])).stdout).toBe(refsBefore);
    }
  });
});
