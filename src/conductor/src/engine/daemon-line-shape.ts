import type { RenderedEventType } from './event-sinks.js';

/** The indentation depth used for a daemon log line body. */
export type DaemonLogDepth = 0 | 1 | 2;

/** One declared depth for each event which reaches the daemon renderer. */
export type DaemonEventDepthTable = Record<RenderedEventType, DaemonLogDepth>;

/**
 * Daemon renderer depth is determined once, here.  Renderer arms only provide
 * content; this boundary adds the marker and handles continuations.
 */
export const DAEMON_EVENT_DEPTH: DaemonEventDepthTable = {
  session_command_refused: 1, github_bypass_attempt: 1, github_bypass_result: 1, github_possible_bypass: 1, session_event_delivery_diagnostic: 1,
  executor_started: 1, executor_protocol_mismatch: 1, operator_rewind: 0, setup_repair: 1, project_setup: 1, memory_setup: 1, plan_growth: 1,
  build_review_read_only_capability: 1, contained_live_checkout_drift: 1, self_host_containment_verdict: 1, self_host_boundary_fingerprint: 1, self_host_dispatch_admission: 1,
  build_review_rubric_started: 2, build_review_policy_resolved: 2, build_review_policy_failed: 2, build_review_rubric_result: 2, build_review_rubric_skipped: 2, build_review_cache_hit: 2,
  build_review_cache_discarded: 1, build_review_rubric_infrastructure_failure: 2, build_review_scope_incomplete: 1, build_review_outer_verdict: 2,
  remediation_adjudication_completed: 1, remediation_case_refuted: 1, step_started: 1, step_completed: 2, step_failed: 1, step_interrupted: 1, step_refused: 1, step_status_write_refused: 1,
  github_operation_refused: 1, github_operation_failed: 1, github_write_credential_fallback: 1, bot_co_author_skipped: 1, provider_attempt: 2, provider_attempt_started: 2,
  scratch_cleanup_reclaimed: 1, scratch_cleanup_retained: 1, scratch_cleanup_failed: 1, feature_usage_total: 2, provider_fallback: 0, session_policy: 2, step_retry: 1,
  navigation_back: 0, rate_limit: 1, session_reset: 1, operator_park_boundary: 1, credentials_park_progress: 0, finish_publication_transition: 2, finish_publication_blocked: 1, finish_publication_disposition: 1,
  protected_artifact_rebaseline: 1, protected_artifact_rebaseline_refused: 1, protected_artifact_reseal: 1, protected_artifact_reseal_refused: 1, remediation_sealed_artifact_redirect: 1,
  remediation_disposition_rejected: 1, verdict_freshness: 1, build_review_base: 1, build_review_stale_mirage_regrade: 1, build_stall: 1, build_progress: 1, step_in_flight: 1, build_no_progress: 1,
  build_active_stall: 1, pipeline_tail_diagnostic: 1, renderer_error: 1, when_skip: 1, parallel_started: 1, parallel_completed: 2, gate_verdict: 1, test_suite_verification: 1,
  build_member_evidence_reused: 1, build_member_evidence_recomputed: 1, kickback: 0, loop_halt: 1, tracker_backend_unavailable: 1, halt_marker_write_failed: 1, halt_record_written: 1,
  halt_record_write_failed: 1, halt_record_push_failed: 1, shipment_evidence_refused: 1, loop_converged: 1, rebase_mergeable_skip: 1, step_inapplicable: 1, step_inapplicable_ignored: 1,
  step_inapplicable_refused: 1, rebase_conflict_halt: 1, auto_park_contradiction: 1, unattributed_progress: 1, ci_failed: 1, ci_repair_diagnostic: 1, worktree_reclaim_reclaimed: 1,
  worktree_reclaim_failed: 1,
} as const satisfies DaemonEventDepthTable;

const MARKERS: Record<DaemonLogDepth, string> = {
  0: '',
  1: '· ',
  2: '·   ',
};

/**
 * Turn a daemon message into physical line bodies with one consistent shape.
 * The first body is left-aligned (without losing any leading ANSI SGR codes);
 * continuation bodies preserve their source content behind a continuation bar.
 */
export function composeDaemonLineBodies(message: string, depth: DaemonLogDepth): string[] {
  const lines = message.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  const marker = MARKERS[depth];
  return lines.map((line, index) => {
    if (index > 0) return line === '' ? `${marker}│` : `${marker}│ ${line}`;
    return `${marker}${stripLeadingWhitespace(line)}`;
  });
}

function stripLeadingWhitespace(line: string): string {
  const match = line.match(/^((?:\x1b\[[0-9;]*m)*)\s*/);
  if (!match) return line;
  return `${match[1]}${line.slice(match[0].length)}`;
}
