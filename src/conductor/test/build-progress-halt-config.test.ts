import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/engine/config.js';

describe('validateConfig — build_progress_halt fail-closed validation (S7)', () => {
  it('rejects attempt_ceiling below the resolved max_retries', () => {
    const result = validateConfig({
      defaults: { max_retries: 3 },
      build_progress_halt: { attempt_ceiling: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/attempt_ceiling/);
      expect(result.error.message).toMatch(/max_retries/);
    }
  });

  it('rejects attempt_ceiling: 0 (non-positive)', () => {
    const result = validateConfig({
      build_progress_halt: { attempt_ceiling: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/attempt_ceiling/);
    }
  });

  it('rejects a non-integer attempt_ceiling', () => {
    const result = validateConfig({
      build_progress_halt: { attempt_ceiling: 2.5 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/attempt_ceiling/);
    }
  });

  it('rejects a non-positive dispatch_ceiling', () => {
    const result = validateConfig({
      build_progress_halt: { dispatch_ceiling: -1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/dispatch_ceiling/);
    }
  });

  it('rejects unknown keys inside build_progress_halt', () => {
    const result = validateConfig({
      build_progress_halt: { bogus_key: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/Unknown key in build_progress_halt/);
      expect(result.error.message).toMatch(/bogus_key/);
    }
  });

  it('accepts a valid build_progress_halt block', () => {
    const result = validateConfig({
      defaults: { max_retries: 3 },
      build_progress_halt: { enabled: true, attempt_ceiling: 30, dispatch_ceiling: 20 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.build_progress_halt).toEqual({
        enabled: true,
        attempt_ceiling: 30,
        dispatch_ceiling: 20,
      });
    }
  });

  it('defaults to enabled: true, attempt_ceiling: 30, dispatch_ceiling: 20 when the block is absent', () => {
    const result = validateConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.build_progress_halt).toEqual({
        enabled: true,
        attempt_ceiling: 30,
        dispatch_ceiling: 20,
      });
    }
  });
});
