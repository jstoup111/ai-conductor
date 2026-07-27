import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/engine/config.js';
import type { HarnessConfig } from '../src/types/config.js';

describe('LLM provider selection config types', () => {
  it('types scalar and ordered run selections plus an explicit step selection', () => {
    const scalar: HarnessConfig = { llm_provider: 'claude' };
    const ordered: HarnessConfig = {
      llm_provider: ['claude', 'codex'],
      steps: { judgement: { llm_provider: 'codex' } },
    };

    expect([scalar.llm_provider, ordered.llm_provider, ordered.steps?.judgement?.llm_provider])
      .toEqual(['claude', ['claude', 'codex'], 'codex']);
  });
});

describe('LLM provider selection validation', () => {
  it.each([
    {
      name: 'an empty run-level array',
      config: { llm_provider: [] },
      path: 'llm_provider',
      reason: 'non-empty',
    },
    {
      name: 'a blank run-level scalar',
      config: { llm_provider: '' },
      path: 'llm_provider',
      reason: 'non-empty',
    },
    {
      name: 'a blank run-level array entry',
      config: { llm_provider: ['claude', ''] },
      path: 'llm_provider',
      reason: 'non-empty',
    },
    {
      name: 'a duplicate run-level entry',
      config: { llm_provider: ['claude', 'claude'] },
      path: 'llm_provider',
      reason: 'duplicate',
    },
    {
      name: 'a non-string run-level entry',
      config: { llm_provider: ['claude', 7] },
      path: 'llm_provider',
      reason: 'string',
    },
    {
      name: 'a blank named-step scalar',
      config: { steps: { build_review: { llm_provider: '' } } },
      path: 'steps\\.build_review\\.llm_provider',
      reason: 'non-empty',
    },
    {
      name: 'a malformed named-step value',
      config: { steps: { build_review: { llm_provider: 7 } } },
      path: 'steps\\.build_review\\.llm_provider',
      reason: 'string or array',
    },
  ])('rejects $name with a path-specific diagnostic', ({ config, path, reason }) => {
    const result = validateConfig(config);
    const diagnostic = result.ok ? 'accepted invalid provider selection' : result.error.message;

    expect(diagnostic).toMatch(new RegExp(`${path}.*${reason}`, 'i'));
  });

  it('preserves a valid scalar without warnings or migration', () => {
    const result = validateConfig({ llm_provider: 'claude' });

    expect(result).toMatchObject({
      ok: true,
      config: { llm_provider: 'claude' },
      warnings: [],
    });
  });
});

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
