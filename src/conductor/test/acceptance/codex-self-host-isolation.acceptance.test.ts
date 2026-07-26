/**
 * #905 acceptance seam for self-host selection. This drives a real Conductor
 * with inert process boundaries: no Codex binary, credentials, or sandbox are
 * touched while proving that provider-specific preparation stays isolated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';

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
    const relink = vi.fn(async () => {});
    const provisionSandbox = vi.fn(async () => ({
      configDir: '/tmp/should-not-exist', childEnv: () => ({}), teardown: vi.fn(async () => {}),
    }));
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: vi.fn(async () => '/installed/harness'),
      resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: '/installed/harness' })),
      relink, provisionSandbox,
    };
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };

    await new Conductor({
      stateFilePath, stepRunner: runner, events: new ConductorEventEmitter(), projectRoot,
      mode: 'auto', daemon: true, selfHost: true, baseBranch: 'main', fromStep: 'build',
      selfHostGuardrails: guardrails, escalateBuildFailure: async () => ({}),
      config: { steps: { build: { llm_provider: 'codex' } } } as never,
    }).run();

    const { preflightBuildAuthCheck } = await import('../../src/engine/self-host/build-auth-preflight.js');
    expect(relink).not.toHaveBeenCalled();
    expect(provisionSandbox).not.toHaveBeenCalled();
    expect(preflightBuildAuthCheck).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith('build', expect.anything(), expect.anything());
  });

  it('runs common release gates at the self-host finish boundary', async () => {
    await writeState(stateFilePath, { ...DONE_TO_BUILD, rebase: 'done' } as ConductState);
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
    const runner: StepRunner = { run: vi.fn(async () => ({ success: true })) };

    await new Conductor({
      stateFilePath, stepRunner: runner, events: new ConductorEventEmitter(), projectRoot,
      mode: 'auto', daemon: true, selfHost: true, baseBranch: 'main', fromStep: 'finish',
      selfHostGuardrails: guardrails,
    }).run();

    expect(versionGate).toHaveBeenCalledOnce();
    expect(releaseGate).toHaveBeenCalledOnce();
    expect(runner.run).toHaveBeenCalledWith('finish', expect.anything(), expect.anything());
  });

  it.each(['pre-dispatch missing', 'post-dispatch rejection'] as const)(
    'parks and resumes Codex after %s without provider fallback or generic retry-rung metadata',
    async (failure) => {
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
        run: vi.fn(async (step, _state, options) => {
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
          harness_self_host: { auth_park_timeout_minutes: 1 },
          steps: { build: { llm_provider: 'codex' } },
        } as never,
        providerExecution: { runtimes, sessions: {} as never, configuredProviders: ['codex'] },
      }).run();

      expect(readiness).toHaveBeenCalledTimes(2);
      expect(buildCalls).toHaveLength(4);
      expect(buildCalls.map((options) => options?.attempt)).toEqual([undefined, undefined, undefined, undefined]);
      expect(vi.mocked(runner.run).mock.calls.filter(([step]) => step === 'build')).toHaveLength(4);
    },
  );
});
