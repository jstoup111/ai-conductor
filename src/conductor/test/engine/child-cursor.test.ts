// Covers: task:4, task:5
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveActiveChild } from '../../src/engine/child-cursor.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import {
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';

const execFile = promisify(execFileCallback);

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

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
  const taskSlices = Object.fromEntries(positions.map((position) => [String(position), position]));
  await writeCoverageBindingEnvelope(worktree, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status,
    entries: [],
    sliceMembership: { taskSlices, titles: positions.map((position) => `Child ${position}`) },
    ...(storyOwnership ? { storyOwnership: Object.fromEntries(positions.map((position) => [`S${position}`, position])) } : {}),
  }, envelopeFilesystem);
}

async function configureStacked(worktree: string, enabled: boolean): Promise<void> {
  await mkdir(join(worktree, '.ai-conductor'), { recursive: true });
  await writeFile(join(worktree, '.ai-conductor', 'config.yml'), `stacked_prs:\n  enabled: ${enabled}\n  max_slices: 3\n`);
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
      kind: 'active', child: 1, position: 1, isLeaf: false, branch: 'feat/c1/demo',
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

  it('does not let an incomplete envelope activate a child', async () => {
    await seal(repository, [1, 2], 'failed');

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'no-child' });
  });

  it('does not treat a noncanonical closure ref as a closure for a declared child', async () => {
    await seal(repository, [1, 2]);
    const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c01', tip]);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 1, position: 1, isLeaf: false, branch: 'feat/c1/demo',
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

  it('fails closed as divergent when a closed child has a non-halt commit after its closure', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1, 2]);
    const closure = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', closure]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await git(['checkout', '-q', 'feat/c1/demo']);
    await writeFile(join(repository, 'child-change.txt'), 'needs restack\n');
    await git(['add', 'child-change.txt']);
    await git(['commit', '-qm', 'child drift']);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'divergent', child: 1 });
  });

  it('fails closed as divergent when a closure is not an ancestor of the next non-leaf child', async () => {
    await configureStacked(repository, true);
    await seal(repository, [1, 2, 3]);
    const closure = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', closure]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    const unrelatedTip = (await git(['commit-tree', `${closure}^{tree}`, '-m', 'unrelated child base'])).trim();
    await git(['branch', 'feat/c2/demo', unrelatedTip]);

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'divergent', child: 1 });
  });

  it('fails closed for child state without a sealed envelope, detached HEAD, and git errors', async () => {
    await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'envelope-missing' });

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
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'no-child' });

    await configureStacked(repository, true);
    await seal(repository, [1, 2], 'done', false);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({ kind: 'no-child' });
  });

  it('keeps child state active even when stacked delivery is now disabled', async () => {
    await configureStacked(repository, false);
    await seal(repository, [1, 2]);
    await mkdir(join(repository, '.pipeline', 'children', '1'), { recursive: true });

    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'active', child: 1, position: 1, isLeaf: false, branch: 'feat/c1/demo',
    });
  });

  it('allows a halt-record-only commit after closure and clears leafMovePending after a leaf rewrite map', async () => {
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
  });
});
