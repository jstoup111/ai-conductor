// Covers: task:10, task:19
import { describe, expect, it, vi } from 'vitest';
import type { InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { PiProvider } from '../../src/execution/pi-provider.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';
import { resolveProviderModelPolicy } from '../../src/engine/provider-model-policy.js';
import {
  createProviderRuntimeSet,
  ProviderRuntimeSet,
  type ProviderRuntime,
} from '../../src/engine/provider-runtime.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
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

function runtimeSet(
  config: HarnessConfig,
  providers: Readonly<Record<string, LLMProvider>>,
): ProviderRuntimeSet {
  const registry = new PluginRegistry();
  for (const [key, provider] of Object.entries(providers)) {
    registry.register('llm_provider', key, provider);
  }
  registry.markInitialized();
  return createProviderRuntimeSet(registry, undefined, config);
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

describe('Pi lifecycle abort', () => {
  it('passes the executor abort signal to Pi, kills its subprocess, and does not advance fallback', async () => {
    const controller = new AbortController();
    let resolveSubprocess!: (result: { stdout: string; stderr: string; exitCode: number }) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const subprocess = Object.assign(
      new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
        resolveSubprocess = resolve;
      }),
      {
        kill: vi.fn(() => resolveSubprocess({ stdout: '', stderr: '', exitCode: 1 })),
      },
    );
    const spawnPi = vi.fn(() => {
      signalStarted();
      return subprocess;
    });
    const pi = new PiProvider('pi', spawnPi as never);
    const piInvoke = vi.spyOn(pi, 'invoke');
    const claude = fakeProvider({ success: true, output: 'Claude must not run', exitCode: 0 });

    const execution = executeProviderCandidates({
      step: 'build',
      configuredProviders: ['pi', 'claude'],
      preferredProvider: 'pi',
      runtimes: new ProviderRuntimeSet([runtime('pi', pi), runtime('claude', claude)]),
      sessions: new ProviderSessionScope(vi.fn()),
      abortSignal: controller.signal,
      options: { prompt: 'Build.', cwd: '/workspace' },
    });

    await started;
    controller.abort();
    const result = await execution;

    expect(piInvoke.mock.calls[0]?.[0]?.abortSignal).toBe(controller.signal);
    expect(subprocess.kill).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: false,
      output: 'Pi invocation aborted.',
      actualProvider: 'pi',
    });
    expect(result).not.toHaveProperty('providerUnavailable');
    expect(result).not.toHaveProperty('modelUnavailable');
    expect(result).not.toHaveProperty('authFailure');
    expect(result).not.toHaveProperty('rateLimited');
    expect(claude.invoke).not.toHaveBeenCalled();
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

describe('DefaultStepRunner Pi model policy dispatch', () => {
  it('uses Pi’s configured fallback model and reports the configured, actual, and unavailable models', async () => {
    const configuredModel = 'anthropic/claude-opus-4-5';
    const actualModel = 'openai/gpt-5.6-sol';
    const pi: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async ({ model }) => model === configuredModel
        ? { success: false, output: `${configuredModel} is unavailable`, exitCode: 1, modelUnavailable: true }
        : { success: true, output: 'Pi fallback completed', exitCode: 0 }),
    };
    const warnings: string[] = [];
    const config: HarnessConfig = {
      llm_provider: 'claude',
      model_fallback_ladder: ['opus', 'sonnet'],
      llm_providers: {
        pi: {
          model: configuredModel,
          model_escalation_order: [configuredModel],
          model_fallback_ladder: [configuredModel, actualModel],
        },
      },
      steps: { build: { llm_provider: 'pi' } },
    };
    const runner = new DefaultStepRunner(pi, 'pi-model-fallback', '/workspace', {
      config,
      providerKey: 'pi',
      modelPolicy: resolveProviderModelPolicy('pi', { config }),
      log: (message) => warnings.push(message),
    });

    const result = await runner.run('build', { complexity_tier: 'S' });

    expect(result.success).toBe(true);
    expect(pi.invoke).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: configuredModel }));
    expect(pi.invoke).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: actualModel }));
    expect(warnings).toEqual([
      `Downgraded from ${configuredModel} to ${actualModel}: ${configuredModel} is not available (unavailable)`,
    ]);
  });
});

