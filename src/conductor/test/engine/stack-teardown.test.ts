// Covers: task:rem-prd-audit-rem-v3-teardown-per-member
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { parseChildId } from '../../src/engine/child-context.js';
import { enrollWatch, readWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { deleteStackChildren } from '../../src/engine/stack-teardown.js';
import { readPublicationRecord, writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';

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
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', tip]);
    const positions = await runGit(root, ['hash-object', '-w', '--stdin'], '[1,3,5]');
    await runGit(root, ['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
    await writePublicationRecord(root, 'demo', undefined, record);
    await enrollWatch(root, { prUrl: 'https://github.com/acme/demo/pull/500', slug: 'demo', repoCwd: root });

    const lock = join(root, '.git', 'refs', 'heads', 'feat', 'c3', 'demo.lock');
    await mkdir(join(root, '.git', 'refs', 'heads', 'feat', 'c3'), { recursive: true });
    await writeFile(lock, 'locked\n');
    const gh = vi.fn(async (args: string[]) => ({
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
    expect(teardownWorktree).toHaveBeenCalledOnce();
  });
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
