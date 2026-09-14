// Covers: task:6
import { describe, expect, it, vi } from 'vitest';

import {
  executeGithubOperation,
  GITHUB_OPERATION_REGISTRY,
  type GithubOperationName,
} from '../../../src/engine/github-operations.js';
import {
  createGuardedGithubOperationRunner,
  type GhRunner,
} from '../../../src/engine/tracker-client.js';

const cwd = '/fixture/worktree';

function fakeTerminal(): {
  readonly runner: GhRunner;
  readonly calls: Array<{ readonly args: string[]; readonly opts: { readonly cwd: string } }>;
} {
  const calls: Array<{ args: string[]; opts: { cwd: string } }> = [];
  return {
    runner: async (args, opts) => {
      calls.push({ args, opts });
      return { stdout: '{}' };
    },
    calls,
  };
}

function ownedMutationContext(events: string[] = []) {
  return {
    provenance: {
      repository: 'acme/owned',
      defaultBranch: 'main',
      specBranch: 'spec/owned',
      featureMarker: '.docs/specs/owned.md',
      publication: 'initial' as const,
    },
    dependencies: {
      resolveMachineOwner: async () => {
        events.push('identity');
        return { resolved: true as const, id: 'alice' };
      },
      provenanceDiscovery: {
        readCommittedRecords: async () => {
          events.push('provenance');
          return [{ path: '.docs/specs/owned.md', content: 'Owner: alice\n' }];
        },
      },
    },
  };
}

function registeredMutation(operation: GithubOperationName): Record<string, unknown> {
  const pullRequest = operation.startsWith('pull-request.');
  const sharedLabel = operation.startsWith('label-definition.');
  const remoteRef = operation.startsWith('remote-ref.');
  const createsRepositoryResource = operation === 'issue.create' || operation === 'pull-request.create';
  const resource = sharedLabel
    ? { kind: 'label-definition', name: 'owned-label' }
    : remoteRef
      ? { kind: 'remote-ref', ref: 'refs/heads/owned' }
      : createsRepositoryResource
        ? { kind: 'repository' }
        : { kind: pullRequest ? 'pull-request' : 'issue', number: 17 };
  const payload = operation === 'pull-request.comment.update'
    ? { commentId: '123', body: 'guarded write' }
    : operation.includes('.comment.') || operation === 'issue.edit'
      ? { body: 'guarded write' }
    : operation.includes('.label.')
      ? { label: 'owned-label' }
      : operation.includes('.dependency.')
        ? { dependency: { repository: 'acme/owned', resource: { kind: 'issue', number: 18 } } }
        : operation === 'issue.create'
          ? { title: 'Owned issue', body: 'created in scope' }
          : operation === 'pull-request.create'
            ? { title: 'Owned PR', body: 'created in scope', head: 'feature/owned', base: 'main' }
            : sharedLabel
              ? { name: 'owned-label', color: '0e8a16' }
              : operation === 'pull-request.edit'
                ? { title: 'Owned PR' }
                : undefined;
  return {
    operation,
    repository: 'acme/owned',
    resource,
    context: { actor: 'alice' },
    ...(payload ? { payload } : {}),
  };
}

