import type { ConductState, FinishPublicationEvent, StepName, StepStatus, Phase, RunMode, RecoveryContext, RecoveryOption, ComplexityTier } from '../types/index.js';
import type { ConductorEventEmitter } from '../ui/events.js';
import type { SchedulingUnitRef } from '../types/scheduling-unit.js';
import type { ConductStateStore } from './conduct-state-store.js';
import type { StepRunner, StepRunResult } from './step-runner-types.js';
import type { PublicationDisposition, PrProseAuthoringRequest, PrProseJudgmentRequest } from './finish-publication.js';
import type { HarnessConfig } from '../types/config.js';
import type { ProviderModelPolicy } from './provider-model-policy.js';
import type { ProviderExecutionContext } from './provider-execution.js';
import type { FullSuiteVerifier } from './full-suite-verifier.js';
import type { CompletionContext } from './artifacts.js';
import { chargeBuildReviewEffectInLedger } from './kickback-ledger.js';
import { resolveFeatureRemoteMutation, executeRemoteGit } from './remote-git-operations.js';
import { createShipDraftPublicationDependencies } from './ship-draft-pr.js';
import type { GithubMutationExecutionContext } from './tracker-client.js';
import type { SelfHostGuardrails } from './self-host/wiring.js';
import type { LiveBoundaryCoordinator } from './self-host/live-boundary-coordinator.js';
import type { EscalateBuildFailureOpts, EscalateBuildFailureResult } from './build-failure-escalation.js';
import type { GhRunner } from './owner-gate/identity.js';
import type { GitRunner } from './pr-labels.js';
import type { VerifiedMergedPrResult } from './merged-pr-guard.js';
import type { ShipmentEvidenceInput, ShipmentEvidenceResult } from './shipment-evidence.js';
import type { RateLimitEpisode } from './rate-limit-episode.js';
import type { ReadOnlyReviewCapability } from './build-review-read-only-capability.js';
import type { performRebase } from './rebase.js';
import type { RemediationProjectionLimits } from './remediation-projection.js';
import type { resolveActiveChild } from './child-cursor.js';
import type { advanceChildRegion, enterChildRegion } from './child-lifecycle.js';

export type CheckpointResponse = 'continue' | 'back' | 'quit';

export type { SchedulingUnitRef } from '../types/scheduling-unit.js';

export interface OperatorParkedTermination {
  kind: 'operator-parked';
  boundary: SchedulingUnitRef;
}
export interface NavigableStep {
  name: StepName;
  label: string;
  status: StepStatus;
  phase: Phase;
}
export type ArtifactReviewResult = 'approved' | 'rejected' | 'skip';

/**
 * Engine-owned FINISH publication composition. The coordinator owns every
 * deterministic publication effect and invokes `dispatchJudgment` only when
 * observed PR title/body prose needs a single quality pass.
 */
export interface FinishPublicationCoordinator {
  /** Production coordinators retain the current-HEAD SHIP-evidence fence. */
  requiresArtifactValidation?: boolean;
  advance(input: {
    state: ConductState;
    mode: RunMode;
    daemon: boolean;
    dispatchJudgment(request: PrProseJudgmentRequest): Promise<StepRunResult>;
    /**
     * The authoring pass that guarantees the judgment above never sees an
     * unauthored body. Optional so an existing coordinator implementation keeps
     * compiling; the coordinator fails closed on an unwired effect.
     */
    dispatchAuthoring?(request: PrProseAuthoringRequest): Promise<StepRunResult>;
    emit(event: FinishPublicationEvent): Promise<void>;
  }): Promise<PublicationDisposition>;
}

