import { describe, expect, it } from 'vitest';
import { createProviderStartSurfaces, providerStart } from './provider-start-test-helpers.js';

describe('provider start serial rendering', () => {
  it.each([['prd', 'claude'], ['plan', 'codex']] as const)('shows %s on %s before completion on both live surfaces', async (step, provider) => {
    const surfaces = createProviderStartSurfaces();
    await surfaces.emit(providerStart(step, provider));
    expect(surfaces.daemon()).toContain(`${step} on ${provider}`);
    expect(surfaces.terminal()).toContain(`${step} on ${provider}`);
    // The observation is available before a completion event is emitted.
    expect(surfaces.terminal()).toContain(`${step} on ${provider}`);
  });
});
