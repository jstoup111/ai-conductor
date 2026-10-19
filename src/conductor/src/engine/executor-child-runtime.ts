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
  const baseBranch = (await originDefaultBranch(makeGitRunner(worktree.path))) ?? 'main';
  const git = makeProductionGit();
  const conductor = new Conductor({
    stateFilePath,
    stepRunner,
    events,
    mode: 'auto',
    config,
    modelPolicy: runtime.policy,
    providerExecution,
    effectiveDaemonConcurrency: order.effectiveConcurrency,
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
    baseBranch,
    resume: true,
    daemon: true,
    featureSlug: order.slug,
    rateLimitEpisode: input.rateLimitEpisode,
    liveBoundaryCoordinator: input.liveBoundaryCoordinator as never,
    verifyArtifacts: true,
  });
  const aborted = new Promise<'aborted'>((resolve) => signal.addEventListener('abort', () => resolve('aborted'), { once: true }));
  const result = await Promise.race([conductor.run().then(() => 'done' as const), aborted]);
  if (result === 'aborted') return { slug: order.slug, status: 'parked', reason: String(signal.reason ?? 'stopped') };
  const state = await readState(stateFilePath);
  if (state.ok && state.value.pr_url) return { slug: order.slug, status: 'done', prUrl: state.value.pr_url };
  return { slug: order.slug, status: 'halted' };
}
