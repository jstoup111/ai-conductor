// Covers: task:36
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
import type { ConductorEvent } from '../../src/types/events.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const BRANCH = 'feat/daemon-demo';
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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'push-lease-decision-'));
  roots.push(root);
  const source = join(root, 'source');
  const remote = join(root, 'origin.git');
  const worker = join(root, 'worker');
  await mkdir(source);
  await initTestRepo(source);
  await commit(source, 'seed');
  await git(root, ['init', '--bare', '--initial-branch=main', remote]);
  await git(source, ['remote', 'add', 'origin', remote]);
  await git(source, ['push', 'origin', 'HEAD:refs/heads/main']);
  await git(source, ['checkout', '-b', BRANCH]);
  const base = await commit(source, 'feature base');
  await git(source, ['push', 'origin', `HEAD:refs/heads/${BRANCH}`]);
  await git(root, ['clone', remote, worker]);
  await git(worker, ['config', 'user.email', 'test@example.com']);
  await git(worker, ['config', 'user.name', 'Test User']);
  await git(worker, ['checkout', '-b', BRANCH, `origin/${BRANCH}`]);
  return { root, source, remote, worker, base };
}

function recordingBoundary(worker: string, calls: string[][]): ExpectedLeaseRemoteGit {
  return async (args) => {
    calls.push([...args]);
    const pushed = await git(worker, args);
    if (pushed.exitCode !== 0) return { kind: 'failed', error: pushed.stdout || 'push failed' };
    const next = (await ref(worker, 'HEAD'))!;
    // This is the executeRemoteGit Task-35 responsibility, reproduced at the
    // mocked boundary so the decision test proves it reached that boundary.
    const prepared = await preparePushedTip({
      cwd: worker, slug: 'demo', branch: BRANCH, new: next, git: leaseGit(worker),
    });
    if (!prepared || !await recordPushedTip({ cwd: worker, prepared, git: leaseGit(worker) })) {
      return { kind: 'failed', error: 'recording failed' };
    }
    return { kind: 'executed' };
  };
}

describe('expected-SHA force-push decision', () => {
  it('leases an unrecorded feature against the tracking SHA captured before its one-branch fetch', async () => {
    const { worker, base } = await fixture();
    const head = await commit(worker, 'worker rewrite');
    const calls: string[][] = [];

    await expect(forcePushWithExpectedLease({
      cwd: worker, slug: 'demo', branch: BRANCH, git: leaseGit(worker),
      remoteGit: recordingBoundary(worker, calls),
    })).resolves.toEqual({ kind: 'executed' });

    expect(calls).toEqual([[
      'push', 'origin', `HEAD:refs/heads/${BRANCH}`,
      `--force-with-lease=refs/heads/${BRANCH}:${base}`,
    ]]);
    expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBe(head);
    expect(await ref(worker, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
  });

  it('adopts a completed prior intent when the remote still names its intended SHA', async () => {
    const { worker, base } = await fixture();
    const previous = await preparePushedTip({
      cwd: worker, slug: 'demo', branch: BRANCH, new: base, git: leaseGit(worker),
    });
    expect(previous).toBeDefined();
    const head = await commit(worker, 'next rewrite');
    const calls: string[][] = [];

    await expect(forcePushWithExpectedLease({
      cwd: worker, slug: 'demo', branch: BRANCH, git: leaseGit(worker),
      remoteGit: recordingBoundary(worker, calls),
    })).resolves.toEqual({ kind: 'executed' });

    expect(calls[0]).toContain(`--force-with-lease=refs/heads/${BRANCH}:${base}`);
    expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBe(head);
    expect(await ref(worker, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
  });

  it('refuses an unseen remote advance without invoking the remote boundary and emits the canonical event', async () => {
    const { root, remote, worker } = await fixture();
    await commit(worker, 'local rewrite');
    const human = join(root, 'human');
    await git(root, ['clone', remote, human]);
    await git(human, ['config', 'user.email', 'test@example.com']);
    await git(human, ['config', 'user.name', 'Test User']);
    await git(human, ['checkout', '-b', BRANCH, `origin/${BRANCH}`]);
    const humanTip = await commit(human, 'human work');
    expect((await git(human, ['push', 'origin', `HEAD:refs/heads/${BRANCH}`])).exitCode).toBe(0);
    const events: Extract<ConductorEvent, { type: 'push_lease_refused' }>[] = [];
    const calls: string[][] = [];

    await expect(forcePushWithExpectedLease({
      cwd: worker, slug: 'demo', branch: BRANCH, git: leaseGit(worker),
      remoteGit: recordingBoundary(worker, calls),
      events: { emit: async (event) => { events.push(event); } },
    })).resolves.toMatchObject({ kind: 'refused' });

    expect(calls).toEqual([]);
    expect(await ref(worker, `refs/remotes/origin/${BRANCH}`)).toBe(humanTip);
    expect(events).toEqual([{
      type: 'push_lease_refused', ref: `refs/heads/${BRANCH}`,
      expected: expect.any(String), actual: humanTip,
    }]);
    expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBeUndefined();
    expect(await ref(worker, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
  });

  it('refuses an unrecorded branch with no pre-fetch tracking ref and names that ref', async () => {
    const { worker } = await fixture();
    await commit(worker, 'local rewrite');
    await git(worker, ['update-ref', '-d', `refs/remotes/origin/${BRANCH}`]);
    const calls: string[][] = [];

    await expect(forcePushWithExpectedLease({
      cwd: worker, slug: 'demo', branch: BRANCH, git: leaseGit(worker),
      remoteGit: recordingBoundary(worker, calls),
    })).resolves.toEqual({
      kind: 'refused', reason: `missing tracking ref refs/remotes/origin/${BRANCH} for unrecorded force push`,
    });
    expect(calls).toEqual([]);
  });

  it.each(['fetch', 'remote read'] as const)('does not push, record, or retain intent when %s fails', async (failure) => {
    const { worker, base } = await fixture();
    const outstanding = await preparePushedTip({
      cwd: worker, slug: 'demo', branch: BRANCH, new: base, git: leaseGit(worker),
    });
    expect(outstanding).toBeDefined();
    const calls: string[][] = [];
    const runner: PushLeaseGitRunner = async (args, input) => {
      if (failure === 'fetch' && args[0] === 'fetch') return { stdout: '', exitCode: 1 };
      if (failure === 'remote read' && args[0] === 'rev-parse' && args.includes(`refs/remotes/origin/${BRANCH}`)) {
        return { stdout: '', exitCode: 1 };
      }
      return leaseGit(worker)(args, input);
    };

    await expect(forcePushWithExpectedLease({
      cwd: worker, slug: 'demo', branch: BRANCH, git: runner,
      remoteGit: recordingBoundary(worker, calls),
    })).resolves.toMatchObject({ kind: 'failed' });

    expect(calls).toEqual([]);
    expect(await ref(worker, pushedTipRef('demo', BRANCH))).toBeUndefined();
    expect(await ref(worker, pushedTipIntentRef('demo', BRANCH))).toBeUndefined();
  });
});