describe('effective provider policy dispatch', () => {
  it('uses each Pi step’s configured model in one mixed-provider runtime set', async () => {
    const pi = fakeProvider({ success: true, output: 'Pi completed', exitCode: 0 });
    const config: HarnessConfig = {
      llm_provider: 'claude',
      llm_providers: {
        pi: {
          model: 'openai/gpt-5.6-sol',
          model_escalation_order: ['openai/gpt-5.6-sol'],
          model_fallback_ladder: ['openai/gpt-5.6-sol'],
        },
      },
      steps: {
        explore: { llm_provider: 'pi', model: 'google/gemini-2.5-flash' },
        plan: { llm_provider: 'pi', model: 'anthropic/claude-opus-4-5' },
      },
    };
    const runtimes = runtimeSet(config, { pi });

    await executeProviderCandidates({
      step: 'explore', configuredProviders: ['claude'], preferredProvider: 'pi', runtimes,
      sessions: new ProviderSessionScope(vi.fn()), config, options: { prompt: 'Explore.', cwd: '/workspace' },
    });
    await executeProviderCandidates({
      step: 'plan', configuredProviders: ['claude'], preferredProvider: 'pi', runtimes,
      sessions: new ProviderSessionScope(vi.fn()), config, options: { prompt: 'Plan.', cwd: '/workspace' },
    });

    expect(pi.invoke).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: 'google/gemini-2.5-flash' }));
    expect(pi.invoke).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'anthropic/claude-opus-4-5' }));
  });

  it('applies Pi tier overrides without leaking them into other tiers', async () => {
    const pi = fakeProvider({ success: true, output: 'Pi completed', exitCode: 0 });
    const config: HarnessConfig = {
      llm_providers: {
        pi: {
          model: 'anthropic/claude-sonnet-4-5',
          model_escalation_order: ['anthropic/claude-sonnet-4-5'],
          model_fallback_ladder: ['anthropic/claude-sonnet-4-5'],
        },
      },
      steps: {
        plan: {
          llm_provider: 'pi', model: 'anthropic/claude-sonnet-4-5', effort: 'medium',
          by_tier: { L: { model: 'anthropic/claude-opus-4-5', effort: 'xhigh' } },
        },
      },
    };
    const runtimes = runtimeSet(config, { pi });

    await executeProviderCandidates({ step: 'plan', configuredProviders: ['claude'], preferredProvider: 'pi', runtimes, sessions: new ProviderSessionScope(vi.fn()), config, tier: 'L', options: { prompt: 'Plan L.', cwd: '/workspace' } });
    await executeProviderCandidates({ step: 'plan', configuredProviders: ['claude'], preferredProvider: 'pi', runtimes, sessions: new ProviderSessionScope(vi.fn()), config, tier: 'M', options: { prompt: 'Plan M.', cwd: '/workspace' } });

    expect(pi.invoke).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: 'anthropic/claude-opus-4-5', effort: 'xhigh' }));
    expect(pi.invoke).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'anthropic/claude-sonnet-4-5', effort: 'medium' }));
  });

  it('keeps Claude defaults out of an explicitly Pi-routed step', async () => {
    const pi = fakeProvider({ success: true, output: 'Pi completed', exitCode: 0 });
    const claude = fakeProvider({ success: true, output: 'Claude completed', exitCode: 0 });
    const config: HarnessConfig = {
      llm_provider: 'claude', defaults: { model: 'opus' },
      llm_providers: { pi: { model: 'openai/gpt-5.6-sol', model_escalation_order: ['openai/gpt-5.6-sol'], model_fallback_ladder: ['openai/gpt-5.6-sol'] } },
      steps: { plan: { llm_provider: 'pi' } },
    };
    const runtimes = runtimeSet(config, { claude, pi });

    await executeProviderCandidates({ step: 'plan', configuredProviders: ['claude'], preferredProvider: 'pi', runtimes, sessions: new ProviderSessionScope(vi.fn()), config, options: { prompt: 'Plan.', cwd: '/workspace' } });
    await executeProviderCandidates({ step: 'build', configuredProviders: ['claude'], runtimes, sessions: new ProviderSessionScope(vi.fn()), config, options: { prompt: 'Build.', cwd: '/workspace' } });

    expect(pi.invoke).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5.6-sol' }));
    expect(pi.invoke).not.toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
    expect(claude.invoke).toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
  });

  it('uses the Pi effective policy after a run-scope Claude fallback', async () => {
    const piModel = 'openai/gpt-5.6-sol';
    const claude = fakeProvider({
      success: false, output: 'Claude unavailable', exitCode: 127,
      providerUnavailable: true, providerUnavailableScope: 'run', providerUnavailableReason: 'Claude unavailable',
    });
    const pi = fakeProvider({ success: true, output: 'Pi completed', exitCode: 0 });
    const config: HarnessConfig = {
      llm_provider: 'claude',
      llm_providers: { pi: { model: piModel, model_escalation_order: [piModel], model_fallback_ladder: [piModel] } },
      steps: { plan: { llm_provider: ['claude', 'pi'], model: 'opus', effort: 'max' } },
    };
    const result = await executeProviderCandidates({
      step: 'plan', configuredProviders: ['claude'], preferredProvider: ['claude', 'pi'],
      runtimes: runtimeSet(config, { claude, pi }), sessions: new ProviderSessionScope(vi.fn()), config,
      options: { prompt: 'Plan.', cwd: '/workspace' },
    });

    expect(result).toMatchObject({ success: true, actualProvider: 'pi' });
    expect(pi.invoke).toHaveBeenCalledWith(expect.objectContaining({ model: piModel, effort: 'max' }));
    expect(pi.invoke).not.toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
  });
});

