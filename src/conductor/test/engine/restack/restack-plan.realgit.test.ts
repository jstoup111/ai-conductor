// Covers: task:5
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

describe('planRestackRanges real local Git', () => {
  it('plans only the closed child and existing active branch, without touching unentered leaf refs', async () => {
    const fixture = await oneClosedOneActive();
    const before = await refSnapshot(fixture.git);

    const result = await planRestackRanges(fixture.repo, {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'base-refresh',
      active: { child: fixture.c2, branchRef: fixture.c2Ref, isLeaf: false },
      unenteredLeaf: { child: fixture.leaf, branchRef: fixture.leafRef },
    });

    expect(result.kind).toBe('planned');
    if (result.kind !== 'planned') return;
    expect(result.ranges).toEqual([
      { child: fixture.c1, oldParent: fixture.defaultTip, oldTip: fixture.closed, kind: 'closed' },
      { child: fixture.c2, oldParent: fixture.closed, oldTip: fixture.activeTip, kind: 'active' },
    ]);
    expect(result.originating).toEqual([]);
    expect(await refSnapshot(fixture.git)).toBe(before);
  });

  it('refuses before journaling when an active child no longer contains its journaled parent closure', async () => {
    const fixture = await oneClosedOneActive();
    await fixture.git(['checkout', '-q', fixture.c2Ref.slice('refs/heads/'.length)]);
    await fixture.git(['reset', '--hard', fixture.defaultTip]);
    const before = await refSnapshot(fixture.git);

    const result = await planRestackRanges(fixture.repo, {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'base-refresh',
      active: { child: fixture.c2, branchRef: fixture.c2Ref, isLeaf: false },
    });

    expect(result).toEqual({ kind: 'refused', reason: 'range-not-ancestor', child: fixture.c2 });
    expect(await refSnapshot(fixture.git)).toBe(before);
  });

  it('refuses a closed child whose branch was rewritten below its recorded closure', async () => {
    const fixture = await oneClosedOneActive();
    const c1 = childBranchFor(fixture.slug, fixture.c1);
    if (!c1.ok) throw new Error('invalid fixture branch');
    await fixture.git(['checkout', '-q', c1.branch]);
    await fixture.git(['reset', '--hard', fixture.defaultTip]);
    const before = await refSnapshot(fixture.git);

    const result = await planRestackRanges(fixture.repo, {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'feature-repair',
      active: { child: fixture.c2, branchRef: fixture.c2Ref, isLeaf: false },
    });

    expect(result).toEqual({ kind: 'refused', reason: 'closed-child-rewritten', child: fixture.c1 });
    expect(await refSnapshot(fixture.git)).toBe(before);
  });

  it('includes every repair-originating closed child through its appended commits', async () => {
    const fixture = await twoClosedLeafActive();
    const c1 = childBranchFor(fixture.slug, fixture.c1);
    const c2 = childBranchFor(fixture.slug, fixture.c2);
    if (!c1.ok || !c2.ok) throw new Error('invalid fixture branch');
    await fixture.git(['checkout', '-q', c1.branch]);
    const repairedC1 = await commit(fixture.git, fixture.repo, 'repair-1.txt', 'repair-1\n', 'repair one');
    await fixture.git(['checkout', '-q', c2.branch]);
    const repairedC2 = await commit(fixture.git, fixture.repo, 'repair-2.txt', 'repair-2\n', 'repair two');

    const result = await planRestackRanges(fixture.repo, {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'feature-repair',
      active: { child: fixture.leaf, branchRef: fixture.leafRef, isLeaf: true },
    });

    expect(result.kind).toBe('planned');
    if (result.kind !== 'planned') return;
    expect(result.originating).toEqual([fixture.c1, fixture.c2]);
    expect(result.ranges).toEqual([
      { child: fixture.c1, oldParent: fixture.defaultTip, oldTip: repairedC1, kind: 'closed' },
      { child: fixture.c2, oldParent: fixture.closed, oldTip: repairedC2, kind: 'closed' },
      { child: fixture.leaf, oldParent: fixture.c2Closure, oldTip: fixture.leafTip, kind: 'leaf-active' },
    ]);
  });

  it('excludes halt-record-only commits after a non-originating closed child and returns repair-pending for other commits', async () => {
    const fixture = await twoClosedLeafActive();
    const c2 = childBranchFor(fixture.slug, fixture.c2);
    if (!c2.ok) throw new Error('invalid fixture branch');
    await fixture.git(['checkout', '-q', c2.branch]);
    await mkdir(join(fixture.repo, '.docs', 'halted'), { recursive: true });
    await commit(fixture.git, fixture.repo, `.docs/halted/${fixture.slug}.md`, 'halt\n', 'halt record');
    const haltOnly = await planRestackRanges(fixture.repo, {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'base-refresh',
      active: { child: fixture.leaf, branchRef: fixture.leafRef, isLeaf: true },
    });
    expect(haltOnly.kind).toBe('planned');
    if (haltOnly.kind !== 'planned') return;
    expect(haltOnly.ranges).toContainEqual({ child: fixture.c2, oldParent: fixture.closed, oldTip: fixture.c2Closure, kind: 'closed' });

    await commit(fixture.git, fixture.repo, 'operator.txt', 'operator\n', 'operator append');
    const before = await refSnapshot(fixture.git);

    const result = await planRestackRanges(fixture.repo, {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'base-refresh',
      active: { child: fixture.leaf, branchRef: fixture.leafRef, isLeaf: true },
    });

    expect(result).toEqual({ kind: 'repair-pending', child: fixture.c2 });
    expect(await refSnapshot(fixture.git)).toBe(before);
  });

  it('includes an unentered leaf only when its tip lies inside a moved child range', async () => {
    const fixture = await oneClosedOneActive();
    const c1 = childBranchFor(fixture.slug, fixture.c1);
    if (!c1.ok) throw new Error('invalid fixture branch');
    const c1Commit = sha((await fixture.git(['rev-parse', `refs/heads/${c1.branch}`])).stdout.trim());
    await fixture.git(['branch', '-f', fixture.leafRef.slice('refs/heads/'.length), c1Commit]);

    const included = await planRestackRanges(fixture.repo, {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'base-refresh',
      active: { child: fixture.c2, branchRef: fixture.c2Ref, isLeaf: false },
      unenteredLeaf: { child: fixture.leaf, branchRef: fixture.leafRef },
    });
    expect(included.kind).toBe('planned');
    if (included.kind !== 'planned') return;
    expect(included.ranges.at(-1)).toEqual({ child: fixture.leaf, oldParent: c1Commit, oldTip: c1Commit, kind: 'leaf-unentered' });

    await fixture.git(['branch', '-f', fixture.leafRef.slice('refs/heads/'.length), fixture.defaultTip]);
    const excluded = await planRestackRanges(fixture.repo, {
      slug: fixture.slug,
      oldDefaultTip: fixture.defaultTip,
      cause: 'base-refresh',
      active: { child: fixture.c2, branchRef: fixture.c2Ref, isLeaf: false },
      unenteredLeaf: { child: fixture.leaf, branchRef: fixture.leafRef },
    });
    expect(excluded.kind).toBe('planned');
    if (excluded.kind !== 'planned') return;
    expect(excluded.ranges.map((range) => range.child)).toEqual([fixture.c1, fixture.c2]);
  });
});
