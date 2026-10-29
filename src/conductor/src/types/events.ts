import type { StepName, StepStatus, ComplexityTier } from './steps.js';
import type { EffortLevel } from './config.js';
import type { BootstrapMode } from './state.js';
import type {
  AuthenticationReadinessState,
  AuthenticationSource,
  CodexProbeFailureKind,
  CodexProbeParserRejection,
  ProviderExitFacts,
  ProviderStreamObservation,
  TokenUsage,
} from './provider.js';
import type { ObservedInterval } from './provider.js';
import type { ProviderId } from './provider.js';
import type { SchedulingUnitRef } from './scheduling-unit.js';
import type { GithubOperationName, GithubOperationRefusalReason, GithubOperationTarget, GithubBotAuthRefusalReason } from './github.js';
import type { BuildReviewInfrastructureFailureReason, BuildReviewJudgedResultRejection } from './build-review.js';
import type { ChildId, CommitSha, JournalState, RefName, RestackCause, RestackOpId, RestackRefusalReason } from './restack.js';
type LandGateRejectionIdentifier = import('./land.js').LandGateRejectionIdentifier;
type RefusalReason = import('./park.js').RefusalReason;
type HaltDisposition = import('./halt.js').HaltDisposition;
type InboundNeutralization = import('./intake.js').InboundNeutralization;
type ManagedGhObservationCoverage = import('./managed-session.js').ManagedGhObservationCoverage;
import type { HostState, RoundId, RouteKind } from './routing.js';
import type { ArtifactKind } from './feature-manifest.js';

export type RecoveryOption = 'retry' | 'interactive' | 'back' | 'skip' | 'quit';

/** Legacy leases written before a conductor step was recorded own this bucket. */
export const LEGACY_TRANSCRIPT_OWNER_STEP = 'unknown-step' as const;
/** @deprecated Use TranscriptOwner for newly captured transcripts. */
export type TranscriptOwnerStep = StepName | typeof LEGACY_TRANSCRIPT_OWNER_STEP;

/**
 * A transcript belongs either to a registered lifecycle step, a configured
 * member executing under its registered parent group, or an old lease whose
 * owner could not be reconstructed.  Do not represent configured members as
 * StepName: their names are deliberately outside that registry.
 */
export type TranscriptOwner =
  | { readonly kind: 'registered-step'; readonly step: StepName }
  // Configured group names are operator-defined (e.g. `quality/audit`), not
  // registered lifecycle steps, so parentGroup is deliberately a plain string.
  | { readonly kind: 'configured-group-member'; readonly parentGroup: string; readonly member: string }
  | { readonly kind: 'legacy-unknown-step' };

/** Closed disposition of pull-request publication for a completed run. */
export type RunPrDisposition = 'opened' | 'none' | 'unrecorded';

/** Closed reasons why the daemon retained a worktree during reclamation. */
export type WorktreeReclaimRetainedReason =
  | 'detached'
  | 'in-flight'
  | 'foreign-lifecycle'
  | 'invalid-slug'
  | 'halted'
  | 'listing-unavailable'
  | 'evidence-unavailable'
  | 'disabled'
  | RefusalReason;

/** Closed operator actions for a refused guarded GitHub operation. */
export type GithubOperationRefusalRemedy =
  | 'ask-resource-owner'
  | 'configure-operator-identity'
  | 'record-feature-ownership'
  | 'repair-ownership-provenance'
  | 'retry-provenance-read'
  | 'correct-operation-target'
  | 'correct-operation-payload'
  | 'use-supported-operation'
  | 'request-explicit-authorization';

/** Secret-safe ownership refusal carried by the canonical event spine. */
export interface GithubOperationRefusedEvent {
  type: 'github_operation_refused';
  operator: string;
  target: GithubOperationTarget;
  operation: GithubOperationName;
  reason: GithubOperationRefusalReason;
  remedy: GithubOperationRefusalRemedy;
}
/** A guarded GitHub operation executed but GitHub rejected or failed it. */
export interface GithubOperationFailedEvent {
  type: 'github_operation_failed';
  target: GithubOperationTarget;
  operation: GithubOperationName;
  error: string;
}
/** A bot credential was unavailable for an authorized write; the operation retried once as the operator. */
export interface GithubWriteCredentialFallbackEvent {
  type: 'github_write_credential_fallback';
  operation: GithubOperationName;
  target: GithubOperationTarget;
  reason: GithubBotAuthRefusalReason;
}
export interface BotCoAuthorSkippedEvent {
  type: 'bot_co_author_skipped';
  reason: 'token-unavailable' | 'identity-read-failed' | 'worktree-write-failed' | 'resolver-absent';
}

/** Daemon-lifetime backlog dimensions. Kept closed so metric cardinality is bounded. */
export type BacklogState = 'eligible' | 'waiting' | 'blocked' | 'gated' | 'parked';
export type DispatchKind = 'initial' | 'resume' | 'rekick';
export type DispatchBlockReason = 'paused' | 'build_auth_missing' | 'gh_version' | 'episode_active';
export type FeatureDispatchOutcome = 'complete' | 'halted' | 'terminated';

/** Bounded partial-timing causes safe to attach to feature-level telemetry. */
export type TimingReasonClass =
  | 'empty-active-union'
  | 'active-evidence-incomplete'
  | 'open-executions'
  | 'provider-outside-active-union'
  | 'provider-evidence-incomplete'
  | 'ledger-unreadable';

/** Closed daemon-maintenance phases so the persisted timing vocabulary remains bounded. */
export type MaintenancePhase =
  | 'startup-refresh'
  | 'first-claim'
  | 'rekick'
  | 'startup-dashboard'
  | 'halt-pr-reconcile'
  | 'parked-reconcile'
  | 'provider-scratch'
  | 'mergeable-sweep'
  | 'repair';

/** Terminal outcome of one daemon-maintenance phase occurrence. */
export type MaintenancePhaseOutcome = 'completed' | 'skipped-unchanged' | 'failed' | 'deferred';

/** Counters emitted only by parked-worktree reconciliation. */
export interface ParkedReconcileMaintenanceSummary {
  reconciled: number;
  deferred: number;
  orphaned: number;
  parked: number;
  refused: number;
  skipped: number;
}

type DaemonMaintenancePhaseBase<Outcome extends MaintenancePhaseOutcome> = {
  type: 'daemon_maintenance_phase';
  durationMs: number;
  outcome: Outcome;
};

/** Phase-specific telemetry prevents unrelated maintenance work from carrying repair or sweep data or another phase's outcome. */
export type DaemonMaintenancePhaseEvent =
  | (DaemonMaintenancePhaseBase<'completed' | 'failed' | 'deferred'> & {
      phase: 'repair';
      prUrl: string;
      slug?: string;
      summary?: never;
    })
  | (DaemonMaintenancePhaseBase<'completed' | 'skipped-unchanged' | 'failed'> & {
      phase: 'parked-reconcile';
      summary?: ParkedReconcileMaintenanceSummary;
      prUrl?: never;
      slug?: never;
    })
  | (DaemonMaintenancePhaseBase<'completed' | 'failed'> & {
      phase: Exclude<MaintenancePhase, 'repair' | 'parked-reconcile'>;
      prUrl?: never;
      slug?: never;
      summary?: never;
    });

/** Closed outcomes for the daemon's bounded setup repair session. */
export type SetupRepairDisposition =
  | 'engine-committed'
  | 'accepted-existing-commit'
  | 'verified-no-tree-change'
  | 'rejected';

/** Fail-closed reasons for a rejected setup repair attempt. */
export type SetupRepairRejectionReason =
  | 'provider-failure'
  | 'history-rewritten'
  | 'mixed-commit-and-residue'
  | 'setup-still-failing'
  | 'setup-drift'
  | 'snapshot-failed'
  | 'repair-commit-failed'
  | 'repair-postcondition-failed'
  | 'preservation-failed'
  | 'restoration-failed';

