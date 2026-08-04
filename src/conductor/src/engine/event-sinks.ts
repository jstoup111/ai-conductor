import type { ConductorEvent } from '../types/events.js';

export interface SinkDeclaration {
  render: boolean;
  persist: boolean;
  audit: boolean;
}

export const EVENT_SINKS: Record<ConductorEvent['type'], SinkDeclaration> = {
  step_started: { render: true, persist: true, audit: false },
  step_completed: { render: true, persist: true, audit: true },
  step_failed: { render: true, persist: true, audit: false },
  provider_attempt: { render: true, persist: true, audit: false },
  feature_usage_total: { render: true, persist: true, audit: false },
  provider_fallback: { render: true, persist: true, audit: false },
  session_policy: { render: true, persist: true, audit: false },
  step_retry: { render: true, persist: true, audit: true },
  retry_decision: { render: false, persist: false, audit: false },
  checkpoint_reached: { render: false, persist: true, audit: false },
  recovery_needed: { render: false, persist: true, audit: false },
  gate_blocked: { render: false, persist: true, audit: false },
  tier_skip: { render: false, persist: true, audit: false },
  config_skip: { render: false, persist: true, audit: false },
  navigation_back: { render: true, persist: true, audit: false },
  rate_limit: { render: true, persist: true, audit: false },
  session_reset: { render: true, persist: true, audit: false },
  credentials_park: { render: false, persist: true, audit: false },
  operator_park_boundary: { render: true, persist: true, audit: false },
  credentials_park_progress: { render: true, persist: true, audit: false },
  finish_publication_transition: { render: true, persist: true, audit: false },
  finish_publication_blocked: { render: true, persist: true, audit: false },
  finish_publication_disposition: { render: true, persist: true, audit: false },
  feature_complete: { render: false, persist: true, audit: false },
  dashboard_refresh: { render: false, persist: true, audit: false },
  protected_artifact_rebaseline: { render: true, persist: true, audit: false },
  protected_artifact_rebaseline_refused: { render: true, persist: true, audit: false },
  auto_heal: { render: false, persist: true, audit: false },
  verdict_freshness: { render: true, persist: true, audit: true },
  build_review_base: { render: true, persist: false, audit: false },
  build_review_stale_mirage_regrade: { render: true, persist: false, audit: false },
  mode_skip: { render: false, persist: true, audit: false },
  build_stall: { render: true, persist: true, audit: false },
  build_progress: { render: true, persist: true, audit: false },
  build_no_progress: { render: true, persist: true, audit: false },
  renderer_error: { render: false, persist: true, audit: false },
  when_skip: { render: false, persist: true, audit: false },
  parallel_started: { render: true, persist: true, audit: false },
  parallel_completed: { render: true, persist: true, audit: false },
  parallel_failure: { render: false, persist: true, audit: false },
  group_member_step: { render: false, persist: false, audit: false },
  gate_verdict: { render: true, persist: false, audit: true },
  test_suite_verification: { render: false, persist: false, audit: false },
  build_member_evidence_reused: { render: true, persist: true, audit: false },
  build_member_evidence_recomputed: { render: true, persist: true, audit: false },
  kickback: { render: true, persist: false, audit: true },
  loop_halt: { render: true, persist: false, audit: true },
  loop_converged: { render: true, persist: false, audit: false },
  rebase_noop: { render: false, persist: false, audit: false },
  rebase_mergeable_skip: { render: true, persist: false, audit: false },
  rebase_changed: { render: false, persist: false, audit: false },
  rebase_gate_reverified: { render: false, persist: false, audit: false },
  rebase_gate_preserved: { render: false, persist: false, audit: false },
  rebase_gate_invalidated: { render: false, persist: false, audit: false },
  rebase_conflict_halt: { render: false, persist: false, audit: false },
  rebase_citation_residue: { render: false, persist: false, audit: false },
  rebase_resolution_attempt: { render: false, persist: false, audit: false },
  rebase_resolution_succeeded: { render: false, persist: false, audit: false },
  rebase_resolution_failed: { render: false, persist: false, audit: false },
  rebase_resolution_exhausted: { render: false, persist: false, audit: false },
  auto_park: { render: false, persist: false, audit: false },
  auto_park_contradiction: { render: true, persist: false, audit: false },
  zero_work_product: { render: false, persist: false, audit: false },
  unattributed_dispatch: { render: false, persist: false, audit: false },
  unattributed_progress: { render: true, persist: true, audit: false },
  halt_cleared: { render: false, persist: false, audit: true },
  ci_failed: { render: true, persist: false, audit: false },
  attribution_divergence: { render: false, persist: true, audit: false },
};

function eventTypesFor(sink: keyof SinkDeclaration): ConductorEvent['type'][] {
  return (Object.keys(EVENT_SINKS) as ConductorEvent['type'][])
    .filter((type) => EVENT_SINKS[type][sink]);
}

export function persistedEventTypes(): ConductorEvent['type'][] {
  return eventTypesFor('persist');
}

export function auditedEventTypes(): ConductorEvent['type'][] {
  return eventTypesFor('audit');
}

export function renderedEventTypes(): ConductorEvent['type'][] {
  return eventTypesFor('render');
}
