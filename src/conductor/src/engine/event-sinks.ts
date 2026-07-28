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
  checkpoint_reached: { render: true, persist: true, audit: false },
  recovery_needed: { render: true, persist: true, audit: false },
  gate_blocked: { render: true, persist: true, audit: false },
  tier_skip: { render: true, persist: true, audit: false },
  config_skip: { render: true, persist: true, audit: false },
  navigation_back: { render: true, persist: true, audit: false },
  rate_limit: { render: true, persist: true, audit: false },
  session_reset: { render: true, persist: true, audit: false },
  credentials_park: { render: false, persist: true, audit: false },
  credentials_park_progress: { render: false, persist: true, audit: false },
  feature_complete: { render: true, persist: true, audit: false },
  dashboard_refresh: { render: true, persist: true, audit: false },
  auto_heal: { render: true, persist: true, audit: false },
  verdict_freshness: { render: true, persist: true, audit: true },
  build_review_base: { render: true, persist: false, audit: false },
  build_review_stale_mirage_regrade: { render: true, persist: false, audit: false },
  mode_skip: { render: true, persist: true, audit: false },
  build_stall: { render: true, persist: true, audit: false },
  build_progress: { render: true, persist: true, audit: false },
  build_no_progress: { render: true, persist: true, audit: false },
  renderer_error: { render: false, persist: true, audit: false },
  when_skip: { render: false, persist: true, audit: false },
  parallel_started: { render: false, persist: true, audit: false },
  parallel_completed: { render: false, persist: true, audit: false },
  parallel_failure: { render: false, persist: true, audit: false },
  group_member_step: { render: false, persist: false, audit: false },
  gate_verdict: { render: true, persist: false, audit: true },
  test_suite_verification: { render: false, persist: false, audit: false },
  kickback: { render: true, persist: false, audit: true },
  loop_halt: { render: true, persist: false, audit: true },
  loop_converged: { render: true, persist: false, audit: false },
  rebase_noop: { render: false, persist: false, audit: false },
  rebase_changed: { render: false, persist: false, audit: false },
  rebase_gate_reverified: { render: false, persist: false, audit: false },
  rebase_gate_preserved: { render: false, persist: false, audit: false },
  rebase_gate_invalidated: { render: false, persist: false, audit: false },
  rebase_changelog_resolved: { render: false, persist: false, audit: false },
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

const PERSIST_ORDER: ConductorEvent['type'][] = [
  'step_started', 'step_completed', 'step_failed', 'provider_attempt',
  'feature_usage_total', 'provider_fallback', 'session_policy', 'step_retry',
  'checkpoint_reached', 'recovery_needed', 'gate_blocked', 'tier_skip',
  'config_skip', 'navigation_back', 'rate_limit', 'session_reset',
  'credentials_park', 'credentials_park_progress', 'feature_complete',
  'dashboard_refresh', 'auto_heal', 'mode_skip', 'build_progress',
  'unattributed_progress', 'build_no_progress', 'build_stall', 'renderer_error',
  'when_skip', 'parallel_started', 'parallel_completed', 'parallel_failure',
  'attribution_divergence', 'verdict_freshness',
];

const AUDIT_ORDER: ConductorEvent['type'][] = [
  'gate_verdict', 'step_retry', 'kickback', 'loop_halt', 'step_completed',
  'halt_cleared', 'verdict_freshness',
];

const RENDER_ORDER: ConductorEvent['type'][] = [
  'step_started', 'step_completed', 'step_failed', 'step_retry',
  'checkpoint_reached', 'recovery_needed', 'dashboard_refresh', 'tier_skip',
  'config_skip', 'gate_blocked', 'rate_limit', 'session_reset',
  'feature_complete', 'auto_heal', 'mode_skip', 'build_progress',
  'unattributed_progress', 'build_no_progress', 'build_stall',
  'provider_attempt', 'feature_usage_total', 'provider_fallback',
  'session_policy', 'gate_verdict', 'kickback', 'navigation_back', 'loop_halt',
  'loop_converged', 'ci_failed', 'build_review_base',
  'build_review_stale_mirage_regrade', 'auto_park_contradiction',
  'verdict_freshness',
];

function eventTypesFor(
  sink: keyof SinkDeclaration,
  order: ConductorEvent['type'][],
): ConductorEvent['type'][] {
  const orderIndex = new Map(order.map((type, index) => [type, index]));
  return (Object.keys(EVENT_SINKS) as ConductorEvent['type'][])
    .filter((type) => EVENT_SINKS[type][sink])
    .sort(
      (left, right) =>
        (orderIndex.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndex.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function persistedEventTypes(): ConductorEvent['type'][] {
  return eventTypesFor('persist', PERSIST_ORDER);
}

export function auditedEventTypes(): ConductorEvent['type'][] {
  return eventTypesFor('audit', AUDIT_ORDER);
}

export function renderedEventTypes(): ConductorEvent['type'][] {
  return eventTypesFor('render', RENDER_ORDER);
}
