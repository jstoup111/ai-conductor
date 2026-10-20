import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import { v4 as uuidv4 } from 'uuid';
import { Conductor } from './conductor.js';
import { loadConfig } from './config.js';
import { createProductionAcceptanceRedExec } from './acceptance-red-runner.js';
import {
  createProductionFinishPublicationCoordinator,
  createProductionReleaseReadinessObserver,
} from './finish-publication-production.js';
import { createProvenanceGuardedFinishPresentationRepair } from './finish-presentation-repair.js';
import { makeProductionGit } from './pr-labels.js';
import { isOperatorParked } from './park-marker.js';
import { DefaultStepRunner } from './step-runners.js';
import { makeRunFeature, type FeatureRunnerDeps, type FeatureWorktree } from './daemon-runner.js';
import { readWorktreeOutcome } from './daemon-deps.js';
import { prepareWorktree, runProjectTeardown } from './worktree-prepare.js';
import { runSetupFailureTriage } from './setup-triage.js';
import { PluginRegistry } from './plugin-registry.js';
import { discoverPlugins, registerBuiltins } from './plugin-loader.js';
import { discoverInstalledProviders } from './provider-discovery.js';
import { createProviderRuntimeSet } from './provider-runtime.js';
import { ProviderSessionStore } from './provider-session.js';
import { normalizeProviderSelection, validateProviderInstallation, validateRegisteredProviderSelections } from './provider-selection.js';
import { validateConfiguredProviderModels } from './provider-model-probe.js';
import { createCandidateSafetyBoundary, providerExecutionEventCallbacks, type ProviderExecutionContext } from './provider-execution.js';
import { resolveHarnessRoot } from './install-freshness.js';
import { originDefaultBranch, makeGitRunner } from './rebase.js';
import { createStepStatusWriteRefusalDiagnostics, resolveConductorStateStore } from './conductor-deps.js';
import type { FeatureExecutionOutcome } from './feature-executor.js';
import type { ExecutorChildRunInput } from './executor-child.js';

