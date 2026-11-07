import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Conductor } from './conductor.js';
import { loadMergedConfig } from './config.js';
import { makeRunFeature, type FeatureRunnerDeps, type FeatureWorktree } from './daemon-runner.js';
import { makeFeatureRunnerDeps } from './daemon-deps.js';
import {
  createWorkOrderGitRunner,
  prepareDaemonFeatureManagedSessionContext,
  runDaemonFeatureConductor,
  runDaemonSetupTriage,
  type DaemonFeatureLifecycleContext,
} from './daemon-feature-lifecycle.js';
import { installDaemonProcessServices, type DaemonProcessServicesOptions } from './daemon-process-bootstrap.js';
import { PluginRegistry } from './plugin-registry.js';
import { discoverPlugins, registerBuiltins } from './plugin-loader.js';
import { discoverInstalledProviders } from './provider-discovery.js';
import { createProviderRuntimeSet } from './provider-runtime.js';
import { ProviderSessionStore } from './provider-session.js';
import { normalizeProviderSelection, validateProviderInstallation, validateRegisteredProviderSelections } from './provider-selection.js';
import {
  resolveProviderModelTiers,
  validateConfiguredProviderModels,
  type ProviderModelProbeRunner,
} from './provider-model-probe.js';
import { createCandidateSafetyBoundary, providerExecutionEventCallbacks, type ProviderExecutionContext } from './provider-execution.js';
import { createManagedSessionObservationPreparer } from '../execution/managed-session-preparation.js';
import { createSessionEventIdentity } from '../execution/session-event-identity.js';
import { resolveHarnessVersion } from './version-report.js';
import { probeManagedObservationDestination } from './build-review-read-only-capability.js';
import { resolveDispatchStartTimeoutSeconds, resolveTeardownTimeoutSeconds } from './resolved-config.js';
import { originDefaultBranch, makeGitRunner } from './rebase.js';
import { isOperatorParked } from './park-marker.js';
import { leafBranchFor } from './feature-branch-identity.js';
import { hasDurableChildState } from './child-cursor.js';
import { acquireFeatureDispatchLease } from './feature-dispatch-lease.js';
import { seedDaemonDispatchState } from './daemon-state.js';
import type { ConductStateStore } from './conduct-state-store.js';
import type { ConductState } from '../types/index.js';
import type { FeatureExecutionOutcome } from './feature-executor.js';
import type { ExecutorChildDispatchAdmission, ExecutorChildRunInput } from './executor-child.js';
import type { WorkOrder } from './work-order.js';
import { ConductorEventEmitter } from './conductor-event-emitter.js';
import { startSessionEventTail } from './event-persister.js';
import { makeProductionGh } from './tracker-client.js';

export interface ExecutorChildFeatureRunnerInput {
  order: ExecutorChildRunInput['order'];
  worktree: FeatureWorktree;
  events: ExecutorChildRunInput['events'];
  /** The child's feature-local provider routing state for the runner scope. */
  providerExecution: ProviderExecutionContext;
  log?: (message: string) => void;
  /** Store for the daemon base-state seed; defaults to the filesystem store. */
  stateStore?: ConductStateStore<ConductState>;
}

export interface MakeExecutorChildRunOptions {
  readonly projectRoot: string;
  /** Defaults to install for direct callers retained during the migration. */
  readonly processServices?: 'install' | 'inherited';
  readonly runFeature?: typeof runExecutorChildFeature;
  readonly githubBoundary?: Pick<DaemonProcessServicesOptions, 'runner' | 'readCredential' | 'readToken'>;
}

/** The supervisor owns both boundary signals; the child only relays them to its conductor. */
export function buildExecutorChildConductorBoundaryOptions({
  projectRoot,
  slug,
  preemptionRequested,
}: {
  projectRoot: string;
  slug: string;
  preemptionRequested: () => boolean;
}): Pick<ConstructorParameters<typeof Conductor>[0], 'operatorParkBoundary' | 'preemptionRequested'> {
  return {
    operatorParkBoundary: () => isOperatorParked(projectRoot, slug),
    preemptionRequested,
  };
}

