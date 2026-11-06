// Covers: task:16
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  advanceChildRegion,
  noOpChildLifecycleEvents,
  startChild,
  switchToChild,
  type StartChildGitRunner,
} from '../../src/engine/child-lifecycle.js';
import { parseChildId } from '../../src/engine/child-context.js';

const execFile = promisify(execFileCallback);
const firstChild = { child: parseChildId(1)!, position: parseChildId(1)!, branch: 'feat/c1/demo', isLeaf: false };

let repository: string;

async function git(args: string[], cwd = repository): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function commit(path: string, body: string, message: string): Promise<string> {
  await mkdir(join(repository, path, '..'), { recursive: true });
  await writeFile(join(repository, path), body);
  await git(['add', path]);
  await git(['commit', '-qm', message]);
  return (await git(['rev-parse', 'HEAD'])).trim();
}

async function configureStack(): Promise<void> {
  await Promise.all([
    mkdir(join(repository, '.ai-conductor'), { recursive: true }),
    mkdir(join(repository, '.docs', 'plans'), { recursive: true }),
    mkdir(join(repository, '.docs', 'stories'), { recursive: true }),
    mkdir(join(repository, '.docs', 'complexity'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(repository, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n'),
    writeFile(join(repository, '.docs', 'plans', 'demo.md'), [
      '# Implementation Plan: demo', '', '**Stories:** .docs/stories/demo.md', '', '## Slices', '',
      '| Slice | Title | Tasks |', '| --- | --- | --- |', '| 1 | Child 1 | 1 |', '| 2 | Child 2 | 2 |', '',
      '### Task 1: Child 1', '**Story:** Story 1', '**Dependencies:** none', '',
      '### Task 2: Child 2', '**Story:** Story 2', '**Dependencies:** none', '',
    ].join('\n')),
    writeFile(join(repository, '.docs', 'stories', 'demo.md'), '## Story 1: Child 1\n\n## Story 2: Child 2\n'),
    writeFile(join(repository, '.docs', 'complexity', 'demo.md'), 'Tier: M\nStacked-Delivery: approved\n'),
  ]);
  await git(['add', '.ai-conductor', '.docs']);
  await git(['commit', '-qm', 'configure stack']);
}

async function prepareClosedChild(): Promise<string> {
  await configureStack();
  await expect(startChild(repository, 'demo', firstChild.child, noOpChildLifecycleEvents)).resolves.toEqual({ kind: 'started' });
  await expect(switchToChild(repository, firstChild, noOpChildLifecycleEvents)).resolves.toEqual({ kind: 'completed' });
  return commit('src/child.ts', 'export const child = true;\n', 'child contribution');
}

async function addLeafCommit(path: string, body: string, message: string): Promise<string> {
  await git(['switch', 'feat/daemon-demo']);
  const sha = await commit(path, body, message);
  await git(['switch', 'feat/c1/demo']);
  return sha;
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'child-lifecycle-leaf-move-'));
  await git(['init', '-q', '-b', 'feat/daemon-demo']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test User']);
  const base = await commit('base.txt', 'base\n', 'base');
  await git(['update-ref', 'refs/remotes/origin/main', base]);
  await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe('advanceChildRegion leaf move', () => {
  it('moves past two halt-record-only leaf commits and records the old leaf tip in its reflog', async () => {
    const childTip = await prepareClosedChild();
    await git(['switch', 'feat/daemon-demo']);
    const firstHalt = await commit('.docs/halted/demo.md', 'Status: halted\n', 'halt one');
    const secondHalt = await commit('.docs/halted/demo.md', 'Status: resolved\n', 'halt two');
    await git(['switch', 'feat/c1/demo']);

    await expect(advanceChildRegion(repository, 'demo', firstChild, noOpChildLifecycleEvents)).resolves.toEqual({ kind: 'completed' });

    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${childTip}\n`);
    await expect(git(['reflog', 'show', '--format=%H', 'feat/daemon-demo'])).resolves.toContain(secondHalt);
    expect(firstHalt).not.toBe(secondHalt);
  });

  it.each([
    ['source change', 'src/a.ts', 'export const a = 1;\n'],
    ['another feature halt record', '.docs/halted/other.md', 'Status: halted\n'],
    ['mixed feature halt record', '.docs/halted/demo.md', 'Status: halted\n'],
  ])('refuses a leaf %s commit and leaves the leaf unchanged', async (_name, path, body) => {
    await prepareClosedChild();
    let stray: string;
    if (_name === 'mixed feature halt record') {
      await git(['switch', 'feat/daemon-demo']);
      await Promise.all([
        mkdir(join(repository, '.docs', 'halted'), { recursive: true }),
        mkdir(join(repository, 'src'), { recursive: true }),
      ]);
      await writeFile(join(repository, '.docs', 'halted', 'demo.md'), body);
      await writeFile(join(repository, 'src', 'a.ts'), 'export const a = 1;\n');
      await git(['add', '.docs/halted/demo.md', 'src/a.ts']);
      await git(['commit', '-qm', 'mixed halt record and source']);
      stray = (await git(['rev-parse', 'HEAD'])).trim();
      await git(['switch', 'feat/c1/demo']);
    } else {
      stray = await addLeafCommit(path, body, `stray ${_name}`);
    }

    await expect(advanceChildRegion(repository, 'demo', firstChild, noOpChildLifecycleEvents)).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining(stray!),
    });
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${stray!}\n`);
  });

  it('refuses a merge leaf commit even when its only changed path is this feature halt record', async () => {
    await prepareClosedChild();
    await git(['switch', 'feat/daemon-demo']);
    await git(['branch', 'halt-side']);
    await git(['switch', 'halt-side']);
    await commit('.docs/halted/demo.md', 'Status: halted\n', 'halt side');
    await git(['switch', 'feat/daemon-demo']);
    await git(['commit', '--allow-empty', '-qm', 'leaf first parent']);
    await git(['merge', '--no-ff', '--no-commit', 'halt-side']);
    await git(['commit', '-qm', 'merge halt record']);
    const merge = (await git(['rev-parse', 'HEAD'])).trim();
    await git(['switch', 'feat/c1/demo']);

    await expect(advanceChildRegion(repository, 'demo', firstChild, noOpChildLifecycleEvents)).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining(merge),
    });
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${merge}\n`);
  });

  it('returns the shipped concurrent-update refusal when the leaf changes after the stray check', async () => {
    const childTip = await prepareClosedChild();
    await git(['switch', 'feat/daemon-demo']);
    const concurrentTip = await commit('src/race.ts', 'export const race = true;\n', 'concurrent leaf work');
    await git(['update-ref', 'refs/heads/feat/daemon-demo', `${childTip}^`]);
    await git(['switch', 'feat/c1/demo']);
    const leafRef = 'refs/heads/feat/daemon-demo';
    const gitRunner: StartChildGitRunner = async (args) => {
      if (args[0] === 'update-ref' && args[1] === leafRef) {
        await git(['update-ref', leafRef, concurrentTip]);
        return { exitCode: 1, stdout: '', stderr: 'cannot lock ref' };
      }
      try {
        return { exitCode: 0, stdout: await git(args), stderr: '' };
      } catch (error: unknown) {
        return { exitCode: (error as { code?: number }).code ?? 1, stdout: '', stderr: '' };
      }
    };

    await expect(advanceChildRegion(repository, 'demo', firstChild, noOpChildLifecycleEvents, { git: gitRunner })).resolves.toMatchObject({
      kind: 'refused', reason: expect.stringContaining('concurrent update refused'),
    });
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${concurrentTip}\n`);
  });
});
