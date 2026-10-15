import { describe, expect, it } from 'vitest';
import { createProviderStartSurfaces } from './provider-start-test-helpers.js';

describe('mechanical steps', () => {
  it('produce no provider-start output unless a provider attempt actually begins', async () => {
    const surfaces = createProviderStartSurfaces();
    await surfaces.emit({ type: 'step_completed', step: 'worktree', status: 'done' });
    expect(surfaces.daemon()).not.toContain('worktree');
    expect(surfaces.terminal()).not.toMatch(/worktree.*(?:on|provider unknown)/);
  });
});
