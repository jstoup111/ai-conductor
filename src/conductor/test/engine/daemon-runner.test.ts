import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  makeRunFeature,
  terminateFeature,
  type FeatureRunnerDeps,
  type WorktreeOutcome,
} from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type { TriageOutcome } from '../../src/engine/setup-triage.js';
import { SetupFailureError } from '../../src/engine/worktree-prepare.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ShipmentEvidenceInput } from '../../src/engine/shipment-evidence.js';
import { renderShippedRecord, specHash } from '../../src/engine/shipped-record.js';
import { initTestRepo } from '../fixtures/git-repo.js';
import type { OperatorParkedTermination } from '../../src/engine/conductor.js';

const execFile = promisify(execFileCb);

const ITEM: BacklogItem = { slug: 'feat-x' };

interface TestRecorder {
  teardownKeep?: boolean;
  processed?: boolean;
  processedCalls?: Array<{ slug: string; prUrl?: string }>;
  cleanupCalls?: Array<{ prUrl: string }>;
  enrollCalls?: Array<{ prUrl: string; slug: string }>;
  threw?: boolean;
}

function deps(
  outcome: WorktreeOutcome,
  rec: TestRecorder = {},
  opts: { throwIn?: keyof FeatureRunnerDeps } = {},
): FeatureRunnerDeps {
  const maybeThrow = (k: keyof FeatureRunnerDeps) => {
    if (opts.throwIn === k) throw new Error(`fail in ${k}`);
  };
  // Ensure arrays are initialized
  if (!rec.processedCalls) rec.processedCalls = [];
  if (!rec.enrollCalls) rec.enrollCalls = [];
  if (!rec.cleanupCalls) rec.cleanupCalls = [];

  return {
    createWorktree: async (slug) => {
      maybeThrow('createWorktree');
      return { path: `/wt/${slug}`, branch: `feat/${slug}` };
    },
    runConductor: async () => {
      maybeThrow('runConductor');
    },
    readOutcome: async () => outcome,
    shipmentEvidence: async (_input: ShipmentEvidenceInput) => ({
      kind: 'valid',
      slug: outcome.finishChoice === 'pr' ? ITEM.slug : 'not-a-ship',
      pr: outcome.prUrl ?? '',
      recordPath: `.docs/shipped/${ITEM.slug}.md`,
      hash: 'verified',
      commit: 'verified',
    }),
    teardownWorktree: async (_wt, keep) => {
      rec.teardownKeep = keep;
    },
    markProcessed: async (slug: string, prUrl?: string) => {
      rec.processed = true;
      rec.processedCalls!.push({ slug, prUrl });
    },
    // Non-daemon path: emission never runs, so these are inert but keep the
    // deps object type-complete.
    daemon: false,
    provider: {
      invoke: async () => ({ success: true, output: '', exitCode: 0 }),
      invokeInteractive: async () => {},
    },
    project: 'test-project',
    projectRoot: '/proj',
    runGh: async () => ({ stdout: '' }),
    enrollWatch: async (projectRoot: string, entry: any) => {
      rec.enrollCalls!.push({ prUrl: entry.prUrl, slug: entry.slug });
    },
  };
}

