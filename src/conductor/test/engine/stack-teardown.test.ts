// Covers: task:1, task:2, task:3, task:4, task:5, task:28, task:rem-prd-audit-R13, task:rem-prd-audit-R13-2, task:rem-prd-audit-rem-v3-teardown-per-member, task:rem-as-built-rem-as-built-rem-v4-teardown-keep-vs-fail
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { parseChildId } from '../../src/engine/child-context.js';
import { enrollWatch, readWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import { accountForChildCommits, deleteStackChildren } from '../../src/engine/stack-teardown.js';
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

async function accountingFixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), `stack-teardown-unaccounted-${name}-`));
  cleanup.push(root);
  await runGit(root, ['init', '-q', '-b', 'main']);
  await runGit(root, ['config', 'user.email', 'stack@example.test']);
  await runGit(root, ['config', 'user.name', 'Stack teardown']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await runGit(root, ['add', 'base.txt']);
  await runGit(root, ['commit', '-qm', 'base']);
  const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGit(root, ['checkout', '-qb', 'child-work']);
  await writeFile(join(root, 'child.txt'), 'child\n');
  await runGit(root, ['add', 'child.txt']);
  await runGit(root, ['commit', '-qm', 'child']);
  const pushed = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGit(root, ['branch', 'feat/c1/demo', pushed]);
  await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushed]);
  return { root, base, pushed };
}

