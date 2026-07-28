import { describe, expect, it } from 'vitest';

import {
  EVENT_SINKS,
  auditedEventTypes,
  persistedEventTypes,
  renderedEventTypes,
  type SinkDeclaration,
} from '../../src/engine/event-sinks.js';
import type { ConductorEvent } from '../../src/types/events.js';

const PRE_REFACTOR_PERSISTED_EVENT_TYPES = [
  'step_started',
  'step_completed',
  'step_failed',
  'provider_attempt',
  'feature_usage_total',
  'provider_fallback',
  'session_policy',
  'step_retry',
  'checkpoint_reached',
  'recovery_needed',
  'gate_blocked',
  'tier_skip',
  'config_skip',
  'navigation_back',
  'rate_limit',
  'session_reset',
  'credentials_park',
  'credentials_park_progress',
  'feature_complete',
  'dashboard_refresh',
  'auto_heal',
  'mode_skip',
  'build_progress',
  'unattributed_progress',
  'build_no_progress',
  'build_stall',
  'renderer_error',
  'when_skip',
  'parallel_started',
  'parallel_completed',
  'parallel_failure',
  'attribution_divergence',
] satisfies Array<ConductorEvent['type']>;

const PRE_REFACTOR_AUDITED_EVENT_TYPES = [
  'gate_verdict',
  'step_retry',
  'kickback',
  'loop_halt',
  'step_completed',
  'halt_cleared',
] satisfies Array<ConductorEvent['type']>;

const DAEMON_SWITCH_HANDLED_EVENT_TYPES = [
  'step_started',
  'step_completed',
  'step_failed',
  'step_retry',
  'rate_limit',
  'session_reset',
  'build_progress',
  'unattributed_progress',
  'build_no_progress',
  'build_stall',
  'provider_attempt',
  'feature_usage_total',
  'provider_fallback',
  'session_policy',
  'gate_verdict',
  'kickback',
  'navigation_back',
  'loop_halt',
  'loop_converged',
  'ci_failed',
  'build_review_base',
  'build_review_stale_mirage_regrade',
  'auto_park_contradiction',
  'verdict_freshness',
] satisfies Array<ConductorEvent['type']>;

const { verdict_freshness: _omitted, ...missingVerdictFreshness } = EVENT_SINKS;
// @ts-expect-error -- every ConductorEvent type must declare all three sink decisions.
missingVerdictFreshness satisfies Record<ConductorEvent['type'], SinkDeclaration>;

const deliberatelyNotPersisted = {
  render: false,
  persist: false,
  audit: false,
} satisfies SinkDeclaration;
void deliberatelyNotPersisted;

describe('event sink subscriptions', () => {
  it('is total over all 60 ConductorEvent types', () => {
    expect(Object.keys(EVENT_SINKS)).toHaveLength(60);
  });

  it('routes verdict_freshness to every sink', () => {
    expect(EVENT_SINKS.verdict_freshness).toEqual({
      render: true,
      persist: true,
      audit: true,
    });
  });

  it('derives the persisted set without changing prior routing', () => {
    const persisted = persistedEventTypes();

    expect(new Set(persisted)).toEqual(new Set([
      ...PRE_REFACTOR_PERSISTED_EVENT_TYPES,
      'verdict_freshness',
    ]));
    expect(persisted).not.toEqual(Object.keys(EVENT_SINKS));
  });

  it('derives the audited set without changing prior routing', () => {
    expect(new Set(auditedEventTypes())).toEqual(new Set([
      ...PRE_REFACTOR_AUDITED_EVENT_TYPES,
      'verdict_freshness',
    ]));
  });

  it('derives the daemon-rendered set from the switch-handled event types', () => {
    expect(new Set(renderedEventTypes())).toEqual(new Set(DAEMON_SWITCH_HANDLED_EVENT_TYPES));
  });
});
