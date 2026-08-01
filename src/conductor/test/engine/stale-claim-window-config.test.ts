import { describe, it, expect } from 'vitest';
import { resolveStaleClaimWindowMs } from '../../src/engine/resolved-config.js';
import type { HarnessConfig } from '../../src/types/config.js';

describe('engine/resolved-config — resolveStaleClaimWindowMs', () => {
  it('returns the 24h default in milliseconds', () => {
    expect(resolveStaleClaimWindowMs()).toBe(24 * 60 * 60 * 1000);
  });

  it('returns the 24h default when config has no stale_claim_window_hours', () => {
    const config: HarnessConfig = { defaults: { model: 'sonnet' } };
    expect(resolveStaleClaimWindowMs(config)).toBe(24 * 60 * 60 * 1000);
  });

  it('honors an override of stale_claim_window_hours = 6', () => {
    const config: HarnessConfig = { stale_claim_window_hours: 6 };
    expect(resolveStaleClaimWindowMs(config)).toBe(6 * 60 * 60 * 1000);
  });
});
