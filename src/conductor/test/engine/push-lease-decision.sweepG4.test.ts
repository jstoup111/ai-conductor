// Covers: task:36
/**
 * Done-when sweep (G4) for the expected-SHA lease decision helper.
 *
 * Each scenario uses a real local bare remote, a worker clone acting as the
 * engine worktree, and a second clone acting as a human. The remote write is
 * delegated either to a recording boundary that reproduces executeRemoteGit's
 * Task-35 recording, or to the real executeRemoteGit with an injected process
 * runner, so the intent/pushed-ref bookkeeping under test is production code.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import {
  forcePushWithExpectedLease,
  preparePushedTip,
  pushedTipIntentRef,
  pushedTipRef,
  recordPushedTip,
  type ExpectedLeaseRemoteGit,
  type PushLeaseGitRunner,
} from '../../src/engine/push-lease.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const BRANCH = 'feat/daemon-demo';
const TRACKING = `refs/remotes/origin/${BRANCH}`;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: readonly string[], input?: string): Promise<{ stdout: string; exitCode: number }> {
  const result = await execa('git', [...args], { cwd, input, reject: false });
  return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
}

const leaseGit = (cwd: string): PushLeaseGitRunner => (args, input) => git(cwd, args, input);

async function ref(cwd: string, name: string): Promise<string | undefined> {
  const result = await git(cwd, ['rev-parse', '--verify', '--quiet', name]);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

async function commit(cwd: string, contents: string): Promise<string> {
  await writeFile(join(cwd, 'fixture.txt'), `${contents}\n`);
  await git(cwd, ['add', 'fixture.txt']);
  await git(cwd, ['commit', '-m', contents]);
  return (await ref(cwd, 'HEAD'))!;
}

async function clone(root: string, remote: string, name: string): Promise<string> {
  const path = join(root, name);
  await git(root, ['clone', remote, path]);
  await git(path, ['config', 'user.email', 'test@example.com']);
  await git(path, ['config', 'user.name', 'Test User']);
  await git(path, ['checkout', '-b', BRANCH, `origin/${BRANCH}`]);
  return path;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'push-lease-decision-sweep-'));
  roots.push(root);
  const source = join(root, 'source');
  const remote = join(root, 'origin.git');
  await mkdir(source);
  await initTestRepo(source);
  await commit(source, 'seed');
  await git(root, ['init', '--bare', '--initial-branch=main', remote]);
  await git(source, ['remote', 'add', 'origin', remote]);
  await git(source, ['push', 'origin', 'HEAD:refs/heads/main']);
  await git(source, ['checkout', '-b', BRANCH]);
  const base = await commit(source, 'feature base');
  await git(source, ['push', 'origin', `HEAD:refs/heads/${BRANCH}`]);
  const worker = await clone(root, remote, 'worker');
  return { root, remote, worker, base };
}

/** Records a durable pushed tip exactly as a completed executeRemoteGit push would. */
async function recordTip(worker: string, sha: string): Promise<void> {
  const prepared = await preparePushedTip({ cwd: worker, slug: 'demo', branch: BRANCH, new: sha, git: leaseGit(worker) });
  expect(prepared).toBeDefined();
  expect(await recordPushedTip({ cwd: worker, prepared: prepared!, git: leaseGit(worker) })).toBe(true);
}

function recordingBoundary(worker: string, calls: string[][]): ExpectedLeaseRemoteGit {
  return async (args) => {
    calls.push([...args]);
    const pushed = await git(worker, args);
    if (pushed.exitCode !== 0) return { kind: 'failed', error: pushed.stdout || 'push failed' };
    const next = (await ref(worker, 'HEAD'))!;
    const prepared = await preparePushedTip({ cwd: worker, slug: 'demo', branch: BRANCH, new: next, git: leaseGit(worker) });
    if (!prepared || !await recordPushedTip({ cwd: worker, prepared, git: leaseGit(worker) })) {
      return { kind: 'failed', error: 'recording failed' };
    }
    return { kind: 'executed' };
  };
}

function mutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/rocket', defaultBranch: 'main', specBranch: 'spec/demo',
      featureMarker: '.docs/specs/demo.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/specs/demo.md', content: 'Owner: alice\n' }] },
    },
  };
}

