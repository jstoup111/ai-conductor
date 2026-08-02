import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig, validateConfig } from '../src/engine/config.js';
import type { HarnessConfig } from '../src/types/config.js';

describe('project config load errors', () => {
  it.each([
    {
      name: 'missing config names the config init remedy',
      contents: undefined,
      expectedType: 'missing',
    },
    {
      name: 'malformed YAML remains a parse error',
      contents: 'steps:\n  explore: [\n',
      expectedType: 'parse_error',
    },
  ])('$name', async ({ contents, expectedType }) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'config-load-error-'));
    try {
      if (contents !== undefined) {
        await mkdir(join(projectRoot, '.ai-conductor'));
        await writeFile(
          join(projectRoot, '.ai-conductor', 'config.yml'),
          contents,
          'utf-8',
        );
      }

      const result = await loadConfig(projectRoot);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe(expectedType);
      if (expectedType === 'missing') {
        expect.soft(result.error.message).toContain('conduct-ts config init');
        expect.soft(result.error.message).not.toContain('bin/migrate');
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

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

describe('codex_doctor_timeout_seconds config field', () => {
  it('defaults to 10 when unset', () => {
    const result = validateConfig({});

    expect(result).toMatchObject({
      ok: true,
      config: { codex_doctor_timeout_seconds: 10 },
      warnings: [],
    });
  });

  it('accepts a finite positive fractional custom timeout', () => {
    const result = validateConfig({ codex_doctor_timeout_seconds: 0.5 });

    expect(result).toMatchObject({
      ok: true,
      config: { codex_doctor_timeout_seconds: 0.5 },
      warnings: [],
    });
  });

  it.each([
    ['zero', 0],
    ['a negative number', -1],
    ['a string', '10'],
    ['NaN', NaN],
    ['infinity', Infinity],
  ])('rejects %s with a field-specific diagnostic', (_name, value) => {
    const result = validateConfig({ codex_doctor_timeout_seconds: value });

    expect(result).toEqual({
      ok: false,
      error: {
        type: 'validation_error',
        message: 'codex_doctor_timeout_seconds must be a finite positive number representable in milliseconds',
      },
    });
    if (!result.ok) expect(result.error.message).not.toMatch(/unknown top-level key/i);
  });
});

describe('step_heartbeat_stall_minutes config field', () => {
  it('accepts the deprecated compatibility no-op without granting termination authority', () => {
    const result = validateConfig({ step_heartbeat_stall_minutes: 15 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.step_heartbeat_stall_minutes).toBe(15);
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/step_heartbeat_stall_minutes.*deprecated.*compatibility no-op.*termination authority/i),
    );
  });

  it('is left unset when absent', () => {
    const result = validateConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.step_heartbeat_stall_minutes).toBeUndefined();
  });

  it('preserves 0 and negative values as compatibility input and warns they are no-ops', () => {
    const zero = validateConfig({ step_heartbeat_stall_minutes: 0 });
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.config.step_heartbeat_stall_minutes).toBe(0);
    expect(zero.warnings).toContainEqual(expect.stringMatching(/deprecated.*compatibility no-op/i));

    const negative = validateConfig({ step_heartbeat_stall_minutes: -5 });
    expect(negative.ok).toBe(true);
    if (!negative.ok) return;
    expect(negative.config.step_heartbeat_stall_minutes).toBe(-5);
    expect(negative.warnings).toContainEqual(expect.stringMatching(/deprecated.*compatibility no-op/i));
  });

  it('drops a non-numeric value with a compatibility no-op warning', () => {
    const result = validateConfig({ step_heartbeat_stall_minutes: 'soon' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.step_heartbeat_stall_minutes).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/step_heartbeat_stall_minutes.*deprecated.*no-op.*invalid/i);
  });

  it('drops a non-finite value (NaN/Infinity) with a warning', () => {
    const nanResult = validateConfig({ step_heartbeat_stall_minutes: NaN });
    expect(nanResult.ok).toBe(true);
    if (!nanResult.ok) return;
    expect(nanResult.config.step_heartbeat_stall_minutes).toBeUndefined();
    expect(nanResult.warnings).toContainEqual(expect.stringMatching(/deprecated.*no-op.*invalid/i));
  });
});

describe('provider_preparation_timeout_minutes config field', () => {
  it('accepts positive overrides and preserves zero or negative opt-outs', () => {
    const positive = validateConfig({ provider_preparation_timeout_minutes: 7 });
    const zero = validateConfig({ provider_preparation_timeout_minutes: 0 });
    const negative = validateConfig({ provider_preparation_timeout_minutes: -1 });

    expect([positive, zero, negative]).toMatchObject([
      {
        ok: true,
        config: { provider_preparation_timeout_minutes: 7 },
        warnings: [],
      },
      {
        ok: true,
        config: { provider_preparation_timeout_minutes: 0 },
        warnings: [],
      },
      {
        ok: true,
        config: { provider_preparation_timeout_minutes: -1 },
        warnings: [],
      },
    ]);
  });

  it('drops invalid values with a warning so the resolver applies its default', () => {
    const result = validateConfig({ provider_preparation_timeout_minutes: 'soon' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.provider_preparation_timeout_minutes).toBeUndefined();
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/provider_preparation_timeout_minutes.*invalid/i),
    );
  });

  it('accepts legacy heartbeat-only configs without inferring a preparation timeout', () => {
    const result = validateConfig({ step_heartbeat_stall_minutes: 0 });

    expect(result).toMatchObject({
      ok: true,
      config: { step_heartbeat_stall_minutes: 0 },
      warnings: [expect.stringMatching(/deprecated.*compatibility no-op/i)],
    });
    if (!result.ok) return;
    expect(result.config.provider_preparation_timeout_minutes).toBeUndefined();
  });
});

describe('reconcile_parked_auto_cleanup config field', () => {
  it('hard-errors a non-boolean value with the field name', () => {
    expect(validateConfig({ reconcile_parked_auto_cleanup: 'yes' })).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/reconcile_parked_auto_cleanup.*boolean/i) },
    });
  });

  it('accepts false and resolves the absent toggle to the safe auto-cleanup default', () => {
    expect([
      validateConfig({ reconcile_parked_auto_cleanup: false }),
      validateConfig({}),
    ]).toMatchObject([
      { ok: true, config: { reconcile_parked_auto_cleanup: false }, warnings: [] },
      { ok: true, config: { reconcile_parked_auto_cleanup: true }, warnings: [] },
    ]);
  });
});
