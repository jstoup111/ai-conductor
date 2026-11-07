import { existsSync } from 'node:fs';
import { access, mkdir, unlink as unlinkFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { v4 as uuidv4 } from 'uuid';
import { Conductor } from './conductor.js';
import { createProductionAcceptanceRedExec } from './acceptance-red-runner.js';
import { AuditTrailWriter } from './audit-trail.js';
import { createStepStatusWriteRefusalDiagnostics, resolveConductorStateStore } from './conductor-deps.js';
import type { BacklogItem } from './daemon.js';
import type { FeatureWorktree } from './daemon-runner.js';
import { seedDaemonDispatchState } from './daemon-state.js';
import { makeProductionGit as makeFinishPublicationGit } from './pr-labels.js';
import { createProductionFinishPublicationCoordinator, createProductionReleaseReadinessObserver } from './finish-publication-production.js';
import { createProvenanceGuardedFinishPresentationRepair } from './finish-presentation-repair.js';
import { closeIssueOnImplementationMerge } from './engineer/issue-ref.js';
import { HALT_MARKER } from './halt-marker.js';
import { resolveHarnessRoot } from './install-freshness.js';
import type { GhRunner } from './owner-gate/identity.js';
import { isOperatorParked } from './park-marker.js';
import type { ProviderExecutionContext } from './provider-execution.js';
import type { RateLimitEpisode } from './rate-limit-episode.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { resolveRebaseResolutionAttempts, resolveDispatchStartTimeoutSeconds } from './resolved-config.js';
import { bindMutationToPullRequest } from './ship-draft-pr.js';
import { skillNameRootFor } from './skill-names.js';
import { runSetupFailureTriage } from './setup-triage.js';
import { getStepStatus, readState } from './state.js';
import { DefaultStepRunner } from './step-runners.js';
import type { StepRunner } from './step-runner-types.js';
import { prepareWorktree } from './worktree-prepare.js';
import type { WorktreeLifecycleQueue } from './worktree.js';
import type { HarnessConfig } from '../types/config.js';
import type { OperatorParkedTermination, PreemptedTermination } from './conductor-options.js';
import { ConductorEventEmitter } from './conductor-event-emitter.js';
import type { ReadOnlyReviewCapability } from './build-review-read-only-capability.js';
import { resolveFeatureRemoteMutation } from './remote-git-operations.js';
import { resumeRebaseFirst } from './daemon-rekick.js';
import { resolveDaemonBaseSha } from './daemon-deps.js';
import { supersedeHaltRecord } from './halt-record.js';
import type { LiveBoundaryCoordinator } from './self-host/live-boundary-coordinator.js';
import { runStackPreflight, type RunStackPreflightOptions, type StackPreflightResult } from './restack/stack-preflight.js';
import type { RestackResolver } from './restack/restack-resolver.js';
import { provisionManagedSessionProducerRoot, prepareManagedSessionContext, type ManagedSessionContext } from '../execution/managed-session-context.js';
import type { WorkOrderGitRunner } from './work-order.js';
import { createGuardedGithubOperationRunner, makeProductionGh } from './tracker-client.js';

const execFile = promisify(execFileCb);

/** Adapter-owned inputs for the daemon's per-feature lifecycle. */
export interface DaemonFeatureLifecycleContext {
  readonly projectRoot: string;
  readonly config: HarnessConfig | undefined;
  readonly baseBranch: string;
  readonly isSelfHost: boolean;
  readonly effectiveDaemonConcurrency: number;
  readonly worktreeLifecycle: WorktreeLifecycleQueue;
  readonly rateLimitEpisode: RateLimitEpisode;
  readonly readOnlyReviewCapabilities: Readonly<Record<string, ReadOnlyReviewCapability>>;
  readonly liveBoundaryCoordinator?: LiveBoundaryCoordinator;
  /** Child-executor-only supervisor yield request; in-process dispatch omits it. */
  readonly preemptionRequested?: () => boolean;
  readonly ownerGh: GhRunner;
  readonly createProviderExecution: () => ProviderExecutionContext;
  readonly events: ConductorEventEmitter;
  readonly log: (message: string) => void;
  /** Registers a live conductor and returns the adapter's cleanup operation. */
  readonly registerConductor: (conductor: Conductor) => () => void;
  /** Registers a rate-limit wait so this adapter can abort it during shutdown. */
  readonly registerAbortController: (controller: AbortController) => void;
  /** Whether this adapter has started its shutdown sequence. */
  readonly isShutdownRequested: () => boolean;
  /** Flushes this feature's event tail before FINISH publication. */
  readonly flushFeatureEvents: () => Promise<void>;
  /** Immutable engine identity recorded by FINISH publication. */
  readonly engineVersionId: string;
}

/** One git adapter for WorkOrder build and its executor-side verification. */
export function createWorkOrderGitRunner(projectRoot: string): WorkOrderGitRunner {
  return async (args) => {
    try {
      const { stdout, stderr } = await execFile('git', [...args], { cwd: projectRoot });
      return { exitCode: 0, stdout, stderr };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      };
    }
  };
}