export interface ConductorOptions {
  stateFilePath: string;
  /**
   * Persistent state authority for conductor-owned mutations. Production
   * defaults to the filesystem adapter; tests and future hosted composition
   * may supply another implementation of the same port.
   */
  stateStore?: ConductStateStore<ConductState>;
  stepRunner: StepRunner;
  events: ConductorEventEmitter;
  featureSlug?: string;
  /**
   * Region lifecycle seams. Production uses the real cursor and lifecycle
   * helpers; focused conductor tests use these to prove terminal routing
   * without making a git race part of the loop fixture.
   */
  childRegionLifecycle?: {
    resolveActiveChild?: typeof resolveActiveChild;
    enterChildRegion?: typeof enterChildRegion;
    advanceChildRegion?: typeof advanceChildRegion;
  };
  operatorParkBoundary?: () => Promise<boolean>;
  resume?: boolean;
  fromStep?: StepName;
  mode?: RunMode;
  /** Optional engine-owned FINISH publication coordinator. */
  finishPublication?: FinishPublicationCoordinator;
  config?: HarnessConfig;
  /**
   * Provider-specific retry escalation ladder. Optional while callers migrate;
   * Claude remains the compatibility default.
   */
  modelPolicy?: ProviderModelPolicy;
  /** Shared provider routing state owned by this conductor run. */
  providerExecution?: ProviderExecutionContext;
  /**
   * Resolved daemon executor-pool width. The daemon command layer supplies the
   * CLI-or-config result; direct callers fall back to the validated config
   * value. This fences compatibility dispatches that mutate process.env.
   */
  effectiveDaemonConcurrency?: number;
  projectRoot: string;
  /** Feature-scoped daemon logger; defaults to console warnings outside a feature run. */
  log?: (message: string) => void;
  /** Injectable native aggregate-suite verifier; production uses FullSuiteVerifier. */
  fullSuiteVerifier?: Pick<FullSuiteVerifier, 'ensure' | 'inspect'> &
    Partial<Pick<FullSuiteVerifier, 'recordPreservation'>>;
  /** Test seam for the engine-owned rebase adapter. */
  performRebase?: typeof performRebase;
  /** Test seam for the disposition-aware build_review completion join. */
  buildReviewEffectiveResolver?: CompletionContext['buildReviewEffectiveResolver'];
  /** Test seam for an adjudicated action-effect charge failure. */
  buildReviewChargeEffect?: typeof chargeBuildReviewEffectInLedger;
  /** Test-only bound override for deterministic remediation projection faults. */
  remediationProjectionLimitOverrides?: Partial<RemediationProjectionLimits>;
  /** Test seam; production resolves fresh committed feature evidence. */
  resolveFeatureCreationMutation?: typeof resolveFeatureRemoteMutation;
  /** Test seam; production resolves fresh guarded publication dependencies. */
  resolveShipDraftPublicationDependencies?: typeof createShipDraftPublicationDependencies;
  /** Test seam for the guarded SHIP-start remote transport. */
  shipDraftRemoteGit?: typeof executeRemoteGit;
  /** Test seam for the guarded post-finish shipped-record publication context. */
  postFinishRemoteMutation?: GithubMutationExecutionContext;
  /** Feature description — used by the engine-run worktree step to name the
   *  worktree/branch when state.feature_desc isn't set yet. */
  featureDesc?: string;
  /** Caller-known feature worktree branch to persist for SHIP consumers. */
  worktreeBranch?: string;
  /**
   * When true, after each step that declares artifact globs, require at least
   * one matching file on disk. If not, mark the step failed and route through
   * the recovery menu. Default: false (opt-in — production wires this on).
   */
  verifyArtifacts?: boolean;
  /**
   * Daemon mode. Enables daemon-specific lifecycle behavior such as terminal
   * markers, automated rebase, and remediation routing. Default false.
   */
  daemon?: boolean;
  /**
   * Harness self-host mode (Phase 6). True only when the daemon is building the
   * harness repo ITSELF, as classified once at the daemon layer by
   * `classifySelfHost` (path identity + config override). Combined with `daemon`
   * it activates the self-host guardrail bundle (skill relink + sandboxed build
   * env + VERSION/release finish gates) as one unit; for every other repo it is
   * false and the build path is byte-for-byte unchanged. Default false.
   */
  selfHost?: boolean;
  /**
   * Base branch the self-build's changes are diffed against (`<base>...HEAD`) to
   * classify breaking surfaces for the release-artifact migration gate (TR-10).
   * Only consulted for a self-build; absent → the change set is undeterminable
   * and the migration gate fails closed (requires a migration block). Default
   * undefined.
   */
  baseBranch?: string;
  /**
   * Self-host guardrail collaborators (relink / sandbox / finish gates). Injected
   * as one bundle so tests can drive the wired path hermetically. Defaults to the
   * real primitives (`defaultSelfHostGuardrails`).
   */
  selfHostGuardrails?: SelfHostGuardrails;
  /** Shared daemon owner for root mutations and per-dispatch boundary windows. */
  liveBoundaryCoordinator?: LiveBoundaryCoordinator;
  /**
   * Maximum auto-retries before a failing step (including artifact miss)
   * escalates to the recovery menu.
   * Default: 3.
   */
  maxRetries?: number;
  /**
   * Sleep implementation for rate-limit waits. Defaults to setTimeout.
   * Tests inject a spy to avoid real waits.
   */
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Injected command runner for the acceptance_specs RED-evidence self-heal
   * (Task 9, acceptance-specs-halts-when-the-red-evidence-marke). Signature
   * mirrors every other subprocess-boundary injectable in this file (`gh`,
   * `git`, `runGh`, `escalateBuildFailure`): production wires the real
   * `execFile`-based runner; tests inject a stub. Defaults to a real
   * `child_process.execFile` (promisified) invocation of `contract.command`
   * from `contract.cwd`.
   */
  acceptanceRedExec?: (command: string, cwd: string) => Promise<unknown>;
  onCheckpoint?: (step: StepName) => Promise<CheckpointResponse>;
  onNavigate?: (steps: NavigableStep[]) => Promise<StepName | null>;
  onReviewArtifacts?: (step: StepName, files: string[]) => Promise<ArtifactReviewResult>;
  onRecovery?: (
    step: StepName,
    isGating: boolean,
    context?: RecoveryContext,
  ) => Promise<RecoveryOption>;
  onComplexityAssessment?: (recommended: ComplexityTier | null) => Promise<ComplexityTier>;
  /**
   * Injectable escalation function called after any irrecoverable daemon HALT
   * in auto mode. Defaults to the real `escalateBuildFailure` which opens a
   * draft needs-remediation PR. Tests inject a spy to avoid real gh/git calls.
   * The conductor wraps every call in try/catch — a throwing escalation must
   * never prevent the HALT marker or state from being written (C1).
   * Not called for rebase-conflict HALTs (pushing mid-rebase is unsafe).
   */
  escalateBuildFailure?: (opts: EscalateBuildFailureOpts) => Promise<EscalateBuildFailureResult>;
  /**
   * Shell runner for the `gh` CLI (owner identity resolution). Injected for
   * tests; defaults to the real production gh. Used to resolve machine-scoped
   * operator identity for plan-step owner stamping (Slice B, D4).
   */
  gh?: GhRunner;
  /**
   * Shell runner for the `git` CLI (push-evidence verification). Injected for
   * tests; defaults to the real production git. Used to verify push status
   * in the finish gate (daemon false-ship guard).
   */
  git?: GitRunner;
  /**
   * Shell runner for the `gh` CLI (merged-PR guard). Injected for
   * tests; defaults to the real production gh. Used by the merged-PR guard
   * to check recorded PR merge state at kickback and rebase entry points
   * (ADR-2026-07-09-mid-run-merged-pr-guard, Task 3-5).
   */
  runGh?: GhRunner;
  /**
   * Test seam for the strict merged-history verifier. Production always uses
   * `verifyMergedPrShipment`; a valid verdict still follows the normal gate
   * loop instead of fabricating terminal markers.
   */
  verifyMergedShipment?: (
    prUrl: string,
    slug: string,
  ) => Promise<VerifiedMergedPrResult>;
  /** Test seam for the finish completion gate's strict evidence verifier. */
  shipmentEvidence?: (input: ShipmentEvidenceInput) => Promise<ShipmentEvidenceResult>;
  /**
   * Optional rate-limit episode coordinator (Task 10). When provided and active,
   * enables coordinated episode-aware backoff during rate-limit waits, allowing
   * SIGTERM handling and deadline-coordinated redrives. If undefined, rate-limit
   * handling falls back to bare sleep (existing behavior).
   */
  rateLimitEpisode?: RateLimitEpisode;
  /** Frozen daemon-start capability observations for custom build-review candidates. */
  readOnlyReviewCapabilities?: Readonly<Record<string, ReadOnlyReviewCapability>>;
  /**
   * Task 22: Callback to register an in-flight rate-limit wait AbortController
   * with the daemon-level handler. Called when a conductor creates a wait controller
   * so process-level SIGTERM can abort all in-flight waits across N concurrent conductors.
   * Only used in daemon mode; in interactive mode, per-conductor SIGTERM handlers
   * manage individual controllers. Optional — if absent, the conductor works normally
   * but its wait controller won't be aborted by process-level SIGTERM.
   */
  registerAbortController?: (controller: AbortController) => void;
  /**
   * Process termination boundary for signal handling. Production exits the
   * process; tests inject a recorder so signal-persistence behavior can run
   * without terminating the Vitest worker.
   */
  exitProcess?: (code: number) => void;
}
