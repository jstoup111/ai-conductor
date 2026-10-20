// Covers: task:21, task:rem-prd-audit-R10, task:rem-prd-audit-rem-v3-divergence-mapping
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { parseChildId } from '../../src/engine/child-context.js';
import { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { preparePushedTip, pushedTipRef } from '../../src/engine/push-lease.js';
import { readPublicationRecord, writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
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