describe('engine/tracker-client — guarded canonical GitHub execution', () => {
  it('runs registered foreign-resource discovery reads through the injected transport without granting write authority', async () => {
    const terminal = fakeTerminal();
    const guarded = createGuardedGithubOperationRunner(terminal.runner, { cwd });

    await expect(executeGithubOperation({
      operation: 'issue.read',
      repository: 'acme/foreign',
      resource: { kind: 'issue', number: 42 },
      context: { actor: 'alice' },
    }, guarded)).resolves.toMatchObject({
      kind: 'executed',
      operation: 'issue.read',
      target: { repository: 'acme/foreign', kind: 'issue', number: 42 },
    });

    expect(terminal.calls).toEqual([{
      args: ['issue', 'view', '42', '-R', 'acme/foreign'],
      opts: { cwd },
    }]);
  });

  it('authorizes a registered mutation from fresh committed ownership before it reaches the private transport', async () => {
    const events: string[] = [];
    const terminal: GhRunner = async () => {
      events.push('transport');
      return { stdout: '' };
    };
    const guarded = createGuardedGithubOperationRunner(terminal, {
      cwd,
      mutation: ownedMutationContext(events),
    });

    await expect(executeGithubOperation({
      operation: 'issue.comment.create',
      repository: 'acme/owned',
      resource: { kind: 'issue', number: 17 },
      context: { actor: 'not-an-authorization-bypass' },
      payload: { body: 'Owned update' },
    }, guarded)).resolves.toMatchObject({
      kind: 'executed',
      operation: 'issue.comment.create',
    });

    expect(events).toEqual(['identity', 'provenance', 'transport']);
  });

  it('returns typed refusals before the fake terminal boundary for foreign ownership and missing mutation context', async () => {
    const terminal = fakeTerminal();
    const foreign = createGuardedGithubOperationRunner(terminal.runner, {
      cwd,
      mutation: {
        ...ownedMutationContext(),
        dependencies: {
          ...ownedMutationContext().dependencies,
          resolveMachineOwner: async () => ({ resolved: true as const, id: 'alice' }),
          provenanceDiscovery: {
            readCommittedRecords: async () => [{ path: '.docs/specs/owned.md', content: 'Owner: bob\n' }],
          },
        },
      },
    });
    const unguarded = createGuardedGithubOperationRunner(terminal.runner, { cwd });
    const write = {
      operation: 'issue.comment.create',
      repository: 'acme/owned',
      resource: { kind: 'issue', number: 17 },
      context: { actor: 'alice' },
      payload: { body: 'must not reach gh' },
    };

    await expect(executeGithubOperation(write, foreign)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'other-owner',
    });
    await expect(executeGithubOperation(write, unguarded)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'missing-provenance',
    });
    expect(terminal.calls).toEqual([]);
  });

  it('sends every registered mutation variant through authorization before any terminal transport call', async () => {
    const terminal = fakeTerminal();
    const guarded = createGuardedGithubOperationRunner(terminal.runner, {
      cwd,
      mutation: {
        ...ownedMutationContext(),
        dependencies: {
          ...ownedMutationContext().dependencies,
          resolveMachineOwner: async () => ({ resolved: true as const, id: 'alice' }),
          provenanceDiscovery: {
            readCommittedRecords: async () => [{ path: '.docs/specs/owned.md', content: 'Owner: bob\n' }],
          },
        },
      },
    });
    const mutations = (Object.keys(GITHUB_OPERATION_REGISTRY) as GithubOperationName[])
      .filter((operation) => GITHUB_OPERATION_REGISTRY[operation].access !== 'read');

    for (const operation of mutations) {
      await expect(executeGithubOperation(registeredMutation(operation), guarded)).resolves.toMatchObject({
        kind: 'refused',
        operation,
        reason: 'other-owner',
      });
    }

    expect(terminal.calls).toEqual([]);
  });

  it('refuses unknown operations and remains isolated from any real process even when the authorization guard is absent', async () => {
    const terminal = vi.fn<GhRunner>(async () => {
      throw new Error('a process boundary must never be reached');
    });
    const guarded = createGuardedGithubOperationRunner(terminal, { cwd });

    await expect(executeGithubOperation({
      operation: 'issue.escape-hatch',
      repository: 'acme/owned',
      resource: { kind: 'issue', number: 17 },
      context: { actor: 'alice' },
      argv: ['api', '--method', 'POST', 'repos/acme/owned/issues/17/comments'],
    }, guarded)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'unsupported-operation',
    });
    await expect(executeGithubOperation({
      operation: 'issue.comment.create',
      repository: 'acme/owned',
      resource: { kind: 'issue', number: 17 },
      context: { actor: 'alice' },
      payload: { body: 'destructive input' },
    }, guarded)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'missing-provenance',
    });

    expect(terminal).not.toHaveBeenCalled();
  });
});
