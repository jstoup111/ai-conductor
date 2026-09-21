// Covers: task:4
import { describe, expect, it, vi } from 'vitest';

import type { GithubOperationName, GithubOperationTarget } from '../../../src/engine/github-operations.js';
import type { OwnerResolution } from '../../../src/engine/owner-gate/identity.js';
import { makeMachineOwnerResolver } from '../../../src/engine/owner-gate/machine-identity.js';
import type {
  MutationProvenanceDiscovery,
  MutationProvenanceRequest,
} from '../../../src/engine/owner-gate/mutation-provenance.js';

const MUTATION_POLICY_MODULE = '../../../src/engine/owner-gate/mutation-policy.js';

type GithubMutationAuthorizationRequest = {
  operation: GithubOperationName;
  target: GithubOperationTarget;
  provenance: MutationProvenanceRequest;
};

type GithubMutationAuthorizationDependencies = {
  resolveMachineOwner: () => Promise<OwnerResolution>;
  provenanceDiscovery: MutationProvenanceDiscovery;
};

type MutationAuthorization =
  | {
    kind: 'authorized';
    actor: string;
    operation: GithubOperationName;
    target: GithubOperationTarget;
  }
  | {
    kind: 'refused';
    operation: GithubOperationName;
    target: GithubOperationTarget;
    reason: string;
  };

type MutationPolicyModule = {
  authorizeGithubMutation: (
    request: GithubMutationAuthorizationRequest,
    dependencies: GithubMutationAuthorizationDependencies,
  ) => Promise<MutationAuthorization>;
};

async function authorizeGithubMutation(
  request: GithubMutationAuthorizationRequest,
  dependencies: GithubMutationAuthorizationDependencies,
): Promise<MutationAuthorization> {
  const policy = await import(MUTATION_POLICY_MODULE) as unknown as MutationPolicyModule;
  return policy.authorizeGithubMutation(request, dependencies);
}

function request(overrides: Partial<GithubMutationAuthorizationRequest> = {}): GithubMutationAuthorizationRequest {
  return {
    operation: 'issue.comment.create',
    target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
    provenance: {
      repository: 'acme/rocket',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial',
    },
    ...overrides,
  };
}

function ownedRecord(owner: string, path = '.docs/specs/owned.md'): { path: string; content: string } {
  return { path, content: `Owner: ${owner}\n` };
}

