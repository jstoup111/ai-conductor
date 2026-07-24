import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/engine/config.js';

describe('engine_refresh_min_interval_seconds config field', () => {
  it('accepts a positive number as-is', () => {
    const result = validateConfig({ engine_refresh_min_interval_seconds: 120 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.engine_refresh_min_interval_seconds).toBe(120);
    expect(result.warnings).toHaveLength(0);
  });

  it('defaults to 300 when unset', () => {
    const result = validateConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.engine_refresh_min_interval_seconds).toBe(300);
    expect(result.warnings).toHaveLength(0);
  });

  it('coerces a negative value to the default (300) with a warning', () => {
    const result = validateConfig({ engine_refresh_min_interval_seconds: -10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.engine_refresh_min_interval_seconds).toBe(300);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/engine_refresh_min_interval_seconds.*invalid/i);
  });

  it('coerces a zero value to the default (300) with a warning', () => {
    const result = validateConfig({ engine_refresh_min_interval_seconds: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.engine_refresh_min_interval_seconds).toBe(300);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('coerces a non-numeric value to the default (300) with a warning', () => {
    const result = validateConfig({ engine_refresh_min_interval_seconds: 'banana' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.engine_refresh_min_interval_seconds).toBe(300);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('coerces a null value to the default (300) without a warning', () => {
    const result = validateConfig({ engine_refresh_min_interval_seconds: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.engine_refresh_min_interval_seconds).toBe(300);
    expect(result.warnings).toHaveLength(0);
  });
});
