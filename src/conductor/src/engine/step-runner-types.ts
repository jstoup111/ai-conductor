import type { BuildReviewRepairProvenance } from './build-review-inputs.js';
import type { CoverageBindingPayloadError } from './step-runners.js';
import type { AuthenticationReadiness, CodexProbeFailure, ProviderExitFacts, TokenUsage } from '../execution/llm-provider.js';
import type { ObservedInterval } from '../execution/observed-interval.js';
import type { ManagedGhObservationCoverage } from '../execution/managed-session-preparation.js';
import type { ConductState, ExecutionContext } from '../types/index.js';
import type { StepName, ComplexityTier, EffortLevel } from '../types/index.js';
import type { FullSuiteVerifierResult } from './full-suite-verifier.js';
import type { ProviderSessionScope } from './provider-session.js';
import type { ProviderAttemptMetadata, ProviderAttributionMetadata } from './provider-execution.js';
import type { ProviderSetupExhaustion } from './provider-setup-failure.js';
import type { AcceptedWideningDecision } from './accepted-widenings.js';
import type { ReadOnlyReviewCapability } from './build-review-read-only-capability.js';
import type { RemediationProjection } from './remediation-projection.js';
import type { CiFailureContext, CiFailureAttempt, GitRunner as RebaseGitRunner, ResolutionContext, ResolutionAttempt, SetupFailureContext, SetupFailureAttempt } from './rebase.js';