describe('Pi provider event metadata', () => {
  const model = 'anthropic/claude-opus-4-5';
  const config: HarnessConfig = {
    llm_providers: {
      pi: {
        model,
        model_escalation_order: [model],
        model_fallback_ladder: [model],
      },
    },
    steps: { plan: { llm_provider: 'pi', effort: 'xhigh' } },
  };

  it('keeps the full Pi model id in successful attempt and completion metadata', async () => {
    const pi = fakeProvider({ success: true, output: 'Pi completed', exitCode: 0 });
    const attempts: unknown[] = [];

    const result = await executeProviderCandidates({
      step: 'plan', configuredProviders: ['pi'], preferredProvider: 'pi',
      runtimes: runtimeSet(config, { pi }), sessions: new ProviderSessionScope(vi.fn()), config,
      onAttempt: async (_step, attempt) => { attempts.push(attempt); },
      options: { prompt: 'Plan.', cwd: '/workspace' },
    });

    expect(attempts).toEqual([
      expect.objectContaining({ provider: 'pi', model, effort: 'xhigh', outcome: 'success' }),
    ]);
    expect(result).toMatchObject({
      success: true, actualProvider: 'pi', resolvedModel: model, resolvedEffort: 'xhigh',
    });
  });

  it('keeps the full Pi model id in failed attempt and retry metadata', async () => {
    const pi = fakeProvider({
      success: false, output: `${model} unavailable`, exitCode: 1, modelUnavailable: true,
    });
    const attempts: unknown[] = [];

    const result = await executeProviderCandidates({
      step: 'plan', configuredProviders: ['pi'], preferredProvider: 'pi',
      runtimes: runtimeSet(config, { pi }), sessions: new ProviderSessionScope(vi.fn()), config,
      attempt: 2,
      onAttempt: async (_step, attempt) => { attempts.push(attempt); },
      options: { prompt: 'Plan retry.', cwd: '/workspace' },
    });

    expect(attempts).toEqual([
      expect.objectContaining({ provider: 'pi', model, effort: 'max', outcome: 'unavailable' }),
    ]);
    expect(result).toMatchObject({
      success: false,
    });
    expect(result.actualProvider).toBeUndefined();
    expect(result.resolvedModel).toBeUndefined();
    expect(result.resolvedEffort).toBeUndefined();
    expect(result.attempts[0]?.model).toBe(model);
  });
});

