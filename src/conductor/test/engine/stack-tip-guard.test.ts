// Covers: task:5, task:6, task:21, task:rem-prd-audit-rem-v3-divergence-mapping, task:rem-as-built-rem-asbuilt-d1-durable-ref-detection
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { parseChildId } from '../../src/engine/child-context.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { preparePushedTip, pushedTipRef } from '../../src/engine/push-lease.js';
import { readPublicationRecord, writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
import { authorizePublishedStackRefresh, refreshLedgerRefFor } from '../../src/engine/stack-refresh-ledger.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const roots: string[] = [];
const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const c5 = parseChildId(5)!;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function git(cwd: string, args: readonly string[]): Promise<{ stdout: string; exitCode: number }> {
  const result = await execa('git', [...args], { cwd, reject: false });
  return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
}

async function sha(cwd: string, ref: string): Promise<string> {
  const result = await git(cwd, ['rev-parse', '--verify', ref]);
  if (result.exitCode !== 0) throw new Error(`missing ${ref}`);
  return result.stdout.trim();
}

async function commit(repo: string, name: string): Promise<string> {
  await writeFile(join(repo, `${name}.txt`), `${name}\n`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', name]);
  return sha(repo, 'HEAD');
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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stack-tip-guard-'));
  roots.push(root);
  const repository = join(root, 'repository');
  const origin = join(root, 'origin.git');
  await mkdir(repository);
  await initTestRepo(repository);
  await writeFile(join(repository, '.gitignore'), '.pipeline/\n');
  await commit(repository, 'seed');
  await git(root, ['init', '--bare', '--initial-branch=main', origin]);
  await git(repository, ['remote', 'add', 'origin', origin]);

  await git(repository, ['checkout', '-b', 'feat/c1/demo']);
  const child1 = await commit(repository, 'child-1');
  await git(repository, ['push', 'origin', 'HEAD:refs/heads/feat/c1/demo']);
  await git(repository, ['checkout', '-b', 'feat/c3/demo']);
  const child3 = await commit(repository, 'child-3');
  await git(repository, ['push', 'origin', 'HEAD:refs/heads/feat/c3/demo']);
  await git(repository, ['checkout', '-b', 'feat/daemon-demo']);
  const leaf = await commit(repository, 'leaf');
  await git(repository, ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo']);

  const record: PublicationRecord = {
    version: 1,
    members: [
      { position: c1, branch: 'feat/c1/demo', pr: 101 },
      { position: c3, branch: 'feat/c3/demo', pr: 103 },
      { position: c5, branch: 'feat/daemon-demo', pr: 500 },
    ],
  };
  await writePublicationRecord(repository, 'demo', undefined, record);
  for (const [branch, tip] of [
    ['feat/c1/demo', child1], ['feat/c3/demo', child3], ['feat/daemon-demo', leaf],
  ] as const) {
    await git(repository, ['update-ref', pushedTipRef('demo', branch), tip]);
  }
  return { repository, origin, child1, child3, leaf };
}

function dependencies(repository: string, calls: string[][]) {
  return {
    cwd: repository,
    config: async () => ({ stdout: 'git@github.com:acme/rocket.git\n' }),
    runRemoteGit: async (args: string[]) => {
      calls.push(args);
      const result = await git(repository, args);
      if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);
      return { stdout: result.stdout };
    },
    mutation: mutation(),
  };
}

/**
 * The remote-Git adapter is deliberately a mock: a refusal may perform its
 * one read, but must never ask this boundary to transport a push.
 */
function readOnlyTransport(repository: string, calls: string[][]) {
  return vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'push') throw new Error('refused push reached transport');
    const result = await git(repository, args);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);
    return { stdout: result.stdout };
  });
}

async function writeRefreshLedger(repository: string, member: { branch: string; position: number; pr: number; publishedTip: string; recordedTip: string }): Promise<void> {
  const payload = JSON.stringify({ version: 1, members: { [member.branch]: member }, rounds: [], aboveOwed: [], posted: [] });
  // `git()` deliberately has no stdin seam; use the existing shell-free test
  // runner only for this one Git object write.
  const written = await execa('git', ['hash-object', '-w', '--stdin'], { cwd: repository, input: payload, reject: false });
  if ((written.exitCode ?? 1) !== 0) throw new Error('could not write refresh ledger');
  await git(repository, ['update-ref', refreshLedgerRefFor('demo'), written.stdout.trim()]);
}

