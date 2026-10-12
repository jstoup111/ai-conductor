import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { childBranchFor, leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { planRestackRanges } from '../../../src/engine/restack/restack-plan.js';
import { parseCommitSha, parseRefName, type CommitSha, type RefName } from '../../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function child(number: number) {
  const value = parseChildId(number);
  if (value === undefined) throw new Error(`invalid child ${number}`);
  return value;
}

function sha(raw: string): CommitSha {
  const value = parseCommitSha(raw);
  if (value === undefined) throw new Error(`invalid SHA ${raw}`);
  return value;
}

function ref(raw: string): RefName {
  const value = parseRefName(raw);
  if (value === undefined) throw new Error(`invalid ref ${raw}`);
  return value;
}

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), 'restack-plan-'));
  repos.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.invalid']);
  await git(['config', 'user.name', 'Restack planner']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);
  return { repo, git };
}

async function commit(git: (args: string[]) => ReturnType<typeof execFile>, repo: string, path: string, contents: string, message: string) {
  await writeFile(join(repo, path), contents);
  await git(['add', path]);
  await git(['commit', '-qm', message]);
  return sha(String((await git(['rev-parse', 'HEAD'])).stdout).trim());
}

async function refSnapshot(git: (args: string[]) => ReturnType<typeof execFile>) {
  return (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout;
}

async function oneClosedOneActive() {
  const fixture = await createRepo();
  const { repo, git } = fixture;
  const slug = 'demo';
  const c1 = childBranchFor(slug, 1);
  const c2 = childBranchFor(slug, 2);
  if (!c1.ok || !c2.ok) throw new Error('invalid fixture branch');
  const defaultTip = sha((await git(['rev-parse', 'main'])).stdout.trim());
  await git(['checkout', '-qb', c1.branch, 'main']);
  await commit(git, repo, 'c1.txt', 'c1\n', 'c1');
  const closed = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['update-ref', `refs/conductor/${slug}/closed/c1`, closed]);
  await git(['checkout', '-qb', c2.branch, closed]);
  await commit(git, repo, 'c2.txt', 'c2\n', 'c2');
  const activeTip = sha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  await git(['branch', leafBranchFor(slug), defaultTip]);
  return { ...fixture, slug, defaultTip, closed, activeTip, c1: child(1), c2: child(2), leaf: child(3), c2Ref: ref(`refs/heads/${c2.branch}`), leafRef: ref(`refs/heads/${leafBranchFor(slug)}`) };
}

async function twoClosedLeafActive() {
  const fixture = await oneClosedOneActive();
  await fixture.git(['update-ref', `refs/conductor/${fixture.slug}/closed/c2`, fixture.activeTip]);
  await fixture.git(['checkout', '-q', 'main']);
  await fixture.git(['branch', '-f', fixture.leafRef.slice('refs/heads/'.length), fixture.activeTip]);
  await fixture.git(['checkout', '-q', fixture.leafRef.slice('refs/heads/'.length)]);
  const leafTip = await commit(fixture.git, fixture.repo, 'leaf.txt', 'leaf\n', 'leaf');
  return { ...fixture, c2Closure: fixture.activeTip, leafTip };
}

async function haltRecord(fixture: Awaited<ReturnType<typeof createRepo>>, slug: string, message: string) {
  await mkdir(join(fixture.repo, '.docs', 'halted'), { recursive: true });
  return commit(fixture.git, fixture.repo, `.docs/halted/${slug}.md`, `${message}\n`, message);
}

async function rangeCommits(git: (args: string[]) => ReturnType<typeof execFile>, range: { oldParent: string; oldTip: string }) {
  return String((await git(['rev-list', `${range.oldParent}..${range.oldTip}`])).stdout).split('\n').filter(Boolean);
}

