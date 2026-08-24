/**
 * #905 acceptance seam for self-host selection. This drives a real Conductor
 * with inert process boundaries: no Codex binary, credentials, or sandbox are
 * touched while proving that provider-specific preparation stays isolated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { Conductor } from '../test-conductor.js';

vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('../../src/engine/self-host/build-auth-preflight.js', () => ({
  preflightBuildAuthCheck: vi.fn(),
}));

const DONE_TO_BUILD: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
  architecture_review: 'done', acceptance_specs: 'done', complexity_tier: 'M',
  track: 'technical', feature_desc: 'codex-self-host-acceptance',
} as ConductState;

async function seedFreshAsBuiltEvidence(projectRoot: string): Promise<void> {
  const pipeline = join(projectRoot, '.pipeline');
  await mkdir(pipeline, { recursive: true });
  const report = join(pipeline, 'architecture-review-as-built.md');
  await writeFile(report, 'Verdict: APPROVED\n', 'utf-8');
  const future = new Date(Date.now() + 60_000);
  await utimes(report, future, future);
}

function fullSuiteVerifierStub() {
  return {
    ensure: vi.fn().mockResolvedValue({ status: 'REUSED', evidence: {} as never }),
    inspect: vi.fn().mockResolvedValue({ status: 'CURRENT', evidence: {} as never }),
  };
}

describe('acceptance: Codex self-host provider isolation (#905)', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'codex-self-host-'));
    stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeState(stateFilePath, DONE_TO_BUILD);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('selects Codex before setup and skips Claude collaborators', async () => {
    await writeState(stateFilePath, {
      ...DONE_TO_BUILD,
      build_review: 'done',
      wiring_check: 'done',
      test_suite: 'done',
      manual_test: 'done',
      prd_audit: 'done',
      architecture_review_as_built: 'done',
      retro: 'skipped',
      rebase: 'done',
      finish: 'done',
    } as ConductState);
    await seedFreshAsBuiltEvidence(projectRoot);
    const relink = vi.fn(async () => {});
    const provisionSandbox = vi.fn(async () => ({
      configDir: '/tmp/should-not-exist', childEnv: () => ({}), teardown: vi.fn(async () => {}),
    }));
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: vi.fn(async () => '/installed/harness'),
      resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: '/installed/harness' })),
      relink, provisionSandbox,
      versionGate: vi.fn().mockResolvedValue({ ok: true }),
      releaseGate: vi.fn().mockResolvedValue({ ok: true }),
    };
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'finish') {
          await writeFile(join(projectRoot, '.pipeline/finish-choice'), 'keep\n', 'utf-8');
        }
        return { success: true };
      }),
    };

    await new Conductor({
      stateFilePath, stepRunner: runner, events: new ConductorEventEmitter(), projectRoot,
      mode: 'auto', daemon: true, selfHost: true, baseBranch: 'main', fromStep: 'build',
      selfHostGuardrails: guardrails, escalateBuildFailure: async () => ({}),
      fullSuiteVerifier: fullSuiteVerifierStub(),
      config: {
        harness_self_host: { build_auth: { mode: 'api-key' } },
        steps: {
          build: { llm_provider: 'codex' },
          manual_test: { disable: true },
          prd_audit: { disable: true },
        },
      } as never,
    }).run();

    const { preflightBuildAuthCheck } = await import('../../src/engine/self-host/build-auth-preflight.js');
    expect(relink).not.toHaveBeenCalled();
    expect(provisionSandbox).not.toHaveBeenCalled();
    expect(preflightBuildAuthCheck).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith('build', expect.anything(), expect.anything());
  });

  it('runs common release gates at the self-host finish boundary', async () => {
    const finishState = {
      ...DONE_TO_BUILD,
      build: 'done',
      wiring_check: 'done',
      build_review: 'done',
      test_suite: 'done',
      manual_test: 'done',
      prd_audit: 'done',
      architecture_review_as_built: 'done',
      rebase: 'done',
      finish: 'pending',
    } as ConductState;
    await writeState(stateFilePath, finishState as ConductState);
    await seedFreshAsBuiltEvidence(projectRoot);
    const versionGate = vi.fn(async () => ({ ok: true as const }));
    const releaseGate = vi.fn(async () => ({ ok: true as const }));
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: vi.fn(async () => '/installed/harness'),
      resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: '/installed/harness' })),
      relink: vi.fn(async () => {}),
      provisionSandbox: vi.fn(async () => ({
        configDir: '/tmp/should-not-exist', childEnv: () => ({}), teardown: vi.fn(async () => {}),
      })),
      versionGate, releaseGate,
    };
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'finish') {
          await writeFile(join(projectRoot, '.pipeline/finish-choice'), 'keep\n', 'utf-8');
        }
        return { success: true };
      }),
    };

    await new Conductor({
      stateFilePath, stepRunner: runner, events: new ConductorEventEmitter(), projectRoot,
      mode: 'auto', daemon: true, selfHost: true, baseBranch: 'main', fromStep: 'finish',
      selfHostGuardrails: guardrails,
      fullSuiteVerifier: fullSuiteVerifierStub(),
      config: {
        steps: {
          manual_test: { disable: true },
          prd_audit: { disable: true },
        },
      } as never,
    }).run();

    expect(versionGate).toHaveBeenCalledOnce();
    expect(releaseGate).toHaveBeenCalledOnce();
    expect(runner.run).toHaveBeenCalledWith('finish', expect.anything(), expect.anything());
  });

  it.each(['pre-dispatch missing', 'post-dispatch rejection'] as const)(
    'parks and resumes Codex after %s without provider fallback or generic retry-rung metadata',
    async (failure) => {
      await writeState(stateFilePath, {
        ...DONE_TO_BUILD,
        build_review: 'done',
        wiring_check: 'done',
        test_suite: 'done',
        manual_test: 'done',
        prd_audit: 'done',
        architecture_review_as_built: 'done',
        retro: 'skipped',
        rebase: 'done',
        finish: 'done',
      } as ConductState);
      const readiness = vi
        .fn()
        .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'missing' })
        .mockResolvedValueOnce({ provider: 'codex', source: 'cached-login', state: 'ready' });
      const runtimes = new ProviderRuntimeSet([{
        key: 'codex',
        provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}), readiness },
        policy: CODEX_MODEL_POLICY, builtIn: true,
        availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
      }]);
      const buildCalls: Array<{ retryReason?: string; attempt?: number } | undefined> = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions): Promise<StepRunResult> => {
          if (step !== 'build') return { success: true };
          buildCalls.push(options);
          if (buildCalls.length === 1) {
            return {
              success: false, authFailure: true, actualProvider: 'codex',
              authentication: { provider: 'codex', source: 'cached-login', state: failure.startsWith('pre-') ? 'missing' : 'unusable' },
            };
          }
          return { success: true, actualProvider: 'codex' };
        }),
      };

      await new Conductor({
        stateFilePath, stepRunner: runner, events: new ConductorEventEmitter(), projectRoot,
        mode: 'auto', daemon: true, selfHost: true, fromStep: 'build', maxRetries: 1, sleepFn: vi.fn(async () => {}),
        config: {
          harness_self_host: {
            auth_park_timeout_minutes: 1,
            build_auth: { mode: 'api-key' },
          },
          steps: { build: { llm_provider: 'codex' } },
        } as never,
        providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
      }).run();

      expect(readiness).toHaveBeenCalledTimes(2);
      expect(buildCalls).toHaveLength(2);
      expect(buildCalls.map((options) => options?.attempt)).toEqual([undefined, undefined]);
      expect(vi.mocked(runner.run).mock.calls.filter(([step]) => step === 'build')).toHaveLength(2);
    },
  );
});
