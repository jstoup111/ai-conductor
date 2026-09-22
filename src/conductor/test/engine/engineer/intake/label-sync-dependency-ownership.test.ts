import { describe, expect, it, vi } from 'vitest';

import { syncIssueLabels } from '../../../../src/engine/engineer/intake/label-sync.js';
import type { GhRunner } from '../../../../src/engine/tracker-client.js';

function readOnlyGh(): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    gh: async (args) => {
      calls.push(args);
      const path = args.find((arg) => /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(arg));
      if (path) {
        const number = Number(path.split('/').at(-1));
        return { stdout: JSON.stringify({ id: 1_000_000 + number }) };
      }
      if (args.some((arg) => arg.includes('/dependencies/blocked_by'))) return { stdout: '[]' };
      return { stdout: '{}' };
    },
  };
}

describe('syncIssueLabels dependency writes', () => {
  it('uses the injected guarded operation for a link and never POSTs through the raw transport', async () => {
    const { gh, calls } = readOnlyGh();
    const operations = { run: vi.fn(async () => ({})) };

    const result = await syncIssueLabels(
      { dependsOn: ['acme/app#100'] },
      'acme/app#200',
      { gh, dependencyOperations: operations, actor: 'alice', cwd: '/repo' },
    );

    expect(result.linked).toEqual(['acme/app#100']);
    expect(operations.run).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'intake.issue.dependency.add',
      target: { repository: 'acme/app', kind: 'issue', number: 200 },
      payload: expect.objectContaining({
        dependency: { repository: 'acme/app', kind: 'issue', number: 100 },
      }),
    }));
    expect(calls.flat()).not.toContain('POST');
  });

  it('records a refused dependency as bad input and does not retry through the raw transport', async () => {
    const { gh, calls } = readOnlyGh();
    const operations = {
      run: vi.fn(async () => ({ kind: 'refused' as const, reason: 'explicit-authorization-required' as const })),
    };

    const result = await syncIssueLabels(
      { dependsOn: ['acme/app#100'] },
      'acme/app#200',
      { gh, dependencyOperations: operations, actor: 'alice', cwd: '/repo' },
    );

    expect(result.linked).toEqual([]);
    expect(result.badRefs).toEqual(['acme/app#100']);
    expect(operations.run).toHaveBeenCalledTimes(1);
    expect(calls.flat()).not.toContain('POST');
  });
});