export interface CreateExecutorChildRuntimeOptions {
  readonly projectRoot: string;
  /** The entrypoint owns process-global services; in-memory children inherit them. */
  readonly processServices: 'install' | 'inherited';
}

/**
 * A newer supervisor carries its configured base branch in the WorkOrder.
 * Orders from older supervisors omit it, preserving the prior origin lookup.
 */
export async function resolveExecutorChildBaseBranch(
  order: Pick<WorkOrder, 'baseBranch'>,
  git: ReturnType<typeof makeGitRunner>,
): Promise<string> {
  return order.baseBranch ?? (await originDefaultBranch(git)) ?? 'main';
}

/**
 * Claim the root-owned stacked-feature lease before an isolated child creates
 * or reuses its worktree. The child process runs with the supervisor's root as
 * its cwd, so this remains the canonical lease and park-marker location.
 */
export async function makeExecutorChildDispatchAdmission(
  { projectRoot }: Pick<MakeExecutorChildRunOptions, 'projectRoot'>,
  order: WorkOrder,
): Promise<ExecutorChildDispatchAdmission> {
  if (await hasDurableChildState(projectRoot, order.slug) !== true) return { kind: 'admitted' };

  const leaseResult = await acquireFeatureDispatchLease(projectRoot, order.slug, 'daemon dispatch');
  if (leaseResult.kind !== 'acquired') {
    return {
      kind: 'skipped',
      outcome: { slug: order.slug, status: 'parked', reason: 'feature-lease-held' },
    };
  }

  try {
    if (await isOperatorParked(projectRoot, order.slug)) {
      await leaseResult.lease.release();
      return {
        kind: 'skipped',
        outcome: { slug: order.slug, status: 'parked', reason: 'parked-after-lease' },
      };
    }
  } catch (error) {
    await leaseResult.lease.release();
    throw error;
  }

  return { kind: 'admitted', release: () => leaseResult.lease.release() };
}

/**
 * Compose every child-executor dependency at its process boundary. Keeping
 * process-service ownership explicit lets an in-memory test fork share the
 * one resolver installed for its host process.
 */
export function createExecutorChildRuntime({
  projectRoot,
  processServices,
}: CreateExecutorChildRuntimeOptions) {
  return {
    admitDispatch: (order: WorkOrder) => makeExecutorChildDispatchAdmission({ projectRoot }, order),
    // Reuse the daemon seam, which verifies the WorkOrder before its first
    // worktree side effect and performs the pinned-base create under the
    // brokered lifecycle lock.
    createWorktree: async (order: WorkOrder, worktreeLifecycle: ExecutorChildRunInput['worktreeLifecycle']) => {
      const runnerDeps = makeFeatureRunnerDeps({
        projectRoot,
        worktreeBase: join(projectRoot, '.worktrees'),
        baseBranch: 'main',
        runConductorInWorktree: async () => {},
        workOrderGit: createWorkOrderGitRunner(projectRoot),
        worktreeLifecycle: worktreeLifecycle as never,
      });
      return runnerDeps.createWorktree(order.slug, order);
    },
    run: makeExecutorChildRun({ projectRoot, processServices }),
  };
}

/**
 * Compose the child-only daemon services before running its sole feature.
 * Each child handles one order, so the order's feature bus is the process bus.
 */
export function makeExecutorChildRun({
  projectRoot,
  processServices = 'install',
  runFeature = runExecutorChildFeature,
  githubBoundary,
}: MakeExecutorChildRunOptions): (input: ExecutorChildRunInput) => Promise<FeatureExecutionOutcome> {
  return async (input) => {
    if (processServices === 'install') {
      installDaemonProcessServices({ projectRoot, events: input.events, ...githubBoundary });
    }
    return runFeature({
      ...input,
      worktree: {
        path: join(projectRoot, '.worktrees', input.order.slug),
        branch: leafBranchFor(input.order.slug),
      },
      projectRoot,
      supervisorEngineVersionId: input.order.supervisorEngineVersionId ?? input.order.engineVersionId,
    });
  };
}