export interface StepRunResult {
  success: boolean;
  /** Pending-repair settlement halted BUILD at its final admission boundary. */
  pendingRepairSettlementHalt?: true;
  /** A queued self-host dispatch was parked before admission; no provider ran. */
  operatorParkedBeforeDispatch?: true;
  output?: string;
  /** Bounded facts from an unclassified provider exit, forwarded to close events. */
  exitFacts?: ProviderExitFacts;
  /** Native-schema terminal value, retained verbatim for engine validation. */
  finalStructuredResult?: unknown;
  /** A typed refusal is an entry/environment outcome, never provider text. */
  refusal?: {
    kind: 'seal' | 'needs-human' | 'validation-verdict';
    reason: string;
  };
  /** Retryable typed infrastructure failure from the coverage-binding judge. */
  infrastructureFailure?: Pick<CoverageBindingPayloadError, 'name' | 'kind' | 'reason'>;
  /** True only when this build-review lap observed an infrastructure fault. */
  currentLapMechanicalFault?: boolean;
  /** A custom review had no provider with an available read-only review mode. */
  buildReviewReadOnlyReviewUnavailable?: true;
  /**
   * Typed only by the FINISH composition boundary. Kept unknown at this edge
   * so malformed adapter results fail closed instead of reaching remediation.
   */
  publicationDisposition?: unknown;
  /** Engine-observed provider subprocess intervals, forwarded without reinterpretation. */
  observedIntervals?: readonly ObservedInterval[];
  /** Bounded completeness of managed gh observation for this step outcome. */
  managedGhObservationCoverage?: ManagedGhObservationCoverage;
  /** Engine-native aggregate-suite result retained for Task 17 failure routing. */
  fullSuiteVerification?: FullSuiteVerifierResult;
  /**
   * Set when re-dispatching this step cannot change its inputs. The named
   * prerequisite must complete before another attempt can make progress.
   */
  unretryableInputs?: {
    retryAfterStep: StepName;
  };
  /** Deterministic as-built input/capability failures never enter retries. */
  asBuiltFault?: { kind: 'input' | 'capability'; reason: string };
  /** Deterministic PRD-audit input/capability failures never enter retries. */
  prdAuditFault?: { kind: 'input' | 'capability'; reason: string };
  /** Provider routing identity and ordered candidate-attempt accounting. */
  preferredProvider?: string;
  actualProvider?: string;
  attempts?: ProviderAttemptMetadata[];
  /**
   * Set when the provider detected a rate-limit signal in the output (or via
   * marker file). The conductor waits `waitSeconds` and retries without
   * burning the retry budget.
   */
  rateLimited?: boolean;
  /** The rate-limit signal is a hard usage-cap exhaustion, not a transient throttle. */
  usageExhausted?: boolean;
  /**
   * Number of seconds to wait before retrying after a rate-limit. Default 300.
   */
  waitSeconds?: number;
  /**
   * Task 18: Parsed absolute deadline (milliseconds since epoch) from rate-limit message.
   * When set, represents a timezone-aware reset time extracted from the message
   * (e.g., "resets 3:20pm (America/New_York)"). Used by the episode coordinator
   * for deadline-first scheduling. Undefined if timezone is unknown or not present.
   */
  deadline?: number;
  /**
   * Set when the operator's OAuth token is expired or invalid.
   * The conductor halts and reports the auth failure.
   */
  authFailure?: boolean;
  /** The provider reported that the exact dispatched slash command is unavailable. */
  commandUnresolved?: boolean;
  /** The unavailable command name, without its leading slash. */
  commandUnresolvedName?: string;
  /** A provider's automatic permission review denied the requested action. */
  permissionDenied?: boolean;
  /** Every configured candidate was explicitly unavailable before invocation. */
  providerSetupExhaustion?: ProviderSetupExhaustion;
  /**
   * Set by the runner's dispatch preflight when the step's working directory
   * (the feature worktree) no longer exists. Terminal for this run: no provider
   * was launched, retrying cannot recreate the path, and every later step would
   * fail the same way. The conductor halts with this classified reason instead
   * of burning the retry ladder on an opaque provider error.
   */
  worktreeMissing?: boolean;
  /** Provider-owned, sanitized authentication readiness for this dispatch. */
  authentication?: AuthenticationReadiness;
  /**
   * #814: set when a judged-gate grader (today: build_review) could not be
   * DISPATCHED — the grader subprocess/session failed to run or exited without
   * producing a verdict, as opposed to running and returning a not-PASS verdict
   * (which arrives as `success:true` and is caught by the completion predicate,
   * then routed as a kickback to build). This is an INFRASTRUCTURE failure: the
   * conductor backs off between retries instead of burning the whole ladder in
   * milliseconds, and names the dispatch failure in the HALT reason. It is never
   * set when the grader ran and produced a real FAIL.
   */
  graderDispatchFailed?: boolean;
  /**
   * Task 3 (per-feature token accounting): token usage reported by the
   * provider for this invocation, when available. Forwarded from
   * `InvokeResult.tokenUsage` on the success path so callers can attribute
   * cost/tokens to the step and feature.
   */
  tokenUsage?: TokenUsage;
  /**
   * Task 3 (per-feature token accounting): the resolved model string actually
   * used for this invocation (post model-availability/ladder resolution).
   */
  model?: string;
  /** Resolved provider effort level actually used for this invocation. */
  effort?: EffortLevel;
  /**
   * Task 4 (build-review-grades-plan-vs-diff-against-a-stale-o): base-
   * freshness evidence from `assembleBuildReviewInputs`, set on every
   * `runBuildReview` return path once inputs were successfully assembled.
   * Pure telemetry — the conductor emits a `build_review_base` event from
   * it and never lets it affect step outcome.
   */
  baseFreshness?: {
    mergeBase: string;
    trackingRefSha: string | null;
    remoteHeadSha: string | null;
    fresh: boolean;
    /** Advisory commit records Git found patch-equivalent to the review base. */
    filteredCommits?: readonly { readonly sha: string; readonly subject: string }[];
    /** Advisory paths excluded from the graded diff by those commit records. */
    excludedPaths?: readonly string[];
  };
  /**
   * Task 24 (rebase-invalidated-test-failures-never-reach-build): which of the
   * three repair-context cases this build_review graded under, from
   * `assembleBuildReviewInputs`. Pure telemetry — the conductor emits a
   * `build_review_repair_context` event from it and never lets it affect the
   * step outcome.
   */
  repairProvenance?: BuildReviewRepairProvenance;
}

