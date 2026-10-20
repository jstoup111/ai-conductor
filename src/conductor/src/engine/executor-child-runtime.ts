import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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
import { readState } from './state.js';
import { createStepStatusWriteRefusalDiagnostics, resolveConductorStateStore } from './conductor-deps.js';
import type { FeatureExecutionOutcome } from './feature-executor.js';
import type { ExecutorChildRunInput } from './executor-child.js';

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
  if (signal.aborted) {
    await beginShutdown();
    return { slug: order.slug, status: 'parked', reason: String(signal.reason ?? 'stopped') };
  }
  try {
    await conductor.run();
  } catch (error) {
    // An aborted rate-limit clear may reject its in-flight attempt while the
    // conductor is draining. Shutdown itself is authoritative in that case.
    if (!signal.aborted) throw error;
  }
  if (signal.aborted) {
    await beginShutdown();
    return { slug: order.slug, status: 'parked', reason: String(signal.reason ?? 'stopped') };
  }
  // A park can arrive through the root marker between conductor admissions;
  // it is semantically distinct from a gate halt even though neither has a
  // PR URL. Preserve it for supervisor collection and future unpark.
  if (await isOperatorParked(projectRoot, order.slug)) {
    return { slug: order.slug, status: 'parked', reason: 'operator parked' };
  }
  const state = await readState(stateFilePath);
  // Root-owned effects travel back as declarative terminal effects and are
  // applied by daemon collection, exactly as in-process deferred execution.
  // The child must never write root ledgers or watch state itself.
  if (state.ok && state.value.pr_url) {
    return {
      slug: order.slug, status: 'done', prUrl: state.value.pr_url,
      terminalEffects: {
        markProcessed: { prUrl: state.value.pr_url },
        enrollWatch: { prUrl: state.value.pr_url },
        sweep: true,
      },
    };
  }
  return { slug: order.slug, status: 'halted', terminalEffects: { sweep: true } };
}
