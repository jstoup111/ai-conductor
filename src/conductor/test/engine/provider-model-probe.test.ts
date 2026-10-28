// Covers: pi-per-step-model-selection-via-wrapped-providers:task:14,task:15, codex-steps-resolve-the-newest-catalog-model-per-t:task:5
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { bootDispatchingCliProviders } from '../../src/index.js';
import {
  ProviderModelUnknownError,
  resetProviderModelTierProbeForTest,
  resolveProviderModelTiers,
  validateConfiguredProviderModels,
  type ProviderModelProbeRunner,
} from '../../src/engine/provider-model-probe.js';
import type { InstalledProviderDiscovery } from '../../src/engine/provider-discovery.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { resetResolvedModelTiersForTest } from '../../src/engine/model-tier-resolution.js';
import { resolveProviderModelPolicy } from '../../src/engine/provider-model-policy.js';
import { resolveStepConfig } from '../../src/engine/resolved-config.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const PI_LISTING = [
  'provider    model',
  'anthropic   claude-opus-4-5',
  'openai      gpt-5',
  'google      gemini-3-pro',
].join('\n');

const configuredPiModels: HarnessConfig = {
  llm_provider: 'pi',
  steps: {
    build: {
      llm_provider: 'pi',
      model: 'anthropic/claude-opus-4-5',
      by_tier: { L: { model: 'google/gemini-3-pro' } },
    },
  },
  llm_providers: {
    pi: {
      model: 'openai/gpt-5',
      model_escalation_order: ['google/gemini-3-pro'],
      model_fallback_ladder: ['anthropic/claude-opus-4-5'],
    },
  },
};

function installedPi(): InstalledProviderDiscovery {
  return { installed: ['pi'], missing: [] };
}

function runner(result: { exitCode: number; stdout: string }): ProviderModelProbeRunner {
  return vi.fn(async () => result);
}

