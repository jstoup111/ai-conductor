// Covers: pi-per-step-model-selection-via-wrapped-providers:task:14,task:15
import { describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { bootDispatchingCliProviders } from '../../src/index.js';
import {
  ProviderModelUnknownError,
  validateConfiguredProviderModels,
  type ProviderModelProbeRunner,
} from '../../src/engine/provider-model-probe.js';
import type { InstalledProviderDiscovery } from '../../src/engine/provider-discovery.js';
import type { HarnessConfig } from '../../src/types/config.js';

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