/**
 * Event types the supervisor alone emits, once per claim, around the whole
 * child launch (ADR D4). The shared runner emits them on its scope's root bus,
 * so the child scope's root bus drops them and forwards everything else
 * (for example `feature_shipped`) onto the child-owned spine.
 */
const SUPERVISOR_OWNED_EVENTS: ReadonlySet<string> = new Set(['feature_dispatch_started', 'feature_dispatch_ended']);

function withoutSupervisorOwnedEvents(events: ConductorEventEmitter): ConductorEventEmitter {
  const filtered = new ConductorEventEmitter();
  filtered.emit = async (event) => {
    if (!SUPERVISOR_OWNED_EVENTS.has(event.type)) await events.emit(event);
  };
  filtered.emitOrThrow = async (event) => {
    if (!SUPERVISOR_OWNED_EVENTS.has(event.type)) await events.emitOrThrow(event);
  };
  return filtered;
}

/**
 * Bind the daemon's canonical one-feature lifecycle to the worktree already
 * created by the child entrypoint. `deferTerminalEffects` is essential: the
 * runner describes root-owned effects, and the supervisor applies them only
 * after collecting this outcome.
 */
export function makeExecutorChildFeatureRunner(
  input: ExecutorChildFeatureRunnerInput,
  lifecycle: FeatureRunnerDeps,
): () => Promise<FeatureExecutionOutcome> {
  const run = makeRunFeature({
    ...lifecycle,
    // The root-side admission has already acquired (and checked the park
    // marker for) a stacked dispatch lease. Acquiring it again here observes
    // the child's own holder as live and parks every durable child.
    dispatchAdmission: 'admitted',
    createWorktree: async () => input.worktree,
    // WorkOrder is dispatcher authority. Thread it to the shared preparation
    // seam so it uses the claim-time base rather than resolving a later base.
    prepareWorktree: lifecycle.prepareWorktree === undefined
      ? undefined
      : (worktree, log, events) => lifecycle.prepareWorktree!(worktree, log, events, input.order),
    // The child entrypoint already owns this feature's event persistence and
    // forwarding; bind that bus as the runner scope so setup, triage,
    // shipment and termination events reach the child spine (ADR D4).
    beginFeatureRun: async () => ({
      events: input.events,
      rootEvents: withoutSupervisorOwnedEvents(input.events),
      providerExecution: input.providerExecution,
      ...(input.log ? { log: input.log } : {}),
      stop: () => {},
    }),
    // The child Conductor reads its tier, track, and preseeded steps from
    // conduct-state.json; seed them from the order exactly as the
    // in-process daemon does, or a technical spec resumes as `product`.
    runConductor: async (worktree, item, ...rest) => {
      await seedDaemonDispatchState(join(worktree.path, '.pipeline'), item, input.stateStore);
      return lifecycle.runConductor(worktree, item, ...rest);
    },
    deferTerminalEffects: true,
  });
  return () => run({
    slug: input.order.slug,
    ...(input.order.tier ? { tier: input.order.tier } : {}),
    ...(input.order.sourceRef ? { sourceRef: input.order.sourceRef } : {}),
    ...(input.order.track ? { track: input.order.track } : {}),
    ...(input.order.band ? { band: input.order.band } : {}),
    ...(input.order.resolutionMode ? { resolutionMode: input.order.resolutionMode } : {}),
    ...(input.order.applicabilityDeclarations ? { applicabilityDeclarations: input.order.applicabilityDeclarations } : {}),
    ...(input.order.applicabilityBaseContentSha256 ? { applicabilityBaseContentSha256: input.order.applicabilityBaseContentSha256 } : {}),
    ...(input.order.applicabilityIgnored ? { applicabilityIgnored: input.order.applicabilityIgnored } : {}),
  });
}

