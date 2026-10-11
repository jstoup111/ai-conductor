// Covers: task:25
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId, type ChildId } from '../../../src/engine/child-context.js';
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
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const committer = { name: 'Restack sweep', email: 'restack@example.test', date: '2030-01-02T03:04:05Z' };
const deadOwner = { host: 'dead-recovery-host', pid: 1, processStartTime: '0' };
const CHANGED = ['src/a.ts', 'src/b.ts', 'src/c.ts'] as const;

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

function childId(value: number): ChildId {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`child ${value} should parse`);
  return parsed;
}

/**
 * Child 1 (closed) and child 2 (active, checked out) over a default branch
 * whose advance rewrites the three `src/*.ts` paths.
 */
async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-refusals-sweep-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commitFiles = async (message: string, files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(repo, path, '..'), { recursive: true });
      await writeFile(join(repo, path), content);
      await git(['add', path]);
    }
    await git(['commit', '-qm', message]);
    return sha((await git(['rev-parse', 'HEAD'])).stdout);
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', committer.email]);
  await git(['config', 'user.name', committer.name]);
  const base = await commitFiles('base', {
    '.gitignore': '.pipeline/\n',
    'src/a.ts': 'a old\n',
    'src/b.ts': 'b old\n',
    'src/c.ts': 'c old\n',
  });
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await commitFiles('child 1', { 'c1.txt': 'c1\n' });
  await git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  const c2 = await commitFiles('child 2', { 'c2.txt': 'c2\n' });
  await git(['checkout', '-q', 'main']);
  const advanced = await commitFiles('advance', { 'src/a.ts': 'a new\n', 'src/b.ts': 'b new\n', 'src/c.ts': 'c new\n' });
  await git(['checkout', '-q', 'feat/c2/demo']);

  const one = childId(1);
  const two = childId(2);
  const runner = makeGitRunner(repo);
  const replay1 = await replayChildRange({ child: one, oldParent: base, oldTip: c1, kind: 'closed' }, advanced, committer, runner);
  const replay2 = await replayChildRange({ child: two, oldParent: c1, oldTip: c2, kind: 'active' }, replay1.tip, committer, runner);
  await pinStagingRef(repo, 'demo', one, replay1.tip);
  await pinStagingRef(repo, 'demo', two, replay2.tip);
  const journal = (state: RestackJournal['state'], opId: string): RestackJournal => ({
    opId: opId as RestackOpId,
    cause: 'base-refresh',
    committer,
    dirtyPaths: [],
    refs: [
      { ref: 'refs/heads/feat/c1/demo' as never, oldSha: c1 },
      { ref: 'refs/conductor/demo/closed/c1' as never, oldSha: c1 },
      { ref: 'refs/heads/feat/c2/demo' as never, oldSha: c2 },
    ],
    ranges: [
      { child: one, oldParent: base, oldTip: c1, kind: 'closed' },
      { child: two, oldParent: c1, oldTip: c2, kind: 'active' },
    ],
    children: [{ child: one, status: 'replayed' }, { child: two, status: 'replayed' }],
    state,
    owner: deadOwner,
  });
  const snapshot = async () => (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout;
  const live = async (name: string) => (await git(['rev-parse', name])).stdout.trim();
  return { repo, git, base, c1, c2, advanced, new1: replay1.tip, new2: replay2.tip, journal, snapshot, live };
}

type Subject = Awaited<ReturnType<typeof fixture>>;

/** Leave a dead owner's journal at `moved`: every ref moved, worktree not yet synchronised. */
async function crashAtMoved(subject: Subject): Promise<void> {
  const blob = await writeRestackJournalBlob(subject.repo, subject.journal('moved', 'sweep-moved'));
  await subject.git(['update-ref', 'refs/heads/feat/c1/demo', subject.new1, subject.c1]);
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', subject.new1, subject.c1]);
  await subject.git(['update-ref', 'refs/heads/feat/c2/demo', subject.new2, subject.c2]);
  await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
}

