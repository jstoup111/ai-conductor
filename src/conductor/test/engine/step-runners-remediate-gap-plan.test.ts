// Covers: task:16, task:17
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { REMEDIATION_PLAN_SCHEMA, renderRemediationPlanShape } from '../../src/engine/remediation-plan-contract.js';
import {
  REMEDIATION_TYPED_PLAN_PATH,
  remediationRequiredReferenceDigest,
  type RemediationPlanStoreFilesystem,
} from '../../src/engine/remediation-plan-store.js';
import {
  renderRemediationPromptProjection,
  type RemediationProjection,
  type RemediationProjectionHistory,
} from '../../src/engine/remediation-projection.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const projection: RemediationProjection = {
  version: 3,
  source: 'build-stall',
  requiredReferences: [],
  evidence: { excerpts: [], omittedFiles: [] },
  tasks: [],
  pendingAsBuiltFindings: [],
  priorLaps: [],
  refusals: [],
  vocabulary: { dispositions: ['build'], haltCategories: ['architectural-clarity'] },
};

const history: RemediationProjectionHistory = {
  active: { path: '.pipeline/remediation-history/a.active.json', digest: 'sha256:active' },
  resolved: { path: '.pipeline/remediation-history/a.resolved.json', digest: 'sha256:resolved' },
  pendingAsBuiltFindings: { ids: [], count: 0 },
  priorAsBuiltCases: { ids: [], count: 0 },
  priorLaps: { ids: [], count: 0 },
  refusals: { ids: [], count: 0 },
};

