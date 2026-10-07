import type {
  InvokeOptions,
  InvokeResult,
  LLMProvider,
  NativeSchemaRequest,
} from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import {
  ProviderRuntimeSet,
  type ProviderRuntime,
} from '../../src/engine/provider-runtime.js';

export type RemediationPlanProviderKey = 'claude' | 'codex';

export type RemediationPlanProviderOutcome =
  | {
    kind: 'structured';
    finalStructuredResult: unknown;
    output?: string;
    exitCode?: number;
  }
  | {
    kind: 'chat';
    output: string;
    exitCode?: number;
  }
  | { kind: 'throw'; error: unknown }
  | {
    kind: 'timeout';
    output?: string;
    exitCode?: number;
  }
  | { kind: 'provider-condition'; result: InvokeResult };

export interface RemediationPlanProviderCall {
  sessionId: string;
  nativeSchema: NativeSchemaRequest | undefined;
}

export interface RemediationPlanProviderFixture {
  provider: LLMProvider;
  runtime: ProviderRuntime;
  runtimes: ProviderRuntimeSet;
  calls: RemediationPlanProviderCall[];
  readonly invocationCount: number;
}

export function createRemediationPlanProviderFixture({
  key,
  outcomes,
}: {
  key: RemediationPlanProviderKey;
  outcomes: readonly RemediationPlanProviderOutcome[];
}): RemediationPlanProviderFixture {
  const calls: RemediationPlanProviderCall[] = [];
  const policy = key === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;

  const provider: LLMProvider = {
    supportsSessionResume: key === 'claude',
    lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true },
    async invoke(options: InvokeOptions): Promise<InvokeResult> {
      calls.push({ sessionId: options.sessionId, nativeSchema: options.nativeSchema });
      const outcome = outcomes[calls.length - 1];
      if (!outcome) {
        throw new Error(`Remediation plan provider fixture has no outcome for invocation ${calls.length}.`);
      }

      switch (outcome.kind) {
        case 'structured':
          return {
            success: true,
            output: outcome.output ?? 'structured result',
            exitCode: outcome.exitCode ?? 0,
            finalStructuredResult: outcome.finalStructuredResult,
          };
        case 'chat':
          return {
            success: true,
            output: outcome.output,
            exitCode: outcome.exitCode ?? 0,
          };
        case 'throw':
          throw outcome.error;
        case 'timeout':
          return {
            success: false,
            output: outcome.output ?? 'fixture timeout',
            exitCode: outcome.exitCode ?? 124,
          };
        case 'provider-condition':
          return outcome.result;
      }
    },
  };
  const runtime: ProviderRuntime = {
    key,
    provider,
    lifecycleCapability: provider.lifecycleCapability,
    nativeSchemaCapability: provider.nativeSchemaCapability,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };

  return {
    provider,
    runtime,
    runtimes: new ProviderRuntimeSet([runtime]),
    calls,
    get invocationCount() { return calls.length; },
  };
}
