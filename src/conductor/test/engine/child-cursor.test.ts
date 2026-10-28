// Covers: task:2, task:4, task:5, task:20, task:29, task:rem-as-built-1-r2, task:rem-as-built-rem-asbuilt-b00b54a4-1-r1, task:rem-as-built-rem-as-built-rem-v4-n1-push-argv, task:rem-as-built-rem-asbuilt-d1-durable-ref-detection, task:rem-prd-audit-rem-s1-1-exclude-leaf-push-receipts
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasDurableChildState, resolveActiveChild, resolveChildBase, resolveSealedFirst, resolveSealedLeaf } from '../../src/engine/child-cursor.js';
import { observeStackDimension } from '../../src/engine/stack-publication.js';
import { loadSliceTopology } from '../../src/engine/slice-topology.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { GitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);

let repository: string;
const linkedWorktrees: string[] = [];

async function git(args: string[], cwd = repository): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function seal(
  worktree: string,
  positions: readonly number[],
  status: 'done' | 'failed' = 'done',
  storyOwnership = true,
): Promise<void> {
  void status;
  void storyOwnership;
  await writeTopology(worktree, positions);
  if (positions.length > 1) await recordPositions(worktree, positions);
}

async function configureStacked(worktree: string, enabled: boolean): Promise<void> {
  await mkdir(join(worktree, '.ai-conductor'), { recursive: true });
  await writeFile(join(worktree, '.ai-conductor', 'config.yml'), `stacked_prs:\n  enabled: ${enabled}\n  max_slices: 3\n`);
}

function slicedPlan(positions: readonly number[]): string {
  const rows = positions.map((position) => `| ${position} | Child ${position} | ${position} |`);
  const tasks = positions.flatMap((position) => [
    `### Task ${position}: Child ${position}`,
    `**Story:** Story ${position}`,
    '**Dependencies:** none',
    '',
  ]);
  return [
    '# Implementation Plan: demo', '', '**Stories:** .docs/stories/demo.md', '', '## Slices', '',
    '| Slice | Title | Tasks |', '| --- | --- | --- |', ...rows, '', ...tasks,
  ].join('\n');
}

async function writeTopology(worktree: string, positions: readonly number[], enabled?: boolean): Promise<void> {
  await Promise.all([
    ...(enabled === undefined ? [] : [configureStacked(worktree, enabled)]),
    mkdir(join(worktree, '.docs', 'plans'), { recursive: true }),
    mkdir(join(worktree, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktree, '.docs', 'complexity'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(worktree, '.docs', 'plans', 'demo.md'), slicedPlan(positions)),
    writeFile(join(worktree, '.docs', 'stories', 'demo.md'), positions.map((position) => `## Story ${position}: Child ${position}`).join('\n\n')),
    writeFile(join(worktree, '.docs', 'complexity', 'demo.md'), 'Tier: M\nStacked-Delivery: approved\n'),
  ]);
}

async function recordPositions(worktree: string, positions: readonly number[]): Promise<void> {
  const path = join(worktree, 'positions.json');
  await writeFile(path, JSON.stringify(positions));
  const blob = (await git(['hash-object', '-w', path], worktree)).trim();
  await git(['update-ref', 'refs/conductor/demo/positions', blob], worktree);
}

async function createLinkedLeafWorktree(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `child-cursor-${label}-`));
  await rm(path, { recursive: true, force: true });
  await git(['worktree', 'add', path, 'feat/daemon-demo']);
  linkedWorktrees.push(path);
  return path;
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'child-cursor-repository-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'cursor@example.test']);
  await git(['config', 'user.name', 'Cursor test']);
  await writeFile(join(repository, 'README.md'), 'base\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'base']);
  await git(['branch', 'feat/daemon-demo']);
});

afterEach(async () => {
  await Promise.all(linkedWorktrees.splice(0).map(async (path) => {
    await git(['worktree', 'remove', '--force', path]).catch(() => undefined);
    await rm(path, { recursive: true, force: true });
  }));
  await rm(repository, { recursive: true, force: true });
});

