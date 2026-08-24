import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { haltRecordPath, recordHalt } from '../../src/engine/halt-record.js';

const scratchRoots: string[] = [];
const input = {
  slug: 'operator-decision',
  haltClass: 'needs-human' as const,
  step: 'build_review',
  phase: 'BUILD',
  branch: 'feat/operator-decision',
  headSha: 'f00dbabe1234567890',
  haltedAt: '2026-08-23T16:30:00.000Z',
  haltBody: 'Build review needs an operator decision.',
};

afterEach(async () => {
  while (scratchRoots.length > 0) {
    await rm(scratchRoots.pop()!, { recursive: true, force: true });
  }
});

describe('recordHalt', () => {
  it('commits exactly the rendered halt record, once', async () => {
    const worktree = await makeFeatureRepository();
    const before = await commitCount(worktree);

    await expect(recordHalt(worktree, input)).resolves.toEqual({ kind: 'written' });

    await expect(readFile(join(worktree, haltRecordPath(input.slug)), 'utf8')).resolves.toContain('Status: halted');
    expect(await commitCount(worktree)).toBe(before + 1);
    expect(await changedPathsAtHead(worktree)).toEqual([haltRecordPath(input.slug)]);

    await expect(recordHalt(worktree, input)).resolves.toEqual({ kind: 'noop' });
    expect(await commitCount(worktree)).toBe(before + 1);
  });

  it('leaves unrelated dirty work modified and uncommitted', async () => {
    const worktree = await makeFeatureRepository();
    const unrelated = 'unrelated.txt';
    await writeFile(join(worktree, unrelated), 'keep this dirty\n');

    await expect(recordHalt(worktree, input)).resolves.toEqual({ kind: 'written' });

    expect(await changedPathsAtHead(worktree)).toEqual([haltRecordPath(input.slug)]);
    expect(await statusPaths(worktree)).toContain(` M ${unrelated}`);
  });
});

async function makeFeatureRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'halt-record-commit-root-'));
  const worktree = await mkdtemp(join(tmpdir(), 'halt-record-commit-worktree-'));
  scratchRoots.push(root, worktree);
  await rm(worktree, { recursive: true, force: true });
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'test\n');
  await writeFile(join(root, 'unrelated.txt'), 'clean\n');
  await execa('git', ['add', 'README.md', 'unrelated.txt'], { cwd: root });
  await execa('git', ['commit', '-q', '-m', 'initial'], { cwd: root });
  await execa('git', ['worktree', 'add', '-q', '-b', input.branch, worktree], { cwd: root });
  return worktree;
}

async function commitCount(cwd: string): Promise<number> {
  const { stdout } = await execa('git', ['rev-list', '--count', 'HEAD'], { cwd });
  return Number.parseInt(stdout, 10);
}

async function changedPathsAtHead(cwd: string): Promise<string[]> {
  const { stdout } = await execa('git', ['show', '--format=', '--name-only', 'HEAD'], { cwd });
  return stdout.split('\n').filter(Boolean);
}

async function statusPaths(cwd: string): Promise<string[]> {
  const { stdout } = await execa('git', ['status', '--porcelain'], { cwd });
  return stdout.split('\n').filter(Boolean);
}