const CODEX_LISTING = JSON.stringify({
  models: [
    { slug: 'gpt-6.1-sol', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-6-astra', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-6-sol', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-6-luna', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-5.6-sol', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-5.6-terra', visibility: 'list', supported_in_api: true },
    { slug: 'gpt-5.6-luna', visibility: 'list', supported_in_api: true },
  ],
});

function installedCodex(): InstalledProviderDiscovery {
  return { installed: ['codex'], missing: [] };
}

function codexStepModels(): Record<string, string> {
  const policy = resolveProviderModelPolicy('codex');
  return {
    buildReview: resolveStepConfig('build_review', 'BUILD', policy).model,
    memory: resolveStepConfig('memory', 'UNDERSTAND', policy).model,
    build: resolveStepConfig('build', 'BUILD', policy).model,
  };
}

afterEach(() => {
  resetProviderModelTierProbeForTest();
  resetResolvedModelTiersForTest();
  vi.useRealTimers();
});

describe('validateConfiguredProviderModels', () => {
  it('does not list Pi models when Pi is installed but no Pi model selection is configured', async () => {
    const fake = runner({ exitCode: 0, stdout: PI_LISTING });

    await expect(validateConfiguredProviderModels({
      config: { llm_provider: 'claude' },
      discovery: installedPi(),
      runner: fake,
    })).resolves.toBeUndefined();

    expect(fake).not.toHaveBeenCalled();
  });

  it('lists configured Pi models and rejects an id absent from the listing', async () => {
    const fake = runner({ exitCode: 0, stdout: PI_LISTING });

    await expect(validateConfiguredProviderModels({
      config: {
        llm_provider: 'claude',
        steps: { plan: { llm_provider: 'pi', model: 'anthropic/missing-model' } },
        llm_providers: { pi: { model: 'anthropic/missing-model' } },
      },
      discovery: installedPi(),
      runner: fake,
    })).rejects.toMatchObject({
      name: 'ProviderModelUnknownError',
      kind: 'unknown-model',
      modelId: 'anthropic/missing-model',
      configPath: 'steps.plan.model',
      step: 'plan',
    } satisfies Partial<ProviderModelUnknownError>);

    expect(fake).toHaveBeenCalledOnce();
    expect(fake).toHaveBeenCalledWith('pi', ['--list-models']);
  });

  it('fails installation before probing when configured Pi is missing', async () => {
    const fake = runner({ exitCode: 0, stdout: PI_LISTING });

    await expect(bootDispatchingCliProviders({
      command: 'inline',
      registry: new PluginRegistry(),
      events: new ConductorEventEmitter(),
      config: configuredPiModels,
      rendererOpts: {
        stateFilePath: '/tmp/provider-model-probe-missing-state.json',
        steps: [],
        readStateFn: async () => ({ ok: true, value: {} }),
        projectRoot: '/tmp',
      },
      providerDiscoveryRunner: async () => ({ exitCode: 127 }),
      providerModelProbeRunner: fake,
    })).rejects.toThrow(/pi.*not installed/i);

    expect(fake).not.toHaveBeenCalled();
  });

  it('fails installation before probing when only a build-review rubric selects missing Pi', async () => {
    const fake = runner({ exitCode: 0, stdout: PI_LISTING });

    await expect(bootDispatchingCliProviders({
      command: 'inline',
      registry: new PluginRegistry(),
      events: new ConductorEventEmitter(),
      config: {
        llm_provider: 'claude',
        build_review: { rubrics: { testQuality: { llm_provider: 'pi' } } },
      },
      rendererOpts: {
        stateFilePath: '/tmp/provider-model-probe-rubric-missing-state.json',
        steps: [],
        readStateFn: async () => ({ ok: true, value: {} }),
        projectRoot: '/tmp',
      },
      discover: async () => ({
        installed: ['claude'],
        missing: [{ id: 'pi', reason: 'not-found' }],
      }),
      providerModelProbeRunner: fake,
    })).rejects.toThrow(/build_review\.rubrics\.testQuality\.llm_provider.*pi.*not installed/i);

    expect(fake).not.toHaveBeenCalled();
  });

  it('accepts every configured Pi id from steps, tier overrides, default, escalation, and fallback listing with one injected invocation', async () => {
    const fake = runner({ exitCode: 0, stdout: PI_LISTING });

    await expect(validateConfiguredProviderModels({
      config: configuredPiModels,
      discovery: installedPi(),
      runner: fake,
      timeoutMs: 20,
    })).resolves.toBeUndefined();

    expect(fake).toHaveBeenCalledOnce();
    expect(fake).toHaveBeenCalledWith('pi', ['--list-models']);
  });

  it('rejects an id whose Pi provider segment is absent, naming the id, path, and step', async () => {
    await expect(validateConfiguredProviderModels({
      config: {
        ...configuredPiModels,
        steps: { build: { llm_provider: 'pi', model: 'missing/model' } },
      },
      discovery: installedPi(),
      runner: runner({ exitCode: 0, stdout: PI_LISTING }),
      timeoutMs: 20,
    })).rejects.toMatchObject({
      name: 'ProviderModelUnknownError',
      kind: 'unknown-provider',
      modelId: 'missing/model',
      configPath: 'steps.build.model',
      step: 'build',
    } satisfies Partial<ProviderModelUnknownError>);
  });

  it('rejects an unknown provider on a step inheriting run-level pi', async () => {
    await expect(validateConfiguredProviderModels({
      config: { ...configuredPiModels, steps: { plan: { model: 'missing/model' } } },
      discovery: installedPi(),
      runner: runner({ exitCode: 0, stdout: PI_LISTING }),
      timeoutMs: 20,
    })).rejects.toMatchObject({
      kind: 'unknown-provider', modelId: 'missing/model', configPath: 'steps.plan.model', step: 'plan',
    } satisfies Partial<ProviderModelUnknownError>);
  });

  it('does not probe a Claude alias against pi when pi is only a fallback candidate', async () => {
    await expect(validateConfiguredProviderModels({
      config: {
        llm_provider: 'claude',
        llm_providers: configuredPiModels.llm_providers,
        steps: { build: { llm_provider: ['claude', 'pi'], model: 'sonnet' } },
      },
      discovery: installedPi(),
      runner: runner({ exitCode: 0, stdout: PI_LISTING }),
      timeoutMs: 20,
    })).resolves.toBeUndefined();
  });

  it('rejects an unlisted Pi model with wording distinct from an unknown provider', async () => {
    await expect(validateConfiguredProviderModels({
      config: {
        ...configuredPiModels,
        steps: { build: { llm_provider: 'pi', model: 'anthropic/missing-model' } },
      },
      discovery: installedPi(),
      runner: runner({ exitCode: 0, stdout: PI_LISTING }),
      timeoutMs: 20,
    })).rejects.toThrow(/unknown Pi model.*anthropic\/missing-model.*steps\.build\.model.*build/i);
  });

  it('fails dispatching CLI boot for an unlisted Pi by-tier model, naming its path and step', async () => {
    const modelProbeRunner = runner({ exitCode: 0, stdout: PI_LISTING });

    await expect(bootDispatchingCliProviders({
      command: 'inline',
      registry: new PluginRegistry(),
      events: new ConductorEventEmitter(),
      config: {
        ...configuredPiModels,
        steps: {
          build: {
            llm_provider: 'pi',
            by_tier: { L: { model: 'anthropic/missing-model' } },
          },
        },
      },
      rendererOpts: {
        stateFilePath: '/tmp/provider-model-probe-state.json',
        steps: [],
        readStateFn: async () => ({ ok: true, value: {} }),
        projectRoot: '/tmp',
      },
      providerDiscoveryRunner: async () => ({ exitCode: 0 }),
      providerModelProbeRunner: modelProbeRunner,
    })).rejects.toThrow(
      /unknown Pi model.*anthropic\/missing-model.*steps\.build\.by_tier\.L\.model.*build/i,
    );
    expect(modelProbeRunner).toHaveBeenCalledOnce();
    expect(execa).not.toHaveBeenCalled();
  });

  it('fails when the injected listing runner exceeds its timeout', async () => {
    await expect(validateConfiguredProviderModels({
      config: configuredPiModels,
      discovery: installedPi(),
      runner: async () => new Promise(() => {}),
      timeoutMs: 1,
    })).rejects.toThrow(/Pi model listing timed out/i);
  });

  it('fails a non-zero listing exit without accepting configured ids', async () => {
    await expect(validateConfiguredProviderModels({
      config: configuredPiModels,
      discovery: installedPi(),
      runner: runner({ exitCode: 1, stdout: 'pi failed' }),
      timeoutMs: 20,
    })).rejects.toThrow(/Pi model listing.*unparseable.*pi failed/i);
  });

  it('fails an unparseable listing by quoting its first line', async () => {
    await expect(validateConfiguredProviderModels({
      config: configuredPiModels,
      discovery: installedPi(),
      runner: runner({ exitCode: 0, stdout: 'Pi cannot list models' }),
      timeoutMs: 20,
    })).rejects.toThrow(/Pi model listing.*unparseable.*Pi cannot list models/i);
  });
});

describe('resolveProviderModelTiers', () => {
  it('probes Codex once per process and installs the newest same-tier models', async () => {
    const fake = runner({ exitCode: 0, stdout: CODEX_LISTING });

    await resolveProviderModelTiers({ discovery: installedCodex(), runner: fake, projectRoot: '/tmp' });
    await resolveProviderModelTiers({ discovery: installedCodex(), runner: fake, projectRoot: '/tmp' });

    expect(fake).toHaveBeenCalledOnce();
    expect(fake).toHaveBeenCalledWith('codex', ['debug', 'models']);
    expect(codexStepModels()).toEqual({
      buildReview: 'gpt-6.1-sol',
      memory: 'gpt-6-luna',
      build: 'gpt-5.6-terra',
    });
  });

  it('ignores hidden and non-API Codex catalog models', async () => {
    const fake = runner({
      exitCode: 0,
      stdout: JSON.stringify({
        models: [
          ...JSON.parse(CODEX_LISTING).models,
          { slug: 'gpt-7-sol', visibility: 'hide', supported_in_api: true },
          { slug: 'gpt-7.1-sol', visibility: 'list', supported_in_api: false },
        ],
      }),
    });

    await resolveProviderModelTiers({ discovery: installedCodex(), runner: fake, projectRoot: '/tmp' });

    expect(codexStepModels().buildReview).toBe('gpt-6.1-sol');
  });

  it('keeps floor ids and warns once when the tier catalog times out', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const resolution = resolveProviderModelTiers({
      discovery: installedCodex(),
      runner: async () => new Promise(() => {}),
      timeoutMs: 5_000,
      warn,
      projectRoot: '/tmp',
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(resolution).resolves.toBeUndefined();

    expect(codexStepModels().buildReview).toBe('gpt-5.6-sol');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Codex tier catalog unavailable (timeout); using floor model ids.');
  });

  it.each([
    ['non-zero exit', { exitCode: 2, stdout: 'catalog unavailable' }, 'exit code 2'],
    ['non-JSON stdout', { exitCode: 0, stdout: 'not json' }, 'unparseable: "not json"'],
    ['JSON without models', { exitCode: 0, stdout: '{}' }, 'unparseable: "{}"'],
  ])('keeps floor ids and warns once for %s', async (_caseName, result, reason) => {
    const warn = vi.fn();

    await expect(resolveProviderModelTiers({
      discovery: installedCodex(),
      runner: runner(result),
      warn,
      projectRoot: '/tmp',
    })).resolves.toBeUndefined();

    expect(codexStepModels()).toEqual({
      buildReview: 'gpt-5.6-sol',
      memory: 'gpt-5.6-luna',
      build: 'gpt-5.6-terra',
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `Codex tier catalog unavailable (${reason}); using floor model ids.`,
    );
  });

  it('does not probe or warn when Codex is not installed', async () => {
    const fake = runner({ exitCode: 0, stdout: CODEX_LISTING });
    const warn = vi.fn();

    await resolveProviderModelTiers({
      discovery: { installed: ['claude'], missing: [{ id: 'codex', reason: 'not-found' }] },
      runner: fake,
      warn,
      projectRoot: '/tmp',
    });

    expect(fake).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
