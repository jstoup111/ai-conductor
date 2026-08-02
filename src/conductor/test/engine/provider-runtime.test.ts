import { describe, expect, it, vi } from 'vitest';
import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
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
import { validateSpawnPermit } from '../../src/engine/provider-runtime.js';

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
    invokeInteractive: vi.fn(async () => {}),
  };
}

describe('ProviderRuntimeSet', () => {
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
        firstClaude?.provider === claude,
        firstCodex?.provider === codex,
        firstCustom?.provider === custom,
        secondClaude?.provider === claude,
        secondCodex?.provider === codex,
        secondCustom?.provider === custom,
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

  it('preserves degraded readiness and real classifications across intended Codex model attempts', async () => {
    const probeFailed: AuthenticationReadiness = {
      provider: 'codex',
      source: 'cached-login',
      state: 'probe-failed',
      probeFailure: {
        kind: 'timeout',
        facts: { timeoutMs: 10_000 },
      },
    };
    const models = [
      CODEX_MODEL_POLICY.stepModels.build,
      CODEX_MODEL_POLICY.modelEscalationOrder.at(-1)!,
    ];
    const actualResults: InvokeResult[] = [
      {
        success: false,
        output: 'ordinary failure remains ordinary',
        exitCode: 1,
        authentication: probeFailed,
      },
      {
        success: false,
        output: 'rate limit remains authoritative',
        exitCode: 1,
        rateLimited: true,
        waitSeconds: 7,
        authentication: probeFailed,
      },
    ];
    const invoke = vi.fn(async (options: InvokeOptions) => {
      const index = models.indexOf(options.model ?? '');
      return actualResults[index] ?? {
        success: false,
        output: 'unexpected model',
        exitCode: 1,
      };
    });
    const readiness = vi.fn(async () => probeFailed);
    const registry = new PluginRegistry();
    registry.register('llm_provider', 'codex', {
      invoke,
      invokeInteractive: vi.fn(async () => {}),
      readiness,
    });
    registry.markInitialized();
    const runtimes = (await loadRuntimeSetFactory())?.(registry);
    const runtime = runtimes?.get('codex');
    const invokeRuntime = await loadRuntimeInvoker();
    const observed = [];

    for (const model of models) {
      const readinessCheck = runtimes?.readinessFor('codex', probeFailed);
      observed.push({
        readiness: await readinessCheck?.(),
        result: runtime && await invokeRuntime?.(runtime, {
          prompt: `attempt ${model}`,
          sessionId: `session-${model}`,
          resume: false,
          model,
        }),
      });
    }

    expect({
      observed,
      invokedModels: invoke.mock.calls.map(([options]) => options.model),
      readinessCalls: readiness.mock.calls.length,
      deadModels: runtime ? [...runtime.availability.dead] : undefined,
      runWideUnavailable: runtime?.runWideUnavailable,
    }).toEqual({
      observed: actualResults.map((result) => ({
        readiness: probeFailed,
        result,
      })),
      invokedModels: models,
      readinessCalls: models.length,
      deadModels: [],
      runWideUnavailable: undefined,
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
      invokeInteractive: vi.fn(async () => {}),
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
        name: 'session expiry',
        result: {
          success: false,
          output: 'session expired',
          exitCode: 1,
          sessionExpired: true,
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
          invokeInteractive: vi.fn(async () => {}),
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
