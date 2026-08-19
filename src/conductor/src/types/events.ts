import type { StepName, StepStatus, ComplexityTier } from './steps.js';
import type { BootstrapMode } from './state.js';
import type {
  AuthenticationReadinessState,
  AuthenticationSource,
  CodexProbeFailureKind,
  CodexProbeParserRejection,
  TokenUsage,
} from '../execution/llm-provider.js';
import type { ObservedInterval } from '../execution/observed-interval.js';
import type { SchedulingUnitRef } from './scheduling-unit.js';

export type RecoveryOption = 'retry' | 'interactive' | 'back' | 'skip' | 'quit';

/** Identity is deliberately explicit when a retention decision has no readable lease. */
type ScratchCleanupIdentityValue = string | 'unknown';
type ScratchCleanupAttempt = number | 'unknown';

/** Closed, credential-safe FINISH publication observability vocabulary. */
export type FinishPublicationTransition =
  | 'establish_pr'
  | 'verify_release_readiness'
  | 'author_pr_prose'
  | 'judge_pr_prose'
  | 'write_shipped_record'
  | 'ready_pr'
  | 'record_outcome';

/** Exact deterministic blockers; messages, URLs, and adapter diagnostics stay outside telemetry. */
export type FinishPublicationBlocker =
  | 'publication_snapshot_incoherent'
  | 'publication_snapshot_indeterminate'
  | 'implementation_evidence_invalid'
  | 'implementation_evidence_indeterminate'
  | 'ship_evidence_invalid'
  | 'ship_evidence_indeterminate'
  | 'release_readiness_missing'
  | 'release_readiness_invalid'
  | 'release_readiness_indeterminate';

export type FinishPublicationEvent =
  | {
      type: 'finish_publication_transition';
      phase: 'started' | 'completed';
      transition: FinishPublicationTransition;
    }
  | { type: 'finish_publication_blocked'; condition: FinishPublicationBlocker }
  | {
      type: 'finish_publication_disposition';
      disposition: 'retry_finish' | 'retry_build' | 'human_required' | 'complete';
    };

/** Closed, non-diagnostic context for credential-park progress telemetry. */
export type CredentialParkProgressDegradation =
  | 'credential-failure'
  | 'unrelated-diagnostic-degradation';

type CredentialParkProgressEventBase = {
  type: 'credentials_park_progress';
  provider: 'codex';
  source: AuthenticationSource;
  elapsedSeconds: number;
};

type CredentialParkProgressEvent = CredentialParkProgressEventBase &
  (
    | {
        readiness: Exclude<AuthenticationReadinessState, 'probe-failed'>;
        degradation: CredentialParkProgressDegradation;
        nextProbeDelaySeconds: number;
        probeFailureKind?: never;
        nextDisposition?: never;
      }
    | {
        readiness: 'probe-failed';
        degradation: 'probe-failure';
        probeFailureKind: CodexProbeFailureKind;
        /** Closed, secret-safe parser reason from the current failed probe. */
        parserRejection?: CodexProbeParserRejection;
        nextDisposition: 'trial-required';
        nextProbeDelaySeconds?: never;
      }
  );

export type VerdictFreshnessOutcome =
  | 'rewritten'
  | 'preserved_surface_miss'
  | 'stale_invalidated';

export type VerdictFreshnessClassification =
  | {
      outcome: 'rewritten' | 'preserved_surface_miss';
      fresh: true;
    }
  | {
      outcome: 'stale_invalidated';
      fresh: false;
    };

/**
 * Extra state threaded into onRecovery so the UI can adapt its menu
 * without the engine dictating the layout.
 *
 * - `recoveryCount` — how many times the user has entered the recovery
 *   menu for this step in the current session (0 on first entry).
 * - `retriesExhausted` — `true` when the per-step recovery-retry budget
 *   has been hit. The UI SHOULD drop `retry` from the offered options
 *   when this is set; the engine will loop back to the menu if it
 *   receives `retry` anyway (so the worst case is the user sees the
 *   same menu twice, not an infinite retry storm).
 */
