// Covers: task:16
import { describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { REMEDIATION_PLAN_SCHEMA, renderRemediationPlanShape } from '../../src/engine/remediation-plan-contract.js';
import type { RemediationProjection } from '../../src/engine/remediation-projection.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const projection: RemediationProjection = {
  version: 1,
  source: 'build-stall',
  requiredReferences: [],
  evidence: { excerpts: [], omittedFiles: [] },
  tasks: [],
  pendingAsBuiltFindings: [],
  priorLaps: [],
  refusals: [],
  vocabulary: { dispositions: ['build'], haltCategories: ['mechanical'] },
};

function runnerFor(
  key: 'claude' | 'codex',
  invoke: LLMProvider['invoke'],
  nativeOutputSchema = true,
) {
  const policy = key === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
  const provider: LLMProvider = {
    lifecycleCapability: { synchronousSpawnPermit: true },
    ...(nativeOutputSchema ? { nativeSchemaCapability: { nativeOutputSchema: true as const } } : {}),
    invoke,
  };
  return new DefaultStepRunner({ invoke: vi.fn() }, 'runner-session', '/tmp/remediation-gap-plan', {
    config: { llm_provider: key, steps: { remediate: { llm_provider: key } } },
    configuredProviders: [key],
    providerRuntimes: new ProviderRuntimeSet([{
      key,
      provider,
      lifecycleCapability: { synchronousSpawnPermit: true },
      ...(nativeOutputSchema ? { nativeSchemaCapability: { nativeOutputSchema: true as const } } : {}),
      policy,
      builtIn: true,
      availability: new ModelAvailability(policy.modelFallbackLadder),
    }]),
    sessionStore: new ProviderSessionStore(),
  });
}

describe('remediate gap-plan native-schema dispatch', () => {
  // Covers: task:16
  it.each(['claude', 'codex'] as const)(
    'uses a fresh %s one-shot with the engine-owned schema and rendered contract',
    async (key) => {
      const terminal = { version: 'v1', dispositions: [] };
      const invoke = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({
        success: true,
        output: 'chat text is not the contract authority',
        exitCode: 0,
        finalStructuredResult: terminal,
      }));
      const runner = runnerFor(key, invoke);

      const result = await runner.run('remediate', {}, {
        remediationRequest: { mode: 'gap-plan', projection },
      });

      const options = (invoke.mock.calls as unknown as [InvokeOptions][])[0]?.[0];
      expect(result.finalStructuredResult).toEqual(terminal);
      expect(options.resume).toBe(false);
      expect(options.nativeSchema).toBe(REMEDIATION_PLAN_SCHEMA);
      expect(options.sessionId).not.toBe('runner-session');
      expect(options.prompt).toContain(renderRemediationPlanShape());
      expect(options.prompt).toContain(JSON.stringify(projection));
    },
  );

  // Covers: task:16
  it('fails before invocation when the selected provider lacks native-schema capability', async () => {
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'unused', exitCode: 0 }));
    const runner = runnerFor('claude', invoke, false);

    const result = await runner.run('remediate', {}, {
      remediationRequest: { mode: 'gap-plan', projection },
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      output: expect.stringContaining('claude'),
    });
    expect(result.output).toContain('nativeSchemaCapability.nativeOutputSchema');
  });

  // Covers: task:16
  it('rejects chat-text-only output when the terminal structured result is absent', async () => {
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: JSON.stringify({ version: 'v1', dispositions: [] }),
      exitCode: 0,
    }));
    const runner = runnerFor('claude', invoke);

    const result = await runner.run('remediate', {}, {
      remediationRequest: { mode: 'gap-plan', projection },
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: false, output: 'structured-result-missing' });
    expect(result.finalStructuredResult).toBeUndefined();
  });
});
