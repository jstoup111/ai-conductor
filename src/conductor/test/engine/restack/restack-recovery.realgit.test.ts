// Covers: task:24, task:rem-prd-audit-R15, task:rem-as-built-rem-as-built-R27
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import {
  journalRefFor,
  pinStagingRef,
  readRestackJournal,
  writeRestackJournalBlob,
  type RestackJournal,
} from '../../../src/engine/restack/restack-journal.js';
import { recoverRestackJournal } from '../../../src/engine/restack/restack-recovery.js';
import { replayChildRange } from '../../../src/engine/restack/restack-replay.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value);
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-recovery-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, file: string, content: string) => {
    await writeFile(join(repo, file), content);
    await git(['add', file]);
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack recovery']);
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.pipeline/\n');
  const base = await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const oldTip = await commit('child', 'child.txt', 'child\n');
  await git(['checkout', '-q', 'main']);
  const advanced = await commit('advance', 'base.txt', 'advanced\n');
  await git(['checkout', '-q', 'feat/c1/demo']);
  return { repo, git, base, oldTip, advanced };
}

describe('recoverRestackJournal (real local Git)', () => {
  it('removes an aborted journal after a lost worktree has no committed outstanding halt', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');
    await pinStagingRef(subject.repo, 'demo', child, subject.oldTip);
    const journal: RestackJournal = {
      opId: 'aborted-cleanup' as RestackOpId,
      cause: 'base-refresh',
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip }],
      ranges: [{ child, oldParent: subject.advanced, oldTip: subject.oldTip, kind: 'active' }],
      children: [{ child, status: 'pending' }],
      state: 'aborted',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });

    expect(await recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .toEqual({ kind: 'cleaned' });
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    await expect(subject.git(['rev-parse', '-q', '--verify', 'refs/conductor/demo/restack/staging/c1']))
      .rejects.toBeDefined();
  });

  it('replays a pending planned child from its journaled parent without reading .pipeline', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');
    const journal: RestackJournal = {
      opId: 'crashed-planned' as RestackOpId,
      cause: 'base-refresh',
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip }],
      // The first range's parent is the new default captured by the original
      // planner, so the recovery neither re-resolves nor re-plans the stack.
      ranges: [{ child, oldParent: subject.advanced, oldTip: subject.oldTip, kind: 'active' }],
      children: [{ child, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });

    const result = await recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) });

    expect(result).toEqual({ kind: 'recovered', fromState: 'planned' });
    const tip = (await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim();
    expect(tip).not.toBe(subject.oldTip);
    expect((await subject.git(['merge-base', '--is-ancestor', subject.advanced, tip])).stdout).toBe('');
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  });

  it('recovers an unentered pre-region halt-record leaf through its owning exact rewrite and translates it', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    const leaf = parseChildId(3);
    if (!child || !leaf) throw new Error('child ids should parse');

    await subject.git(['checkout', '-q', 'main']);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo', subject.base]);
    const haltRecord = await (async () => {
      await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
      await writeFile(join(subject.repo, '.docs', 'halted', 'demo.md'), 'Status: halted\n');
      await subject.git(['add', '.docs/halted/demo.md']);
      await subject.git(['commit', '-qm', 'halt record']);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    })();
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.git(['rebase', '-q', '--onto', 'feat/daemon-demo', subject.base]);
    const childTip = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    const replay = await replayChildRange(
      { child, oldParent: subject.base, oldTip: childTip, kind: 'active' },
      subject.advanced,
      { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      makeGitRunner(subject.repo),
    );
    const rewrittenLeaf = replay.rewrites.get(haltRecord);
    if (!rewrittenLeaf) throw new Error('child replay did not retain the halt-record rewrite');
    await pinStagingRef(subject.repo, 'demo', child, replay.tip);
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'task-evidence.json'), JSON.stringify({
      evidenceStamps: { halted: { sha: haltRecord } },
    }));
    const journal: RestackJournal = {
      opId: 'crashed-before-unentered-leaf' as RestackOpId,
      cause: 'base-refresh',
      newDefault: subject.advanced,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: childTip },
        { ref: 'refs/heads/feat/daemon-demo' as never, oldSha: haltRecord },
      ],
      ranges: [
        { child, oldParent: subject.base, oldTip: childTip, kind: 'active' },
        { child: leaf, oldParent: haltRecord, oldTip: haltRecord, kind: 'leaf-unentered' },
      ],
      children: [
        { child, status: 'replayed', rewrites: [...replay.rewrites].map(([from, to]) => ({ from, to })) },
        { child: leaf, status: 'pending', rewrites: [] },
      ],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    expect((await subject.git(['rev-parse', 'feat/daemon-demo'])).stdout.trim()).toBe(rewrittenLeaf);
    expect((await subject.git(['merge-base', '--is-ancestor', rewrittenLeaf, 'feat/c1/demo'])).stdout).toBe('');
    await expect(readFile(join(subject.repo, '.pipeline', 'task-evidence.json'), 'utf8'))
      .resolves.toContain(rewrittenLeaf);
    await expect(readFile(join(subject.repo, '.pipeline', 'rebase-rewrites.json'), 'utf8'))
      .resolves.toContain(`\"${haltRecord}\": \"${rewrittenLeaf}\"`);
  });

  // Covers: task:rem-as-built-rem-as-built-R26
  it('recovers an unentered pre-region halt-record leaf at identity through its adopted originating repair child', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    const second = parseChildId(2);
    const leaf = parseChildId(3);
    if (!child || !second || !leaf) throw new Error('child ids should parse');

    await subject.git(['checkout', '-q', 'main']);
    await subject.git(['branch', '-D', 'feat/c1/demo']);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo', subject.base]);
    await mkdir(join(subject.repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(subject.repo, '.docs', 'halted', 'demo.md'), 'Status: halted\n');
    await subject.git(['add', '.docs/halted/demo.md']);
    await subject.git(['commit', '-qm', 'halt record']);
    const haltRecord = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    await writeFile(join(subject.repo, 'child.txt'), 'child\n');
    await subject.git(['add', 'child.txt']);
    await subject.git(['commit', '-qm', 'child work']);
    const closure = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await writeFile(join(subject.repo, 'repair.txt'), 'repair\n');
    await subject.git(['add', 'repair.txt']);
    await subject.git(['commit', '-qm', 'repair']);
    const repaired = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    await subject.git(['checkout', '-qb', 'feat/c2/demo', closure]);
    const journal: RestackJournal = {
      opId: 'crashed-before-unentered-repair-leaf' as RestackOpId,
      cause: 'feature-repair',
      newDefault: subject.base,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: repaired },
        { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: closure },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: closure },
        { ref: 'refs/heads/feat/daemon-demo' as never, oldSha: haltRecord },
      ],
      ranges: [
        { child, oldParent: subject.base, oldTip: repaired, kind: 'closed' },
        { child: second, oldParent: closure, oldTip: closure, kind: 'active' },
        { child: leaf, oldParent: haltRecord, oldTip: haltRecord, kind: 'leaf-unentered' },
      ],
      originatingChildren: [child],
      children: [{ child, status: 'pending' }, { child: second, status: 'pending' }, { child: leaf, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    await expect(subject.git(['rev-parse', 'feat/daemon-demo'])).resolves.toMatchObject({ stdout: `${haltRecord}\n` });
    await expect(subject.git(['rev-parse', 'feat/c1/demo'])).resolves.toMatchObject({ stdout: `${repaired}\n` });
    await expect(subject.git(['rev-parse', 'feat/c2/demo'])).resolves.toMatchObject({ stdout: `${repaired}\n` });
    await expect(subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).resolves.toMatchObject({ stdout: `${repaired}\n` });
    await expect(subject.git(['merge-base', '--is-ancestor', haltRecord, repaired])).resolves.toMatchObject({ stdout: '' });
  });

  // Covers: task:rem-prd-audit-R14
  it('hands a planned-recovery replay conflict to the configured resolver and applies its result', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');
    await writeFile(join(subject.repo, 'base.txt'), 'child\n');
    await subject.git(['add', 'base.txt']);
    await subject.git(['commit', '-qm', 'child conflicts with advance']);
    const oldTip = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    const journal: RestackJournal = {
      opId: 'crashed-planned-conflict' as RestackOpId,
      cause: 'base-refresh',
      newDefault: subject.advanced,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: oldTip }],
      ranges: [{ child, oldParent: subject.base, oldTip, kind: 'active' }],
      children: [{ child, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    let calls = 0;
    const resolver: RestackResolver = async ({ projectRoot, environment }) => {
      calls += 1;
      await writeFile(join(projectRoot, 'base.txt'), 'resolved\n');
      const git = (args: string[]) => execFile('git', args, { cwd: projectRoot, env: { ...process.env, ...environment } });
      await git(['add', 'base.txt']);
      await git(['rebase', '--continue']);
      return { resolved: true };
    };

    const result = await recoverRestackJournal({
      worktree: subject.repo,
      slug: 'demo',
      git: makeGitRunner(subject.repo),
      resolver,
      resolverCap: 1,
    });
    expect(result).toEqual({ kind: 'recovered', fromState: 'planned' });

    expect(calls).toBe(1);
    await expect(subject.git(['show', 'feat/c1/demo:base.txt'])).resolves.toMatchObject({ stdout: 'resolved\n' });
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  });

  it('refuses a merge-bearing planned-recovery conflict before resolver dispatch or ref moves', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');

    await subject.git(['checkout', '-qb', 'merge-side', subject.oldTip]);
    await writeFile(join(subject.repo, 'side.txt'), 'side\n');
    await subject.git(['add', 'side.txt']);
    await subject.git(['commit', '-qm', 'merge side']);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await writeFile(join(subject.repo, 'base.txt'), 'child\n');
    await subject.git(['add', 'base.txt']);
    await subject.git(['commit', '-qm', 'child conflicts with advance']);
    await subject.git(['merge', '--no-ff', '-m', 'merge side history', 'merge-side']);
    const merge = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    const journal: RestackJournal = {
      opId: 'crashed-planned-merge-conflict' as RestackOpId,
      cause: 'base-refresh',
      newDefault: subject.advanced,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: merge }],
      ranges: [{ child, oldParent: subject.base, oldTip: merge, kind: 'active' }],
      children: [{ child, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    const refsBefore = (await subject.git([
      'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat/', 'refs/conductor/demo/closed/',
    ])).stdout;
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => { refusals.push(event); });
    let resolverCalls = 0;

    const result = await recoverRestackJournal({
      worktree: subject.repo,
      slug: 'demo',
      events,
      git: makeGitRunner(subject.repo),
      resolver: async () => {
        resolverCalls += 1;
        return { resolved: false, reason: 'must not be called' };
      },
    });

    expect(result).toEqual({ kind: 'halted' });
    expect(resolverCalls).toBe(0);
    expect((await subject.git([
      'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat/', 'refs/conductor/demo/closed/',
    ])).stdout).toBe(refsBefore);
    expect(refusals).toContainEqual(expect.objectContaining({
      reason: 'flatten_refused', child: 1, detail: expect.stringContaining(merge),
    }));
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/resolve.*feat\/c1\/demo.*resume/is);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.not.toMatch(/git\s+rebase/i);
  });

  // Covers: task:rem-as-built-R22
  it('replays a planned base refresh from its journaled new default before any child stages', async () => {
    const subject = await fixture();
    const first = parseChildId(1);
    const second = parseChildId(2);
    if (!first || !second) throw new Error('child ids should parse');

    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', subject.oldTip]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const secondTip = await (async () => {
      await writeFile(join(subject.repo, 'second.txt'), 'second\n');
      await subject.git(['add', 'second.txt']);
      await subject.git(['commit', '-qm', 'second child']);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    })();

    const journal: RestackJournal = {
      opId: 'crashed-planned-base-refresh' as RestackOpId,
      cause: 'base-refresh',
      newDefault: subject.advanced,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip },
        { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: subject.oldTip },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: secondTip },
      ],
      ranges: [
        { child: first, oldParent: subject.base, oldTip: subject.oldTip, kind: 'closed' },
        { child: second, oldParent: subject.oldTip, oldTip: secondTip, kind: 'active' },
      ],
      children: [{ child: first, status: 'pending' }, { child: second, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });

    const result = await recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) });

    expect(result).toEqual({ kind: 'recovered', fromState: 'planned' });
    const [firstTip, recoveredSecondTip] = await Promise.all([
      subject.git(['rev-parse', 'feat/c1/demo']).then(({ stdout }) => stdout.trim()),
      subject.git(['rev-parse', 'feat/c2/demo']).then(({ stdout }) => stdout.trim()),
    ]);
    await expect(subject.git(['merge-base', '--is-ancestor', subject.advanced, firstTip])).resolves.toMatchObject({ stdout: '', stderr: '' });
    await expect(subject.git(['merge-base', '--is-ancestor', firstTip, recoveredSecondTip])).resolves.toMatchObject({ stdout: '', stderr: '' });
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  });

  // Covers: task:rem-as-built-rem-as-built-R25
  it('adopts pending lower and originating feature-repair children before their staging refs exist', async () => {
    const subject = await fixture();
    const first = parseChildId(1);
    const second = parseChildId(2);
    if (!first || !second) throw new Error('child ids should parse');

    await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', subject.oldTip]);
    await subject.git(['checkout', '-qb', 'feat/c2/demo']);
    const secondTip = await (async () => {
      await writeFile(join(subject.repo, 'second.txt'), 'second\n');
      await subject.git(['add', 'second.txt']);
      await subject.git(['commit', '-qm', 'second child']);
      return sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    })();

    const journal: RestackJournal = {
      opId: 'crashed-planned-feature-repair' as RestackOpId,
      cause: 'feature-repair',
      newDefault: subject.advanced,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [
        { ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip },
        { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: subject.oldTip },
        { ref: 'refs/heads/feat/c2/demo' as never, oldSha: secondTip },
      ],
      ranges: [
        { child: first, oldParent: subject.base, oldTip: subject.oldTip, kind: 'closed' },
        { child: second, oldParent: subject.oldTip, oldTip: secondTip, kind: 'active' },
      ],
      originatingChildren: [second],
      children: [{ child: first, status: 'pending' }, { child: second, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });

    await expect(recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) }))
      .resolves.toEqual({ kind: 'recovered', fromState: 'planned' });

    await expect(subject.git(['rev-parse', 'refs/heads/feat/c1/demo']))
      .resolves.toMatchObject({ stdout: `${subject.oldTip}\n` });
    await expect(subject.git(['rev-parse', 'refs/conductor/demo/closed/c1']))
      .resolves.toMatchObject({ stdout: `${subject.oldTip}\n` });
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
  });

  // Covers: task:rem-as-built-R23
  it('aborts an ownership-refused planned recovery and surfaces its replay-mismatch halt', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');
    await writeFile(join(subject.repo, 'base.txt'), 'X\n');
    await subject.git(['add', 'base.txt']);
    await subject.git(['commit', '-qm', 'add X']);
    await writeFile(join(subject.repo, 'base.txt'), 'base\n');
    await subject.git(['add', 'base.txt']);
    await subject.git(['commit', '-qm', 'revert X']);
    const oldTip = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    await subject.git(['checkout', '-qb', 'new-default', subject.base]);
    await writeFile(join(subject.repo, 'base.txt'), 'X\n');
    await subject.git(['add', 'base.txt']);
    await subject.git(['commit', '-qm', 'default adds X']);
    const newDefault = sha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    const journal: RestackJournal = {
      opId: 'crashed-planned-replay-mismatch' as RestackOpId,
      cause: 'base-refresh',
      newDefault,
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: oldTip }],
      ranges: [{ child, oldParent: subject.base, oldTip, kind: 'active' }],
      children: [{ child, status: 'pending' }],
      state: 'planned',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('restack_refused', (event) => refusals.push(event));

    await expect(runStackPreflight({
      worktree: subject.repo,
      slug: 'demo',
      events,
      git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });

    expect(refusals).toEqual([expect.objectContaining({
      reason: 'replay-mismatch', child: 1, detail: 'base.txt',
    })]);
    expect(await readRestackJournal(subject.repo, 'demo')).toMatchObject({
      kind: 'journal', journal: { state: 'aborted' },
    });
    expect((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim()).toBe(oldTip);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8'))
      .resolves.toBe('restack refused (replay-mismatch) child 1\nbase.txt\n');
  });

  it('finishes a dead owner’s ready journal after .pipeline is lost, using only its staging and journal refs', async () => {
    const subject = await fixture();
    const child = parseChildId(1);
    if (!child) throw new Error('child id should parse');
    const replay = await replayChildRange(
      { child, oldParent: subject.base, oldTip: subject.oldTip, kind: 'active' },
      subject.advanced,
      { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      makeGitRunner(subject.repo),
    );
    await pinStagingRef(subject.repo, 'demo', child, replay.tip);
    const journal: RestackJournal = {
      opId: 'crashed-ready' as RestackOpId,
      cause: 'base-refresh',
      committer: { name: 'Restack recovery', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' },
      dirtyPaths: [],
      refs: [{ ref: 'refs/heads/feat/c1/demo' as never, oldSha: subject.oldTip }],
      ranges: [{ child, oldParent: subject.base, oldTip: subject.oldTip, kind: 'active' }],
      children: [{ child, status: 'replayed' }],
      state: 'ready',
      owner: { host: 'dead-recovery-host', pid: 1, processStartTime: '0' },
    };
    const blob = await writeRestackJournalBlob(subject.repo, journal);
    await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
    await rm(join(subject.repo, '.pipeline'), { recursive: true, force: true });

    const events = new ConductorEventEmitter();
    const recovered: unknown[] = [];
    events.on('restack_recovered', (event) => recovered.push(event));
    const result = await recoverRestackJournal({
      worktree: subject.repo,
      slug: 'demo',
      events,
      git: makeGitRunner(subject.repo),
    });

    expect(result).toEqual({ kind: 'recovered', fromState: 'ready' });
    expect((await subject.git(['rev-parse', 'feat/c1/demo'])).stdout.trim()).toBe(replay.tip);
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    expect(recovered).toEqual([{ type: 'restack_recovered', opId: 'crashed-ready', fromState: 'ready' }]);
  });
});
