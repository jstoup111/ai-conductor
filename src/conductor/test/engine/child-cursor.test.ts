// Covers: task:4
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveActiveChild } from '../../src/engine/child-cursor.js';
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

async function seal(worktree: string, positions: readonly number[], status: 'done' | 'failed' = 'done'): Promise<void> {
  const taskSlices = Object.fromEntries(positions.map((position) => [String(position), position]));
  await writeCoverageBindingEnvelope(worktree, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status,
    entries: [],
    sliceMembership: { taskSlices, titles: positions.map((position) => `Child ${position}`) },
    storyOwnership: Object.fromEntries(positions.map((position) => [`S${position}`, position])),
  }, envelopeFilesystem);
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
});
