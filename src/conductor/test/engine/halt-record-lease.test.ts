import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import { writeHaltMarker } from '../../src/engine/halt-marker.js';
import { PRE_PUSH_HOOK } from '../../src/engine/git-hook-assets.js';
import type { HaltRecordRemoteOptions } from '../../src/engine/halt-record.js';
import type { RemoteGitExecutionResult, RemoteGitOperationDependencies } from '../../src/engine/remote-git-operations.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

// Covers: task:1
// After a local rewrite with an unmoved remote, writeHaltMarker publishes the halted record at
// the local HEAD and emits exactly one halt_record_written event for its path, with no
// halt_record_push_failed event. halt-record-commit.test.ts locks recordHalt and
// supersedeHaltRecord argv plus bare-force absence.
const scratchRoots: string[] = [];
const branch = 'feat/operator-decision';

afterEach(async () => {
  while (scratchRoots.length > 0) {
    await rm(scratchRoots.pop()!, { recursive: true, force: true });
  }
});

describe('writeHaltMarker lease publication', () => {
  it('publishes a post-rebase halt record to an unmoved bare remote', async () => {
    const { remote, worktree } = await makeFeatureRepository();
    await amendHead(worktree);

    const events = new ConductorEventEmitter();
    const writtenPaths: string[] = [];
    const failedPaths: string[] = [];
    events.on('halt_record_written', (event) => {
      if (event.type === 'halt_record_written') writtenPaths.push(event.path);
    });
    events.on('halt_record_push_failed', (event) => {
      if (event.type === 'halt_record_push_failed') failedPaths.push(event.path);
    });

    await expect(writeHaltMarker(
      worktree,
      'operator decision required\n',
      'needs-human',
      events,
      realGitRemote(),
    )).resolves.toEqual({ status: 'written' });

    const slug = basename(worktree);
    expect(await gitDirValue(remote, ['rev-parse', `refs/heads/${branch}`])).toBe(await gitValue(worktree, ['rev-parse', 'HEAD']));
    await expect(gitDirValue(remote, ['show', `refs/heads/${branch}:.docs/halted/${slug}.md`])).resolves.toContain('Status: halted');
    expect(writtenPaths).toEqual([`.docs/halted/${slug}.md`]);
    expect(failedPaths).toEqual([]);
  });

  // Covers: task:2
  // A foreign branch advance makes the lease stale. The halt marker and its local record commit
  // survive, while the unmodified remote tip and failed-push event preserve the refusal evidence.
  it('retains a local halt record and reports stale lease info after a foreign remote move', async () => {
    const { remote, worktree } = await makeFeatureRepository();
    await amendHead(worktree);
    const foreignSha = await advanceBranchFromForeignClone(remote);

    const events = new ConductorEventEmitter();
    const writtenPaths: string[] = [];
    const failedEvents: Array<{ path: string; reason: string }> = [];
    events.on('halt_record_written', (event) => {
      if (event.type === 'halt_record_written') writtenPaths.push(event.path);
    });
    events.on('halt_record_push_failed', (event) => {
      if (event.type === 'halt_record_push_failed') failedEvents.push({ path: event.path, reason: event.reason });
    });

    await expect(writeHaltMarker(
      worktree,
      'operator decision required\n',
      'needs-human',
      events,
      realGitRemote(),
    )).resolves.toEqual({ status: 'written' });

    const slug = basename(worktree);
    expect(await gitDirValue(remote, ['rev-parse', `refs/heads/${branch}`])).toBe(foreignSha);
    await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('operator decision required');
    expect(await gitValue(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']))
      .toBe(`.docs/halted/${slug}.md`);
    expect(failedEvents).toEqual([{
      path: `.docs/halted/${slug}.md`,
      reason: expect.stringContaining('stale info'),
    }]);
    expect(writtenPaths).toEqual([]);
  });

  // Covers: task:2
  // The engine's pre-push guard recognizes the matching remote-tracking ref and admits a
  // non-fast-forward halt-record lease push after the daemon-equivalent local rewrite.
  it('admits a post-rewrite halt-record lease push through the provisioned pre-push guard', async () => {
    const { remote, worktree } = await makeFeatureRepository();
    const hooksDir = join(worktree, '.pipeline', 'git-hooks');
    await mkdir(hooksDir, { recursive: true });
    await writeFile(join(hooksDir, 'pre-push'), PRE_PUSH_HOOK, 'utf8');
    await chmod(join(hooksDir, 'pre-push'), 0o755);
    await execa('git', ['config', 'core.hooksPath', hooksDir], { cwd: worktree });
    await amendHead(worktree);

    await expect(writeHaltMarker(
      worktree,
      'operator decision required\n',
      'needs-human',
      new ConductorEventEmitter(),
      realGitRemote(),
    )).resolves.toEqual({ status: 'written' });

    expect(await gitDirValue(remote, ['rev-parse', `refs/heads/${branch}`])).toBe(await gitValue(worktree, ['rev-parse', 'HEAD']));
  });
});

async function makeFeatureRepository(): Promise<{ remote: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'halt-record-lease-root-'));
  const worktree = await mkdtemp(join(tmpdir(), 'halt-record-lease-worktree-'));
  const remote = await mkdtemp(join(tmpdir(), 'halt-record-lease-remote-'));
  scratchRoots.push(root, worktree, remote);
  await rm(worktree, { recursive: true, force: true });
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'test\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-q', '-m', 'initial'], { cwd: root });
  await execa('git', ['init', '--bare', '-b', 'main', '-q', remote]);
  await execa('git', ['remote', 'add', 'origin', remote], { cwd: root });
  await execa('git', ['push', '-q', '--set-upstream', 'origin', 'main'], { cwd: root });
  await execa('git', ['worktree', 'add', '-q', '-b', branch, worktree], { cwd: root });
  await execa('git', ['push', '-q', '--set-upstream', 'origin', branch], { cwd: worktree });
  return { remote, worktree };
}

