import { dispatchGitGuard } from '../fixtures/dispatch-git-guard.js';

// Covers: task:2, task:3, task:4, task:5, task:6, task:7
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  SelfHostAuthContext,
  SpawnPermit,
  SpawnPermitPurpose,
} from '../../src/execution/llm-provider.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../../src/engine/provider-model-policy.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import type { AuthenticationReadiness } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderRuntimeSet as RuntimeSet, createProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { validateSpawnPermit } from '../../src/execution/spawn-permit.js';
import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { PiProvider, type PiEnvironment } from '../../src/execution/pi-provider.js';

interface ClassifiedInvokeResult extends InvokeResult {
  timedOut?: boolean;
  rejected?: boolean;
}

interface ProviderRuntime {
  key: string;
  provider: LLMProvider;
  lifecycleCapability?: { synchronousSpawnPermit: true };
  policy: ProviderModelPolicy;
  builtIn: boolean;
  availability: ModelAvailability;
  runWideUnavailable?: { reason: string };
}

interface ProviderRuntimeSet {
  keys(): string[];
  get(key: string): ProviderRuntime;
  lifecycleCapabilityFor?(
    key: string,
  ): { synchronousSpawnPermit: true } | undefined;
  readinessFor(
    key: string,
    authentication: AuthenticationReadiness,
  ): (() => Promise<AuthenticationReadiness>) | undefined;
}

type CreateProviderRuntimeSet = (
  registry: PluginRegistry,
) => ProviderRuntimeSet;

type InvokeRuntime = (
  runtime: ProviderRuntime,
  options: InvokeOptions,
) => Promise<ClassifiedInvokeResult>;

async function loadRuntimeSetFactory(): Promise<
  CreateProviderRuntimeSet | undefined
> {
  const module = await import('../../src/engine/provider-runtime.js').catch(
    () => null,
  );
  return (
    module as
      | { createProviderRuntimeSet?: CreateProviderRuntimeSet }
      | null
  )?.createProviderRuntimeSet;
}

async function loadRuntimeInvoker(): Promise<InvokeRuntime | undefined> {
  const module = await import('../../src/engine/provider-execution.js').catch(
    () => null,
  );
  return (
    module as { invokeRuntime?: InvokeRuntime } | null
  )?.invokeRuntime;
}

function provider(): LLMProvider {
  return {
    invoke: vi.fn(async () => ({
      success: true,
      output: 'ok',
      exitCode: 0,
    })),
  };
}

