// Covers: task:16, task:17
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
import { REMEDIATION_TYPED_PLAN_PATH, remediationRequiredReferenceDigest, type RemediationPlanStoreFilesystem } from '../../src/engine/remediation-plan-store.js';
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
  vocabulary: { dispositions: ['build'], haltCategories: ['architectural-clarity'] },
};

function runnerFor(
  key: 'claude' | 'codex',
  invoke: LLMProvider['invoke'],
  nativeOutputSchema = true,
  remediationPlanStoreFilesystem?: RemediationPlanStoreFilesystem,
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
    remediationPlanStoreFilesystem,
  });
}

function memoryFilesystem(files = new Map<string, string>()): RemediationPlanStoreFilesystem {
  return {
    mkdir: async () => undefined,
    readFile: async (path) => {
      const value = files.get(path);
      if (value === undefined) {
        const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return value;
    },
    writeFile: async (path, contents) => { files.set(path, contents); },
    rename: async (from, to) => {
      const value = files.get(from);
      if (value === undefined) throw new Error(`missing temporary file: ${from}`);
      files.set(to, value);
      files.delete(from);
    },
    rm: async (path) => { files.delete(path); },
  };
}

describe('remediate gap-plan native-schema dispatch', () => {
  // Covers: task:16, task:17
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

  // Covers: task:16, task:17
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

  // Covers: task:16, task:17
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

  // Covers: task:17
  it('validates and persists a plan with engine-owned attempt, source, and reference digest', async () => {
    const files = new Map<string, string>();
    const terminal = { version: 'v1', dispositions: [] };
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true, output: 'validated plan', exitCode: 0, finalStructuredResult: terminal,
    }));
    const runner = runnerFor('claude', invoke, true, memoryFilesystem(files));

    const result = await runner.run('remediate', {}, {
      runId: 'gap-plan-attempt',
      remediationRequest: { mode: 'gap-plan', projection },
    });

    expect(result).toMatchObject({ success: true, finalStructuredResult: terminal });
    expect(JSON.parse(files.get(`/tmp/remediation-gap-plan/${REMEDIATION_TYPED_PLAN_PATH}`)!)).toEqual({
      version: 'v1',
      attemptId: 'gap-plan-attempt',
      source: 'build-stall',
      requiredReferenceDigest: remediationRequiredReferenceDigest(projection.requiredReferences),
      dispositions: [],
    });
  });

  // Covers: task:17
  it('returns validator diagnostics and rejections without persisting a rejected plan', async () => {
    const files = new Map<string, string>();
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'invalid plan',
      exitCode: 0,
      finalStructuredResult: {
        version: 'v1',
        dispositions: [{
          reference: { kind: 'stall', id: 'stall:gap-plan' },
          disposition: 'invented-disposition',
          category: null,
          rationale: 'The provider chose an unsupported disposition.',
          tasks: [],
          boundTaskIds: [],
        }],
      },
    }));
    const runner = runnerFor('claude', invoke, true, memoryFilesystem(files));

    const result = await runner.run('remediate', {}, {
      runId: 'rejected-gap-plan-attempt',
      remediationRequest: { mode: 'gap-plan', projection },
    });

    expect(result).toMatchObject({
      success: false,
      output: expect.stringContaining('structured-result-rejected'),
      finalStructuredResult: undefined,
    });
    expect(result.output).toContain('dispositions[0].disposition');
    expect(result.output).toContain('invented-disposition');
    expect(files.size).toBe(0);
    expect(files.has(`/tmp/remediation-gap-plan/${REMEDIATION_TYPED_PLAN_PATH}`)).toBe(false);
  });

  // Covers: task:17
  it('returns a named persistence fault and does not accept the typed plan when storage fails', async () => {
    const filesystem = memoryFilesystem();
    filesystem.writeFile = async () => { throw new Error('disk full'); };
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true, output: 'valid plan', exitCode: 0, finalStructuredResult: { version: 'v1', dispositions: [] },
    }));
    const runner = runnerFor('claude', invoke, true, filesystem);

    const result = await runner.run('remediate', {}, {
      runId: 'persistence-fault-attempt',
      remediationRequest: { mode: 'gap-plan', projection },
    });

    expect(result).toMatchObject({ success: false, output: expect.stringContaining('persistence-fault'), finalStructuredResult: undefined });
    expect(result.output).toContain('disk full');
  });
});
