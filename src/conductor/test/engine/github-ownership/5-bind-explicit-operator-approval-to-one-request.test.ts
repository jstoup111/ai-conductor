// Covers: task:5
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import type { GithubOperationRequest } from '../../../src/engine/github-operations.js';

const APPROVAL_MODULE = '../../../src/engine/github-operation-approval.js';

type ApprovalModule = {
  requestExplicitGithubOperationApproval: (
    request: GithubOperationRequest,
    confirmation?: unknown,
  ) => Promise<unknown>;
  hasExplicitGithubOperationApproval: (capability: unknown, request: GithubOperationRequest) => boolean;
};

async function approvalModule(): Promise<ApprovalModule> {
  return import(APPROVAL_MODULE) as unknown as Promise<ApprovalModule>;
}

function request(overrides: Partial<GithubOperationRequest> = {}): GithubOperationRequest {
  return {
    operation: 'intake.issue.comment.create',
    access: 'intake-write',
    target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
    context: { actor: 'Alice' },
    payload: { body: 'Please triage this intake.' },
    ...overrides,
  } as GithubOperationRequest;
}

describe('engine/github-operation-approval — exact explicit operator approval', () => {
  it('issues an internal capability only after interactive positive confirmation of the exact canonical request', async () => {
    const { requestExplicitGithubOperationApproval, hasExplicitGithubOperationApproval } = await approvalModule();
    const approval = { mode: 'interactive', confirm: vi.fn().mockResolvedValue(true) };
    const attempted = request();
    const payloadDigest = `sha256:${createHash('sha256').update(JSON.stringify({ body: 'Please triage this intake.' })).digest('hex')}`;

    const result = await requestExplicitGithubOperationApproval(attempted, approval);

    expect(approval.confirm).toHaveBeenCalledWith({
      actor: 'alice',
      repository: 'acme/rocket',
      target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
      operation: 'intake.issue.comment.create',
      payloadDigest,
    });
    expect(result).toMatchObject({
      kind: 'approved',
      actor: 'alice',
      operation: 'intake.issue.comment.create',
      target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
      payloadDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect((result as { payloadDigest: string }).payloadDigest).toBe(payloadDigest);
    const capability = (result as { capability: unknown }).capability;
    expect(hasExplicitGithubOperationApproval(capability, attempted)).toBe(true);
  });

  it.each([
    ['no approval adapter', undefined],
    ['a declined confirmation', { mode: 'interactive', confirm: vi.fn().mockResolvedValue(false) }],
    ['a noninteractive confirmation source', { mode: 'daemon', confirm: vi.fn().mockResolvedValue(true) }],
  ])('refuses %s without issuing a capability', async (_caseName, confirmation) => {
    const { requestExplicitGithubOperationApproval, hasExplicitGithubOperationApproval } = await approvalModule();

    const result = await requestExplicitGithubOperationApproval(request(), confirmation);
    expect(result).toMatchObject({
      kind: 'refused',
      reason: 'explicit-authorization-required',
      operation: 'intake.issue.comment.create',
      target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
    });
    expect(result).not.toHaveProperty('capability');
    expect(hasExplicitGithubOperationApproval((result as { capability?: unknown }).capability, request())).toBe(false);
  });

  it.each([
    ['actor', request({ context: { actor: 'bob' } })],
    ['repository', request({ target: { repository: 'acme/satellite', kind: 'issue', number: 17 } })],
    ['resource', request({ target: { repository: 'acme/rocket', kind: 'issue', number: 18 } })],
    ['operation', request({ operation: 'issue.comment.create' })],
    ['payload', request({ payload: { body: 'A different request body.' } })],
  ])('cannot reuse one capability for a different %s', async (_caseName, mismatched) => {
    const { requestExplicitGithubOperationApproval, hasExplicitGithubOperationApproval } = await approvalModule();
    const result = await requestExplicitGithubOperationApproval(request(), {
      mode: 'interactive',
      confirm: vi.fn().mockResolvedValue(true),
    });

    expect(result).toMatchObject({ kind: 'approved' });
    expect(hasExplicitGithubOperationApproval((result as { capability: unknown }).capability, mismatched)).toBe(false);
  });

  it('derives a deterministic, payload-sensitive digest before confirmation', async () => {
    const { requestExplicitGithubOperationApproval, hasExplicitGithubOperationApproval } = await approvalModule();
    const original = request();
    const changedPayload = request({ payload: { body: 'A different request body.' } });
    const confirm = { mode: 'interactive', confirm: vi.fn().mockResolvedValue(true) };

    const originalResult = await requestExplicitGithubOperationApproval(original, confirm);
    const changedResult = await requestExplicitGithubOperationApproval(changedPayload, confirm);

    expect((originalResult as { payloadDigest: string }).payloadDigest).not.toBe(
      (changedResult as { payloadDigest: string }).payloadDigest,
    );
    expect(hasExplicitGithubOperationApproval(
      (originalResult as { capability: unknown }).capability,
      changedPayload,
    )).toBe(false);
  });

  it('does not treat ordinary feature publication intent or a forgeable string as shared authority', async () => {
    const { requestExplicitGithubOperationApproval, hasExplicitGithubOperationApproval } = await approvalModule();
    const sharedDefinition = request({
      operation: 'label-definition.create',
      access: 'shared-write',
      target: { repository: 'acme/rocket', kind: 'label-definition', name: 'needs-triage' },
      payload: { name: 'needs-triage', color: 'ff0000' },
    });

    await expect(requestExplicitGithubOperationApproval(sharedDefinition)).resolves.toMatchObject({
      kind: 'refused',
      reason: 'explicit-authorization-required',
    });
    expect(hasExplicitGithubOperationApproval('alice', sharedDefinition)).toBe(false);
    expect(hasExplicitGithubOperationApproval({ actor: 'alice', ignoreOwnership: true }, sharedDefinition)).toBe(false);
    const approved = await requestExplicitGithubOperationApproval(sharedDefinition, {
      mode: 'interactive',
      confirm: vi.fn().mockResolvedValue(true),
    });
    expect(approved).toMatchObject({ kind: 'approved' });
    expect(hasExplicitGithubOperationApproval({
      kind: 'approved',
      actor: 'alice',
      repository: 'acme/rocket',
      target: { repository: 'acme/rocket', kind: 'label-definition', name: 'needs-triage' },
      operation: 'label-definition.create',
      payloadDigest: (approved as { payloadDigest: string }).payloadDigest,
    }, sharedDefinition)).toBe(false);
  });
});