/**
 * Keep the persisted BUILD outcome rung identical to the rung used by the
 * no-movement admission guard.  A runner can resolve a different actual
 * model/effort than the base configuration, so `resolved` is deliberately not
 * an input here.
 */
export function buildOutcomeRung(
  result: Pick<StepRunResult, 'model' | 'effort'> | undefined,
  escalation: { model: string; effort: EffortLevel },
): { model: string; effort: EffortLevel } {
  return {
    model: result?.model ?? escalation.model,
    effort: result?.effort ?? escalation.effort,
  };
}

export interface SpotAuditDispatchResult {
  success: boolean;
  output?: string;
  providerSetupExhaustion?: ProviderSetupExhaustion;
  observedIntervals?: readonly ObservedInterval[];
  authFailure?: boolean;
  authentication?: AuthenticationReadiness;
}

export type AuthRecoveryDisposition =
  | { disposition: 'recovered' }
  | { disposition: 'trial-required'; probeFailure: CodexProbeFailure }
  | { disposition: 'halt'; haltReason: string };

/** Renders only the closed probe classification retained across recovery. */
export function formatProbeFailureClassification(probeFailure: CodexProbeFailure): string {
  const parserRejection = probeFailure.facts.parserRejection;
  return `${probeFailure.kind}${parserRejection === undefined ? '' : `, parser-rejection: ${parserRejection}`}`;
}

/** Preserve recovery metadata when adapting a verifier dispatch for spot audit. */
export function toSpotAuditVerifierResult(
  result: SpotAuditDispatchResult,
): SpotAuditDispatchResult & { output: string } {
  return {
    success: result.success,
    output: result.output ?? '',
    ...(result.observedIntervals
      ? { observedIntervals: result.observedIntervals }
      : {}),
    ...(result.providerSetupExhaustion
      ? { providerSetupExhaustion: result.providerSetupExhaustion }
      : {}),
    ...(result.authFailure !== undefined ? { authFailure: result.authFailure } : {}),
    ...(result.authentication ? { authentication: result.authentication } : {}),
  };
}

/**
 * #814: backoff (ms) before re-dispatching a grader whose previous dispatch
 * failed to run. Exponential with a cap so a transient spawn/startup failure has
 * time to clear, without materially slowing a healthy grader (which itself runs
 * for minutes). `attempt` is the 1-based number of the attempt about to run.
 */
export function graderDispatchBackoffMs(attempt: number): number {
  const BASE_MS = 2000;
  const CAP_MS = 30000;
  const exp = BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(CAP_MS, exp);
}

export interface ComplexityAssessment extends ProviderAttributionMetadata {
  tier: ComplexityTier | null;
}