export function createForcedSetupPrepare(
  prepare: typeof prepareWorktree,
  log: ((message: string) => void) | undefined,
  verbose: boolean,
  base: {
    projectRoot: string;
    baseBranch: string;
    baseSha?: string;
    events?: ConductorEventEmitter;
    dispatchStartTimeoutSeconds?: number;
    isSelfHost?: boolean;
    harnessRoot?: string;
  },
): (worktreePath: string) => Promise<void> {
  return async (worktreePath) => {
    const baseSha = base.baseSha ?? await resolveDaemonBaseSha(base.projectRoot, base.baseBranch);
    await prepare(worktreePath, log, {
      verbose,
      force: true,
      baseSha,
      events: base.events,
      dispatchStart: true,
      dispatchStartTimeoutSeconds: base.dispatchStartTimeoutSeconds,
      skillNameRoot: skillNameRootFor({
        isSelfHost: base.isSelfHost ?? false,
        worktreePath,
        harnessRoot: base.harnessRoot ?? await resolveHarnessRoot(),
      }),
    });
  };
}

export async function prepareDaemonFeatureManagedSessionContext(input: {
  readonly projectRoot: string;
  readonly worktreeRoot: string;
  readonly featureSlug: string;
  readonly dispatchId: string;
  readonly provider: string;
}): Promise<ManagedSessionContext> {
  const provisioned = await provisionManagedSessionProducerRoot(input.worktreeRoot, input.dispatchId);
  if (!provisioned.ok) throw new Error(`daemon managed-session context refused: ${provisioned.code}`);
  const prepared = await prepareManagedSessionContext({
    projectRoot: input.projectRoot,
    worktreeRoot: input.worktreeRoot,
    producerRoot: provisioned.path,
    scope: { kind: 'feature', featureSlug: input.featureSlug },
    dispatchId: input.dispatchId,
    provider: input.provider,
    daemonFeature: true,
  });
  if (!prepared.ok) throw new Error(`daemon managed-session context refused: ${prepared.code}`);
  return prepared.context;
}

export async function runDaemonRekickStackPreflight(
  options: RunStackPreflightOptions,
  log: (message: string) => void,
): Promise<StackPreflightResult> {
  const result = await runStackPreflight(options);
  if (result.kind === 'halted' || result.kind === 'unavailable') {
    log(`stack preflight ${options.slug}: ${result.kind} — ${result.detail}`);
  }
  return result;
}

export function restackResolverForStepRunner(
  stepRunner: Pick<StepRunner, 'resolveRebaseConflict'>,
): RestackResolver | undefined {
  return stepRunner.resolveRebaseConflict === undefined
    ? undefined
    : (context) => stepRunner.resolveRebaseConflict!(context);
}

