// Covers: task:19
import { describe, expect, it, vi } from 'vitest';

import { executeRemoteGit } from '../../../src/engine/remote-git-operations.js';
import type { GithubMutationExecutionContext } from '../../../src/engine/tracker-client.js';

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