export interface StepRunOptions {
  /** Per-dispatch cancellation authority for the provider invocation. */
  abortSignal?: AbortSignal;
  /** Configured skill path for a concurrent-group branch dispatch. */
  branchSkill?: string;
  /** Daemon-start capability observations for custom build-review candidates. */
  readOnlyReviewCapabilities?: Readonly<Record<string, ReadOnlyReviewCapability>>;
  /**
   * Durable PRD widening authority rendered by the engine for an audit
   * reviewer. It is history for judgement only: the reviewer cannot use it to
   * accept a current finding or copy it into a replacement report.
   */
  prdWideningReviewContext?: {
    readonly version: 'v1';
    readonly decisions: readonly AcceptedWideningDecision[];
  };
  /** Engine-owned constrained reconciliation through the existing remediate step. */
  remediationRequest?: {
    readonly mode: 'prd-widening-reconciliation';
    readonly projection: string;
    readonly nativeSchema: Readonly<Record<string, unknown>>;
  } | {
    /** Engine-owned input for a provider-native remediation disposition plan. */
    readonly mode: 'gap-plan';
    readonly projection: RemediationProjection;
  };
  /**
   * This dispatch's engine-owned run identity, passed INTO the provider
   * lifecycle so its `attempt.id` is this exact value
   * (adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity D1). One id
   * authority per dispatch: the value logged by the lifecycle is the value
   * stamped into the verdict sidecar and read back by every identity reader.
   * Absent for dispatches outside the identity seam, which keep the runner's
   * own run-scoped attempt-id format.
   */
  runId?: string;
  /** Existing-spine correlation for this one invocation; never runner-global state. */
  executionContext?: ExecutionContext;
  /**
   * Retry hint injected into the system prompt when the conductor re-invokes
   * this step after a completion-gate miss. Example: "previous attempt did not
   * produce .docs/plans/*.md".
   */
  retryReason?: string;
  /**
   * Concurrent-group branch dispatch only (group-core.ts): a locally-minted
   * session id that overrides the runner's shared `this.sessionId` so the
   * branch never touches the main conductor session (adr-2026-07-10-
   * concurrent-group-core.md). Absent for ordinary serial-loop steps.
   */
  sessionId?: string;
  /**
   * FINISH publication dispatch only: which bounded provider pass this
   * invocation is. `author` mandates writing the retained PR's reader-facing
   * title and body from the feature's own diff; `judge` mandates the bounded
   * quality verdict. The publication coordinator selects it deterministically
   * from its own observation of the PR body, so the provider is never left to
   * infer which job it has.
   */
  finishProsePass?: 'author' | 'judge';
  /**
   * Concrete objection from the prior judgment of the retained PR revision.
   * Present only for a bounded authoring revision lap; omitted when the body
   * has not been authored yet.
   */
  revisionGuidance?: string;
  /**
   * Concurrent-group branch dispatch only: whether this branch dispatch
   * should resume `sessionId` above (true on retry) or start it fresh
   * (false on the branch's first attempt). Absent for ordinary serial-loop
   * steps, where resume is derived from the runner's own session state.
   */
  resume?: boolean;
  /**
   * Concurrent-group provider-aware dispatch only: a detached session scope
   * owned by this member execution. It keeps provider sessions isolated from
   * both sibling branches and the serial conductor session.
   */
  providerSessions?: ProviderSessionScope;
  /**
   * The Conductor-owned, 1-based retry attempt. Provider-aware runners forward
   * this unchanged so a fallback provider can resolve its own native escalation
   * rung without deriving retry state from invocation/session counters.
   */
  attempt?: number;
  /**
   * Whether the current step's retry ladder is enabled. Forwarded with
   * `attempt` so fallback providers preserve `escalate:false`.
   */
  escalate?: boolean;
  /**
   * Retry-as-escalation per-attempt overrides (#188). When set, the runner
   * dispatches at this model/effort instead of the step's resolved base. The
   * conductor computes them from `escalateAttempt(base, attempt, escalate)` on
   * each attempt; the runner still routes `modelOverride` through
   * `ModelAvailability.effectiveModel` so the escalated tier composes with the
   * #186 availability ladder. Absent on attempt 1 / when `escalate:false`.
   */
  modelOverride?: string;
  effortOverride?: EffortLevel;
}

