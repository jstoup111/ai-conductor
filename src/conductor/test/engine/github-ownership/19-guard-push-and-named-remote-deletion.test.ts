// Covers: task:19
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { executeRemoteGit } from '../../../src/engine/remote-git-operations.js';
import type { GithubMutationExecutionContext } from '../../../src/engine/tracker-client.js';
import { initTestRepo } from '../../fixtures/git-repo.js';

const execFile = promisify(execFileCb);
const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function runGit(cwd: string, args: readonly string[]): Promise<{ readonly stdout: string }> {
  const { stdout } = await execFile('git', [...args], { cwd });
  return { stdout };
}

async function createLocalRemoteFixture(remoteRefs: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), 'remote-git-ownership-'));
  scratchDirs.push(root);
  const repository = join(root, 'repository');
  const remote = join(root, 'origin.git');
  await mkdir(repository);
  await initTestRepo(repository);
  await writeFile(join(repository, 'fixture.txt'), 'initial fixture state\n');
  await runGit(repository, ['add', '.']);
  await runGit(repository, ['commit', '-m', 'test: seed local remote fixture']);
  await runGit(root, ['init', '--bare', '--initial-branch=main', remote]);

  // The resolver recognizes the GitHub URL while Git directs its write to this
  // fixture-owned bare remote through pushurl; no third-party remote is used.
  await runGit(repository, ['remote', 'add', 'origin', 'git@github.com:acme/rocket.git']);
  await runGit(repository, ['config', 'remote.origin.pushurl', remote]);
  await runGit(repository, ['push', 'origin', ...remoteRefs.map((ref) => `HEAD:${ref}`)]);

  return { repository, remote };
}

async function bareRef(remote: string, ref: string): Promise<string> {
  return (await runGit(remote, ['rev-parse', ref])).stdout.trim();
}

function configReader(url = 'git@github.com:acme/rocket.git') {
  return vi.fn().mockResolvedValue({ stdout: `${url}\n` });
}

function mutationContext(resolveMachineOwner = vi.fn().mockResolvedValue({ resolved: true as const, id: 'alice' })) {
  return {
    provenance: {
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial' as const,
    },
    dependencies: {
      resolveMachineOwner,
      provenanceDiscovery: {
        readCommittedRecords: vi.fn().mockResolvedValue([
          { path: '.docs/specs/owned.md', content: 'Owner: alice\n' },
        ]),
      },
    },
  } satisfies GithubMutationExecutionContext;
}

