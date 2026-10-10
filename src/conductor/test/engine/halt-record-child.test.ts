// Covers: task:34
import { mkdtemp, mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  haltRecordPath,
  publishHaltRecord,
  recordHalt,
  supersedeHaltRecord,
  type HaltRecordInput,
  type HaltRecordRemoteOptions,
} from '../../src/engine/halt-record.js';
import { writeHaltMarker } from '../../src/engine/halt-marker.js';
import { escalateBuildFailure } from '../../src/engine/build-failure-escalation.js';
import {
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';
import type { RemoteGitExecutionResult, RemoteGitOperationDependencies } from '../../src/engine/remote-git-operations.js';

const scratchRoots: string[] = [];

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  while (scratchRoots.length > 0) {
    await rm(scratchRoots.pop()!, { recursive: true, force: true });
  }
});

describe('child halt records', () => {
  it('commits and supersedes a child record locally without publishing it', async () => {
    const worktree = await makeFeatureWorktree('feat/c1/demo');
    const remote = recordingRemote();
    const input = haltInput(worktree, 'feat/c1/demo', 1);

    await expect(recordHalt(worktree, input, remote.options)).resolves.toEqual({ kind: 'written' });
    await expect(readFile(join(worktree, haltRecordPath('demo')), 'utf8')).resolves.toContain('Child: 1\n');
    await expect(supersedeHaltRecord(worktree, 'demo', 'operator resume', remote.options)).resolves.toEqual({ kind: 'written' });

    expect(remote.calls).toEqual([]);
  });

  it('refuses direct publication from a child branch before the remote boundary', async () => {
    const remote = recordingRemote();

    await expect(publishHaltRecord('/repo', 'feat/c1/demo', remote.options, 'demo')).resolves.toEqual({
      kind: 'refused',
      reason: expect.stringContaining('feat/c1/demo'),
    });

    expect(remote.calls).toEqual([]);
  });

  it('records the active leaf position and publishes the leaf branch', async () => {
    const worktree = await makeFeatureWorktree('feat/daemon-demo');
    await sealChildren(worktree, [1, 2]);
    const { stdout: tip } = await execa('git', ['rev-parse', 'HEAD'], { cwd: worktree });
    await execa('git', ['update-ref', 'refs/conductor/demo/closed/c1', tip.trim()], { cwd: worktree });
    const remote = recordingRemote();

    await expect(writeHaltMarker(worktree, 'operator decision required\n', 'needs-human', undefined, remote.options))
      .resolves.toEqual({ status: 'written' });

    await expect(readFile(join(worktree, haltRecordPath('demo')), 'utf8')).resolves.toContain('Child: 2\n');
    expect(remote.calls).toEqual([['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo']]);
  });

  it('keeps the N=1 record byte shape and publishes it', async () => {
    const worktree = await makeFeatureWorktree('feat/daemon-demo');
    const remote = recordingRemote();

    await expect(writeHaltMarker(worktree, 'operator decision required\n', 'needs-human', undefined, remote.options))
      .resolves.toEqual({ status: 'written' });

    await expect(readFile(join(worktree, haltRecordPath('demo')), 'utf8')).resolves.not.toContain('\nChild:');
    expect(remote.calls).toEqual([['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo']]);
  });

  it('refuses escalation from a child branch before any push or PR creation', async () => {
    const gitCalls: string[][] = [];
    const runGit = vi.fn(async (args: string[]) => {
      gitCalls.push(args);
      return { stdout: 'feat/c1/demo\n' };
    });
    const runGh = vi.fn(async () => ({ stdout: '' }));

    await expect(escalateBuildFailure({
      projectRoot: '/repo', failureReason: 'build failed', runGit, runGh,
    })).resolves.toEqual({
      kind: 'refused',
      reason: expect.stringContaining('feat/c1/demo'),
    });

    expect(gitCalls).toEqual([['rev-parse', '--abbrev-ref', 'HEAD']]);
    expect(runGh).not.toHaveBeenCalled();
  });
});

function haltInput(worktree: string, branch: string, child?: number): HaltRecordInput {
  return {
    slug: basename(worktree),
    haltClass: 'needs-human',
    step: 'build',
    phase: 'BUILD',
    branch,
    headSha: 'a'.repeat(40),
    haltedAt: '2026-10-09T00:00:00.000Z',
    haltBody: 'operator decision required',
    ...(child === undefined ? {} : { child: child as HaltRecordInput['child'] }),
  };
}

function recordingRemote(): { calls: string[][]; options: HaltRecordRemoteOptions } {
  const calls: string[][] = [];
  return {
    calls,
    options: {
      remoteGit: async (args: readonly string[], _dependencies: RemoteGitOperationDependencies): Promise<RemoteGitExecutionResult> => {
        calls.push([...args]);
        return { kind: 'executed', targets: [] };
      },
    },
  };
}

async function makeFeatureWorktree(branch: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'halt-record-child-root-'));
  const worktree = join(root, 'demo');
  scratchRoots.push(root, worktree);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'test\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-qm', 'initial'], { cwd: root });
  await execa('git', ['worktree', 'add', '-q', '-b', branch, worktree], { cwd: root });
  return worktree;
}

async function sealChildren(worktree: string, positions: readonly number[]): Promise<void> {
  await writeCoverageBindingEnvelope(worktree, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: {
      taskSlices: Object.fromEntries(positions.map((position) => [String(position), position])),
      titles: positions.map((position) => `Child ${position}`),
    },
    storyOwnership: Object.fromEntries(positions.map((position) => [`S${position}`, position])),
  }, envelopeFilesystem);
}