describe('published stack tip guard', () => {
  it('leases a verified fast-forward from the recorded leaf tip after reading every member once', async () => {
    const { repository } = await fixture();
    const calls: string[][] = [];
    const next = await commit(repository, 'leaf-fast-forward');

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'],
      dependencies(repository, calls),
    )).resolves.toMatchObject({ kind: 'executed' });

    expect(await sha(repository, pushedTipRef('demo', 'feat/daemon-demo'))).toBe(next);
    expect(calls).toEqual([
      ['ls-remote', '--heads', 'origin', 'refs/heads/feat/c1/demo', 'refs/heads/feat/c3/demo', 'refs/heads/feat/daemon-demo'],
      ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo', `--force-with-lease=refs/heads/feat/daemon-demo:${await sha(repository, 'HEAD^')}`],
    ]);
  });

  it('adopts a completed child push intent before checking the whole stack', async () => {
    const { repository, child1 } = await fixture();
    const calls: string[][] = [];
    await git(repository, ['checkout', 'feat/c1/demo']);
    const advancedChild = await commit(repository, 'child-1-advanced');
    await git(repository, ['push', 'origin', 'HEAD:refs/heads/feat/c1/demo']);
    await expect(preparePushedTip({
      cwd: repository, slug: 'demo', branch: 'feat/c1/demo', new: advancedChild,
    })).resolves.toBeDefined();
    await git(repository, ['update-ref', pushedTipRef('demo', 'feat/c1/demo'), child1]);
    await git(repository, ['checkout', 'feat/daemon-demo']);

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'],
      dependencies(repository, calls),
    )).resolves.toMatchObject({ kind: 'executed' });

    expect(await sha(repository, pushedTipRef('demo', 'feat/c1/demo'))).toBe(advancedChild);
    expect(calls[0]).toEqual(['ls-remote', '--heads', 'origin', 'refs/heads/feat/c1/demo', 'refs/heads/feat/c3/demo', 'refs/heads/feat/daemon-demo']);
  });

  it('carries mismatched stack positions through a guard refusal without moving the destination', async () => {
    const { repository, origin, child1, leaf } = await fixture();
    const calls: string[][] = [];
    await git(origin, ['update-ref', 'refs/heads/feat/c3/demo', child1]);
    await commit(repository, 'leaf-after-rewrite');

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'],
      dependencies(repository, calls),
    )).resolves.toMatchObject({
      kind: 'refused',
      reason: 'stack-tip-mismatch',
      members: [{ pr: 103, position: c3 }],
    });

    expect(await sha(origin, 'refs/heads/feat/daemon-demo')).toBe(leaf);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('ls-remote');
  });

  it('refuses a source that does not contain the recorded leaf even when every remote member still agrees', async () => {
    const { repository, origin, leaf } = await fixture();
    const calls: string[][] = [];
    await git(repository, ['reset', '--hard', 'HEAD^']);

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'],
      dependencies(repository, calls),
    )).resolves.toMatchObject({ kind: 'refused', reason: 'stack-tip-mismatch' });

    expect(await sha(origin, 'refs/heads/feat/daemon-demo')).toBe(leaf);
    expect(calls).toHaveLength(1);
  });

  it('permits only FINISH to force a source descending from the recorded refresh tip', async () => {
    const { repository, origin, child1 } = await fixture();
    const calls: string[][] = [];
    await git(repository, ['checkout', 'feat/c1/demo']);
    await git(repository, ['reset', '--hard', 'main']);
    const recordedTip = await commit(repository, 'restacked-child');
    const source = await commit(repository, 'restacked-follow-up');
    await writeRefreshLedger(repository, {
      branch: 'feat/c1/demo', position: c1, pr: 101, publishedTip: child1, recordedTip,
    });

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/c1/demo'],
      { ...dependencies(repository, calls), publishedStackRefreshAuthorization: authorizePublishedStackRefresh('demo') },
    )).resolves.toMatchObject({ kind: 'executed' });

    expect(await sha(origin, 'refs/heads/feat/c1/demo')).toBe(source);
    expect(calls.at(-1)).toContain(`--force-with-lease=refs/heads/feat/c1/demo:${child1}`);
  });

  it('refuses an unauthorized rewrite descending from the ledger recorded tip before mocked transport', async () => {
    const { repository, origin, child1 } = await fixture();
    const calls: string[][] = [];
    const transport = readOnlyTransport(repository, calls);
    await git(repository, ['checkout', 'feat/c1/demo']);
    await git(repository, ['reset', '--hard', 'main']);
    const recordedTip = await commit(repository, 'restacked-child');
    const source = await commit(repository, 'restacked-follow-up');
    await writeRefreshLedger(repository, {
      branch: 'feat/c1/demo', position: c1, pr: 101, publishedTip: child1, recordedTip,
    });

    expect((await git(repository, ['merge-base', '--is-ancestor', recordedTip, source])).exitCode).toBe(0);

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/c1/demo'], {
        ...dependencies(repository, calls), runRemoteGit: transport,
      },
    )).resolves.toMatchObject({ kind: 'refused', reason: 'stack-tip-mismatch' });

    expect(await sha(origin, 'refs/heads/feat/c1/demo')).toBe(child1);
    expect(calls.map((call) => call[0])).toEqual(['ls-remote']);
    expect(transport.mock.calls.map(([args]) => args[0])).toEqual(['ls-remote']);
  });

  it('refuses an authorized rewrite whose source does not descend from the ledger recorded tip before mocked transport', async () => {
    const { repository, origin, child1 } = await fixture();
    const calls: string[][] = [];
    const transport = readOnlyTransport(repository, calls);
    await git(repository, ['checkout', 'feat/c1/demo']);
    await git(repository, ['reset', '--hard', 'main']);
    const recordedTip = await commit(repository, 'recorded-restack');
    await git(repository, ['reset', '--hard', 'main']);
    const source = await commit(repository, 'unrecorded-rewrite');
    await writeRefreshLedger(repository, {
      branch: 'feat/c1/demo', position: c1, pr: 101, publishedTip: child1, recordedTip,
    });

    expect((await git(repository, ['merge-base', '--is-ancestor', recordedTip, source])).exitCode).not.toBe(0);
    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/c1/demo'], {
        ...dependencies(repository, calls),
        runRemoteGit: transport,
        publishedStackRefreshAuthorization: authorizePublishedStackRefresh('demo'),
      },
    )).resolves.toMatchObject({ kind: 'refused', reason: 'stack-tip-mismatch' });

    expect(await sha(origin, 'refs/heads/feat/c1/demo')).toBe(child1);
    expect(calls.map((call) => call[0])).toEqual(['ls-remote']);
    expect(transport.mock.calls.map(([args]) => args[0])).toEqual(['ls-remote']);
  });

  it('names the mismatched member despite refresh authorization without reaching mocked transport', async () => {
    const { repository, origin, child1 } = await fixture();
    const calls: string[][] = [];
    const transport = readOnlyTransport(repository, calls);
    await git(origin, ['update-ref', 'refs/heads/feat/c3/demo', child1]);
    await git(repository, ['checkout', 'feat/c1/demo']);
    await git(repository, ['reset', '--hard', 'main']);
    const recordedTip = await commit(repository, 'restacked-child');
    await commit(repository, 'restacked-follow-up');
    await writeRefreshLedger(repository, {
      branch: 'feat/c1/demo', position: c1, pr: 101, publishedTip: child1, recordedTip,
    });

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/c1/demo'], {
        ...dependencies(repository, calls),
        runRemoteGit: transport,
        publishedStackRefreshAuthorization: authorizePublishedStackRefresh('demo'),
      },
    )).resolves.toMatchObject({
      kind: 'refused', reason: 'stack-tip-mismatch', members: [{ pr: 103, position: c3 }],
    });

    expect(await sha(origin, 'refs/heads/feat/c3/demo')).toBe(child1);
    expect(calls.map((call) => call[0])).toEqual(['ls-remote']);
    expect(transport.mock.calls.map(([args]) => args[0])).toEqual(['ls-remote']);
  });

  it('refuses an authorized rewrite with an unreadable ledger before mocked transport', async () => {
    const { repository, origin, child1 } = await fixture();
    const calls: string[][] = [];
    const transport = readOnlyTransport(repository, calls);
    await git(repository, ['checkout', 'feat/c1/demo']);
    await git(repository, ['reset', '--hard', 'main']);
    await commit(repository, 'unreadable-ledger-rewrite');
    const malformed = await execa('git', ['hash-object', '-w', '--stdin'], { cwd: repository, input: 'not json', reject: false });
    await git(repository, ['update-ref', refreshLedgerRefFor('demo'), malformed.stdout.trim()]);

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/c1/demo'], {
        ...dependencies(repository, calls),
        runRemoteGit: transport,
        publishedStackRefreshAuthorization: authorizePublishedStackRefresh('demo'),
      },
    )).resolves.toMatchObject({ kind: 'refused', reason: 'stack-tip-mismatch' });

    expect(await sha(origin, 'refs/heads/feat/c1/demo')).toBe(child1);
    expect(calls.map((call) => call[0])).toEqual(['ls-remote']);
    expect(transport.mock.calls.map(([args]) => args[0])).toEqual(['ls-remote']);
  });

  it('preserves the pushed receipt when a mocked lease rejection follows a remote move', async () => {
    const { repository, origin, child1, leaf } = await fixture();
    const calls: string[][] = [];
    await commit(repository, 'leaf-fast-forward');
    const transport = vi.fn(async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'ls-remote') {
        const result = await git(repository, args);
        return { stdout: result.stdout };
      }
      await git(origin, ['update-ref', 'refs/heads/feat/daemon-demo', child1]);
      throw new Error('stale lease');
    });

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'], {
        ...dependencies(repository, calls), runRemoteGit: transport,
      },
    )).resolves.toMatchObject({ kind: 'failed', error: 'stale lease' });

    expect(await sha(origin, 'refs/heads/feat/daemon-demo')).toBe(child1);
    expect(await sha(repository, pushedTipRef('demo', 'feat/daemon-demo'))).toBe(leaf);
    expect(calls.map((call) => call[0])).toEqual(['ls-remote', 'push']);
  });

  it('does not guard a stack record that has been torn down', async () => {
    const { repository } = await fixture();
    const calls: string[][] = [];
    const stored = await readPublicationRecord(repository, 'demo');
    if (stored.kind !== 'record') throw new Error('expected publication record');
    await expect(writePublicationRecord(repository, 'demo', stored, { ...stored.record, tornDown: true }))
      .resolves.toEqual({ kind: 'updated' });
    await commit(repository, 'new-feature-with-reused-slug');

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'],
      dependencies(repository, calls),
    )).resolves.toMatchObject({ kind: 'executed' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('push');
  });
});
