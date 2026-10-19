import { describe, expect, it, vi } from 'vitest';

import { executeGithubOperation } from '../../../src/engine/github-operations.js';
import { createGuardedGithubOperationRunner, type GhRunner } from '../../../src/engine/tracker-client.js';

const repository = 'acme/owned';

function mutation(owner: string, target?: { readonly repository: string; readonly kind: 'repository' | 'stack' | 'pull-request'; readonly number?: number }) {
  return {
    provenance: {
      repository,
      defaultBranch: 'main',
      specBranch: 'feat/daemon-demo',
      featureMarker: '.docs/intake/demo.md',
      publication: 'initial' as const,
      ...(target === undefined ? {} : { target: target as never }),
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true as const, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/intake/demo.md', content: `Owner: ${owner}\n` }] },
    },
  };
}

describe('stack mutation ownership', () => {
  it('binds repository stack creation to committed ownership and reaches the terminal only for its owner', async () => {
    const terminal = vi.fn<GhRunner>(async () => ({ stdout: '{}' }));
    const operations = createGuardedGithubOperationRunner(terminal, {
      cwd: '/fixture',
      // Initial creation starts from the leaf ref, not the repository target.
      mutation: mutation('alice', { repository, kind: 'pull-request', number: 500 }),
    });

    await expect(executeGithubOperation({
      operation: 'stack.create', repository, resource: { kind: 'repository' }, context: { actor: 'finish' },
      payload: { pullRequests: [101, 103, 500] },
    }, operations)).resolves.toMatchObject({ kind: 'executed' });
    expect(terminal).toHaveBeenCalledOnce();

    const foreignTerminal = vi.fn<GhRunner>(async () => ({ stdout: '{}' }));
    const foreign = createGuardedGithubOperationRunner(foreignTerminal, {
      cwd: '/fixture', mutation: mutation('bob'),
    });
    for (const request of [
      { operation: 'stack.read', resource: { kind: 'repository' }, payload: { pullRequest: 101 } },
      { operation: 'stack.create', resource: { kind: 'repository' }, payload: { pullRequests: [101, 103, 500] } },
      { operation: 'stack.add', resource: { kind: 'stack', number: 9 }, payload: { pullRequests: [500] } },
      { operation: 'pull-request.retarget', resource: { kind: 'pull-request', number: 500 }, payload: { base: 'feat/c3/demo' } },
    ] as const) {
      await expect(executeGithubOperation({ ...request, repository, context: { actor: 'finish' } }, foreign))
        .resolves.toMatchObject({ kind: 'refused', reason: 'other-owner' });
    }
    expect(foreignTerminal).not.toHaveBeenCalled();
  });
});
