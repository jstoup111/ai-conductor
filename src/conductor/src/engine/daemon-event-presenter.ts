import type { DaemonLogDepth, NextAction } from './daemon-log.js';
import { formatNextAction, type DaemonLogEntry } from './daemon-log.js';
import { EVENT_SINKS } from './event-sinks.js';
import type { ConductorEvent } from '../types/events.js';

/** Event types deliberately admitted to the daemon's human-facing log. */
export type RenderedEventType = {
  [Type in keyof typeof EVENT_SINKS]: (typeof EVENT_SINKS)[Type]['render'] extends true ? Type : never;
}[keyof typeof EVENT_SINKS];

export type DaemonEventPresentation = {
  depth: DaemonLogDepth;
  level: 'default' | 'once-per-dispatch' | 'verbose';
};

const defaultPresentation = { depth: 1, level: 'default' } as const;
const depthTwo = { depth: 2, level: 'default' } as const;
const verboseDepthTwo = { depth: 2, level: 'verbose' } as const;

/**
 * The sole declaration of a rendered event's stable visual column and baseline
 * verbosity. Per-case formatters may use `detail`, `once`, and `whenChanged`
 * for payload-specific refinement without inventing another indentation rule.
 */
export const DAEMON_EVENT_PRESENTATION = {
  session_command_refused: defaultPresentation, github_bypass_attempt: defaultPresentation,
  github_bypass_result: defaultPresentation, github_possible_bypass: defaultPresentation,
  session_event_delivery_diagnostic: defaultPresentation,
  operator_rewind: { depth: 0, level: 'default' }, setup_repair: defaultPresentation,
  project_setup: defaultPresentation, memory_setup: defaultPresentation, plan_growth: defaultPresentation,
  build_review_read_only_capability: defaultPresentation, contained_live_checkout_drift: defaultPresentation,
  self_host_containment_verdict: { depth: 1, level: 'once-per-dispatch' },
  self_host_boundary_fingerprint: { depth: 1, level: 'once-per-dispatch' },
  self_host_dispatch_admission: defaultPresentation, build_review_rubric_started: verboseDepthTwo,
  build_review_policy_resolved: depthTwo, build_review_policy_failed: depthTwo,
  build_review_rubric_result: depthTwo, build_review_rubric_skipped: depthTwo,
  build_review_cache_hit: depthTwo, build_review_cache_discarded: defaultPresentation,
  build_review_rubric_infrastructure_failure: depthTwo, build_review_scope_incomplete: defaultPresentation,
  build_review_outer_verdict: depthTwo, remediation_adjudication_completed: defaultPresentation,
  remediation_case_refuted: defaultPresentation, step_started: defaultPresentation, step_completed: depthTwo,
  step_failed: defaultPresentation, step_interrupted: defaultPresentation, step_refused: defaultPresentation,
  step_status_write_refused: defaultPresentation, github_operation_refused: defaultPresentation,
  github_write_credential_fallback: defaultPresentation, bot_co_author_skipped: defaultPresentation,
  provider_attempt: depthTwo, scratch_cleanup_reclaimed: defaultPresentation,
  scratch_cleanup_retained: defaultPresentation, scratch_cleanup_failed: defaultPresentation,
  feature_usage_total: depthTwo, provider_fallback: { depth: 0, level: 'default' },
  session_policy: depthTwo, step_retry: defaultPresentation, navigation_back: { depth: 0, level: 'default' },
  rate_limit: defaultPresentation, session_reset: defaultPresentation, operator_park_boundary: defaultPresentation,
  credentials_park_progress: { depth: 0, level: 'default' }, finish_publication_transition: defaultPresentation,
  finish_publication_blocked: defaultPresentation, finish_publication_disposition: defaultPresentation,
  protected_artifact_rebaseline: defaultPresentation, protected_artifact_rebaseline_refused: defaultPresentation,
  protected_artifact_reseal: defaultPresentation, protected_artifact_reseal_refused: defaultPresentation,
  remediation_sealed_artifact_redirect: defaultPresentation, remediation_disposition_rejected: defaultPresentation,
  verdict_freshness: defaultPresentation, build_review_base: defaultPresentation,
  build_review_stale_mirage_regrade: defaultPresentation, build_stall: defaultPresentation,
  build_progress: defaultPresentation, step_in_flight: defaultPresentation, build_no_progress: defaultPresentation,
  build_active_stall: defaultPresentation, pipeline_closeout: defaultPresentation,
  pipeline_tail_diagnostic: defaultPresentation, renderer_error: defaultPresentation,
  when_skip: defaultPresentation, parallel_started: defaultPresentation, parallel_completed: depthTwo,
  gate_verdict: defaultPresentation, test_suite_verification: defaultPresentation,
  build_member_evidence_reused: defaultPresentation, build_member_evidence_recomputed: defaultPresentation,
  kickback: { depth: 0, level: 'default' }, loop_halt: defaultPresentation,
  tracker_backend_unavailable: defaultPresentation, halt_marker_write_failed: defaultPresentation,
  halt_record_written: defaultPresentation, halt_record_write_failed: defaultPresentation,
  halt_record_push_failed: defaultPresentation, shipment_evidence_refused: defaultPresentation,
  loop_converged: defaultPresentation, rebase_mergeable_skip: defaultPresentation,
  step_inapplicable: defaultPresentation, step_inapplicable_ignored: defaultPresentation,
  step_inapplicable_refused: defaultPresentation, rebase_conflict_halt: defaultPresentation,
  auto_park_contradiction: defaultPresentation, unattributed_progress: defaultPresentation,
  ci_failed: defaultPresentation, ci_repair_diagnostic: defaultPresentation,
  worktree_reclaim_reclaimed: defaultPresentation, worktree_reclaim_failed: defaultPresentation,
} as const satisfies Record<RenderedEventType, DaemonEventPresentation>;

