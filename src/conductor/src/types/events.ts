import type { StepName, StepStatus, ComplexityTier } from './steps.js';
import type { BootstrapMode } from './state.js';
import type { TokenUsage } from '../execution/llm-provider.js';

export type RecoveryOption = 'retry' | 'interactive' | 'back' | 'skip' | 'quit';

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

export type ConductorEvent =
  | { type: 'step_started'; step: StepName; index: number }
  | { type: 'step_completed'; step: StepName; status: StepStatus; tail?: string[]; tokenUsage?: TokenUsage }
  | { type: 'step_failed'; step: StepName; error: string; retryCount: number }
  | {
      type: 'step_retry';
      step: StepName;
      attempt: number; // 1-based: "attempt 2 of 3"
      maxAttempts: number;
      reason: string;
    }
  | { type: 'checkpoint_reached'; step: StepName }
  | { type: 'recovery_needed'; step: StepName; options: RecoveryOption[] }
  | { type: 'gate_blocked'; step: StepName; reason: string }
  | { type: 'tier_skip'; step: StepName; tier: ComplexityTier }
  | { type: 'config_skip'; step: StepName }
  | { type: 'navigation_back'; from: StepName; to: StepName }
  | { type: 'rate_limit'; waitSeconds: number }
  | { type: 'session_reset'; reason: string }
  | { type: 'credentials_park'; reason: string }
  | { type: 'feature_complete'; prUrl?: string; featureDesc?: string; sessionStartedAt?: number }
  | { type: 'dashboard_refresh' }
  | { type: 'auto_heal'; step: StepName; healed: number; skipped: number }
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
      /** A downstream step re-opened an upstream gate (plan/stories). */
      type: 'kickback';
      from: StepName;
      to: StepName;
      evidence?: string;
      /** How many times this gate has been re-opened this feature. */
      count: number;
    }
  | {
      /** The gate loop stopped without converging (kickback/stuck cap). */
      type: 'loop_halt';
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
      /** The gate loop reached a fully-satisfied state (.pipeline/DONE). */
      type: 'loop_converged';
    }
  // ── Rebase-on-latest (Phase 9.0) — structured rebase outcome events ──
  | {
      /** The branch was already current with the base — rebase was a no-op. */
      type: 'rebase_noop';
    }
  | {
      /** A clean rebase changed code/test paths → downstream re-verification. */
      type: 'rebase_changed';
      changedPaths: string[];
    }
  | {
      /** A gate was re-verified post-rebase in gate-first mode. */
      type: 'rebase_gate_reverified';
      step: StepName;
      skippedDispatch: boolean;
      reason?: string;
    }
  | {
      /** A CHANGELOG-only conflict was auto-resolved (FR-7). */
      type: 'rebase_changelog_resolved';
    }
  | {
      /** A non-trivial/mixed conflict parked the feature (FR-8). */
      type: 'rebase_conflict_halt';
      reason: string;
      conflicts: string[];
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
    };