/** Identity is deliberately explicit when a retention decision has no readable lease. */
type ScratchCleanupIdentityValue = string | 'unknown';
type ScratchCleanupAttempt = number | 'unknown';

/** Closed, credential-safe FINISH publication observability vocabulary. */
export type FinishPublicationTransition =
  | 'establish_pr'
  | 'establish_child_prs'
  | 'verify_release_readiness'
  | 'author_pr_prose'
  | 'judge_pr_prose'
  | 'write_shipped_record'
  | 'assemble_stack'
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

/** Custom prerequisite keys are persisted only for release-readiness blockers. */
export type FinishPublicationBlockedCondition =
  | FinishPublicationBlocker
  | {
      code: Extract<FinishPublicationBlocker, `release_readiness_${string}`>;
      steps: readonly string[];
    };

export type FinishPublicationEvent =
  | {
      type: 'finish_publication_transition';
      phase: 'started' | 'completed';
      transition: FinishPublicationTransition;
    }
  | { type: 'finish_publication_blocked'; condition: FinishPublicationBlockedCondition }
  | {
      type: 'finish_publication_disposition';
      disposition: 'retry_finish' | 'retry_build' | 'human_required' | 'complete';
      /** Present for a typed human-required FINISH publication halt. */
      reason?: string;
      /** Detail retained from the typed human-required publication disposition. */
      detail?: string;
    };

/** Stack-publication occurrences remain on the canonical conductor event spine. */
export type StackPublicationEvent =
  | { type: 'stack_member_published'; child: ChildId; pr: number }
  | { type: 'stack_member_redrafted'; child: ChildId; pr: number }
  | { type: 'stack_assembled'; prs: readonly number[] }
  | {
      type: 'stack_member_lifecycle';
      child: ChildId;
      pr: number;
      state: 'merged' | 'closed' | 'reverted';
      /** Deterministic identity makes at-least-once sweep delivery replay-safe. */
      eventId: string;
    }
  | { type: 'stack_members_unreachable'; child: ChildId; pr: number }
  | { type: 'stack_tip_diverged'; prs: readonly number[] };

/** Closed, non-diagnostic context for credential-park progress telemetry. */
export type CredentialParkProgressDegradation =
  | 'credential-failure'
  | 'unrelated-diagnostic-degradation';

