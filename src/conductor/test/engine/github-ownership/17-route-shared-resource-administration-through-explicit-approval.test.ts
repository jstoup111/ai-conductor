// Covers: task:17
import { describe, expect, it, vi } from 'vitest';

import { decodeGithubOperationRequest, executeGithubOperation } from '../../../src/engine/github-operations.js';
import { requestExplicitGithubOperationApproval } from '../../../src/engine/github-operation-approval.js';
import { executeSharedGithubOperation } from '../../../src/engine/github-shared-operations.js';
import { createGuardedGithubOperationRunner, type GhRunner } from '../../../src/engine/tracker-client.js';

const request = {
  operation: 'label-definition.create',
  repository: 'acme/widgets',
  resource: { kind: 'label-definition', name: 'needs-triage' },
  context: { actor: 'alice', feature: 'widgets' },
  payload: { name: 'needs-triage', color: '0e8a16' },
};

describe('engine/github-shared-operations — exact approved shared administration', () => {
  it('executes an existing label-definition variant only after exact interactive approval', async () => {
    const transport = vi.fn<GhRunner>(async () => ({ stdout: '' }));

    const result = await executeSharedGithubOperation(request, transport, {
      cwd: '/fixture/worktree',
      confirmation: { mode: 'interactive', confirm: vi.fn().mockResolvedValue(true) },
    });

    expect(result).toMatchObject({
      kind: 'executed',
      operation: 'label-definition.create',
      target: { repository: 'acme/widgets', kind: 'label-definition', name: 'needs-triage' },
    });
    expect(transport).toHaveBeenCalledWith([
      'label', 'create', 'needs-triage', '-R', 'acme/widgets', '--color', '0e8a16',
    ], { cwd: '/fixture/worktree' });
  });

  it.each([
    ['a different label definition', {
      ...request,
      resource: { kind: 'label-definition', name: 'needs-review' },
      payload: { name: 'needs-review', color: '0e8a16' },
    }],
    ['a different label-definition operation', { ...request, operation: 'label-definition.update' }],
  ])('refuses reuse of approval for %s before the terminal transport', async (_caseName, attempted) => {
    const decoded = decodeGithubOperationRequest(request);
    if (decoded.kind !== 'accepted') throw new Error('fixture must decode');
    const approval = await requestExplicitGithubOperationApproval(decoded.request, {
      mode: 'interactive', confirm: vi.fn().mockResolvedValue(true),
    });
    if (approval.kind !== 'approved') throw new Error('fixture approval must succeed');
    const transport = vi.fn<GhRunner>(async () => ({ stdout: '' }));

    await expect(executeGithubOperation(attempted, createGuardedGithubOperationRunner(transport, {
      cwd: '/fixture/worktree',
      shared: { approval: approval.capability },
    }))).resolves.toMatchObject({
      kind: 'refused',
      reason: 'explicit-authorization-required',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not inherit shared administration authority from an owned feature context', async () => {
    const transport = vi.fn<GhRunner>(async () => ({ stdout: '' }));
    const featureContext = {
      provenance: {
        repository: 'acme/widgets',
        defaultBranch: 'main',
        specBranch: 'spec/widgets',
        featureMarker: '.docs/specs/widgets.md',
        publication: 'initial' as const,
      },
      dependencies: {
        resolveMachineOwner: async () => ({ resolved: true as const, id: 'alice' }),
        provenanceDiscovery: {
          readCommittedRecords: async () => [{ path: '.docs/specs/widgets.md', content: 'Owner: alice\\n' }],
        },
      },
    };

    await expect(executeGithubOperation(request, createGuardedGithubOperationRunner(transport, {
      cwd: '/fixture/worktree',
      mutation: featureContext,
    }))).resolves.toMatchObject({
      kind: 'refused',
      reason: 'explicit-authorization-required',
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('returns a failed shared result after terminal transport failure rather than success', async () => {
    const transport = vi.fn<GhRunner>(async () => {
      throw new Error('GitHub unavailable');
    });

    await expect(executeSharedGithubOperation(request, transport, {
      cwd: '/fixture/worktree',
      confirmation: { mode: 'interactive', confirm: vi.fn().mockResolvedValue(true) },
    })).resolves.toMatchObject({
      kind: 'failed',
      operation: 'label-definition.create',
      error: 'GitHub unavailable',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('refuses an unregistered administration variant before requesting approval or reaching transport', async () => {
    const transport = vi.fn<GhRunner>(async () => ({ stdout: '' }));
    const confirm = vi.fn().mockResolvedValue(true);

    await expect(executeSharedGithubOperation({ ...request, operation: 'workflow.force-enable' }, transport, {
      cwd: '/fixture/worktree',
      confirmation: { mode: 'interactive', confirm },
    })).resolves.toEqual({ kind: 'refused', reason: 'unsupported-operation' });
    expect(confirm).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});
