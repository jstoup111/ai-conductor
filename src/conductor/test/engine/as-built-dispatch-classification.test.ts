// Covers: task:11, task:12, task:15
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { AS_BUILT_PROJECTION_VERSION, type AsBuiltProjection } from '../../src/engine/as-built-projection.js';
import { AS_BUILT_VERDICT_PATH } from '../../src/engine/as-built-verdict-store.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor as TestConductor } from '../test-conductor.js';

const { buildProjection } = vi.hoisted(() => ({ buildProjection: vi.fn() }));

vi.mock('../../src/engine/as-built-projection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/as-built-projection.js')>();
  return { ...actual, buildAsBuiltProjection: buildProjection };
});

const dirs: string[] = [];

const projection: AsBuiltProjection = {
  version: AS_BUILT_PROJECTION_VERSION,
  diff: { changedFiles: [{ path: 'src/example.ts', additions: 1, deletions: 0 }], hunks: ['+export const reviewed = true;'], omittedFiles: [] },
  tasks: [{ id: '11', doneWhen: ['classifications pass through'] }],
  storyCriteria: ['Story 3 negative: Given a provider fault, when dispatched, then its classification wins.'],
  policy: {
    reachability: { enabled: true, reason: 'all tiers' },
    planGap: { enabled: true, reason: 'all tiers' },
    adrCompliance: { enabled: false, reason: 'no ADRs' },
    diagramDrift: { enabled: false, reason: 'no diagrams' },
  },
  diagrams: [],
  governingAdrs: [],
  priorFindings: [],
};