describe('resolveActiveChild', () => {
  // Covers: task:2
  it('resolves a two-child stack from sealed topology with no coverage envelope', async () => {
    await writeTopology(repository, [1, 2], true);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', tip]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);
    await recordPositions(repository, [1, 2]);
    await git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo',
    });
    await expect(resolveSealedFirst(repository)).resolves.toBe(1);
    await expect(resolveSealedLeaf(repository)).resolves.toBe(2);
    await expect(resolveChildBase(repository, 'demo', parseChildId(2)!)).resolves.toMatchObject({ kind: 'parent', parent: 1, sha: tip });
  });

  // Covers: task:2
  it('keeps a durable stack active when stacked delivery is later disabled', async () => {
    await writeTopology(repository, [1, 2], false);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', tip]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);
    await recordPositions(repository, [1, 2]);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toMatchObject({ kind: 'active', child: 2 });
    await expect(loadSliceTopology(repository, 'demo')).resolves.toMatchObject({
      kind: 'sliced', storyOwnership: { '2': 2 },
    });
  });

  // Covers: task:2
  it('carries a changed positions cause when durable stack topology cannot resolve', async () => {
    await writeTopology(repository, [1, 3], true);
    await recordPositions(repository, [1, 2]);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'topology-unavailable', cause: 'positions-changed',
      planPath: '.docs/plans/demo.md', recordedPositions: [1, 2], planPositions: [1, 3],
    });
  });

  it.each([
    ['an unsliced plan', '# Implementation Plan: demo\n\n### Task 1: Flat\n**Dependencies:** none\n', []],
    ['a singleton plan', undefined, [1]],
  ] as const)('does not resolve %s as no-child after a two-child stack was sealed', async (_label, plan, proposed) => {
    await writeTopology(repository, plan === undefined ? [1] : [1, 2], true);
    if (plan !== undefined) await writeFile(join(repository, '.docs', 'plans', 'demo.md'), plan);
    await recordPositions(repository, [1, 2]);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'topology-unavailable', cause: 'positions-changed',
      planPath: '.docs/plans/demo.md', recordedPositions: [1, 2], planPositions: proposed,
    });
  });

  // Covers: task:2
  it('keeps a flat feature on the no-child path', async () => {
    await mkdir(join(repository, '.docs', 'plans'), { recursive: true });
    await writeFile(join(repository, '.docs', 'plans', 'demo.md'), '# Implementation Plan: demo\n\n### Task 1: Flat\n**Dependencies:** none\n');

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'no-child' });
  });

  it('retains stacked protection from conductor refs after disposable child metadata is gone', async () => {
    await rm(join(repository, '.pipeline', 'children'), { recursive: true, force: true });
    const tip = (await git(['rev-parse', 'HEAD'])).trim();
    await git(['update-ref', 'refs/conductor/demo/publication', tip]);

    await expect(hasDurableChildState(repository, 'demo')).resolves.toBe(true);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'topology-unavailable', cause: 'plan-missing', planPath: '.docs/plans/demo.md' });
  });

  // Covers: S1.1
  it('keeps the active child after a positions-preserving DECIDE amendment, with no rebinding step to wait on', async () => {
    await writeTopology(repository, [1, 2], true);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', tip]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);
    await recordPositions(repository, [1, 2]);
    await writeFile(join(repository, '.docs', 'plans', 'demo.md'), `${slicedPlan([1, 2])}\nOperator clarified the leaf scope.\n`);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo',
    });
  });

  // Covers: task:rem-prd-audit-rem-s1-2-not-applicable-after-leaf-push
  it('keeps an ordinary N=1 feature flat after its leaf pushed-tip receipt is recorded', async () => {
    const tip = (await git(['rev-parse', 'HEAD'])).trim();
    // Every N=1 daemon push records a pushed-tip receipt; routing owns its own refs.
    await git(['update-ref', 'refs/conductor/demo/pushed/feat/daemon-demo', tip]);
    await git(['update-ref', 'refs/conductor/demo/push-intent/feat/daemon-demo', tip]);
    await git(['update-ref', 'refs/conductor/demo/routes/1', tip]);
    await git(['update-ref', 'refs/conductor/demo/rejected/1/1', tip]);
    await git(['update-ref', 'refs/conductor/demo/revalidate', tip]);

    await expect(hasDurableChildState(repository, 'demo')).resolves.toBe(false);
    const cursor = await resolveActiveChild(repository, 'demo');
    expect(cursor).toEqual({ kind: 'no-child' });
    await expect(observeStackDimension(repository, 'demo', cursor)).resolves.toBe('not-applicable');
  });

  it.each([
    ['refs/conductor/demo/positions', 'plan-missing'],
    ['refs/conductor/demo/publication', 'plan-missing'],
    ['refs/conductor/demo/closed/c1', 'plan-missing'],
    ['refs/conductor/demo/pushed/feat/c1/demo', 'plan-missing'],
    ['refs/conductor/demo/push-intent/feat/c1/demo', 'plan-missing'],
  ])('keeps the stack guard on for a recreated worktree holding only %s', async (ref, cause) => {
    const tip = (await git(['rev-parse', 'HEAD'])).trim();
    await git(['update-ref', 'refs/conductor/demo/pushed/feat/daemon-demo', tip]);
    await git(['update-ref', ref, tip]);

    await expect(hasDurableChildState(repository, 'demo')).resolves.toBe(true);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'topology-unavailable', cause, planPath: '.docs/plans/demo.md' });
  });

  it('selects the leaf after every non-leaf closure, independent of the checked-out branch', async () => {
    await seal(repository, [1, 2]);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);
    await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);
    await git(['checkout', '-q', 'feat/c1/demo']);

    expect(await resolveActiveChild(repository, 'demo')).toEqual({
      kind: 'active', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo',
    });
  });

  it('selects the lowest unclosed child even when its branch starts at the leaf tip', async () => {
    await seal(repository, [1, 2]);
    await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);

    expect(await resolveActiveChild(repository, 'demo')).toEqual({
      kind: 'active', child: 1, position: 1, isLeaf: false, branch: 'feat/c1/demo', nextChild: 2,
    });
  });

  it('allows the next intermediate branch to be absent until lifecycle entry creates it', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1, 2, 3]);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', tip]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 2, position: 2, isLeaf: false, branch: 'feat/c2/demo', nextChild: 3,
    });
  });

  it('treats an empty non-leaf closure as closed and leaves the leaf active', async () => {
    await seal(repository, [1, 2]);
    const parentTip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c1', parentTip]);

    expect(await resolveActiveChild(repository, 'demo')).toEqual({
      kind: 'active', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo',
    });
  });

  it('uses declared positions rather than synthesizing a child for a gap', async () => {
    await seal(repository, [1, 3]);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);

    expect(await resolveActiveChild(repository, 'demo')).toEqual({
      kind: 'active', child: 3, position: 3, isLeaf: true, branch: 'feat/daemon-demo',
    });
  });

  it('activates a child from the sealed plan without an envelope status', async () => {
    await seal(repository, [1, 2], 'failed');

    await expect(resolveActiveChild(repository, 'demo')).resolves.toMatchObject({ kind: 'active', child: 1 });
  });

  it('does not treat a noncanonical closure ref as a closure for a declared child', async () => {
    await seal(repository, [1, 2]);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c01', tip]);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 1, position: 1, isLeaf: false, branch: 'feat/c1/demo', nextChild: 2,
    });
  });

  it('keeps closure-derived selection after a linked worktree is removed, recreated, and resealed', async () => {
    const first = await createLinkedLeafWorktree('first');
    await seal(first, [1, 2]);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'], first)).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip], first);
    const before = await resolveActiveChild(first, 'demo');

    await git(['worktree', 'remove', '--force', first]);
    linkedWorktrees.splice(linkedWorktrees.indexOf(first), 1);
    const recreated = await createLinkedLeafWorktree('recreated');
    await seal(recreated, [1, 2]);

    await expect(resolveActiveChild(recreated, 'demo')).resolves.toEqual(before);
  });

  it('reports repair-pending when a closed child has a non-halt commit after its closure', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1, 2]);
    const closure = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', closure]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await git(['checkout', '-q', 'feat/c1/demo']);
    await writeFile(join(repository, 'child-change.txt'), 'needs restack\n');
    await git(['add', 'child-change.txt']);
    await git(['commit', '-qm', 'child drift']);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'repair-pending', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [1],
    });
  });

  it('reports closed-child-rewritten when a closed child is reset behind its closure', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1, 2]);
    await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);
    await git(['checkout', '-q', 'feat/c1/demo']);
    await writeFile(join(repository, 'closed-change.txt'), 'closed\n');
    await git(['add', 'closed-change.txt']);
    await git(['commit', '-qm', 'closed child change']);
    const closure = (await git(['rev-parse', 'HEAD'])).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await git(['reset', '--hard', 'HEAD^']);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'divergent', child: 1, check: 'closed-child-rewritten',
    });
  });

  it('fails closed as divergent when a closure is not an ancestor of the next non-leaf child', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1, 2, 3]);
    const closure = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', closure]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    const unrelatedTip = (await git(['commit-tree', `${closure}^{tree}`, '-m', 'unrelated child base'])).trim();
    await git(['branch', 'feat/c2/demo', unrelatedTip]);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'divergent', child: 2, check: 'range-not-ancestor',
    });
  });

  it('detects ref-only child state without disposable metadata, then fails closed for sealed child state errors', async () => {
    await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'topology-unavailable', cause: 'plan-missing', planPath: '.docs/plans/demo.md' });

    await configureStacked(repository, true);
    await seal(repository, [1, 2]);
    await git(['checkout', '-q', '--detach']);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'detached-head' });

    const failingGit: GitRunner = async () => ({ exitCode: 1, stdout: '', stderr: 'git unavailable' });
    await expect(resolveActiveChild(repository, 'demo', { git: failingGit })).resolves.toEqual({ kind: 'git-error' });
  });

  it('returns no-child only when no child artifacts exist and stack eligibility is absent', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1]);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'no-child' });

    await configureStacked(repository, false);
    await seal(repository, [1, 2]);
    await git(['update-ref', '-d', 'refs/conductor/demo/positions']);
    await writeFile(join(repository, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: false\n  max_slices: 1\n');
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'no-child' });

    await configureStacked(repository, true);
    await seal(repository, [1, 2], 'done', false);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toMatchObject({ kind: 'active', child: 1 });
  });

  it('keeps child state active even when stacked delivery is now disabled', async () => {
    await configureStacked(repository, false);
    await seal(repository, [1, 2]);
    await mkdir(join(repository, '.pipeline', 'children', '1'), { recursive: true });

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 1, position: 1, isLeaf: false, branch: 'feat/c1/demo', nextChild: 2,
    });
  });

  it('recognizes surviving child branches and closure refs without a children directory', async () => {
    await configureStacked(repository, false);
    await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);

    await expect(hasDurableChildState(repository, 'demo')).resolves.toBe(true);
  });

  it('keeps a non-Git N=1 fixture on the flat path when no child state exists', async () => {
    const nonGitRoot = await mkdtemp(join(tmpdir(), 'child-cursor-non-git-'));
    try {
      await expect(hasDurableChildState(nonGitRoot, 'demo')).resolves.toBe(false);
    } finally {
      await rm(nonGitRoot, { recursive: true, force: true });
    }
  });

  it('writes the in-flight leaf marker when the leaf already contains the last closure rewrite image', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1, 2]);
    const closure = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', closure]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await git(['checkout', '-q', 'feat/daemon-demo']);
    await writeFile(join(repository, 'leaf-rebased.txt'), 'new base\n');
    await git(['add', 'leaf-rebased.txt']);
    await git(['commit', '-qm', 'leaf rebase image']);
    const translatedClosure = (await git(['rev-parse', 'HEAD'])).trim();
    await mkdir(join(repository, '.pipeline'), { recursive: true });
    await writeFile(join(repository, '.pipeline', 'rebase-rewrites.json'), JSON.stringify({ [closure]: translatedClosure }));
    await git(['checkout', '-q', 'feat/c1/demo']);
    await mkdir(join(repository, '.docs', 'halted'), { recursive: true });
    await writeFile(join(repository, '.docs', 'halted', 'demo.md'), 'halt record\n');
    await git(['add', '.docs/halted/demo.md']);
    await git(['commit', '-qm', 'record halt']);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo', leafMovePending: false,
    });
    await expect(git(['rev-parse', '--verify', 'refs/conductor/demo/leaf-moved']))
      .resolves.toBe(`${translatedClosure}\n`);
  });

  it('keeps the leaf move pending when a rewrite map exists but the leaf was left in place', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1, 2]);
    const closure = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', closure]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await git(['checkout', '-q', 'main']);
    await writeFile(join(repository, 'base-refresh.txt'), 'new base\n');
    await git(['add', 'base-refresh.txt']);
    await git(['commit', '-qm', 'base refresh image']);
    const translatedClosure = (await git(['rev-parse', 'HEAD'])).trim();
    await git(['checkout', '-q', 'feat/c1/demo']);
    await mkdir(join(repository, '.pipeline'), { recursive: true });
    await writeFile(join(repository, '.pipeline', 'rebase-rewrites.json'), JSON.stringify({ [closure]: translatedClosure }));

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo', leafMovePending: true,
    });
  });
});
