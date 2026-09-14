// Covers: task:1
import { describe, expect, it, vi } from 'vitest';

import {
  decodeGithubOperationRequest,
  executeGithubOperation,
  type GithubOperationResult,
} from '../../../src/engine/github-operations.js';

const issueRead = {
  operation: 'issue.read',
  repository: 'acme/rocket',
  resource: { kind: 'issue', number: 17 },
  context: { actor: 'operator-1' },
};

const issueComment = {
  operation: 'issue.comment.create',
  repository: 'acme/rocket',
  resource: { kind: 'issue', number: 17 },
  context: { actor: 'operator-1', feature: 'rocket' },
  payload: { body: 'ownership-confirmed' },
};

describe('engine/github-operations — closed operation requests and results', () => {
  it('decodes registered read and write shapes into canonical requests without letting raw input declare read access', () => {
    expect(decodeGithubOperationRequest(issueRead)).toMatchObject({
      kind: 'accepted',
      request: {
        operation: 'issue.read',
        access: 'read',
        target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
      },
    });
    expect(decodeGithubOperationRequest({ ...issueComment, access: 'read' })).toMatchObject({
      kind: 'accepted',
      request: {
        operation: 'issue.comment.create',
        access: 'feature-write',
        target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
      },
    });

    expect(decodeGithubOperationRequest({
      ...issueComment,
      operation: 'not-in-the-registry',
    })).toMatchObject({
      kind: 'refused',
      reason: 'unsupported-operation',
    });
    expect(decodeGithubOperationRequest({
      operation: 'label-definition.create',
      repository: 'acme/rocket',
      resource: { kind: 'label-definition', name: 'owned-label' },
      context: { actor: 'operator-1' },
      payload: { name: 'other-label' },
    })).toMatchObject({ kind: 'refused', reason: 'invalid-target' });
  });

  it.each([
    ['an unknown operation', { ...issueRead, operation: 'issue.teleport' }, 'unsupported-operation'],
    ['missing operation context', { ...issueComment, context: undefined }, 'unresolved-actor'],
    ['a malformed operation payload', { ...issueComment, payload: { body: 42 } }, 'invalid-payload'],
  ])('returns a typed refusal for %s before it invokes the injected runner', async (_caseName, rawRequest, reason) => {
    const runner = { run: vi.fn() };

    await expect(executeGithubOperation(rawRequest, runner)).resolves.toMatchObject({
      kind: 'refused',
      reason,
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('keeps executed, refused, failed, and partial creation results distinct', () => {
    const outcomes: GithubOperationResult[] = [
      {
        kind: 'executed',
        operation: 'issue.comment.create',
        target: { repository: 'acme/rocket', kind: 'issue', number: 17 },
      },
      { kind: 'refused', operation: 'issue.comment.create', reason: 'other-owner' },
      { kind: 'failed', operation: 'issue.comment.create', error: 'transport unavailable' },
      {
        kind: 'partial',
        operation: 'issue.create',
        created: { repository: 'acme/rocket', kind: 'issue', number: 18 },
        metadataFailures: [{ operation: 'issue.label.add', error: 'label write failed' }],
      },
    ];

    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      'executed',
      'refused',
      'failed',
      'partial',
    ]);
    expect(outcomes[1]).not.toMatchObject({ kind: 'executed' });
    expect(outcomes[3]).toMatchObject({
      kind: 'partial',
      created: { repository: 'acme/rocket', kind: 'issue', number: 18 },
      metadataFailures: [{ operation: 'issue.label.add', error: 'label write failed' }],
    });
  });

  it('returns execution failures and partial creation outcomes without converting either to success', async () => {
    const executed = await executeGithubOperation(issueComment, { run: vi.fn().mockResolvedValue({}) });
    const failed = await executeGithubOperation(issueComment, {
      run: vi.fn().mockRejectedValue(new Error('transport unavailable')),
    });
    const partial = await executeGithubOperation({
      operation: 'issue.create',
      repository: 'acme/rocket',
      resource: { kind: 'repository' },
      context: { actor: 'operator-1' },
      payload: { title: 'Owned issue', body: 'create it' },
    }, {
      run: vi.fn().mockResolvedValue({
        created: { repository: 'acme/rocket', kind: 'issue', number: 18 },
        metadataFailures: [{ operation: 'issue.label.add', error: 'label write failed' }],
      }),
    });

    expect(executed).toMatchObject({ kind: 'executed', target: issueComment.resource });
    expect(failed).toMatchObject({ kind: 'failed', error: 'transport unavailable' });
    expect(partial).toMatchObject({
      kind: 'partial',
      created: { repository: 'acme/rocket', kind: 'issue', number: 18 },
      metadataFailures: [{ operation: 'issue.label.add', error: 'label write failed' }],
    });
  });
});
