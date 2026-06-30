import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REBASE_RESOLUTION_ATTEMPTS,
  resolveRebaseResolutionAttempts,
} from '../../src/engine/resolved-config.js';
import type { HarnessConfig } from '../../src/types/config.js';

describe('engine/resolved-config — resolveRebaseResolutionAttempts', () => {
  it('exports DEFAULT_REBASE_RESOLUTION_ATTEMPTS = 3', () => {
    expect(DEFAULT_REBASE_RESOLUTION_ATTEMPTS).toBe(3);
  });

  it('returns 3 when no config is provided', () => {
    expect(resolveRebaseResolutionAttempts()).toBe(3);
  });

  it('returns 3 when config has no rebase_resolution_attempts', () => {
    const config: HarnessConfig = { defaults: { model: 'sonnet' } };
    expect(resolveRebaseResolutionAttempts(config)).toBe(3);
  });

  it('returns 5 when config sets rebase_resolution_attempts = 5', () => {
    const config: HarnessConfig = { rebase_resolution_attempts: 5 };
    expect(resolveRebaseResolutionAttempts(config)).toBe(5);
  });

  it('returns 0 when config sets rebase_resolution_attempts = 0 (disabled)', () => {
    const config: HarnessConfig = { rebase_resolution_attempts: 0 };
    expect(resolveRebaseResolutionAttempts(config)).toBe(0);
  });

  it('returns 3 (fallback) when config sets rebase_resolution_attempts = -2 (negative)', () => {
    const config: HarnessConfig = { rebase_resolution_attempts: -2 };
    expect(resolveRebaseResolutionAttempts(config)).toBe(3);
  });

  it('returns 3 (fallback) when rebase_resolution_attempts is NaN', () => {
    const config = { rebase_resolution_attempts: NaN } as HarnessConfig;
    expect(resolveRebaseResolutionAttempts(config)).toBe(3);
  });

  it('returns 3 (fallback) when rebase_resolution_attempts is a non-numeric string', () => {
    const config = { rebase_resolution_attempts: 'five' as unknown as number } as HarnessConfig;
    expect(resolveRebaseResolutionAttempts(config)).toBe(3);
  });
});
