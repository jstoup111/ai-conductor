// Covers: task:12
import { describe, expect, it } from 'vitest';
import { runOverlapPreflight } from '../../src/engine/engineer/intake/overlap-preflight.js';
import { fileIntakeIssue } from '../../src/engine/engineer/intake/file-issue.js';
import { renderIntakeFileOutput } from '../../src/engine/engineer/intake/filing-output.js';
import type { GithubOperationRequest } from '../../src/engine/github-operations.js';

describe('invalid overlap declines', () => {
  const creation = (operations: GithubOperationRequest[]) => ({
    authority: { resolveActor: async () => ({ resolved: true as const, id: 'alice' }), intent: { kind: 'explicit-intake' as const, repository: 'acme/app' } },
    operations: { run: async (request: GithubOperationRequest) => {
      operations.push(request);
      return request.operation === 'issue.create'
        ? { created: { repository: 'acme/app', kind: 'issue' as const, number: 1 } }
        : {};
    } },
  });

  it('proceeds when a decline names a current suggestion', async () => {
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], declineOverlap: ['acme/app#1579'], interactive: false }, { suggestions: async () => ({
      shown: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }], preAccepted: [], advisory: [],
    }) });
    expect(result).toMatchObject({ kind: 'proceed', declined: ['acme/app#1579'] });
  });

  it('rejects malformed and unsuggested decline values before filing', async () => {
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], declineOverlap: ['not-a-ref'], interactive: false }, { suggestions: async () => ({ shown: [], preAccepted: [], advisory: [] }) });
    expect(result).toEqual({ kind: 'invalid-decline', invalid: ['not-a-ref'], advisory: [], skipNotes: [], omittedCount: 0 });
  });

  it('rejects a decline of a ref already named with --depends-on', async () => {
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: ['acme/app#1579'], declineOverlap: ['acme/app#1579'], interactive: false }, { suggestions: async () => ({
      shown: [], preAccepted: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }], advisory: [],
    }) });
    expect(result).toEqual({ kind: 'invalid-decline', invalid: ['acme/app#1579'], advisory: [], skipNotes: [], omittedCount: 0 });
  });

  it('accepts a decline of a linkable suggestion omitted by the prompt cap', async () => {
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], declineOverlap: ['acme/app#1', 'acme/app#2', 'acme/app#3', 'acme/app#4', 'acme/app#5', 'acme/app#6'], interactive: false }, { suggestions: async () => ({
      shown: Array.from({ length: 5 }, (_, index) => ({ issue: `acme/app#${index + 1}`, sharedPaths: ['a.ts'] })),
      omitted: [{ issue: 'acme/app#6', sharedPaths: ['a.ts'] }], preAccepted: [], advisory: [], omittedCount: 1,
    }) });
    expect(result).toMatchObject({ kind: 'proceed', declined: expect.arrayContaining(['acme/app#6']) });
  });

  it('rejects a cross-repository decline without creating an issue', async () => {
    const operations: GithubOperationRequest[] = [];
    const result = await fileIntakeIssue({ title: 't', body: 'b', size: 'S', priority: 'low', interactive: false, declineOverlap: ['other/repo#1579'] }, {
      overlap: { suggestions: async () => ({ shown: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }], preAccepted: [], advisory: [] }) },
      creation: {
        authority: { resolveActor: async () => ({ resolved: true as const, id: 'alice' }), intent: { kind: 'explicit-intake', repository: 'acme/app' } },
        operations: { run: async (request) => {
          operations.push(request);
          return { created: { repository: 'acme/app', kind: 'issue' as const, number: 1 } };
        } },
      },
    });
    expect(result.overlap).toMatchObject({ kind: 'invalid-decline', invalid: ['other/repo#1579'] });
    expect(operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(0);
  });

  it('rejects an unsuggested or malformed decline before creation and explains each refusal', async () => {
    for (const value of ['acme/app#1597', 'not-a-ref']) {
      const operations: GithubOperationRequest[] = [];
      const result = await fileIntakeIssue({ title: 't', body: 'b', size: 'S', priority: 'low', interactive: false, declineOverlap: [value] }, {
        overlap: { suggestions: async () => ({ shown: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }], preAccepted: [], advisory: [] }) },
        creation: creation(operations),
      });
      expect(result.overlap).toMatchObject({ kind: 'invalid-decline', invalid: [value] });
      expect(operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(0);
      expect(renderIntakeFileOutput(result)).toMatchObject({ exitCode: 1, stdout: expect.stringContaining(`${value} — not a current suggestion`) });
    }
  });

  it('does not let advisory-only overlap make an unrelated decline valid', async () => {
    const operations: GithubOperationRequest[] = [];
    const result = await fileIntakeIssue({ title: 't', body: 'b', size: 'S', priority: 'low', interactive: false, declineOverlap: ['acme/app#1597'] }, {
      overlap: { suggestions: async () => ({
        shown: [], preAccepted: [], advisory: [{ branch: 'feat/daemon-advisory', issue: null, sharedPaths: ['a.ts'] }],
      }) },
      creation: creation(operations),
    });
    expect(result.overlap).toMatchObject({ kind: 'invalid-decline', invalid: ['acme/app#1597'] });
    expect(operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(0);
  });
});
