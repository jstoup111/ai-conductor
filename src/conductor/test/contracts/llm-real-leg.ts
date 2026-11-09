import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { afterAll } from 'vitest';
import { assertTokenCap, resolveLiveE2ETokenCap } from '../fixtures/live-e2e-run-body.js';
import { LIVE_E2E_PROVIDERS } from '../fixtures/live-e2e-providers.js';
import { runBoundaryContract } from './boundary-contract.js';
import { llmContract } from './llm.contract.js';

type LiveLlmAdapter = 'claude' | 'codex' | 'pi';

export interface MeteredLlmProvider extends LLMProvider {
  readonly totalTokens: number;
  readonly unmetered: number;
}

interface LlmRealLegOptions {
  readonly createProvider?: () => LLMProvider;
  readonly environment?: NodeJS.ProcessEnv;
  readonly emit?: (message: string) => void;
}

interface LlmMeter {
  totalTokens: number;
  unmetered: number;
}

/** Builds the registered provider adapter used by an opt-in credentialed smoke leg. */
export function createDefaultLlmRealProvider(adapter: LiveLlmAdapter): LLMProvider {
  const descriptor = LIVE_E2E_PROVIDERS.find(({ id }) => id === adapter);
  if (descriptor === undefined) {
    throw new Error(`No live E2E provider registered for ${adapter}`);
  }
  return descriptor.createProvider();
}

/** Adds input/output token accounting without changing the provider boundary contract. */
export function meterLlmProvider(provider: LLMProvider, meter: LlmMeter = { totalTokens: 0, unmetered: 0 }): MeteredLlmProvider {
  return {
    supportsSessionResume: provider.supportsSessionResume,
    lifecycleCapability: provider.lifecycleCapability,
    nativeSchemaCapability: provider.nativeSchemaCapability,
    systemPromptCapability: provider.systemPromptCapability,
    readiness: provider.readiness?.bind(provider),
    prepareSelfHostAuth: provider.prepareSelfHostAuth?.bind(provider),
    resolveSelfHostExecutable: provider.resolveSelfHostExecutable?.bind(provider),
    readOnlyReviewObservedCommandReach: provider.readOnlyReviewObservedCommandReach?.bind(provider),
    get totalTokens() {
      return meter.totalTokens;
    },
    get unmetered() {
      return meter.unmetered;
    },
    async invoke(options: InvokeOptions): Promise<InvokeResult> {
      const result = await provider.invoke(options);
      const usage = result.tokenUsage;
      if (!usage || !Number.isFinite(usage.input) || !Number.isFinite(usage.output)) {
        meter.unmetered += 1;
      } else {
        meter.totalTokens += usage.input + usage.output;
      }
      return result;
    },
  };
}

/** Registers the credentialed real-provider contract cases with a shared token cap. */
export function defineLlmRealLeg(adapter: LiveLlmAdapter, options: LlmRealLegOptions = {}): void {
  const meter: LlmMeter = { totalTokens: 0, unmetered: 0 };
  const createProvider = options.createProvider ?? (() => createDefaultLlmRealProvider(adapter));
  const environment = options.environment ?? process.env;
  const emit = options.emit ?? console.info;
  const cap = resolveLiveE2ETokenCap(environment);

  runBoundaryContract(llmContract, {
    adapter,
    leg: 'real',
    create: () => meterLlmProvider(createProvider(), meter),
  });

  afterAll(() => {
    emit(`llm contract [${adapter} real] tokens: ${meter.totalTokens} (cap ${cap})`);
    assertTokenCap(meter.totalTokens, meter.unmetered, cap);
  });
}