describe('engine/daemon-runner — makeRunFeature', () => {
  it('terminateFeature with park false records an error that will re-dispatch without a park marker', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-runner-terminate-feature-'));
    const worktreePath = join(projectRoot, '.worktrees', ITEM.slug);
    try {
      await mkdir(worktreePath, { recursive: true });

      await terminateFeature({
        worktreePath,
        reason: 'runtime dispatch failure',
        park: false,
        slug: ITEM.slug,
      });

      const halt = await readFile(join(worktreePath, '.pipeline', 'HALT'), 'utf-8');
      const parkMarkerExists = await readFile(
        join(projectRoot, '.daemon', 'parked', ITEM.slug),
        'utf-8',
      ).then(() => true).catch(() => false);

      expect({
        haltFirstLine: halt.split('\n', 1)[0],
        parkMarkerExists,
      }).toEqual({
        haltFirstLine: 'feature errored — will re-dispatch on the next scan',
        parkMarkerExists: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('terminateFeature with park false preserves the human HALT class, resume procedure, and park triage evidence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-runner-terminate-feature-evidence-'));
    const withQuarantine = join(projectRoot, '.worktrees', 'with-quarantine');
    const withoutQuarantine = join(projectRoot, '.worktrees', 'without-quarantine');
    try {
      await Promise.all([
        mkdir(withQuarantine, { recursive: true }),
        mkdir(withoutQuarantine, { recursive: true }),
      ]);

      await terminateFeature({
        worktreePath: withQuarantine,
        reason: 'setup triage requires intervention',
        park: false,
        slug: 'with-quarantine',
        triageEvidence: {
          kind: 'park',
          outputTail: 'setup output tail',
          quarantineRef: 'refs/quarantine/with-quarantine',
          contractOutcome: 'dirty-tree-uncleaned',
          preservedPaths: ['src/unfinished.ts', 'docs/recovery.md'],
        } satisfies TriageOutcome,
      });
      await terminateFeature({
        worktreePath: withoutQuarantine,
        reason: 'setup triage requires intervention',
        park: false,
        slug: 'without-quarantine',
        triageEvidence: {
          kind: 'park',
          outputTail: 'clean HEAD output tail',
          contractOutcome: 'clean-head-contract-failed',
          preservedPaths: ['src/still-needed.ts'],
        } satisfies TriageOutcome,
      });

      const [withQuarantineHalt, withQuarantineClass, withoutQuarantineHalt] = await Promise.all([
        readFile(join(withQuarantine, '.pipeline', 'HALT'), 'utf-8'),
        readFile(join(withQuarantine, '.pipeline', 'HALT.class'), 'utf-8'),
        readFile(join(withoutQuarantine, '.pipeline', 'HALT'), 'utf-8'),
      ]);

      expect(withQuarantineClass).toBe('needs-human');
      expect(withQuarantineHalt).toContain('Resume procedure:');
      expect(withQuarantineHalt).toContain('setup output tail');
      expect(withQuarantineHalt).toContain('refs/quarantine/with-quarantine');
      expect(withQuarantineHalt).toContain('Contract outcome: dirty-tree-uncleaned');
      expect(withQuarantineHalt).toContain('src/unfinished.ts');
      expect(withQuarantineHalt).toContain('docs/recovery.md');
      expect(withoutQuarantineHalt).toContain('clean HEAD output tail');
      expect(withoutQuarantineHalt).toContain('No quarantine ref exists (clean-HEAD case)');
      expect(withoutQuarantineHalt).toContain('Contract outcome: clean-head-contract-failed');
      expect(withoutQuarantineHalt).toContain('src/still-needed.ts');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('classifies a boundary stop before reading markers or running terminal side effects', async () => {
    const termination: OperatorParkedTermination = {
      kind: 'operator-parked',
      boundary: { kind: 'step', name: 'build' },
    };
    const featureDeps = deps({ done: false, halted: false });
    const readOutcome = vi.fn(featureDeps.readOutcome);
    const teardownWorktree = vi.fn(featureDeps.teardownWorktree);
    const markProcessed = vi.fn(featureDeps.markProcessed);
    const shipmentEvidence = vi.fn(featureDeps.shipmentEvidence!);
    const escalateBuildFailure = vi.fn(async () => ({}));
    const cleanupHaltPresentation = vi.fn(async () => 'confirmed' as const);
    const enrollWatch = vi.fn(async () => {});
    const stop = vi.fn();
    featureDeps.daemon = true;
    featureDeps.runConductor = vi.fn(async () => termination);
    featureDeps.readOutcome = readOutcome;
    featureDeps.teardownWorktree = teardownWorktree;
    featureDeps.markProcessed = markProcessed;
    featureDeps.shipmentEvidence = shipmentEvidence;
    featureDeps.escalateBuildFailure = escalateBuildFailure;
    featureDeps.cleanupHaltPresentation = cleanupHaltPresentation;
    featureDeps.enrollWatch = enrollWatch;
    featureDeps.beginFeatureRun = () => ({
      events: new ConductorEventEmitter(),
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([]),
        sessions: new ProviderSessionStore(),
      },
      stop,
    });

    const outcome = await makeRunFeature(featureDeps)(ITEM);

    expect(outcome).toEqual({ slug: ITEM.slug, status: 'parked' });
    expect({
      readOutcome: readOutcome.mock.calls.length,
      teardownWorktree: teardownWorktree.mock.calls.length,
      markProcessed: markProcessed.mock.calls.length,
      shipmentEvidence: shipmentEvidence.mock.calls.length,
      escalateBuildFailure: escalateBuildFailure.mock.calls.length,
      cleanupHaltPresentation: cleanupHaltPresentation.mock.calls.length,
      enrollWatch: enrollWatch.mock.calls.length,
      stop: stop.mock.calls.length,
    }).toEqual({
      readOutcome: 0,
      teardownWorktree: 0,
      markProcessed: 0,
      shipmentEvidence: 0,
      escalateBuildFailure: 0,
      cleanupHaltPresentation: 0,
      enrollWatch: 0,
      stop: 1,
    });
  });

  it('routes setup, triage, and conductor execution through the feature logger', async () => {
    const featureLog = vi.fn();
    const setupFailure = new SetupFailureError('setup failed', 'diagnostic output');
    const featureDeps = deps({ done: false, halted: true, reason: 'paused' });
    featureDeps.beginFeatureRun = () => ({
      events: new ConductorEventEmitter(),
      providerExecution: {
        configuredProviders: ['claude'],
        runtimes: new ProviderRuntimeSet([]),
        sessions: new ProviderSessionStore(),
      },
      log: featureLog,
      stop: () => {},
    });
    featureDeps.prepareWorktree = async (_worktree, receivedLog) => {
      expect(receivedLog).toBe(featureLog);
      throw setupFailure;
    };
    featureDeps.runSetupTriage = async (_error, _worktree, _item, _execution, receivedLog) => {
      expect(receivedLog).toBe(featureLog);
      return { kind: 'pass', outputTail: '' };
    };
    featureDeps.runConductor = async (_worktree, _item, _execution, _events, receivedLog) => {
      expect(receivedLog).toBe(featureLog);
    };
    featureDeps.daemon = true;

    await makeRunFeature(featureDeps)({ slug: 'feature-a' });

    expect(featureLog).toHaveBeenCalledWith(
      '[daemon-runner] triage outcome: pass, continuing to runConductor',
    );
  });

  it('owns one feature event scope from pre-dispatch setup through error cleanup', async () => {
    const order: string[] = [];
    const localEvents = new ConductorEventEmitter();
    const providerExecution: ProviderExecutionContext = {
      configuredProviders: ['claude'],
      runtimes: new ProviderRuntimeSet([]),
      sessions: new ProviderSessionStore(),
      onAttempt: (step, attempt) =>
        localEvents.emit({ type: 'provider_attempt', step, ...attempt }),
    };
    const featureDeps = deps({ done: false, halted: false });
    const worktree = { path: '/wt/feature-a', branch: 'feat/feature-a' };
    featureDeps.createWorktree = async () => {
      order.push('create');
      return worktree;
    };
    featureDeps.prepareWorktree = async () => {
      order.push('prepare');
    };
    featureDeps.teardownWorktree = async () => {
      order.push('teardown');
    };
    let receivedEvents: ConductorEventEmitter | undefined;
    let receivedProviderExecution: ProviderExecutionContext | undefined;
    let beginArgs:
      | { worktree: typeof worktree; item: BacklogItem }
      | undefined;
    featureDeps.runConductor = async (
      _worktree,
      _item,
      execution,
      events,
    ) => {
      order.push('dispatch');
      receivedProviderExecution = execution;
      receivedEvents = events;
      await execution?.onAttempt?.('build', {
        provider: 'claude',
        outcome: 'success',
        invoked: true,
      });
      throw new Error('dispatch failed');
    };
    const stop = vi.fn(() => {
      order.push('stop');
    });
    (
      featureDeps as FeatureRunnerDeps & {
        beginFeatureRun?: (
          wt: typeof worktree,
          item: BacklogItem,
        ) => Promise<{
          events: ConductorEventEmitter;
          providerExecution: ProviderExecutionContext;
          stop: () => void;
        }>;
      }
    ).beginFeatureRun = async (receivedWorktree, item) => {
      beginArgs = { worktree: receivedWorktree, item };
      order.push(`begin:${receivedWorktree.path}:${item.slug}`);
      return { events: localEvents, providerExecution, stop };
    };
    const attempts: string[] = [];
    localEvents.on('provider_attempt', (event) => {
      if (event.type === 'provider_attempt') attempts.push(event.provider);
    });

    const outcome = await makeRunFeature(featureDeps)({ slug: 'feature-a' });

    expect({
      order,
      outcome,
      receivedEvents,
      receivedProviderExecution,
      beginArgs,
      attempts,
      stopCalls: stop.mock.calls.length,
    }).toEqual({
      order: [
        'create',
        'begin:/wt/feature-a:feature-a',
        'prepare',
        'dispatch',
        'teardown',
        'stop',
      ],
      outcome: {
        slug: 'feature-a',
        status: 'error',
        reason: 'dispatch failed',
      },
      receivedEvents: localEvents,
      receivedProviderExecution: providerExecution,
      beginArgs: {
        worktree,
        item: { slug: 'feature-a' },
      },
      attempts: ['claude'],
      stopCalls: 1,
    });
  });

  it('allocates non-aliased provider caches and sessions for two feature invocations', async () => {
    const configuredProviders = ['claude'] as const;
    const provider = {
      invoke: async () => ({ success: true, output: '', exitCode: 0 }),
      invokeInteractive: async () => ({ success: true, output: '', exitCode: 0 }),
    };
    const contexts: ProviderExecutionContext[] = [];
    const providerExecution = () => {
      const context: ProviderExecutionContext = {
        configuredProviders,
        runtimes: new ProviderRuntimeSet([
          {
            key: 'claude',
            provider,
            policy: CLAUDE_MODEL_POLICY,
            builtIn: true,
            availability: new ModelAvailability([]),
          },
        ]),
        sessions: new ProviderSessionStore(),
      };
      contexts.push(context);
      return context;
    };
    const received: Array<ProviderExecutionContext | undefined> = [];
    const featureDeps = deps({ done: false, halted: true, reason: 'pause' });
    featureDeps.providerExecution = providerExecution;
    featureDeps.runConductor = async (_worktree, _item, context) => {
      received.push(context);
    };
    const run = makeRunFeature(featureDeps);

    await run({ slug: 'feature-a' });
    await run({ slug: 'feature-b' });

    expect({
      contextCount: contexts.length,
      received,
      contextsAreIndependent: contexts[0] !== contexts[1],
      runtimeSetsAreIndependent: contexts[0].runtimes !== contexts[1].runtimes,
      availabilityCachesAreIndependent:
        contexts[0].runtimes.get('claude').availability !==
        contexts[1].runtimes.get('claude').availability,
      sessionStoresAreIndependent: contexts[0].sessions !== contexts[1].sessions,
      configuredOrderIsShared:
        contexts[0].configuredProviders === configuredProviders &&
        contexts[1].configuredProviders === configuredProviders,
    }).toEqual({
      contextCount: 2,
      received: [contexts[0], contexts[1]],
      contextsAreIndependent: true,
      runtimeSetsAreIndependent: true,
      availabilityCachesAreIndependent: true,
      sessionStoresAreIndependent: true,
      configuredOrderIsShared: true,
    });
  });

  it('keeps interleaved terminal messages with their feature-owned loggers', async () => {
    const lines: string[] = [];
    let waiting = 0;
    let releaseOutcomes!: () => void;
    const outcomesReady = new Promise<void>((resolve) => {
      releaseOutcomes = resolve;
    });
    const featureDeps = deps({ done: false, halted: true, reason: 'paused' });
    featureDeps.readOutcome = async () => {
      waiting += 1;
      if (waiting === 2) releaseOutcomes();
      await outcomesReady;
      return { done: false, halted: true, reason: 'paused' };
    };
    featureDeps.beginFeatureRun = async (_worktree, item) => ({
      events: new ConductorEventEmitter(),
      providerExecution: {
        configuredProviders: [],
        runtimes: new ProviderRuntimeSet([]),
        sessions: new ProviderSessionStore(),
      },
      stop: () => {},
      log: (message: string) => lines.push(`[${item.slug}] ${message}`),
    });

    const run = makeRunFeature(featureDeps);
    await Promise.all([run({ slug: 'feature-a' }), run({ slug: 'feature-b' })]);

    expect(lines).toEqual([
      '[feature-a] ✋ feature-a halted — worktree kept (paused)',
      '[feature-b] ✋ feature-b halted — worktree kept (paused)',
    ]);
  });

  it('done → marks processed, retains the worktree, reports prUrl', async () => {
    const rec: { teardownKeep?: boolean; processed?: boolean } = {};
    const run = makeRunFeature(
      deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
          costTokens: 42,
        },
        rec,
      ),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    expect(out.prUrl).toBe('http://pr/1');
    expect(out.costTokens).toBe(42);
    expect(rec.processed).toBe(true);
    expect(rec.teardownKeep).toBeUndefined();
  });

  it('done with verified prUrl and finishChoice="pr" → ships (happy path)', async () => {
    const rec: { teardownKeep?: boolean; processed?: boolean } = {};
    const run = makeRunFeature(
      deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'https://github.com/owner/repo/pull/123',
          costTokens: 50,
        },
        rec,
      ),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    expect(out.prUrl).toBe('https://github.com/owner/repo/pull/123');
    expect(out.costTokens).toBe(50);
    expect(rec.processed).toBe(true);
    expect(rec.teardownKeep).toBeUndefined();
  });

  it.each([
    {
      label: 'a refused record',
      verdict: {
        kind: 'refusal' as const,
        code: 'shipped-record-missing' as const,
        expected: '.docs/shipped/feat-x.md',
        observed: null,
      },
    },
    {
      label: 'an unavailable verifier',
      verdict: {
        kind: 'refusal' as const,
        code: 'shipment-evidence-git-unavailable' as const,
        expected: 'candidate-tree/head reachability',
        observed: 'git unavailable',
      },
    },
  ])('PR-shaped done outcome with $label halts before daemon ship side effects', async ({ verdict }) => {
    const wt = await mkdtemp(join(tmpdir(), 'wt-durable-evidence-'));
    try {
      await mkdir(join(wt, '.pipeline'), { recursive: true });
      await writeFile(join(wt, '.pipeline', 'DONE'), 'done\n', 'utf-8');
      const rec: TestRecorder = {};
      const run = makeRunFeature({
        ...deps(
          {
            done: true,
            halted: false,
            finishChoice: 'pr',
            prUrl: 'https://github.com/owner/repo/pull/916',
          },
          rec,
        ),
        createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
        shipmentEvidence: async () => verdict,
      });

      const out = await run(ITEM);

      expect(out.status).toBe('halted');
      expect(out.reason).toContain(verdict.code);
      expect(rec.processedCalls).toHaveLength(0);
      expect(rec.enrollCalls).toHaveLength(0);
      expect(rec.teardownKeep).toBe(true);
      await expect(readFile(join(wt, '.pipeline', 'DONE'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(wt, '.pipeline', 'HALT'), 'utf-8')).resolves.toContain(verdict.code);
    } finally {
      await rm(wt, { recursive: true, force: true });
    }
  });

  it('refuses an unpushed candidate using the explicit implementation PR head before daemon ship side effects', async () => {
    const wt = await mkdtemp(join(tmpdir(), 'wt-durable-pr-binding-'));
    const prUrl = 'https://github.com/owner/repo/pull/916';
    try {
      await initTestRepo(wt);
      await mkdir(join(wt, '.docs/plans'), { recursive: true });
      await mkdir(join(wt, '.docs/shipped'), { recursive: true });
      const plan = '# Durable daemon evidence\n';
      await writeFile(join(wt, `.docs/plans/${ITEM.slug}.md`), plan, 'utf-8');
      await execFile('git', ['add', '.'], { cwd: wt });
      await execFile('git', ['commit', '-m', 'test: add durable daemon plan'], { cwd: wt });
      const { stdout: remoteHeadStdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: wt });
      const remoteHead = remoteHeadStdout.trim();

      await writeFile(
        join(wt, `.docs/shipped/${ITEM.slug}.md`),
        renderShippedRecord({
          slug: ITEM.slug,
          specHash: specHash(Buffer.from(plan), null).digest,
          pr: prUrl,
          shipped: '2026-07-25',
        }),
        'utf-8',
      );
      await execFile('git', ['add', '.'], { cwd: wt });
      await execFile('git', ['commit', '-m', 'test: add local durable shipment record'], { cwd: wt });

      const rec: TestRecorder = {};
      const ghCalls: string[][] = [];
      const run = makeRunFeature({
        ...deps(
          {
            done: true,
            halted: false,
            finishChoice: 'pr',
            prUrl,
          },
          rec,
        ),
        createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
        shipmentEvidence: undefined,
        runGh: async (args) => {
          ghCalls.push(args);
          return { stdout: JSON.stringify({ url: prUrl, headRefOid: remoteHead }) };
        },
      });

      const out = await run(ITEM);

      expect({
        status: out.status,
        reason: out.reason,
        ghCalls,
        processedCalls: rec.processedCalls,
        enrollCalls: rec.enrollCalls,
        teardownKeep: rec.teardownKeep,
      }).toEqual({
        status: 'halted',
        reason: 'durable shipment evidence refused ship: shipment-candidate-not-on-implementation-head',
        ghCalls: [['pr', 'view', prUrl, '--json', 'url,headRefOid']],
        processedCalls: [],
        enrollCalls: [],
        teardownKeep: true,
      });
    } finally {
      await rm(wt, { recursive: true, force: true });
    }
  });

  it('halted → keeps the worktree, does not mark processed', async () => {
    const rec: { teardownKeep?: boolean; processed?: boolean } = {};
    const run = makeRunFeature(
      deps({ done: false, halted: true, reason: 'needs human' }, rec),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('halted');
    expect(out.reason).toBe('needs human');
    expect(rec.processed).toBeUndefined();
    expect(rec.teardownKeep).toBe(true); // kept for inspection
  });

  it('no DONE/HALT marker → error, worktree kept', async () => {
    const rec: { teardownKeep?: boolean } = {};
    const run = makeRunFeature(deps({ done: false, halted: false }, rec));
    const out = await run(ITEM);
    expect(out.status).toBe('error');
    expect(out.reason).toMatch(/without DONE or HALT/);
    expect(rec.teardownKeep).toBe(true);
  });

  it('a thrown primitive is caught as an error; worktree torn down', async () => {
    const rec: { teardownKeep?: boolean } = {};
    const run = makeRunFeature(
      deps({ done: true, halted: false }, rec, { throwIn: 'runConductor' }),
    );
    const out = await run(ITEM);
    expect(out.status).toBe('error');
    expect(out.reason).toMatch(/fail in runConductor/);
    expect(rec.teardownKeep).toBe(true);
  });

  it('a throw during createWorktree leaves a slug-derived HALT marker with an operator resume action', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-runner-create-worktree-'));
    try {
      const rec: { teardownKeep?: boolean } = {};
      const featureDeps = deps(
        { done: true, halted: false },
        rec,
        { throwIn: 'createWorktree' },
      );
      featureDeps.projectRoot = projectRoot;
      const run = makeRunFeature(featureDeps);

      const out = await run(ITEM);

      expect(out.status).toBe('error');
      expect(rec.teardownKeep).toBeUndefined(); // never created → nothing to tear down
      await expect(
        readFile(join(projectRoot, '.worktrees', ITEM.slug, '.pipeline', 'HALT'), 'utf-8'),
      ).resolves.toMatch(/fail in createWorktree[\s\S]*rm .pipeline\/HALT/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      site: 'triage park',
      configure: (featureDeps: FeatureRunnerDeps) => {
        featureDeps.daemon = true;
        featureDeps.prepareWorktree = async () => {
          throw new SetupFailureError('setup failed', 'setup triage parked this feature');
        };
        featureDeps.runSetupTriage = async () => ({
          kind: 'park',
          outputTail: 'setup triage parked this feature',
        });
      },
      expected: {
        haltFirstLine: 'feature errored — parked for human inspection',
        haltClass: 'needs-human',
        status: 'error',
        teardownKeep: true,
      },
    },
    {
      site: 'no DONE/HALT outcome',
      configure: (featureDeps: FeatureRunnerDeps) => {
        featureDeps.readOutcome = async () => ({ done: false, halted: false });
      },
      expected: {
        haltFirstLine: 'feature errored — parked for human inspection',
        haltClass: 'needs-human',
        status: 'error',
        teardownKeep: true,
      },
    },
    {
      site: 'false-ship guard',
      configure: (featureDeps: FeatureRunnerDeps) => {
        featureDeps.readOutcome = async () => ({
          done: true,
          halted: false,
          finishChoice: 'keep',
          prUrl: 'https://github.com/owner/repo/pull/123',
        });
      },
      expected: {
        haltFirstLine: 'feature errored — parked for human inspection',
        haltClass: 'needs-human',
        status: 'halted',
        teardownKeep: true,
      },
    },
    {
      site: 'caught thrown runtime failure',
      configure: (featureDeps: FeatureRunnerDeps) => {
        featureDeps.runConductor = async () => {
          throw new Error('runtime dispatch failure');
        };
      },
      expected: {
        haltFirstLine: 'feature errored — parked for human inspection',
        haltClass: 'needs-human',
        status: 'error',
        teardownKeep: true,
      },
    },
  ])('characterizes $site as an unparked termination today', async ({ configure, expected }) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-runner-termination-boundary-'));
    const worktreePath = join(projectRoot, '.worktrees', ITEM.slug);
    const rec: TestRecorder = {};
    try {
      await mkdir(worktreePath, { recursive: true });
      const featureDeps = deps({ done: false, halted: false }, rec);
      featureDeps.projectRoot = projectRoot;
      featureDeps.createWorktree = async (slug) => ({ path: worktreePath, branch: `feat/${slug}` });
      configure(featureDeps);

      const outcome = await makeRunFeature(featureDeps)(ITEM);
      const halt = await readFile(join(worktreePath, '.pipeline', 'HALT'), 'utf-8');

      expect({
        haltFirstLine: halt.split('\n', 1)[0],
        haltClass: await readFile(join(worktreePath, '.pipeline', 'HALT.class'), 'utf-8'),
        status: outcome.status,
        teardownKeep: rec.teardownKeep,
        parkMarkerExists: await readFile(
          join(projectRoot, '.daemon', 'parked', ITEM.slug),
          'utf-8',
        ).then(() => true).catch(() => false),
      }).toEqual({
        ...expected,
        parkMarkerExists: false,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('warns of unrecoverable state when the slug-derived HALT marker cannot be written', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-runner-unrecoverable-marker-'));
    const logs: string[] = [];
    try {
      const featureDeps = deps(
        { done: true, halted: false },
        {},
        { throwIn: 'createWorktree' },
      );
      featureDeps.projectRoot = projectRoot;
      featureDeps.log = (message) => logs.push(message);
      await mkdir(join(projectRoot, '.worktrees'), { recursive: true });
      await writeFile(join(projectRoot, '.worktrees', ITEM.slug), 'not a directory', 'utf-8');

      await makeRunFeature(featureDeps)(ITEM);

      expect(logs.join('\n')).toMatch(
        new RegExp(`unrecoverable-state[\\s\\S]*${ITEM.slug}`, 'i'),
      );
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  describe('daemon-only triage routing (Task 13 — makeRunFeature wiring)', () => {
    // Story TS-2: setup-failure triage + daemon mode dispatch flow
    // Story TS-1: non-setup errors keep today's path
    // Use TriageOutcome type to keep import alive
    type TriageHandler = (error: any, worktree: any, item: any) => Promise<TriageOutcome>;

    // Minimal SetupFailureError mock (imported from worktree-prepare)
    class SetupFailureError extends Error {
      outputTail: string;

      constructor(message: string, outputTail: string = '') {
        super(message);
        this.name = 'SetupFailureError';
        this.outputTail = outputTail;
      }
    }

    interface TriageRecorder {
      triageCalls?: Array<{ error: string; daemon: boolean }>;
      triageReturnValue?: TriageOutcome;
    }

    function depsWithTriageOrder(
      order: string[],
      rec: TriageRecorder & { teardownKeep?: boolean } = {},
      opts: {
        prepareThrows?: 'setup-failure' | 'plain-error';
        daemon?: boolean;
        triageThrows?: boolean;
      } = {},
    ): FeatureRunnerDeps {
      const base = deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
        },
        rec,
      );
      const triageHandler: TriageHandler = async (error: any, _worktree: any, _item: any) => {
        order.push('triage');
        if (!rec.triageCalls) rec.triageCalls = [];
        rec.triageCalls.push({ error: error.message, daemon: opts.daemon ?? false });
        if (opts.triageThrows) throw new Error('triage dispatch failed');
        return (
          rec.triageReturnValue ?? {
            kind: 'quarantined-pass',
            outputTail: '',
            quarantineRef: 'wip/setup-quarantine-default',
          }
        );
      };
      return {
        ...base,
        daemon: opts.daemon ?? false,
        createWorktree: async (slug) => {
          order.push('createWorktree');
          return { path: `/wt/${slug}`, branch: `feat/${slug}` };
        },
        prepareWorktree: async () => {
          order.push('prepareWorktree');
          if (opts.prepareThrows === 'setup-failure') {
            throw new SetupFailureError(
              'project setup (bin/setup) failed: pg unreachable',
              'tail of output',
            );
          }
          if (opts.prepareThrows === 'plain-error') {
            throw new Error('some random error');
          }
        },
        runConductor: async () => {
          order.push('runConductor');
        },
        runSetupTriage: triageHandler,
      };
    }

    it('TS-2 happy: SetupFailureError with daemon=true invokes triage → quarantined-pass continues to runConductor', async () => {
      const order: string[] = [];
      const rec: TriageRecorder & { teardownKeep?: boolean } = {
        triageReturnValue: {
          kind: 'quarantined-pass',
          outputTail: '',
          quarantineRef: 'wip/setup-quarantine-feat-x',
        },
      };
      const run = makeRunFeature(
        depsWithTriageOrder(order, rec, {
          prepareThrows: 'setup-failure',
          daemon: true,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done'); // continued to runConductor and got outcome
      expect(order).toEqual(['createWorktree', 'prepareWorktree', 'triage', 'runConductor']);
      expect(rec.triageCalls).toHaveLength(1);
    });

    it('TS-2 routing: SetupFailureError with triage returning park → runConductor never runs, error outcome', async () => {
      const order: string[] = [];
      const rec: TriageRecorder & { teardownKeep?: boolean } = {
        triageReturnValue: { kind: 'park', outputTail: 'setup is broken' },
      };
      const run = makeRunFeature(
        depsWithTriageOrder(order, rec, {
          prepareThrows: 'setup-failure',
          daemon: true,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/setup is broken/);
      expect(rec.teardownKeep).toBe(true); // worktree kept for inspection
      expect(order).toEqual(['createWorktree', 'prepareWorktree', 'triage']);
    });

    it("TS-1 negative: plain Error during prepare bypasses triage (today's path)", async () => {
      const order: string[] = [];
      const rec: TriageRecorder & { teardownKeep?: boolean } = {};
      const run = makeRunFeature(
        depsWithTriageOrder(order, rec, {
          prepareThrows: 'plain-error',
          daemon: true,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/some random error/);
      expect(rec.triageCalls).toBeUndefined(); // triage never invoked
      expect(order).toEqual(['createWorktree', 'prepareWorktree']); // today's path byte-identical
    });

    it('prepare succeeding bypasses triage (no side effects)', async () => {
      const order: string[] = [];
      const rec: TriageRecorder & { teardownKeep?: boolean } = {};
      const run = makeRunFeature(
        depsWithTriageOrder(order, rec, {
          prepareThrows: undefined,
          daemon: true,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
      expect(rec.triageCalls).toBeUndefined(); // triage never invoked
      expect(order).toEqual(['createWorktree', 'prepareWorktree', 'runConductor']);
    });

    it('runSetupTriage absent → SetupFailureError reverts to today\'s error path (no-op)', async () => {
      const order: string[] = [];
      const rec: { teardownKeep?: boolean } = {};
      const base = deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
        },
        rec,
      );
      const run = makeRunFeature({
        ...base,
        daemon: true,
        createWorktree: async (slug) => {
          order.push('createWorktree');
          return { path: `/wt/${slug}`, branch: `feat/${slug}` };
        },
        prepareWorktree: async () => {
          order.push('prepareWorktree');
          class SetupFailureError extends Error {
            outputTail: string;

            constructor(message: string, outputTail: string = '') {
              super(message);
              this.name = 'SetupFailureError';
              this.outputTail = outputTail;
            }
          }
          throw new SetupFailureError('setup failed', 'output');
        },
        runConductor: async () => {
          order.push('runConductor');
        },
        // Intentionally absent: runSetupTriage
      });
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/setup failed/);
      expect(order).toEqual(['createWorktree', 'prepareWorktree']); // no triage injection
    });
  });

  describe('quarantine surfacing to the resuming build agent (Task 14 — makeRunFeature wiring)', () => {
    class SetupFailureError extends Error {
      outputTail: string;
      constructor(message: string, outputTail: string = '') {
        super(message);
        this.name = 'SetupFailureError';
        this.outputTail = outputTail;
      }
    }

    function depsWithSurfacing(
      rec: { teardownKeep?: boolean },
      opts: {
        triageReturnValue: TriageOutcome;
        surfaceQuarantineRef?: FeatureRunnerDeps['surfaceQuarantineRef'];
      },
    ): FeatureRunnerDeps {
      const base = deps(
        { done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' },
        rec,
      );
      return {
        ...base,
        daemon: true,
        createWorktree: async (slug) => ({ path: `/wt/${slug}`, branch: `feat/${slug}` }),
        prepareWorktree: async () => {
          throw new SetupFailureError('project setup failed', 'tail');
        },
        runConductor: async () => {},
        runSetupTriage: async () => opts.triageReturnValue,
        surfaceQuarantineRef: opts.surfaceQuarantineRef,
      };
    }

    it('quarantine happened this rotation → surfaceQuarantineRef is invoked with the outcome before dispatch', async () => {
      const rec: { teardownKeep?: boolean } = {};
      const calls: Array<{ slug: string; outcome: TriageOutcome }> = [];
      const run = makeRunFeature(
        depsWithSurfacing(rec, {
          triageReturnValue: {
            kind: 'quarantined-pass',
            outputTail: '',
            quarantineRef: 'wip/setup-quarantine-feat-x',
          },
          surfaceQuarantineRef: async (_wt, slug, outcome) => {
            calls.push({ slug, outcome });
          },
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
      expect(calls).toHaveLength(1);
      expect(calls[0].slug).toBe('feat-x');
      expect(calls[0].outcome.quarantineRef).toBe('wip/setup-quarantine-feat-x');
    });

    it('no quarantine present → surfaceQuarantineRef is still invoked (it decides internally whether to write)', async () => {
      const rec: { teardownKeep?: boolean } = {};
      const calls: TriageOutcome[] = [];
      const run = makeRunFeature(
        depsWithSurfacing(rec, {
          triageReturnValue: { kind: 'pass', outputTail: '' },
          surfaceQuarantineRef: async (_wt, _slug, outcome) => {
            calls.push(outcome);
          },
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
      expect(calls).toHaveLength(1);
      expect(calls[0].kind).toBe('pass');
      expect(calls[0].quarantineRef).toBeUndefined();
    });

    it('surfaceQuarantineRef throwing does not block dispatch (fail-open)', async () => {
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature(
        depsWithSurfacing(rec, {
          triageReturnValue: {
            kind: 'quarantined-pass',
            outputTail: '',
            quarantineRef: 'wip/setup-quarantine-feat-x',
          },
          surfaceQuarantineRef: async () => {
            throw new Error('sentinel write blew up');
          },
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done'); // dispatch proceeded despite the surfacing failure
    });

    it('surfaceQuarantineRef absent → makeRunFeature builds normally (backward compatible)', async () => {
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature(
        depsWithSurfacing(rec, {
          triageReturnValue: { kind: 'quarantined-pass', outputTail: '', quarantineRef: 'wip/setup-quarantine-feat-x' },
          surfaceQuarantineRef: undefined,
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
    });
  });

  describe('prepareWorktree (write namespace + run bin/setup)', () => {
    function depsWithOrder(
      order: string[],
      opts: { prepareThrows?: boolean } = {},
      rec: { teardownKeep?: boolean } = {},
    ): FeatureRunnerDeps {
      const base = deps(
        {
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
        },
        rec,
      );
      return {
        ...base,
        createWorktree: async (slug) => {
          order.push('createWorktree');
          return { path: `/wt/${slug}`, branch: `feat/${slug}` };
        },
        prepareWorktree: async () => {
          order.push('prepareWorktree');
          if (opts.prepareThrows) throw new Error('bin/setup failed: pg unreachable');
        },
        runConductor: async () => {
          order.push('runConductor');
        },
      };
    }

    it('runs prepareWorktree after createWorktree and before runConductor', async () => {
      const order: string[] = [];
      const run = makeRunFeature(depsWithOrder(order));
      await run(ITEM);
      expect(order).toEqual(['createWorktree', 'prepareWorktree', 'runConductor']);
    });

    it('a prepareWorktree failure aborts before the build and keeps the worktree', async () => {
      const order: string[] = [];
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature(depsWithOrder(order, { prepareThrows: true }, rec));
      const out = await run(ITEM);
      expect(out.status).toBe('error');
      expect(out.reason).toMatch(/bin\/setup failed/);
      expect(order).toEqual(['createWorktree', 'prepareWorktree']); // runConductor never reached
      expect(rec.teardownKeep).toBe(true); // worktree kept for inspection
    });

    // #446 conflict resolution (Task 16): supersedes the prior pin that a
    // prepareWorktree failure is *always* terminal/errored. Since Task 13 wired
    // triage into makeRunFeature, a SetupFailureError in daemon mode with a
    // triage handler present is routed to triage instead of erroring directly
    // (see the 'daemon-only triage routing (Task 13)' describe block below for
    // the full routed-to-triage matrix). This test pins the backward-compat
    // half of that split: when the triage dependency is absent (e.g. manual
    // /conduct runs, or daemon builds that haven't wired triage), a
    // SetupFailureError still falls through to the legacy errored path.
    // keep-worktree is unchanged either way.
    it('a SetupFailureError with no triage dep present keeps the legacy errored path (backward compat)', async () => {
      const order: string[] = [];
      const rec: { teardownKeep?: boolean } = {};
      const run = makeRunFeature({
        ...depsWithOrder(order, {}, rec),
        daemon: false, // no triage dep wired: runSetupTriage is absent
        prepareWorktree: async () => {
          order.push('prepareWorktree');
          throw new SetupFailureError('project setup (bin/setup) failed: pg unreachable', 'tail of output');
        },
      });
      const out = await run(ITEM);
      expect(out.status).toBe('error'); // legacy errored path, not routed-to-triage
      expect(out.reason).toMatch(/pg unreachable/);
      expect(order).toEqual(['createWorktree', 'prepareWorktree']); // runConductor never reached, triage never invoked
      expect(rec.teardownKeep).toBe(true); // worktree kept for inspection — unchanged
    });

    it('writes a diagnostic .pipeline/HALT into the worktree on an error (so it is not opaque)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-err-'));
      try {
        const base = deps(
          {
            done: true,
            halted: false,
            finishChoice: 'pr',
          },
          {},
        );
        const run = makeRunFeature({
          ...base,
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          prepareWorktree: async () => {
            throw new Error("bin/setup failed: UnknownAdapterError 'stub'");
          },
          runConductor: async () => {},
        });
        const out = await run(ITEM);
        expect(out.status).toBe('error');
        // The captured reason is now persisted to .pipeline/HALT for the operator.
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toMatch(/feature errored/);
        expect(halt).toMatch(/UnknownAdapterError 'stub'/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('dirty-tree-uncleaned park never mislabels reason/HALT as "setup failed" (Task 2 — #582)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-dirty-'));
      try {
        const base = deps({ done: true, halted: false, finishChoice: 'pr' }, {});
        const run = makeRunFeature({
          ...base,
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          prepareWorktree: async () => {
            throw new SetupFailureError('project setup (bin/setup) failed: dirty tree', 'tail');
          },
          runConductor: async () => {},
          daemon: true,
          runSetupTriage: async () =>
            ({
              kind: 'park',
              outputTail: 'working tree left dirty after setup: 2 stray paths quarantined',
              contractOutcome: 'dirty-tree-uncleaned',
              quarantineRef: 'refs/quarantine/feat-x',
              preservedPaths: ['src/foo.ts', 'src/bar.ts'],
            } as TriageOutcome),
        });
        const out = await run(ITEM);
        expect(out.status).toBe('error');
        expect(out.reason).not.toMatch(/setup failed and parked after triage/);
        expect(out.reason).not.toMatch(/\bsetup failed\b/);
        expect(out.reason).toMatch(/working tree left dirty after setup/);
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).not.toMatch(/setup failed and parked after triage/);
        expect(halt).not.toMatch(/\bsetup failed\b/);
        expect(halt).toMatch(/working tree left dirty after setup/);
        expect(halt).toMatch(/Contract outcome: dirty-tree-uncleaned/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('park with empty outputTail renders neutral fallback, never "setup failed" (Task 2 — #582)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-dirty-empty-'));
      try {
        const base = deps({ done: true, halted: false, finishChoice: 'pr' }, {});
        const run = makeRunFeature({
          ...base,
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          prepareWorktree: async () => {
            throw new SetupFailureError('project setup (bin/setup) failed: dirty tree', 'tail');
          },
          runConductor: async () => {},
          daemon: true,
          runSetupTriage: async () =>
            ({
              kind: 'park',
              outputTail: '',
              contractOutcome: 'dirty-tree-uncleaned',
              quarantineRef: 'refs/quarantine/feat-x',
              preservedPaths: ['src/foo.ts'],
            } as TriageOutcome),
        });
        const out = await run(ITEM);
        expect(out.status).toBe('error');
        expect(out.reason).not.toMatch(/\bsetup failed\b/);
        expect(out.reason).toMatch(/parked after setup triage/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('a deps object without prepareWorktree builds normally (backward compatible)', async () => {
      // The existing deps() helper ships no prepareWorktree — the feature must
      // still build, proving the step is genuinely opt-in.
      const run = makeRunFeature(
        deps({
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: 'http://pr/1',
        }),
      );
      const out = await run(ITEM);
      expect(out.status).toBe('done');
    });
  });

  describe('false-ship path (Task 10: #337)', () => {
    // Story 3 acceptance criteria: outcome.done=true but fails ship-eligibility guard
    // (finishChoice != 'pr' or prUrl null or finishChoice undefined).
    // Expected: HALT written, DONE deleted, worktree kept, markProcessed NOT called,
    // status='halted', reason names the contradiction.

    it('done with null prUrl → halted (Story 3, null prUrl)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const rec: { teardownKeep?: boolean; processed?: boolean; escalated?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined, // null prUrl fails the guard
              costTokens: 30,
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          escalateBuildFailure: async () => {
            rec.escalated = true;
            return {};
          },
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');
        expect(out.reason).toMatch(/prUrl is null/);
        expect(out.costTokens).toBe(30);
        expect(rec.processed).toBeUndefined(); // markProcessed NOT called
        expect(rec.teardownKeep).toBe(true); // worktree kept
        expect(rec.escalated).toBe(true); // escalateBuildFailure called
        // HALT marker must exist
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toMatch(/prUrl is null/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('done with undefined finishChoice → halted (Story 3, missing finishChoice)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const rec: { teardownKeep?: boolean; processed?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: undefined, // missing finishChoice fails the guard
              prUrl: 'https://github.com/owner/repo/pull/123',
              costTokens: 25,
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');
        expect(out.reason).toMatch(/without a finish-choice marker/);
        expect(rec.processed).toBeUndefined(); // markProcessed NOT called
        expect(rec.teardownKeep).toBe(true); // worktree kept
        // HALT marker must exist
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toMatch(/without a finish-choice marker/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('done with finishChoice="keep" → halted', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const rec: { teardownKeep?: boolean; processed?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'keep', // not 'pr' fails the guard
              prUrl: 'https://github.com/owner/repo/pull/123',
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');
        expect(out.reason).toMatch(/finish choice is "keep" not "pr"/);
        expect(rec.processed).toBeUndefined();
        expect(rec.teardownKeep).toBe(true);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship deletes the DONE marker if it exists', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        // Pre-create the DONE marker (simulating an outcome that converged DONE before the guard)
        await mkdir(join(wt, '.pipeline'), { recursive: true });
        await writeFile(join(wt, '.pipeline', 'DONE'), 'marked\n', 'utf-8');

        const rec: { teardownKeep?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined, // fails guard
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');

        // DONE marker must be deleted (conflict resolution)
        try {
          await readFile(join(wt, '.pipeline', 'DONE'), 'utf-8');
          throw new Error('DONE marker should have been deleted');
        } catch (err) {
          if ((err as any).code !== 'ENOENT') throw err;
        }

        // HALT marker must exist
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toBeTruthy();
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship calls escalateBuildFailure with proper context', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const escalateCalls: Array<{ projectRoot: string; failureReason: string }> = [];
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined,
            },
            {},
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          escalateBuildFailure: async (opts) => {
            escalateCalls.push(opts);
            return {};
          },
        });
        await run(ITEM);
        expect(escalateCalls).toHaveLength(1);
        expect(escalateCalls[0].projectRoot).toBe(wt);
        expect(escalateCalls[0].failureReason).toMatch(/prUrl is null/);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship passes its feature logger to escalation', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const featureLog = vi.fn();
        let escalationLog: ((message: string) => void) | undefined;
        const featureDeps = deps({
          done: true,
          halted: false,
          finishChoice: 'pr',
          prUrl: undefined,
        });
        featureDeps.createWorktree = async (slug) => ({ path: wt, branch: `feat/${slug}` });
        featureDeps.beginFeatureRun = () => ({
          events: new ConductorEventEmitter(),
          providerExecution: {
            configuredProviders: [],
            runtimes: new ProviderRuntimeSet([]),
            sessions: new ProviderSessionStore(),
          },
          log: featureLog,
          stop: () => {},
        });
        featureDeps.escalateBuildFailure = async (opts) => {
          escalationLog = (opts as { log?: (message: string) => void }).log;
          return {};
        };

        await makeRunFeature(featureDeps)(ITEM);

        expect(escalationLog).toBe(featureLog);
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship continues even if escalateBuildFailure throws', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const rec: { teardownKeep?: boolean; processed?: boolean } = {};
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined,
            },
            rec,
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          escalateBuildFailure: async () => {
            throw new Error('push failed');
          },
        });
        const out = await run(ITEM);
        // Must not throw; must complete the halted path
        expect(out.status).toBe('halted');
        expect(rec.teardownKeep).toBe(true); // still kept
        // HALT marker still written
        const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
        expect(halt).toBeTruthy();
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    it('false-ship runs maybeSweep (FR-14: sweep after every completion)', async () => {
      const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
      try {
        const sweepCalls: number[] = [];
        const run = makeRunFeature({
          ...deps(
            {
              done: true,
              halted: false,
              finishChoice: 'pr',
              prUrl: undefined,
            },
            {},
          ),
          createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          projectRoot: '/proj',
          sweepMergeableLabels: async () => {
            sweepCalls.push(Date.now());
          },
        });
        const out = await run(ITEM);
        expect(out.status).toBe('halted');
        expect(sweepCalls).toHaveLength(1); // sweep called
      } finally {
        await rm(wt, { recursive: true, force: true });
      }
    });

    describe('Task 12: ship side effects skipped on failed ship (Story 3 + Story 5)', () => {
      // Story 3 acceptance criteria: when false-ship path runs, NO ship side effects occur.
      // Ship side effects are: markProcessed, removeLabel/clearOnSuccess, enrollWatch.
      // Only the live (verified) ship path should call these.

      it('false-ship with null prUrl: zero markProcessed calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl: undefined, // fails ship guard
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: markProcessed must never be called on false-ship
          expect(rec.processedCalls).toHaveLength(0);
          expect(rec.processed).toBeUndefined();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with null prUrl: zero enrollWatch calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl: undefined, // fails ship guard
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: enrollWatch must never be called on false-ship
          expect(rec.enrollCalls).toHaveLength(0);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with missing finishChoice: zero markProcessed calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: undefined, // fails ship guard
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: markProcessed must never be called on false-ship
          expect(rec.processedCalls).toHaveLength(0);
          expect(rec.processed).toBeUndefined();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with missing finishChoice: zero enrollWatch calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: undefined, // fails ship guard
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: enrollWatch must never be called on false-ship
          expect(rec.enrollCalls).toHaveLength(0);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with finishChoice="keep": zero markProcessed calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'keep', // fails ship guard
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: markProcessed must never be called on false-ship
          expect(rec.processedCalls).toHaveLength(0);
          expect(rec.processed).toBeUndefined();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('false-ship with finishChoice="keep": zero enrollWatch calls (Story 3)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-false-ship-'));
        try {
          const rec: TestRecorder = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'keep', // fails ship guard
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('halted');
          // Verification: enrollWatch must never be called on false-ship
          expect(rec.enrollCalls).toHaveLength(0);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('happy-ship path calls markProcessed with non-null prUrl (Story 5 invariant)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-happy-ship-'));
        try {
          const rec: TestRecorder = {};
          const prUrl = 'https://github.com/owner/repo/pull/999';
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl, // verified ship
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('done');
          // Verification: markProcessed MUST be called exactly once with non-null prUrl
          expect(rec.processedCalls).toHaveLength(1);
          expect(rec.processedCalls![0].prUrl).toBe(prUrl);
          expect(rec.processedCalls![0].prUrl).not.toBeNull();
          expect(rec.processedCalls![0].prUrl).not.toBeUndefined();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('happy-ship path calls enrollWatch with verified prUrl (Story 5)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-happy-ship-'));
        try {
          const rec: TestRecorder = {};
          const prUrl = 'https://github.com/owner/repo/pull/888';
          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl, // verified ship
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          expect(out.status).toBe('done');
          // Verification: enrollWatch MUST be called with verified prUrl
          expect(rec.enrollCalls).toHaveLength(1);
          expect(rec.enrollCalls![0].prUrl).toBe(prUrl);
          expect(rec.enrollCalls![0].slug).toBe('feat-x');
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

    });

    describe('Task 11: Park evidence — extended diagnostic HALT (TS-4)', () => {
      // Story TS-4 happy: a `park` triage outcome produces a `.pipeline/HALT` whose
      // content includes the output tail, the quarantine ref when taken, the literal
      // statement that no quarantine exists in the clean-HEAD case, and the contract outcome.
      // Park status/rekick eligibility identical to a plain errored feature.

      it('park triage outcome with quarantine ref produces HALT with output tail, quarantine ref, and contract outcome (TS-4 happy)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-park-'));
        try {
          const triageEvidence: TriageOutcome = {
            kind: 'park',
            outputTail: 'setup failed: database connection timeout\nretrying...\nfailed again',
            quarantineRef: 'wip/setup-quarantine-abc123',
            contractOutcome: 'contract violation: schema mismatch',
          };
          const rec: { teardownKeep?: boolean; processed?: boolean } = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: false,
                halted: false,
                triageEvidence,
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          // Park produces error status, keeps worktree, doesn't mark processed
          expect(out.status).toBe('error');
          expect(rec.processed).toBeUndefined();
          expect(rec.teardownKeep).toBe(true);
          // HALT must exist and contain all evidence
          const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
          expect(halt).toContain('setup failed: database connection timeout');
          expect(halt).toContain('retrying...');
          expect(halt).toContain('failed again');
          expect(halt).toContain('wip/setup-quarantine-abc123');
          expect(halt).toContain('contract violation: schema mismatch');
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('park triage outcome without quarantine ref produces HALT with explicit no-quarantine statement (TS-4 negative)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-park-clean-'));
        try {
          const triageEvidence: TriageOutcome = {
            kind: 'park',
            outputTail: 'setup completed but validation failed\nerror: validation returned false',
            contractOutcome: 'contract violation: test suite incomplete',
          };
          const rec: { teardownKeep?: boolean; processed?: boolean } = {};
          const run = makeRunFeature({
            ...deps(
              {
                done: false,
                halted: false,
                triageEvidence,
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
          });
          const out = await run(ITEM);
          // Park produces error status, keeps worktree, doesn't mark processed
          expect(out.status).toBe('error');
          expect(rec.processed).toBeUndefined();
          expect(rec.teardownKeep).toBe(true);
          // HALT must exist and contain output tail and contract, plus explicit no-quarantine statement
          const halt = await readFile(join(wt, '.pipeline', 'HALT'), 'utf-8');
          expect(halt).toContain('setup completed but validation failed');
          expect(halt).toContain('error: validation returned false');
          expect(halt).toContain('contract violation: test suite incomplete');
          // No-quarantine case must have explicit statement
          expect(halt).toMatch(/no quarantine|clean-HEAD|quarantine.*not.*present/i);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });
    });

    describe('Task 12: HALT-write failure still parks (Story 4, negative path)', () => {
      // Story 4 acceptance criteria: when HALT write fails (e.g., unwritable .pipeline),
      // feature outcome is still `error` (parking unaffected), log sink receives the
      // write-failure line, and no dispatch happens.

      it('HALT write failure: feature still parked with error status (Task 12)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-halt-write-fail-'));
        try {
          const logCalls: string[] = [];
          const rec: { teardownKeep?: boolean } = {};

          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
            prepareWorktree: async () => {
              // Simulate a setup failure
              throw new Error('bin/setup failed: database unreachable');
            },
            log: (msg: string) => {
              logCalls.push(msg);
            },
          });

          // Pre-create .pipeline as a file (not a directory) to force write failure
          await writeFile(join(wt, '.pipeline'), 'this blocks the directory', 'utf-8');

          const out = await run(ITEM);

          // Verify outcome is error (parking maintained despite write failure)
          expect(out.status).toBe('error');
          expect(out.reason).toMatch(/bin\/setup failed/);

          // Verify worktree is kept for inspection
          expect(rec.teardownKeep).toBe(true);

          // Verify log sink received the write-failure notification
          const haltFailLog = logCalls.find(msg => msg.includes('unrecoverable-state') && msg.includes(ITEM.slug));
          expect(haltFailLog).toBeTruthy();
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });

      it('HALT write failure does not dispatch (no markProcessed or enrollWatch calls)', async () => {
        const wt = await mkdtemp(join(tmpdir(), 'wt-halt-dispatch-'));
        try {
          const rec: TestRecorder = {};

          const run = makeRunFeature({
            ...deps(
              {
                done: true,
                halted: false,
                finishChoice: 'pr',
                prUrl: 'https://github.com/owner/repo/pull/123',
              },
              rec,
            ),
            createWorktree: async (slug) => ({ path: wt, branch: `feat/${slug}` }),
            prepareWorktree: async () => {
              throw new Error('network timeout');
            },
          });

          // Make .pipeline unwritable
          await writeFile(join(wt, '.pipeline'), 'blocked', 'utf-8');

          const out = await run(ITEM);

          // Verify outcome is error (not shipped)
          expect(out.status).toBe('error');

          // Verify no dispatch side effects (must never ship despite any write outcome)
          expect(rec.processedCalls).toHaveLength(0);
          expect(rec.enrollCalls).toHaveLength(0);
        } finally {
          await rm(wt, { recursive: true, force: true });
        }
      });
    });

  });

  // A normal verified PR outcome reaches the daemon-owned ship side effects
  // only after the shared evidence verifier has returned valid.
  describe('verified PR ship outcome', () => {
    const PR_URL = 'https://github.com/jstoup111/ai-conductor/pull/358';

    it('keeps retention reporting ship-only and tolerates cleanup failure with an absent worktree', async () => {
      const effects: string[] = [];
      const logs: string[] = [];
      const absentPath = join(tmpdir(), 'already-absent-feature-worktree');
      await rm(absentPath, { recursive: true, force: true });
      const featureDeps = {
        ...deps({
          done: true,
          halted: false,
          finishChoice: 'pr' as const,
          prUrl: PR_URL,
        }),
        createWorktree: async () => ({ path: absentPath, branch: `feat/${ITEM.slug}` }),
        cleanupHaltPresentation: async () => {
          throw new Error('cleanup exploded');
        },
        enrollWatch: async () => {
          effects.push('enrollWatch');
        },
        markProcessed: async () => {
          effects.push('markProcessed');
        },
        log: (message: string) => logs.push(message),
      };

      const shipped = await makeRunFeature(featureDeps)(ITEM);
      const haltedLogs: string[] = [];
      const haltedDeps = deps({ done: false, halted: true, reason: 'paused' });
      haltedDeps.log = (message: string) => haltedLogs.push(message);
      const halted = await makeRunFeature(haltedDeps)(ITEM);

      expect({
        shippedStatus: shipped.status,
        effects,
        cleanupErrorLogged: logs.some(line => line.includes('clear-on-success error: cleanup exploded')),
        retainedPathLogged: logs.some(line => line.includes(`worktree retained at ${absentPath}`)),
        retainedReasonLogged: logs.includes(
          `[daemon-runner] retained ${ITEM.slug} — reason: pr-open-awaiting-main`,
        ),
        haltedStatus: halted.status,
        haltedClaimsShipRetention: haltedLogs.some(line => line.includes('worktree retained at')),
      }).toEqual({
        shippedStatus: 'done',
        effects: ['enrollWatch', 'markProcessed'],
        cleanupErrorLogged: true,
        retainedPathLogged: true,
        retainedReasonLogged: true,
        haltedStatus: 'halted',
        haltedClaimsShipRetention: false,
      });
    });

    it('retains the worktree after enrolling and marking a verified ship', async () => {
      const effects: string[] = [];
      const featureDeps = deps({
        done: true,
        halted: false,
        finishChoice: 'pr',
        prUrl: PR_URL,
      });
      featureDeps.enrollWatch = async () => {
        effects.push('enrollWatch');
      };
      featureDeps.markProcessed = async () => {
        effects.push('markProcessed');
      };
      featureDeps.teardownWorktree = async () => {
        effects.push('teardownWorktree');
      };

      await makeRunFeature(featureDeps)(ITEM);

      expect(effects).toEqual(['enrollWatch', 'markProcessed']);
    });

    it('a valid PR outcome marks the feature processed with its PR URL', async () => {
      const rec: TestRecorder = {};
      const run = makeRunFeature(
        deps(
          {
            done: true,
            halted: false,
            finishChoice: 'pr',
            prUrl: PR_URL,
          },
          rec,
        ),
      );
      const out = await run(ITEM);

      expect(out.status).toBe('done');
      expect(rec.processed).toBe(true);
      expect(rec.processedCalls).toHaveLength(1);
      expect(rec.processedCalls![0]).toEqual({ slug: ITEM.slug, prUrl: PR_URL });
      expect(rec.teardownKeep).toBeUndefined();
    });

    it('a halted outcome writes no processed marker', async () => {
      const rec: TestRecorder = {};
      const run = makeRunFeature(
        deps(
          {
            done: false,
            halted: true,
            reason: 'unrelated gate failure',
          },
          rec,
        ),
      );
      const out = await run(ITEM);

      expect(out.status).toBe('halted');
      expect(rec.processed).toBeUndefined();
      expect(rec.processedCalls).toHaveLength(0);
    });

    it('two valid outcomes create one stable ledger entry each without throwing', async () => {
      const rec: TestRecorder = {};
      const outcome: WorktreeOutcome = {
        done: true,
        halted: false,
        finishChoice: 'pr',
        prUrl: PR_URL,
      };
      const run = makeRunFeature(deps(outcome, rec));

      const first = await run(ITEM);
      const second = await run(ITEM);

      expect(first.status).toBe('done');
      expect(second.status).toBe('done');
      // Two separate feature runs each produce exactly one markProcessed call
      // (one ledger entry per run) with byte-identical content — no throw,
      // no duplicate-cleanup error surfaced through the outcome.
      expect(rec.processedCalls).toHaveLength(2);
      expect(rec.processedCalls![0]).toEqual({ slug: ITEM.slug, prUrl: PR_URL });
      expect(rec.processedCalls![1]).toEqual({ slug: ITEM.slug, prUrl: PR_URL });
    });
  });
});
