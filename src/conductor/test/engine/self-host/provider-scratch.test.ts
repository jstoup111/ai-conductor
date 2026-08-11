import { describe, expect, it } from 'vitest';
import { resolveScratchHome } from '../../../src/engine/self-host/provider-scratch.js';

describe('provider scratch homes', () => {
  it('resolves beneath the owning worktree', () => {
    expect(resolveScratchHome({ worktreeRoot: '/wt', runId: 'R', attempt: 2, provider: 'codex' })).toBe(
      '/wt/.daemon/scratch/R/2-codex',
    );
  });
});