type Output = {
  info(text: string): void;
  warning(text: string, next: NextAction): void;
  halt(text: string, next: NextAction): void;
  detail(text: string): void;
  once(key: string): Output;
  whenChanged(key: string, value: unknown): Output;
};

export interface DaemonEventPresenter {
  render(event: ConductorEvent): void;
  outputFor(type: RenderedEventType): Output;
}

export function createDaemonEventPresenter({
  log,
  verbose,
  render,
}: {
  log: (entry: DaemonLogEntry) => void;
  verbose: boolean;
  /** Transitional case dispatcher; event formatters migrate here task by task. */
  render?: (event: ConductorEvent, output: Output) => void;
}): DaemonEventPresenter {
  const onceKeys = new Set<string>();
  const values = new Map<string, unknown>();

  const outputFor = (type: RenderedEventType): Output => {
    const presentation = DAEMON_EVENT_PRESENTATION[type];
    const enabled = presentation.level !== 'verbose' || verbose;
    const emit = (text: string): void => {
      if (enabled) log({ depth: presentation.depth, text });
    };
    const output: Output = {
      info: emit,
      warning: (text, next) => emit(`⚠ ${text}${formatNextAction(next)}`),
      halt: (text, next) => emit(`✋ ${text}${formatNextAction(next)}`),
      detail: (text) => { if (verbose) log({ depth: presentation.depth, text }); },
      once: (key) => {
        if (onceKeys.has(key)) return silentOutput;
        onceKeys.add(key);
        return output;
      },
      whenChanged: (key, value) => {
        if (values.get(key) === value && values.has(key)) return silentOutput;
        values.set(key, value);
        return output;
      },
    };
    return output;
  };

  return {
    // The compatibility wrapper still reaches the legacy dispatcher for a few
    // non-rendered historical variants. They deliberately have no table row.
    render: (event) => render?.(
      event,
      event.type in DAEMON_EVENT_PRESENTATION
        ? outputFor(event.type as RenderedEventType)
        : silentOutput,
    ),
    outputFor,
  };
}

const silentOutput: Output = {
  info() {}, warning() {}, halt() {}, detail() {},
  once() { return silentOutput; },
  whenChanged() { return silentOutput; },
};