/**
 * The child owns a normal feature Conductor, while the supervisor keeps every
 * root mutation and all shared coordination.  This is intentionally a
 * one-order runner: it never parses daemon argv or starts a daemon loop.
 */
export async function runExecutorChildFeature(input: ExecutorChildRunInput & {
  worktree: { path: string; branch: string };
  projectRoot: string;
  supervisorEngineVersionId: string;
  /** Injectable only for the child boot's provider-tier catalog probe. */
  providerModelProbeRunner?: ProviderModelProbeRunner;
}): Promise<FeatureExecutionOutcome> {
  const { order, events, signal, worktree, projectRoot } = input;
  if (signal.aborted) return { slug: order.slug, status: 'parked', reason: String(signal.reason ?? 'stopped') };

  // A child is a real daemon feature dispatch, not a reduced config reader:
  // user defaults are merged beneath project config exactly as in-process runs.
  const loaded = await loadMergedConfig(projectRoot, await resolveHarnessVersion(import.meta.dirname));
  if (!loaded.ok && loaded.error.type !== 'missing') throw new Error(`Config error: ${loaded.error.message}`);
  const config = loaded.ok ? loaded.config : undefined;
  const registry = new PluginRegistry();
  await discoverPlugins(
    join(process.env.HOME || '', '.ai-conductor', 'plugins'),
    join(projectRoot, '.ai-conductor', 'plugins'),
    registry,
  );
  const discovery = await discoverInstalledProviders({ events });
  registerBuiltins(registry, config?.codex_doctor_timeout_seconds, new Set(discovery.installed));
  registry.markInitialized();
  validateProviderInstallation({ config: config ?? {}, discovery });
  await validateConfiguredProviderModels({
    config: config ?? {},
    discovery,
    ...(input.providerModelProbeRunner ? { runner: input.providerModelProbeRunner } : {}),
  });
  await resolveProviderModelTiers({
    discovery,
    projectRoot,
    ...(input.providerModelProbeRunner ? { runner: input.providerModelProbeRunner } : {}),
  });
  validateRegisteredProviderSelections({ config: config ?? {}, registeredProviders: registry.list('llm_provider') });

  const configuredProviders = normalizeProviderSelection(config?.llm_provider);
  const providerExecution: ProviderExecutionContext = {
    configuredProviders,
    runtimes: createProviderRuntimeSet(registry, console.warn, config),
    sessions: new ProviderSessionStore(),
    config,
    providerAvailability: input.providerAvailability,
    withCandidateSafety: createCandidateSafetyBoundary(),
    onProviderSuppressed: (provider, deadline) => events.emit({ type: 'provider_suppressed', provider, deadline }),
    ...providerExecutionEventCallbacks(events),
    ...(input.log ? { diagnosticLog: input.log } : {}),
  };
  const runtime = providerExecution.runtimes.get(configuredProviders[0]);
  if (!runtime) throw new Error('executor child requires a configured provider runtime');

  const pipelineDir = join(worktree.path, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  const dispatchId = createSessionEventIdentity();
  const managedSessionContext = await prepareDaemonFeatureManagedSessionContext({
    projectRoot,
    worktreeRoot: worktree.path,
    featureSlug: order.slug,
    dispatchId,
    provider: configuredProviders[0]!,
  });
  providerExecution.managedSessionContext = managedSessionContext;
  providerExecution.prepareManagedSessionObservation = createManagedSessionObservationPreparer(
    (observation) => probeManagedObservationDestination(observation),
  );
  const sessionTail = startSessionEventTail(worktree.path, events, order.slug);
  const baseBranch = await resolveExecutorChildBaseBranch(order, makeGitRunner(worktree.path));
  const waitControllers = new Set<AbortController>();
  let activeConductor: { closeOpenExecutionsForShutdown(): Promise<void> } | undefined;
  const lifecycleContext: DaemonFeatureLifecycleContext = {
    projectRoot,
    config,
    baseBranch,
    isSelfHost: order.selfHost === true,
    effectiveDaemonConcurrency: input.effectiveConcurrency ?? order.effectiveConcurrency ?? 1,
    worktreeLifecycle: input.worktreeLifecycle as never,
    rateLimitEpisode: input.rateLimitEpisode as never,
    readOnlyReviewCapabilities: {},
    liveBoundaryCoordinator: input.liveBoundaryCoordinator as never,
    // Only the child executor relays the supervisor's memory-only yield
    // request; the in-process daemon path leaves this unset.
    preemptionRequested: input.preemptionRequested,
    ownerGh: makeProductionGh(),
    createProviderExecution: () => providerExecution,
    events,
    log: input.log ?? (() => {}),
    registerConductor: (conductor) => {
      activeConductor = conductor;
      return () => { activeConductor = undefined; };
    },
    registerAbortController: (controller) => {
      waitControllers.add(controller);
      controller.signal.addEventListener('abort', () => waitControllers.delete(controller), { once: true });
    },
    isShutdownRequested: () => signal.aborted,
    flushFeatureEvents: sessionTail.flush,
    engineVersionId: input.engineVersionId,
  };
  // The child owns the conductor, so its stop path mirrors the daemon's
  // in-process SIGTERM path. Register every rate-limit wait locally and abort
  // it before closing open executions; the conductor then reaches its normal
  // shutdown boundary instead of continuing orphaned after the IPC child exits.
  const closeForShutdown = async () => {
    for (const wait of waitControllers) wait.abort(signal.reason);
    await activeConductor?.closeOpenExecutionsForShutdown();
  };
  let shutdown: Promise<void> | undefined;
  const beginShutdown = () => shutdown ??= closeForShutdown();
  signal.addEventListener('abort', () => { void beginShutdown(); }, { once: true });
  const runnerDeps = makeFeatureRunnerDeps({
    projectRoot,
    worktreeBase: join(projectRoot, '.worktrees'),
    baseBranch,
    runConductorInWorktree: async (featureWorktree, item, execution, featureEvents, featureLog, sessionId) => {
      if (signal.aborted) return { kind: 'operator-parked', boundary: { kind: 'pre-first-unit' } };
      try {
        return await runDaemonFeatureConductor(
          lifecycleContext,
          featureWorktree,
          item,
          execution,
          featureEvents,
          featureLog,
          sessionId,
        );
      } catch (error) {
        // An aborted rate-limit clear may reject its in-flight attempt while
        // the conductor is draining. Shutdown is authoritative in that case.
        if (!signal.aborted) throw error;
        await beginShutdown();
        return { kind: 'operator-parked', boundary: { kind: 'pre-first-unit' } };
      }
    },
    providerExecution: () => providerExecution,
    events,
    log: input.log,
    runSetupTriage: (error, featureWorktree, item, execution, featureLog, featureEvents) =>
      runDaemonSetupTriage(
        lifecycleContext,
        error,
        featureWorktree,
        item,
        execution,
        featureLog,
        featureEvents,
        order.baseSha,
      ),
    workOrderGit: createWorkOrderGitRunner(projectRoot),
    worktreeLifecycle: input.worktreeLifecycle as never,
    effectiveConcurrency: input.effectiveConcurrency ?? order.effectiveConcurrency,
    verbose: config?.daemon_verbose ?? false,
    dispatchStartTimeoutSeconds: resolveDispatchStartTimeoutSeconds(config),
    teardownTimeoutSeconds: resolveTeardownTimeoutSeconds(config),
  });
  const runner = makeExecutorChildFeatureRunner(
    { order, worktree, events, providerExecution, log: input.log },
    runnerDeps,
  );
  try {
    const result = await runner();
    if (signal.aborted && result.status !== 'parked') {
      await beginShutdown();
      return { slug: order.slug, status: 'parked', reason: String(signal.reason ?? 'stopped') };
    }
    return result;
  } finally {
    await sessionTail.drain();
  }
}
