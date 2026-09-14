// Covers: task:14
import { describe, expect, it, vi } from 'vitest';

import type { GithubOperationRequest } from '../../../src/engine/github-operations.js';

const CREATION_CONTEXT_MODULE = '../../../src/engine/github-creation-context.js';

type CreationContextModule = {
  authorizeGithubFeatureIssueCreation: (input: unknown) => Promise<unknown>;
  executeGithubIssueCreationTransaction: (
    transaction: unknown,
    runner: { run(request: GithubOperationRequest): Promise<unknown> },
  ) => Promise<unknown>;
};

async function creationContext(): Promise<CreationContextModule> {
  return import(CREATION_CONTEXT_MODULE) as unknown as Promise<CreationContextModule>;
}

async function authorizedFeatureAuthority(repository = 'acme/intake'): Promise<unknown> {
  const { authorizeGithubFeatureIssueCreation } = await creationContext();
  return authorizeGithubFeatureIssueCreation({
    repository,
    mutation: {
      provenance: {
        repository,
        defaultBranch: 'origin/main',
        specBranch: 'feature/intake',
        featureMarker: '.docs/intake/intake.md',
        publication: 'initial',
      },
      dependencies: {
        resolveMachineOwner: async () => ({ resolved: true as const, id: 'alice' }),
        provenanceDiscovery: {
          readCommittedRecords: async () => [{ path: '.docs/intake/intake.md', content: 'Owner: alice\n' }],
        },
      },
    },
  });
}