/** The real executeRemoteGit, with only its remote process boundary injected. */
function productionBoundary(worker: string, calls: string[][]): ExpectedLeaseRemoteGit {
  return async (args) => {
    const result = await executeRemoteGit(args, {
      cwd: worker,
      config: async () => ({ stdout: 'git@github.com:acme/rocket.git\n' }),
      mutation: mutation(),
      runRemoteGit: async (remoteArgs) => {
        calls.push([...remoteArgs]);
        const pushed = await execa('git', remoteArgs, { cwd: worker, reject: false });
        if (pushed.exitCode !== 0) throw new Error(pushed.stderr || 'push failed');
        return { stdout: pushed.stdout };
      },
    });
    return result.kind === 'executed' ? { kind: 'executed' } : result.kind === 'failed'
      ? { kind: 'failed', error: result.error }
      : result.kind === 'refused' ? { kind: 'refused', reason: String(result.reason) } : { kind: 'not-remote-write' };
  };
}

describe('expected-SHA lease decision — sweep G4', () => {
  // Covers: S14.5, task:36
  it('adopts a remotely completed but unrecorded intent as the recorded tip when the rewritten HEAD no longer contains it', async () => {
    const { remote, worker, base } = await fixture();
    await recordTip(worker, base);

    // A previous engine push reached the remote but its local record failed:
    // the intent {expected: base, new: R1} survives and pushed/ still names base.
    const r1 = await commit(worker, 'first rewrite');
    const intent = await preparePushedTip({ cwd: worker, slug: 'demo', branch: BRANCH, new: r1, git: leaseGit(worker) });
    expect(intent).toMatchObject({ expected: base, new: r1 });
    expect((await git(worker, ['push', 'origin', `HEAD:refs/heads/${BRANCH}`])).exitCode).toBe(0);
    expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBe(base);

    // The next rewrite does not contain R1, so only adopting R1 as the
    // recorded tip can justify the push (recorded base != remote R1).
    await git(worker, ['reset', '--hard', base]);
    const head = await commit(worker, 'second rewrite');
    const calls: string[][] = [];

    await expect(forcePushWithExpectedLease({
      cwd: worker, slug: 'demo', branch: BRANCH, git: leaseGit(worker),
      remoteGit: recordingBoundary(worker, calls),
    })).resolves.toEqual({ kind: 'executed' });

    expect(calls).toEqual([[
      'push', 'origin', `HEAD:refs/heads/${BRANCH}`, `--force-with-lease=refs/heads/${BRANCH}:${r1}`,
    ]]);
    expect(await git(remote, ['rev-parse', `refs/heads/${BRANCH}`])).toMatchObject({ stdout: head });
    expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBe(head);
    expect(await ref(worker, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
  });

  // Covers: S14.10, S14.12, task:36
  it('refuses an unrecorded push both when the remote moved past the pre-fetch tracking ref and when no tracking ref exists', async () => {
    // (a) no record; remote R2 differs from the pre-fetch tracking ref and is not in HEAD.
    const first = await fixture();
    await commit(first.worker, 'local rewrite');
    const human = await clone(first.root, first.remote, 'human');
    const humanTip = await commit(human, 'human work');
    expect((await git(human, ['push', 'origin', `HEAD:refs/heads/${BRANCH}`])).exitCode).toBe(0);
    const events: Extract<ConductorEvent, { type: 'push_lease_refused' }>[] = [];
    const advancedCalls: string[][] = [];

    await expect(forcePushWithExpectedLease({
      cwd: first.worker, slug: 'demo', branch: BRANCH, git: leaseGit(first.worker),
      remoteGit: recordingBoundary(first.worker, advancedCalls),
      events: { emit: async (event) => { events.push(event); } },
    })).resolves.toMatchObject({ kind: 'refused' });

    expect(advancedCalls).toEqual([]);
    expect(events).toEqual([{
      type: 'push_lease_refused', ref: `refs/heads/${BRANCH}`, expected: first.base, actual: humanTip,
    }]);
    expect((await git(first.remote, ['rev-parse', `refs/heads/${BRANCH}`])).stdout).toBe(humanTip);
    expect(await ref(first.worker, pushedTipRef('demo', BRANCH))).toBeUndefined();

    // (b) no record and no tracking ref: refused, naming the missing ref, no push.
    const second = await fixture();
    await commit(second.worker, 'local rewrite');
    await git(second.worker, ['update-ref', '-d', TRACKING]);
    const missingCalls: string[][] = [];

    await expect(forcePushWithExpectedLease({
      cwd: second.worker, slug: 'demo', branch: BRANCH, git: leaseGit(second.worker),
      remoteGit: recordingBoundary(second.worker, missingCalls),
    })).resolves.toEqual({
      kind: 'refused', reason: `missing tracking ref ${TRACKING} for unrecorded force push`,
    });
    expect(missingCalls).toEqual([]);
    expect((await git(second.remote, ['rev-parse', `refs/heads/${BRANCH}`])).stdout).toBe(second.base);
  });

  // Covers: S14.11, S14.13, task:36
  it('leaves the recorded pushed tip unchanged on fetch or read failure and no intent after any refused or failed push', async () => {
    // (a) fetch / remote-read failure with an existing record: no push, record unchanged, no intent.
    for (const failure of ['fetch', 'remote read'] as const) {
      const { worker, base } = await fixture();
      await recordTip(worker, base);
      await preparePushedTip({ cwd: worker, slug: 'demo', branch: BRANCH, new: 'f'.repeat(40), git: leaseGit(worker) });
      await commit(worker, 'local rewrite');
      let reads = 0;
      const runner: PushLeaseGitRunner = async (args, input) => {
        if (failure === 'fetch' && args[0] === 'fetch') return { stdout: '', exitCode: 1 };
        if (failure === 'remote read' && args[0] === 'rev-parse' && args.includes(TRACKING) && ++reads === 2) {
          return { stdout: '', exitCode: 1 };
        }
        return leaseGit(worker)(args, input);
      };
      const calls: string[][] = [];

      await expect(forcePushWithExpectedLease({
        cwd: worker, slug: 'demo', branch: BRANCH, git: runner, remoteGit: productionBoundary(worker, calls),
      })).resolves.toMatchObject({ kind: 'failed' });

      expect(calls).toEqual([]);
      expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBe(base);
      expect(await ref(worker, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
    }

    // (b) a refused push with an outstanding intent leaves no intent.
    {
      const { root, remote, worker, base } = await fixture();
      await recordTip(worker, base);
      await preparePushedTip({ cwd: worker, slug: 'demo', branch: BRANCH, new: 'e'.repeat(40), git: leaseGit(worker) });
      await commit(worker, 'local rewrite');
      const human = await clone(root, remote, 'human');
      await commit(human, 'human work');
      expect((await git(human, ['push', 'origin', `HEAD:refs/heads/${BRANCH}`])).exitCode).toBe(0);
      const calls: string[][] = [];

      await expect(forcePushWithExpectedLease({
        cwd: worker, slug: 'demo', branch: BRANCH, git: leaseGit(worker), remoteGit: productionBoundary(worker, calls),
      })).resolves.toMatchObject({ kind: 'refused' });

      expect(calls).toEqual([]);
      expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBe(base);
      expect(await ref(worker, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
    }

    // (c) a push the remote rejects, through the real executeRemoteGit, leaves no intent.
    {
      const { remote, worker, base } = await fixture();
      await recordTip(worker, base);
      const hook = join(remote, 'hooks', 'pre-receive');
      await writeFile(hook, '#!/bin/sh\necho "remote rejects every update" >&2\nexit 1\n');
      await chmod(hook, 0o755);
      await commit(worker, 'local rewrite');
      const calls: string[][] = [];

      await expect(forcePushWithExpectedLease({
        cwd: worker, slug: 'demo', branch: BRANCH, git: leaseGit(worker), remoteGit: productionBoundary(worker, calls),
      })).resolves.toMatchObject({ kind: 'failed' });

      expect(calls).toEqual([[
        'push', 'origin', `HEAD:refs/heads/${BRANCH}`, `--force-with-lease=refs/heads/${BRANCH}:${base}`,
      ]]);
      expect((await git(remote, ['rev-parse', `refs/heads/${BRANCH}`])).stdout).toBe(base);
      expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBe(base);
      expect(await ref(worker, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
    }
  });
});