async function amendHead(cwd: string): Promise<void> {
  await execa('git', ['commit', '--amend', '--allow-empty', '-m', 'rebased'], { cwd });
}

async function advanceBranchFromForeignClone(remote: string): Promise<string> {
  const foreign = await mkdtemp(join(tmpdir(), 'halt-record-lease-foreign-'));
  scratchRoots.push(foreign);
  await execa('git', ['clone', '-q', remote, foreign]);
  await execa('git', ['config', 'user.email', 'foreign@example.com'], { cwd: foreign });
  await execa('git', ['config', 'user.name', 'Foreign Mover'], { cwd: foreign });
  await execa('git', ['checkout', '-q', branch], { cwd: foreign });
  await execa('git', ['commit', '--allow-empty', '-m', 'foreign advance'], { cwd: foreign });
  await execa('git', ['push', '-q', 'origin', branch], { cwd: foreign });
  return gitValue(foreign, ['rev-parse', 'HEAD']);
}

function realGitRemote(): HaltRecordRemoteOptions {
  return {
    git: makeLocalGit(),
    remoteGit: async (args: readonly string[], dependencies: RemoteGitOperationDependencies): Promise<RemoteGitExecutionResult> => {
      const result = await execa('git', [...args], { cwd: dependencies.cwd, reject: false });
      return result.exitCode === 0
        ? { kind: 'executed', targets: [] }
        : { kind: 'failed', error: result.stderr, targets: [] };
    },
  };
}

function makeLocalGit() {
  return async (args: string[], options: { cwd: string }): Promise<{ stdout: string }> => {
    const { stdout } = await execa('git', args, { cwd: options.cwd });
    return { stdout };
  };
}

async function gitValue(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd });
  return stdout.trim();
}

async function gitDirValue(gitDir: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', [`--git-dir=${gitDir}`, ...args]);
  return stdout.trim();
}