async function settled<T>(operation: () => Promise<T>): Promise<{ value: T } | { error: string }> {
  try {
    return { value: await operation() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function expectTransparentMethod<T extends object, A extends readonly unknown[], R>(
  target: T,
  guarded: T,
  method: keyof T,
  ...args: A
): Promise<void> {
  const targetMethod = target[method] as unknown as (...received: A) => Promise<R>;
  const guardedMethod = guarded[method] as unknown as (...received: A) => Promise<R>;
  await expect(settled(() => Reflect.apply(targetMethod, target, args))).resolves.toEqual(
    await settled(() => Reflect.apply(guardedMethod, guarded, args)),
  );
  await expect(settled(() => Reflect.apply(targetMethod, target, args))).resolves.toEqual(
    await settled(() => guardedMethod.call(guarded, ...args)),
  );
}

class PrivateStateProvider implements LLMProvider {
  readonly supportsSessionResume = false;
  readonly lifecycleCapability = { synchronousSpawnPermit: true } as const;
  readonly nativeSchemaCapability = { nativeOutputSchema: true } as const;
  readonly systemPromptCapability = { deliversSystemPrompt: true } as const;
  private readonly secret = 'private-state';
  private readonly identity = this;

  private marker(): string {
    return this.identity === this ? this.secret : 'wrong-receiver';
  }

  async invoke(): Promise<InvokeResult> {
    return { success: true, output: this.secret, exitCode: 0 };
  }

  async prepareSelfHostAuth(): Promise<{ args: string[] }> {
    return { args: [this.marker()] };
  }

  async resolveSelfHostExecutable(): Promise<string> {
    return this.marker();
  }

  async readiness(): Promise<AuthenticationReadiness> {
    if (this.marker() !== 'private-state') throw new Error(this.marker());
    return { provider: 'codex', source: 'cached-login', state: 'ready' };
  }

  readOnlyReviewObservedCommandReach(): 'none' | 'possible' {
    return this.marker() === 'private-state' ? 'none' : 'possible';
  }
}

describe('ProviderRuntimeSet', () => {
  it('keeps frozen, namespace-shaped, and partial plugins usable through the guard', async () => {
    const frozenInvoke = vi.fn(async () => ({ success: true, output: 'frozen', exitCode: 0 }));
    const namespaceInvoke = vi.fn(async () => ({ success: true, output: 'namespace', exitCode: 0 }));
    const frozen = Object.freeze({ invoke: frozenInvoke, label: 'frozen' });
    const namespace = Object.preventExtensions(Object.defineProperty({
      invoke: namespaceInvoke,
      label: 'namespace',
    }, Symbol.toStringTag, { value: 'Module' }));
    const partial = { invoke: vi.fn(async () => ({ success: true, output: 'partial', exitCode: 0 })) };
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'frozen', frozen);
    registry.register('llm_provider', 'namespace', namespace);
    registry.register('llm_provider', 'partial', partial);
    registry.markInitialized();

    expect(() => createProviderRuntimeSet(registry)).not.toThrow();
    const runtimes = createProviderRuntimeSet(registry);
    const frozenRuntime = runtimes.get('frozen').provider as LLMProvider & { label?: string };
    const namespaceRuntime = runtimes.get('namespace').provider as LLMProvider & { label?: string };

    expect(frozenRuntime.label).toBe('frozen');
    expect(namespaceRuntime.label).toBe('namespace');
    expect(runtimes.get('partial').provider.readiness).toBeUndefined();
    await frozenRuntime.invoke({ prompt: '/x', sessionId: 'frozen', resume: false });
    await namespaceRuntime.invoke({ prompt: '/x', sessionId: 'namespace', resume: false });
    expect(frozenInvoke).toHaveBeenCalledOnce();
    expect(namespaceInvoke).toHaveBeenCalledOnce();
  });

  it('keeps prototype members, private state, and declared fields transparent through the system-prompt guard', async () => {
    const classProvider = new PrivateStateProvider();
    const classRegistry = new PluginRegistry();
    classRegistry.register('llm_provider', 'class-stub', classProvider);
    classRegistry.markInitialized();
    const guardedClassProvider = createProviderRuntimeSet(classRegistry)
      .get('class-stub').provider as PrivateStateProvider;

    for (const method of [
      'prepareSelfHostAuth',
      'resolveSelfHostExecutable',
      'readiness',
      'readOnlyReviewObservedCommandReach',
    ] as const) {
      await expectTransparentMethod(classProvider, guardedClassProvider, method);
    }
    for (const field of [
      'supportsSessionResume',
      'lifecycleCapability',
      'nativeSchemaCapability',
      'systemPromptCapability',
    ] as const) {
      expect(guardedClassProvider[field]).toBe(classProvider[field]);
    }

    const homeDir = await mkdtemp(join(tmpdir(), 'provider-runtime-'));
    try {
      const claude = new ClaudeProvider(dispatchGitGuard);
      const codex = new CodexProvider(dispatchGitGuard, async () => {
        throw new Error('doctor is stubbed');
      });
      const piEnvironment: PiEnvironment = {
        stat: vi.fn(),
        access: async () => {},
        env: {},
        homeDir: () => homeDir,
        cwd: () => homeDir,
      };
      const pi = new PiProvider(
        dispatchGitGuard,
        'pi',
        async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        piEnvironment,
        undefined,
        undefined,
        async () => ({ stdout: 'pi-private-key', exitCode: 0 }),
      );
      const registry = new PluginRegistry();
      registry.register('llm_provider', 'claude', claude);
      registry.register('llm_provider', 'codex', codex);
      registry.register('llm_provider', 'pi', pi);
      registry.markInitialized();
      const runtimes = createProviderRuntimeSet(registry);
      const guardedClaude = runtimes.get('claude').provider as ClaudeProvider;
      const guardedCodex = runtimes.get('codex').provider as CodexProvider;
      const guardedPi = runtimes.get('pi').provider as PiProvider;

      await expectTransparentMethod(claude, guardedClaude, 'prepareSelfHostAuth', {
        provider: 'claude', homeDir,
      });
      await expectTransparentMethod(claude, guardedClaude, 'readOnlyReviewObservedCommandReach', {});
      await expectTransparentMethod(codex, guardedCodex, 'readiness');
      await expectTransparentMethod(codex, guardedCodex, 'prepareSelfHostAuth', {
        provider: 'codex', homeDir,
      });
      await expectTransparentMethod(codex, guardedCodex, 'resolveSelfHostExecutable');
      await expectTransparentMethod(pi, guardedPi, 'prepareSelfHostAuth', {
        provider: 'pi', homeDir, model: 'deepseek/x',
      });
      await expectTransparentMethod(pi, guardedPi, 'resolveSelfHostExecutable');

      for (const [target, guarded] of [[claude, guardedClaude], [codex, guardedCodex], [pi, guardedPi]] as const) {
        for (const field of [
          'supportsSessionResume',
          'lifecycleCapability',
          'nativeSchemaCapability',
          'systemPromptCapability',
        ] as const) {
          expect(guarded[field]).toBe(target[field]);
        }
      }
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('passes a declared provider its system-prompt options unchanged', async () => {
    const result = { success: true, output: 'declared result', exitCode: 0 };
    const options: InvokeOptions = { prompt: '/x', systemPrompt: 'S', sessionId: 'declared', resume: false };
    const invoke = vi.fn(async (received: InvokeOptions) => {
      expect(received).toBe(options);
      return result;
    });
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'declared', {
      invoke,
      systemPromptCapability: { deliversSystemPrompt: true },
    });
    registry.markInitialized();

    const runtime = (await loadRuntimeSetFactory())!(registry).get('declared');

    await expect(runtime.provider.invoke(options)).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('wraps each runtime set independently without replacing the registered provider', async () => {
    const invoke = vi.fn(async () => ({
      success: true,
      output: 'declared result',
      exitCode: 0,
    }));
    const declared = {
      invoke,
      systemPromptCapability: { deliversSystemPrompt: true } as const,
    };
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'declared', declared);
    registry.markInitialized();

    const first = createProviderRuntimeSet(registry);
    const second = createProviderRuntimeSet(registry);
    const firstProvider = first.get('declared').provider;
    const secondProvider = second.get('declared').provider;

    await firstProvider.invoke({ prompt: '/first', systemPrompt: 'S', sessionId: 'first', resume: false });
    await secondProvider.invoke({ prompt: '/second', systemPrompt: 'S', sessionId: 'second', resume: false });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(registry.get('llm_provider', 'declared')).toBe(declared);
    expect(firstProvider).not.toBe(declared);
    expect(secondProvider).not.toBe(declared);
  });

  it.each([
    {
      name: 'without a system prompt',
      options: { prompt: '/x', sessionId: 'no-system-prompt', resume: false },
      output: 'no-system-prompt result',
    },
    {
      name: 'with an empty system prompt',
      options: { prompt: '/x', systemPrompt: '', sessionId: 'empty-system-prompt', resume: false },
      output: 'empty-system-prompt result',
    },
  ] satisfies Array<{ name: string; options: InvokeOptions; output: string }>)('passes an undeclared provider through $name', async ({ options, output }) => {
    const result = { success: true, output, exitCode: 0 };
    const invoke = vi.fn(async (received: InvokeOptions) => {
      expect(received).toBe(options);
      return result;
    });
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'undeclared', { invoke });
    registry.markInitialized();

    const runtime = (await loadRuntimeSetFactory())!(registry).get('undeclared');

    await expect(runtime.provider.invoke(options)).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'missing declaration' },
    {
      name: 'false declaration',
      systemPromptCapability: { deliversSystemPrompt: false },
    },
    { name: 'empty declaration', systemPromptCapability: {} },
  ])('refuses system-prompt delivery for a recorder provider with a $name', async ({
    systemPromptCapability,
  }) => {
    const invoke = vi.fn(async () => ({
      success: true,
      output: 'provider should not be called',
      exitCode: 0,
    }));
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'recorder', {
      invoke,
      ...(systemPromptCapability === undefined ? {} : { systemPromptCapability }),
    });
    registry.markInitialized();

    const createRuntimeSet = await loadRuntimeSetFactory();
    expect(createRuntimeSet).toBeTypeOf('function');
    const result = await createRuntimeSet!(registry)
      .get('recorder')
      .provider.invoke({ prompt: '/x', systemPrompt: 'S', sessionId: 'recorder', resume: false });

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      output:
        'Provider recorder cannot receive the engine system prompt: missing systemPromptCapability declaration. Recovery action: declare systemPromptCapability.deliversSystemPrompt and deliver InvokeOptions.systemPrompt to the model.',
      exitCode: 1,
      providerInvocationSkipped: true,
      executionDisposition: 'not-started',
      systemPromptUndeliverable: true,
    });
    expect(result.providerUnavailable).toBeUndefined();
  });

  it('exposes native schema from a Pi adapter when its descriptor declares nativeSchema', () => {
    const runtimes = new RuntimeSet([{
      key: 'pi',
      provider: { ...provider(), nativeSchemaCapability: { nativeOutputSchema: true } },
      nativeSchemaCapability: { nativeOutputSchema: true },
      policy: CLAUDE_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
    }]);

    expect(runtimes.nativeSchemaCapabilityFor('pi')).toEqual({ nativeOutputSchema: true });
  });

  it('exposes self-host auth for a registered Pi runtime with both adapter seams', async () => {
    const sentinel = { args: ['--sentinel'] };
    const prepareSelfHostAuth = vi.fn(async () => sentinel);
    const runtimes = new RuntimeSet([{
      key: 'pi',
      provider: {
        ...provider(),
        prepareSelfHostAuth,
        resolveSelfHostExecutable: vi.fn(async () => '/resolved/pi'),
      },
      policy: CLAUDE_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
    }]);

    const selfHostAuth = runtimes.selfHostAuthFor('pi');
    const context: SelfHostAuthContext = {
      provider: 'pi',
      homeDir: '/tmp/pi-home',
      model: 'deepseek/x',
    };

    expect(selfHostAuth).toBeTypeOf('function');
    await expect(selfHostAuth!(context)).resolves.toBe(sentinel);
    expect(prepareSelfHostAuth).toHaveBeenCalledTimes(1);
    expect(prepareSelfHostAuth).toHaveBeenCalledWith(context);
  });

  it('treats a Pi descriptor without writeFence as unfenced', async () => {
    const { writeFenceInstalledForProvider } = await import('../../src/engine/conductor.js');

    expect(writeFenceInstalledForProvider('pi')).toBe(false);
  });

  it('exposes a provider-declared synchronous spawn-permit capability', async () => {
    const capable = {
      ...provider(),
      lifecycleCapability: { synchronousSpawnPermit: true as const },
    };
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'claude', capable);
    registry.markInitialized();

    const runtimes = (await loadRuntimeSetFactory())?.(registry);

    expect({
      runtime: runtimes?.get('claude').lifecycleCapability,
      lookup: runtimes?.lifecycleCapabilityFor?.('claude'),
    }).toEqual({
      runtime: { synchronousSpawnPermit: true },
      lookup: { synchronousSpawnPermit: true },
    });
  });

  it('accepts a current spawn permit synchronously', async () => {
    const current: SpawnPermit = () => ({ permitted: true });
    const options: InvokeOptions = {
      prompt: 'current permit',
      sessionId: 'current-permit-session',
      resume: false,
      spawnPermit: current,
    };

    expect(validateSpawnPermit(options.spawnPermit)).toEqual({
      permitted: true,
    });
  });

  it('returns a typed denial for a revoked spawn permit', async () => {
    const revoked: SpawnPermit = () => ({
      permitted: false,
      reason: 'revoked',
    });
    const options: InvokeOptions = {
      prompt: 'revoked permit',
      sessionId: 'revoked-permit-session',
      resume: false,
      spawnPermit: revoked,
    };

    expect(validateSpawnPermit(options.spawnPermit)).toEqual({
      permitted: false,
      reason: 'revoked',
    });
  });

  it('forwards the preparation purpose to the shared synchronous permit', () => {
    const purpose: SpawnPermitPurpose = 'preparation';
    const permit = vi.fn<SpawnPermit>(() => ({ permitted: true }));

    expect(validateSpawnPermit(permit, purpose)).toEqual({ permitted: true });
    expect(permit).toHaveBeenCalledWith('preparation');
  });

  it.each([
    {
      name: 'success',
      result: { success: true, output: 'completed', exitCode: 0 },
    },
    {
      name: 'authentication failure',
      result: { success: false, output: 'login expired', exitCode: 1, authFailure: true },
    },
    {
      name: 'ordinary failure',
      result: { success: false, output: 'command failed', exitCode: 1 },
    },
  ] satisfies Array<{ name: string; result: InvokeResult }>)('preserves a probe-failed Codex invocation $name without marking the runtime unavailable', async ({ result }) => {
    const probeFailed: AuthenticationReadiness = {
      provider: 'codex',
      source: 'cached-login',
      state: 'probe-failed',
      probeFailure: { kind: 'timeout', facts: { timeoutMs: 10_000 } },
    };
    const invoke = vi.fn(async () => ({ ...result, authentication: probeFailed }));
    const readiness = vi.fn(async () => probeFailed);
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'codex', {
      invoke,
      readiness,
    });
    registry.markInitialized();

    const runtimes = (await loadRuntimeSetFactory())?.(registry);
    const runtime = runtimes?.get('codex');
    const resultFromRuntime = runtime && await (await loadRuntimeInvoker())?.(runtime, {
      prompt: 'continue after inconclusive readiness',
      sessionId: 'probe-failed-runtime-test',
      resume: false,
      model: CODEX_MODEL_POLICY.stepModels.build,
    });

    expect({
      readiness: await runtimes?.readinessFor('codex', probeFailed)?.(),
      result: resultFromRuntime,
      invocations: invoke.mock.calls.length,
      deadModels: runtime ? [...runtime.availability.dead] : undefined,
      runWideUnavailable: runtime?.runWideUnavailable,
    }).toEqual({
      readiness: probeFailed,
      result: { ...result, authentication: probeFailed },
      invocations: 1,
      deadModels: [],
      runWideUnavailable: undefined,
    });
  });

  it('exposes readiness only for the matching built-in provider', async () => {
    const ready: AuthenticationReadiness = {
      provider: 'codex',
      source: 'cached-login',
      state: 'ready',
    };
    const codex = {
      ...provider(),
      readiness: vi.fn(async () => ready),
    };
    const custom = {
      ...provider(),
      readiness: vi.fn(async () => ready),
    };
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'codex', codex);
    registry.register('llm_provider', 'custom', custom);
    registry.markInitialized();

    const runtimes = (await loadRuntimeSetFactory())?.(registry);
    const codexReadiness = runtimes?.readinessFor('codex', ready);
    const customReadiness = runtimes?.readinessFor('custom', ready);

    expect(await codexReadiness?.()).toEqual(ready);
    expect(customReadiness).toBeUndefined();
    expect(custom.readiness).not.toHaveBeenCalled();
  });

  it('exposes readiness only when the built-in descriptor declares it', async () => {
    const ready: AuthenticationReadiness = {
      provider: 'codex',
      source: 'cached-login',
      state: 'ready',
    };
    const claudeAuthentication = { ...ready, provider: 'claude' } as unknown as AuthenticationReadiness;
    const claudeReadiness = vi.fn(async () => ready);
    const codexReadiness = vi.fn(async () => ready);
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'claude', { ...provider(), readiness: claudeReadiness });
    registry.register('llm_provider', 'codex', { ...provider(), readiness: codexReadiness });
    registry.markInitialized();

    const runtimes = (await loadRuntimeSetFactory())?.(registry);

    expect({
      claude: runtimes?.readinessFor('claude', claudeAuthentication),
      codex: await runtimes?.readinessFor('codex', ready)?.(),
    }).toEqual({ claude: undefined, codex: ready });
    expect(claudeReadiness).not.toHaveBeenCalled();
  });

  it('constructs every frozen-registry provider with isolated per-run state', async () => {
    const claude = provider();
    const codex = provider();
    const custom = provider();
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'claude', claude);
    registry.register('llm_provider', 'codex', codex);
    registry.register('llm_provider', 'toString', custom);
    registry.markInitialized();

    const createRuntimeSet = await loadRuntimeSetFactory();
    const first = createRuntimeSet?.(registry);
    const second = createRuntimeSet?.(registry);
    const firstClaude = first?.get('claude');
    const firstCodex = first?.get('codex');
    const firstCustom = first?.get('toString');
    const secondClaude = second?.get('claude');
    const secondCodex = second?.get('codex');
    const secondCustom = second?.get('toString');

    expect({
      keys: first?.keys(),
      runtimeKeys: [
        firstClaude?.key,
        firstCodex?.key,
        firstCustom?.key,
      ],
      providerIdentity: [
        firstClaude?.provider !== claude,
        firstCodex?.provider !== codex,
        firstCustom?.provider !== custom,
        secondClaude?.provider !== claude,
        secondCodex?.provider !== codex,
        secondCustom?.provider !== custom,
      ],
      policies: [
        firstClaude?.policy === CLAUDE_MODEL_POLICY,
        firstCodex?.policy === CODEX_MODEL_POLICY,
        firstCustom?.policy === CLAUDE_MODEL_POLICY,
      ],
      builtIn: [
        firstClaude?.builtIn,
        firstCodex?.builtIn,
        firstCustom?.builtIn,
      ],
      isolatedState: [
        firstClaude !== secondClaude,
        firstCodex !== secondCodex,
        firstCustom !== secondCustom,
        firstClaude?.availability !== secondClaude?.availability,
        firstCodex?.availability !== secondCodex?.availability,
        firstCustom?.availability !== secondCustom?.availability,
        firstClaude?.availability !== firstCodex?.availability,
        firstCodex?.availability !== firstCustom?.availability,
      ],
    }).toEqual({
      keys: ['claude', 'codex', 'toString'],
      runtimeKeys: ['claude', 'codex', 'toString'],
      providerIdentity: [true, true, true, true, true, true],
      policies: [true, true, true],
      builtIn: [true, true, false],
      isolatedState: [true, true, true, true, true, true, true, true],
    });
  });

  it('isolates identical model failures and completes each native ladder inside its runtime', async () => {
    const opaqueModel = 'shared-opaque-model';
    const codexCalls: string[] = [];
    const claudeCalls: string[] = [];
    const ladderProvider = (
      calls: string[],
      nativeFallback: string,
    ): LLMProvider => ({
      invoke: vi.fn(async (options: InvokeOptions) => {
        const model = options.model ?? '';
        calls.push(model);
        return model === opaqueModel
          ? {
              success: false,
              output: `${model} unavailable`,
              exitCode: 1,
              modelUnavailable: true,
            }
          : {
              success: model === nativeFallback,
              output: model === nativeFallback ? 'ok' : 'wrong ladder',
              exitCode: model === nativeFallback ? 0 : 1,
            };
      }),
    });
    const registry = new PluginRegistry();
    registry.register(
      'llm_provider',
      'claude',
      ladderProvider(claudeCalls, CLAUDE_MODEL_POLICY.modelFallbackLadder[0]),
    );
    registry.register(
      'llm_provider',
      'codex',
      ladderProvider(codexCalls, CODEX_MODEL_POLICY.modelFallbackLadder[0]),
    );
    registry.markInitialized();
    const createRuntimeSet = await loadRuntimeSetFactory();
    const invokeRuntime = await loadRuntimeInvoker();
    const runtimes = createRuntimeSet?.(registry);
    const codexRuntime = runtimes?.get('codex');
    const claudeRuntime = runtimes?.get('claude');

    const codexResult =
      codexRuntime &&
      (await invokeRuntime?.(codexRuntime, {
        prompt: 'codex',
        sessionId: 'codex-session',
        resume: false,
        model: opaqueModel,
      }));
    const claudeBeforeInvocation = {
      calls: [...claudeCalls],
      effective: claudeRuntime?.availability.effectiveModel(opaqueModel),
    };
    const claudeResult =
      claudeRuntime &&
      (await invokeRuntime?.(claudeRuntime, {
        prompt: 'claude',
        sessionId: 'claude-session',
        resume: false,
        model: opaqueModel,
      }));

    expect({
      codexResult,
      claudeResult,
      codexCalls,
      claudeCalls,
      claudeBeforeInvocation,
      dead: {
        codex: codexRuntime?.availability.dead.has(opaqueModel),
        claude: claudeRuntime?.availability.dead.has(opaqueModel),
      },
    }).toEqual({
      codexResult: { success: true, output: 'ok', exitCode: 0 },
      claudeResult: { success: true, output: 'ok', exitCode: 0 },
      codexCalls: [
        opaqueModel,
        CODEX_MODEL_POLICY.modelFallbackLadder[0],
      ],
      claudeCalls: [
        opaqueModel,
        CLAUDE_MODEL_POLICY.modelFallbackLadder[0],
      ],
      claudeBeforeInvocation: {
        calls: [],
        effective: { model: opaqueModel, downgraded: false },
      },
      dead: { codex: true, claude: true },
    });
  });

  it('caches only explicit deterministic run-wide provider unavailability', async () => {
    const invokeRuntime = await loadRuntimeInvoker();
    const cases: Array<{
      name: string;
      result: ClassifiedInvokeResult;
      expectedCalls: number;
      expectedReason?: string;
    }> = [
      {
        name: 'missing executable',
        result: {
          success: false,
          output: 'codex executable missing',
          exitCode: 127,
          providerUnavailable: true,
          providerUnavailableReason: 'codex executable missing',
          providerUnavailableScope: 'run',
        },
        expectedCalls: 1,
        expectedReason: 'codex executable missing',
      },
      {
        name: 'model exhaustion',
        result: {
          success: false,
          output: 'model unavailable',
          exitCode: 1,
          modelUnavailable: true,
        },
        expectedCalls: 2,
      },
      {
        name: 'unscoped provider unavailability',
        result: {
          success: false,
          output: 'provider unavailable for this attempt',
          exitCode: 1,
          providerUnavailable: true,
          providerUnavailableReason: 'provider unavailable for this attempt',
        },
        expectedCalls: 2,
      },
      {
        name: 'timeout',
        result: {
          success: false,
          output: 'request timed out',
          exitCode: 1,
          timedOut: true,
        },
        expectedCalls: 2,
      },
      {
        name: 'authentication',
        result: {
          success: false,
          output: 'not logged in',
          exitCode: 1,
          authFailure: true,
        },
        expectedCalls: 2,
      },
      {
        name: 'rate limit',
        result: {
          success: false,
          output: 'rate limited',
          exitCode: 1,
          rateLimited: true,
        },
        expectedCalls: 2,
      },
      {
        name: 'rejection',
        result: {
          success: false,
          output: 'work rejected',
          exitCode: 1,
          rejected: true,
        },
        expectedCalls: 2,
      },
      {
        name: 'ordinary failure',
        result: {
          success: false,
          output: 'command failed',
          exitCode: 1,
        },
        expectedCalls: 2,
      },
      {
        name: 'misleading missing-executable prose',
        result: {
          success: false,
          output: 'codex executable missing',
          exitCode: 1,
        },
        expectedCalls: 2,
      },
    ];
    const observed = [];

    for (const fixture of cases) {
      let calls = 0;
      const runtime: ProviderRuntime = {
        key: `codex-${fixture.name}`,
        provider: {
          invoke: vi.fn(async () => {
            calls += 1;
            return fixture.result;
          }),
        },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability([]),
      };
      const options: InvokeOptions = {
        prompt: fixture.name,
        sessionId: `${fixture.name}-session`,
        resume: false,
        model: 'opaque-model',
      };

      await invokeRuntime?.(runtime, options);
      const second = await invokeRuntime?.(runtime, options);
      const skipped = second?.providerInvocationSkipped === true;
      observed.push({
        name: fixture.name,
        calls,
        cachedReason: runtime.runWideUnavailable?.reason,
        skipped,
        exposedReason: skipped
          ? second.providerUnavailableReason
          : undefined,
      });
    }

    expect(observed).toEqual(
      cases.map((fixture) => ({
        name: fixture.name,
        calls: fixture.expectedCalls,
        cachedReason: fixture.expectedReason,
        skipped: fixture.expectedReason !== undefined,
        exposedReason: fixture.expectedReason,
      })),
    );
  });
});