describe('planRestackRanges repair and leaf planning (sweep G1, real local Git)', () => {
  // Covers: S1.14, task:5
  it('plans every repair origin through its appended and halt-record commits, excludes a halt-record-only moved child, and returns repair-pending otherwise', async () => {
    const fixture = await twoClosedLeafActive();
    const c1 = childBranchFor(fixture.slug, fixture.c1);
    const c2 = childBranchFor(fixture.slug, fixture.c2);
    if (!c1.ok || !c2.ok) throw new Error('invalid fixture branch');
    await fixture.git(['checkout', '-q', c1.branch]);
    const repair = await commit(fixture.git, fixture.repo, 'repair-1.txt', 'repair\n', 'repair one');
    const repairHalt = await haltRecord(fixture, fixture.slug, 'halt record on the origin');
    await fixture.git(['checkout', '-q', c2.branch]);
    const otherHalt = await haltRecord(fixture, fixture.slug, 'halt record on a moved child');
    const before = await refSnapshot(fixture.git);
    const options = {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'feature-repair' as const,
      active: { child: fixture.leaf, branchRef: fixture.leafRef, isLeaf: true },
    };

    const planned = await planRestackRanges(fixture.repo, options);
    expect(planned.kind).toBe('planned');
    if (planned.kind !== 'planned') return;
    expect(planned.originating).toEqual([fixture.c1]);
    expect(planned.ranges).toEqual([
      { child: fixture.c1, oldParent: fixture.defaultTip, oldTip: repairHalt, kind: 'closed' },
      { child: fixture.c2, oldParent: fixture.closed, oldTip: fixture.c2Closure, kind: 'closed' },
      { child: fixture.leaf, oldParent: fixture.c2Closure, oldTip: fixture.leafTip, kind: 'leaf-active' },
    ]);
    expect(await rangeCommits(fixture.git, planned.ranges[0]!)).toEqual(expect.arrayContaining([repair, repairHalt]));
    for (const range of planned.ranges) expect(await rangeCommits(fixture.git, range)).not.toContain(otherHalt);
    expect(await refSnapshot(fixture.git)).toBe(before);

    // A two-origin repair: every closed child with appended work is an origin.
    const repairTwo = await commit(fixture.git, fixture.repo, 'repair-2.txt', 'repair two\n', 'repair two');
    const twoOrigins = await planRestackRanges(fixture.repo, options);
    expect(twoOrigins.kind).toBe('planned');
    if (twoOrigins.kind !== 'planned') return;
    expect(twoOrigins.originating).toEqual([fixture.c1, fixture.c2]);
    expect(twoOrigins.ranges[1]).toEqual({ child: fixture.c2, oldParent: fixture.closed, oldTip: repairTwo, kind: 'closed' });

    // Outside a repair, the same non-halt-record commit past a moved child's closure is repair-pending.
    const beforePending = await refSnapshot(fixture.git);
    expect(await planRestackRanges(fixture.repo, { ...options, cause: 'base-refresh' })).toEqual({ kind: 'repair-pending', child: fixture.c1 });
    expect(await refSnapshot(fixture.git)).toBe(beforePending);
    await expect(fixture.git(['rev-parse', '--verify', `refs/conductor/${fixture.slug}/restack/journal`])).rejects.toBeDefined();
  });

  // Covers: S1.10, task:5
  it('plans an unentered leaf at a commit inside child 1 for rewrite and leaves out a leaf carrying a commit outside every moved range', async () => {
    const fixture = await oneClosedOneActive();
    const c1 = childBranchFor(fixture.slug, fixture.c1);
    if (!c1.ok) throw new Error('invalid fixture branch');
    await fixture.git(['checkout', '-q', c1.branch]);
    const h = await haltRecord(fixture, fixture.slug, 'pre-region halt record');
    const c1Tip = await commit(fixture.git, fixture.repo, 'c1-more.txt', 'more\n', 'c1 more');
    await fixture.git(['update-ref', `refs/conductor/${fixture.slug}/closed/c1`, c1Tip]);
    await fixture.git(['checkout', '-q', fixture.c2Ref.slice('refs/heads/'.length)]);
    await fixture.git(['rebase', '-q', c1Tip]);
    const activeTip = sha(String((await fixture.git(['rev-parse', 'HEAD'])).stdout).trim());
    const leafBranch = fixture.leafRef.slice('refs/heads/'.length);
    await fixture.git(['branch', '-f', leafBranch, h]);
    const options = {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'base-refresh' as const,
      active: { child: fixture.c2, branchRef: fixture.c2Ref, isLeaf: false },
      unenteredLeaf: { child: fixture.leaf, branchRef: fixture.leafRef },
    };

    const inside = await planRestackRanges(fixture.repo, options);
    expect(inside).toEqual({
      kind: 'planned',
      originating: [],
      ranges: [
        { child: fixture.c1, oldParent: fixture.defaultTip, oldTip: c1Tip, kind: 'closed' },
        { child: fixture.c2, oldParent: c1Tip, oldTip: activeTip, kind: 'active' },
        { child: fixture.leaf, oldParent: h, oldTip: h, kind: 'leaf-unentered' },
      ],
    });

    await fixture.git(['checkout', '-q', '-b', 'leaf-outside', h]);
    const outside = await commit(fixture.git, fixture.repo, 'outside.txt', 'outside\n', 'leaf commit outside every range');
    await fixture.git(['branch', '-f', leafBranch, outside]);
    const excluded = await planRestackRanges(fixture.repo, options);
    expect(excluded.kind).toBe('planned');
    if (excluded.kind !== 'planned') return;
    expect(excluded.ranges.map((range) => range.child)).toEqual([fixture.c1, fixture.c2]);
    expect(sha(String((await fixture.git(['rev-parse', fixture.leafRef])).stdout).trim())).toBe(outside);
  });
});
