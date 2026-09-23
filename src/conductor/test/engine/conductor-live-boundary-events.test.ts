// Covers: task:6, task:7
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
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import * as liveBoundary from '../../src/engine/self-host/live-boundary.js';

const BUILD_ONLY: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
  architecture_review: 'done', acceptance_specs: 'done', test_suite: 'done',
  build_review: 'done', manual_test: 'done', prd_audit: 'done',
  architecture_review_as_built: 'done', rebase: 'done', finish: 'done',
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
    vi.restoreAllMocks();
    if (priorConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = priorConfigDir;
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    await chmod(liveCheckout, 0o755).catch(() => {});
    await Promise.all([projectRoot, liveCheckout, providerHome, fakeBin].map(root => rm(root, { recursive: true, force: true })));
  });

  let lastPrepared: { originalCatalogHome?: string; env: NodeJS.ProcessEnv } | undefined;
  function harness(work: () => Promise<StepRunResult>, options: { selfHost?: boolean; maxRetries?: number; candidateAttempts?: number } = {}) {
    const runtimes = new ProviderRuntimeSet([{ key: 'claude', provider: { invoke: vi.fn(), }, policy: CLAUDE_MODEL_POLICY, builtIn: true, availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder) }] as never);
    const providerExecution: ProviderExecutionContext = { runtimes, sessions: {} as never, configuredProviders: ['claude'] };
    const runner: StepRunner = { run: async (step: StepName) => {
      if (options.selfHost === false) return work();
      const candidateAttempts = options.candidateAttempts ?? 1;
      for (let attempt = 1; attempt <= candidateAttempts; attempt += 1) {
        const prepared = await providerExecution.prepareCandidateSelfHost?.({ step, providerKey: 'claude', model: 'opus', effort: 'high' } as never, runtimes.get('claude') as never, { runId: 'live-boundary-events', attempt });
        if (!prepared) throw new Error('self-host candidate preparation was not installed');
        lastPrepared = prepared;
        try {
          const result = await work();
          if (result.success || attempt === candidateAttempts) return result;
        } finally { await prepared.teardown(); }
      }
      throw new Error('candidate preparation did not run');
    } };
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const guardrails: SelfHostGuardrails = {
      resolveHarnessRoot: vi.fn(async () => liveCheckout), resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok' as const, root: liveCheckout })), relink: vi.fn(async () => {}),
      provisionSandbox: vi.fn(async () => ({ configDir: join(projectRoot, '.pipeline', 'sandbox'), childEnv: () => ({}), teardown: vi.fn(async () => {}) })) as never,
      versionGate: vi.fn(async () => ({ ok: true as const })), releaseGate: vi.fn(async () => ({ ok: true as const })),
    };
    return { conductor: new Conductor({ stateFilePath: join(projectRoot, 'conduct-state.json'), stepRunner: runner, events, projectRoot, fromStep: 'build', mode: 'auto', daemon: true, selfHost: options.selfHost ?? true, verifyArtifacts: false, maxRetries: options.maxRetries ?? 1, baseBranch: 'main', selfHostGuardrails: guardrails, escalateBuildFailure: async () => ({}), providerExecution, fullSuiteVerifier: fullSuiteVerifierStub(), sleepFn: vi.fn(async () => {}), config: { harness_self_host: { build_auth: { mode: 'api-key' } } } as never }), eventEmitter: events, persister };
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

  it('emits and persists one completed fingerprint before the provider is invoked', async () => {
    const emitted: Extract<ConductorEvent, { type: 'self_host_boundary_fingerprint' }>[] = [];
    const { conductor, eventEmitter, persister } = harness(async () => {
      expect(emitted).toHaveLength(1);
      return { success: true, output: 'done' };
    });
    eventEmitter.on('self_host_boundary_fingerprint', (event) => {
      if (event.type === 'self_host_boundary_fingerprint') emitted.push(event);
    });

    await conductor.run();
    persister.stop();

    expect(emitted).toEqual([
      expect.objectContaining({
        surfaces: expect.arrayContaining([
          expect.objectContaining({ label: 'live checkout', elapsedMs: expect.any(Number), fileCount: expect.any(Number) }),
          expect.objectContaining({ label: 'provider state', elapsedMs: expect.any(Number), fileCount: expect.any(Number) }),
        ]),
      }),
    ]);
    for (const surface of emitted[0].surfaces) {
      expect(Number.isInteger(surface.elapsedMs)).toBe(true);
      expect(Number.isInteger(surface.fileCount)).toBe(true);
    }
    expect((await events()).filter(event => event.type === 'self_host_boundary_fingerprint'))
      .toEqual([expect.objectContaining({ type: emitted[0].type, surfaces: emitted[0].surfaces })]);
  });

  it('emits no fingerprint for a non-self-host dispatch', async () => {
    const emitted: ConductorEvent[] = [];
    const { conductor, eventEmitter, persister } = harness(async () => ({ success: true, output: 'done' }), { selfHost: false });
    eventEmitter.on('self_host_boundary_fingerprint', (event) => { emitted.push(event); });

    await conductor.run();
    persister.stop();

    expect(emitted).toEqual([]);
    expect((await events()).filter(event => event.type === 'self_host_boundary_fingerprint')).toEqual([]);
  });

  it('emits no fingerprint and does not invoke the provider when fingerprinting fails', async () => {
    const failure = new Error('fingerprint unavailable');
    const provider = vi.fn(async (): Promise<StepRunResult> => ({ success: true, output: 'done' }));
    const emitted: ConductorEvent[] = [];
    const failedSteps: ConductorEvent[] = [];
    vi.spyOn(liveBoundary, 'fingerprintLiveBoundary').mockRejectedValue(failure);
    const { conductor, eventEmitter, persister } = harness(provider, { maxRetries: 0 });
    eventEmitter.on('self_host_boundary_fingerprint', (event) => { emitted.push(event); });
    eventEmitter.on('step_failed', (event) => { failedSteps.push(event); });

    await conductor.run();
    persister.stop();

    expect(provider).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(failedSteps).toEqual([expect.objectContaining({ step: 'build', retryCount: 0, error: '' })]);
    expect((await events()).filter(event => event.type === 'self_host_boundary_fingerprint')).toEqual([]);
  });

  it('isolates a throwing fingerprint subscriber so the provider and containment verdict continue', async () => {
    const containment: ConductorEvent[] = [];
    const provider = vi.fn(async (): Promise<StepRunResult> => ({ success: true, output: 'done' }));
    const { conductor, eventEmitter, persister } = harness(provider);
    eventEmitter.on('self_host_boundary_fingerprint', () => { throw new Error('subscriber failed'); });
    eventEmitter.on('self_host_containment_verdict', (event) => { containment.push(event); });

    await conductor.run();
    persister.stop();

    expect(provider).toHaveBeenCalledOnce();
    expect(containment).toHaveLength(1);
  });

  it('emits one fingerprint for each completed candidate preparation across a retry', async () => {
    const emitted: ConductorEvent[] = [];
    let attempts = 0;
    const { conductor, eventEmitter, persister } = harness(async () => {
      attempts += 1;
      return attempts === 1 ? { success: false, output: 'first candidate failed' } : { success: true, output: 'done' };
    }, { candidateAttempts: 2 });
    eventEmitter.on('self_host_boundary_fingerprint', (event) => { emitted.push(event); });

    await conductor.run();
    persister.stop();

    expect(attempts).toBe(2);
    expect(emitted).toHaveLength(2);
    expect((await events()).filter(event => event.type === 'self_host_boundary_fingerprint')).toHaveLength(2);
  });

  it('maps the original provider catalog home onto the prepared candidate explicitly', async () => {
    const { conductor, persister } = harness(async () => ({ success: true, output: 'done' }));
    await conductor.run(); persister.stop();
    // The prepared env replaces the home; installed global/plugin discovery
    // needs the original root named by preparation, not guessed afterwards.
    expect(lastPrepared?.originalCatalogHome).toBe(providerHome);
    expect(lastPrepared?.env.CLAUDE_CONFIG_DIR).not.toBe(providerHome);
  });
});
