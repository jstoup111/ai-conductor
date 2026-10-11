// Covers: task:27
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { recordHalt, type HaltRecordInput } from '../../src/engine/halt-record.js';
import {
  createRestackJournal,
  journalRefFor,
  writeRestackJournalBlob,
  type RestackJournalDraft,
} from '../../src/engine/restack/restack-journal.js';
import { type RestackOpId } from '../../src/engine/restack/restack-types.js';

const CONDUCTOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_ROOT = join(CONDUCTOR_ROOT, 'src/engine');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const guardedSites = [
  'conductor.ts',
  'finish-publication-production.ts',
  'halt-record.ts',
  'setup-triage.ts',
  'shipment-evidence-cli.ts',
  'shipped-record-cli.ts',
] as const;

describe('engine commit sites', () => {
  it.each(guardedSites)('%s selects the guarded path while retaining its N=1 git-commit fallback', async (site) => {
    const source = await readFile(join(ENGINE_ROOT, site), 'utf8');

    expect(source).toContain('commitEngineChangeWhenStacked');
    expect(source).toMatch(/\[\s*['"]commit['"]/);
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

  it('recordHalt refuses the fenced ready-journal state without advancing HEAD', async () => {
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
    const ready = await writeRestackJournalBlob(worktree, { ...created.journal.journal, state: 'ready' });
    await execa('git', ['update-ref', journalRefFor('demo'), ready, created.journal.blob], { cwd: worktree });

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