export async function runDaemonFeatureConductor(
  context: DaemonFeatureLifecycleContext,
  wt: FeatureWorktree,
  item: BacklogItem,
  providerExecution = context.createProviderExecution(),
  featureEvents: ConductorEventEmitter = context.events,
  featureLog = context.log,
  sessionId = uuidv4(),
): Promise<void | OperatorParkedTermination | PreemptedTermination> {
  const {
    projectRoot, config, baseBranch, isSelfHost, effectiveDaemonConcurrency, worktreeLifecycle,
    rateLimitEpisode, readOnlyReviewCapabilities, ownerGh,
  } = context;
  const pipelineDir = join(wt.path, '.pipeline');
  await mkdir(pipelineDir, { recursive: true });
  const selectedRuntime = providerExecution.runtimes.get(providerExecution.configuredProviders[0]);
  const stateFilePath = join(pipelineDir, 'conduct-state.json');
  const stateStore = resolveConductorStateStore(stateFilePath, undefined, createStepStatusWriteRefusalDiagnostics(featureEvents));
  const baseState = await seedDaemonDispatchState(pipelineDir, item, stateStore);
  const stepRunner = new DefaultStepRunner(selectedRuntime.provider, sessionId, wt.path, {
    featureDesc: item.slug, projectRoot, pipelineDir, config, modelPolicy: selectedRuntime.policy,
    mode: 'auto', providerExecution, events: featureEvents, log: featureLog, worktreeLifecycle,
    skillNameRoot: skillNameRootFor({ isSelfHost, worktreePath: wt.path, harnessRoot: await resolveHarnessRoot() }),
  });
  const auditWriter = new AuditTrailWriter(wt.path);
  auditWriter.subscribe(featureEvents);
  const finishPublicationGit = makeFinishPublicationGit();
  const finishPublicationGh = makeProductionGh();
  const conductor = new Conductor({
    stateFilePath, stateStore, stepRunner, events: featureEvents, mode: 'auto', config,
    modelPolicy: selectedRuntime.policy, providerExecution, effectiveDaemonConcurrency,
    projectRoot: wt.path, acceptanceRedExec: createProductionAcceptanceRedExec(),
    finishPublication: createProductionFinishPublicationCoordinator({
      projectRoot: wt.path, stateFilePath, baseBranch, prTemplateBytes: config?.pr_template_bytes,
      git: finishPublicationGit, gh: finishPublicationGh, events: featureEvents,
      flushSessionEvents: context.flushFeatureEvents,
      engineVersionId: context.engineVersionId,
      repairPresentation: createProvenanceGuardedFinishPresentationRepair({
        projectRoot: wt.path, git: finishPublicationGit, gh: finishPublicationGh, baseBranch,
        log: featureLog, events: featureEvents,
      }),
      observeReleaseReadiness: createProductionReleaseReadinessObserver({ projectRoot: wt.path, config }),
    }),
    worktreeBranch: wt.branch, log: featureLog, selfHost: isSelfHost,
    liveBoundaryCoordinator: context.liveBoundaryCoordinator,
    baseBranch, verifyArtifacts: true, resume: true, daemon: true, featureSlug: item.slug,
    operatorParkBoundary: async () => {
      try {
        return await isOperatorParked(projectRoot, item.slug, (error) => featureLog(`operator park marker read failed: ${error.message}`));
      } catch (error) {
        featureLog(`operator park marker read failed: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    },
    preemptionRequested: context.preemptionRequested,
    rateLimitEpisode, readOnlyReviewCapabilities,
    registerAbortController: context.registerAbortController,
  });
  const unregisterConductor = context.registerConductor(conductor);
  try {
    const ranManualTest = getStepStatus(baseState, 'manual_test') !== 'skipped';
    // Keep a marker read fault diagnostic on the feature log at both park
    // boundaries.  The marker primitive treats a recoverable read failure as
    // not parked, so dispatch may continue, but the operator still needs the
    // reason persisted with this feature rather than lost on the root console.
    let parked = false;
    try {
      parked = await isOperatorParked(
        projectRoot,
        item.slug,
        (error) => featureLog(`operator park marker read failed: ${error.message}`),
      );
    } catch (error) {
      featureLog(`operator park marker read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (parked) {
      featureLog(`re-kick resume ${item.slug}: skipped — operator-parked (sentinel preserved)`);
      return { kind: 'operator-parked', boundary: { kind: 'pre-first-unit' } };
    }
    const rekickPath = join(pipelineDir, 'REKICK');
    const isRekick = existsSync(rekickPath);
    const stackPreflight = await runDaemonRekickStackPreflight({
      worktree: wt.path, slug: item.slug, baseRefreshDue: isRekick,
      consumeRekick: async () => { await unlinkFile(rekickPath).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); },
      rearmRekick: async () => { await writeFile(rekickPath, ''); }, events: featureEvents,
      resolver: restackResolverForStepRunner(stepRunner), resolverCap: resolveRebaseResolutionAttempts(config),
      prepareResume: async () => {
        if (await access(join(wt.path, HALT_MARKER)).then(() => true).catch(() => false)) return;
        try { await supersedeHaltRecord(wt.path, item.slug, 'stack-preflight'); }
        catch (error) { featureLog(`stack preflight could not supersede halt record: ${error instanceof Error ? error.message : String(error)}`); }
      },
    }, featureLog);
    if (stackPreflight.kind === 'halted' || stackPreflight.kind === 'unavailable') return;
    const resume = isRekick
      ? await resumeRebaseFirst({
        worktreePath: wt.path, localBase: baseBranch, events: featureEvents, ranManualTest,
        resolveAttempts: resolveRebaseResolutionAttempts(config),
        resolveConflict: stepRunner.resolveRebaseConflict ? (ctx) => stepRunner.resolveRebaseConflict!(ctx) : undefined,
        runGh: ownerGh, prUrl: baseState.pr_url, slug: item.slug, log: featureLog,
      })
      : 'skipped';
    if (resume === 'halted') return;
    if (resume === 'already_shipped') featureLog(`merged shipment evidence verified for ${item.slug}; continuing normal completion`);
    if (context.isShutdownRequested()) return;
    const conductorTermination = await conductor.run();
    if (conductorTermination) return conductorTermination;
    const finalState = await readState(stateFilePath);
    const implementationPrUrl = finalState.ok ? finalState.value.pr_url : undefined;
    const ghRunner = makeProductionGh();
    const featureMutation = item.sourceRef && implementationPrUrl
      ? await resolveFeatureRemoteMutation({ cwd: wt.path, slug: item.slug, branch: wt.branch, git: (args) => finishPublicationGit(args, { cwd: wt.path }), gh: ghRunner }) : undefined;
    const closeIssueMutation = featureMutation && implementationPrUrl ? bindMutationToPullRequest(featureMutation, implementationPrUrl) : undefined;
    await closeIssueOnImplementationMerge({
      gh: ghRunner,
      operations: closeIssueMutation ? createGuardedGithubOperationRunner(ghRunner, { cwd: wt.path, mutation: closeIssueMutation, events: featureEvents }) : undefined,
      sourceRef: item.sourceRef, prUrl: implementationPrUrl, cwd: wt.path, slug: item.slug, log: featureLog,
    });
  } finally {
    unregisterConductor();
  }
}

export async function runDaemonSetupTriage(
  context: DaemonFeatureLifecycleContext,
  error: any,
  worktree: FeatureWorktree,
  item: BacklogItem,
  providerExecution = context.createProviderExecution(),
  featureLog = context.log,
  featureEvents?: ConductorEventEmitter,
  workOrderBaseSha?: string,
) {
  if (process.env.CONDUCT_SETUP_TRIAGE_KILLSWITCH) return { kind: 'park' as const, outputTail: 'setup-triage disabled by env killswitch' };
  const git: GitRunner = makeGitRunner(worktree.path);
  const runPrepare = createForcedSetupPrepare(prepareWorktree, featureLog, context.config?.daemon_verbose ?? false, {
    projectRoot: context.projectRoot, baseBranch: context.baseBranch, baseSha: workOrderBaseSha,
    events: featureEvents, dispatchStartTimeoutSeconds: resolveDispatchStartTimeoutSeconds(context.config),
    isSelfHost: context.isSelfHost,
    harnessRoot: await resolveHarnessRoot(),
  });
  const dispatchFixSession = async () => {
    const sessionId = uuidv4();
    const selectedRuntime = providerExecution.runtimes.get(providerExecution.configuredProviders[0]);
    const stepRunner = new DefaultStepRunner(selectedRuntime.provider, sessionId, worktree.path, {
      featureDesc: `setup-fix-${item.slug}`, config: context.config, modelPolicy: selectedRuntime.policy,
      mode: 'auto', providerExecution, log: featureLog,
      skillNameRoot: skillNameRootFor({ isSelfHost: context.isSelfHost, worktreePath: worktree.path, harnessRoot: await resolveHarnessRoot() }),
    });
    featureLog(`[setup-triage] fix-session dispatched for ${item.slug} (session ${sessionId})`);
    return stepRunner.resolveSetupFailure({ worktreePath: worktree.path, outputTail: error.outputTail ?? '', slug: item.slug });
  };
  return runSetupFailureTriage(git, worktree.path, item.slug, error, runPrepare, dispatchFixSession, { log: featureLog }, featureEvents);
}
