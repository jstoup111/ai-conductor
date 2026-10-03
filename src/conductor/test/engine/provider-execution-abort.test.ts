// Covers: task:8
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet, type ProviderRuntime } from '../../src/engine/provider-runtime.js';
import { ProviderSessionScope } from '../../src/engine/provider-session.js';
import { executeProviderCandidates } from '../../src/engine/provider-execution.js';

function runtime(key: 'claude' | 'codex', provider: LLMProvider): ProviderRuntime {
  const policy = key === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
  return {
    key,
    provider,
    policy,
    builtIn: true,
    availability: new ModelAvailability(policy.modelFallbackLadder),
  };
}

describe('executeProviderCandidates abort handling', () => {
  it('does not invoke a fallback candidate after the active invocation aborts', async () => {
    const controller = new AbortController();
    const firstInvoke = vi.fn(async () => {
      return {
        success: false,
        output: 'candidate aborted',
        exitCode: 1,
        modelUnavailable: true,
      };
    });
    const secondInvoke = vi.fn(async () => ({
      success: true,
      output: 'fallback must not run',
      exitCode: 0,
    }));

    const result = await executeProviderCandidates({
      step: 'build',
      configuredProviders: ['codex', 'claude'],
      preferredProvider: 'codex',
      runtimes: new ProviderRuntimeSet([
        runtime('codex', { invoke: firstInvoke }),
        runtime('claude', { invoke: secondInvoke }),
      ]),
      sessions: new ProviderSessionScope(vi.fn().mockReturnValue('candidate-session')),
      abortSignal: controller.signal,
      onAttempt: async (_step, attempt) => {
        if (attempt.provider === 'codex') controller.abort();
      },
      options: { prompt: 'Build the feature.', cwd: '/workspace' },
    });

    expect({ success: result.success, output: result.output, secondCalls: secondInvoke.mock.calls.length }).toEqual({
      success: false,
      output: 'candidate aborted',
      secondCalls: 0,
    });
  });
});
