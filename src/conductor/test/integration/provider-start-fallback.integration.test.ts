import { describe, expect, it } from 'vitest';
import { createProviderStartSurfaces, member, providerStart } from './provider-start-test-helpers.js';

describe('provider start fallback rendering', () => {
  it('shows every begun fallback attempt, including a later model rung', async () => {
    const surfaces = createProviderStartSurfaces();
    await surfaces.emit(providerStart('plan', 'claude', undefined, 'first'));
    await surfaces.emit({ type: 'provider_fallback', step: 'plan', failedProvider: 'claude', reason: 'failed', nextProvider: 'codex' });
    await surfaces.emit(providerStart('plan', 'codex'));
    await surfaces.emit(providerStart('review', 'claude', member('review', 'security')));
    await surfaces.emit(providerStart('review', 'claude', member('review', 'security'), 'second'));
    for (const output of [surfaces.daemon(), surfaces.terminal()]) {
      expect(output).toContain('plan on codex');
      expect(output.lastIndexOf('plan on codex')).toBeGreaterThan(output.indexOf('PROVIDER FALLBACK'));
      expect(output).toContain('review / security on claude (second)');
    }
  });
});
