// Covers: task:25, task:26
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { enrollWatch, readWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { shippedRecordOnMain } from '../../src/engine/shipped-record-on-main.js';
import { readPublicationRecord, writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
import { verifyMemberReachability } from '../../src/engine/stack-publication.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execa('git', [...args], { cwd })).stdout;
}

async function commit(cwd: string, path: string, content: string, message: string): Promise<string> {
  await mkdir(join(cwd, path, '..'), { recursive: true });
  await writeFile(join(cwd, path), content);
  await git(cwd, ['add', path]);
  await git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

describe('stacked mergeable sweep shipping', () => {
  // Covers: task:25
  it('reaps only after the leaf shipped record is on origin/main, then proves every squash commit reaches main', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mergeable-sweep-stack-ship-'));
    cleanup.push(root);
    const origin = join(root, 'origin.git');
    const worktree = join(root, 'worktree');
    await execa('git', ['init', '--bare', origin]);
    await execa('git', ['init', '-b', 'main', worktree]);
    await git(worktree, ['config', 'user.email', 'stack@example.invalid']);
    await git(worktree, ['config', 'user.name', 'Stack sweep']);
    await git(worktree, ['remote', 'add', 'origin', origin]);

    await commit(worktree, 'base.txt', 'base\n', 'base');
    const c1 = await commit(worktree, 'c1.txt', 'c1\n', 'squash c1');
    const c3 = await commit(worktree, 'c3.txt', 'c3\n', 'squash c3');
    const c5 = await commit(worktree, 'c5.txt', 'c5\n', 'squash leaf');
    await commit(worktree, '.docs/shipped/demo.md', '# shipped demo\n', 'ship demo');
    await git(worktree, ['push', '--set-upstream', 'origin', 'main']);

    const record: PublicationRecord = {
      version: 1,
      members: [
        { position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 },
        { position: parseChildId(3)!, branch: 'feat/c3/demo', pr: 103 },
        { position: parseChildId(5)!, branch: 'feat/daemon-demo', pr: 500 },
      ],
    };
    await expect(writePublicationRecord(worktree, 'demo', undefined, record)).resolves.toEqual({ kind: 'updated' });
    await enrollWatch(worktree, {
      prUrl: 'https://github.com/acme/demo/pull/500', slug: 'demo', repoCwd: worktree,
    });

    const mergeCommits = new Map([[101, c1], [103, c3], [500, c5]]);
    const gh = vi.fn(async (args: string[]) => ({
      stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: mergeCommits.get(Number(args[2])) } }),
    }));
    const teardownWorktree = vi.fn(async () => undefined);
    const gitRunner = makeGitRunner(worktree);

    await sweepMergeableLabels({
      projectRoot: worktree,
      runGh: gh,
      tracker: {
        readPullRequestMergeState: async () => ({
          state: 'MERGED', mergeable: 'UNKNOWN', hasFailingOrPendingChecks: false,
          labels: [], checksOutcome: 'none', isDraft: false,
        }),
      },
      shippedRecordProbe: (cwd, slug) => shippedRecordOnMain(cwd, slug, async (args) => {
        const result = await gitRunner(args);
        if (result.exitCode !== 0) throw new Error(result.stderr);
        return { stdout: result.stdout, stderr: result.stderr };
      }),
      teardownWorktree,
    });

    expect(teardownWorktree).toHaveBeenCalledOnce();
    expect(gh.mock.calls.map(([args]) => args.slice(0, 6))).toEqual([
      ['pr', 'view', '101', '-R', 'acme/demo', '--json'],
      ['pr', 'view', '103', '-R', 'acme/demo', '--json'],
      ['pr', 'view', '500', '-R', 'acme/demo', '--json'],
    ]);
    await expect(readPublicationRecord(worktree, 'demo')).resolves.toMatchObject({ kind: 'record', record });
    await expect(readWatch(worktree)).resolves.toEqual([
      expect.objectContaining({ slug: 'demo', prUrl: 'https://github.com/acme/demo/pull/500' }),
    ]);
  });

  // Covers: task:25
  it('does not accept a merged member whose squash commit is outside origin/main', async () => {
    const c1 = parseChildId(1)!;
    const c3 = parseChildId(3)!;
    const record: PublicationRecord = {
      version: 1,
      members: [
        { position: c1, branch: 'feat/c1/demo', pr: 101 },
        { position: c3, branch: 'feat/c3/demo', pr: 103 },
      ],
    };
    const git = vi.fn(async (args: string[]) => ({
      exitCode: args[2] === 'reachable' ? 0 : 1,
      stdout: '', stderr: '',
    }));
    const gh = vi.fn(async (args: string[]) => ({
      stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: Number(args[2]) === 101 ? 'reachable' : 'not-on-main' } }),
    }));

    await expect(verifyMemberReachability('/repo', record, { git, gh, repository: 'acme/demo' }))
      .resolves.toEqual({ kind: 'unreachable', member: record.members[1] });
  });

  // Covers: task:26
  it('reports an unreachable member once, keeps its branch, and durably retires the stack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mergeable-sweep-stack-unreachable-'));
    cleanup.push(root);
    const origin = join(root, 'origin.git');
    const worktree = join(root, 'worktree');
    await execa('git', ['init', '--bare', origin]);
    await execa('git', ['init', '-b', 'main', worktree]);
    await git(worktree, ['config', 'user.email', 'stack@example.invalid']);
    await git(worktree, ['config', 'user.name', 'Stack sweep']);
    await git(worktree, ['remote', 'add', 'origin', origin]);
    await commit(worktree, 'base.txt', 'base\n', 'base');
    const c1 = await commit(worktree, 'c1.txt', 'c1\n', 'squash c1');
    const c5 = await commit(worktree, 'c5.txt', 'c5\n', 'squash leaf');
    await commit(worktree, '.docs/shipped/demo.md', '# shipped demo\n', 'ship demo');
    await git(worktree, ['push', '--set-upstream', 'origin', 'main']);
    await git(worktree, ['checkout', '-b', 'unreachable']);
    const c3 = await commit(worktree, 'c3.txt', 'c3\n', 'squash c3');
    await git(worktree, ['checkout', 'main']);
    await git(worktree, ['branch', 'feat/c3/demo', c3]);

    const record: PublicationRecord = {
      version: 1,
      members: [
        { position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 },
        { position: parseChildId(3)!, branch: 'feat/c3/demo', pr: 103 },
        { position: parseChildId(5)!, branch: 'feat/daemon-demo', pr: 500 },
      ],
    };
    await writePublicationRecord(worktree, 'demo', undefined, record);
    await enrollWatch(worktree, { prUrl: 'https://github.com/acme/demo/pull/500', slug: 'demo', repoCwd: worktree });

    const events: unknown[] = [];
    const teardownWorktree = vi.fn(async () => undefined);
    const gitRunner = makeGitRunner(worktree);
    const gh = vi.fn(async (args: string[]) => ({
      stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: new Map([[101, c1], [103, c3], [500, c5]]).get(Number(args[2])) } }),
    }));
    const options = {
      projectRoot: worktree,
      runGh: gh,
      tracker: { readPullRequestMergeState: async () => ({ state: 'MERGED' as const, mergeable: 'UNKNOWN' as const, hasFailingOrPendingChecks: false, labels: [], checksOutcome: 'none' as const, isDraft: false }) },
      shippedRecordProbe: (cwd: string, slug: string) => shippedRecordOnMain(cwd, slug, async (args) => {
        const result = await gitRunner(args);
        if (result.exitCode !== 0) throw new Error(result.stderr);
        return { stdout: result.stdout, stderr: result.stderr };
      }),
      teardownWorktree,
      onEvent: (event: unknown) => events.push(event),
    };

    await sweepMergeableLabels(options);
    await sweepMergeableLabels(options);

    expect(events).toEqual([{ type: 'stack_members_unreachable', child: parseChildId(3), pr: 103 }]);
    await expect(readPublicationRecord(worktree, 'demo')).resolves.toMatchObject({
      kind: 'record', record: { unreachableReported: true, tornDown: true },
    });
    await expect(git(worktree, ['rev-parse', '--verify', 'feat/c3/demo'])).resolves.toBe(c3);
    await expect(readWatch(worktree)).resolves.toHaveLength(1);
  });

  // Covers: task:26
  it('retains an unreadable member observation without deleting stack state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mergeable-sweep-stack-unreadable-'));
    cleanup.push(root);
    const origin = join(root, 'origin.git');
    const worktree = join(root, 'worktree');
    await execa('git', ['init', '--bare', origin]);
    await execa('git', ['init', '-b', 'main', worktree]);
    await git(worktree, ['config', 'user.email', 'stack@example.invalid']);
    await git(worktree, ['config', 'user.name', 'Stack sweep']);
    await git(worktree, ['remote', 'add', 'origin', origin]);
    await commit(worktree, 'base.txt', 'base\n', 'base');
    await commit(worktree, '.docs/shipped/demo.md', '# shipped demo\n', 'ship demo');
    await git(worktree, ['push', '--set-upstream', 'origin', 'main']);
    const record: PublicationRecord = { version: 1, members: [
      { position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 },
      { position: parseChildId(3)!, branch: 'feat/c3/demo', pr: 103 },
    ] };
    await writePublicationRecord(worktree, 'demo', undefined, record);
    await enrollWatch(worktree, { prUrl: 'https://github.com/acme/demo/pull/103', slug: 'demo', repoCwd: worktree });
    const teardownWorktree = vi.fn(async () => undefined);
    const gitRunner = makeGitRunner(worktree);

    await sweepMergeableLabels({
      projectRoot: worktree,
      runGh: vi.fn(async () => { throw new Error('GitHub read failed'); }),
      tracker: { readPullRequestMergeState: async () => ({ state: 'MERGED', mergeable: 'UNKNOWN', hasFailingOrPendingChecks: false, labels: [], checksOutcome: 'none', isDraft: false }) },
      shippedRecordProbe: (cwd, slug) => shippedRecordOnMain(cwd, slug, async (args) => {
        const result = await gitRunner(args);
        if (result.exitCode !== 0) throw new Error(result.stderr);
        return { stdout: result.stdout, stderr: result.stderr };
      }),
      teardownWorktree,
    });

    expect(teardownWorktree).toHaveBeenCalledOnce();
    await expect(readPublicationRecord(worktree, 'demo')).resolves.toMatchObject({ kind: 'record', record });
    await expect(readWatch(worktree)).resolves.toHaveLength(1);
  });

  // Covers: task:26
  it('does not ship or tear down a dissolved stack whose leaf merged into a child branch', async () => {
    const teardownWorktree = vi.fn(async () => undefined);
    const shippedRecordProbe = vi.fn(async () => 'absent' as const);
    const root = await mkdtemp(join(tmpdir(), 'mergeable-sweep-stack-dissolved-'));
    cleanup.push(root);
    await enrollWatch(root, { prUrl: 'https://github.com/acme/demo/pull/500', slug: 'demo', repoCwd: root });

    await sweepMergeableLabels({
      projectRoot: root,
      tracker: { readPullRequestMergeState: async () => ({ state: 'MERGED', mergeable: 'UNKNOWN', hasFailingOrPendingChecks: false, labels: [], checksOutcome: 'none', isDraft: false }) },
      shippedRecordProbe,
      teardownWorktree,
    });

    expect(shippedRecordProbe).toHaveBeenCalledWith(root, 'demo');
    expect(teardownWorktree).not.toHaveBeenCalled();
    await expect(readWatch(root)).resolves.toHaveLength(1);
  });
});