async function crashAtReady(subject: Subject): Promise<void> {
  const blob = await writeRestackJournalBlob(subject.repo, subject.journal('ready', 'sweep-ready'));
  await subject.git(['update-ref', journalRefFor('demo'), blob, '']);
}

async function recover(subject: Subject) {
  return recoverRestackJournal({ worktree: subject.repo, slug: 'demo', git: makeGitRunner(subject.repo) });
}

async function halt(subject: Subject): Promise<{ body: string; haltClass: string }> {
  const [body, haltClass] = await Promise.all([
    readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8'),
    readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8'),
  ]);
  return { body, haltClass };
}

async function expectRefsAtOldSide(subject: Subject): Promise<void> {
  expect(await subject.live('refs/heads/feat/c1/demo')).toBe(subject.c1);
  expect(await subject.live('refs/conductor/demo/closed/c1')).toBe(subject.c1);
  expect(await subject.live('refs/heads/feat/c2/demo')).toBe(subject.c2);
}

describe('recoverRestackJournal refusal paths, sweep (real local Git)', () => {
  // Covers: task:25
  it('half-applied sync recovery preserves an operator edit to src/a.ts and rolls back, but completes old-blob paths and leaves new-blob paths alone', async () => {
    // A dead owner moved the refs and its read-tree had written src/c.ts only.
    const edited = await fixture();
    await crashAtMoved(edited);
    await writeFile(join(edited.repo, 'src/a.ts'), 'operator edit\n');
    await writeFile(join(edited.repo, 'src/c.ts'), 'c new\n');

    await expect(recover(edited)).resolves.toEqual({ kind: 'recovered', fromState: 'moved' });

    await expect(readFile(join(edited.repo, 'src/a.ts'), 'utf8')).resolves.toBe('operator edit\n');
    await expectRefsAtOldSide(edited);
    expect(await readRestackJournal(edited.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    const refused = await halt(edited);
    expect(refused.haltClass).toBe('needs-human');
    expect(refused.body).toContain('src/a.ts');
    expect(refused.body).not.toContain('src/b.ts');
    expect(refused.body).not.toContain('src/c.ts');

    // Without an operator edit, the same half-applied sync completes path by path.
    const clean = await fixture();
    await crashAtMoved(clean);
    await writeFile(join(clean.repo, 'src/c.ts'), 'c new\n');
    const alreadyNew = await stat(join(clean.repo, 'src/c.ts'));

    await expect(recover(clean)).resolves.toEqual({ kind: 'recovered', fromState: 'moved' });

    for (const path of CHANGED) {
      const letter = path.slice('src/'.length, 'src/'.length + 1);
      await expect(readFile(join(clean.repo, path), 'utf8')).resolves.toBe(`${letter} new\n`);
    }
    const afterRecovery = await stat(join(clean.repo, 'src/c.ts'));
    expect({ ino: afterRecovery.ino, mtimeMs: afterRecovery.mtimeMs }).toEqual({ ino: alreadyNew.ino, mtimeMs: alreadyNew.mtimeMs });
    expect(await clean.live('refs/heads/feat/c2/demo')).toBe(clean.new2);
    expect((await clean.git(['status', '--porcelain', '--untracked-files=no'])).stdout).toBe('');
    await expect(readFile(join(clean.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:25
  it('a ready journal whose pending move overlaps a new uncommitted edit is aborted with every ref left where it was', async () => {
    const subject = await fixture();
    await crashAtReady(subject);
    await writeFile(join(subject.repo, 'src/b.ts'), 'operator edit\n');
    const before = await subject.snapshot();

    await expect(recover(subject)).resolves.toEqual({ kind: 'recovered', fromState: 'ready' });

    expect(await readRestackJournal(subject.repo, 'demo')).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    const after = await subject.snapshot();
    // Only the journal ref itself changes (ready -> aborted).
    const withoutJournal = (refs: string) => refs.split('\n').filter((line) => !line.startsWith(`${journalRefFor('demo')} `)).join('\n');
    expect(withoutJournal(after)).toBe(withoutJournal(before));
    await expectRefsAtOldSide(subject);
    await expect(readFile(join(subject.repo, 'src/b.ts'), 'utf8')).resolves.toBe('operator edit\n');
    const refused = await halt(subject);
    expect(refused.haltClass).toBe('needs-human');
    expect(refused.body).toContain('dirty-overlap');
  });

  // Covers: task:25
  it('an unreadable journal blob halts needs-human listing the journal ref and every child branch, closure and staging ref with its live value, moving nothing', async () => {
    const subject = await fixture();
    await writeFile(join(subject.repo, 'corrupt-journal.json'), '{not json');
    const bad = sha((await subject.git(['hash-object', '-w', 'corrupt-journal.json'])).stdout);
    await subject.git(['update-ref', journalRefFor('demo'), bad, '']);
    // A different feature's refs are not this feature's durable state.
    await subject.git(['update-ref', 'refs/heads/feat/c1/other', subject.c1]);
    const before = await subject.snapshot();

    const result = await recover(subject);

    expect(result).toEqual({ kind: 'unavailable', detail: `cannot read restack journal ${journalRefFor('demo')}` });
    expect(await subject.snapshot()).toBe(before);
    const refused = await halt(subject);
    expect(refused.haltClass).toBe('needs-human');
    for (const [name, value] of [
      [journalRefFor('demo'), bad],
      ['refs/heads/feat/c1/demo', subject.c1],
      ['refs/heads/feat/c2/demo', subject.c2],
      ['refs/conductor/demo/closed/c1', subject.c1],
      ['refs/conductor/demo/restack/staging/c1', subject.new1],
      ['refs/conductor/demo/restack/staging/c2', subject.new2],
    ] as const) {
      expect(refused.body).toContain(`${name} ${value}`);
    }
    expect(refused.body).not.toContain('refs/heads/feat/c1/other');
  });

  // Covers: task:25
  it('live refs on neither journaled side halt needs-human naming every journaled ref and live value, while halt-record-only commits past the new tip count as the new side', async () => {
    const divergent = await fixture();
    await crashAtMoved(divergent);
    await divergent.git(['reset', '--hard', '-q', divergent.new2]);
    await writeFile(join(divergent.repo, 'rogue.txt'), 'operator commit\n');
    await divergent.git(['add', 'rogue.txt']);
    await divergent.git(['commit', '-qm', 'operator commit']);
    const rogue = await divergent.live('HEAD');
    const before = await divergent.snapshot();

    await expect(recover(divergent)).resolves.toEqual({ kind: 'unavailable', detail: 'journaled refs no longer match the moved side' });

    expect(await divergent.snapshot()).toBe(before);
    const refused = await halt(divergent);
    expect(refused.haltClass).toBe('needs-human');
    expect(refused.body).toContain(`refs/heads/feat/c1/demo ${divergent.new1}`);
    expect(refused.body).toContain(`refs/conductor/demo/closed/c1 ${divergent.new1}`);
    expect(refused.body).toContain(`refs/heads/feat/c2/demo ${rogue}`);

    // Same moved journal, but the only commit past the new tip is a halt record.
    const recorded = await fixture();
    await crashAtMoved(recorded);
    await recorded.git(['reset', '--hard', '-q', recorded.new2]);
    await mkdir(join(recorded.repo, '.docs', 'halted'), { recursive: true });
    await writeFile(join(recorded.repo, '.docs', 'halted', 'demo.md'), 'Status: halted\n');
    await recorded.git(['add', '.docs/halted/demo.md']);
    await recorded.git(['commit', '-qm', 'halt record: demo']);
    const recordTip = await recorded.live('HEAD');

    await expect(recover(recorded)).resolves.toEqual({ kind: 'recovered', fromState: 'moved' });

    expect(await recorded.live('refs/heads/feat/c2/demo')).toBe(recordTip);
    expect(await recorded.live('refs/heads/feat/c1/demo')).toBe(recorded.new1);
    expect(await readRestackJournal(recorded.repo, 'demo')).toEqual({ kind: 'missing' });
    await expect(readFile(join(recorded.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
