// Covers: task:2
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import {
  createForcedSetupPrepare,
  runDaemonFeatureConductor,
  type DaemonFeatureLifecycleContext,
} from '../../src/engine/daemon-feature-lifecycle.js';

const captured = vi.hoisted(() => ({
  conductor: undefined as undefined | { options: Record<string, any> },
  finishDeps: undefined as undefined | Record<string, any>,
  parkedRoots: [] as string[],
  trace: [] as string[],
}));

vi.mock('../../src/engine/conductor.js', () => ({
  Conductor: class FixtureConductor {
    options: Record<string, any>;

    constructor(options: Record<string, any>) {
      this.options = options;
      captured.conductor = this;
    }

    async run(): Promise<void> {
      await this.options.operatorParkBoundary();
      this.options.registerAbortController(new AbortController());
      captured.trace.push('conductor.run');
      await this.options.finishPublication.advance({});
    }
  },
}));

vi.mock('../../src/engine/default-step-runner.js', () => ({}));
vi.mock('../../src/engine/step-runners.js', () => ({
  DefaultStepRunner: class FixtureStepRunner {},
}));
vi.mock('../../src/engine/audit-trail.js', () => ({
  AuditTrailWriter: class FixtureAuditTrailWriter {
    subscribe(): void {}
  },
}));
vi.mock('../../src/engine/acceptance-red-runner.js', () => ({
  createProductionAcceptanceRedExec: vi.fn(),
}));
vi.mock('../../src/engine/conductor-deps.js', () => ({
  createStepStatusWriteRefusalDiagnostics: vi.fn(() => ({})),
  resolveConductorStateStore: vi.fn(() => ({})),
}));
vi.mock('../../src/engine/daemon-state.js', () => ({
  seedDaemonDispatchState: vi.fn(async () => ({})),
}));
vi.mock('../../src/engine/finish-publication-production.js', () => ({
  createProductionFinishPublicationCoordinator: vi.fn((deps: Record<string, any>) => {
    captured.finishDeps = deps;
    return {
      requiresArtifactValidation: true,
      advance: async () => {
        await deps.flushSessionEvents();
        captured.trace.push('finish-publication');
      },
    };
  }),
  createProductionReleaseReadinessObserver: vi.fn(() => vi.fn()),
}));
vi.mock('../../src/engine/finish-presentation-repair.js', () => ({
  createProvenanceGuardedFinishPresentationRepair: vi.fn(() => vi.fn()),
}));
vi.mock('../../src/engine/install-freshness.js', () => ({
  resolveHarnessRoot: vi.fn(async () => '/fixture/harness'),
}));
vi.mock('../../src/engine/park-marker.js', () => ({
  isOperatorParked: vi.fn(async (root: string) => {
    captured.parkedRoots.push(root);
    return false;
  }),
}));
vi.mock('../../src/engine/restack/stack-preflight.js', () => ({
  runStackPreflight: vi.fn(async () => ({ kind: 'no-stack' })),
}));
vi.mock('../../src/engine/daemon-rekick.js', () => ({
  resumeRebaseFirst: vi.fn(async () => 'skipped'),
}));
vi.mock('../../src/engine/state.js', () => ({
  getStepStatus: vi.fn(() => 'pending'),
  readState: vi.fn(async () => ({ ok: true, value: {} })),
}));
vi.mock('../../src/engine/pr-labels.js', () => ({
  makeProductionGit: vi.fn(() => vi.fn()),
}));
vi.mock('../../src/engine/tracker-client.js', () => ({
  createGuardedGithubOperationRunner: vi.fn(),
  makeProductionGh: vi.fn(() => vi.fn()),
}));

const roots: string[] = [];

afterEach(async () => {
  captured.conductor = undefined;
  captured.finishDeps = undefined;
  captured.parkedRoots = [];
  captured.trace = [];
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('daemon feature lifecycle adapter context', () => {
  it('uses the self-host worktree as the forced-prepare skill root', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-feature-lifecycle-project-'));
    const worktreePath = join(projectRoot, '.worktrees', 'feature-a');
    roots.push(projectRoot);
    await mkdir(worktreePath, { recursive: true });
    const prepare = vi.fn(async () => {});

    await createForcedSetupPrepare(prepare as never, undefined, false, {
      projectRoot,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      isSelfHost: true,
      harnessRoot: '/installed/harness',
    })(worktreePath);

    expect(prepare).toHaveBeenCalledWith(
      worktreePath,
      undefined,
      expect.objectContaining({
        force: true,
        skillNameRoot: worktreePath,
      }),
    );
  });

  it('uses context-owned lifecycle services and the canonical project root', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-feature-lifecycle-project-'));
    roots.push(projectRoot);
    const worktreePath = join(projectRoot, '.worktrees', 'feature-a');
    await mkdir(worktreePath, { recursive: true });

    const unregister = vi.fn(() => captured.trace.push('unregister'));
    const registerConductor = vi.fn(() => unregister);
    const registerAbortController = vi.fn(() => captured.trace.push('register-abort'));
    const isShutdownRequested = vi.fn(() => false);
    const flushFeatureEvents = vi.fn(async () => {
      captured.trace.push('flush-events');
    });
    const legacyFlush = vi.fn(async () => {
      captured.trace.push('legacy-flush');
    });
    const featureEvents = new ConductorEventEmitter();

    const context = {
      projectRoot,
      config: undefined,
      baseBranch: 'main',
      isSelfHost: false,
      effectiveDaemonConcurrency: 1,
      worktreeLifecycle: {} as never,
      rateLimitEpisode: {} as never,
      readOnlyReviewCapabilities: {},
      ownerGh: vi.fn() as never,
      createProviderExecution: () =>
        ({
          configuredProviders: ['fixture'],
          runtimes: new Map([['fixture', { provider: {}, policy: {} }]]),
        }) as never,
      events: featureEvents,
      log: vi.fn(),
      registerConductor,
      registerAbortController,
      isShutdownRequested,
      flushFeatureEvents,
      engineVersionId: 'engine-context-id',
      // Present only to let the pre-Task-2 implementation run and demonstrate
      // that no lifecycle behavior may read this legacy supervisor bag.
      supervisorState: {
        activeConductors: new Set(),
        allWaitSignals: new Set(),
        featureEventFlushers: new WeakMap([[featureEvents, legacyFlush]]),
        isShutdownRequested: () => false,
      },
    } as unknown as DaemonFeatureLifecycleContext;

    await runDaemonFeatureConductor(
      context,
      { path: worktreePath, branch: 'feat/daemon-feature-a' },
      { slug: 'feature-a' } as never,
      undefined,
      featureEvents,
      vi.fn(),
      'session-a',
    );

    expect(registerConductor).toHaveBeenCalledWith(captured.conductor);
    expect(registerAbortController).toHaveBeenCalledTimes(1);
    expect(isShutdownRequested).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(captured.finishDeps).toMatchObject({ engineVersionId: 'engine-context-id' });
    expect(flushFeatureEvents).toHaveBeenCalledTimes(1);
    expect(legacyFlush).not.toHaveBeenCalled();
    expect(captured.trace).toEqual([
      'register-abort',
      'conductor.run',
      'flush-events',
      'finish-publication',
      'unregister',
    ]);
    expect(captured.parkedRoots).toEqual([projectRoot, projectRoot]);
    expect(captured.parkedRoots).not.toContain(worktreePath);
  });
});