export interface RecoveryContext {
  recoveryCount: number;
  retriesExhausted: boolean;
}

/** Lifecycle diagnostics carried on the existing provider-attempt event stream. */
export interface ProviderLifecycleEventMetadata {
  phase: 'preparing' | 'running' | 'recovering' | 'settled' | 'exhausted';
  attemptId: string;
  recoveryCount: number;
  reason?: 'preparation-timeout' | 'preparation-timeout-exhausted';
  outcome?: 'completed' | 'failed';
}

/** One provider candidate result or lifecycle transition within a step attempt. */
export interface ProviderAttemptEvent {
  type: 'provider_attempt';
  step: StepName;
  provider: string;
  /** Sanitized Codex authentication source; omitted for other providers. */
  authenticationSource?: 'api-key' | 'cached-login';
  outcome: 'success' | 'failure' | 'unavailable';
  /** False when a cached run-wide unavailability avoided process dispatch. */
  invoked: boolean;
  model?: string;
  tokenUsage?: TokenUsage;
  observedIntervals?: readonly ObservedInterval[];
  reason?: string;
  fallbackReason?: string;
  lifecycle?: ProviderLifecycleEventMetadata;
}

export type ConductorEvent =
  | { type: 'build_review_rubric_started'; rubric: string; lapId: string }
  | {
      /** The self-host dispatch was proven contained, so this concurrent drift is not a dispatch leak. */
      type: 'contained_live_checkout_drift';
      evidence: string;
      attribution: 'concurrent-operator';
      summary: string;
    }
  | {
      /** The containment verdict for one completed self-host dispatch verification closure. */
      type: 'self_host_containment_verdict';
      contained: true;
      evidence: string;
    }
  | {
      /** The containment verdict for one completed self-host dispatch verification closure. */
      type: 'self_host_containment_verdict';
      contained: false;
      reason: string;
    }
  /** Serialized rubric-prompt size at dispatch — regression visibility for projection bloat. */
  | { type: 'build_review_rubric_prompt'; rubric: string; lapId: string; promptBytes: number }
  | { type: 'build_review_rubric_result'; rubric: string; lapId: string; verdict: 'PASS' | 'FAIL' }
  | { type: 'build_review_rubric_skipped'; rubric: string; lapId: string; reason: string }
  | { type: 'build_review_cache_hit'; rubric: string; lapId: string }
  | { type: 'build_review_rubric_infrastructure_failure'; rubric: string; lapId: string; reason: string; excerpt?: string }
  | { type: 'build_review_disposition_accepted'; feature: string; lapId: string; findingId: string; operator: string }
  | { type: 'build_review_disposition_refused'; feature: string; reason: string }
  | { type: 'build_review_disposition_version_invalidated'; feature: string; findingId: string; rubric: string; contractVersion: string }
  | { type: 'build_review_outer_verdict'; lapId: string; rawVerdict: 'PASS' | 'FAIL'; effectiveVerdict: 'PASS' | 'FAIL' }
  | { type: 'step_started'; step: StepName; index: number }
  | {
      /** A hook-owned containment check could not reach a verdict. */
      type: 'containment_check_unresolved';
      /** Closed classification of the failed containment-check boundary. */
      failure:
        | 'commit-message-unreadable'
        | 'task-status-unreadable'
        | 'task-status-malformed'
        | 'evaluation-failed';
      /** Present once the commit message yielded a resolvable Task trailer. */
      taskId?: string;
      /** Raw commit message, retained when the hook read it before failing. */
      commitMessage?: string;
      /** Epoch milliseconds when the hook recorded the unresolved check. */
      ts: number;
    }
  | {
      /** A retained compatibility step ran as a deprecated no-op. */
      type: 'deprecated_step';
      step: StepName;
      adr: string;
    }
  | {
      type: 'step_completed';
      step: StepName;
      status: StepStatus;
      tail?: string[];
      tokenUsage?: TokenUsage;
      model?: string;
      unmetered?: boolean;
      /** Preferred provider resolved for this step, when provider routing is active. */
      preferredProvider?: string;
      /** Provider that produced the successful result. */
      actualProvider?: string;
      observedIntervals?: readonly ObservedInterval[];
      /** Build-only tree witnesses; absent on legacy and non-build events. */
      treeBefore?: string | null;
      treeAfter?: string | null;
    }
  | {
      type: 'step_failed';
      step: StepName;
      error: string;
      retryCount: number;
      observedIntervals?: readonly ObservedInterval[];
    }
  | ProviderAttemptEvent
  | {
      /** A provider scratch home was removed during a daemon sweep or legacy collection. */
      type: 'scratch_cleanup_reclaimed';
      repository: ScratchCleanupIdentityValue;
      featureSlug: ScratchCleanupIdentityValue;
      runId: ScratchCleanupIdentityValue;
      attempt: ScratchCleanupAttempt;
      path: string;
      reason: 'dead-owner' | 'legacy-preexisting';
    }
  | {
      /** A provider scratch home was retained during a daemon sweep. */
      type: 'scratch_cleanup_retained';
      repository: ScratchCleanupIdentityValue;
      featureSlug: ScratchCleanupIdentityValue;
      runId: ScratchCleanupIdentityValue;
      attempt: ScratchCleanupAttempt;
      path: string;
      reason: 'no-lease' | 'malformed-lease' | 'incomplete-lease' | 'live-owner' | 'unknown-owner' | 'concurrent-acquisition' | 'legacy-nonmatching' | 'legacy-not-directory' | 'legacy-mtime-unavailable' | 'legacy-newer-than-process-start' | 'legacy-unreadable-lease' | 'legacy-live-owner' | 'legacy-unknown-owner';
    }
  | {
      /** A provider scratch home could not be removed during a daemon sweep or legacy collection. */
      type: 'scratch_cleanup_failed';
      repository: ScratchCleanupIdentityValue;
      featureSlug: ScratchCleanupIdentityValue;
      runId: ScratchCleanupIdentityValue;
      attempt: ScratchCleanupAttempt;
      path: string;
      reason: string;
    }
  | {
      /**
       * Whole-feature provider usage, emitted once when `finish` completes.
       *
       * Summed from the feature's own `.pipeline/events.jsonl` — the only
       * record that spans every dispatch of a build, since a build is split
       * across many fresh provider sessions and (under the daemon) many
       * re-dispatches of the same feature. Carries no new persistence of its
       * own; it is a read of what `provider_attempt` / `step_completed`
       * already recorded.
       */
      type: 'feature_usage_total';
      dispatches: number;
      meteredDispatches: number;
      unmeteredDispatches: number;
      costUsd: number;
      /** Fresh (non-cached) input tokens — TokenUsage.input semantics. */
      inputTokens: number;
      outputTokens: number;
      /** Cached prompt volume (cache reads + creation), when tracked. */
      cachedInputTokens?: number;
    }
  | {
      /** A visible transition from an unavailable provider to the next candidate. */
      type: 'provider_fallback';
      step: StepName;
      failedProvider: string;
      reason: string;
      nextProvider: string;
    }
  | {
      /** A provider capability suppressed a would-be session resume. */
      type: 'session_policy';
      step: StepName;
      provider: string;
      reason: string;
    }
  | {
      type: 'step_retry';
      step: StepName;
      attempt: number; // 1-based: "attempt 2 of 3"
      maxAttempts: number;
      reason: string;
      resolvedBefore?: number;
      resolvedAfter?: number;
      /**
       * #188 retry-as-escalation: the (model, effort) the UPCOMING attempt
       * (`attempt` above) will dispatch at, per the escalation ladder. Absent
       * on a `escalate:false` step (identical retry — no movement to record) and
       * on pre-#188 event logs (backward-compatible; `aggregateRetryHotspots`
       * tolerates their absence).
       */
      escalatedModel?: string;
      escalatedEffort?: string;
    }
  | {
      // #646: rerun-vs-route classification, emitted on every classifier-
      // covered completion-gate miss (verdict steps only) so the audit log
      // can pair a decision with the outcome event that follows it.
      type: 'retry_decision';
      step: StepName;
      attempt: number;
      decision: 'rerun' | 'route';
      signal?: 'named-route' | 'identical-repeat';
      unchangedInput?: string;
    }
  | { type: 'checkpoint_reached'; step: StepName }
  | { type: 'recovery_needed'; step: StepName; options: RecoveryOption[] }
  | { type: 'gate_blocked'; step: StepName; reason: string }
  | { type: 'tier_skip'; step: StepName; tier: ComplexityTier }
  | { type: 'config_skip'; step: StepName }
  | { type: 'navigation_back'; from: StepName; to: StepName }
  | { type: 'rate_limit'; waitSeconds: number; reason?: 'usage-exhausted' }
  | { type: 'session_reset'; reason: string }
  | { type: 'credentials_park'; reason: string }
  | {
      type: 'operator_park_boundary';
      featureSlug: string;
      boundary: SchedulingUnitRef;
    }
  /** A sanitized recovery update; `credentials_park` remains the lifecycle start. */
  | CredentialParkProgressEvent
  | FinishPublicationEvent
  | { type: 'feature_complete'; prUrl?: string; featureDesc?: string; sessionStartedAt?: number }
  | { type: 'dashboard_refresh' }
  | {
      type: 'protected_artifact_rebaseline';
      trigger: string;
      fromCommit: string;
      toCommit: string;
      paths: string[];
      /** Base-ahead paths excluded after provenance proved they were not feature-authored. */
      excludedBaseAheadPaths?: string[];
      /** Feature-authored paths excluded because an operator reseal already approved their sealed content. */
      excludedOperatorResealedPaths?: string[];
      /** Authored paths accepted because their divergence is exactly the engine's recorded remediation-task append. */
      includedEngineAppendedPaths?: string[];
    }
  | {
      type: 'protected_artifact_rebaseline_refused';
      condition: string;
      verdictCondition:
        | 'baseline-unresolvable'
        | 'same-history-ancestor'
        | 'head-unresolvable'
        | 'base-tip-unresolved'
        | 'workspace-differs-from-head'
        | 'head-differs-from-base';
      path?: string;
      /** Merge-base used to classify a named path, when provenance resolved far enough to obtain one. */
      mergeBase?: string;
      /** Whether HEAD changed the named path since `mergeBase`; degraded probes stay explicit. */
      headTouchedPath?: boolean | 'indeterminate';
    }
  | {
      /** An interactive operator resealed the enumerated protected artifacts. */
      type: 'protected_artifact_reseal';
      paths: Array<{
        path: string;
        priorFingerprint: string;
        newFingerprint: string;
      }>;
      /** Verbatim operator-supplied rationale. */
      reason: string;
      fromCommit: string;
      toCommit: string;
    }
  | {
      /** An operator reseal was refused before it could change the seal. */
      type: 'protected_artifact_reseal_refused';
      /** Verbatim operator-supplied rationale for the refused request. */
      reason: string;
      condition: string;
      /** Present when a specific protected artifact caused the refusal. */
      path?: string;
    }
  | { type: 'auto_heal'; step: StepName; healed: number; skipped: number }
  | {
      /** A foreign sealed DECIDE artifact redirected remediation back to DECIDE. */
      type: 'remediation_sealed_artifact_redirect';
      gapId: string;
      artifact: string;
    }
  | ({
      /**
       * Emitted after a verdict-consuming completion check
       * (architecture_review_as_built, prd_audit, build_review) runs, so the
       * audit trail records whether the verdict artifact was actually
       * (re)written by the current attempt/session (Task 2,
       * session-fresh-verdict-artifacts).
       */
      type: 'verdict_freshness';
      step: StepName;
      artifact: string;
      floorSource: 'attempt' | 'session';
      mtimeMs?: number;
      floorMs?: number;
    } & VerdictFreshnessClassification)
  | {
      /**
       * Task 4 (build-review-grades-plan-vs-diff-against-a-stale-o):
       * base-freshness telemetry emitted once per build_review grading,
       * right after `assembleBuildReviewInputs` resolves — regardless of
       * how the grading itself turns out. Lets operators see whether the
       * diff was graded against a freshly-fetched remote head (`fresh:
       * true`) or a stale tracking ref / no-remote local fallback
       * (`fresh: false`). Pure telemetry: never affects step outcome.
       */
      type: 'build_review_base';
      mergeBase: string;
      trackingRefSha: string | null;
      remoteHeadSha: string | null;
      fresh: boolean;
    }
  | {
      /**
       * Task 7 (build-review-grades-plan-vs-diff-against-a-stale-o): emitted
       * when a build_review FAIL is classified `stale-mirage` — the graded
       * base was stale, and the flagged content is absent under a fresh
       * recompute. The stale verdict is discarded and build_review re-runs
       * against fresh inputs instead of kicking back to build; `regradeCount`
       * is the per-feature-session counter value AFTER this regrade
       * (Task 8 reads the same counter to enforce the once-per-session bound).
       */
      type: 'build_review_stale_mirage_regrade';
      mergeBase: string;
      regradeCount: number;
    }
  | ({
      /**
       * Durable provenance for a build_review grading's engine-recorded
       * rebase-repair context. This records the closed reason the context was
       * present or absent without changing the grading outcome.
       */
      type: 'build_review_repair_context';
    } & (
      | { disposition: 'context_available'; repairCount: number }
      | { disposition: 'none_warranted' | 'no_join'; repairCount?: never }
    ))
  | { type: 'mode_skip'; step: StepName; mode: BootstrapMode; reason: string }
  | {
      type: 'build_stall';
      step: StepName;
      reason: 'no_task_progress' | 'halt_marker';
      resolvedBefore: number;
      resolvedAfter: number;
    }
  | {
      /**
       * Intra-step build heartbeat: emitted by BuildProgressWatcher when the
       * resolved/total task count advances during a running `build` step
       * (adr-2026-07-10-intra-step-build-progress-events).
       */
      type: 'build_progress';
      step: StepName;
      /** Count of resolved (completed) tasks at the time of this tick. */
      resolved: number;
      /** Total task count at the time of this tick. */
      total: number;
      currentTaskId?: string;
      currentTaskName?: string;
      /** Number of new commits observed since the last tick, if tracked. */
      commitCount?: number;
      /** Consecutive gate-verdict misses with no supporting evidence, if tracked. */
      noEvidenceAttempts?: number;
      featureSlug?: string;
      tickReason?: 'task-delta' | 'head-moved' | 'heartbeat';
      headMoved?: boolean;
    }
  | {
      /**
       * Intra-step build quiet-episode warning: emitted when the build step
       * has gone `quietMinutes` without any task-status change
       * (adr-2026-07-10-intra-step-build-progress-events). Distinct from
       * `build_stall`, which signals a stronger/terminal no-progress halt.
       */
      type: 'build_no_progress';
      step: StepName;
      /** Minutes elapsed since the last observed task-status change. */
      quietMinutes: number;
      resolved: number;
      total: number;
      currentTaskId?: string;
      /** Epoch ms of the last observed commit, if tracked. */
      lastCommitAt?: number;
      featureSlug?: string;
    }
  | {
      /** A pipeline-owned closeout obligation completed during a build. */
      type: 'pipeline_closeout';
      obligation:
        | 'evaluator'
        | 'simplify'
        | 'architecture-diagram'
        | 'micro-retro'
        | 'memory'
        | 'summary';
      /** Epoch milliseconds when the obligation began. */
      startedAt: number;
      /** Epoch milliseconds when the obligation completed. */
      endedAt: number;
      /** Epoch milliseconds when the pipeline recorded this event. */
      ts: number;
    }
  | {
      type: 'renderer_error';
      rendererName: string;
      error: string;
    }
  | {
      type: 'when_skip';
      step: StepName;
      expression: string;
      /** Set when a `${key}` reference resolved to undefined in state. */
      undefinedKey?: string;
    }
  | {
      type: 'parallel_started';
      step: StepName;
      branches: string[];
    }
  | {
      type: 'parallel_completed';
      step: StepName;
      branches: string[];
    }
  | {
      type: 'parallel_failure';
      step: StepName;
      branch: string;
      error: string;
    }
  | {
      /**
       * Task 25 (attribution and phantom-member absence): a single group
       * member's own step dispatch/outcome, emitted from the group-core
       * branch executor (group-core.ts:runGroupBranch) rather than the
       * conductor's per-step machinery — so an observer can tell WHICH
       * validator branch a given dispatch/outcome belongs to, without
       * relying on step-name-only events that a group's members would
       * otherwise share ambiguously with a serial dispatch of the same
       * step name. Never emitted for a member that was never dispatched
       * (a `SkippedOutcome` member) — only members that actually reached
       * `runGroupBranch` produce this event.
       */
      type: 'group_member_step';
      /** The member (branch) name this event is attributed to. */
      member: string;
      /** The skill dispatched for this member. */
      skill: string;
      /** 'dispatch' when the branch is about to call the step runner; 'result' once its outcome is known. */
      phase: 'dispatch' | 'result';
      /** Present when phase === 'result': the classified outcome (see classifyOutcome in group-core.ts). */
      outcome?: string;
    }
  // ── Gate-driven loop (Phase 5 observability) ──
  | {
      /** A gate's objective verdict was (re)computed by the loop. */
      type: 'gate_verdict';
      step: StepName;
      satisfied: boolean;
      reason?: string;
      /** Timestamp (ms epoch) the gate's verdict was computed, for audit non-divergence checks. */
      checkedAt?: number;
    }
  | {
      /** Freshness telemetry for the full test-suite verification evidence. */
      type: 'test_suite_verification';
      freshness: {
        status: 'CURRENT' | 'STALE';
        reason?: string;
      };
    }
  | {
      /**
       * A BUILD-verification member settled using its own existing evidence.
       * This is observability only; the group join remains the sole authority
       * that declares the member satisfied for the round.
       */
      type: 'build_member_evidence_reused';
      member: 'wiring_check' | 'test_suite';
      decision: 'reuse';
      basis: 'fingerprint-match';
    }
  | {
      /**
       * A BUILD-verification member settled after deriving fresh evidence.
       * The basis is a closed, sanitized classification rather than raw
       * evidence, command output, credentials, or host paths.
       */
      type: 'build_member_evidence_recomputed';
      member: 'wiring_check' | 'test_suite';
      decision: 'recompute';
      basis:
        | 'recorded-head-versus-current-head'
        | 'fingerprint-mismatch'
        | 'fresh-evidence-required';
    }
  | {
      /** A downstream step re-opened an upstream gate (plan/stories). */
      type: 'kickback';
      from: StepName;
      to: StepName;
      evidence?: string;
      /** How many times this gate has been re-opened this feature. */
      count: number;
      /** Total build-review laps across progress resets; absent for other kickback sources. */
      cumulativeCount?: number;
      /** A rebase invalidation credited this gate's convergence laps. */
      convergenceCredit?: {
        gate: 'build_review';
      };
      /**
       * #647 D3 (adr-2026-07-13-kickback-build-no-op-escalation): audit
       * discriminator distinguishing a kickback that produced real build
       * progress (`'did-work (commits N..M / resolved +K)'`, derived from
       * `classifyBuildProgress`) from one whose target was already
       * evidence-complete before build ever ran (`'derived-already-complete'`).
       * Absent when neither classification has been computed for this event.
       */
      kickback_outcome?: string;
    }
  | {
      /** The gate loop stopped without converging (kickback/stuck cap). */
      type: 'loop_halt';
      step?: StepName;
      reason: string;
      /**
       * URL of the auto-opened needs-remediation draft PR, when the conductor
       * irrecoverably HALTs in auto mode and escalation succeeded. Absent when
       * mode is not 'auto', on rebase-conflict halts, or when escalation could
       * not create a PR (zero commits, push failure, gh error).
       */
      prUrl?: string;
    }
  | {
      /** Writing the durable HALT marker failed, so the feature may not be parked. */
      type: 'halt_marker_write_failed';
      path: string;
      reason: string;
    }
  | {
      /** The gate loop reached a fully-satisfied state (.pipeline/DONE). */
      type: 'loop_converged';
    }
  // ── Rebase-on-latest (Phase 9.0) — structured rebase outcome events ──
  | {
      /** The branch was already current with the base — rebase was a no-op. */
      type: 'rebase_noop';
    }
  | {
      /** The branch is behind but cleanly mergeable, so normal finish preserved its history. */
      type: 'rebase_mergeable_skip';
      /** The ref the skip was decided against, e.g. `origin/main`. */
      baseRef?: string;
      /** That ref's sha, so a reader can tell WHICH base was compared. */
      baseSha?: string | null;
      /** Whether that ref came from origin or a local branch. */
      baseKind?: 'remote' | 'local';
    }
  | {
      /** A clean rebase changed code/test paths → downstream re-verification. */
      type: 'rebase_changed';
      changedPaths: string[];
      /** Complete unfiltered delta, distinct from the gate-invalidation path set. */
      allChangedPaths?: string[];
    }
  | {
      /** A gate was re-verified post-rebase in gate-first mode. */
      type: 'rebase_gate_reverified';
      step: StepName;
      skippedDispatch: boolean;
      reason?: string;
    }
  | {
      /**
       * A gate's prior verdict was preserved post-rebase because the
       * rebase delta did not touch the gate's judged surface.
       */
      type: 'rebase_gate_preserved';
      gate: StepName;
      surface: string[];
      deltaConsidered: string[];
    }
  | {
      /**
       * A gate's prior verdict was invalidated post-rebase because the
       * rebase delta touched paths within the gate's judged surface.
       */
      type: 'rebase_gate_invalidated';
      gate: StepName;
      matchedPaths: string[];
    }
  | {
      /** A non-trivial/mixed conflict parked the feature (FR-8). */
      type: 'rebase_conflict_halt';
      step?: StepName;
      reason: string;
      conflicts: string[];
    }
  | {
      /**
       * Residue: pre-image shas cited by evidence but with no patch-id
       * match post-rebase (dropped or content-changed). Surfaced instead of
       * silently repointed — see `writeResidue` in engine/rebase-translate.ts.
       */
      type: 'rebase_citation_residue';
      residue: Array<{ sha: string; citingTaskIds: string[]; reason: string }>;
    }
  // ── Rebase auto-resolution lifecycle (Phase 9 / rebase-resolution) ──
  | {
      /** One attempt at auto-resolving a conflict; index is 1-based, cap is the total budget. */
      type: 'rebase_resolution_attempt';
      index: number;
      cap: number;
    }
  | {
      /** The conflict was successfully resolved by the auto-resolver. */
      type: 'rebase_resolution_succeeded';
    }
  | {
      /** A single resolution attempt failed; the engine may retry up to cap. */
      type: 'rebase_resolution_failed';
    }
  | {
      /** All resolution attempts exhausted without success — feature is halted. */
      type: 'rebase_resolution_exhausted';
    }
  // ── Task 23: Daemon auto-park on no-evidence gate misses ──
  | {
      /** The daemon auto-parked due to N no-evidence gate misses or empty plan. */
      type: 'auto_park';
      slug: string;
      reason: string;
    }
  | {
      /**
       * The daemon REFUSED an `empty/missing plan` auto-park because the
       * run's own completion evidence contradicts it (#612 contradiction
       * guard). Named loudly so the refusal is impossible to miss in the
       * daemon log.
       */
      type: 'auto_park_contradiction';
      slug: string;
      verdict: 'empty/missing plan';
      evidence: {
        summaryTasksCompleted: number;
        evidenceStamps: number;
        resolvedTasks: number;
      };
    }
  // ── #505 TS-15: zero-work-product detection ──
  | {
      /**
       * A build step completed with zero attributable work: either nothing
       * was dispatched, or dispatched work produced no new commits. Emitted
       * only when enforcement is active, no halt marker is present, and the
       * task list is still incomplete — Task 16 owns the kickback response.
       */
      type: 'zero_work_product';
      step: StepName;
      dispatchCount: number;
      headSha: string | null;
    }
  // ── Task 3 (#671): unattributed-dispatch loud signal ──
  | {
      /**
       * A build dispatch cycle's `.pipeline/dispatch-count` crossed the
       * unattributed-dispatch threshold — distinct from and earlier than
       * `zero_work_product`. Emitted at the build seam itself, not deferred
       * to the evidence gate.
       */
      type: 'unattributed_dispatch';
      step: StepName;
      unattributedCount: number;
    }
  // ── Commit-movement liveness floor (adr-2026-07-23-commit-movement-liveness-floor) ──
  | {
      /**
       * Emitted when the build stall breaker's resolved-task count is
       * pinned across an attempt (the old `no_task_progress` trigger
       * condition) but HEAD nonetheless moved this attempt — real,
       * committed work landed without a `Task:` trailer attributing it to
       * a plan task id. This is telemetry only; it does NOT classify the
       * attempt as stalled.
       */
      type: 'unattributed_progress';
      step: StepName;
      attempt: number;
      resolvedCount: number;
      headBefore: string | null;
      headAfter: string | null;
    }
  // ── Audit-trail write-completeness: halt lifecycle closure ──
  | {
      /** A halt (operator park or daemon HALT) was cleared, resuming the feature. */
      type: 'halt_cleared';
      step?: StepName;
      cause: 'operator' | 'rekick';
    }
  // ── Ship→CI feedback loop (Task 5): CI failure events ──
  | {
      /** CI checks failed on a shipped PR (halt-monitor grade). */
      type: 'ci_failed';
      prUrl: string;
      slug: string;
      checks: string[];
      attempts: number;
      phase: 'detected' | 'dispatched' | 'exhausted';
    }
  // ── Semantic attribution verification (Task 17) ──
  | {
      /**
       * Audit disagreement: the spot-audit verdict disagrees with the fast-lane
       * verdict (agree: false). Emitted when an audited task is recorded to the
       * accuracy ledger with a divergent verdict. No stamps are revoked, no halt
       * markers are written — audit results are observational, never prescriptive.
       */
      type: 'attribution_divergence';
      /** Feature slug being audited */
      feature: string;
      /** Task ID with divergent verdict */
      taskId: string;
    }
  | {
      /** RED-evidence lifecycle for an acceptance-specs dispatch. */
      type: 'acceptance_red';
      state: 'required' | 'pending' | 'satisfied' | 'rejected';
      step: StepName;
      reason?: string;
      failingTests?: Array<{ name: string; reason: string }>;
      viaException: boolean;
    };
