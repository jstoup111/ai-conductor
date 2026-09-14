// Covers: task:15
import { describe, expect, it, vi } from 'vitest';

import { fileIntakeIssue } from '../../../src/engine/engineer/intake/file-issue.js';
import type { GithubOperationRequest, GithubOperationRunner } from '../../../src/engine/github-operations.js';

const REPOSITORY = 'acme/intake';

function creationAuthority() {
  return {
    resolveActor: async () => ({ resolved: true as const, id: 'alice' }),
    intent: { kind: 'explicit-intake' as const, repository: REPOSITORY },
  };
}

function operationRunner(
  run: (request: GithubOperationRequest) => unknown | Promise<unknown>,
): { readonly runner: GithubOperationRunner; readonly calls: GithubOperationRequest[] } {
  const calls: GithubOperationRequest[] = [];
  return {
    calls,
    runner: { run: vi.fn(async (request) => {
      calls.push(request);
      return run(request) as ReturnType<GithubOperationRunner['run']>;
    }) },
  };
}

describe('intake filing — creation-scoped metadata follow-ups', () => {
  it('writes size, priority, and dependency metadata only to the canonical newly created issue', async () => {
    const operations = operationRunner((request) => request.operation === 'issue.create'
      ? { created: { repository: REPOSITORY, kind: 'issue' as const, number: 41 } }
      : {});

    const result = await fileIntakeIssue({
      title: 'Route intake',
      body: 'Body',
      size: 'S',
      priority: 'high',
      dependsOn: ['acme/foreign#99'],
      repo: REPOSITORY,
    }, {
      creation: { authority: creationAuthority(), operations: operations.runner },
    });

    expect(result).toMatchObject({
      ok: true,
      issueUrl: `https://github.com/${REPOSITORY}/issues/41`,
      linked: ['acme/foreign#99'],
    });
    expect(operations.calls).toEqual([
      expect.objectContaining({ operation: 'issue.create', target: { repository: REPOSITORY, kind: 'repository' } }),
      expect.objectContaining({ operation: 'issue.label.add', target: { repository: REPOSITORY, kind: 'issue', number: 41 } }),
      expect.objectContaining({ operation: 'issue.label.add', target: { repository: REPOSITORY, kind: 'issue', number: 41 } }),
      expect.objectContaining({
        operation: 'issue.dependency.add',
        target: { repository: REPOSITORY, kind: 'issue', number: 41 },
        payload: { dependency: { repository: 'acme/foreign', kind: 'issue', number: 99 } },
      }),
    ]);
    expect(operations.calls.filter((request) => request.target.repository === 'acme/foreign')).toEqual([]);
  });

  it('keeps the canonical created URL while accurately surfacing refused metadata', async () => {
    const operations = operationRunner((request) => request.operation === 'issue.create'
      ? { created: { repository: REPOSITORY, kind: 'issue' as const, number: 42 } }
      : { kind: 'refused' as const, reason: 'other-owner' as const });

    const result = await fileIntakeIssue({ title: 'Partial', body: 'Body', repo: REPOSITORY }, {
      creation: { authority: creationAuthority(), operations: operations.runner },
    });

    expect(result).toMatchObject({
      ok: true,
      issueUrl: `https://github.com/${REPOSITORY}/issues/42`,
      warnings: expect.arrayContaining([
        expect.stringContaining('label-apply failed: GitHub operation refused: other-owner'),
      ]),
      metadataFailures: expect.arrayContaining([
        expect.objectContaining({ operation: 'issue.label.add', error: 'GitHub operation refused: other-owner' }),
      ]),
    });
  });

  it('reports ambiguous creation without a guessed URL or follow-up mutation', async () => {
    const operations = operationRunner(() => ({}));

    const result = await fileIntakeIssue({ title: 'Ambiguous', body: 'Body', repo: REPOSITORY }, {
      creation: { authority: creationAuthority(), operations: operations.runner },
    });

    expect(result).toMatchObject({
      ok: false,
      warnings: [expect.stringContaining('did not identify one canonical issue')],
    });
    expect(result.issueUrl).toBe('');
    expect(operations.calls).toHaveLength(1);
    expect(operations.calls[0]?.operation).toBe('issue.create');
  });
});
