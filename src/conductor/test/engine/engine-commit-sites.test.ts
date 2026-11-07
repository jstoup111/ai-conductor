// Covers: task:27
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordHalt, type HaltRecordInput } from '../../src/engine/halt-record.js';
import { haltRecordRefFor, readHaltRecordRef } from '../../src/engine/halt-record-ref.js';
import {
  createRestackJournal,
  journalRefFor,
  writeRestackJournalBlob,
  type RestackJournalDraft,
} from '../../src/engine/restack/restack-journal.js';
import { type RestackOpId } from '../../src/engine/restack/restack-types.js';
import type { ChildId } from '../../src/engine/child-context.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('engine commit sites', () => {
  it('dispatches unstacked halt-record callers through the guarded commit seam with their own pathspec', async () => {
    const guarded = vi.fn().mockResolvedValue({ kind: 'written', sha: 'b'.repeat(40) });
    vi.resetModules();
    vi.doMock('../../src/engine/guarded-engine-commit.js', () => ({
      commitEngineChangeWhenStacked: guarded,
    }));
    try {
      const { recordHalt: guardedRecordHalt, supersedeHaltRecord: guardedSupersede } = await import('../../src/engine/halt-record.js');
      const worktree = await featureWorktree('feat/daemon-demo');
      await mkdir(join(worktree, '.docs', 'halted'), { recursive: true });

      // Publication is outside this guarded-commit seam and may be unavailable
      // in the temporary repository; both local outcomes prove the call site.
      await expect(guardedRecordHalt(worktree, haltInput())).resolves.toMatchObject({ kind: expect.stringMatching(/^(written|pushFailed)$/) });
      await expect(guardedSupersede(worktree, 'demo', 'fixed')).resolves.toMatchObject({ kind: expect.stringMatching(/^(written|pushFailed)$/) });

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

  it('recordHalt appends only its record ref in durable child state', async () => {
    const worktree = await featureWorktree();
    await installEngineHooks(worktree);
    await mkdir(join(worktree, '.pipeline', 'children', '1'), { recursive: true });
    await writeFile(join(worktree, 'stray.txt'), 'must stay uncommitted\n');

    const before = (await execa('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim();
    await expect(recordHalt(worktree, haltInput())).resolves.toEqual({ kind: 'written', path: haltRecordRefFor('demo') });
    expect((await execa('git', ['rev-parse', 'HEAD'], { cwd: worktree })).stdout.trim()).toBe(before);
    await expect(readHaltRecordRef(worktree, 'demo')).resolves.toMatchObject({
      kind: 'record', source: 'ref', text: expect.stringContaining('Status: halted\n'),
    });
    expect((await execa('git', ['status', '--porcelain', 'stray.txt'], { cwd: worktree })).stdout).toContain('stray.txt');
  });

  it.each(['ready', 'moved', 'rolling-back'] as const)('recordHalt appends its isolated record ref through the fenced %s journal state without advancing HEAD', async (state) => {
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

    await expect(recordHalt(worktree, haltInput())).resolves.toEqual({ kind: 'written', path: haltRecordRefFor('demo') });
    await expect(execa('git', ['rev-parse', 'HEAD'], { cwd: worktree })).resolves.toMatchObject({ stdout: before });
  });
});

function haltInput(): HaltRecordInput {
  return {
    slug: 'demo', haltClass: 'needs-human', step: 'build', phase: 'BUILD',
    branch: 'feat/c1/demo', headSha: 'a'.repeat(40), haltedAt: '2030-01-01T00:00:00.000Z', haltBody: 'halt', child: 1 as ChildId,
  };
}

async function featureWorktree(branch = 'feat/c1/demo'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'engine-commit-sites-'));
  const worktree = join(root, 'demo');
  roots.push(root);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'base\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-qm', 'base'], { cwd: root });
  await execa('git', ['worktree', 'add', '-q', '-b', branch, worktree], { cwd: root });
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