describe('configured ladder in normal provider-aware dispatch', () => {
  const first = 'anthropic/claude-opus-4-5';
  const second = 'openai/gpt-5.6-sol';
  const piConfig: HarnessConfig = {
    llm_provider: 'claude',
    model_fallback_ladder: ['opus', 'sonnet'],
    llm_providers: {
      pi: { model: first, model_escalation_order: [first, second], model_fallback_ladder: [first, second] },
    },
    steps: { plan: { llm_provider: 'pi' } },
  };

  it('walks the configured Pi ladder and never a top-level Claude alias', async () => {
    const pi: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async ({ model }) => model === first
        ? { success: false, output: `${first} unavailable`, exitCode: 1, modelUnavailable: true }
        : { success: true, output: 'Pi completed', exitCode: 0 }),
    };

    const result = await executeProviderCandidates({
      step: 'plan', configuredProviders: ['claude'], preferredProvider: 'pi',
      runtimes: runtimeSet(piConfig, { pi }), sessions: new ProviderSessionScope(vi.fn()), config: piConfig,
      options: { prompt: 'Plan.', cwd: '/workspace' },
    });

    expect(result).toMatchObject({ success: true, actualProvider: 'pi', resolvedModel: second });
    expect(vi.mocked(pi.invoke).mock.calls.map(([options]) => options.model)).toEqual([first, second]);
  });

  it('shares Pi dead-rung state between provider-aware dispatches', async () => {
    const pi: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async ({ model }) => model === first
        ? { success: false, output: `${first} unavailable`, exitCode: 1, modelUnavailable: true }
        : { success: true, output: 'Pi completed', exitCode: 0 }),
    };
    const runtimes = runtimeSet(piConfig, { pi });
    const input = {
      step: 'plan' as const, configuredProviders: ['pi'], preferredProvider: 'pi', runtimes,
      sessions: new ProviderSessionScope(vi.fn()), config: piConfig,
      options: { prompt: 'Plan.', cwd: '/workspace' },
    };

    await executeProviderCandidates(input);
    await executeProviderCandidates(input);

    expect(vi.mocked(pi.invoke).mock.calls.map(([options]) => options.model)).toEqual([first, second, second]);
  });

  it('returns the last Pi rung failure from one dispatch when every rung is unavailable', async () => {
    const pi: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async ({ model }) => ({
        success: false, output: `${model} unavailable`, exitCode: 1, modelUnavailable: true,
      })),
    };
    const attempts: Array<{ model?: string }> = [];

    const result = await executeProviderCandidates({
      step: 'plan', configuredProviders: ['pi'], preferredProvider: 'pi',
      runtimes: runtimeSet(piConfig, { pi }), sessions: new ProviderSessionScope(vi.fn()), config: piConfig,
      attempt: 1,
      onAttempt: async (_step, attempt) => { attempts.push(attempt); },
      options: { prompt: 'Plan.', cwd: '/workspace' },
    });

    expect(vi.mocked(pi.invoke).mock.calls.map(([options]) => options.model)).toEqual([first, second]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(`${second} unavailable`);
    expect(attempts).toHaveLength(1);
    expect(vi.mocked(pi.invoke).mock.calls.some(([options]) => options.model === 'opus' || options.model === 'sonnet')).toBe(false);
  });

  it('walks the top-level ladder for a codex step as before', async () => {
    const config: HarnessConfig = {
      llm_provider: 'claude',
      model_fallback_ladder: ['gpt-a', 'gpt-b'],
      steps: { build: { llm_provider: 'codex', model: 'gpt-a' } },
    };
    const codex: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async ({ model }) => model === 'gpt-a'
        ? { success: false, output: 'gpt-a unavailable', exitCode: 1, modelUnavailable: true }
        : { success: true, output: 'Codex completed', exitCode: 0 }),
    };

    const result = await executeProviderCandidates({
      step: 'build', configuredProviders: ['claude'], preferredProvider: 'codex',
      runtimes: runtimeSet(config, { codex }), sessions: new ProviderSessionScope(vi.fn()), config,
      options: { prompt: 'Build.', cwd: '/workspace' },
    });

    expect(result).toMatchObject({ success: true, actualProvider: 'codex' });
    expect(vi.mocked(codex.invoke).mock.calls.map(([options]) => options.model)).toEqual(['gpt-a', 'gpt-b']);
  });
});

