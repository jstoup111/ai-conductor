// Covers: task:7
import { describe, expect, it, vi } from 'vitest';
import type { InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { ExecuteProviderCandidatesInput } from '../../src/engine/provider-execution.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const emptyState: ConductState = {};

function provider(): LLMProvider {
  return {
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke: vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'done',
      exitCode: 0,
    })),
  };
}

describe('DefaultStepRunner build abort signals', () => {
  it('forwards an explicit signal and omits it when none was dispatched', async () => {
    const providerExecutor = vi.fn(async (_input: ExecuteProviderCandidatesInput) => ({
      success: true,
      output: 'done',
      exitCode: 0,
      preferredProvider: 'codex' as const,
      actualProvider: 'codex' as const,
      attempts: [],
    }));
    const runner = new DefaultStepRunner(provider(), 'session', '/tmp/project', {
      providerExecution: {
        configuredProviders: ['codex'],
        runtimes: new ProviderRuntimeSet([{
          key: 'codex',
          provider: provider(),
          lifecycleCapability: { synchronousSpawnPermit: true },
          policy: CODEX_MODEL_POLICY,
          builtIn: true,
          availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
        }]),
        sessions: new ProviderSessionStore(),
        executor: providerExecutor,
      },
    });
    const controller = new AbortController();

    await runner.run('build', emptyState, { abortSignal: controller.signal });
    await runner.run('build', emptyState);

    expect(providerExecutor.mock.calls.map(([input]) => ({
      abortSignal: input.abortSignal,
      hasAbortSignal: Object.hasOwn(input, 'abortSignal'),
    }))).toEqual([
      { abortSignal: controller.signal, hasAbortSignal: true },
      { abortSignal: undefined, hasAbortSignal: false },
    ]);
  });
});