afterEach(async () => {
  vi.restoreAllMocks();
  buildProjection.mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function provider(invoke: LLMProvider['invoke'], nativeOutputSchema = true): LLMProvider {
  return {
    lifecycleCapability: { synchronousSpawnPermit: true },
    ...(nativeOutputSchema ? { nativeSchemaCapability: { nativeOutputSchema: true as const } } : {}),
    invoke,
  };
}

function runner(projectDir: string, llm: LLMProvider, nativeOutputSchema = true) {
  return new DefaultStepRunner({ invoke: vi.fn() }, 'as-built-classification', projectDir, {
    mode: 'auto',
    config: { llm_provider: 'claude', steps: { architecture_review_as_built: { llm_provider: 'claude' } } },
    configuredProviders: ['claude'],
    providerRuntimes: new ProviderRuntimeSet([{
      key: 'claude',
      provider: llm,
      lifecycleCapability: { synchronousSpawnPermit: true },
      ...(nativeOutputSchema ? { nativeSchemaCapability: { nativeOutputSchema: true as const } } : {}),
      policy: CLAUDE_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
    }]),
    sessionStore: new ProviderSessionStore(),
  });
}

function mixedCandidateRunner(
  projectDir: string,
  claudeInvoke: LLMProvider['invoke'],
  codexInvoke: LLMProvider['invoke'],
) {
  return new DefaultStepRunner({ invoke: vi.fn() }, 'as-built-mixed-capability', projectDir, {
    mode: 'auto',
    config: { llm_provider: 'claude', steps: { architecture_review_as_built: { llm_provider: 'claude' } } },
    configuredProviders: ['claude', 'codex'],
    providerRuntimes: new ProviderRuntimeSet([
      {
        key: 'claude',
        provider: provider(claudeInvoke, false),
        lifecycleCapability: { synchronousSpawnPermit: true },
        policy: CLAUDE_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
      },
      {
        key: 'codex',
        provider: provider(codexInvoke),
        lifecycleCapability: { synchronousSpawnPermit: true },
        nativeSchemaCapability: { nativeOutputSchema: true as const },
        policy: CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      },
    ]),
    sessionStore: new ProviderSessionStore(),
  });
}

describe('architecture_review_as_built dispatch classification', () => {
  it('halts with a capability fault naming the provider and invokes nothing when no candidate declares native output schema', async () => {
    const projectDir = await tempDir('as-built-no-capability-');
    buildProjection.mockResolvedValue({ ok: true, projection });
    const invoke = vi.fn(async (_options: InvokeOptions): Promise<InvokeResult> => ({ success: true, output: 'must not run', exitCode: 0 }));

    const result = await runner(projectDir, provider(invoke, false), false)
      .run('architecture_review_as_built', { complexity_tier: 'M' });

    expect({
      success: result.success,
      kind: result.asBuiltFault?.kind,
      namesProvider: result.asBuiltFault?.reason.includes('[claude]'),
      namesCapability: result.asBuiltFault?.reason.includes('nativeSchemaCapability.nativeOutputSchema'),
      invokeCalls: invoke.mock.calls.length,
      projectionBuilt: buildProjection.mock.calls.length,
    }).toEqual({ success: false, kind: 'capability', namesProvider: true, namesCapability: true, invokeCalls: 0, projectionBuilt: 0 });
  });

  it('halts the selected mixed-capability provider without invocations or retries in serial and validation-group dispatch', async () => {
    buildProjection.mockResolvedValue({ ok: true, projection });
    const claudeInvoke = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'must not run', exitCode: 0 }));
    const codexInvoke = vi.fn(async (): Promise<InvokeResult> => ({ success: true, output: 'must not run', exitCode: 0 }));

    const serialDir = await tempDir('as-built-mixed-capability-serial-');
    const serialRunner = mixedCandidateRunner(serialDir, claudeInvoke, codexInvoke);
    const serialRun = vi.fn(serialRunner.run.bind(serialRunner));
    const serialEvents = new ConductorEventEmitter();
    const serialRetries: string[] = [];
    serialEvents.on('step_retry', (event) => {
      if (event.type === 'step_retry') serialRetries.push(event.step);
    });
    const serialState = Object.fromEntries(
      ALL_STEPS.slice(0, ALL_STEPS.findIndex((step) => step.name === 'finish')).map((step) => [step.name, 'done']),
    ) as ConductState;
    await writeState(join(serialDir, 'conduct-state.json'), {
      ...serialState,
      complexity_tier: 'L',
      build_review: 'skipped',
      manual_test: 'skipped',
      prd_audit: 'skipped',
      architecture_review_as_built: 'pending',
      rebase: 'skipped',
    });
    await new TestConductor({
      projectRoot: serialDir,
      stateFilePath: join(serialDir, 'conduct-state.json'),
      stepRunner: { run: serialRun },
      events: serialEvents,
      fromStep: 'architecture_review_as_built',
      mode: 'interactive',
      maxRetries: 3,
      onCheckpoint: async () => 'continue',
    }).run();

    const groupDir = await tempDir('as-built-mixed-capability-group-');
    const groupRunner = mixedCandidateRunner(groupDir, claudeInvoke, codexInvoke);
    const groupRun = vi.fn(groupRunner.run.bind(groupRunner));
    const groupEvents = new ConductorEventEmitter();
    const groupRetries: string[] = [];
    groupEvents.on('step_retry', (event) => {
      if (event.type === 'step_retry') groupRetries.push(event.step);
    });
    await writeState(join(groupDir, 'conduct-state.json'), {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
      architecture_review: 'done', acceptance_specs: 'done', build: 'done', build_review: 'done',
      test_suite: 'done', rebase: 'done', finish: 'done',
    } as ConductState);
    await new TestConductor({
      projectRoot: groupDir,
      stateFilePath: join(groupDir, 'conduct-state.json'),
      stepRunner: { run: groupRun },
      events: groupEvents,
      fromStep: 'manual_test',
      mode: 'auto',
      maxRetries: 3,
      providerExecution: {
        runtimes: (groupRunner as unknown as { providerRuntimes: ProviderRuntimeSet }).providerRuntimes,
        sessions: {} as never,
        configuredProviders: ['claude', 'codex'],
      },
    }).run();

    const expected = {
      calls: 1,
      retries: [],
      providerCalls: 0,
    };
    expect({
      calls: serialRun.mock.calls.filter(([step]) => step === 'architecture_review_as_built').length,
      retries: serialRetries,
      providerCalls: claudeInvoke.mock.calls.length + codexInvoke.mock.calls.length,
    }).toEqual(expected);
    expect({
      calls: groupRun.mock.calls.filter(([step]) => step === 'architecture_review_as_built').length,
      retries: groupRetries,
      providerCalls: claudeInvoke.mock.calls.length + codexInvoke.mock.calls.length,
    }).toEqual(expected);
    const serialResult = serialRun.mock.results.find((_result, index) => serialRun.mock.calls[index]?.[0] === 'architecture_review_as_built');
    const groupResult = groupRun.mock.results.find((_result, index) => groupRun.mock.calls[index]?.[0] === 'architecture_review_as_built');
    await expect(serialResult?.value).resolves.toMatchObject({
      success: false,
      asBuiltFault: {
        kind: 'capability',
        reason: expect.stringMatching(/selected provider \[claude\].*nativeSchemaCapability\.nativeOutputSchema/),
      },
    });
    await expect(groupResult?.value).resolves.toMatchObject({
      success: false,
      asBuiltFault: {
        kind: 'capability',
        reason: expect.stringMatching(/selected provider \[claude\].*nativeSchemaCapability\.nativeOutputSchema/),
      },
    });
    await expect(serialResult?.value).resolves.toMatchObject({ output: expect.not.stringContaining('structured-result-missing') });
    await expect(groupResult?.value).resolves.toMatchObject({ output: expect.not.stringContaining('structured-result-missing') });
  });

  it.each([
    ['authFailure', { authFailure: true }, { authFailure: true }],
    ['rateLimited', { rateLimited: true, waitSeconds: 42 }, { rateLimited: true, waitSeconds: 42 }],
    ['commandUnresolved', { commandUnresolved: true, commandUnresolvedName: 'architecture-review' }, { commandUnresolved: true, commandUnresolvedName: 'architecture-review' }],
  ] as const)('passes the provider %s classification through instead of a structured-result diagnostic', async (_name, flags, expected) => {
    const projectDir = await tempDir('as-built-classification-');
    buildProjection.mockResolvedValue({ ok: true, projection });
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({ success: false, output: 'provider fault', exitCode: 1, ...flags }));

    const result = await runner(projectDir, provider(invoke)).run('architecture_review_as_built', { complexity_tier: 'M' });

    expect(result).toMatchObject({ success: false, ...expected });
    expect(result.output ?? '').not.toMatch(/structured-result-(missing|rejected)/);
    await expect(access(join(projectDir, AS_BUILT_VERDICT_PATH))).rejects.toThrow();
  });

  it('rejects a contract-violating structured result naming the field and persists no verdict', async () => {
    const projectDir = await tempDir('as-built-rejected-');
    buildProjection.mockResolvedValue({ ok: true, projection });
    const invoke = vi.fn(async (): Promise<InvokeResult> => ({
      success: true,
      output: 'review complete',
      exitCode: 0,
      finalStructuredResult: { version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [], findings: [] },
    }));

    const result = await runner(projectDir, provider(invoke)).run(
      'architecture_review_as_built', { complexity_tier: 'M' }, { runId: 'rejected-attempt' },
    );

    expect({ success: result.success, output: result.output?.startsWith('structured-result-rejected: findings') }).toEqual({
      success: false,
      output: true,
    });
    await expect(access(join(projectDir, AS_BUILT_VERDICT_PATH))).rejects.toThrow();
  });

  it('scores a rejected attempt absent and records the rejection outcome with its field in the handshake', async () => {
    const projectDir = await tempDir('as-built-rejected-handshake-');
    const conductor = new Conductor({
      projectRoot: projectDir,
      stateFilePath: join(projectDir, '.pipeline', 'state.json'),
      stepRunner: { run: vi.fn() } as never,
      events: new ConductorEventEmitter(),
    });
    const handshake = (conductor as unknown as {
      verdictDispatchHandshake: (step: StepName, runId: string, startedAt: number, dispatchOutput?: string) => Promise<unknown>;
    }).verdictDispatchHandshake;

    const rejection = 'structured-result-rejected: findings: not permitted for verdict APPROVED';
    await expect(handshake.call(conductor, 'architecture_review_as_built', 'rejected-attempt', Date.now(), rejection))
      .resolves.toEqual({
        done: false,
        routeClass: 'absent',
        retrySignal: 'structured-result-rejected',
        reason: rejection,
      });
  });
});