export interface ExecutorChildFeatureRunnerInput {
  order: ExecutorChildRunInput['order'];
  worktree: FeatureWorktree;
  events: ExecutorChildRunInput['events'];
  log?: (message: string) => void;
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
    createWorktree: async () => input.worktree,
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
}): Promise<FeatureExecutionOutcome> {
  const { order, events, signal, worktree, projectRoot } = input;
  if (signal.aborted) return { slug: order.slug, status: 'parked', reason: String(signal.reason ?? 'stopped') };

  const loaded = await loadConfig(projectRoot);
  if (!loaded.ok && loaded.error.type !== 'missing') throw new Error(`Config error: ${loaded.error.message}`);
  const config = loaded.ok ? loaded.config : undefined;
  const registry = new PluginRegistry();
  await discoverPlugins(
    join(process.env.HOME || '', '.ai-conductor', 'plugins'),
    join(projectRoot, '.ai-conductor', 'plugins'),
    registry,
  );
  const discovery = await discoverInstalledProviders({ events });
  registerBuiltins(registry, events, undefined, config?.codex_doctor_timeout_seconds, undefined, new Set(discovery.installed));
  registry.markInitialized();
  validateProviderInstallation({ config: config ?? {}, discovery });
  await validateConfiguredProviderModels({ config: config ?? {}, discovery });
  validateRegisteredProviderSelections({ config: config ?? {}, registeredProviders: registry.list('llm_provider') });

  const configuredProviders = normalizeProviderSelection(config?.llm_provider);
  const providerExecution: ProviderExecutionContext = {
    configuredProviders,
    runtimes: createProviderRuntimeSet(registry, console.warn, config),
    sessions: new ProviderSessionStore(),
    config,
    providerAvailability: input.providerAvailability,
    withCandidateSafety: createCandidateSafetyBoundary(),
    ...providerExecutionEventCallbacks(events),
  };
  const runtime = providerExecution.runtimes.get(configuredProviders[0]);
  if (!runtime) throw new Error('executor child requires a configured provider runtime');

  const pipelineDir = join(worktree.path, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  const sessionId = uuidv4();
  const stepRunner = new DefaultStepRunner(runtime.provider, sessionId, worktree.path, {
    featureDesc: order.slug,
    projectRoot,
    pipelineDir,
    config,
    modelPolicy: runtime.policy,
    mode: 'auto',
    providerExecution,
    events,
    worktreeLifecycle: input.worktreeLifecycle as never,
    skillNameRoot: await resolveHarnessRoot(),
  });
  const stateFilePath = join(pipelineDir, 'conduct-state.json');
  const stateStore = resolveConductorStateStore(
    stateFilePath,
    undefined,
    createStepStatusWriteRefusalDiagnostics(events),
  );
  const baseBranch = (await originDefaultBranch(makeGitRunner(worktree.path))) ?? 'main';
  const git = makeProductionGit();
  const waitControllers = new Set<AbortController>();
  const conductor = new Conductor({
    stateFilePath,
    stateStore,
    stepRunner,
    events,
    mode: 'auto',
    config,
    modelPolicy: runtime.policy,
    providerExecution,
    // The supervisor's pool width is an IPC concern: keep the existing
    // legacy no-providerExecution refusal effective in a child executor.
    effectiveDaemonConcurrency: input.effectiveConcurrency ?? order.effectiveConcurrency,
    projectRoot: worktree.path,
    acceptanceRedExec: createProductionAcceptanceRedExec(),
    finishPublication: createProductionFinishPublicationCoordinator({
      projectRoot: worktree.path,
      stateFilePath,
      engineVersionId: input.engineVersionId,
      baseBranch,
      prTemplateBytes: config?.pr_template_bytes,
      git,
      gh: (await import('./pr-labels.js')).makeProductionGh(),
      events,
      repairPresentation: createProvenanceGuardedFinishPresentationRepair({ projectRoot: worktree.path, git, gh: (await import('./pr-labels.js')).makeProductionGh(), baseBranch, events }),
      observeReleaseReadiness: createProductionReleaseReadinessObserver({ projectRoot: worktree.path, config }),
    }),
    worktreeBranch: worktree.branch,
    log: input.log,
    // This must be the supervisor's decision, not a child-side path guess:
    // self-host dispatches use the brokered live-boundary coordinator.
    selfHost: order.selfHost === true,
    baseBranch,
    resume: true,
    daemon: true,
    featureSlug: order.slug,
    // Child isolation changes process ownership, not operator-park semantics:
    // consult the same root marker at each existing conductor admission
    // boundary and leave the feature state intact for a later unpark/retry.
    operatorParkBoundary: () => isOperatorParked(projectRoot, order.slug),
    registerAbortController: (controller) => {
      waitControllers.add(controller);
      controller.signal.addEventListener('abort', () => waitControllers.delete(controller), { once: true });
    },
    rateLimitEpisode: input.rateLimitEpisode,
    liveBoundaryCoordinator: input.liveBoundaryCoordinator as never,
    verifyArtifacts: true,
  });
  // The child owns the conductor, so its stop path mirrors the daemon's
  // in-process SIGTERM path. Register every rate-limit wait locally and abort
  // it before closing open executions; the conductor then reaches its normal
  // shutdown boundary instead of continuing orphaned after the IPC child exits.
  const closeForShutdown = async () => {
    for (const wait of waitControllers) wait.abort(signal.reason);
    await conductor.closeOpenExecutionsForShutdown();
  };
  let shutdown: Promise<void> | undefined;
  const beginShutdown = () => shutdown ??= closeForShutdown();
  signal.addEventListener('abort', () => { void beginShutdown(); }, { once: true });
  const runner = makeExecutorChildFeatureRunner({ order, worktree, events, log: input.log }, {
    createWorktree: async () => worktree,
    prepareWorktree: async (featureWorktree, featureLog, featureEvents) => prepareWorktree(
      featureWorktree.path,
      featureLog,
      {
        baseSha: order.baseSha,
        events: featureEvents,
        dispatchStart: true,
        skillNameRoot: await resolveHarnessRoot(),
      },
    ),
    runSetupTriage: async (
      error,
      featureWorktree,
      item,
      execution = providerExecution,
      featureLog = input.log,
      featureEvents,
    ) => {
      const runPrepare = async () => prepareWorktree(featureWorktree.path, featureLog, {
        force: true,
        baseSha: order.baseSha,
        events: featureEvents,
        dispatchStart: true,
        skillNameRoot: await resolveHarnessRoot(),
      });
      const triageRuntime = execution.runtimes.get(execution.configuredProviders[0]);
      if (!triageRuntime) throw new Error('executor child requires a configured provider runtime');
      return runSetupFailureTriage(
        makeGitRunner(featureWorktree.path),
        featureWorktree.path,
        item.slug,
        error,
        runPrepare,
        async () => new DefaultStepRunner(triageRuntime.provider, uuidv4(), featureWorktree.path, {
          featureDesc: `setup-fix-${item.slug}`,
          config,
          modelPolicy: triageRuntime.policy,
          mode: 'auto',
          providerExecution: execution,
          log: featureLog,
          skillNameRoot: await resolveHarnessRoot(),
        }).resolveSetupFailure({
          worktreePath: featureWorktree.path,
          outputTail: error.outputTail,
          slug: item.slug,
        }),
        featureLog ? { log: featureLog } : undefined,
        featureEvents,
      );
    },
    runConductor: async () => {
      if (signal.aborted) return { kind: 'operator-parked', boundary: { kind: 'pre-first-unit' } };
      try {
        return await conductor.run();
      } catch (error) {
        // An aborted rate-limit clear may reject its in-flight attempt while
        // the conductor is draining. Shutdown is authoritative in that case.
        if (!signal.aborted) throw error;
        await beginShutdown();
        return { kind: 'operator-parked', boundary: { kind: 'pre-first-unit' } };
      }
    },
    readOutcome: (featureWorktree) => readWorktreeOutcome(featureWorktree.path),
    teardownWorktree: async (featureWorktree, keep) => {
      if (keep) return;
      await runProjectTeardown(featureWorktree.path, input.log);
      await input.worktreeLifecycle.run(() => execa(
        'git', ['worktree', 'remove', '--force', featureWorktree.path], { cwd: projectRoot },
      ).catch(() => {}));
    },
    // Deferred terminal effects make this unreachable in the child. It keeps
    // the canonical runner contract complete without permitting a root write.
    markProcessed: async () => {},
    daemon: true,
    providerExecution: () => providerExecution,
    project: basename(projectRoot),
    log: input.log,
  });
  const result = await runner();
  if (signal.aborted && result.status !== 'parked') {
    await beginShutdown();
    return { slug: order.slug, status: 'parked', reason: String(signal.reason ?? 'stopped') };
  }
  return result;
}