describe('engine/remote-git-operations — guarded remote writes', () => {
  it('refuses a foreign ref from an otherwise owned worktree before any remote write', async () => {
    const runRemoteGit = vi.fn().mockResolvedValue({ stdout: '' });
    const baseMutation = mutationContext();
    const mutation = {
      ...baseMutation,
      provenance: {
        ...baseMutation.provenance,
        target: { repository: 'acme/rocket', kind: 'remote-ref' as const, ref: 'refs/heads/spec/owned' },
      },
    } satisfies GithubMutationExecutionContext;

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feature/foreign'],
      { cwd: '/owned-worktree', config: configReader(), runRemoteGit, mutation },
    )).resolves.toMatchObject({ kind: 'refused', reason: 'invalid-target' });
    expect(runRemoteGit).not.toHaveBeenCalled();
  });

  it('authorizes the complete explicit push set before exactly one injected remote write', async () => {
    const config = configReader();
    const runRemoteGit = vi.fn().mockResolvedValue({ stdout: '' });
    const mutation = mutationContext();
    const args = ['push', 'origin', 'HEAD:refs/heads/feature/one', 'HEAD:refs/heads/feature/two'];

    await expect(executeRemoteGit(args, { cwd: '/fixture', config, runRemoteGit, mutation })).resolves.toEqual({
      kind: 'executed',
      targets: [
        { operation: 'remote-ref.push', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/one' },
        { operation: 'remote-ref.push', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/two' },
      ],
    });
    expect(mutation.dependencies.resolveMachineOwner).toHaveBeenCalledTimes(2);
    expect(mutation.dependencies.provenanceDiscovery.readCommittedRecords).toHaveBeenCalledTimes(2);
    expect(runRemoteGit).toHaveBeenCalledOnce();
    expect(runRemoteGit).toHaveBeenCalledWith(args, { cwd: '/fixture' });
  });

  it('updates only the explicitly requested remote refs in a fixture-owned bare repository', async () => {
    const { repository, remote } = await createLocalRemoteFixture([
      'refs/heads/feature/one',
      'refs/heads/feature/two',
      'refs/heads/feature/untouched',
    ]);
    const untouchedBefore = await bareRef(remote, 'refs/heads/feature/untouched');
    await writeFile(join(repository, 'fixture.txt'), 'updated fixture state\n');
    await runGit(repository, ['add', '.']);
    await runGit(repository, ['commit', '-m', 'test: advance owned source']);
    const expectedCommit = (await runGit(repository, ['rev-parse', 'HEAD'])).stdout.trim();

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feature/one', 'HEAD:refs/heads/feature/two'],
      {
        cwd: repository,
        config: (args) => runGit(repository, args),
        runRemoteGit: (args, options) => runGit(options.cwd, args),
        mutation: mutationContext(),
      },
    )).resolves.toEqual({
      kind: 'executed',
      targets: [
        { operation: 'remote-ref.push', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/one' },
        { operation: 'remote-ref.push', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/two' },
      ],
    });

    await expect(bareRef(remote, 'refs/heads/feature/one')).resolves.toBe(expectedCommit);
    await expect(bareRef(remote, 'refs/heads/feature/two')).resolves.toBe(expectedCommit);
    await expect(bareRef(remote, 'refs/heads/feature/untouched')).resolves.toBe(untouchedBefore);
  });

  it('refuses the whole push before the fake process boundary when one resolved ref loses authorization', async () => {
    const config = configReader();
    const runRemoteGit = vi.fn().mockResolvedValue({ stdout: '' });
    const mutation = mutationContext(vi.fn()
      .mockResolvedValueOnce({ resolved: true as const, id: 'alice' })
      .mockResolvedValueOnce({ resolved: true as const, id: 'bob' }));

    await expect(executeRemoteGit(
      ['push', 'origin', 'HEAD:refs/heads/feature/one', 'HEAD:refs/heads/feature/two'],
      { cwd: '/fixture', config, runRemoteGit, mutation },
    )).resolves.toEqual({
      kind: 'refused',
      reason: 'other-owner',
      target: { operation: 'remote-ref.push', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/two' },
    });
    expect(runRemoteGit).not.toHaveBeenCalled();
  });

  it('executes an authorized named deletion only for its explicit destination ref', async () => {
    const runRemoteGit = vi.fn().mockResolvedValue({ stdout: '' });

    await expect(executeRemoteGit(
      ['push', 'origin', '--delete', 'refs/heads/feature/obsolete'],
      { cwd: '/fixture', config: configReader(), runRemoteGit, mutation: mutationContext() },
    )).resolves.toEqual({
      kind: 'executed',
      targets: [{ operation: 'remote-ref.delete', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/obsolete' }],
    });
    expect(runRemoteGit).toHaveBeenCalledWith(
      ['push', 'origin', '--delete', 'refs/heads/feature/obsolete'],
      { cwd: '/fixture' },
    );
  });

  it('removes only its named ref from a fixture-owned bare repository', async () => {
    const { repository, remote } = await createLocalRemoteFixture([
      'refs/heads/feature/obsolete',
      'refs/heads/feature/retained',
    ]);
    const retainedBefore = await bareRef(remote, 'refs/heads/feature/retained');

    await expect(executeRemoteGit(
      ['push', 'origin', '--delete', 'refs/heads/feature/obsolete'],
      {
        cwd: repository,
        config: (args) => runGit(repository, args),
        runRemoteGit: (args, options) => runGit(options.cwd, args),
        mutation: mutationContext(),
      },
    )).resolves.toEqual({
      kind: 'executed',
      targets: [{ operation: 'remote-ref.delete', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/obsolete' }],
    });

    await expect(bareRef(remote, 'refs/heads/feature/obsolete')).rejects.toThrow();
    await expect(bareRef(remote, 'refs/heads/feature/retained')).resolves.toBe(retainedBefore);
  });

  it('reports a force-with-lease failure without a plain-force fallback or retry', async () => {
    const runRemoteGit = vi.fn().mockRejectedValue(new Error('stale info'));
    const args = ['push', '--force-with-lease', 'origin', 'HEAD:refs/heads/feature/owned'];

    await expect(executeRemoteGit(
      args,
      { cwd: '/fixture', config: configReader(), runRemoteGit, mutation: mutationContext() },
    )).resolves.toEqual({
      kind: 'failed',
      error: 'stale info',
      targets: [{ operation: 'remote-ref.push', repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/owned' }],
    });
    expect(runRemoteGit).toHaveBeenCalledTimes(1);
    expect(runRemoteGit).toHaveBeenCalledWith(args, { cwd: '/fixture' });
    expect(runRemoteGit).not.toHaveBeenCalledWith(
      ['push', '--force', 'origin', 'HEAD:refs/heads/feature/owned'],
      { cwd: '/fixture' },
    );
  });
});