describe('preferred Pi escalation and fallback isolation', () => {
  it('escalates a preferred Pi candidate at attempt three, while an unordered model escalates effort only', async () => {
    const small = 'openai/gpt-5.6-luna';
    const mid = 'openai/gpt-5.6-terra';
    const large = 'anthropic/claude-opus-4-5';
    const pi = fakeProvider({ success: true, output: 'Pi completed', exitCode: 0 });
    const config: HarnessConfig = {
      llm_provider: 'claude',
      llm_providers: { pi: { model: small, model_escalation_order: [small, mid, large], model_fallback_ladder: [small, mid, large] } },
      steps: {
        plan: { llm_provider: 'pi' },
        build: { llm_provider: 'pi', model: 'google/gemini-3-pro', effort: 'medium' },
      },
    };
    const runtimes = runtimeSet(config, { pi });

    await executeProviderCandidates({ step: 'plan', configuredProviders: ['claude'], preferredProvider: 'pi', runtimes, sessions: new ProviderSessionScope(vi.fn()), config, attempt: 3, escalate: true, options: { prompt: 'Plan.', cwd: '/workspace' } });
    await executeProviderCandidates({ step: 'build', configuredProviders: ['claude'], preferredProvider: 'pi', runtimes, sessions: new ProviderSessionScope(vi.fn()), config, attempt: 3, escalate: true, options: { prompt: 'Build.', cwd: '/workspace' } });

    expect(pi.invoke).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: mid, effort: 'xhigh' }));
    expect(pi.invoke).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'google/gemini-3-pro', effort: 'high' }));
  });

  it('uses the fallback Pi ladder rather than an auxiliary Claude ladder', async () => {
    const firstPi = 'anthropic/claude-opus-4-5';
    const secondPi = 'openai/gpt-5.6-sol';
    const claude = fakeProvider({
      success: false, output: 'Claude unavailable', exitCode: 127,
      providerUnavailable: true, providerUnavailableScope: 'run', providerUnavailableReason: 'Claude unavailable',
    });
    const pi: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async ({ model }) => model === firstPi
        ? { success: false, output: `${firstPi} unavailable`, exitCode: 1, modelUnavailable: true }
        : { success: true, output: 'Pi completed', exitCode: 0 }),
    };
    const config: HarnessConfig = {
      llm_provider: 'claude',
      llm_providers: { pi: { model: firstPi, model_escalation_order: [firstPi, secondPi], model_fallback_ladder: [firstPi, secondPi] } },
    };

    const result = await executeProviderCandidates({
      step: 'coverage_binding', configuredProviders: ['claude'], preferredProvider: ['claude', 'pi'],
      runtimes: runtimeSet(config, { claude, pi }), sessions: new ProviderSessionScope(vi.fn()), config,
      modelFallbackLadder: ['opus', 'sonnet'], options: { prompt: 'Judge.', cwd: '/workspace' },
    });

    expect(result).toMatchObject({ success: true, actualProvider: 'pi' });
    expect(vi.mocked(pi.invoke).mock.calls.map(([options]) => options.model)).toEqual([firstPi, secondPi]);
  });
});