describe('engine/owner-gate/mutation-policy — machine identity and committed feature authorization', () => {
  it('binds a provenance decision to its exact target rather than the repository alone', async () => {
    const provenance = {
      ...request().provenance,
      target: { repository: 'acme/rocket', kind: 'remote-ref' as const, ref: 'refs/heads/spec/owned' },
    };
    await expect(authorizeGithubMutation({
      ...request(),
      operation: 'remote-ref.push',
      target: { repository: 'acme/rocket', kind: 'remote-ref', ref: 'refs/heads/feature/foreign' },
      provenance,
    }, {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [ownedRecord('alice')] },
    })).resolves.toMatchObject({ kind: 'refused', reason: 'invalid-target' });
  });

  it('uses the machine-configured identity before the authenticated gh fallback and permits its matching committed owner', async () => {
    const ghFallback = vi.fn(async () => ({ stdout: 'other-login\n' }));
    const resolveMachineOwner = makeMachineOwnerResolver(
      ghFallback,
      '/fixture',
      async () => ({ config: { spec_owner: ' Alice ' } }),
    );
    const provenanceDiscovery = {
      readCommittedRecords: vi.fn(async () => [ownedRecord('alice')]),
    };

    await expect(authorizeGithubMutation(request(), { resolveMachineOwner, provenanceDiscovery })).resolves.toEqual({
      kind: 'authorized',
      actor: 'alice',
      operation: 'issue.comment.create',
      target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
    });
    expect(ghFallback).not.toHaveBeenCalled();
    expect(provenanceDiscovery.readCommittedRecords).toHaveBeenCalledWith({
      repository: 'acme/rocket',
      ref: 'spec/owned',
    });
  });

  it.each([
    ['a different committed owner', async () => ({ resolved: true as const, id: 'alice' }), async () => [ownedRecord('bob')], 'other-owner'],
    ['an unresolved machine actor', async () => ({ resolved: false as const }), async () => [ownedRecord('alice')], 'unresolved-actor'],
    ['missing committed ownership', async () => ({ resolved: true as const, id: 'alice' }), async () => [{ path: '.docs/specs/owned.md', content: '# no owner\n' }], 'missing-provenance'],
    ['conflicting committed ownership', async () => ({ resolved: true as const, id: 'alice' }), async () => [ownedRecord('alice'), ownedRecord('bob')], 'conflicting-provenance'],
    ['unreadable provenance evidence', async () => ({ resolved: true as const, id: 'alice' }), async () => { throw new Error('git show failed'); }, 'provenance-unreadable'],
    ['timed-out provenance evidence', async () => ({ resolved: true as const, id: 'alice' }), async () => { throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }); }, 'provenance-timeout'],
  ])('refuses %s with its typed reason before any GitHub mutation boundary can be reached', async (_caseName, resolveMachineOwner, records, reason) => {
    const provenanceDiscovery = { readCommittedRecords: vi.fn(records) };
    const denied = request();

    await expect(authorizeGithubMutation(denied, { resolveMachineOwner, provenanceDiscovery })).resolves.toEqual({
      kind: 'refused',
      operation: denied.operation,
      target: denied.target,
      reason,
    });
  });

  it('refuses a provenance record for a different repository instead of using it to authorize the target', async () => {
    const denied = request({
      provenance: {
        ...request().provenance,
        repository: 'acme/satellite',
      },
    });
    const provenanceDiscovery = { readCommittedRecords: vi.fn(async () => [ownedRecord('alice')]) };

    await expect(authorizeGithubMutation(denied, {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery,
    })).resolves.toEqual({
      kind: 'refused',
      operation: denied.operation,
      target: denied.target,
      reason: 'invalid-target',
    });
    expect(provenanceDiscovery.readCommittedRecords).not.toHaveBeenCalled();
  });

  it('uses the canonical repository-and-resource matcher for provenance binding', async () => {
    const canonicalized = request({
      target: { repository: 'Acme/Rocket', kind: 'issue', number: 17 },
    });
    const provenanceDiscovery = { readCommittedRecords: vi.fn(async () => [ownedRecord('alice')]) };

    await expect(authorizeGithubMutation(canonicalized, {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery,
    })).resolves.toEqual({
      kind: 'authorized',
      actor: 'alice',
      operation: 'issue.comment.create',
      target: { repository: 'Acme/Rocket', kind: 'issue', number: 17 },
    });
    expect(provenanceDiscovery.readCommittedRecords).toHaveBeenCalledWith({
      repository: 'acme/rocket',
      ref: 'spec/owned',
    });
  });

  it('returns an authorized decision whose canonical target cannot be changed by later caller mutation', async () => {
    const attempted = request();
    const provenanceDiscovery = { readCommittedRecords: vi.fn(async () => [ownedRecord('alice')]) };

    const decision = await authorizeGithubMutation(attempted, {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery,
    });
    (attempted.target as { repository: string }).repository = 'acme/satellite';

    expect(decision).toEqual({
      kind: 'authorized',
      actor: 'alice',
      operation: 'issue.comment.create',
      target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
    });
  });

  it('returns an authorized decision whose operation cannot be rewritten by the caller', async () => {
    const provenanceDiscovery = { readCommittedRecords: vi.fn(async () => [ownedRecord('alice')]) };

    const decision = await authorizeGithubMutation(request(), {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery,
    });
    expect(() => {
      (decision as { operation: GithubOperationName }).operation = 'issue.label.add';
    }).toThrow(TypeError);

    expect(decision).toMatchObject({
      kind: 'authorized',
      operation: 'issue.comment.create',
    });
  });

  it('re-resolves identity and committed provenance for every actor, operation, repository, target, and retry', async () => {
    const attempts = [
      request(),
      request({ provenance: { ...request().provenance, featureMarker: '.docs/specs/bob.md' } }),
      request({ operation: 'issue.label.add', provenance: { ...request().provenance, featureMarker: '.docs/specs/bob.md' } }),
      request({
        target: { repository: 'acme/satellite', kind: 'issue', number: 17 },
        provenance: { ...request().provenance, repository: 'acme/satellite', featureMarker: '.docs/specs/bob.md' },
      }),
      request({
        target: { repository: 'acme/satellite', kind: 'issue', number: 18 },
        provenance: { ...request().provenance, repository: 'acme/satellite', featureMarker: '.docs/specs/bob.md' },
      }),
      request({
        target: { repository: 'acme/satellite', kind: 'issue', number: 18 },
        provenance: { ...request().provenance, repository: 'acme/satellite', featureMarker: '.docs/specs/bob.md' },
      }),
    ];
    const resolveMachineOwner = vi.fn()
      .mockResolvedValueOnce({ resolved: true as const, id: 'alice' })
      .mockResolvedValue({ resolved: true as const, id: 'bob' });
    const provenanceDiscovery = {
      readCommittedRecords: vi.fn()
        .mockResolvedValueOnce([ownedRecord('alice')])
        .mockResolvedValue([ownedRecord('bob', '.docs/specs/bob.md')]),
    };

    const decisions: MutationAuthorization[] = [];
    for (const attempt of attempts) {
      decisions.push(await authorizeGithubMutation(attempt, { resolveMachineOwner, provenanceDiscovery }));
    }

    expect(decisions).toEqual(attempts.map((attempt, index) => ({
      kind: 'authorized',
      actor: index === 0 ? 'alice' : 'bob',
      operation: attempt.operation,
      target: attempt.target,
    })));
    expect(resolveMachineOwner).toHaveBeenCalledTimes(6);
    expect(provenanceDiscovery.readCommittedRecords).toHaveBeenCalledTimes(6);
    expect(provenanceDiscovery.readCommittedRecords).toHaveBeenNthCalledWith(4, {
      repository: 'acme/satellite',
      ref: 'spec/owned',
    });
    expect(provenanceDiscovery.readCommittedRecords).toHaveBeenNthCalledWith(5, {
      repository: 'acme/satellite',
      ref: 'spec/owned',
    });
    expect(provenanceDiscovery.readCommittedRecords).toHaveBeenNthCalledWith(6, {
      repository: 'acme/satellite',
      ref: 'spec/owned',
    });
  });
});
