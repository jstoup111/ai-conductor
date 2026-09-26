// Covers: task:19
import { describe, expect, it, vi } from 'vitest';
import type { InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { resolveProviderModelPolicy } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet, type ProviderRuntime } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope, ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import type { HarnessConfig } from '../../src/types/config.js';

function runtime(key: string, provider: LLMProvider): ProviderRuntime {
  const policy = resolveProviderModelPolicy(key);
  return {
    key,
    provider,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

function fakeProvider(result: InvokeResult): LLMProvider {
  return {
    supportsSessionResume: false,
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke: vi.fn(async () => result),
  };
}

describe.each(['pi', 'codex'] as const)('provider fallback from %s', (firstProvider) => {
  it('advances after run-scope unavailability and completes on Claude', async () => {
    const unavailableReason = `${firstProvider} executable is unavailable`;
    const first = fakeProvider({
      success: false,
      output: unavailableReason,
      exitCode: 127,
      providerUnavailable: true,
      providerUnavailableScope: 'run',
      providerUnavailableReason: unavailableReason,
    });
    const claude = fakeProvider({ success: true, output: 'Claude completed', exitCode: 0 });

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: [firstProvider, 'claude'],
      preferredProvider: firstProvider,
      runtimes: new ProviderRuntimeSet([
        runtime(firstProvider, first),
        runtime('claude', claude),
      ]),
      sessions: new ProviderSessionScope(vi.fn()),
      options: { prompt: 'Build.', cwd: '/workspace' },
    });

    expect(result).toMatchObject({
      success: true,
      actualProvider: 'claude',
      attempts: [
        { provider: firstProvider, outcome: 'unavailable', invoked: true, fallbackReason: unavailableReason },
        { provider: 'claude', outcome: 'success', invoked: true },
      ],
    });
    expect(first.invoke).toHaveBeenCalledOnce();
    expect(claude.invoke).toHaveBeenCalledOnce();
  });
});

describe.each([
  {
    name: 'run-level Pi selection',
    config: { llm_provider: 'pi' },
    configuredProviders: ['pi'],
  },
  {
    name: 'per-step Pi selection',
    config: { llm_provider: 'claude', steps: { build: { llm_provider: 'pi' } } },
    configuredProviders: ['claude'],
  },
] satisfies Array<{
  name: string;
  config: HarnessConfig;
  configuredProviders: string[];
}>)('DefaultStepRunner with $name', ({ config, configuredProviders }) => {
  it('dispatches the fake Pi provider and reaches a normal build verdict', async () => {
    const pi = fakeProvider({ success: true, output: 'Pi completed', exitCode: 0 });
    const claude = fakeProvider({ success: true, output: 'Claude must not run', exitCode: 0 });
    const runner = new DefaultStepRunner(pi, 'pi-provider-selection', '/workspace', {
      config,
      providerExecution: {
        configuredProviders,
        runtimes: new ProviderRuntimeSet([runtime('pi', pi), runtime('claude', claude)]),
        sessions: new ProviderSessionStore(),
      },
    });

    const result = await runner.run('build', { complexity_tier: 'S' });

    expect(result.success).toBe(true);
    expect(pi.invoke).toHaveBeenCalledOnce();
    expect(claude.invoke).not.toHaveBeenCalled();
  });
});
