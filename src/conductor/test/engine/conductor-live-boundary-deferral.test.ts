/**
 * Self-host live-boundary enforcement point.
 *
 * The boundary fingerprint is captured when a provider candidate is prepared
 * and re-verified in that candidate's teardown — a window that spans the WHOLE
 * dispatch. Any concurrent change to the live checkout or the operator's
 * provider home (an unrelated interactive session, a credential refresh, an
 * operator repairing a stale auth override) therefore lands while a step is
 * already in flight.
 *
 * Throwing from teardown discarded the completed dispatch's result — a throw
 * inside the `finally` that calls teardown replaces the invocation's return
 * value — so a step that had genuinely succeeded was reported `failed` and its
 * (expensive) work was redone on re-kick. Detection is unchanged; only the
 * ENFORCEMENT POINT moves to the next dispatch boundary.
 *
 * These specs drive a real `Conductor` over real temporary directories, with
 * the provider CLI itself as the only fake. The fake reproduces the exact
 * two-layer contract of the production path it stands in for:
 *   provider-execution.ts  `try { invoke() } finally { selfHost.teardown() }`
 *   step-runners.ts        `catch (error) → { success: false, output: 'Session
 *                          for <step> exited with error: …' }`
 * so a teardown that throws is observed here exactly as it is in production.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState, readState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';

/** Everything except `build` pre-resolved: the run dispatches `build`, then converges. */
const BUILD_ONLY: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
  architecture_review: 'done', acceptance_specs: 'done', test_suite: 'done',
  build_review: 'done', wiring_check: 'done', manual_test: 'done', prd_audit: 'done',
  architecture_review_as_built: 'done', retro: 'done', rebase: 'done', finish: 'done',
  complexity_tier: 'M', track: 'technical', feature_desc: 'live-boundary-deferral',
} as ConductState;

// Asserted verbatim: the differing path must survive all the way to the
// `loop_halt` event and the HALT marker, since that is what an operator reads
// in daemon.log instead of re-deriving the diff by hand.
const BOUNDARY_REASON =
  'provider state changed during self-host execution — 0 added, 0 removed, 1 changed: changed settings.json.';

function fullSuiteVerifierStub() {
  return {
    ensure: vi.fn().mockResolvedValue({ status: 'REUSED', evidence: {} as never }),
    inspect: vi.fn().mockResolvedValue({ status: 'CURRENT', evidence: {} as never }),
  };
}