async function teardownFailureFixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), `stack-teardown-failure-${name}-`));
  cleanup.push(root);
  await runGit(root, ['init', '-q', '-b', 'main']);
  await runGit(root, ['config', 'user.email', 'stack@example.test']);
  await runGit(root, ['config', 'user.name', 'Stack teardown']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await runGit(root, ['add', 'base.txt']);
  await runGit(root, ['commit', '-qm', 'base']);
  const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

  await runGit(root, ['checkout', '-qb', 'child-one']);
  await writeFile(join(root, 'child-one.txt'), 'pushed\n');
  await runGit(root, ['add', 'child-one.txt']);
  await runGit(root, ['commit', '-qm', 'child one pushed']);
  const pushedOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGit(root, ['branch', 'feat/c1/demo', pushedOne]);
  await mkdir(join(root, '.docs', 'halted'), { recursive: true });
  await writeFile(join(root, '.docs', 'halted', 'demo.md'), 'local bookkeeping\n');
  await runGit(root, ['add', '.docs/halted/demo.md']);
  await runGit(root, ['commit', '-qm', 'local halt record']);
  const localOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGit(root, ['update-ref', 'refs/heads/feat/c1/demo', localOne]);

  await runGit(root, ['checkout', '-qb', 'merged-head-one', pushedOne]);
  await writeFile(join(root, 'merged-one.txt'), 'merged\n');
  await runGit(root, ['add', 'merged-one.txt']);
  await runGit(root, ['commit', '-qm', 'merged child one head']);
  const headOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

  await runGit(root, ['checkout', '-qb', 'child-three', base]);
  await writeFile(join(root, 'child-three.txt'), 'merged\n');
  await runGit(root, ['add', 'child-three.txt']);
  await runGit(root, ['commit', '-qm', 'child three merged']);
  const headThree = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGit(root, ['branch', 'feat/c3/demo', headThree]);

  await runGit(root, ['checkout', '-q', 'main']);
  await runGit(root, ['merge', '--no-ff', headOne, '-m', 'merge child one head']);
  await runGit(root, ['merge', '--no-ff', headThree, '-m', 'merge child three']);
  const main = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
  await runGit(root, ['update-ref', 'refs/remotes/origin/main', main]);
  await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushedOne]);
  await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c3/demo', headThree]);
  const pushIntent = await runGit(root, ['hash-object', '-w', '--stdin'], JSON.stringify({ new: pushedOne }));
  await runGit(root, ['update-ref', 'refs/conductor/demo/push-intent/feat/c1/demo', pushIntent.stdout.trim()]);
  const positions = await runGit(root, ['hash-object', '-w', '--stdin'], '[1,3,5]');
  await runGit(root, ['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
  await writePublicationRecord(root, 'demo', undefined, record);

  return { root, pushedOne, localOne, headOne, headThree };
}

describe('stack teardown', () => {
  it('accounts for a present merged head that contains the pushed child after main and a fix advance it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-accounted-present-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    await runGit(root, ['checkout', '-qb', 'child-work']);
    await writeFile(join(root, 'child-1.txt'), 'one\n');
    await runGit(root, ['add', 'child-1.txt']);
    await runGit(root, ['commit', '-qm', 'child one']);
    await writeFile(join(root, 'child-2.txt'), 'two\n');
    await runGit(root, ['add', 'child-2.txt']);
    await runGit(root, ['commit', '-qm', 'child two']);
    const pushed = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', pushed]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushed]);
    await runGit(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'main.txt'), 'main\n');
    await runGit(root, ['add', 'main.txt']);
    await runGit(root, ['commit', '-qm', 'main advance']);
    await runGit(root, ['checkout', '-q', 'child-work']);
    await runGit(root, ['merge', '--no-ff', 'main', '-m', 'merge main']);
    await writeFile(join(root, 'fix.txt'), 'fix\n');
    await runGit(root, ['add', 'fix.txt']);
    await runGit(root, ['commit', '-qm', 'ci fix']);
    const mergedHead = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push(args);
      return runGit(root, args, options?.input);
    });

    await expect(accountForChildCommits({
      slug: 'demo',
      branch: 'feat/c1/demo',
      localTip: pushed,
      mergedHead,
      git,
    })).resolves.toEqual({ kind: 'accounted' });

    expect(calls.some(([command]) => command === 'fetch')).toBe(false);
  });

  it('accounts for a server-side rebase that rewrites every pushed child commit onto a new base', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-accounted-rebase-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    await runGit(root, ['checkout', '-qb', 'child-work']);
    await writeFile(join(root, 'child-1.txt'), 'one\n');
    await runGit(root, ['add', 'child-1.txt']);
    await runGit(root, ['commit', '-qm', 'child one']);
    await writeFile(join(root, 'child-2.txt'), 'two\n');
    await runGit(root, ['add', 'child-2.txt']);
    await runGit(root, ['commit', '-qm', 'child two']);
    const pushed = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', pushed]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushed]);
    await runGit(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'new-base.txt'), 'new base\n');
    await runGit(root, ['add', 'new-base.txt']);
    await runGit(root, ['commit', '-qm', 'new base']);
    await runGit(root, ['checkout', '-q', 'child-work']);
    await runGit(root, ['rebase', 'main']);
    const mergedHead = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const common = (await runGit(root, ['merge-base', pushed, mergedHead])).stdout.trim();
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push(args);
      return runGit(root, args, options?.input);
    });

    expect(common).not.toBe(pushed);
    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip: pushed, mergedHead, git }))
      .resolves.toEqual({ kind: 'accounted' });
    expect(calls).toContainEqual(['rev-list', pushed, '--not', pushed, mergedHead]);
  });

  it('fetches an absent merged head from origin before accounting for the local child tip', async () => {
    const { root, pushed } = await accountingFixture('fetch-merged-head');
    const origin = join(root, 'origin.git');
    const publisher = join(root, 'publisher');
    await runGit(root, ['init', '--bare', '-q', origin]);
    await runGit(root, ['remote', 'add', 'origin', origin]);
    await runGit(root, ['push', '-q', 'origin', 'main:main']);
    await runGit(root, ['push', '-q', 'origin', `child-work:merged-head`]);
    await runGit(root, ['clone', '-q', origin, publisher]);
    await runGit(publisher, ['config', 'user.email', 'stack@example.test']);
    await runGit(publisher, ['config', 'user.name', 'Stack teardown']);
    await runGit(publisher, ['checkout', '-q', 'merged-head']);
    await writeFile(join(publisher, 'merged.txt'), 'merged\n');
    await runGit(publisher, ['add', 'merged.txt']);
    await runGit(publisher, ['commit', '-qm', 'merged head']);
    const mergedHead = (await runGit(publisher, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(publisher, ['push', '-q', 'origin', 'HEAD:merged-head']);
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push(args);
      return runGit(root, args, options?.input);
    });

    expect((await runGit(root, ['cat-file', '-e', `${mergedHead}^{commit}`])).exitCode).not.toBe(0);
    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip: pushed, mergedHead, git }))
      .resolves.toEqual({ kind: 'accounted' });
    expect(calls).toContainEqual(['fetch', 'origin', mergedHead]);
    await expect(runGit(root, ['cat-file', '-e', `${mergedHead}^{commit}`])).resolves.toMatchObject({ exitCode: 0 });
  });

  it('fails closed when an absent merged head cannot be fetched without reading its range', async () => {
    const mergedHead = 'merged-head';
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'cat-file' && args[1] === '-e' && args[2] === `${mergedHead}^{commit}`) {
        return { exitCode: 1, stdout: '', stderr: '' };
      }
      if (args[0] === 'fetch' && args[1] === 'origin' && args[2] === mergedHead) {
        return { exitCode: 128, stdout: '', stderr: 'not found' };
      }
      return { exitCode: 0, stdout: 'pushed-tip\n', stderr: '' };
    });

    await expect(accountForChildCommits({
      slug: 'demo', branch: 'feat/c1/demo', localTip: 'local-tip', mergedHead, git,
    })).resolves.toEqual({ kind: 'failed' });
    expect(calls).toContainEqual(['cat-file', '-e', `${mergedHead}^{commit}`]);
    expect(calls).toContainEqual(['fetch', 'origin', mergedHead]);
    expect(calls.some(([command]) => command === 'rev-list')).toBe(false);
  });

  it('rejects one production-file commit beyond the pushed and merged tips', async () => {
    const { root, pushed } = await accountingFixture('production-file');
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'feature.ts'), 'export const feature = true;\n');
    await runGit(root, ['add', 'src/feature.ts']);
    await runGit(root, ['commit', '-qm', 'production change']);
    const localTip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const git = vi.fn((args: string[], options?: { input?: string }) => runGit(root, args, options?.input));

    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip, mergedHead: pushed, git }))
      .resolves.toEqual({ kind: 'unaccounted' });
  });

  it('rejects one other-slug halt record beyond the pushed and merged tips', async () => {
    const { root, pushed } = await accountingFixture('other-halt-record');
    await mkdir(join(root, '.docs', 'halted'), { recursive: true });
    await writeFile(join(root, '.docs', 'halted', 'other.md'), 'other feature\n');
    await runGit(root, ['add', '.docs/halted/other.md']);
    await runGit(root, ['commit', '-qm', 'other halt record']);
    const localTip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const git = vi.fn((args: string[], options?: { input?: string }) => runGit(root, args, options?.input));

    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip, mergedHead: pushed, git }))
      .resolves.toEqual({ kind: 'unaccounted' });
  });

  it('rejects one own halt-record commit that also changes a production path', async () => {
    const { root, pushed } = await accountingFixture('halt-record-plus-source');
    await mkdir(join(root, '.docs', 'halted'), { recursive: true });
    await mkdir(join(root, 'src'));
    await writeFile(join(root, '.docs', 'halted', 'demo.md'), 'this feature\n');
    await writeFile(join(root, 'src', 'x.ts'), 'export const x = true;\n');
    await runGit(root, ['add', '.docs/halted/demo.md', 'src/x.ts']);
    await runGit(root, ['commit', '-qm', 'halt record plus source']);
    const localTip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const git = vi.fn((args: string[], options?: { input?: string }) => runGit(root, args, options?.input));

    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip, mergedHead: pushed, git }))
      .resolves.toEqual({ kind: 'unaccounted' });
  });

  it('rejects a no-ff merge when it is the only commit beyond the pushed and merged tips', async () => {
    const { root, pushed } = await accountingFixture('merge');
    await runGit(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'main.txt'), 'main\n');
    await runGit(root, ['add', 'main.txt']);
    await runGit(root, ['commit', '-qm', 'main advance']);
    const mergedHead = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['checkout', '-q', 'child-work']);
    await runGit(root, ['merge', '--no-ff', 'main', '-m', 'merge main']);
    const localTip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const listed = (await runGit(root, ['rev-list', localTip, '--not', pushed, mergedHead])).stdout.trim().split('\n');
    const git = vi.fn((args: string[], options?: { input?: string }) => runGit(root, args, options?.input));

    expect(listed).toEqual([localTip]);
    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip, mergedHead, git }))
      .resolves.toEqual({ kind: 'unaccounted' });
  });

  it('rejects an absent-child commit without a pushed ref and omits a pushed argument from rev-list', async () => {
    const { root, base, pushed } = await accountingFixture('missing-pushed-ref');
    await runGit(root, ['update-ref', '-d', 'refs/conductor/demo/pushed/feat/c1/demo']);
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push(args);
      return runGit(root, args, options?.input);
    });

    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip: pushed, mergedHead: base, git }))
      .resolves.toEqual({ kind: 'unaccounted' });
    expect(calls).toContainEqual(['rev-list', pushed, '--not', base]);
  });

  it('accounts for halt-record-only commits beyond the pushed tip using the real Git classifiers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-accounted-halt-records-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    await runGit(root, ['checkout', '-qb', 'child-work']);
    await writeFile(join(root, 'child-1.txt'), 'one\n');
    await runGit(root, ['add', 'child-1.txt']);
    await runGit(root, ['commit', '-qm', 'child one']);
    await writeFile(join(root, 'child-2.txt'), 'two\n');
    await runGit(root, ['add', 'child-2.txt']);
    await runGit(root, ['commit', '-qm', 'child two']);
    const pushed = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', pushed]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushed]);
    await mkdir(join(root, '.docs', 'halted'), { recursive: true });
    await writeFile(join(root, '.docs', 'halted', 'demo.md'), 'first\n');
    await runGit(root, ['add', '.docs/halted/demo.md']);
    await runGit(root, ['commit', '-qm', 'halt record one']);
    const firstHaltRecord = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(root, '.docs', 'halted', 'demo.md'), 'second\n');
    await runGit(root, ['add', '.docs/halted/demo.md']);
    await runGit(root, ['commit', '-qm', 'halt record two']);
    const localTip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const listed = (await runGit(root, ['rev-list', localTip, '--not', pushed, pushed])).stdout.trim().split('\n');
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push(args);
      return runGit(root, args, options?.input);
    });

    expect(listed).toEqual([localTip, firstHaltRecord]);
    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip, mergedHead: pushed, git }))
      .resolves.toEqual({ kind: 'accounted' });
    expect(calls).toContainEqual(['rev-list', localTip, '--not', pushed, pushed]);
    for (const commit of listed) {
      expect(calls).toContainEqual(['rev-list', '--parents', '-n', '1', commit]);
      expect(calls).toContainEqual(['diff-tree', '--no-commit-id', '--name-only', '-r', `${commit}^`, commit]);
    }
  });

  it('accounts for a local tip ahead of the pushed tip when the merged head contains it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-accounted-local-ahead-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    await runGit(root, ['checkout', '-qb', 'child-work']);
    await writeFile(join(root, 'child-1.txt'), 'one\n');
    await runGit(root, ['add', 'child-1.txt']);
    await runGit(root, ['commit', '-qm', 'child one']);
    await writeFile(join(root, 'child-2.txt'), 'two\n');
    await runGit(root, ['add', 'child-2.txt']);
    await runGit(root, ['commit', '-qm', 'child two']);
    const pushed = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', pushed]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushed]);
    await writeFile(join(root, 'local-after-push.txt'), 'local\n');
    await runGit(root, ['add', 'local-after-push.txt']);
    await runGit(root, ['commit', '-qm', 'local after push']);
    const localTip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(root, 'merged-after-local.txt'), 'merged\n');
    await runGit(root, ['add', 'merged-after-local.txt']);
    await runGit(root, ['commit', '-qm', 'merged after local']);
    const mergedHead = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const git = vi.fn((args: string[], options?: { input?: string }) => runGit(root, args, options?.input));

    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip, mergedHead, git }))
      .resolves.toEqual({ kind: 'accounted' });
  });

  it('accounts for an unchanged local and merged tip without reading ranges or fetching', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-accounted-equal-tips-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    const tip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const calls: string[][] = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push(args);
      return runGit(root, args, options?.input);
    });

    await expect(accountForChildCommits({ slug: 'demo', branch: 'feat/c1/demo', localTip: tip, mergedHead: tip, git }))
      .resolves.toEqual({ kind: 'accounted' });
    expect(calls.some(([command]) => command === 'rev-list' || command === 'fetch')).toBe(false);
  });

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

  it('reaps merged children whose heads moved after their pushed tips and removes their explicit receipts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-moved-head-sweep-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

    await runGit(root, ['checkout', '-qb', 'child-one']);
    await writeFile(join(root, 'child-one.txt'), 'pushed\n');
    await runGit(root, ['add', 'child-one.txt']);
    await runGit(root, ['commit', '-qm', 'child one pushed']);
    const pushedOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', pushedOne]);

    await runGit(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'main.txt'), 'main\n');
    await runGit(root, ['add', 'main.txt']);
    await runGit(root, ['commit', '-qm', 'main advance']);
    await runGit(root, ['checkout', '-q', 'child-one']);
    await runGit(root, ['merge', '--no-ff', 'main', '-m', 'merge main']);
    await writeFile(join(root, 'ci-fix.txt'), 'fix\n');
    await runGit(root, ['add', 'ci-fix.txt']);
    await runGit(root, ['commit', '-qm', 'CI fix']);
    const headOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

    await runGit(root, ['checkout', '-qb', 'child-three', base]);
    await writeFile(join(root, 'child-three.txt'), 'pushed\n');
    await runGit(root, ['add', 'child-three.txt']);
    await runGit(root, ['commit', '-qm', 'child three pushed']);
    const pushedThree = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await mkdir(join(root, '.docs', 'halted'), { recursive: true });
    await writeFile(join(root, '.docs', 'halted', 'demo.md'), 'first\n');
    await runGit(root, ['add', '.docs/halted/demo.md']);
    await runGit(root, ['commit', '-qm', 'halt one']);
    await writeFile(join(root, '.docs', 'halted', 'demo.md'), 'second\n');
    await runGit(root, ['add', '.docs/halted/demo.md']);
    await runGit(root, ['commit', '-qm', 'halt two']);
    const localThree = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c3/demo', localThree]);

    await runGit(root, ['checkout', '-q', 'main']);
    await runGit(root, ['merge', '--no-ff', 'child-one', '-m', 'merge child one']);
    await runGit(root, ['merge', '--no-ff', pushedThree, '-m', 'merge child three']);
    const main = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', main]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushedOne]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c3/demo', pushedThree]);
    const pushIntent = await runGit(root, ['hash-object', '-w', '--stdin'], JSON.stringify({ new: pushedOne }));
    await runGit(root, ['update-ref', 'refs/conductor/demo/push-intent/feat/c1/demo', pushIntent.stdout.trim()]);
    const positions = await runGit(root, ['hash-object', '-w', '--stdin'], '[1,3,5]');
    await runGit(root, ['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
    await writePublicationRecord(root, 'demo', undefined, record);
    await enrollWatch(root, { prUrl: 'https://github.com/acme/demo/pull/500', slug: 'demo', repoCwd: root });

    const gh = vi.fn(async (args: string[]) => {
      const pr = Number(args[2]);
      const heads: Record<number, string> = { 101: headOne, 103: pushedThree, 500: main };
      return { stdout: JSON.stringify({ state: 'MERGED', headRefOid: heads[pr], mergeCommit: { oid: heads[pr] } }) };
    });
    await sweepMergeableLabels({
      projectRoot: root,
      runGh: gh,
      tracker: { readPullRequestMergeState: async () => ({
        state: 'MERGED' as const, mergeable: 'UNKNOWN' as const, hasFailingOrPendingChecks: false,
        labels: [], checksOutcome: 'none' as const,
      }) },
      shippedRecordProbe: async () => 'present',
      teardownWorktree: vi.fn(async () => undefined),
    });

    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c3/demo'])).resolves.toMatchObject({ exitCode: 1 });
    await expect(readWatch(root)).resolves.toEqual([]);
    for (const ref of [
      'refs/conductor/demo/pushed/feat/c1/demo',
      'refs/conductor/demo/push-intent/feat/c1/demo',
      'refs/conductor/demo/positions',
      'refs/conductor/demo/publication',
    ]) {
      await expect(runGit(root, ['rev-parse', '--quiet', '--verify', ref])).resolves.toMatchObject({ exitCode: 1 });
    }
  });

  it('deletes moved merged heads by their local tips and explicitly cleans their receipts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-moved-head-direct-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

    await runGit(root, ['checkout', '-qb', 'child-one']);
    await writeFile(join(root, 'child-one.txt'), 'pushed\n');
    await runGit(root, ['add', 'child-one.txt']);
    await runGit(root, ['commit', '-qm', 'child one pushed']);
    const pushedOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', pushedOne]);
    await runGit(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'main.txt'), 'main\n');
    await runGit(root, ['add', 'main.txt']);
    await runGit(root, ['commit', '-qm', 'main advance']);
    await runGit(root, ['checkout', '-q', 'child-one']);
    await runGit(root, ['merge', '--no-ff', 'main', '-m', 'merge main']);
    await writeFile(join(root, 'ci-fix.txt'), 'fix\n');
    await runGit(root, ['add', 'ci-fix.txt']);
    await runGit(root, ['commit', '-qm', 'CI fix']);
    const headOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

    await runGit(root, ['checkout', '-qb', 'child-three', base]);
    await writeFile(join(root, 'child-three.txt'), 'pushed\n');
    await runGit(root, ['add', 'child-three.txt']);
    await runGit(root, ['commit', '-qm', 'child three pushed']);
    const pushedThree = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await mkdir(join(root, '.docs', 'halted'), { recursive: true });
    await writeFile(join(root, '.docs', 'halted', 'demo.md'), 'first\n');
    await runGit(root, ['add', '.docs/halted/demo.md']);
    await runGit(root, ['commit', '-qm', 'halt one']);
    await writeFile(join(root, '.docs', 'halted', 'demo.md'), 'second\n');
    await runGit(root, ['add', '.docs/halted/demo.md']);
    await runGit(root, ['commit', '-qm', 'halt two']);
    const localThree = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c3/demo', localThree]);

    await runGit(root, ['checkout', '-q', 'main']);
    await runGit(root, ['merge', '--no-ff', 'child-one', '-m', 'merge child one']);
    await runGit(root, ['merge', '--no-ff', pushedThree, '-m', 'merge child three']);
    const main = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', main]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushedOne]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c3/demo', pushedThree]);
    const pushIntent = await runGit(root, ['hash-object', '-w', '--stdin'], JSON.stringify({ new: pushedOne }));
    await runGit(root, ['update-ref', 'refs/conductor/demo/push-intent/feat/c1/demo', pushIntent.stdout.trim()]);
    const positions = await runGit(root, ['hash-object', '-w', '--stdin'], '[1,3,5]');
    await runGit(root, ['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
    await writePublicationRecord(root, 'demo', undefined, record);
    const calls: Array<{ args: string[]; input?: string }> = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push({ args, input: options?.input });
      return runGit(root, args, options?.input);
    });
    const gh = vi.fn(async (args: string[]) => {
      const pr = Number(args[2]);
      const heads: Record<number, string> = { 101: headOne, 103: pushedThree };
      return { stdout: JSON.stringify({ state: 'MERGED', headRefOid: heads[pr], mergeCommit: { oid: heads[pr] } }) };
    });

    await expect(deleteStackChildren(root, 'demo', record, { git, gh, repository: 'acme/demo' }))
      .resolves.toEqual({ kind: 'deleted' });
    expect(calls).toContainEqual(expect.objectContaining({ args: ['update-ref', '-d', 'refs/heads/feat/c1/demo', pushedOne] }));
    expect(calls).toContainEqual(expect.objectContaining({ args: ['update-ref', '-d', 'refs/heads/feat/c3/demo', localThree] }));
    const cleanupInputs = calls.filter(({ args }) => args.join(' ') === 'update-ref --stdin').map(({ input }) => input ?? '').join('\n');
    for (const ref of [
      'refs/conductor/demo/pushed/feat/c1/demo',
      'refs/conductor/demo/push-intent/feat/c1/demo',
      'refs/conductor/demo/positions',
      'refs/conductor/demo/publication',
    ]) {
      expect(cleanupInputs).toContain(`delete ${ref}`);
      await expect(runGit(root, ['rev-parse', '--quiet', '--verify', ref])).resolves.toMatchObject({ exitCode: 1 });
    }
    expect(calls.some(({ args }) => args[0] === 'for-each-ref')).toBe(false);
  });

  it('fails before mutation when the merged head cannot be fetched for a locally advanced child', async () => {
    const { root, localOne, headOne, headThree } = await teardownFailureFixture('missing-head-fetch');
    const calls: Array<{ args: string[]; input?: string }> = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push({ args, input: options?.input });
      if (args.join(' ') === `cat-file -e ${headOne}^{commit}`) return { exitCode: 1, stdout: '', stderr: 'injected missing head' };
      if (args.join(' ') === `fetch origin ${headOne}`) return { exitCode: 128, stdout: '', stderr: 'injected fetch failure' };
      return runGit(root, args, options?.input);
    });
    const gh = vi.fn(async (args: string[]) => ({
      stdout: JSON.stringify({
        state: 'MERGED', headRefOid: Number(args[2]) === 101 ? headOne : headThree,
        mergeCommit: { oid: Number(args[2]) === 101 ? headOne : headThree },
      }),
    }));

    await expect(deleteStackChildren(root, 'demo', record, { git, gh, repository: 'acme/demo' }))
      .resolves.toEqual({ kind: 'failed' });

    await expect(runGit(root, ['rev-parse', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ stdout: localOne });
    await expect(runGit(root, ['rev-parse', 'refs/heads/feat/c3/demo'])).resolves.toMatchObject({ stdout: headThree });
    for (const ref of [
      'refs/conductor/demo/pushed/feat/c1/demo',
      'refs/conductor/demo/pushed/feat/c3/demo',
      'refs/conductor/demo/push-intent/feat/c1/demo',
      'refs/conductor/demo/positions',
      'refs/conductor/demo/publication',
    ]) {
      await expect(runGit(root, ['rev-parse', '--quiet', '--verify', ref])).resolves.toMatchObject({ exitCode: 0 });
    }
    expect(calls.some(({ args }) => args.join(' ') === 'update-ref --stdin')).toBe(false);
  });

  it('fails without cleaning receipts when the child branch moves after accounting and before its CAS delete', async () => {
    const { root, localOne, headOne, headThree } = await teardownFailureFixture('moved-before-cas');
    const moved = (await runGit(root, ['commit-tree', `${localOne}^{tree}`, '-p', localOne, '-m', 'branch moved after proof'])).stdout.trim();
    const calls: Array<{ args: string[]; input?: string }> = [];
    let movedBranch = false;
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push({ args, input: options?.input });
      if (!movedBranch && args.join(' ') === `update-ref -d refs/heads/feat/c1/demo ${localOne}`) {
        movedBranch = true;
        await runGit(root, ['update-ref', 'refs/heads/feat/c1/demo', moved]);
      }
      return runGit(root, args, options?.input);
    });
    const gh = vi.fn(async (args: string[]) => ({
      stdout: JSON.stringify({
        state: 'MERGED', headRefOid: Number(args[2]) === 101 ? headOne : headThree,
        mergeCommit: { oid: Number(args[2]) === 101 ? headOne : headThree },
      }),
    }));

    await expect(deleteStackChildren(root, 'demo', record, { git, gh, repository: 'acme/demo' }))
      .resolves.toEqual({ kind: 'failed' });

    await expect(runGit(root, ['rev-parse', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ stdout: moved });
    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/conductor/demo/publication'])).resolves.toMatchObject({ exitCode: 0 });
    expect(calls.some(({ args }) => args.join(' ') === 'update-ref --stdin')).toBe(false);
  });

  it('stops before the next child when range enumeration fails during accounting', async () => {
    const { root, localOne, headOne, headThree } = await teardownFailureFixture('rev-list-failure');
    const calls: Array<{ args: string[]; input?: string }> = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push({ args, input: options?.input });
      if (args[0] === 'rev-list') return { exitCode: 128, stdout: '', stderr: 'injected rev-list failure' };
      return runGit(root, args, options?.input);
    });
    const gh = vi.fn(async (args: string[]) => ({
      stdout: JSON.stringify({
        state: 'MERGED', headRefOid: Number(args[2]) === 101 ? headOne : headThree,
        mergeCommit: { oid: Number(args[2]) === 101 ? headOne : headThree },
      }),
    }));

    await expect(deleteStackChildren(root, 'demo', record, { git, gh, repository: 'acme/demo' }))
      .resolves.toEqual({ kind: 'failed' });

    await expect(runGit(root, ['rev-parse', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ stdout: localOne });
    await expect(runGit(root, ['rev-parse', 'refs/heads/feat/c3/demo'])).resolves.toMatchObject({ stdout: headThree });
    expect(calls).not.toContainEqual(expect.objectContaining({ args: ['update-ref', '-d', 'refs/heads/feat/c3/demo', headThree] }));
  });

  it('stops before the next child when commit-path classification fails during accounting', async () => {
    const { root, localOne, headOne, headThree } = await teardownFailureFixture('diff-tree-failure');
    const calls: Array<{ args: string[]; input?: string }> = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push({ args, input: options?.input });
      if (args[0] === 'diff-tree') return { exitCode: 128, stdout: '', stderr: 'injected diff-tree failure' };
      return runGit(root, args, options?.input);
    });
    const gh = vi.fn(async (args: string[]) => ({
      stdout: JSON.stringify({
        state: 'MERGED', headRefOid: Number(args[2]) === 101 ? headOne : headThree,
        mergeCommit: { oid: Number(args[2]) === 101 ? headOne : headThree },
      }),
    }));

    await expect(deleteStackChildren(root, 'demo', record, { git, gh, repository: 'acme/demo' }))
      .resolves.toEqual({ kind: 'failed' });

    await expect(runGit(root, ['rev-parse', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ stdout: localOne });
    await expect(runGit(root, ['rev-parse', 'refs/heads/feat/c3/demo'])).resolves.toMatchObject({ stdout: headThree });
    expect(calls).not.toContainEqual(expect.objectContaining({ args: ['update-ref', '-d', 'refs/heads/feat/c3/demo', headThree] }));
  });

  it('keeps an unaccounted child while deleting a sibling whose local and merged heads agree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-unaccounted-child-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();

    await runGit(root, ['checkout', '-qb', 'child-one']);
    await writeFile(join(root, 'child-one.txt'), 'pushed\n');
    await runGit(root, ['add', 'child-one.txt']);
    await runGit(root, ['commit', '-qm', 'child one pushed']);
    const pushedOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'app.ts'), 'export const app = true;\n');
    await runGit(root, ['add', 'src/app.ts']);
    await runGit(root, ['commit', '-qm', 'unaccounted app change']);
    const localOne = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', localOne]);

    await runGit(root, ['checkout', '-qb', 'child-three', base]);
    await writeFile(join(root, 'child-three.txt'), 'merged\n');
    await runGit(root, ['add', 'child-three.txt']);
    await runGit(root, ['commit', '-qm', 'child three merged']);
    const headThree = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c3/demo', headThree]);

    await runGit(root, ['checkout', '-q', 'main']);
    await runGit(root, ['merge', '--no-ff', pushedOne, '-m', 'merge child one pushed']);
    await runGit(root, ['merge', '--no-ff', headThree, '-m', 'merge child three']);
    const main = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', main]);
    await runGit(root, ['update-ref', 'refs/conductor/demo/pushed/feat/c1/demo', pushedOne]);
    const positions = await runGit(root, ['hash-object', '-w', '--stdin'], '[1,3,5]');
    await runGit(root, ['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
    const calls: Array<{ args: string[]; input?: string }> = [];
    const git = vi.fn(async (args: string[], options?: { input?: string }) => {
      calls.push({ args, input: options?.input });
      return runGit(root, args, options?.input);
    });
    const gh = vi.fn(async (args: string[]) => {
      const pr = Number(args[2]);
      const heads: Record<number, string> = { 101: pushedOne, 103: headThree };
      return { stdout: JSON.stringify({ state: 'MERGED', headRefOid: heads[pr], mergeCommit: { oid: heads[pr] } }) };
    });

    await expect(deleteStackChildren(root, 'demo', record, { git, gh, repository: 'acme/demo' }))
      .resolves.toEqual({ kind: 'kept' });
    await expect(runGit(root, ['rev-parse', 'refs/heads/feat/c1/demo'])).resolves.toMatchObject({ stdout: localOne });
    await expect(runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c3/demo'])).resolves.toMatchObject({ exitCode: 1 });
    expect(calls).toContainEqual(expect.objectContaining({ args: ['update-ref', '-d', 'refs/heads/feat/c3/demo', headThree] }));
    expect(calls.some(({ args }) => args[0] === 'for-each-ref')).toBe(false);
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
      if (args.join(' ') === 'cat-file -p refs/conductor/demo/positions') {
        return { exitCode: 0, stdout: '[1,3,5]', stderr: '' };
      }
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'merge-base') return { exitCode: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') {
        if (args.at(-1) === 'refs/heads/feat/c1/demo') return { exitCode: 0, stdout: 'advanced-101\n', stderr: '' };
        if (args.at(-1) === 'refs/conductor/demo/pushed/feat/c1/demo') return { exitCode: 0, stdout: 'head-101\n', stderr: '' };
        return { exitCode: 0, stdout: 'head-103\n', stderr: '' };
      }
      if (args.join(' ') === 'rev-list advanced-101 --not head-101 head-101') {
        return { exitCode: 0, stdout: 'advanced-101\n', stderr: '' };
      }
      if (args.join(' ') === 'rev-list --parents -n 1 advanced-101') {
        return { exitCode: 0, stdout: 'advanced-101 parent-101\n', stderr: '' };
      }
      if (args.join(' ') === 'diff-tree --no-commit-id --name-only -r advanced-101^ advanced-101') {
        return { exitCode: 0, stdout: 'src/app.ts\n', stderr: '' };
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

  // Covers: #3401
  it('drops the watch entry and logs the reap when a lagging child branch is kept', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stack-teardown-kept-'));
    cleanup.push(root);
    await runGit(root, ['init', '-q', '-b', 'main']);
    await runGit(root, ['config', 'user.email', 'stack@example.test']);
    await runGit(root, ['config', 'user.name', 'Stack teardown']);
    await writeFile(join(root, 'base.txt'), 'base\n');
    await runGit(root, ['add', 'base.txt']);
    await runGit(root, ['commit', '-qm', 'base']);
    const lagging = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(root, 'head.txt'), 'head\n');
    await runGit(root, ['add', 'head.txt']);
    await runGit(root, ['commit', '-qm', 'merged head']);
    const tip = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c1/demo', tip]);
    await runGit(root, ['checkout', '-qb', 'lagging-child', lagging]);
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'app.ts'), 'export const app = true;\n');
    await runGit(root, ['add', 'src/app.ts']);
    await runGit(root, ['commit', '-qm', 'unaccounted app change']);
    const unaccounted = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'feat/c3/demo', unaccounted]);
    await runGit(root, ['checkout', '-q', 'main']);
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', tip]);
    const positions = await runGit(root, ['hash-object', '-w', '--stdin'], '[1,3,5]');
    await runGit(root, ['update-ref', 'refs/conductor/demo/positions', positions.stdout.trim()]);
    await writePublicationRecord(root, 'demo', undefined, record);
    await enrollWatch(root, { prUrl: 'https://github.com/acme/demo/pull/500', slug: 'demo', repoCwd: root });

    const gh = vi.fn(async (_args: string[]) => ({
      stdout: JSON.stringify({ state: 'MERGED', headRefOid: tip, mergeCommit: { oid: tip } }),
    }));
    const log = vi.fn();
    const sweep = () => sweepMergeableLabels({
      projectRoot: root,
      runGh: gh,
      tracker: {
        readPullRequestMergeState: async () => ({
          state: 'MERGED' as const, mergeable: 'UNKNOWN' as const, hasFailingOrPendingChecks: false,
          labels: [], checksOutcome: 'none' as const, isDraft: false,
        }),
      },
      shippedRecordProbe: async () => 'present',
      teardownWorktree: vi.fn(async () => undefined),
      log,
    });

    await sweep();

    expect(await readWatch(root)).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      '[mergeable-sweep] reaped demo — reason: shipped-record-on-main (stack members kept, record tornDown)',
    );
    expect((await runGit(root, ['rev-parse', '--quiet', '--verify', 'refs/heads/feat/c1/demo'])).exitCode).toBe(1);
    expect((await runGit(root, ['rev-parse', 'refs/heads/feat/c3/demo'])).stdout.trim()).toBe(unaccounted);
    await expect(readPublicationRecord(root, 'demo')).resolves.toMatchObject({ kind: 'record', record: { tornDown: true } });

    const readsAfterFirstSweep = gh.mock.calls.length;
    await sweep();
    expect(gh).toHaveBeenCalledTimes(readsAfterFirstSweep);
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
    const log = vi.fn();

    await sweepMergeableLabels({
      projectRoot: root,
      runGh: gh,
      tracker,
      shippedRecordProbe: async () => 'present',
      teardownWorktree,
      log,
    });

    expect(await readWatch(root)).toHaveLength(1);
    expect(log).toHaveBeenCalledWith('[mergeable-sweep] retained demo — reason: stack-teardown-failed');
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
