/**
 * RED acceptance coverage for jstoup111/ai-conductor#1301.
 *
 * Story-flow classification (writing-system-tests §3a):
 * - Stories 1-3 and 6 are single-operation contracts covered by Plan Tasks
 *   1-7 and 10-12 at the engine/unit and local-enforcement layers.
 * - Stories 4-5 cross candidate preparation, provider dispatch, teardown
 *   verification, and the next-dispatch halt boundary, so they are covered
 *   here through the real Conductor.run() entry point.
 *
 * Production call sites exercised:
 * - src/engine/conductor.ts: prepareCandidateSelfHost
 * - src/engine/conductor.ts: the candidate teardown verification closure
 * - src/engine/conductor.ts: the pendingLiveBoundaryHalt dispatch boundary
 *
 * The provider CLI is replaced by a faithful in-process fake. A PATH-local
 * bwrap fake executes the probe payload without creating a namespace; fixture
 * permissions supply the probe's two real observations (live root read-only,
 * worktree writable). No third-party service is called.
 *
 * Verify-claims: every asserted outcome and diagnostic is stated by accepted
 * Stories 4-5 and the approved containment ADR. No unconfirmed load-bearing
 * assumption is encoded here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const BUILD_ONLY: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
  architecture_review: 'done', acceptance_specs: 'done', test_suite: 'done',
  build_review: 'done', wiring_check: 'done', manual_test: 'done', prd_audit: 'done',
  architecture_review_as_built: 'done', retro: 'done', rebase: 'done', finish: 'done',
  complexity_tier: 'M', track: 'technical', feature_desc: 'live-boundary-containment',
} as ConductState;

function fullSuiteVerifierStub() {
  return {
    ensure: vi.fn().mockResolvedValue({ status: 'REUSED', evidence: {} as never }),
    inspect: vi.fn().mockResolvedValue({ status: 'CURRENT', evidence: {} as never }),
  };
}

describe('acceptance: self-host live-checkout containment', () => {
  let projectRoot: string;
  let liveCheckout: string;
  let providerHome: string;
  let fakeBin: string;
  let statePath: string;
  let priorConfigDir: string | undefined;
  let priorPath: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'containment-worktree-'));
    liveCheckout = await mkdtemp(join(tmpdir(), 'containment-live-'));
    providerHome = await mkdtemp(join(tmpdir(), 'containment-provider-'));
    fakeBin = await mkdtemp(join(tmpdir(), 'containment-bin-'));
    statePath = join(projectRoot, 'conduct-state.json');

    await Promise.all([
      mkdir(join(projectRoot, '.pipeline'), { recursive: true }),
      mkdir(join(liveCheckout, '.claude'), { recursive: true }),
    ]);
    await writeFile(join(liveCheckout, 'VERSION'), '0.1.0\n', 'utf8');
    await writeFile(join(liveCheckout, '.claude', 'settings.local.json'), '{}\n', 'utf8');
    await writeFile(join(providerHome, 'settings.json'), '{}\n', 'utf8');
    await writeFile(
      join(fakeBin, 'bwrap'),
      '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--" ]; then\n    shift\n    exec "$@"\n  fi\n  shift\ndone\nexit 2\n',
      { mode: 0o755 },
    );

    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    priorPath = process.env.PATH;
    process.env.CLAUDE_CONFIG_DIR = providerHome;
    process.env.PATH = `${fakeBin}${delimiter}${priorPath ?? ''}`;
    await writeState(statePath, BUILD_ONLY);
  });

  afterEach(async () => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    await chmod(liveCheckout, 0o755).catch(() => {});
    await Promise.all([projectRoot, liveCheckout, providerHome, fakeBin].map((root) =>
      rm(root, { recursive: true, force: true }).catch(() => {}),
    ));
  });

  function harness(
    work: (prepared: NonNullable<Awaited<ReturnType<NonNullable<ProviderExecutionContext['prepareCandidateSelfHost']>>>>) => Promise<StepRunResult>,
    config: Record<string, unknown> = {},
  ) {
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
        const prepare = providerExecution.prepareCandidateSelfHost;
        if (!prepare) throw new Error('self-host candidate preparation was not installed');
        const prepared = await prepare(
          { step, providerKey: 'claude', model: 'opus', effort: 'high' } as never,
          runtimes.get('claude') as never,
          { runId: 'containment-acceptance', attempt: 1 },
        );
        if (!prepared) throw new Error('self-host candidate preparation returned no command');
        try {
          return await work(prepared);
        } finally {
          await prepared.teardown();
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

    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      selfHost: true,
      verifyArtifacts: false,
      maxRetries: 1,
      baseBranch: 'main',
      selfHostGuardrails: guardrails,
      escalateBuildFailure: async () => ({}),
      providerExecution,
      fullSuiteVerifier: fullSuiteVerifierStub(),
      sleepFn: vi.fn(async () => {}),
      config: {
        harness_self_host: { build_auth: { mode: 'api-key' }, ...config },
      } as never,
    });
  }

  async function haltReason(): Promise<string | null> {
    return readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8').catch(() => null);
  }

  it('contains the real candidate path and attributes an ignored operator edit away from the dispatch', async () => {
    // The PATH-local probe executes while this root is not writable; the
    // operator edit occurs afterwards, during the simulated provider call.
    await chmod(liveCheckout, 0o555);
    let observedExecutable: string | undefined;
    let observedArgs: readonly string[] | undefined;
    const conductor = harness(async (prepared) => {
      observedExecutable = prepared.executable;
      observedArgs = prepared.args;
      await chmod(liveCheckout, 0o755);
      await writeFile(
        join(liveCheckout, '.claude', 'settings.local.json'),
        '{"permissions":{"allow":["Bash(npm test:*)"]}}\n',
        'utf8',
      );
      return { success: true, output: 'build complete' };
    });

    await conductor.run();

    expect(observedExecutable).toBe('bwrap');
    expect(observedArgs).toEqual(expect.arrayContaining(['--', 'claude']));
    expect(await haltReason()).toBeNull();
  });

  it('fails closed when containment is disabled and names that evidence in the halt', async () => {
    const conductor = harness(async (prepared) => {
      expect(prepared.executable).toBe('claude');
      await writeFile(join(liveCheckout, 'escaped.txt'), 'unattributed write\n', 'utf8');
      return { success: true, output: 'build complete' };
    }, { live_containment: false });

    await conductor.run();

    const reason = await haltReason();
    expect(reason).toContain('added escaped.txt');
    expect(reason).toContain('containment disabled by configuration');
  });
});
