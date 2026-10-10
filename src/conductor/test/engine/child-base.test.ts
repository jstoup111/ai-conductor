// Covers: task:16
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveChildBase } from '../../src/engine/child-cursor.js';
import type { ChildId } from '../../src/engine/child-context.js';
import type { GitResult, GitRunner } from '../../src/engine/rebase.js';
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

async function git(args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: repository })).stdout;
}

async function gitResult(args: string[]): Promise<GitResult> {
  try {
    const result = await execFile('git', args, { cwd: repository });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & { code?: number; stdout?: string; stderr?: string };
    return { exitCode: typeof failed.code === 'number' ? failed.code : 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

async function seal(positions: readonly number[]): Promise<void> {
  await writeCoverageBindingEnvelope(repository, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: {
      taskSlices: Object.fromEntries(positions.map((position) => [String(position), position])),
      titles: positions.map((position) => `Child ${position}`),
    },
  }, envelopeFilesystem);
}

async function childClosure(): Promise<string> {
  await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);
  await git(['checkout', '-q', 'feat/c1/demo']);
  await writeFile(join(repository, 'child.txt'), 'child work\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'child work']);
  const closure = (await git(['rev-parse', 'HEAD'])).trim();
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
  return closure;
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'child-base-repository-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'base@example.test']);
  await git(['config', 'user.name', 'Child base test']);
  await writeFile(join(repository, 'README.md'), 'base\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'base']);
  await git(['branch', 'feat/daemon-demo']);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe('resolveChildBase', () => {
  it('returns none with no child and for the first declared position', async () => {
    await seal([1, 2]);

    await expect(resolveChildBase(repository, 'demo')).resolves.toEqual({ kind: 'none' });
    await expect(resolveChildBase(repository, 'demo', 1 as ChildId)).resolves.toEqual({ kind: 'none' });
  });

  it('uses the closure tip, not a later halt-record commit, and never reaches a remote', async () => {
    await seal([1, 2]);
    const closure = await childClosure();
    await git(['checkout', '-q', 'feat/daemon-demo']);
    await git(['merge', '--ff-only', 'feat/c1/demo']);
    await git(['checkout', '-q', 'feat/c1/demo']);
    await mkdir(join(repository, '.docs', 'halted'), { recursive: true });
    await writeFile(join(repository, '.docs', 'halted', 'demo.md'), 'halt record\n');
    await git(['add', '.docs/halted/demo.md']);
    await git(['commit', '-qm', 'halt record']);
    await git(['checkout', '-q', 'feat/daemon-demo']);

    const calls: string[][] = [];
    const trackedGit: GitRunner = async (args) => {
      calls.push(args);
      return gitResult(args);
    };

    await expect(resolveChildBase(repository, 'demo', 2 as ChildId, { git: trackedGit })).resolves.toMatchObject({
      kind: 'parent', sha: closure, parent: 1,
    });
    expect(calls.flat()).not.toContain('fetch');
    expect(calls.flat()).not.toContain('ls-remote');
  });

  it('fails closed when the previous child branch is missing or its closure is outside HEAD', async () => {
    await seal([1, 2]);
    const base = (await git(['rev-parse', 'HEAD'])).trim();
    await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);

    await expect(resolveChildBase(repository, 'demo', 2 as ChildId)).resolves.toMatchObject({
      kind: 'parent-missing', parent: 1, branch: 'feat/c1/demo',
    });

    await git(['update-ref', 'refs/conductor/demo/closed/c1', base]);
    await git(['branch', '-D', 'feat/c1/demo']);

    await expect(resolveChildBase(repository, 'demo', 2 as ChildId)).resolves.toMatchObject({
      kind: 'parent-missing', parent: 1, branch: 'feat/c1/demo',
    });

    await git(['branch', 'feat/c1/demo', 'feat/daemon-demo']);
    await git(['checkout', '-q', 'feat/c1/demo']);
    await writeFile(join(repository, 'child.txt'), 'unmerged child work\n');
    await git(['add', 'child.txt']);
    await git(['commit', '-qm', 'unmerged child work']);
    const closure = (await git(['rev-parse', 'HEAD'])).trim();
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await git(['checkout', '-q', 'feat/daemon-demo']);

    await expect(resolveChildBase(repository, 'demo', 2 as ChildId)).resolves.toMatchObject({
      kind: 'parent-not-ancestor', parent: 1, sha: closure,
    });
  });

  it('translates a parent closure through the persisted leaf rewrite map and rejects an unmapped one', async () => {
    await seal([1, 2]);
    const closure = await childClosure();
    await git(['checkout', '-q', 'feat/daemon-demo']);
    await writeFile(join(repository, 'rebased.txt'), 'leaf rebase image\n');
    await git(['add', 'rebased.txt']);
    await git(['commit', '-qm', 'leaf rebase image']);
    const translated = (await git(['rev-parse', 'HEAD'])).trim();
    await mkdir(join(repository, '.pipeline'), { recursive: true });
    await writeFile(join(repository, '.pipeline', 'rebase-rewrites.json'), JSON.stringify({ [closure]: translated }));

    await expect(resolveChildBase(repository, 'demo', 2 as ChildId)).resolves.toMatchObject({
      kind: 'parent', sha: translated, parent: 1,
    });

    await writeFile(join(repository, '.pipeline', 'rebase-rewrites.json'), JSON.stringify({}));
    await expect(resolveChildBase(repository, 'demo', 2 as ChildId)).resolves.toMatchObject({
      kind: 'parent-not-ancestor', parent: 1, sha: closure,
    });
  });
});
