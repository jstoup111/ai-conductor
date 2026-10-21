// Covers: task:28, task:rem-prd-audit-R13, task:rem-prd-audit-R13-2, task:rem-prd-audit-rem-v3-teardown-per-member, task:rem-as-built-rem-as-built-rem-v4-teardown-keep-vs-fail
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { parseChildId } from '../../src/engine/child-context.js';
import { enrollWatch, readWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { deleteStackChildren } from '../../src/engine/stack-teardown.js';
import { readPublicationRecord, writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
import { featureConductorRefNames } from '../../src/engine/restack/restack-refs-cleanup.js';

const record: PublicationRecord = {
  version: 1,
  members: [
    { position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 },
    { position: parseChildId(3)!, branch: 'feat/c3/demo', pr: 103 },
    { position: parseChildId(5)!, branch: 'feat/daemon-demo', pr: 500 },
  ],
};

function mergedGh() {
  return vi.fn(async (args: string[]) => {
    const pr = Number(args[2]);
    return {
      stdout: JSON.stringify({
        state: 'MERGED',
        headRefOid: `head-${pr}`,
        mergeCommit: { oid: `merge-${pr}` },
      }),
    };
  });
}

const cleanup: string[] = [];

async function runGit(cwd: string, args: string[], input?: string) {
  return execa('git', args, { cwd, input, reject: false });
}

describe('stack teardown', () => {
  it('reaps the worktree, then removes every sealed child and stack-only ref while retaining an unsealed decoy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-complete-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    const tip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', tip]);
    await runGit(root, ['branch', 'feat/c3/demo', tip]);
    await runGit(root, ['branch', 'feat/c7/demo', tip]);
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', tip]);
    const positions = await runGit(root, ['hash-object', '-w', '--stdin'], '[1,3,5]');
    await runGit(root, ['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
    await writePublicationRecord(root, 'demo', undefined, record);
    await enrollWatch(root, { prUrl: 'https://github.com/acme/demo/pull/500', slug: 'demo', repoCwd: root });
    const worktree = join(root, '.worktrees', 'demo');
    await mkdir(worktree, { recursive: true });
    await writeFile(join(worktree, 'retained-until-reap.txt'), 'present\n');

    const teardownWorktree = vi.fn(async ({ path }: { path: string }) => rm(path, { recursive: true, force: true }));
    const gh = vi.fn(async (_args: string[]) => ({
      stdout: JSON.stringify({
        state: 'MERGED',
        headRefOid: tip,
        mergeCommit: { oid: tip },
      }),
    }));

    await sweepMergeableLabels({
      projectRoot: root,
      runGh: gh,
      tracker: {
        readPullRequestMergeState: async () => ({
          state: 'MERGED' as const, mergeable: 'UNKNOWN' as const, hasFailingOrPendingChecks: false,
          labels: [], checksOutcome: 'none' as const, isDraft: false,
        }),
      },
      shippedRecordProbe: async () => 'present',
      teardownWorktree,
    });

    expect(teardownWorktree).toHaveBeenCalledWith(expect.objectContaining({ path: worktree }), false);
    await expect(access(worktree)).rejects.toThrow();
    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c3/demo'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c7/demo'])).resolves.toMatchObject({ exitCode: 0 });
    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/conductor/demo/positions'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/conductor/demo/publication'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(readWatch(root)).resolves.toEqual([]);
  });

  it('deletes every sealed child by its recorded head before deleting stack-only conductor refs', async () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push({ args, input: options?.input });
      if (args[0] === 'cat-file' && args[1] === '-p') return { exitCode: 0, stdout: '[1,3,5]', stderr: '' };
      if (args[0] === 'cat-file' && args[1] === '--batch-check') {
        return { exitCode: 0, stdout: (options?.input ?? '').trim().split('\n').map(() => 'missing missing').join('\n'), stderr: '' };
      }
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') {
        if (args.at(-1) === 'refs/conductor/demo/restack/journal') return { exitCode: 1, stdout: '', stderr: '' };
        return { exitCode: 0, stdout: args.at(-1) === 'refs/heads/feat/c1/demo' ? 'head-101\n' : 'head-103\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await expect(deleteStackChildren('/repo', 'demo', record, {
      git,
      gh: mergedGh(),
      repository: 'acme/demo',
    })).resolves.toEqual({ kind: 'deleted' });

    const firstChildDelete = calls.findIndex(({ args }) => args.join(' ') === 'update-ref -d refs/heads/feat/c1/demo head-101');
    const secondChildDelete = calls.findIndex(({ args }) => args.join(' ') === 'update-ref -d refs/heads/feat/c3/demo head-103');
    const stackRefDelete = calls.findIndex(({ args, input }) => args.join(' ') === 'update-ref --stdin'
      && input?.includes('delete refs/conductor/demo/positions')
      && input.includes('delete refs/conductor/demo/publication'));
    expect({ firstChildDelete, secondChildDelete, stackRefDelete }).toEqual({
      firstChildDelete: expect.any(Number),
      secondChildDelete: expect.any(Number),
      stackRefDelete: expect.any(Number),
    });
    expect(firstChildDelete).toBeLessThan(secondChildDelete);
    expect(secondChildDelete).toBeLessThan(stackRefDelete);
    expect(calls.map(({ args }) => args).some((args) => args.includes('refs/heads/feat/c7/demo'))).toBe(false);
    expect(featureConductorRefNames('demo')).toEqual(expect.not.arrayContaining([
      'refs/conductor/demo/positions',
      'refs/conductor/demo/publication',
    ]));
  });

  it('keeps only the non-ancestral member while deleting a later proven member by its exact local tip', async () => {
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: '[1,3,5]', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: args[2] === 'merge-101' ? 1 : 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') {
        return { exitCode: 0, stdout: args.at(-1) === 'refs/heads/feat/c1/demo' ? 'head-101\n' : 'head-103\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await expect(deleteStackChildren('/repo', 'demo', record, {
      git,
      gh: mergedGh(),
      repository: 'acme/demo',
    })).resolves.toEqual({ kind: 'kept' });

    expect(calls).toContainEqual(['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c1/demo']);
    expect(calls).toContainEqual(['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c3/demo']);
    expect(calls).toContainEqual(['update-ref', '-d', 'refs/heads/feat/c3/demo', 'head-103']);
    expect(calls).not.toContainEqual(['update-ref', '-d', 'refs/heads/feat/c1/demo', 'head-101']);
  });

  it('keeps an open member while deleting a later independently proven merged member', async () => {
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: '[1,3,5]', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: 'head-103\n', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const gh = vi.fn(async (args: string[]) => ({
      stdout: JSON.stringify(Number(args[2]) === 101
        ? { state: 'OPEN' }
        : { state: 'MERGED', headRefOid: 'head-103', mergeCommit: { oid: 'merge-103' } }),
    }));

    await expect(deleteStackChildren('/repo', 'demo', record, {
      git,
      gh,
      repository: 'acme/demo',
    })).resolves.toEqual({ kind: 'kept' });

    expect(calls).toContainEqual(['update-ref', '-d', 'refs/heads/feat/c3/demo', 'head-103']);
  });

  it('fails a local-ref probe error before acting on a non-ancestral member or later deletion', async () => {
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: '[1,3,5]', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: args[2] === 'merge-101' ? 1 : 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') {
        return args.at(-1) === 'refs/heads/feat/c1/demo'
          ? { exitCode: 128, stdout: '', stderr: 'injected local-ref probe failure' }
          : { exitCode: 0, stdout: 'head-103\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await expect(deleteStackChildren('/repo', 'demo', record, {
      git,
      gh: mergedGh(),
      repository: 'acme/demo',
    })).resolves.toEqual({ kind: 'failed' });

    expect(calls).not.toContainEqual(['update-ref', '-d', 'refs/heads/feat/c3/demo', 'head-103']);
  });

  it('stops on the first nonzero child deletion and leaves later members for retry', async () => {
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: '[1,3,5]', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') {
        return { exitCode: 0, stdout: args.at(-1) === 'refs/heads/feat/c1/demo' ? 'head-101\n' : 'head-103\n', stderr: '' };
      }
      if (args.join(' ') === 'update-ref -d refs/heads/feat/c1/demo head-101') {
        return { exitCode: 1, stdout: '', stderr: 'injected delete failure' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await expect(deleteStackChildren('/repo', 'demo', record, {
      git,
      gh: mergedGh(),
      repository: 'acme/demo',
    })).resolves.toEqual({ kind: 'failed' });

    expect(calls).toContainEqual(['update-ref', '-d', 'refs/heads/feat/c1/demo', 'head-101']);
    expect(calls).not.toContainEqual(['update-ref', '-d', 'refs/heads/feat/c3/demo', 'head-103']);
  });

  it('keeps an advanced child while deleting the other sealed member', async () => {
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: '[1,3,5]', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') {
        return { exitCode: 0, stdout: args.at(-1) === 'refs/heads/feat/c1/demo' ? 'advanced-101\n' : 'head-103\n', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await expect(deleteStackChildren('/repo', 'demo', record, {
      git,
      gh: mergedGh(),
      repository: 'acme/demo',
    })).resolves.toEqual({ kind: 'kept' });

    expect(calls).not.toContainEqual(['update-ref', '-d', 'refs/heads/feat/c1/demo', 'head-101']);
    expect(calls).toContainEqual(['update-ref', '-d', 'refs/heads/feat/c3/demo', 'head-103']);
  });

  it('keeps the watch entry after a partial delete and retries the remaining child from its plain tornDown receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-retry-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    const tip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', tip]);
    await runGit(root, ['branch', 'feat/c3/demo', tip]);
    await runGit(root, ['branch', 'feat/c7/demo', tip]);
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', tip]);
    const positions = await runGit(root, ['hash-object', '-w', '--stdin'], '[1,3,5]');
    await runGit(root, ['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
    await writePublicationRecord(root, 'demo', undefined, record);
    await enrollWatch(root, { prUrl: 'https://github.com/acme/demo/pull/500', slug: 'demo', repoCwd: root });

    const lock = join(root, '.git', 'refs', 'heads', 'feat', 'c3', 'demo.lock');
    await mkdir(join(root, '.git', 'refs', 'heads', 'feat', 'c3'), { recursive: true });
    await writeFile(lock, 'locked\n');
    const gh = vi.fn(async (_args: string[]) => ({
      stdout: JSON.stringify({
        state: 'MERGED',
        headRefOid: tip,
        mergeCommit: { oid: tip },
      }),
    }));
    const tracker = {
      readPullRequestMergeState: async () => ({
        state: 'MERGED' as const,
        mergeable: 'UNKNOWN' as const,
        hasFailingOrPendingChecks: false,
        labels: [],
        checksOutcome: 'none' as const,
        isDraft: false,
      }),
    };
    const teardownWorktree = vi.fn(async () => undefined);

    await sweepMergeableLabels({
      projectRoot: root,
      runGh: gh,
      tracker,
      shippedRecordProbe: async () => 'present',
      teardownWorktree,
    });

    expect(await readWatch(root)).toHaveLength(1);
    expect((await runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c1/demo'])).exitCode).toBe(1);
    expect((await runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c3/demo'])).exitCode).toBe(0);
    expect((await runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c7/demo'])).exitCode).toBe(0);

    const stored = await readPublicationRecord(root, 'demo');
    if (stored.kind !== 'record') throw new Error('expected the partial-teardown receipt');
    await writePublicationRecord(root, 'demo', stored, { ...stored.record, tornDown: true });
    await rm(lock);
    await sweepMergeableLabels({
      projectRoot: root,
      runGh: gh,
      tracker,
      shippedRecordProbe: async () => 'present',
      teardownWorktree,
    });

    expect(await readWatch(root)).toEqual([]);
    expect((await runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c3/demo'])).exitCode).toBe(1);
    expect((await runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c7/demo'])).exitCode).toBe(0);
    expect(teardownWorktree).toHaveBeenCalledOnce();
  });
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
