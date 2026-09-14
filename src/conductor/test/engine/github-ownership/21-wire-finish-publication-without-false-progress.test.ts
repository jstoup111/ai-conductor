// Covers: task:21
import { describe, expect, it, vi } from 'vitest';
import { openShipDraftPr } from '../../../src/engine/ship-draft-pr.js';

describe('finish publication failure boundary', () => {
  it('reports a failed branch publication without creating a PR or claiming progress', async () => {
    const gh = vi.fn();
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-list') return { stdout: '1\n' };
      throw new Error('other owner refused remote ref');
    });
    await expect(openShipDraftPr({
      cwd: '/fixture', branch: 'feat/daemon-owned', baseBranch: 'main', gh, git,
    })).resolves.toEqual({ outcome: 'push-failed', reason: expect.stringContaining('other owner refused') });
    expect(gh).not.toHaveBeenCalled();
  });
});
