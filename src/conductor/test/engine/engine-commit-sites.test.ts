// Covers: task:27
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordHalt, type HaltRecordInput } from '../../src/engine/halt-record.js';
import {
  createRestackJournal,
  journalRefFor,
  writeRestackJournalBlob,
  type RestackJournalDraft,
} from '../../src/engine/restack/restack-journal.js';
import { type RestackOpId } from '../../src/engine/restack/restack-types.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('engine commit sites', () => {
  it('dispatches both halt-record callers through the guarded commit seam with their own pathspec', async () => {
    const guarded = vi.fn().mockResolvedValue({ kind: 'written', sha: 'b'.repeat(40) });
    vi.resetModules();
    vi.doMock('../../src/engine/guarded-engine-commit.js', () => ({
      commitEngineChangeWhenStacked: guarded,
    }));
    try {
      const { recordHalt: guardedRecordHalt, supersedeHaltRecord: guardedSupersede } = await import('../../src/engine/halt-record.js');
      const worktree = await featureWorktree();
      await mkdir(join(worktree, '.docs', 'halted'), { recursive: true });

      await expect(guardedRecordHalt(worktree, haltInput())).resolves.toEqual({ kind: 'written' });
      await expect(guardedSupersede(worktree, 'demo', 'fixed')).resolves.toEqual({ kind: 'written' });

      expect(guarded).toHaveBeenNthCalledWith(1, expect.objectContaining({
        worktree, slug: 'demo', pathspec: ['.docs/halted/demo.md'], message: 'halt record: demo', noVerify: true,
      }));
      expect(guarded).toHaveBeenNthCalledWith(2, expect.objectContaining({
        worktree, slug: 'demo', pathspec: ['.docs/halted/demo.md'], message: 'halt record resolved: demo', noVerify: true,
      }));
    } finally {
      vi.doUnmock('../../src/engine/guarded-engine-commit.js');
      vi.resetModules();
    }
  });

  it('recordHalt commits only its record through the guard in durable child state', async () => {
    const worktree = await featureWorktree();
    await installEngineHooks(worktree);
    await mkdir(join(worktree, '.pipeline', 'children', '1'), { recursive: true });
    await writeFile(join(worktree, 'stray.txt'), 'must stay uncommitted\n');

    await expect(recordHalt(worktree, haltInput())).resolves.toEqual({ kind: 'written' });
    const changed = (await execa('git', ['show', '--format=', '--name-only', 'HEAD'], { cwd: worktree })).stdout
      .split('\n').filter(Boolean);
    expect(changed).toEqual(['.docs/halted/demo.md']);
    expect((await execa('git', ['status', '--porcelain', 'stray.txt'], { cwd: worktree })).stdout).toContain('stray.txt');
  });

  it.each(['ready', 'moved', 'rolling-back'] as const)('recordHalt refuses the fenced %s journal state without advancing HEAD', async (state) => {
    const worktree = await featureWorktree();
    await mkdir(join(worktree, '.pipeline', 'children', '1'), { recursive: true });
    const before = (await execa('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim();
    const created = await createRestackJournal(worktree, 'demo', {
      opId: 'task-27-fence' as RestackOpId,
      cause: 'feature-repair',
      committer: { name: 'Test', email: 'test@example.invalid', date: '2030-01-01T00:00:00Z' },
      dirtyPaths: [], refs: [], ranges: [], children: [],
    } satisfies RestackJournalDraft);
    if (created.kind !== 'created') throw new Error('could not create restack journal');
    const fenced = await writeRestackJournalBlob(worktree, { ...created.journal.journal, state });
    await execa('git', ['update-ref', journalRefFor('demo'), fenced, created.journal.blob], { cwd: worktree });

    await expect(recordHalt(worktree, haltInput())).resolves.toMatchObject({ kind: 'failed' });
    await expect(execa('git', ['rev-parse', 'HEAD'], { cwd: worktree })).resolves.toMatchObject({ stdout: before });
  });
});

function haltInput(): HaltRecordInput {
  return {
    slug: 'demo', haltClass: 'needs-human', step: 'build', phase: 'BUILD',
    branch: 'feat/c1/demo', headSha: 'a'.repeat(40), haltedAt: '2030-01-01T00:00:00.000Z', haltBody: 'halt', child: 1,
  };
}

async function featureWorktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'engine-commit-sites-'));
  const worktree = join(root, 'demo');
  roots.push(root);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'base\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-qm', 'base'], { cwd: root });
  await execa('git', ['worktree', 'add', '-q', '-b', 'feat/c1/demo', worktree], { cwd: root });
  return worktree;
}

async function installEngineHooks(worktree: string): Promise<void> {
  const hooks = join(worktree, '.test-hooks');
  await mkdir(hooks, { recursive: true });
  await Promise.all(['prepare-commit-msg', 'post-commit'].map((name) =>
    writeFile(join(hooks, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 }),
  ));
  await execa('git', ['config', 'core.hooksPath', hooks], { cwd: worktree });
}