export interface StepRunner {
  run(step: StepName, state: ConductState, opts?: StepRunOptions): Promise<StepRunResult>;
  /** Run identity held by provider-aware runners for self-host scratch leases. */
  selfHostRunId?(): string;
  /** Resolve the effective retry-escalation policy for a detached branch. */
  escalateForStep?(step: StepName, state: ConductState): boolean;
  /**
   * Create a detached provider-session scope for one concurrent-group member.
   * Legacy runners omit this seam and continue using scalar branch sessions.
   */
  beginProviderBranch?(step: StepName): ProviderSessionScope | undefined;
  runInteractive?(
    step: StepName,
    failureContext: { reason?: string },
  ): Promise<void>;
  assessComplexity?(): Promise<ComplexityTier | ComplexityAssessment | null>;
  /**
   * Drop session state so the next invocation creates a fresh provider session.
   * Called by the conductor before a step's first dispatch. `providerKey`
   * targets one provider; absent, the runner's captured provider is reset.
   */
  resetSession?(step?: StepName, providerKey?: string): Promise<void>;
  /**
   * Attempt to resolve a paused rebase conflict in the feature worktree.
   * Called by the conductor's engine-native rebase step (daemon only) when
   * a `conflict_halt` outcome is produced and `rebase_resolution_attempts > 0`.
   *
   * The implementation MUST resolve the conflict files, stage them (`git add`),
   * and run `git rebase --continue` so the rebase finishes. Returning
   * `{ resolved: true }` when the rebase is NOT actually finished is treated as
   * a failed attempt (counted toward the cap but retried). Returning
   * `{ resolved: false, reason }` short-circuits all remaining attempts
   * (the conductor HALTs immediately with `reason` in the HALT file).
   *
   * Errors thrown by this method are caught and converted to
   * `{ resolved: false, reason: error.message }`, so an uncaught exception
   * degrades gracefully to a conflict HALT.
   */
  resolveRebaseConflict?(ctx: ResolutionContext): Promise<ResolutionAttempt>;
  /**
   * Post-rebase evidence-citation translation capability (Task 15,
   * adr-2026-07-12-rebase-evidence-stamp-translation.md), threaded into
   * `performRebase`'s `opts.translateAfterRebase`. Optional purely for DI/test
   * override — production wiring defaults to the real
   * `rebase-translate.ts#translateAfterRebase` when this is absent (see
   * `runRebaseStep`), so real daemon runs always translate.
   */
  translateAfterRebase?(
    git: RebaseGitRunner,
    projectRoot: string,
    onto: string,
    origHead: string,
    head: string,
    flatten?: import('./rebase.js').FlattenedReplayPlan,
  ): Promise<void>;
  /**
   * Dispatch a semantic attribution verifier session for spot-audit sampling.
   * Called by the conductor's build-gate post-green dispatch (Task 15).
   *
   * The verifier runs in a fresh session with the provided residue task IDs,
   * collects candidate commits, and produces an attribution verdict.
   * This method is optional — runners may choose not to expose dispatch.
   */
  dispatchVerifier?(opts: {
    residueIds: string[];
    planPath: string;
    projectRoot: string;
  }): Promise<SpotAuditDispatchResult>;
  /**
   * Dispatch the post-rebase regrade judgement (ADR-2026-07-20 amendment).
   * Optional: a runner without it makes a changed replay fail closed.
   */
  dispatchRebaseRegradeJudgement?(prompt: string): Promise<{ success: boolean; output?: string }>;
  /**
   * Dispatch a fix-session to resolve a setup failure. Part of the two-stage
   * setup-failure triage (TS-3). Uses a fresh one-shot session (never resumes
   * the main conductor session) with the output tail in the system prompt.
   *
   * Always returns `{ attempted: true }` — the success of the fix is determined
   * by whether the setup step subsequently passes, not by this method's result.
   * Used to bootstrap a fresh session that attempts to fix the root cause so
   * the setup step can be retried.
   */
  resolveSetupFailure?(ctx: SetupFailureContext): Promise<SetupFailureAttempt>;
  /**
   * Dispatch a fix-session to resolve a CI failure on a shipped PR. Uses a
   * fresh one-shot session (never resumes the main conductor session) with
   * the failure hint in the prompt so Claude can diagnose and fix it.
   *
   * Always returns `{ attempted: true }` — the success of the fix is
   * determined by whether CI subsequently passes, not by this method's
   * result.
   */
  resolveCiFailure?(ctx: CiFailureContext): Promise<CiFailureAttempt>;
}
