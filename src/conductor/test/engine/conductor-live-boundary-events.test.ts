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
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const BUILD_ONLY: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
  architecture_review: 'done', acceptance_specs: 'done', test_suite: 'done',
  build_review: 'done', wiring_check: 'done', manual_test: 'done', prd_audit: 'done',
  architecture_review_as_built: 'done', retro: 'done', rebase: 'done', finish: 'done',
  complexity_tier: 'M', track: 'technical', feature_desc: 'live-boundary-events',
} as ConductState;

const fullSuiteVerifierStub = () => ({
  ensure: vi.fn().mockResolvedValue({ status: 'REUSED', evidence: {} as never }),
  inspect: vi.fn().mockResolvedValue({ status: 'CURRENT', evidence: {} as never }),
});

describe('self-host live-boundary events', () => {
  let projectRoot: string;
  let liveCheckout: string;
  let providerHome: string;
  let fakeBin: string;
  let priorConfigDir: string | undefined;
  let priorPath: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'conductor-live-boundary-events-'));
    liveCheckout = await mkdtemp(join(tmpdir(), 'conductor-live-checkout-'));
    providerHome = await mkdtemp(join(tmpdir(), 'conductor-live-provider-'));
    fakeBin = await mkdtemp(join(tmpdir(), 'conductor-live-bin-'));
    await Promise.all([mkdir(join(projectRoot, '.pipeline'), { recursive: true }), mkdir(join(liveCheckout, '.claude'))]);
    await writeFile(join(liveCheckout, 'VERSION'), '0.1.0\n');
    await writeFile(join(liveCheckout, '.claude', 'settings.local.json'), '{}\n');
    await writeFile(join(fakeBin, 'bwrap'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "--" ]; then shift; exec "$@"; fi; shift; done\nexit 2\n', { mode: 0o755 });
    priorConfigDir = process.env.CLAUDE_CONFIG_DIR;
    priorPath = process.env.PATH;
    process.env.CLAUDE_CONFIG_DIR = providerHome;
    process.env.PATH = `${fakeBin}${delimiter}${priorPath ?? ''}`;
    await writeState(join(projectRoot, 'conduct-state.json'), BUILD_ONLY);
  });

  afterEach(async () => {
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    await chmod(liveCheckout, 0o755).catch(() => {});
    await Promise.all([projectRoot, liveCheckout, providerHome, fakeBin].map(root => rm(root, { recursive: true, force: true })));
  });

  function harness(work: () => Promise<StepRunResult>) {
    const runtimes = new ProviderRuntimeSet([{ key: 'claude', provider: { invoke: vi.fn(), invokeInteractive: vi.fn(async () => {}) }, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }] as never);
    const providerExecution: ProviderExecutionContext = { runtimes, sessions: {} as never, configuredProviders: ['claude'] };
    const runner: StepRunner = { run: async (step: StepName) => {
      const prepared = await providerExecution.prepareCandidateSelfHost?.({ step, providerKey: 'claude', model: 'opus', effort: 'high' } as never, runtimes.get('claude') as never, { runId: 'live-boundary-events', attempt: 1 });
      if (!prepared) throw new Error('self-host candidate preparation was not installed');
      try { return await work(); } finally { await prepared.teardown(); }
    } };
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: vi.fn(async () => liveCheckout), resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: liveCheckout })), relink: vi.fn(async () => {}),
      provisionSandbox: vi.fn(async () => ({ configDir: join(projectRoot, '.pipeline', 'sandbox'), childEnv: () => ({}), teardown: vi.fn(async () => {}) })) as never,
      versionGate: vi.fn(async () => ({ ok: true as const })), releaseGate: vi.fn(async () => ({ ok: true as const })),
    };
    return { conductor: new Conductor({ stateFilePath: join(projectRoot, 'conduct-state.json'), stepRunner: runner, events, projectRoot, fromStep: 'build', mode: 'auto', daemon: true, selfHost: true, verifyArtifacts: false, maxRetries: 1, baseBranch: 'main', selfHostGuardrails: guardrails, escalateBuildFailure: async () => ({}), providerExecution, fullSuiteVerifier: fullSuiteVerifierStub(), sleepFn: vi.fn(async () => {}), config: { harness_self_host: { build_auth: { mode: 'api-key' } } } as never }), persister };
  }

  async function events() { return (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }

  it('persists one contained-drift record and one contained verdict after concurrent operator drift', async () => {
    await chmod(liveCheckout, 0o555);
    const { conductor, persister } = harness(async () => {
      await chmod(liveCheckout, 0o755);
      await writeFile(join(liveCheckout, '.claude', 'settings.local.json'), '{"operator":true}\n');
      return { success: true, output: 'done' };
    });
    await conductor.run(); persister.stop();
    const recorded = await events();
    expect(recorded.filter(event => event.type === 'contained_live_checkout_drift')).toEqual([expect.objectContaining({ evidence: expect.any(String), attribution: 'concurrent-operator', summary: expect.stringContaining('changed .claude/settings.local.json') })]);
    expect(recorded.filter(event => event.type === 'self_host_containment_verdict')).toEqual([expect.objectContaining({ contained: true, evidence: expect.any(String) })]);
  });

  it('persists one containment verdict but no drift record when the live checkout stays clean', async () => {
    await chmod(liveCheckout, 0o555);
    const { conductor, persister } = harness(async () => ({ success: true, output: 'done' }));
    await conductor.run(); persister.stop();
    const recorded = await events();
    expect(recorded.filter(event => event.type === 'contained_live_checkout_drift')).toEqual([]);
    expect(recorded.filter(event => event.type === 'self_host_containment_verdict')).toEqual([expect.objectContaining({ contained: true, evidence: expect.any(String) })]);
  });
});
