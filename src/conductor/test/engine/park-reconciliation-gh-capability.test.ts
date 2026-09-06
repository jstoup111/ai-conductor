import { describe, expect, it, vi } from 'vitest';
import { GhCapabilityError } from '../../src/engine/tracker-client.js';
import { proveByMergedPrHead } from '../../src/engine/park-reconciliation.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';

describe('park reconciliation — gh capability errors', () => {
  it('keeps the existing no-proof disposition and exposes the typed cause to its logger seam', async () => {
    const capability = new GhCapabilityError('headRefOid', new Error('unsupported'));
    const runGh: GhRunner = async () => { throw capability; };
    const runGit: GitRunner = vi.fn(async () => ({ stdout: '' }));
    const observed = vi.fn();

    await expect(proveByMergedPrHead(runGit, runGh, '/project', 'feature/demo', observed))
      .resolves.toEqual({ kind: 'indeterminate' });
    expect(observed).toHaveBeenCalledWith(capability);
    expect(runGit).not.toHaveBeenCalled();
  });
});