type CredentialParkProgressEventBase = {
  type: 'credentials_park_progress';
  provider: ProviderId;
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

/** A durable operator decision recorded from an OVER_SCOPE halt clear. */
export interface OverScopeDecisionEventRecord {
  criterion: string;
  decision: 'accept' | 'refuse';
}

/** Closed, sanitized evidentiary failures observed while harvesting a clear. */
export type OverScopeDecisionEventDefectKind =
  | 'malformed-block'
  | 'unknown-criterion'
  | 'missing-rationale'
  | 'invalid-decision'
  | 'missing-operator'
  | 'write-failed';

export interface OverScopeDecisionEventDefect {
  kind: OverScopeDecisionEventDefectKind;
  criterion?: string;
}

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

/**
 * Stable identity for one logical execution. It is intentionally separate
 * from provider-attempt IDs and from the lifecycle registry's policy step.
 */
export interface ExecutionContext {
  executionId: string;
  subject: ExecutionSubject;
}

/** A telemetry subject is either a registered lifecycle step or a configured branch. */
export type ExecutionSubject =
  | { kind: 'lifecycle-step'; step: StepName }
  | { kind: 'configured-member'; parentGroup: string; member: string };

/** Closed, non-textual facts permitted on the CI repair diagnostic bus event. */
export type CiRepairDiagnosticStage = 'context' | 'log-enrichment' | 'branch' | 'readiness' | 'execution' | 'guard' | 'verification' | 'publication';
export type CiRepairDiagnosticReason = 'auth' | 'permission' | 'timeout' | 'api' | 'capability' | 'malformed-context' | 'missing-context' | 'missing-branch' | 'log-unavailable' | 'context-truncated' | 'provider-unavailable' | 'readiness-degraded' | 'flag-invalid' | 'spawn-env' | 'unknown' | 'guard-refused' | 'verification-failed' | 'publication-refused' | 'verified-publication';
export type CiRepairDiagnosticDisposition = 'deferred' | 'degraded' | 'failed' | 'published';

/** Closed reasons reported by the boot-time built-in provider probe. */
export type ProviderDiscoveryFailureReason =
  | 'not-found'
  | 'not-executable'
  | 'version-failed'
  | 'timeout';

/** The installed and unavailable built-in providers observed during one boot. */
export interface ProviderDiscoveryEvent {
  type: 'provider_discovery';
  installed: ProviderId[];
  missing: Array<{
    id: ProviderId;
    reason: ProviderDiscoveryFailureReason;
  }>;
}

/** One provider candidate result or lifecycle transition within a step attempt. */
export interface ProviderAttemptEvent {
  type: 'provider_attempt';
  step: StepName;
  /** Optional so historical event records retain their legacy interpretation. */
  executionContext?: ExecutionContext;
  provider: string;
  /** Sanitized Codex authentication source; omitted for other providers. */
  authenticationSource?: 'api-key' | 'cached-login';
  outcome: 'success' | 'failure' | 'unavailable';
  /** False when a cached run-wide unavailability avoided process dispatch. */
  invoked: boolean;
  preferredProvider?: string;
  model?: string;
  effort?: EffortLevel;
  tier?: ComplexityTier;
  tokenUsage?: TokenUsage;
  observedIntervals?: readonly ObservedInterval[];
  reason?: string;
  fallbackReason?: string;
  /** Present only for an unavailable candidate that was not invoked. */
  skipReason?: 'setup-unavailable' | 'cached-unavailable' | 'suppression-refused';
  /** Redacted details retained for an explicit setup-unavailable skip. */
  setupCapability?: string;
  setupRecoveryAction?: string;
  lifecycle?: ProviderLifecycleEventMetadata;
}

/** Explicit identity for a provider candidate at the moment it starts. */
export type ProviderStartIdentity =
  | { kind: 'known'; id: string }
  | { kind: 'unknown' };

/** A provider candidate has started invocation for a step. */
export interface ProviderAttemptStartedEvent {
  type: 'provider_attempt_started';
  step: StepName;
  provider: ProviderStartIdentity;
  model?: string;
  executionContext?: ExecutionContext;
}

/**
 * Live intra-step provider signal. An absent `activeChildren` is unobserved,
 * never zero; this observation carries no terminal usage authority.
 */
export type ProviderStreamProgressEvent = ProviderStreamObservation & {
  type: 'provider_stream_progress';
  step: StepName;
  provider: string;
  ts: string;
};

/** Activity classification for an intra-step build-progress observation. */
export type BuildActivity = 'quiet' | 'active-committing' | 'active-not-committing';

/** Engine-established attribution carried by an external managed-session producer. */
export type SessionObservationScope =
  | { kind: 'feature'; featureSlug: string }
  | { kind: 'project' };

/** Closed outcomes from a locally observed `gh` process; never remote-state proof. */
export type GithubBypassCliOutcome = 'cli-succeeded' | 'cli-failed' | 'unknown';

/** A command was refused before its handler was allowed to run. */
export interface SessionCommandRefusedEvent {
  type: 'session_command_refused';
  eventId: string;
  sourceTime: string;
  dispatchId: string;
  provider: string;
  scope: SessionObservationScope;
  subcommand: string | 'unknown';
}

/** An unguarded GitHub operation was observed before its local transport ran. */
export interface GithubBypassAttemptEvent {
  type: 'github_bypass_attempt';
  eventId: string;
  sourceTime: string;
  dispatchId: string;
  provider: string;
  scope: SessionObservationScope;
  operation: string | 'unknown';
}

/** The terminal local result correlated to one observed unguarded GitHub attempt. */
export interface GithubBypassResultEvent {
  type: 'github_bypass_result';
  eventId: string;
  sourceTime: string;
  dispatchId: string;
  provider: string;
  scope: SessionObservationScope;
  attemptId: string;
  outcome: GithubBypassCliOutcome;
}

/** An opaque GitHub invocation could not safely be classified as read-only. */
export interface GithubPossibleBypassEvent {
  type: 'github_possible_bypass';
  eventId: string;
  sourceTime: string;
  dispatchId: string;
  provider: string;
  scope: SessionObservationScope;
  operation: string | 'unknown';
}

/** A closed diagnostic for degraded cross-process observation delivery. */
export interface SessionEventDeliveryDiagnosticEvent {
  type: 'session_event_delivery_diagnostic';
  eventId: string;
  sourceTime: string;
  dispatchId: string;
  provider: string;
  scope: SessionObservationScope;
  code: 'producer-path-invalid' | 'record-too-large' | 'write-failed';
}

type ConductorEventBody =
  | {
      /** Operator-run cleanup of transient DECIDE artifacts for shipped work. */
      type: 'decide_artifacts_pruned';
      removed: string[];
      deferred: { stem: string; paths: string[]; reason: 'open-pr-modifies'; pullRequests: string[] }[];
      skipped: { stem: string; reason: 'no-shipped-record' }[];
      excluded: string[];
      pullRequestUrl?: string;
    }
  | BotCoAuthorSkippedEvent
  | GithubOperationFailedEvent
  | SessionCommandRefusedEvent
  | GithubBypassAttemptEvent
  | GithubBypassResultEvent
  | GithubPossibleBypassEvent
  | SessionEventDeliveryDiagnosticEvent
  | {
      /** A durable spool batch was evicted locally or rejected by the backend. */
      type: 'otel_spool_drop';
      signal: 'traces' | 'metrics';
      reason: 'rejected' | 'evicted';
      batches: number;
      items: number;
      status?: number;
    }
  | {
      /** Periodic durable-spool backlog health, persisted for operational inspection. */
      type: 'otel_spool_backlog';
      signal: 'traces' | 'metrics';
      files: number;
      bytes: number;
      oldestAgeMs: number;
      lastFailureClass?: 'network' | 'auth' | 'endpoint' | 'throttled' | 'server';
    }
  | {
      type: 'daemon_backlog_snapshot';
      counts: Record<BacklogState, number>;
      oldestAgeSeconds: Partial<Record<BacklogState, number>>;
      slots: { busy: number; free: number };
      inFlight: string[];
      blocked: Record<DispatchBlockReason, boolean>;
      pollDurationMs: number;
      /** #2275: an origin refresh is in flight off the dispatch loop (absent on older records). */
      rootRefreshPending?: boolean;
    }
  | {
      type: 'daemon_memory_sample';
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
      slug: string;
      step: string;
      boundary: 'started' | 'completed';
      pid: number;
      dispatchSeq: number;
    }
  | {
      type: 'daemon_heap_dump_written';
      path: string;
      bytes: number;
      rss: number;
      pid: number;
    }
  | {
      type: 'daemon_exited';
      pid: number;
      code: number | null;
      signal: string | null;
      at: string;
    }
  /** Duration and result of a daemon maintenance occurrence on the canonical event spine. */
  | DaemonMaintenancePhaseEvent
  | {
      type: 'feature_dispatch_started';
      slug: string;
      kind: DispatchKind;
      tier?: ComplexityTier;
      /** Immutable executor build selected at claim time (absent in legacy ledgers). */
      engineVersionId?: string;
      /** Why this dispatch used the supervisor build rather than `dist`. */
      pinFallbackReason?: string;
    }
  | {
      type: 'executor_started';
      slug: string;
      engineVersionId: string;
      protocolVersion: number;
      supervisorEngineVersionId: string;
    }
  | {
      /** A child was rejected before receiving a work order. */
      type: 'executor_protocol_mismatch';
      slug: string;
      engineVersionId: string;
      expectedProtocolVersion: number;
      actualProtocolVersion?: number;
      reason: string;
      /** D7's drain fallback was requested through the armed supervisor seam. */
      restartRequested: boolean;
    }
  | {
      type: 'feature_dispatch_ended';
      slug: string;
      outcome: FeatureDispatchOutcome;
      tier?: ComplexityTier;
      haltClass?: HaltDisposition;
      step?: string;
    }
  | {
      type: 'feature_shipped';
      slug: string;
      tier?: ComplexityTier;
      runStartedAt?: number;
      active: {
        state: 'exact' | 'partial' | 'unavailable';
        activeMs?: number;
        reason?: TimingReasonClass;
      };
    }
  /** A foreground monitor presented one halted feature to the operator. */
  | { type: 'monitor_item_offered'; project: string; feature: string }
  /** A foreground monitor began a guided recovery session for one feature. */
  | { type: 'monitor_session_opened'; project: string; feature: string }
  /** An operator deferred one monitored halt for a later queue rotation. */
  | { type: 'monitor_item_deferred'; project: string; feature: string }
  /** A foreground monitor's guided recovery session returned control. */
  | { type: 'monitor_session_ended'; project: string; feature: string }
  | { type: 'intake_inbound_sanitized'; sourceRef: string; neutralizations: InboundNeutralization[]; digest: string }
  | {
      type: 'intake_overlap_checked';
      repository: string;
      outcome: 'proceeded' | 'refused' | 'invalid-decline';
      suggested: string[];
      accepted: string[];
      declined: string[];
      undecided: string[];
      advisoryCount: number;
      skipped: Array<{ part: string; reason: string }>;
    }
  | {
      type: 'land_gate_rejected';
      gate: LandGateRejectionIdentifier;
      reason: string;
      project: string;
      worktreePath: string;
      sourceRef?: string;
    }
  | {
      type: 'land_dependency_decided';
      repository: string;
      sourceRef: string;
      proposals: string[];
      accepted: string[];
      declined: string[];
      skipped: { reason: string } | null;
      writes: Array<{ target: string; status: string; reason?: string }>;
    }
  | {
      type: 'feature_artifacts_registered';
      slug: string;
      added: Array<{ kind: ArtifactKind; path: string }>;
    }
  | {
      type: 'dependency_drift_swept';
      repository: string;
      status: 'swept' | 'repository-indeterminate';
      unlinked: string[];
      stale: string[];
      cycles: string[];
      contradictions: string[];
      indeterminate: string[];
    }
  | { type: 'operator_rewind'; operator: string; target: string; demoted: string[] }
  | {
      type: 'setup_repair';
      disposition: Exclude<SetupRepairDisposition, 'rejected'>;
      preservedPaths: string[];
    }
  | {
      type: 'setup_repair';
      disposition: 'rejected';
      reason: SetupRepairRejectionReason;
      quarantineRef?: string;
      preservedPaths: string[];
    }
  | { type: 'project_setup'; ran: boolean; reason: 'marker-valid' | 'no-marker' | 'no-script' | 'script-changed' | 'base-moved' | 'marker-invalid' | 'forced' }
  | {
      /** The memory-path state observed before daemon setup ran. */
      type: 'memory_setup';
      /** Whether `.memory` was absent, a real directory, or a symlink. */
      before: 'absent' | 'directory' | 'symlink';
      /** Whether `.memory` points to the canonical store after setup. */
      canonical: boolean;
      /** Sanitized setup failure or non-canonical outcome, when available. */
      reason?: string;
    }
  | {
      /** Durable plan-task growth accounting after a remediation append. */
      type: 'plan_growth';
      authored: number;
      added: number;
      byGate: Record<string, number>;
      remaining: number;
    }
  | {
      /**
       * Post-rebase regrade judgement for a replay that changed the feature's
       * own contribution: which document-bound judged gates reopen, and why.
       * `fail-closed` means the judgement was unavailable or invalid and every
       * candidate reopened.
       */
      type: 'rebase_regrade_judged';
      step: 'rebase';
      outcome: 'regrade' | 'preserve' | 'fail-closed';
      candidates: string[];
      reopened: string[];
      changedFiles: string[];
      completedHead: string;
      rationale?: string;
      reason?: string;
    }
  | {
      /** A source-grounded reviewer session was dispatched for one plan-review round. */
      type: 'plan_review_dispatched';
      round: number;
      reviewerProvider: string;
      independence: 'cross-provider' | 'same-provider' | 'unknown-host';
    }
  | {
      /** A source-grounded reviewer session completed with severity totals. */
      type: 'plan_review_completed';
      round: number;
      reviewerProvider: string;
      independence: 'cross-provider' | 'same-provider' | 'unknown-host';
      blockingCount: number;
      significantCount: number;
      advisoryCount: number;
    }
  | {
      /** An operator accepted a bounded plan-review finding. */
      type: 'plan_review_finding_accepted';
      findingId: string;
      reason: string;
    }
  | {
      /** A retired configuration key was accepted as a compatibility no-op. */
      type: 'config_deprecated_key';
      key: string;
      adr: string;
    }
  /** Provider-owned read-only review capability observed at configuration time. */
  | {
      type: 'build_review_read_only_capability';
      provider: string;
      platform: string;
      status: 'available';
      reason?: never;
    }
  | {
      type: 'build_review_read_only_capability';
      provider: string;
      platform: string;
      status: 'unavailable';
      reason: string;
    }
  | { type: 'build_review_rubric_started'; rubric: string; lapId: string }
  | { type: 'self_host_dispatch_admission'; step: StepName; state: 'queued' | 'admitted' | 'cancelled' }
  /** Candidate-local installed custom policy selected for a frozen review lap. */
  | {
      type: 'build_review_policy_resolved';
      rubric: string;
      lapId: string;
      provider: string;
      source: 'project' | 'global' | 'plugin';
      pluginId?: string;
      bundleDigest: string;
      /** Bounded identity only; captured policy bytes never enter telemetry. */
      provenance?: {
        readonly inputDigest: string;
        readonly candidate: { readonly provider: string; readonly model: string; readonly effort: string };
        readonly plugin?: { readonly id: string; readonly version?: string };
      };
    }
  /** Policy discovery, compatibility, containment, or runtime refusal. */
  | {
      type: 'build_review_policy_failed';
      rubric: string;
      lapId: string;
      provider: string;
      stage: 'catalog' | 'capture' | 'preflight' | 'containment' | 'runtime';
      reason: string;
      /** The candidate/input are known even when policy content never loaded. */
      provenance?: {
        readonly inputDigest: string;
        readonly candidate: { readonly provider: string; readonly model: string; readonly effort: string };
      };
    }
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
  | {
      /** Per-surface cost for one completed self-host live-boundary fingerprint. */
      type: 'self_host_boundary_fingerprint';
      surfaces: readonly { label: string; elapsedMs: number; fileCount: number }[];
    }
  /** Serialized rubric-prompt size at dispatch — regression visibility for projection bloat. */
  | { type: 'build_review_rubric_prompt'; rubric: string; lapId: string; promptBytes: number }
  | { type: 'build_review_rubric_result'; rubric: string; lapId: string; verdict: 'PASS' | 'FAIL' }
  | { type: 'build_review_rubric_skipped'; rubric: string; lapId: string; reason: string }
  | {
      type: 'build_review_cache_hit';
      rubric: string;
      lapId: string;
      /** Present only for a custom policy reused from prior judged evidence. */
      customReuse?: {
        readonly source: 'project' | 'global' | 'plugin';
        readonly plugin?: { readonly id: string; readonly version?: string };
        readonly bundleDigest: string;
        readonly inputDigest: string;
        readonly candidate: { readonly provider: string; readonly model: string; readonly effort: string };
        readonly originalLapId: string;
        readonly originalSnapshotDigest: string;
      };
    }
  /** Frozen scope assessment for one rubric lap; routine detail stays in the shared ledger. */
  | {
      type: 'build_review_scope_summary';
      rubric: string;
      lapId: string;
      establishedTargetCount: number;
      candidateCount: number;
      unresolvedReasons: readonly string[];
      excludedMarkerFiles?: readonly { readonly selector: string; readonly reason: string }[];
    }
  /** Durable announcement of the engine-decided scope for one rubric lap. */
  | {
      type: 'build_review_review_scope';
      rubric: string;
      lapId: string;
      mode: 'full' | 'delta';
      reason: 'first-lap' | 'merge-base-changed' | 'version-changed' | 'record-unreadable' | 'open-source-unmapped' | 'delta';
      deltaHunkCount: number;
      settledHunkCount: number;
    }
  /** adr-2026-08-21 D5: a cached judgement discarded because the judging engine or rubric skill text changed. */
  | { type: 'build_review_cache_discarded'; rubric: string; lapId: string; reason: 'engine-version-mismatch' | 'skill-digest-mismatch'; cachedEngineStamp?: string; currentEngineStamp: string }
  | {
      type: 'build_review_rubric_infrastructure_failure';
      rubric: string;
      lapId: string;
      reason: string;
      /**
       * The closed mechanical-fault cause, when the coordinator has classified
       * this infrastructure occurrence at the result boundary.
       */
      cause?: BuildReviewInfrastructureFailureReason;
      /** Field-named native structured-result contract rejection, when present. */
      rejection?: BuildReviewJudgedResultRejection;
      /** Best-effort retained reviewer response record, relative to the worktree root. */
      retainedResponsePath?: string;
      excerpt?: string;
      /** Present only when the canonical rubric projection exceeded its configured byte bound. */
      measuredBytes?: number;
      limitBytes?: number;
      /** Paths in the captured review inputs that changed before the lap settled. */
      changedInputs?: readonly string[];
      /** Host platform on which a read-only review capability was assessed. */
      platform?: string;
    }
  /** Valid scope judgment could not resolve a concrete candidate; not a malformed provider result. */
  | {
      type: 'build_review_scope_incomplete';
      rubric: string;
      lapId: string;
      candidates: readonly {
        candidateId: string;
        sourceRegion: { path: string; startLine: number; endLine: number; contentHash: string; display: string };
        obligationReferences: readonly string[];
        missingEvidenceReason: string;
      }[];
    }
  | {
      /** The shared retry allowance was exhausted for a mechanical rubric failure. */
      type: 'build_review_mechanical_allowance_exhausted';
      lapId: string;
      rubric: string;
      reason: string;
      consumed: number;
      allowance: number;
    }
  | { type: 'build_review_disposition_accepted'; feature: string; lapId: string; findingId: string; operator: string }
  | {
      /** An interactive operator accepted reduced review coverage for one failed rubric. */
      type: 'build_review_reduced_coverage_accepted';
      feature: string;
      lapId: string;
      rubric: string;
      reason: string;
      operator: string;
    }
  | { type: 'build_review_disposition_refused'; feature: string; reason: string }
  | { type: 'build_review_disposition_version_invalidated'; feature: string; findingId: string; rubric: string; contractVersion: string }
  | {
      type: 'build_review_outer_verdict';
      lapId: string;
      rawVerdict: 'PASS' | 'FAIL';
      effectiveVerdict: 'PASS' | 'FAIL';
      /** Deterministic container-level PASS cause, when no rubric ran. */
      reason?: string;
      /** Unbound Covers declarations seen in the frozen test-quality scope. */
      unresolvedMarkers?: readonly { selector: string; reference: string }[];
      /** Findings below the configured per-rubric confidence floor. */
      suppressedFindings?: readonly { findingId: string; rubric: string; confidence: number; floor: number }[];
      /** Below-threshold findings are durable advisory history, never a route. */
      advisoryFindings?: readonly { findingId: string; rubric: string; severity: 'critical' | 'major' | 'minor' | 'nit'; threshold: 'critical' | 'major' | 'minor' | 'nit' }[];
      /** Scope bookkeeping: visible, never accepted risk or remediation work. */
      outOfDeltaCount?: number;
    }
  | {
      /** A post-join remediation judgement is about to run for one build-review lap. */
      type: 'remediation_adjudication_started';
      domain: 'build_review';
      lapId: string;
      /** The index-only task bodies added for the bounded second adjudication round. */
      expansionTaskIds?: readonly string[];
      /** Case ids whose refused bindings caused this one correction round. */
      bindingCorrectionCaseIds?: readonly string[];
    }
  | {
      /** A valid remediation judgement was fully reconciled for one build-review lap. */
      type: 'remediation_adjudication_completed';
      domain: 'build_review';
      lapId: string;
      caseIds: readonly string[];
      effectIds: readonly string[];
      /** Durable stop evidence, including blocked consistency verdicts. */
      decisionStops?: readonly { readonly caseId: string; readonly owner?: 'product' | 'plan' | 'architecture'; readonly sourceIds: readonly string[]; readonly rationale: string }[];
    }
  | {
      /** A remediation judgement could not be completed and remains fail-closed. */
      type: 'remediation_adjudication_failed';
      domain: 'build_review';
      lapId: string;
      reason: string;
      /** Present when a proposed case-store transition was refused without corrupting persisted history. */
      rejectedTransition?: {
        readonly invariant: 'source-linked-by-multiple-cases' | 'duplicate-case-id' | 'duplicate-effect-id' | 'invalid-next-state';
        readonly caseIds: readonly string[];
        readonly sourceIds: readonly string[];
      };
    }
  | {
      /** A new source was carried from a prior operator-accepted remediation case. */
      type: 'build_review_acceptance_carried';
      eventId: string;
      feature: string;
      lapId: string;
      sourceId: string;
      caseId: string;
      originSourceIds: readonly string[];
      originLapIds: readonly string[];
    }
  | {
      /** An operator resolved a remediation case outside the adjudication judgement. */
      type: 'remediation_case_operator_resolved';
      eventId: string;
      feature: string;
      caseId: string;
      sourceIds: readonly string[];
    }
  | {
      /** One canonical remediation case was reconciled against the current lap. */
      type: 'remediation_case_reconciled';
      /** Makes outbox delivery of a retirement occurrence replay-safe. */
      eventId?: string;
      domain: 'build_review';
      lapId: string;
      caseId: string;
      resolution: 'open' | 'resolved';
      recurrenceOf?: readonly string[];
      distinctFrom?: readonly { readonly caseId: string; readonly reason: string }[];
      reRaiseKind?: 'residual-gap' | 'undeclared';
      boundCaseId?: string;
    }
  | {
      /** One attempted remediation case was refuted against the current lap. */
      type: 'remediation_case_refuted';
      domain: 'build_review';
      lapId: string;
      caseId: string;
      residualEffectId?: string;
    }
  | {
      /** Durable PRD widening lifecycle occurrence; detail remains in case/decision state. */
      type: 'prd_widening_reconciled';
      sourceId: string;
      caseId?: string;
      decisionId?: string;
      outcome: 'offer' | 'imported' | 'recovered' | 'same-case' | 'different' | 'uncertain' | 'reused' | 'rejected';
      reason?: string;
    }
  | {
      /** One idempotent remediation effect was reserved before execution. */
      type: 'remediation_effect_reserved';
      domain: 'build_review';
      lapId: string;
      caseId: string;
      effectId: string;
      effectKind: 'action' | 'deferral';
    }
  | {
      /** One reserved remediation effect completed successfully. */
      type: 'remediation_effect_applied';
      domain: 'build_review';
      lapId: string;
      caseId: string;
      effectId: string;
      effectKind: 'action' | 'deferral';
    }
  | {
      /** One reserved remediation effect failed and remains blocking. */
      type: 'remediation_effect_failed';
      domain: 'build_review';
      lapId: string;
      caseId: string;
      effectId: string;
      effectKind: 'action' | 'deferral';
      reason: string;
    }
  | {
      /** A previously attempted or resolved case reappeared and halted routing. */
      type: 'remediation_semantic_repeat_halt';
      domain: 'build_review';
      lapId: string;
      caseId: string;
      effectId?: string;
      reason: 'already-attempted' | 'regressed' | 'recurrence-limit';
      lineageCaseIds?: readonly string[];
      reRaiseKind?: 'residual-gap' | 'undeclared' | 'repeat';
      appliedAttempts?: number;
    }
  | { type: 'build_review_stale_aggregate'; storedLapId: string; currentLapId: string }
  | {
      type: 'step_started';
      step: StepName;
      index: number;
      executionContext?: ExecutionContext;
    }
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
      type: 'step_completed';
      step: StepName;
      status: StepStatus;
      tail?: string[];
      tokenUsage?: TokenUsage;
      model?: string;
      effort?: EffortLevel;
      tier?: ComplexityTier;
      unmetered?: boolean;
      /** Preferred provider resolved for this step, when provider routing is active. */
      preferredProvider?: string;
      /** Provider that produced the successful result. */
      actualProvider?: string;
      observedIntervals?: readonly ObservedInterval[];
      /** Bounded completeness of managed gh observation for this step outcome. */
      managedGhObservationCoverage?: ManagedGhObservationCoverage;
      /** Build-only tree witnesses; absent on legacy and non-build events. */
      treeBefore?: string | null;
      treeAfter?: string | null;
      executionContext?: ExecutionContext;
    }
  | {
      type: 'step_failed';
      step: StepName;
      error: string;
      retryCount: number;
      /** Bounded facts from the final failed provider attempt, when available. */
      providerExit?: ProviderExitFacts;
      effort?: EffortLevel;
      tier?: ComplexityTier;
      observedIntervals?: readonly ObservedInterval[];
      executionContext?: ExecutionContext;
    }
  | {
      /** A started execution was catchably interrupted before work could settle. */
      type: 'step_interrupted';
      step: StepName;
      reason: string;
      executionContext?: ExecutionContext;
    }
  | {
      /** The step was stopped before its own work could be judged a failure. */
      type: 'step_refused';
      step: StepName;
      kind: 'seal' | 'needs-human' | 'validation-verdict';
      reason: string;
      provider?: string;
      executionContext?: ExecutionContext;
    }
  | {
      /** A domain rule refused a conductor-owned step status write. */
      type: 'step_status_write_refused';
      field: string;
      expected: 'skipped';
      requested: 'stale';
      intent: string;
    }
  | GithubOperationRefusedEvent
  | GithubWriteCredentialFallbackEvent
  | ProviderDiscoveryEvent
  | ProviderAttemptEvent
  | ProviderAttemptStartedEvent
  | ProviderStreamProgressEvent
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
  | ({
      /** Allowlisted provider transcripts were captured before a scratch home was retired. */
      type: 'provider_transcripts_captured';
      runId: string;
      attempt: number;
      member?: string;
      provider: string;
      path: string;
      files: number;
      bytes: number;
      interrupted: boolean;
      skipped: number;
      omittedLines: number;
    } & (
      /** Current captures retain their owner and project its display step. */
      | { readonly owner: TranscriptOwner; readonly step: string }
      /** Rows persisted before owner identities were introduced. */
      | { readonly owner?: never; readonly step: TranscriptOwnerStep }
    ))
  | ({
      /** Provider transcript capture failed, but scratch-home retirement continued. */
      type: 'provider_transcripts_harvest_failed';
      runId: string;
      attempt: number;
      member?: string;
      provider: string;
      path: string;
      error: string;
    } & (
      /** Current captures retain their owner and project its display step. */
      | { readonly owner: TranscriptOwner; readonly step: string }
      /** Rows persisted before owner identities were introduced. */
      | { readonly owner?: never; readonly step: TranscriptOwnerStep }
    ))
  | {
      /** A captured provider transcript was retained after its step verdict settled. */
      type: 'provider_transcripts_retained';
      path: string;
    }
  | {
      /** A captured provider transcript was pruned after successful step progress. */
      type: 'provider_transcripts_pruned';
      path: string;
    }
  | {
      /** A retained provider transcript was evicted to satisfy a retention cap. */
      type: 'provider_transcripts_evicted';
      path: string;
      reason: 'count' | 'size';
    }
  | {
      /** A provider transcript retention cleanup action failed. */
      type: 'provider_transcripts_retention_failed';
      path: string;
      action: 'prune' | 'evict';
      error: string;
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
      tier?: ComplexityTier;
      dispatches: number;
      meteredDispatches: number;
      unmeteredDispatches: number;
      costUsd: number;
      /** Fresh (non-cached) input tokens — TokenUsage.input semantics. */
      inputTokens: number;
      outputTokens: number;
      /** Cached prompt volume (cache reads + creation), when tracked. */
      cachedInputTokens?: number;
      /**
       * Dispatches whose tokens are counted above but whose cost is not —
       * a provider that reports usage without money, or one whose model has no
       * entry in the committed rate card. Non-zero means `costUsd` is a PARTIAL
       * figure, not the feature total.
       */
      costUnmeteredDispatches?: number;
    }
  | {
      /**
       * Non-persisted projection of the ledger emitted after each step close.
       *
       * Its dimensions are cumulative ledger totals, so OTel can record the
       * current feature-wide cost without treating a step terminal as a new
       * cost occurrence.
       */
      type: 'feature_cost_snapshot';
      tier?: ComplexityTier;
      costUsd: number;
      costComplete: boolean;
      byDimension: Array<{
        step: string;
        model?: string;
        provider?: string;
        source?: 'provider' | 'rate-card';
        costUsd: number;
      }>;
      tokensByDimension: Array<{
        step: string;
        model?: string;
        provider?: string;
        tokens: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number };
      }>;
    }
  | {
      /** A visible transition from an unavailable provider to the next candidate. */
      type: 'provider_fallback';
      step: StepName;
      failedProvider: string;
      reason: string;
      recoveryAction?: string;
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
      /** Bounded facts from the failed provider attempt that triggered this retry. */
      providerExit?: ProviderExitFacts;
      /** Dimensions of the failed attempt, distinct from upcoming escalation fields below. */
      model?: string;
      effort?: EffortLevel;
      provider?: string;
      /** Resolved provider facts from the failed attempt. */
      actualProvider?: string;
      preferredProvider?: string;
      tier?: ComplexityTier;
      resolvedBefore?: number;
      resolvedAfter?: number;
      /**
       * The consumed progress-attempt allowance for a refunded build retry.
       * Present together only when that retry reuses its fixed-budget slot.
       */
      progressAttempt?: number;
      progressAttemptCeiling?: number;
      /**
       * #188 retry-as-escalation: the (model, effort) the UPCOMING attempt
       * (`attempt` above) will dispatch at, per the escalation ladder. Absent
       * on a `escalate:false` step (identical retry — no movement to record) and
       * on pre-#188 event logs (backward-compatible; `aggregateRetryHotspots`
       * tolerates their absence).
       */
      escalatedModel?: string;
      escalatedEffort?: string;
      executionContext?: ExecutionContext;
    }
  | {
      // #646: rerun-vs-route classification, emitted on every classifier-
      // covered completion-gate miss (verdict steps only) so the audit log
      // can pair a decision with the outcome event that follows it.
      type: 'retry_decision';
      step: StepName;
      attempt: number;
      decision: 'rerun' | 'route';
      signal?: 'named-route' | 'identical-repeat' | 'unretryable-inputs' | 'stale-run-identity' | 'terminal-refusal';
      unchangedInput?: string;
    }
  | { type: 'checkpoint_reached'; step: StepName }
  | { type: 'recovery_needed'; step: StepName; options: RecoveryOption[] }
  | { type: 'gate_blocked'; step: StepName; reason: string }
  | { type: 'tier_skip'; step: StepName; tier: ComplexityTier }
  | { type: 'config_skip'; step: StepName; reason?: string }
  | { type: 'navigation_back'; from: StepName; to: StepName }
  | {
      type: 'rate_limit';
      waitSeconds: number;
      reason?: 'usage-exhausted';
      /** Provider whose attempt reported the rate limit; absent on historical records. */
      provider?: string;
      /** Absolute retry deadline used for the rate-limit wait; absent on historical records. */
      deadline?: number;
    }
  | {
      /** Daemon-origin durable record used to restore provider suppression after restart. */
      type: 'provider_suppressed';
      provider: string;
      deadline: number;
    }
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
  | StackPublicationEvent
  | {
      type: 'feature_complete';
      prUrl?: string;
      featureDesc?: string;
      sessionStartedAt?: number;
      tier?: ComplexityTier;
      headSha?: string;
      baseSha?: string;
      prDisposition?: RunPrDisposition;
    }
  | { type: 'dashboard_refresh' }
  | {
      type: 'protected_artifact_rebaseline';
      trigger: string;
      fromCommit: string;
      toCommit: string;
      paths: string[];
      /** Maps each base-inherited deleted artifact path to its deleting base commit. */
      deletedBy?: Record<string, string>;
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
        | 'head-differs-from-base'
        | 'engine-append-unvouched';
      path?: string;
      /** Merge-base used to classify a named path, when provenance resolved far enough to obtain one. */
      mergeBase?: string;
      /** Whether HEAD changed the named path since `mergeBase`; degraded probes stay explicit. */
      headTouchedPath?: boolean | 'indeterminate';
      /** Why the operator-reseal exit could not approve this named path. */
      operatorResealExit?: 'not-resealed' | 'sealed-content-mismatch';
      /** Why the engine-remediation-append exit could not approve this named path. */
      engineAppendExit?: 'not-present' | 'unvouched';
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
      /** The planner prose clause that directed the sealed-artifact edit. */
      directingClause?: string;
      /** Which remediation input supplied the directing clause. */
      directingSource?: 'task title' | 'rationale';
    }
  | {
      /** A remediation planner disposition field was rejected by the engine. */
      type: 'remediation_disposition_rejected';
      gapId: string;
      disposition: string;
      accepted: string[];
      field?: 'disposition' | 'category' | 'boundTaskIds';
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
      floorSource: 'attempt' | 'session' | 'run-identity';
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
      /** Advisory commit records Git found patch-equivalent to the review base. */
      filteredCommits?: readonly { readonly sha: string; readonly subject: string }[];
      /** Advisory paths excluded from the graded diff by those commit records. */
      excludedPaths?: readonly string[];
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
  /** BUILD completed after its one review pass with explicit test-proof exceptions. */
  | {
      type: 'build_done_when_unverified';
      checks: readonly { readonly taskId: string; readonly check: string }[];
    }
  | {
      /** One native citation-judgement pass, including an unavailable fallback. */
      type: 'done_when_citation_judged';
      citations: readonly {
        readonly taskId: string;
        readonly check: number;
        readonly verdict?: 'asserts' | 'does-not-assert';
        readonly unavailable?: string;
      }[];
    }
  | {
      /** One remediation-close judgement pass, including its unavailable fallback. */
      type: 'remediation_closure_judged';
      outcome: 'judged' | 'unjudged';
      attempts: number;
      candidates: readonly {
        readonly taskId: string;
        readonly verdict: 'resolved' | 'persists' | 'partial' | 'unjudged';
        readonly rationale: string;
        readonly disposition: 'reopened' | 'left-closed' | 'bound-exhausted';
      }[];
    }
  | {
      /** An operator accepted one previously refused Done-when citation. */
      type: 'done_when_citation_accepted';
      taskId: string;
      check: number;
      reason: string;
    }
  | {
      type: 'build_stall';
      step: StepName;
      reason: 'no_task_progress' | 'halt_marker' | 'active_stall';
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
      /** Epoch ms of the last observed commit, if tracked. */
      lastCommitAt?: number;
      /** Activity classification at the time of this tick. */
      activity: BuildActivity;
    }
  | {
      /**
       * Non-build step heartbeat: emitted by StepInFlightTicker at the
       * `build_progress.heartbeat_minutes` interval while a step is running.
       */
      type: 'step_in_flight';
      step: StepName;
      elapsedMs: number;
      featureSlug?: string;
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
      /** Epoch ms of the latest provider activity in this build dispatch, if observed. */
      lastActivityAt?: number;
      /** Activity classification at the time of this tick. */
      activity: BuildActivity;
      featureSlug?: string;
    }
  | {
      /** Active build output has continued without a corresponding movement. */
      type: 'build_active_stall';
      step: StepName;
      /** Minutes elapsed since the last observed movement. */
      minutes: number;
      resolved: number;
      total: number;
      /** Epoch ms of the last observed commit, if tracked. */
      lastCommitAt?: number;
      /** Epoch ms of the latest provider activity, if observed. */
      lastActivityAt?: number;
      action: 'warn' | 'end_attempt';
      featureSlug?: string;
    }
  | {
      /** A skipped complete record observed in the pipeline-owned event ledger. */
      type: 'pipeline_tail_diagnostic';
      reason: 'malformed-line' | 'unadmitted-type' | 'poll-failed';
      /** Relative path to the tailed pipeline-owned ledger. */
      path: string;
      /** Byte offset of a malformed line, when a line was skipped. */
      byteOffset?: number;
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
      /** False when an advisory branch failed but the group remains open. */
      terminal?: boolean;
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
      /** Correlates an admitted configured member without registering it as a StepName. */
      executionContext?: ExecutionContext;
    }
  // ── Gate-driven loop (Phase 5 observability) ──
  | {
      /** A gate's objective verdict was (re)computed by the loop. */
      type: 'gate_verdict';
      step: StepName;
      satisfied: boolean;
      reason?: string;
      /** The run complexity tier, when available at emission time. */
      tier?: ComplexityTier;
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
      /** Optional to preserve parsing of events emitted before verification modes existed. */
      mode?: 'aggregate' | 'scoped' | 'changed';
      /** Present only for a newly executed ordered aggregate collection. */
      executionSummary?: {
        plannedEntryCount: number;
        attemptedEntryCount: number;
        entries: Array<{ index: number; result: 'passed' | 'failed'; durationMs: number }>;
      };
      /** Present only when the inspection made a drift-budget verdict. */
      budgetVerdict?:
        | {
            outcome: 'preserved_within_budget';
            categories: Record<string, number>;
          }
        | {
            outcome: 'rerun_required';
            reason: 'drift_budget_exceeded' | 'unbudgetable_drift';
            category: string;
            count: number;
            bound: 'none' | number;
          };
      /** Records the non-silent aggregate fallback for a scoped empty selector set. */
      executionBasis?: 'scoped-empty-selection-aggregate';
    }
  | {
      /**
       * A BUILD-verification member settled using its own existing evidence.
       * This is observability only; the group join remains the sole authority
       * that declares the member satisfied for the round.
       */
      type: 'build_member_evidence_reused';
      member: 'test_suite';
      decision: 'reuse';
      basis: 'fingerprint-match';
      /** Optional to preserve parsing of events emitted before verification modes existed. */
      mode?: 'aggregate' | 'scoped' | 'changed';
    }
  | {
      /**
       * A BUILD-verification member settled after deriving fresh evidence.
       * The basis is a closed, sanitized classification rather than raw
       * evidence, command output, credentials, or host paths.
       */
      type: 'build_member_evidence_recomputed';
      member: 'test_suite';
      decision: 'recompute';
      basis:
        | 'recorded-head-versus-current-head'
        | 'fingerprint-mismatch'
        | 'fresh-evidence-required';
    }
  | {
      /** A feature-declared applicability marker made this step inapplicable for the feature. */
      type: 'step_inapplicable';
      step: StepName;
      reason: string;
      decider: { author: string; committer: string } | 'unknown';
      commit?: string;
    }
  | {
      /** An applicability marker was present but not honored. */
      type: 'step_inapplicable_ignored';
      cause: 'branch-only' | 'toggle-off' | 'invalid' | 'interactive';
      step?: string;
      detail?: string;
    }
  | {
      /** A late declaration was refused because the step already left pending. */
      type: 'step_inapplicable_refused';
      step: StepName;
      reason: string;
      priorStatus: StepStatus;
    }
  | {
      /** A downstream step re-opened an upstream gate (plan/stories). */
      type: 'kickback';
      from: StepName;
      to: StepName;
      evidence?: string;
      /** The run complexity tier, when available at emission time. */
      tier?: ComplexityTier;
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
      tier?: ComplexityTier;
      headSha?: string;
      baseSha?: string;
      prDisposition?: RunPrDisposition;
      /** Present when an external BUILD action classifies its own terminal halt. */
      haltClass?: 'plan-gap';
      /**
       * URL of the auto-opened needs-remediation draft PR, when the conductor
       * irrecoverably HALTs in auto mode and escalation succeeded. Absent when
       * mode is not 'auto', on rebase-conflict halts, or when escalation could
       * not create a PR (zero commits, push failure, gh error).
       */
      prUrl?: string;
    }
  | {
      /** A project's selected tracker backend has no configured adapter. */
      type: 'tracker_backend_unavailable';
      project: string;
      backend: 'github' | 'jira';
      reason: 'no-adapter' | 'invalid-config';
    }
  | {
      /** Recorded OVER_SCOPE decisions and any evidentiary defects from one clear. */
      type: 'over_scope_decision';
      /** Blocking criteria considered while harvesting this clear. */
      criteria: string[];
      /** Decisions durably recorded by this occurrence. */
      decisions: OverScopeDecisionEventRecord[];
      /** Named evidentiary defects; defective entries are never recorded. */
      defects: OverScopeDecisionEventDefect[];
    }
  | {
      /** Writing the durable HALT marker failed, so the feature may not be parked. */
      type: 'halt_marker_write_failed';
      path: string;
      reason: string;
    }
  | {
      /** A durable halt record was written and committed for the feature. */
      type: 'halt_record_written';
      path: string;
      slug: string;
      haltClass: 'needs-human' | 'mechanical' | 'protected-artifact' | 'plan-gap' | 'stack-tip-diverged';
    }
  | {
      /** Writing or committing a durable halt record failed. */
      type: 'halt_record_write_failed';
      path: string;
      reason: string;
    }
  | {
      /** Pushing a committed durable halt record failed. */
      type: 'halt_record_push_failed';
      path: string;
      reason: string;
    }
  | {
      /**
       * The post-FINISH shipment audit refused a candidate ship. Carries the
       * two commits the durable-evidence evaluator compared, so an operator
       * can tell WHICH heads disagreed instead of re-deriving them from the
       * refusal code alone.
       */
      type: 'shipment_evidence_refused';
      slug: string;
      /** The implementation PR the audit bound the candidate to. */
      pr: string;
      /** The evaluator's typed refusal code. */
      code: string;
      /** What the evaluator required — the implementation head for a reachability refusal. */
      expected: string;
      /** What it observed — the audited candidate commit for a reachability refusal. */
      observed: string | null;
    }
  | {
      /** The gate loop reached a fully-satisfied state (.pipeline/DONE). */
      type: 'loop_converged';
    }
  // ── Rebase-on-latest (Phase 9.0) — structured rebase outcome events ──
  | {
      /** The branch was already current with the base — rebase was a no-op. */
      type: 'rebase_noop';
      baseSha?: string | null;
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
      baseSha?: string | null;
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
      /** A bounded test-suite drift evaluation retained its existing PASS. */
      basis?: 'test_suite_drift_budget';
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
      /** A merge-bearing rebase replay was flattened into first-parent commits. */
      type: 'rebase_merge_audit';
      flattenedMerges: string[];
      ancestryOnlyMerges: string[];
      sideLineageCount: number;
    }
  | {
      /** A non-trivial/mixed conflict parked the feature (FR-8). */
      type: 'rebase_conflict_halt';
      step?: StepName;
      reason: string;
      conflicts: string[];
      mergeAudit?: {
        flattenedMerges: string[];
        ancestryOnlyMerges: string[];
        sideLineageCount: number;
        parents?: [string, string];
        flattenedSha?: string;
        conflicts?: string[];
      };
    }
  | {
      /** Untracked files were moved aside before retrying a refused rebase. */
      type: 'rebase_untracked_quarantined';
      paths: string[];
      directory: string;
    }
  | {
      /** A persisted repair-obligation boundary was translated after a rebase. */
      type: 'repair_boundary_translated';
      obligationId: string;
      from: string;
      to: string;
      rule: 'direct' | 'successor';
      projectRoot: string;
    }
  | {
      /**
       * Residue: pre-image shas cited by evidence but with no patch-id
       * match post-rebase (dropped or content-changed). Surfaced instead of
       * silently repointed — see `writeResidue` in engine/rebase-translate.ts.
       */
      type: 'rebase_citation_residue';
      residue: Array<{
        sha: string;
        citingTaskIds: string[];
        citingObligationIds: string[];
        reason: string;
      }>;
    }
  | {
      /** A judged supersession was suite-verified and published. */
      type: 'rebase_supersession_verdict';
      choice: 'superseded' | 'merged' | 'source';
      rationale: string;
      superseded: string[];
      verification: { command: string; exitCode: 0 };
    }
  // ── Rebase auto-resolution lifecycle (Phase 9 / rebase-resolution) ──
  | {
      /** Produced by the rebase auto-resolution resolver as a guarded-stage progress occurrence. */
      type: 'rebase_resolution_stage';
      stage: 'acceptance-guards';
      status: 'passed';
      prUrl: string;
      worktreePath: string;
    }
  | {
      /** Produced by the rebase auto-resolution resolver as a guarded-stage progress occurrence. */
      type: 'rebase_resolution_stage';
      stage: 'suite-gate';
      status: 'started';
      prUrl: string;
      worktreePath: string;
    }
  | {
      /** Produced by the rebase auto-resolution resolver as a guarded-stage progress occurrence. */
      type: 'rebase_resolution_stage';
      stage: 'suite-gate';
      status: 'passed';
      prUrl: string;
      worktreePath: string;
      durationMs: number;
    }
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
      cause: 'operator' | 'rekick' | 'kickback-budget' | 'stall-remediation';
    }
  | {
      /** An interactive operator authorized clearing a halted feature. */
      type: 'halt_clear_authorized';
      feature: string;
      operator: string;
      rationale: string;
      haltClass: string;
      step: StepName;
    }
  | {
      /** Operator authorized a bounded recovery for one halted kickback gate. */
      type: 'kickback_budget_adjustment_authorized';
      adjustmentId: string;
      gate: string;
      kind: 'raise' | 'reset';
      feature: string;
      operator: string;
      rationale: string;
      beforeConsumed: number;
      afterConsumed: number;
      beforeLimit: number;
      afterLimit: number;
      ts: string;
      allowance?: 'laps' | 'growth' | 'restacks';
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
  | {
      /** Current readiness verdict for a watched shipped PR. */
      type: 'shipped_pr_readiness';
      prUrl: string;
      slug: string;
      verdict: 'ready' | 'conflicting' | 'ci-failing' | 'ci-pending' | 'no-checks' | 'draft' | 'indeterminate';
      headSha: string;
      mergeable: string;
      mergeStateStatus?: string;
      checksOutcome: 'failed' | 'pending' | 'green' | 'none';
      isDraft: boolean;
      baseRefName?: string;
    }
  | {
      /** Bounded, credential-safe observation from CI-repair preparation or publication. */
      type: 'ci_repair_diagnostic';
      prUrl: string;
      slug: string;
      stage: CiRepairDiagnosticStage;
      reason: CiRepairDiagnosticReason;
      disposition: CiRepairDiagnosticDisposition;
      provider?: string;
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
      viaException?: boolean;
      /** A routed child re-ran its recorded contract rather than authoring RED evidence. */
      mode?: 'verify-green';
    }
  // ── Per-child build region lifecycle ──────────────────────────────────────
  | {
      /** A declared child region became active on its branch. */
      type: 'child_started';
      child: ChildId;
      position: number;
      branch: string;
    }
  | {
      /** A child completed its region and its closure tip was recorded. */
      type: 'child_closed';
      child: ChildId;
      position: number;
      branch: string;
      tip: string;
    }
  | {
      /** The worktree moved from one child region to the next declared position. */
      type: 'child_switched';
      from: number;
      to: number;
      position: number;
      branch: string;
    }
  | {
      /** A rebase was skipped while an intermediate child keeps the stack pinned. */
      type: 'rebase_skipped_for_stack';
      child: ChildId;
      reason: string;
    }
  // ── Stacked restack and expected-lease occurrences ──────────────────────
  | {
      type: 'restack_planned';
      opId: RestackOpId;
      cause: RestackCause;
      children: ChildId[];
    }
  | {
      type: 'restack_applied';
      opId: RestackOpId;
      cause: RestackCause;
      child: ChildId;
      oldTip: CommitSha;
      newTip: CommitSha;
      wouldInvalidate: StepName[];
      parentOverlapPaths: string[];
    }
  | {
      type: 'restack_conflict';
      opId: RestackOpId;
      child: ChildId;
      commit: CommitSha;
      paths: string[];
    }
  | {
      type: 'restack_refused';
      reason: RestackRefusalReason;
      child?: ChildId;
      detail?: string;
    }
  | {
      type: 'restack_recovered';
      opId: RestackOpId;
      fromState: Exclude<JournalState, 'applied' | 'aborted'>;
    }
  | {
      type: 'push_lease_refused';
      ref: RefName;
      expected: CommitSha;
      actual: CommitSha;
    }
  // ── Routed whole-feature repair occurrences ─────────────────────────────
  | {
      type: 'remediation_routed';
      eventId: string;
      occurredAt: string;
      roundId: RoundId;
      kind: RouteKind;
      items: readonly {
        findingId: string;
        owner: ChildId;
        host: ChildId;
        reason: string;
      }[];
      child: ChildId;
    }
  | {
      type: 'remediation_rerouted';
      eventId: string;
      occurredAt: string;
      roundId: RoundId;
      from: ChildId;
      to: ChildId;
      evidence: string;
      child: ChildId;
    }
  | {
      type: 'routed_repair_phase';
      eventId: string;
      occurredAt: string;
      roundId: RoundId;
      host: ChildId;
      phase: HostState;
      credit: boolean;
      child: ChildId;
    }
  /** Lifecycle of an operator-owned landing, delivered from the route outbox. */
  | {
      type: 'operator_round';
      eventId: string;
      occurredAt: string;
      roundId: RoundId;
      child: ChildId;
      origin: 'land' | 'rewind';
      reason: string;
      action: 'opened' | 'declared' | 'abandoned';
    }
  | {
      type: 'child_revalidated';
      eventId: string;
      occurredAt: string;
      child: ChildId;
      generation: number;
      closureSha: CommitSha;
      outcome: 'passed' | 'fixed';
    }
  // ── Worktree reclamation lifecycle ──
  | {
      type: 'worktree_reclaim_reclaimed';
      slug: string;
      branch: string;
      proof: 'ancestry' | 'merged-pr-head';
    }
  | {
      type: 'worktree_reclaim_reclaimed';
      slug: string;
      branch?: never;
      proof?: never;
    }
  | {
      type: 'worktree_reclaim_retained';
      slug: string;
      branch?: string;
      reason: WorktreeReclaimRetainedReason;
    }
  | {
      type: 'worktree_reclaim_failed';
      slug: string;
      branch?: string;
      refusal: string;
    };

export type ConductorEvent = ConductorEventBody & { child?: ChildId };