describe('engine/github-creation-context — transaction-scoped creation authority', () => {
  it('binds an explicitly authorized intake creation and its immediate metadata to the returned canonical issue', async () => {
    const { executeGithubIssueCreationTransaction } = await creationContext();
    const runner = {
      run: vi.fn(async (request: GithubOperationRequest) => request.operation === 'issue.create'
        ? { created: { repository: 'acme/intake', kind: 'issue' as const, number: 41 } }
        : {}),
    };

    await expect(executeGithubIssueCreationTransaction({
      authority: {
        resolveActor: async () => ({ resolved: true, id: 'Alice' }),
        intent: { kind: 'explicit-intake', repository: 'acme/intake' },
      },
      creation: {
        operation: 'issue.create',
        access: 'create',
        target: { repository: 'acme/intake', kind: 'repository' },
        context: { actor: 'alice' },
        payload: { title: 'Triage', body: 'Route this intake.' },
      },
      metadata: [{
        operation: 'issue.label.add',
        access: 'feature-write',
        target: { repository: 'acme/intake', kind: 'issue', number: 41 },
        context: { actor: 'alice' },
        payload: { label: 'triage' },
      }],
    }, runner)).resolves.toMatchObject({
      kind: 'executed',
      created: { repository: 'acme/intake', kind: 'issue', number: 41 },
    });
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['an unresolved operator', async () => ({ resolved: false as const }), 'acme/intake', 'unresolved-actor'],
    ['a destination outside the explicit intake action', async () => ({ resolved: true as const, id: 'alice' }), 'acme/other', 'explicit-authorization-required'],
  ])('refuses %s before the fake creation boundary', async (_caseName, resolveActor, repository, reason) => {
    const { executeGithubIssueCreationTransaction } = await creationContext();
    const runner = { run: vi.fn() };

    await expect(executeGithubIssueCreationTransaction({
      authority: {
        resolveActor,
        intent: { kind: 'explicit-intake', repository: 'acme/intake' },
      },
      creation: {
        operation: 'issue.create',
        access: 'create',
        target: { repository, kind: 'repository' },
        context: { actor: 'alice' },
        payload: { title: 'Triage', body: 'Route this intake.' },
      },
    }, runner)).resolves.toMatchObject({ kind: 'refused', reason });

    expect(runner.run).not.toHaveBeenCalled();
  });

  it('reports ambiguous creation as partial and never guesses a target for metadata', async () => {
    const { executeGithubIssueCreationTransaction } = await creationContext();
    const runner = { run: vi.fn().mockResolvedValue({ created: { repository: 'acme/intake', kind: 'pull-request', number: 41 } }) };
    const authority = await authorizedFeatureAuthority();

    await expect(executeGithubIssueCreationTransaction({
      authority,
      creation: {
        operation: 'issue.create',
        access: 'create',
        target: { repository: 'acme/intake', kind: 'repository' },
        context: { actor: 'alice' },
        payload: { title: 'Triage', body: 'Route this intake.' },
      },
      metadata: [{
        operation: 'issue.label.add',
        access: 'feature-write',
        target: { repository: 'acme/intake', kind: 'issue', number: 999 },
        context: { actor: 'alice' },
        payload: { label: 'triage' },
      }],
    }, runner)).resolves.toMatchObject({
      kind: 'partial',
      metadataFailures: [{ operation: 'issue.create' }],
    });

    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('rejects a forged authorized-feature tag before the fake creation boundary', async () => {
    const { executeGithubIssueCreationTransaction } = await creationContext();
    const runner = { run: vi.fn() };

    await expect(executeGithubIssueCreationTransaction({
      authority: {
        resolveActor: async () => ({ resolved: true, id: 'alice' }),
        intent: { kind: 'authorized-feature', repository: 'acme/intake' },
      } as unknown,
      creation: {
        operation: 'issue.create', access: 'create',
        target: { repository: 'acme/intake', kind: 'repository' },
        context: { actor: 'alice' }, payload: { title: 'Forged', body: 'Must not publish.' },
      },
    }, runner)).resolves.toMatchObject({ kind: 'refused', reason: 'explicit-authorization-required' });

    expect(runner.run).not.toHaveBeenCalled();
  });

  it('consumes a provenance-bound feature capability after one creation transaction', async () => {
    const { executeGithubIssueCreationTransaction } = await creationContext();
    const authority = await authorizedFeatureAuthority();
    const runner = {
      run: vi.fn().mockResolvedValue({ created: { repository: 'acme/intake', kind: 'issue', number: 41 } }),
    };
    const transaction = {
      authority,
      creation: {
        operation: 'issue.create', access: 'create',
        target: { repository: 'acme/intake', kind: 'repository' },
        context: { actor: 'alice' }, payload: { title: 'One shot', body: 'Bound to this creation.' },
      },
    };

    await expect(executeGithubIssueCreationTransaction(transaction, runner)).resolves.toMatchObject({ kind: 'executed' });
    await expect(executeGithubIssueCreationTransaction(transaction, runner)).resolves.toMatchObject({
      kind: 'refused', reason: 'explicit-authorization-required',
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('consumes creation authority within one transaction instead of using it for a different metadata target', async () => {
    const { executeGithubIssueCreationTransaction } = await creationContext();
    const runner = { run: vi.fn(async (request: GithubOperationRequest) => request.operation === 'issue.create'
      ? { created: { repository: 'acme/intake', kind: 'issue' as const, number: 41 } }
      : {}) };

    await expect(executeGithubIssueCreationTransaction({
      authority: {
        resolveActor: async () => ({ resolved: true, id: 'alice' }),
        intent: { kind: 'explicit-intake', repository: 'acme/intake' },
      },
      creation: {
        operation: 'issue.create',
        access: 'create',
        target: { repository: 'acme/intake', kind: 'repository' },
        context: { actor: 'alice' },
        payload: { title: 'Triage', body: 'Route this intake.' },
      },
      metadata: [{
        operation: 'issue.label.add',
        access: 'feature-write',
        target: { repository: 'acme/intake', kind: 'issue', number: 42 },
        context: { actor: 'alice' },
        payload: { label: 'wrong-target' },
      }],
    }, runner)).resolves.toMatchObject({
      kind: 'partial',
      created: { repository: 'acme/intake', kind: 'issue', number: 41 },
      metadataFailures: [{ operation: 'issue.label.add' }],
    });

    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('resolves identity again for a later transaction rather than retaining the first run identity', async () => {
    const { executeGithubIssueCreationTransaction } = await creationContext();
    const resolveActor = vi.fn()
      .mockResolvedValueOnce({ resolved: true, id: 'alice' })
      .mockResolvedValueOnce({ resolved: true, id: 'bob' });
    const runner = { run: vi.fn().mockResolvedValue({ created: { repository: 'acme/intake', kind: 'issue', number: 41 } }) };
    const transaction = {
      authority: {
        resolveActor,
        intent: { kind: 'explicit-intake' as const, repository: 'acme/intake' },
      },
      creation: {
        operation: 'issue.create' as const,
        access: 'create' as const,
        target: { repository: 'acme/intake', kind: 'repository' as const },
        context: { actor: 'alice' },
        payload: { title: 'Triage', body: 'Route this intake.' },
      },
    };

    await expect(executeGithubIssueCreationTransaction(transaction, runner)).resolves.toMatchObject({ kind: 'executed' });
    await expect(executeGithubIssueCreationTransaction(transaction, runner)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'explicit-authorization-required',
    });

    expect(resolveActor).toHaveBeenCalledTimes(2);
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});
