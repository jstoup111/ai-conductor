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
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { StepName } from '../../src/engine/types.js';

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
    nativeSchemaCapability: { nativeOutputSchema },
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
      nativeSchemaCapability: { nativeOutputSchema },
      policy: CLAUDE_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
    }]),
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