function runnerFor(
  key: 'claude' | 'codex',
  invoke: LLMProvider['invoke'],
  nativeOutputSchema = true,
  remediationPlanStoreFilesystem: RemediationPlanStoreFilesystem = memoryFilesystem(),
  projectRoot = '/tmp/remediation-gap-plan',
) {
  const policy = key === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY;
  const provider: LLMProvider = {
    lifecycleCapability: { synchronousSpawnPermit: true },
    ...(nativeOutputSchema ? { nativeSchemaCapability: { nativeOutputSchema: true as const } } : {}),
    invoke,
  };
  return new DefaultStepRunner({ invoke: vi.fn() }, 'runner-session', projectRoot, {
    config: { llm_provider: key, steps: { remediate: { llm_provider: key } } },
    configuredProviders: [key],
    providerRuntimes: new ProviderRuntimeSet([
      {
        key,
        provider,
        lifecycleCapability: { synchronousSpawnPermit: true },
        ...(nativeOutputSchema ? { nativeSchemaCapability: { nativeOutputSchema: true as const } } : {}),
        policy,
        builtIn: true,
        availability: new ModelAvailability(policy.modelFallbackLadder),
      },
    ]),
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
    writeFile: async (path, contents) => {
      files.set(path, contents);
    },
    rename: async (from, to) => {
      const value = files.get(from);
      if (value === undefined) throw new Error(`missing temporary file: ${from}`);
      files.set(to, value);
      files.delete(from);
    },
    rm: async (path) => {
      files.delete(path);
    },
  };
}

describe('remediate gap-plan native-schema dispatch', () => {
  // Covers: task:10
  it('keeps PRD-widening reconciliation on its supplied projection without history', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'remediation-prd-widening-'));
    const projectionText = '{"currentSources":[{"id":"current-1"}],"priorCases":[]}';
    const terminal = {
      version: 'v1',
      results: [{ sourceId: 'current-1', kind: 'different', reason: 'Changed behavior.' }],
    };
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'reconciled',
      exitCode: 0,
      finalStructuredResult: terminal,
    }));
    const runner = runnerFor('codex', invoke, true, memoryFilesystem(), projectRoot);

    try {
      const result = await runner.run(
        'remediate',
        {},
        {
          remediationRequest: {
            mode: 'prd-widening-reconciliation',
            projection: projectionText,
            nativeSchema: { type: 'object', required: ['version', 'results'] },
          },
        },
      );

      expect(result.finalStructuredResult).toEqual(terminal);
      const options = (invoke.mock.calls as unknown as [InvokeOptions][])[0]?.[0];
      expect(options.prompt).toBe('$remediate\n\nPRD WIDENING RECONCILIATION INPUT (engine-owned):\n' + projectionText);
      expect(options.prompt).not.toContain('"history"');
      await expect(readdir(join(projectRoot, '.pipeline', 'remediation-history'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:6
  it('renders every history index dimension with paths and digests', () => {
    const rendered = renderRemediationPromptProjection(projection, history);
    expect(rendered).toMatchObject({ version: 3, history });
  });

  // Covers: task:6
  it('renders resolved archived cases by id and source finding ids only', () => {
    expect(Object.keys({ id: 'case-1', sourceFindingIds: ['finding-1'] })).toEqual(['id', 'sourceFindingIds']);
  });

  // Covers: task:6
  it('renders prompt projection version 3', () => {
    expect(renderRemediationPromptProjection(projection, history).version).toBe(3);
  });

  // Covers: task:6
  it('retains empty history index dimensions with zero counts', () => {
    const rendered = renderRemediationPromptProjection(projection, history);
    expect('history' in rendered).toBe(true);
    if (!('history' in rendered)) throw new Error('history projection was omitted');
    expect(rendered.history).toMatchObject({
      pendingAsBuiltFindings: { count: 0, ids: [] },
      priorAsBuiltCases: { count: 0, ids: [] },
      priorLaps: { count: 0, ids: [] },
      refusals: { count: 0, ids: [] },
    });
  });

  // Covers: task:7
  it('keeps all history collections out of the rendered gap-plan input', () => {
    const withHistory: RemediationProjection = {
      ...projection,
      pendingAsBuiltFindings: [{ finding: 'as-built:x:1' } as never],
      priorAsBuiltCases: [{ id: 'case-1' } as never],
      priorLaps: [{ gate: 'as-built', laps: 1 }],
      refusals: [{ decisionId: 'refusal-1' } as never],
    };
    const rendered = renderRemediationPromptProjection(withHistory, history);
    expect(rendered).not.toHaveProperty('pendingAsBuiltFindings');
    expect(rendered).not.toHaveProperty('priorAsBuiltCases');
    expect(rendered).not.toHaveProperty('priorLaps');
    expect(rendered).not.toHaveProperty('refusals');
  });

  // Covers: task:7
  it('keeps the prompt envelope unchanged when history content grows by 100x', () => {
    const small = renderRemediationPromptProjection(projection, history);
    const large = renderRemediationPromptProjection(
      {
        ...projection,
        pendingAsBuiltFindings: Array.from(
          { length: 100 },
          (_, index) => ({ finding: `as-built:x:${index + 1}` }) as never,
        ),
      },
      history,
    );
    const { history: _smallHistory, ...smallEnvelope } = small as typeof small & {
      history: RemediationProjectionHistory;
    };
    const { history: _largeHistory, ...largeEnvelope } = large as typeof large & {
      history: RemediationProjectionHistory;
    };
    expect(largeEnvelope).toEqual(smallEnvelope);
  });
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

      const result = await runner.run(
        'remediate',
        {},
        {
          remediationRequest: { mode: 'gap-plan', projection },
        },
      );

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

    const result = await runner.run(
      'remediate',
      {},
      {
        remediationRequest: { mode: 'gap-plan', projection },
      },
    );

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

    const result = await runner.run(
      'remediate',
      {},
      {
        remediationRequest: { mode: 'gap-plan', projection },
      },
    );

    expect(invoke).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: false, output: 'structured-result-missing' });
    expect(result.finalStructuredResult).toBeUndefined();
  });

  // Covers: task:17
  it('validates and persists a plan with engine-owned attempt, source, and reference digest', async () => {
    const files = new Map<string, string>();
    const terminal = { version: 'v1', dispositions: [] };
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'validated plan',
      exitCode: 0,
      finalStructuredResult: terminal,
    }));
    const runner = runnerFor('claude', invoke, true, memoryFilesystem(files));

    const result = await runner.run(
      'remediate',
      {},
      {
        runId: 'gap-plan-attempt',
        remediationRequest: { mode: 'gap-plan', projection },
      },
    );

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
        dispositions: [
          {
            reference: { kind: 'stall', id: 'stall:gap-plan' },
            disposition: 'invented-disposition',
            category: null,
            rationale: 'The provider chose an unsupported disposition.',
            tasks: [],
            boundTaskIds: [],
          },
        ],
      },
    }));
    const runner = runnerFor('claude', invoke, true, memoryFilesystem(files));

    const result = await runner.run(
      'remediate',
      {},
      {
        runId: 'rejected-gap-plan-attempt',
        remediationRequest: { mode: 'gap-plan', projection },
      },
    );

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

  // Covers: task:11
  it('returns the same structured rejection after history files are intact, altered, or deleted', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'remediation-history-validation-'));
    const historyDirectory = join(projectRoot, '.pipeline', 'remediation-history');
    const activePath = join(historyDirectory, 'attempt.active.json');
    const resolvedPath = join(historyDirectory, 'attempt.resolved.json');
    const pending: RemediationProjection = {
      ...projection,
      source: 'as-built',
      requiredReferences: [
        {
          kind: 'as-built-finding',
          id: 'as-built:lap-11:1',
          sourceGate: 'architecture_review_as_built',
          reference: { kind: 'plan-task', taskId: '11' },
          summary: 'The finding needs a disposition.',
        },
      ],
      tasks: [{ id: '11', title: 'Owner', doneWhen: [] }],
    };
    const historyForAttempt: RemediationProjectionHistory = {
      ...history,
      active: { path: '.pipeline/remediation-history/attempt.active.json', digest: 'sha256:active' },
      resolved: { path: '.pipeline/remediation-history/attempt.resolved.json', digest: 'sha256:resolved' },
    };

    try {
      await mkdir(historyDirectory, { recursive: true });
      await writeFile(activePath, '{"original":"active"}');
      await writeFile(resolvedPath, '{"original":"resolved"}');
      const modes = ['intact', 'altered', 'deleted'] as const;
      const results = [];
      for (const mode of modes) {
        await mkdir(historyDirectory, { recursive: true });
        await writeFile(activePath, '{"original":"active"}');
        await writeFile(resolvedPath, '{"original":"resolved"}');
        const invoke = vi.fn(async (): Promise<InvokeResult> => {
          if (mode === 'altered') {
            await writeFile(activePath, '{"altered":true}');
            await writeFile(resolvedPath, '{"altered":true}');
          }
          if (mode === 'deleted') await rm(historyDirectory, { recursive: true, force: true });
          return {
            success: true,
            output: 'incomplete plan',
            exitCode: 0,
            finalStructuredResult: { version: 'v1', dispositions: [] },
          };
        });
        const result = await runnerFor('claude', invoke, true, memoryFilesystem(), projectRoot).run(
          'remediate',
          {},
          {
            remediationRequest: { mode: 'gap-plan', projection: pending, history: historyForAttempt },
          },
        );
        expect(invoke).toHaveBeenCalledOnce();
        results.push(result);
      }

      expect(results).toEqual(
        Array(3).fill(
          expect.objectContaining({
            success: false,
            output:
              'structured-result-rejected: dispositions missing required reference as-built-finding:as-built:lap-11:1',
            finalStructuredResult: undefined,
          }),
        ),
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  // Covers: task:17
  it('returns a named persistence fault and does not accept the typed plan when storage fails', async () => {
    const filesystem = memoryFilesystem();
    filesystem.writeFile = async () => {
      throw new Error('disk full');
    };
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'valid plan',
      exitCode: 0,
      finalStructuredResult: { version: 'v1', dispositions: [] },
    }));
    const runner = runnerFor('claude', invoke, true, filesystem);

    const result = await runner.run(
      'remediate',
      {},
      {
        runId: 'persistence-fault-attempt',
        remediationRequest: { mode: 'gap-plan', projection },
      },
    );

    expect(result).toMatchObject({
      success: false,
      output: expect.stringContaining('persistence-fault'),
      finalStructuredResult: undefined,
    });
    expect(result.output).toContain('disk full');
  });
});
