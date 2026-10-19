// Covers: task:25
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
});
