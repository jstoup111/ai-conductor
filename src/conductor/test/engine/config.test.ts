import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  validateConfig,
  disabledStepNames,
  customStepEntries,
  mergeConfigs,
  resolveMemoryProvider,
  resolveValidationConcurrency,
} from '../../src/engine/config.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'config-test-'));
    await mkdir(join(tmpDir, '.ai-conductor'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns error with config-init remedy when config missing', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'config-missing-'));
      try {
        const result = await loadConfig(emptyDir);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.type).toBe('missing');
        expect(result.error.message).toContain('conduct-ts config init');
        expect(result.error.message).not.toContain('bin/migrate');
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('reports parse error with line number for malformed YAML', async () => {
      const badYaml = `harness_version: ">=1.0.0"
steps:
  bootstrap:
    model: haiku
  bad_indent
    : broken
`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), badYaml);

      const result = await loadConfig(tmpDir);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('parse_error');
      expect(result.error.message).toMatch(/line \d+/i);
    });

    it('accepts config when harness version satisfies constraint', async () => {
      const configYaml = `harness_version: ">=1.0.0"\n`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');
      expect(result.ok).toBe(true);
    });

    it('rejects config when version too low', async () => {
      const configYaml = `harness_version: ">=2.0.0"\n`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('version_mismatch');
      expect(result.error.message).toContain('1.0.0');
      expect(result.error.message).toContain('>=2.0.0');
    });

    it('parses valid .ai-conductor/config.yml (new flat schema)', async () => {
      // Note: we write skill paths here pointing at files we don't create, so
      // the validator's skill-file-exists check would fail if projectRoot is
      // passed. Use a plain override (model/disable) which needs no file.
      const configYaml = `
harness_version: ">=1.0.0"
defaults:
  model: sonnet
  effort: medium
phases:
  UNDERSTAND:
    effort: low
steps:
  memory:
    model: haiku
  architecture_diagram:
    disable: true
complexity:
  default_tier: M
`;
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), configYaml);

      const result = await loadConfig(tmpDir, '1.0.0');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.harness_version).toBe('>=1.0.0');
      expect(result.config.defaults?.model).toBe('sonnet');
      expect(result.config.defaults?.effort).toBe('medium');
      expect(result.config.phases?.UNDERSTAND?.effort).toBe('low');
      expect(result.config.steps?.memory?.model).toBe('haiku');
      expect(result.config.steps?.architecture_diagram?.disable).toBe(true);
      expect(result.config.complexity?.default_tier).toBe('M');
      expect(result.warnings).toEqual([]);
    });

    it('keeps public project-only loading runtime-ready while the pre-merge pass defers defaults', async () => {
      await writeFile(join(tmpDir, '.ai-conductor', 'config.yml'), '{}\n');

      const ordinary = await loadConfig(tmpDir);
      const deferred = validateConfig({}, tmpDir, {
        source: 'project',
        materializeDefaults: false,
      });

      expect({
        ordinary: ordinary.ok
          ? {
              auto_restart_on_stale_engine:
                ordinary.config.auto_restart_on_stale_engine,
              build_review: ordinary.config.build_review,
              build_progress_halt: ordinary.config.build_progress_halt,
            }
          : ordinary,
        deferred: deferred.ok
          ? {
              auto_restart_on_stale_engine:
                deferred.config.auto_restart_on_stale_engine,
              build_review: deferred.config.build_review,
              build_progress_halt: deferred.config.build_progress_halt,
            }
          : deferred,
      }).toEqual({
        ordinary: {
          auto_restart_on_stale_engine: false,
          build_review: expect.objectContaining({ enabled: true }),
          build_progress_halt: {
            enabled: true,
            attempt_ceiling: 30,
            dispatch_ceiling: 20,
          },
        },
        deferred: {
          auto_restart_on_stale_engine: undefined,
          build_review: undefined,
          build_progress_halt: undefined,
        },
      });
    });
  });

  describe('validateConfig', () => {
    describe('codex_doctor_timeout_seconds', () => {
      it('resolves an omitted timeout to 10 seconds', () => {
        const result = validateConfig({});

        expect(result).toMatchObject({
          ok: true,
          config: { codex_doctor_timeout_seconds: 10 },
          warnings: [],
        });
      });

      it('preserves a finite positive fractional custom timeout', () => {
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
        ['a string', '30'],
        ['NaN', NaN],
        ['infinity', Infinity],
        ['a value that overflows milliseconds', Number.MAX_VALUE],
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

    it('returns top-level and nested defaults without mutating the caller input', () => {
      const input = {
        harness_version: '>=1.0.0',
        mergeable_autoresolve: { enabled: true },
      };
      const snapshot = structuredClone(input);

      const result = validateConfig(input);

      expect({
        normalized: result.ok
          ? {
              auto_restart_on_stale_engine: result.config.auto_restart_on_stale_engine,
              mergeable_autoresolve: result.config.mergeable_autoresolve,
            }
          : result,
        original: input,
        originalHasTopLevelDefault: Object.hasOwn(input, 'auto_restart_on_stale_engine'),
        originalHasNestedDefault: Object.hasOwn(
          input.mergeable_autoresolve,
          'cooldownMinutes',
        ),
      }).toEqual({
        normalized: {
          auto_restart_on_stale_engine: false,
          mergeable_autoresolve: {
            enabled: true,
            cooldownMinutes: 60,
          },
        },
        original: snapshot,
        originalHasTopLevelDefault: false,
        originalHasNestedDefault: false,
      });
    });

    it('preserves inputs across clamping, fallback, and unknown-key rejection', () => {
      const clampedInput = {
        attribution_audit_sample_pct: 150,
        defaults: { model: 'sonnet' },
      };
      const fallbackInput = {
        build_review: { enabled: 'banana' },
        defaults: { effort: 'medium' },
      };
      const topLevelRejectionInput = {
        defaults: { model: 'sonnet' },
        unknown_key: 'value',
      };
      const nestedRejectionInput = {
        steps: { memory: { model: 'haiku', bogus_key: 1 } },
      };
      const snapshots = structuredClone({
        clampedInput,
        fallbackInput,
        topLevelRejectionInput,
        nestedRejectionInput,
      });

      const clampedResult = validateConfig(clampedInput);
      const fallbackResult = validateConfig(fallbackInput);
      const topLevelRejectionResult = validateConfig(topLevelRejectionInput);
      const nestedRejectionResult = validateConfig(nestedRejectionInput);

      expect({
        outcomes: {
          clamped:
            clampedResult.ok && clampedResult.config.attribution_audit_sample_pct === 100
              ? clampedResult.warnings
              : clampedResult,
          fallback:
            fallbackResult.ok && fallbackResult.config.build_review?.enabled === true
              ? fallbackResult.warnings
              : fallbackResult,
          topLevelRejection:
            !topLevelRejectionResult.ok && topLevelRejectionResult.error.type === 'validation_error'
              ? topLevelRejectionResult.error.message.includes('unknown_key')
              : topLevelRejectionResult,
          nestedRejection:
            !nestedRejectionResult.ok && nestedRejectionResult.error.type === 'validation_error'
              ? nestedRejectionResult.error.message.includes('bogus_key')
              : nestedRejectionResult,
        },
        inputs: {
          clampedInput,
          fallbackInput,
          topLevelRejectionInput,
          nestedRejectionInput,
        },
      }).toEqual({
        outcomes: {
          clamped: [
            'attribution_audit_sample_pct out of range [0, 100]; clamped to 100.',
          ],
          fallback: [
            'build_review.enabled has invalid value "banana", omitting.',
          ],
          topLevelRejection: true,
          nestedRejection: true,
        },
        inputs: snapshots,
      });
    });

    it('returns validation errors without mutating non-cloneable inputs', () => {
      const unknownValue = () => 'unknown';
      const nestedValue = () => 'invalid';
      const nestedBlock = { enabled: nestedValue };
      const topLevelInput = { unknown_key: unknownValue };
      const nestedInput = { retry_routing: nestedBlock };

      const topLevelResult = validateConfig(topLevelInput);
      const nestedResult = validateConfig(nestedInput);

      expect({
        results: {
          topLevel: topLevelResult.ok
            ? topLevelResult.config
            : {
                type: topLevelResult.error.type,
                message: topLevelResult.error.message,
              },
          nested: nestedResult.ok
            ? nestedResult.config
            : {
                type: nestedResult.error.type,
                message: nestedResult.error.message,
              },
        },
        inputs: {
          topLevelInput,
          nestedInput,
        },
        identities: {
          unknownValueRetained: topLevelInput.unknown_key === unknownValue,
          nestedBlockRetained: nestedInput.retry_routing === nestedBlock,
          nestedValueRetained: nestedInput.retry_routing.enabled === nestedValue,
        },
      }).toEqual({
        results: {
          topLevel: {
            type: 'validation_error',
            message: 'Unknown top-level key: "unknown_key"',
          },
          nested: {
            type: 'validation_error',
            message: 'retry_routing.enabled must be a boolean',
          },
        },
        inputs: {
          topLevelInput: { unknown_key: unknownValue },
          nestedInput: { retry_routing: { enabled: nestedValue } },
        },
        identities: {
          unknownValueRetained: true,
          nestedBlockRetained: true,
          nestedValueRetained: true,
        },
      });
    });

    it('isolates returned nested objects and arrays from caller-owned references', () => {
      const input = {
        defaults: { model: 'sonnet' },
        model_fallback_ladder: ['fable', 'opus'],
      };
      const snapshot = structuredClone(input);
      const originalDefaults = input.defaults;
      const originalFallbackLadder = input.model_fallback_ladder;

      const result = validateConfig(input);
      if (!result.ok) throw new Error(result.error.message);
      if (!result.config.defaults || !result.config.model_fallback_ladder) {
        throw new Error('expected normalized nested configuration');
      }

      const returnedDefaults = result.config.defaults;
      const returnedFallbackLadder = result.config.model_fallback_ladder;
      returnedDefaults.model = 'haiku';
      returnedFallbackLadder.push('sonnet');

      expect({
        original: input,
        identities: {
          originalDefaultsRetained: input.defaults === originalDefaults,
          originalFallbackLadderRetained:
            input.model_fallback_ladder === originalFallbackLadder,
          returnedDefaultsIsolated: returnedDefaults !== originalDefaults,
          returnedFallbackLadderIsolated:
            returnedFallbackLadder !== originalFallbackLadder,
        },
      }).toEqual({
        original: snapshot,
        identities: {
          originalDefaultsRetained: true,
          originalFallbackLadderRetained: true,
          returnedDefaultsIsolated: true,
          returnedFallbackLadderIsolated: true,
        },
      });
    });

    it('defers absent project defaults while ordinary validation materializes them', () => {
      const input = {
        mergeable_autoresolve: { enabled: true },
      };

      const deferred = validateConfig(structuredClone(input), '/repo', {
        source: 'project',
        materializeDefaults: false,
      });
      const ordinary = validateConfig(structuredClone(input));

      expect({
        deferred: deferred.ok
          ? {
              auto_restart_on_stale_engine:
                deferred.config.auto_restart_on_stale_engine,
              build_review: deferred.config.build_review,
              mergeable_autoresolve: deferred.config.mergeable_autoresolve,
            }
          : deferred,
        ordinary: ordinary.ok
          ? {
              auto_restart_on_stale_engine:
                ordinary.config.auto_restart_on_stale_engine,
              build_review: ordinary.config.build_review,
              mergeable_autoresolve: ordinary.config.mergeable_autoresolve,
            }
          : ordinary,
      }).toEqual({
        deferred: {
          auto_restart_on_stale_engine: undefined,
          build_review: undefined,
          mergeable_autoresolve: {
            enabled: true,
            cooldownMinutes: 60,
          },
        },
        ordinary: {
          auto_restart_on_stale_engine: false,
          build_review: expect.objectContaining({ enabled: true }),
          mergeable_autoresolve: {
            enabled: true,
            cooldownMinutes: 60,
          },
        },
      });
    });

    it('rejects steps.<name> if not an object', () => {
      const result = validateConfig({
        steps: { memory: 'haiku' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('steps.memory');
    });

    it('accepts rebase_resolution_attempts as a known top-level key', () => {
      const result = validateConfig({ rebase_resolution_attempts: 5 });
      expect(result.ok).toBe(true);
    });

    it('accepts validation_concurrency as a known top-level key', () => {
      const result = validateConfig({ validation_concurrency: 3 });
      expect(result.ok).toBe(true);
    });

    it('rejects a typo of validation_concurrency as an unknown top-level key', () => {
      const result = validateConfig({ validation_concurency: 3 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('validation_concurency');
    });

    it('passes when validation_concurrency is absent', () => {
      const result = validateConfig({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.validation_concurrency).toBeUndefined();
    });

    it('rejects validation_concurrency when not a number', () => {
      const result = validateConfig({ validation_concurrency: 'three' as unknown as number });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('validation_concurrency');
    });

    it('resolveValidationConcurrency defaults to 4 when absent', () => {
      expect(resolveValidationConcurrency({})).toBe(4);
    });

    it('resolveValidationConcurrency returns explicit 3', () => {
      expect(resolveValidationConcurrency({ validation_concurrency: 3 })).toBe(3);
    });

    it('resolveValidationConcurrency returns explicit 1', () => {
      expect(resolveValidationConcurrency({ validation_concurrency: 1 })).toBe(1);
    });

    it('resolveValidationConcurrency clamps 0 to default 4', () => {
      expect(resolveValidationConcurrency({ validation_concurrency: 0 })).toBe(4);
    });

    it('resolveValidationConcurrency clamps negative to default 4', () => {
      expect(resolveValidationConcurrency({ validation_concurrency: -4 })).toBe(4);
    });

    it('resolveValidationConcurrency clamps NaN/non-numeric to default 4', () => {
      expect(
        resolveValidationConcurrency({
          validation_concurrency: NaN as unknown as number,
        }),
      ).toBe(4);
      expect(
        resolveValidationConcurrency({
          validation_concurrency: 'x' as unknown as number,
        }),
      ).toBe(4);
    });

    it('rejects disabling a gating step', () => {
      const result = validateConfig({
        steps: { stories: { disable: true } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/gating/i);
      expect(result.error.message).toContain('stories');
    });

    it('accepts steps.manual_test.disable: true — manual_test opts into config-disable', () => {
      const result = validateConfig({
        steps: { manual_test: { disable: true } },
      });
      expect(result.ok).toBe(true);
    });

    it('accepts steps.prd_audit.disable: true — prd_audit explicitly opts into config-disable', () => {
      const result = validateConfig({
        steps: { prd_audit: { disable: true } },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects steps.test_suite.disable: true — the native BUILD gate is non-disableable', () => {
      const result = validateConfig({
        steps: { test_suite: { disable: true } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/test_suite/);
      expect(result.error.message).toMatch(/gating/i);
    });

    it('rejects disabling a structural step', () => {
      const result = validateConfig({
        steps: { build: { disable: true } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('build');
    });

    it('rejects invalid effort value', () => {
      const result = validateConfig({
        steps: { memory: { effort: 'exhaustive' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/low\|medium\|high\|xhigh\|max/);
    });

    it('rejects invalid max_retries type', () => {
      const result = validateConfig({
        steps: { memory: { max_retries: 'three' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/number/i);
    });

    it('rejects unknown top-level keys (fail-fast)', () => {
      const result = validateConfig({
        harness_version: '>=1.0.0',
        unknown_key: 'value',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('unknown_key');
    });

    it('rejects unknown step-level keys (fail-fast)', () => {
      const result = validateConfig({
        steps: { memory: { model: 'haiku', bogus_key: 1 } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('bogus_key');
    });

    it('accepts provider-native TDD RED/GREEN model overrides on the build step', () => {
      const result = validateConfig({
        llm_provider: 'codex',
        steps: {
          build: {
            tdd: {
              red: { model: 'gpt-5.6-luna' },
              green: { model: 'gpt-5.6-terra' },
            },
          },
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.steps?.build?.tdd?.red?.model).toBe('gpt-5.6-luna');
      expect(result.config.steps?.build?.tdd?.green?.model).toBe('gpt-5.6-terra');
    });

    it('rejects TDD models that do not belong to the selected provider', () => {
      const result = validateConfig({
        llm_provider: 'codex',
        steps: { build: { tdd: { red: { model: 'haiku' } } } },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('steps.build.tdd.red.model');
      expect(result.error.message).toContain('codex');
    });

    it('rejects TDD model configuration when llm_provider is not a string', () => {
      const result = validateConfig({
        llm_provider: 42,
        steps: { build: { tdd: { red: { model: 'haiku' } } } },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('llm_provider');
    });

    it('rejects TDD model configuration outside the build step', () => {
      const result = validateConfig({
        steps: { memory: { tdd: { red: { model: 'haiku' } } } },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('steps.memory.tdd');
    });

    it('rejects invalid phase name', () => {
      const result = validateConfig({
        phases: { NONEXISTENT: { effort: 'medium' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('NONEXISTENT');
    });

    it('rejects custom step with missing SKILL.md', () => {
      const result = validateConfig(
        {
          steps: {
            lint: { after: 'build', skill: 'nonexistent-skill', enforcement: 'gating' },
          },
        },
        tmpDir,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toContain('nonexistent-skill');
    });

    it('rejects custom step with unknown after target', () => {
      const result = validateConfig({
        steps: {
          lint: { after: 'nonexistent_step', skill: 'custom-lint', enforcement: 'gating' },
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('nonexistent_step');
    });

    it('rejects custom step without after', () => {
      const result = validateConfig({
        steps: { lint: { skill: 'custom-lint' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/after/);
    });

    it('accepts custom step with valid after target and existing SKILL.md', async () => {
      await mkdir(join(tmpDir, 'skills', 'custom-lint'), { recursive: true });
      await writeFile(
        join(tmpDir, 'skills', 'custom-lint', 'SKILL.md'),
        '---\nname: custom-lint\n---\n',
      );

      const result = validateConfig(
        {
          steps: {
            lint: {
              after: 'build',
              skill: 'skills/custom-lint/SKILL.md',
              enforcement: 'gating',
            },
          },
        },
        tmpDir,
      );

      expect(result.ok).toBe(true);
    });

    it('accepts an exact .pipeline completion artifact for a custom step', () => {
      const result = validateConfig({
        steps: {
          lint: {
            after: 'build',
            skill: 'custom-lint',
            enforcement: 'gating',
            completion_artifact: '.pipeline/custom-lint-pass',
          },
        },
      });

      expect(result.ok).toBe(true);
    });

    it('enforces the custom-step completion artifact path boundary', () => {
      const customStepConfig = (completionArtifact: string) => ({
        steps: {
          lint: {
            after: 'build',
            skill: 'custom-lint',
            enforcement: 'gating',
            completion_artifact: completionArtifact,
          },
        },
      });
      const configs = [
        customStepConfig(''),
        customStepConfig('/'),
        customStepConfig('.pipeline-evil/pass'),
        customStepConfig('.pipeline/../pass'),
        customStepConfig('.pipeline/*-pass'),
        customStepConfig('.pipeline/'),
        customStepConfig('.pipeline//pass'),
        customStepConfig('.pipeline/pass'),
        { steps: { memory: { completion_artifact: '.pipeline/memory-pass' } } },
      ];

      const outcomes = configs.map((config) => {
        const result = validateConfig(config);
        return result.ok ? 'accepted' : result.error.message;
      });

      expect(outcomes).toEqual([
        'steps.lint.completion_artifact must be a non-empty string',
        'steps.lint.completion_artifact must be repository-relative',
        'steps.lint.completion_artifact must be under .pipeline/',
        'steps.lint.completion_artifact must not contain traversal segments',
        'steps.lint.completion_artifact must be an exact file path without glob syntax',
        'steps.lint.completion_artifact must name a file under .pipeline/',
        'steps.lint.completion_artifact must be normalized',
        'accepted',
        'steps.memory.completion_artifact is not valid for built-in steps',
      ]);
    });

    it('rejects built-in step setting `after` (fail-fast)', () => {
      const result = validateConfig({
        steps: { memory: { after: 'worktree' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('after');
      expect(result.error.message).toContain('memory');
    });

    it('rejects built-in step setting `enforcement` (fail-fast)', () => {
      const result = validateConfig({
        steps: { memory: { enforcement: 'gating' } },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('enforcement');
    });

    it('accepts chained custom steps (after: <sibling-custom>)', async () => {
      await mkdir(join(tmpDir, 'skills', 'lint'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'lint', 'SKILL.md'), '---\nname: lint\n---\n');
      await mkdir(join(tmpDir, 'skills', 'format'), { recursive: true });
      await writeFile(join(tmpDir, 'skills', 'format', 'SKILL.md'), '---\nname: format\n---\n');

      const result = validateConfig(
        {
          steps: {
            lint: {
              after: 'build',
              skill: 'skills/lint/SKILL.md',
              enforcement: 'advisory',
            },
            format: {
              after: 'lint',
              skill: 'skills/format/SKILL.md',
              enforcement: 'advisory',
            },
          },
        },
        tmpDir,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('markdown_viewer validation', () => {
    it('accepts a valid preset block', () => {
      const result = validateConfig({
        markdown_viewer: {
          preset: 'glow',
          command: 'glow',
          args: ['-p', '-w', '80', '{file}'],
          mode: 'inline',
        },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects args without {file} placeholder', () => {
      const result = validateConfig({
        markdown_viewer: { command: 'glow', args: ['-p', '-w', '80'], mode: 'inline' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/\{file\}/);
    });

    it('rejects invalid mode', () => {
      const result = validateConfig({
        markdown_viewer: { command: 'glow', args: ['{file}'], mode: 'weird' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/inline\|blocking\|external/);
    });

    it('rejects unknown keys under markdown_viewer', () => {
      const result = validateConfig({
        markdown_viewer: { command: 'glow', args: ['{file}'], mode: 'inline', bogus: 1 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/bogus/);
    });

    it('rejects non-string args entries', () => {
      const result = validateConfig({
        markdown_viewer: { command: 'glow', args: ['-w', 80, '{file}'], mode: 'inline' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/array of strings/);
    });
  });

  describe('mermaid_renderer validation', () => {
    it('accepts a valid preset block', () => {
      const result = validateConfig({
        mermaid_renderer: {
          preset: 'html',
          command: '',
          args: ['{file}'],
          mode: 'external',
        },
      });
      expect(result.ok).toBe(true);
    });

    it('accepts a block with no command (html/none presets need no tool)', () => {
      const result = validateConfig({
        mermaid_renderer: { preset: 'none', args: ['{file}'], mode: 'external' },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects args without {file} placeholder', () => {
      const result = validateConfig({
        mermaid_renderer: { command: 'mmdc', args: ['-i'], mode: 'external' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/\{file\}/);
    });

    it('rejects invalid mode', () => {
      const result = validateConfig({
        mermaid_renderer: { command: 'mmdc', args: ['{file}'], mode: 'weird' },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/inline\|blocking\|external/);
    });

    it('rejects unknown keys under mermaid_renderer', () => {
      const result = validateConfig({
        mermaid_renderer: { command: 'mmdc', args: ['{file}'], mode: 'external', bogus: 1 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/bogus/);
    });
  });

  describe('conductor block validation', () => {
    it('accepts tagged/main/stable update_channel', () => {
      expect(
        (['tagged', 'stable', 'main'] as const).map((update_channel) => (
          validateConfig({ conductor: { update_channel } }).ok
        )),
      ).toEqual([true, true, true]);
    });

    it('rejects other update_channel values', () => {
      const result = validateConfig({ conductor: { update_channel: 'nightly' } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/tagged/);
    });

    it('rejects non-boolean auto_check', () => {
      const result = validateConfig({ conductor: { auto_check: 'yes' } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/boolean/);
    });
  });

  describe('acceptance_spec_globs validation', () => {
    it('accepts an array of glob strings', () => {
      const result = validateConfig({
        acceptance_spec_globs: ['*/spec/**/*', 'api/spec/**/*'],
      });
      expect(result.ok).toBe(true);
    });

    it('rejects a non-array value', () => {
      const result = validateConfig({ acceptance_spec_globs: 'spec/**/*' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/array/);
    });

    it('rejects an array with a non-string entry', () => {
      const result = validateConfig({ acceptance_spec_globs: ['ok', 42] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/strings/);
    });

    it('lets a project array replace a user array via mergeConfigs', () => {
      const merged = mergeConfigs(
        { acceptance_spec_globs: ['tests/**/*'] },
        { acceptance_spec_globs: ['*/spec/**/*'] },
      );
      expect(merged.acceptance_spec_globs).toEqual(['*/spec/**/*']);
    });
  });

  describe('test_suite config block', () => {
    it('loads and exposes an optional scoped_command template', async () => {
      await writeFile(
        join(tmpDir, '.ai-conductor', 'config.yml'),
        'test_suite:\n  command: npm test\n  scoped_command: npx vitest run {selectors}\n',
      );

      const result = await loadConfig(tmpDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.test_suite?.scoped_command).toBe('npx vitest run {selectors}');
    });

    it('accepts a scoped-only test_suite declaration', () => {
      const result = validateConfig({
        test_suite: { scoped_command: 'npx vitest run {selectors}' },
      });

      expect(result.ok).toBe(true);
    });

    it('rejects a scoped_command template without the selector placeholder', async () => {
      await writeFile(
        join(tmpDir, '.ai-conductor', 'config.yml'),
        'test_suite:\n  command: npm test\n  scoped_command: npx vitest run\n',
      );

      const result = await loadConfig(tmpDir);

      expect(result).toMatchObject({
        ok: false,
        error: {
          type: 'validation_error',
          message: expect.stringMatching(/test_suite\.scoped_command.*\{selectors\}/),
        },
      });
    });

    it.each([
      ['an empty string', ''],
      ['a whitespace-only string', '   '],
      ['a number', 42],
      ['a list', ['npx', 'vitest', 'run', '{selectors}']],
      ['an object', { command: 'npx vitest run {selectors}' }],
    ])('rejects scoped_command that is %s', (_name, scopedCommand) => {
      const result = validateConfig({
        test_suite: { command: 'npm test', scoped_command: scopedCommand },
      });

      expect(result).toMatchObject({
        ok: false,
        error: {
          type: 'validation_error',
          message: expect.stringMatching(/test_suite\.scoped_command/),
        },
      });
    });

    it('loads a test_suite without scoped_command as undefined', async () => {
      await writeFile(
        join(tmpDir, '.ai-conductor', 'config.yml'),
        'test_suite:\n  command: npm test\n',
      );

      const result = await loadConfig(tmpDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.test_suite?.scoped_command).toBeUndefined();
    });

    it('accepts an aggregate suite declaration with every supported field', () => {
      const testSuite = {
        command: 'npm test',
        working_directory: 'src/conductor',
        timeout_seconds: 1800,
        inputs: ['test-support/**'],
        environment: ['CI', 'DATABASE_URL'],
      };

      const result = validateConfig({ test_suite: testSuite });

      expect(result.ok && result.config.test_suite).toEqual(testSuite);
    });

    it.each([
      ['a non-object block', 'npm test', /test_suite must be an object/],
      ['an unknown key', { command: 'npm test', retries: 2 }, /test_suite.*retries/],
      ['a missing command', {}, /test_suite\.command/],
      ['a blank command', { command: '   ' }, /test_suite\.command/],
      [
        'a non-numeric timeout',
        { command: 'npm test', timeout_seconds: 'slow' },
        /test_suite\.timeout_seconds/,
      ],
      [
        'a zero timeout',
        { command: 'npm test', timeout_seconds: 0 },
        /test_suite\.timeout_seconds/,
      ],
      [
        'a negative timeout',
        { command: 'npm test', timeout_seconds: -1 },
        /test_suite\.timeout_seconds/,
      ],
      [
        'a non-string inputs entry',
        { command: 'npm test', inputs: ['package.json', 42] },
        /test_suite\.inputs/,
      ],
      [
        'a non-string environment entry',
        { command: 'npm test', environment: ['CI', false] },
        /test_suite\.environment/,
      ],
      [
        'an absolute working directory',
        { command: 'npm test', working_directory: '/tmp/project' },
        /test_suite\.working_directory/,
      ],
      [
        'a working directory that escapes the project root',
        { command: 'npm test', working_directory: '../outside' },
        /test_suite\.working_directory/,
      ],
    ])('rejects %s with a field-specific error', (_name, testSuite, expectedMessage) => {
      const result = validateConfig({ test_suite: testSuite }, tmpDir);

      expect(result.ok ? '' : result.error.message).toMatch(expectedMessage);
    });

    it('rejects an existing working_directory symlink that escapes the project root', async () => {
      const outside = await mkdtemp(join(tmpdir(), 'config-outside-'));
      try {
        await symlink(outside, join(tmpDir, 'linked-workdir'));

        const result = validateConfig(
          { test_suite: { command: 'npm test', working_directory: 'linked-workdir' } },
          tmpDir,
        );

        expect(result.ok ? '' : result.error.message).toMatch(/test_suite\.working_directory/);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it('keeps the entire test_suite block optional at global config validation', () => {
      expect(validateConfig({}).ok).toBe(true);
    });
  });

  describe('model_fallback_ladder validation', () => {
    it('accepts an array of non-empty model strings', () => {
      const result = validateConfig({ model_fallback_ladder: ['fable', 'opus'] });
      expect(result.ok).toBe(true);
    });

    it('accepts an empty array (no fallback)', () => {
      const result = validateConfig({ model_fallback_ladder: [] });
      expect(result.ok).toBe(true);
    });

    it('rejects a string value instead of an array', () => {
      const result = validateConfig({ model_fallback_ladder: 'fable' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/model_fallback_ladder/);
    });

    it('rejects an array containing a number', () => {
      const result = validateConfig({ model_fallback_ladder: ['fable', 5] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/model_fallback_ladder/);
    });

    it('rejects an array containing an empty string', () => {
      const result = validateConfig({ model_fallback_ladder: ['fable', ''] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/model_fallback_ladder/);
    });
  });

  describe('mergeConfigs', () => {
    it.each([
      {
        name: 'project scalar replaces a user array',
        user: { llm_provider: ['claude', 'codex'] },
        project: { llm_provider: 'codex' },
        expected: 'codex',
      },
      {
        name: 'project array replaces a user scalar without index merging',
        user: { llm_provider: 'claude' },
        project: { llm_provider: ['codex', 'claude'] },
        expected: ['codex', 'claude'],
      },
    ] satisfies Array<{
      name: string;
      user: Parameters<typeof mergeConfigs>[0];
      project: Parameters<typeof mergeConfigs>[1];
      expected: 'codex' | string[];
    }>)('$name', ({ user, project, expected }) => {
      expect(mergeConfigs(user, project).llm_provider).toEqual(expected);
    });

    it('preserves a user step provider while project model settings override independently', () => {
      const merged = mergeConfigs(
        {
          defaults: { model: 'sonnet', effort: 'low', max_retries: 2 },
          steps: { build_review: { llm_provider: 'codex', model: 'sonnet' } },
        },
        {
          defaults: { model: 'opus', effort: 'high' },
          steps: { build_review: { model: 'opus' } },
        },
      );

      expect({
        stepProvider: merged.steps?.build_review?.llm_provider,
        stepModel: merged.steps?.build_review?.model,
        defaultModel: merged.defaults?.model,
        defaultEffort: merged.defaults?.effort,
        defaultRetries: merged.defaults?.max_retries,
      }).toEqual({
        stepProvider: 'codex',
        stepModel: 'opus',
        defaultModel: 'opus',
        defaultEffort: 'high',
        defaultRetries: 2,
      });
    });

    it('project scalars replace user scalars', () => {
      const merged = mergeConfigs(
        { defaults: { model: 'sonnet' } },
        { defaults: { model: 'opus' } },
      );
      expect(merged.defaults?.model).toBe('opus');
    });

    it('project objects merge with user objects key-by-key', () => {
      const merged = mergeConfigs(
        { markdown_viewer: { command: 'glow', args: ['{file}'], mode: 'inline', preset: 'glow' } },
        { markdown_viewer: { mode: 'blocking' } as unknown as never },
      );
      expect(merged.markdown_viewer?.command).toBe('glow');
      expect(merged.markdown_viewer?.mode).toBe('blocking');
    });

    it('project arrays replace user arrays (no concat)', () => {
      const merged = mergeConfigs(
        { markdown_viewer: { command: 'glow', args: ['-p', '{file}'], mode: 'inline' } },
        {
          markdown_viewer: {
            command: 'code',
            args: ['--wait', '{file}'],
            mode: 'blocking',
          },
        },
      );
      expect(merged.markdown_viewer?.args).toEqual(['--wait', '{file}']);
    });

    it('user-only keys pass through untouched', () => {
      const merged = mergeConfigs(
        { conductor: { update_channel: 'main', current_version: '1.0.0' } },
        {},
      );
      expect(merged.conductor?.update_channel).toBe('main');
      expect(merged.conductor?.current_version).toBe('1.0.0');
    });
  });

  // Task A4 (adr-2026-06-29-per-project-memory-provider-selection): memory_provider config field
  describe('memory_provider config field', () => {
    it('accepts memory_provider: local and exposes it on the parsed config', () => {
      const result = validateConfig({ memory_provider: 'local' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.memory_provider).toBe('local');
    });

    it('accepts memory_provider alongside other plugin selections', () => {
      const result = validateConfig({
        llm_provider: 'claude',
        ui_renderer: 'terminal',
        memory_provider: 'local',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.memory_provider).toBe('local');
      expect(result.config.llm_provider).toBe('claude');
    });

    it('memory_provider: absent is fine — field is optional', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.memory_provider).toBeUndefined();
    });
  });

  // Task 17 (owner-gate, adr-2026-06-30-*): spec_owner + owner_gate_cutover.
  describe('owner-gate config fields (spec_owner + owner_gate_cutover)', () => {
    it('parses spec_owner and owner_gate_cutover and exposes them', () => {
      const result = validateConfig({
        spec_owner: 'alice',
        owner_gate_cutover: '2026-06-30T00:00:00Z',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.spec_owner).toBe('alice');
      expect(result.config.owner_gate_cutover).toBe('2026-06-30T00:00:00Z');
    });

    it('both fields are optional — absent is fine (documented default applied at wiring)', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.spec_owner).toBeUndefined();
      expect(result.config.owner_gate_cutover).toBeUndefined();
    });

    it('REJECTS a malformed (unparseable) owner_gate_cutover with a clear error', () => {
      const result = validateConfig({ owner_gate_cutover: 'not-a-date' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toMatch(/owner_gate_cutover.*not.*parseable/i);
      expect(result.error.message).toMatch(/not-a-date/);
    });

    it('rejects a non-string spec_owner', () => {
      const result = validateConfig({ spec_owner: 42 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/spec_owner must be a string/);
    });

    it('rejects a non-string owner_gate_cutover', () => {
      const result = validateConfig({ owner_gate_cutover: 1234 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/owner_gate_cutover must be an ISO-8601 date string/);
    });

    // Anti-leak guard (A4 / D2 / Story 2): a `spec_owner` committed into a
    // shared PROJECT config would leak one operator's identity to everyone who
    // pulls. Loading a project config that carries the key is a hard rejection
    // that names the file and the fix. Identity is user-config-only.
    describe('anti-leak guard: spec_owner in a project config (D2)', () => {
      it('REJECTS a project-source config that carries spec_owner, naming the file and the fix', () => {
        const result = validateConfig({ spec_owner: 'jstoup111' }, '/repo', {
          source: 'project',
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.type).toBe('validation_error');
        // Names the committed file …
        expect(result.error.message).toMatch(/\.ai-conductor\/config\.yml/);
        // … and the fix: move it to the user config.
        expect(result.error.message).toMatch(/~\/\.ai-conductor\/config\.yml/);
        expect(result.error.message).toMatch(/spec_owner/);
      });

      it('REJECTS a blank/whitespace spec_owner in a project config (a present key is the leak)', () => {
        const blank = validateConfig({ spec_owner: '   ' }, '/repo', { source: 'project' });
        expect(blank.ok).toBe(false);
        const empty = validateConfig({ spec_owner: '' }, '/repo', { source: 'project' });
        expect(empty.ok).toBe(false);
      });

      it('ACCEPTS a project config with NO spec_owner (guard only triggers on the leak)', () => {
        const result = validateConfig({ defaults: { model: 'sonnet' } }, '/repo', {
          source: 'project',
        });
        expect(result.ok).toBe(true);
      });

      it('ACCEPTS spec_owner on the merged/user path (identity is legitimately user-config-sourced)', () => {
        const result = validateConfig({ spec_owner: 'jstoup111' }, '/repo', {
          source: 'merged',
        });
        expect(result.ok).toBe(true);
      });

      it('loadConfig REJECTS a committed project config that carries spec_owner', async () => {
        await writeFile(
          join(tmpDir, '.ai-conductor', 'config.yml'),
          'spec_owner: jstoup111\n',
        );
        const result = await loadConfig(tmpDir);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/spec_owner/);
        expect(result.error.message).toMatch(/~\/\.ai-conductor\/config\.yml/);
      });

      it('loadConfig still succeeds for a project config with no spec_owner (no regression)', async () => {
        await writeFile(
          join(tmpDir, '.ai-conductor', 'config.yml'),
          'defaults:\n  model: sonnet\n',
        );
        const result = await loadConfig(tmpDir);
        expect(result.ok).toBe(true);
      });
    });
  });

  describe('retired attribution cutover config keys', () => {
    it('rejects retired cutovers as unknown while retaining audit sample resolution', () => {
      const retiredKeyOutcomes = Object.fromEntries(
        ['attribution_enforcement_cutover', 'attribution_judge_cutover'].map((key) => {
          const result = validateConfig({ [key]: '2026-01-01T00:00:00Z' });
          return [key, result.ok ? 'accepted' : result.error.message];
        }),
      );
      const auditSampleResult = validateConfig({ attribution_audit_sample_pct: 25 });

      expect({
        retiredKeyOutcomes,
        auditSamplePct: auditSampleResult.ok
          ? auditSampleResult.config.attribution_audit_sample_pct
          : auditSampleResult.error.message,
      }).toEqual({
        retiredKeyOutcomes: {
          attribution_enforcement_cutover:
            'Unknown top-level key: "attribution_enforcement_cutover"',
          attribution_judge_cutover: 'Unknown top-level key: "attribution_judge_cutover"',
        },
        auditSamplePct: 25,
      });
    });
  });

  describe('conflict_check forward-compatibility', () => {
    it('accepts a config that sets conflict_check ahead of the block validation landing', () => {
      const result = validateConfig({ conflict_check: { adr_corpus: 'repo_wide' } });

      expect(result.ok).toBe(true);
    });
  });

  // Task 3 (negative paths: TR-1): build_auth.mode validation — fail-closed for unknown/empty/non-string modes
  describe('harness_self_host.build_auth.mode validation (Task 3: TR-1 negative paths)', () => {
    it('accepts valid mode: daemon-token', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: 'daemon-token',
          },
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.harness_self_host?.build_auth?.mode).toBe('daemon-token');
    });

    it('accepts valid mode: api-key', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: 'api-key',
          },
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.harness_self_host?.build_auth?.mode).toBe('api-key');
    });

    it('accepts undefined mode (optional field)', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            token_path: '/path/to/token',
          },
        },
      });
      expect(result.ok).toBe(true);
    });

    it('REJECTS unknown mode: operator-oauth', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: 'operator-oauth',
          },
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      // Message should name the invalid value
      expect(result.error.message).toContain('operator-oauth');
      // Message should list valid options
      expect(result.error.message).toMatch(/daemon-token.*api-key|api-key.*daemon-token/);
    });

    it('REJECTS empty string mode', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: '',
          },
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      // Message should list valid options
      expect(result.error.message).toMatch(/daemon-token.*api-key|api-key.*daemon-token/);
    });

    it('REJECTS non-string mode (number)', () => {
      const result = validateConfig({
        harness_self_host: {
          build_auth: {
            mode: 42,
          },
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      // Message should list valid options
      expect(result.error.message).toMatch(/daemon-token.*api-key|api-key.*daemon-token/);
    });
  });

  // Task A10 (adr-2026-06-29-per-project-memory-provider-selection FR-1 negative): provider selection is per-project; no leakage.
  describe('A10: resolveMemoryProvider — per-project isolation, no leakage', () => {
    function registryWithLocal(provider: object): PluginRegistry {
      const reg = new PluginRegistry();
      reg.register('memory_provider' as any, 'local', provider);
      return reg;
    }

    it('two configs with different memory_provider values resolve independently', async () => {
      const LOCAL = { name: 'local', kind: 'memory_provider' };
      const registry = registryWithLocal(LOCAL);

      const ctxA = { warnings: [] as string[] };
      const ctxB = { warnings: [] as string[] };

      const a = await resolveMemoryProvider({ memory_provider: 'local' } as any, registry, ctxA);
      const b = await resolveMemoryProvider({ memory_provider: 'unknown-b' } as any, registry, ctxB);

      // A's valid resolution is correct.
      expect(a).toBe(LOCAL);
      expect(ctxA.warnings).toEqual([]);

      // B's bad resolution falls back to local with one warning — independently.
      expect(b).toBe(LOCAL);
      expect(ctxB.warnings.length).toBe(1);
    });

    it('resolving one config does NOT mutate the other config object', async () => {
      const LOCAL = { name: 'local', kind: 'memory_provider' };
      const registry = registryWithLocal(LOCAL);

      const configA = { memory_provider: 'local' };
      const configB = { memory_provider: 'nope' };

      await resolveMemoryProvider(configA as any, registry, { warnings: [] });
      await resolveMemoryProvider(configB as any, registry, { warnings: [] });

      // Neither config object was mutated.
      expect(configA.memory_provider).toBe('local');
      expect(configB.memory_provider).toBe('nope');
    });

    it('re-resolving config A after resolving config B still yields local (no shared state)', async () => {
      const LOCAL = { name: 'local', kind: 'memory_provider' };
      const registry = registryWithLocal(LOCAL);

      const ctxB = { warnings: [] as string[] };
      await resolveMemoryProvider({ memory_provider: 'unknown-b' } as any, registry, ctxB);

      // A fresh ctx for config A should see no contamination from config B.
      const ctxA = { warnings: [] as string[] };
      const aAgain = await resolveMemoryProvider(
        { memory_provider: 'local' } as any,
        registry,
        ctxA,
      );
      expect(aAgain).toBe(LOCAL);
      expect(ctxA.warnings).toEqual([]);
    });

    it('purity: resolver has no module-level mutable state — repeated calls with fresh ctx are independent', async () => {
      const LOCAL = { name: 'local', kind: 'memory_provider' };
      const registry = registryWithLocal(LOCAL);

      // Three independent resolutions of the same bad name, each with a fresh ctx.
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          resolveMemoryProvider(
            { memory_provider: 'bad-name' } as any,
            registry,
            { warnings: [] },
          ).then((p) => p),
        ),
      );

      // All three degrade to local.
      for (const r of results) expect(r).toBe(LOCAL);
    });
  });

  describe('adapters', () => {
    it('disabledStepNames returns names whose block has disable=true', () => {
      expect(
        disabledStepNames({
          steps: {
            architecture_diagram: { disable: true },
            architecture_review: { disable: true },
            brainstorm: { model: 'opus' }, // not disabled
          },
        }),
      ).toEqual(expect.arrayContaining(['architecture_diagram', 'architecture_review']));
    });

    it('customStepEntries returns only non-built-in entries with after+skill', () => {
      const entries = customStepEntries({
        steps: {
          bootstrap: { model: 'haiku' }, // built-in — skip
          lint: { after: 'build', skill: 'custom-lint', enforcement: 'gating' },
          deploy: { after: 'build', skill: 'custom-deploy' }, // default enforcement=advisory
        },
      });
      expect(entries).toHaveLength(2);
      const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
      expect(byName.lint.enforcement).toBe('gating');
      expect(byName.deploy.enforcement).toBe('advisory');
    });
  });

  describe('daemon_verbose config field', () => {
    it('accepts true', () => {
      const result = validateConfig({ daemon_verbose: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.daemon_verbose).toBe(true);
    });

    it('accepts false', () => {
      const result = validateConfig({ daemon_verbose: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.daemon_verbose).toBe(false);
    });

    it('accepts absent/undefined', () => {
      const result = validateConfig({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.daemon_verbose).toBeUndefined();
    });

    it('rejects a non-boolean value', () => {
      const result = validateConfig({ daemon_verbose: 'yes' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe('daemon_verbose must be a boolean');
    });
  });

  describe('auto_restart_on_stale_engine config field', () => {
    it('resolves true to true without warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves false to false without warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: false });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves absent (missing key) to false silently', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves null to false silently', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: null });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves invalid string value to false with one warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: 'banana' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/auto_restart_on_stale_engine.*invalid/i);
      expect(result.warnings[0]).toMatch(/banana/);
    });

    it('resolves invalid number value to false with one warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/auto_restart_on_stale_engine.*invalid/i);
    });

    it('resolves invalid object value to false with one warning', () => {
      const result = validateConfig({ auto_restart_on_stale_engine: {} });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/auto_restart_on_stale_engine.*invalid/i);
    });

    it('never throws — always returns ok: true', () => {
      const testCases = [
        { auto_restart_on_stale_engine: true },
        { auto_restart_on_stale_engine: false },
        { auto_restart_on_stale_engine: 'yes' },
        { auto_restart_on_stale_engine: 'no' },
        { auto_restart_on_stale_engine: 1 },
        { auto_restart_on_stale_engine: 0 },
        { auto_restart_on_stale_engine: [] },
        { auto_restart_on_stale_engine: {} },
        { auto_restart_on_stale_engine: null },
        {},
      ];
      for (const testCase of testCases) {
        const result = validateConfig(testCase);
        expect(result.ok).toBe(true);
      }
    });

    it('emits only one warning per invalid value', () => {
      const result1 = validateConfig({ auto_restart_on_stale_engine: 'invalid' });
      expect(result1.ok).toBe(true);
      if (!result1.ok) return;
      expect(result1.warnings).toHaveLength(1);

      const result2 = validateConfig({ auto_restart_on_stale_engine: 'invalid' });
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      expect(result2.warnings).toHaveLength(1);
    });

    it('default is false when config is empty', () => {
      const result = validateConfig({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(false);
    });

    it('works with other config fields present', () => {
      const result = validateConfig({
        harness_version: '>=1.0.0',
        auto_restart_on_stale_engine: true,
        defaults: { model: 'sonnet' },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.auto_restart_on_stale_engine).toBe(true);
      expect(result.config.harness_version).toBe('>=1.0.0');
      expect(result.config.defaults?.model).toBe('sonnet');
    });
  });

  describe('conflict_check config field', () => {
    it('defaults an absent ADR corpus to change_set', () => {
      const result = validateConfig({});

      expect(result).toMatchObject({
        ok: true,
        config: { conflict_check: { adr_corpus: 'change_set' } },
        warnings: [],
      });
    });

    it.each(['change_set', 'repo_wide'] as const)(
      'accepts adr_corpus: %s',
      (adr_corpus) => {
        const result = validateConfig({ conflict_check: { adr_corpus } });

        expect(result).toMatchObject({
          ok: true,
          config: { conflict_check: { adr_corpus } },
          warnings: [],
        });
      },
    );

    it('rejects an unrecognized ADR corpus', () => {
      expect(validateConfig({ conflict_check: { adr_corpus: 'all_adrs' } })).toEqual({
        ok: false,
        error: {
          type: 'validation_error',
          message: 'conflict_check.adr_corpus must be change_set|repo_wide',
        },
      });
    });
  });

  describe('build_review config field', () => {
    it('materializes the closed five-rubric configuration with default and per-rubric execution policy fields', () => {
      const defaults = validateConfig({ build_review: {} });
      const configured = validateConfig({
        build_review: {
          maxParallel: 3,
          rubrics: {
            tautology: {
              enabled: false,
              llm_provider: ['codex', 'claude'],
              model: 'gpt-5.6-sol',
              effort: 'high',
              model_fallback_ladder: ['gpt-5.6-terra'],
              max_retries: 2,
              escalate: true,
            },
          },
        },
      });

      expect({
        defaults: defaults.ok ? defaults.config.build_review : defaults,
        configured: configured.ok ? configured.config.build_review : configured,
      }).toEqual({
        defaults: {
          enabled: true,
          maxParallel: 5,
          rubrics: {
            tautology: { enabled: true },
            scope: { enabled: true },
            rootCause: { enabled: true },
            completeness: { enabled: true },
            wiring: { enabled: true },
          },
        },
        configured: {
          enabled: true,
          maxParallel: 3,
          rubrics: {
            tautology: {
              enabled: false,
              llm_provider: ['codex', 'claude'],
              model: 'gpt-5.6-sol',
              effort: 'high',
              model_fallback_ladder: ['gpt-5.6-terra'],
              max_retries: 2,
              escalate: true,
            },
            scope: { enabled: true },
            rootCause: { enabled: true },
            completeness: { enabled: true },
            wiring: { enabled: true },
          },
        },
      });
    });

    it('keeps legacy keys tolerant while the rubric execution subtree is fail-closed', () => {
      const legacy = validateConfig({
        build_review: { enabled: 'not-a-boolean', perTaskFloor: 'not-a-boolean' },
      });
      const rubricPolicy = validateConfig({
        build_review: { rubrics: { wiring: { max_retries: 'many' } } },
      });

      expect({
        legacy: legacy.ok
          ? {
              buildReview: legacy.config.build_review,
              warnings: legacy.warnings,
            }
          : legacy,
        rubricPolicy: rubricPolicy.ok ? rubricPolicy : rubricPolicy.error.message,
      }).toEqual({
        legacy: {
          buildReview: expect.objectContaining({ enabled: true }),
          warnings: [
            expect.stringMatching(/build_review\.enabled/),
            expect.stringMatching(/build_review\.perTaskFloor/),
          ],
        },
        rubricPolicy: expect.stringMatching(/build_review\.rubrics\.wiring\.max_retries/),
      });
    });

    it('resolves absent key to enabled (default-on, #773 Task 4), no warning', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves enabled:false to an explicit opt-out (still honored)', () => {
      const result = validateConfig({ build_review: { enabled: false } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('preserves enabled:false with perTaskFloor:false without warnings', () => {
      const result = validateConfig({
        build_review: { enabled: false, perTaskFloor: false },
      });
      expect(result.ok && {
        build_review: result.config.build_review,
        warnings: result.warnings,
      }).toEqual({
        build_review: expect.objectContaining({ enabled: false, perTaskFloor: false }),
        warnings: [],
      });
    });

    it('defaults enabled after preserving a partial perTaskFloor:false block', () => {
      const result = validateConfig({ build_review: { perTaskFloor: false } });
      expect(result.ok && {
        build_review: result.config.build_review,
        warnings: result.warnings,
      }).toEqual({
        build_review: expect.objectContaining({ enabled: true, perTaskFloor: false }),
        warnings: [],
      });
    });

    it('passes perTaskFloor:false through validation to the build_review resolver', () => {
      const result = validateConfig({
        build_review: { enabled: true, perTaskFloor: false },
      });
      expect(result.ok && resolveBuildReviewConfig(result.config)).toEqual(expect.objectContaining({
        enabled: true,
        perTaskFloor: false,
        scopeContainmentEnforced: false,
        maxParallel: 5,
        rubrics: expect.objectContaining({ scope: expect.objectContaining({ enabled: true }) }),
      }));
    });

    it('preserves an explicit boolean scope-containment enforcement mode', () => {
      const result = validateConfig({
        build_review: { scopeContainmentEnforced: true },
      });

      expect(result.ok && {
        build_review: result.config.build_review,
        warnings: result.warnings,
      }).toEqual({
        build_review: expect.objectContaining({ enabled: true, scopeContainmentEnforced: true }),
        warnings: [],
      });
    });

    it('rejects a non-boolean scope-containment enforcement mode', () => {
      const result = validateConfig({
        build_review: { enabled: false, scopeContainmentEnforced: 'yes' },
      });

      expect(result.ok && {
        build_review: result.config.build_review,
        warnings: result.warnings,
      }).toEqual({
        build_review: expect.objectContaining({ enabled: false }),
        warnings: [expect.stringMatching(/build_review\.scopeContainmentEnforced/)],
      });
    });

    it('drops unknown build_review keys while preserving an explicit opt-out', () => {
      const result = validateConfig({
        build_review: { enabled: false, perTaskFlooor: true },
      });
      expect(result.ok && {
        build_review: result.config.build_review,
        warnings: result.warnings,
      }).toEqual({
        build_review: expect.objectContaining({ enabled: false }),
        warnings: [expect.stringMatching(/perTaskFlooor/)],
      });
    });

    it('names every unknown key while preserving an explicit build_review opt-out', () => {
      const result = validateConfig({
        build_review: { enabled: false, a: 1, b: 2 },
      });
      expect(result.ok && {
        build_review: result.config.build_review,
        warnings: result.warnings,
      }).toEqual({
        build_review: expect.objectContaining({ enabled: false }),
        warnings: [expect.stringMatching(/"a"/), expect.stringMatching(/"b"/)],
      });
    });

    it('resolves enabled:true to enabled, identical to the default', () => {
      const result = validateConfig({ build_review: { enabled: true } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves null to enabled silently', () => {
      const result = validateConfig({ build_review: null });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves a non-object build_review value to enabled + one warning', () => {
      const result = validateConfig({ build_review: 'yes' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/build_review.*invalid/i);
    });

    it('resolves a non-boolean enabled value to enabled + one warning', () => {
      const result = validateConfig({ build_review: { enabled: 'banana' } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.build_review?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/build_review.*invalid/i);
    });

    it('drops an invalid enabled value while retaining perTaskFloor', () => {
      const result = validateConfig({
        build_review: { enabled: 'banana', perTaskFloor: false },
      });
      expect(result.ok && {
        build_review: result.config.build_review,
        warnings: result.warnings,
      }).toEqual({
        build_review: expect.objectContaining({ enabled: true, perTaskFloor: false }),
        warnings: [expect.stringMatching(/build_review\.enabled/)],
      });
    });

    it('drops an invalid perTaskFloor value while retaining enabled', () => {
      const result = validateConfig({
        build_review: { enabled: false, perTaskFloor: 'sometimes' },
      });
      expect(result.ok && {
        build_review: result.config.build_review,
        warnings: result.warnings,
      }).toEqual({
        build_review: expect.objectContaining({ enabled: false }),
        warnings: [expect.stringMatching(/build_review\.perTaskFloor/)],
      });
    });

    it('is total across build_review shapes', () => {
      const testCases: Array<[string, Record<string, unknown>]> = [
        ['absent', {}],
        ['null', { build_review: null }],
        ['empty object', { build_review: {} }],
        ['string', { build_review: 'yes' }],
        ['number', { build_review: 1 }],
        ['array', { build_review: [] }],
        ['valid', { build_review: { enabled: false, perTaskFloor: false } }],
        ['partially valid', { build_review: { perTaskFloor: false } }],
        ['fully invalid', { build_review: { enabled: 'no', perTaskFloor: 'no' } }],
      ];
      for (const [, testCase] of testCases) {
        expect(() => validateConfig(testCase)).not.toThrow();
        const result = validateConfig(testCase);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.config.build_review).toBeDefined();
      }
    });

    it('rejects steps.build_review.disable: true — gating steps cannot be disabled', () => {
      const result = validateConfig({ steps: { build_review: { disable: true } } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/build_review/);
      expect(result.error.message).toMatch(/gating/i);
    });
  });

  describe('mergeable_autoresolve config block (Task 2)', () => {
    it('absent block → {enabled:false, cooldownMinutes:60, suiteCommand:undefined}', () => {
      const result = validateConfig({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve).toBeUndefined();
    });

    it('full block parses correctly with all fields', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          cooldownMinutes: 30,
          suiteCommand: 'npm run test',
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve).toEqual({
        enabled: true,
        cooldownMinutes: 30,
        suiteCommand: 'npm run test',
      });
    });

    it('partial block with only enabled gets appropriate defaults', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve).toEqual({
        enabled: true,
        cooldownMinutes: 60,
        suiteCommand: undefined,
      });
    });

    it('partial block with enabled and cooldownMinutes gets appropriate defaults', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: false,
          cooldownMinutes: 120,
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve).toEqual({
        enabled: false,
        cooldownMinutes: 120,
        suiteCommand: undefined,
      });
    });

    it('rejects non-boolean enabled value', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: 'yes',
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/mergeable_autoresolve.*enabled.*boolean/i);
    });

    it('rejects non-number cooldownMinutes value', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          cooldownMinutes: 'thirty',
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/mergeable_autoresolve.*cooldownMinutes.*number/i);
    });

    it('rejects negative cooldownMinutes value', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          cooldownMinutes: -5,
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/mergeable_autoresolve.*cooldownMinutes/i);
    });

    it('rejects non-string suiteCommand value', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          suiteCommand: 123,
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/mergeable_autoresolve.*suiteCommand.*string/i);
    });

    it('rejects unknown keys under mergeable_autoresolve', () => {
      const result = validateConfig({
        mergeable_autoresolve: {
          enabled: true,
          unknownKey: 'value',
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/unknownKey/);
    });

    it('accepts mergeable_autoresolve alongside other config fields', () => {
      const result = validateConfig({
        harness_version: '>=1.0.0',
        defaults: { model: 'sonnet' },
        mergeable_autoresolve: {
          enabled: true,
          cooldownMinutes: 45,
          suiteCommand: 'npm test',
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.mergeable_autoresolve?.enabled).toBe(true);
      expect(result.config.mergeable_autoresolve?.cooldownMinutes).toBe(45);
    });
  });

  describe('ci_watch config field (Task 4)', () => {
    it('resolves absent key to enabled, no warning', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.ci_watch?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves enabled:false to disabled, no warning', () => {
      const result = validateConfig({ ci_watch: { enabled: false } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.ci_watch?.enabled).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('keeps enabled:false when an invalid cooldownMinutes is omitted with a warning', () => {
      const result = validateConfig({
        ci_watch: { enabled: false, cooldownMinutes: 'thirty' },
      });
      expect(result.ok && {
        ci_watch: result.config.ci_watch,
        warnings: result.warnings,
      }).toEqual({
        ci_watch: { enabled: false },
        warnings: [expect.stringMatching(/ci_watch\.cooldownMinutes/)],
      });
    });

    it('resolves enabled:true to enabled, no warning', () => {
      const result = validateConfig({ ci_watch: { enabled: true } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.ci_watch?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('preserves enabled and cooldownMinutes with no warnings', () => {
      const result = validateConfig({ ci_watch: { enabled: true, cooldownMinutes: 15 } });
      expect(result.ok && {
        ci_watch: result.config.ci_watch,
        warnings: result.warnings,
      }).toEqual({
        ci_watch: { enabled: true, cooldownMinutes: 15 },
        warnings: [],
      });
    });

    it('defaults enabled while preserving a zero cooldownMinutes with no warnings', () => {
      const result = validateConfig({ ci_watch: { cooldownMinutes: 0 } });
      expect(result.ok && {
        ci_watch: result.config.ci_watch,
        warnings: result.warnings,
      }).toEqual({
        ci_watch: { enabled: true, cooldownMinutes: 0 },
        warnings: [],
      });
    });

    it('omits a negative cooldownMinutes and warns', () => {
      const result = validateConfig({ ci_watch: { enabled: true, cooldownMinutes: -5 } });
      expect(result.ok && {
        ci_watch: result.config.ci_watch,
        warnings: result.warnings,
      }).toEqual({
        ci_watch: { enabled: true },
        warnings: [expect.stringMatching(/ci_watch\.cooldownMinutes/)],
      });
    });

    it('defaults an invalid enabled value and warns', () => {
      const result = validateConfig({ ci_watch: { enabled: 'banana' } });
      expect(result.ok && {
        ci_watch: result.config.ci_watch,
        warnings: result.warnings,
      }).toEqual({
        ci_watch: { enabled: true },
        warnings: [expect.stringMatching(/ci_watch\.enabled/)],
      });
    });

    it('preserves an exact cooldownMinutes value for ci-fix', () => {
      const result = validateConfig({ ci_watch: { cooldownMinutes: 15 } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.ci_watch?.cooldownMinutes).toBe(15);
    });

    it('keeps cooldownMinutes when an unknown sibling is ignored', () => {
      const result = validateConfig({ ci_watch: { cooldownMinutes: 15, bogus: 1 } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.ci_watch).toEqual({ enabled: true, cooldownMinutes: 15 });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/bogus/);
    });

    it('names every unknown key while preserving an explicit ci_watch opt-out', () => {
      const result = validateConfig({
        ci_watch: { enabled: false, a: 1, b: 2 },
      });
      expect(result.ok && {
        ci_watch: result.config.ci_watch,
        warnings: result.warnings,
      }).toEqual({
        ci_watch: { enabled: false },
        warnings: [expect.stringMatching(/"a"/), expect.stringMatching(/"b"/)],
      });
    });

    it('resolves null to enabled silently', () => {
      const result = validateConfig({ ci_watch: null });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.ci_watch?.enabled).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('resolves a string value to enabled without throwing', () => {
      const result = validateConfig({ ci_watch: 'yes' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.ci_watch?.enabled).toBe(true);
    });

    it('resolves a number value to enabled without throwing', () => {
      const result = validateConfig({ ci_watch: 42 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.ci_watch?.enabled).toBe(true);
    });

    it('is total across ci_watch shapes', () => {
      const testCases: Array<[string, Record<string, unknown>]> = [
        ['absent', {}],
        ['null', { ci_watch: null }],
        ['empty object', { ci_watch: {} }],
        ['string', { ci_watch: 'yes' }],
        ['number', { ci_watch: 1 }],
        ['array', { ci_watch: [] }],
        ['valid', { ci_watch: { enabled: false, cooldownMinutes: 0 } }],
        ['partially valid', { ci_watch: { cooldownMinutes: 15 } }],
        ['fully invalid', { ci_watch: { enabled: 'no', cooldownMinutes: -1 } }],
      ];
      for (const [, testCase] of testCases) {
        expect(() => validateConfig(testCase)).not.toThrow();
        const result = validateConfig(testCase);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.config.ci_watch).toBeDefined();
      }
    });
  });

  describe('retry_routing config field (Task 3)', () => {
    it('resolves absent block to enabled: true', () => {
      const result = validateConfig({ harness_version: '>=1.0.0' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.retry_routing?.enabled).toBe(true);
    });

    it('resolves retry_routing: { enabled: false } to disabled', () => {
      const result = validateConfig({ retry_routing: { enabled: false } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.retry_routing?.enabled).toBe(false);
    });

    it('rejects a non-boolean enabled value', () => {
      const result = validateConfig({ retry_routing: { enabled: 'banana' } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
    });

    it('rejects an unknown key inside the retry_routing block', () => {
      const result = validateConfig({ retry_routing: { enabled: true, bogus: 1 } });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
    });

    it('still rejects an unknown top-level sibling key (regression)', () => {
      const result = validateConfig({ retry_routing: { enabled: true }, bogus_top_level: 1 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe('validation_error');
      expect(result.error.message).toContain('bogus_top_level');
    });
  });
});