describe('self-host live boundary: violations are enforced at the next dispatch', () => {
  let projectRoot: string;
  let liveCheckout: string;
  let providerHome: string;
  let statePath: string;
  let priorConfigDir: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'live-boundary-root-'));
    liveCheckout = await mkdtemp(join(tmpdir(), 'live-boundary-checkout-'));
    providerHome = await mkdtemp(join(tmpdir(), 'live-boundary-home-'));
    statePath = join(projectRoot, 'conduct-state.json');
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    // A live harness checkout the build must not touch, and an operator
    // provider home whose non-volatile config IS fingerprinted.
    await writeFile(join(liveCheckout, 'VERSION'), '0.1.0\n', 'utf-8');
    await writeFile(join(providerHome, 'settings.json'), '{"permissions":{}}\n', 'utf-8');
    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = providerHome;
    await writeState(statePath, BUILD_ONLY);
  });

  afterEach(async () => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
    await rm(liveCheckout, { recursive: true, force: true }).catch(() => {});
    await rm(providerHome, { recursive: true, force: true }).catch(() => {});
  });

  /**
   * Build the Conductor plus the faithful provider fake. `work` stands in for
   * the provider CLI invocation: whatever it does to the operator's provider
   * home happens strictly between the boundary fingerprint (candidate prepare)
   * and its verification (candidate teardown) — i.e. mid-flight.
   */
  function harness(
    work: (step: StepName, dispatch: number) => Promise<StepRunResult>,
    opts: { maxRetries?: number } = {},
  ) {
    const dispatches: StepName[] = [];
    const runtimes = new ProviderRuntimeSet([{
      key: 'claude',
      provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}) },
      policy: CLAUDE_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
    }] as never);
    const providerExecution: ProviderExecutionContext = {
      runtimes,
      sessions: {} as never,
      configuredProviders: ['claude'],
    };

    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        dispatches.push(step);
        const prepare = providerExecution.prepareCandidateSelfHost;
        if (!prepare) throw new Error('self-host candidate preparation was not installed');
        const selfHost = await prepare(
          { step, providerKey: 'claude', model: 'opus', effort: 'high' } as never,
          runtimes.get('claude') as never,
        );
        // Layer 1 — provider-execution.ts: teardown runs in a `finally`, so a
        // throw there discards the invocation's own result.
        // Layer 2 — step-runners.ts: any escaped throw becomes a failed step.
        try {
          try {
            return await work(step, dispatches.length);
          } finally {
            await selfHost?.teardown();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { success: false, output: `Session for ${step} exited with error: ${message}` };
        }
      },
    };

    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: vi.fn(async () => liveCheckout),
      resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: liveCheckout })),
      relink: vi.fn(async () => {}),
      provisionSandbox: vi.fn(async () => ({
        configDir: join(projectRoot, '.pipeline', 'sandbox-config'),
        childEnv: () => ({}),
        teardown: vi.fn(async () => {}),
      })) as never,
      versionGate: vi.fn(async () => ({ ok: true as const })),
      releaseGate: vi.fn(async () => ({ ok: true as const })),
    };

    const events = new ConductorEventEmitter();
    const emitted: { type: string; reason?: string; step?: string }[] = [];
    for (const type of ['loop_halt', 'step_failed'] as const) {
      events.on(type, (event) => {
        emitted.push(event as { type: string; reason?: string; step?: string });
      });
    }

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      selfHost: true,
      verifyArtifacts: false,
      maxRetries: opts.maxRetries ?? 1,
      baseBranch: 'main',
      selfHostGuardrails: guardrails,
      escalateBuildFailure: async () => ({}),
      providerExecution,
      fullSuiteVerifier: fullSuiteVerifierStub(),
      sleepFn: vi.fn(async () => {}),
      // This fixture exercises a provider CLI fake, not daemon-token setup.
      // API-key mode intentionally skips the daemon-token preflight, keeping
      // the test's first observable boundary at candidate preparation.
      config: {
        harness_self_host: { build_auth: { mode: 'api-key' } },
      } as never,
    });

    return { conductor, dispatches, emitted };
  }

  /** Simulate an unrelated party rewriting operator provider config mid-step. */
  async function changeProviderStateMidStep(): Promise<void> {
    await writeFile(
      join(providerHome, 'settings.json'),
      '{"permissions":{"allow":["Bash(npm test:*)"]}}\n',
      'utf-8',
    );
  }

  async function haltReason(): Promise<string | null> {
    return readFile(join(projectRoot, '.pipeline/HALT'), 'utf-8').catch(() => null);
  }

  it('lets a step that completed mid-change keep its own success verdict', async () => {
    const { conductor, dispatches, emitted } = harness(async () => {
      await changeProviderStateMidStep();
      return { success: true, output: 'build complete' };
    });

    await conductor.run();

    const state = await readState(statePath);
    expect(state.ok && state.value.build).toBe('done');
    expect(dispatches).toEqual(['build']);
    expect(emitted.filter((e) => e.type === 'step_failed')).toEqual([]);
  });

  it('still halts the run, with the boundary reason and a mechanical class', async () => {
    const { conductor, emitted } = harness(async () => {
      await changeProviderStateMidStep();
      return { success: true, output: 'build complete' };
    });

    await conductor.run();

    expect(await haltReason()).toContain(BOUNDARY_REASON);
    expect(await readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf-8')).toBe('mechanical');
    expect(emitted.filter((e) => e.type === 'loop_halt').map((e) => e.reason)).toEqual([
      BOUNDARY_REASON,
    ]);
  });

  it('detects a change to the live harness checkout the same way', async () => {
    const { conductor } = harness(async () => {
      await writeFile(join(liveCheckout, 'VERSION'), '9.9.9\n', 'utf-8');
      return { success: true, output: 'build complete' };
    });

    await conductor.run();

    const state = await readState(statePath);
    expect(state.ok && state.value.build).toBe('done');
    expect(await haltReason()).toContain('live checkout changed during self-host execution — ');
    expect(await haltReason()).toContain('changed VERSION');
  });

  it('refuses the NEXT dispatch instead of continuing under a violated boundary', async () => {
    // Two steps remain. The violation happens while the FIRST is in flight, so
    // it must neither fail that step nor be swallowed: the second step is never
    // dispatched. This is what separates the fix from simply dropping the guard.
    const { finish: _finish, ...twoStepsLeft } = BUILD_ONLY as Record<string, unknown>;
    await writeState(statePath, twoStepsLeft as ConductState);
    const { conductor, dispatches, emitted } = harness(async (step) => {
      if (step === 'build') await changeProviderStateMidStep();
      return { success: true, output: `${step} complete` };
    });

    await conductor.run();

    expect(dispatches).toEqual(['build']);
    const state = await readState(statePath);
    expect(state.ok && state.value.build).toBe('done');
    expect(state.ok && state.value.finish).toBeUndefined();
    expect(emitted.filter((e) => e.type === 'loop_halt').map((e) => e.reason)).toEqual([
      BOUNDARY_REASON,
    ]);
  });

  it('still marks a step failed when the step\'s own work fails and the boundary is clean', async () => {
    const { conductor, emitted } = harness(
      async () => ({ success: false, output: 'compilation failed' }),
      { maxRetries: 1 },
    );

    await conductor.run();

    const state = await readState(statePath);
    expect(state.ok && state.value.build).toBe('failed');
    expect(emitted.filter((e) => e.type === 'step_failed').map((e) => e.step)).toEqual(['build']);
    expect(await haltReason()).not.toContain(BOUNDARY_REASON);
  });

  it('adopts the changed provider state at the next dispatch: a fresh run over it is clean', async () => {
    // The operator's mid-step edit is already on disk here, so it is what the
    // NEXT dispatch fingerprints. Nothing changes during this run.
    await changeProviderStateMidStep();
    const { conductor, dispatches, emitted } = harness(async () => ({
      success: true,
      output: 'build complete',
    }));

    await conductor.run();

    const state = await readState(statePath);
    expect(state.ok && state.value.build).toBe('done');
    expect(dispatches).toEqual(['build']);
    expect(emitted.filter((e) => e.type === 'loop_halt')).toEqual([]);
    expect(await haltReason()).toBeNull();
  });
});
