import { describe, expect, it } from 'vitest';

import { ALL_EVENT_TYPES } from '../../src/engine/event-persister.js';
import { SUBSCRIBED_EVENT_TYPES } from '../../src/engine/audit-trail.js';
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

const PRE_REFACTOR_RENDERED_EVENT_TYPES = [
  'step_started',
  'step_completed',
  'step_failed',
  'step_retry',
  'checkpoint_reached',
  'recovery_needed',
  'dashboard_refresh',
  'tier_skip',
  'config_skip',
  'gate_blocked',
  'rate_limit',
  'session_reset',
  'feature_complete',
  'auto_heal',
  'mode_skip',
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
  it('pins the 32 pre-refactor event types subscribed by EventPersister', () => {
    expect(ALL_EVENT_TYPES).toEqual(PRE_REFACTOR_PERSISTED_EVENT_TYPES);
  });

  it('pins the 6 pre-refactor event types subscribed by AuditTrailWriter', () => {
    expect(SUBSCRIBED_EVENT_TYPES).toEqual(PRE_REFACTOR_AUDITED_EVENT_TYPES);
  });

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
    expect(persistedEventTypes()).toEqual([
      ...PRE_REFACTOR_PERSISTED_EVENT_TYPES,
      'verdict_freshness',
    ]);
  });

  it('derives the audited set without changing prior routing', () => {
    expect(auditedEventTypes()).toEqual([
      ...PRE_REFACTOR_AUDITED_EVENT_TYPES,
      'verdict_freshness',
    ]);
  });

  it('derives the daemon-rendered set without changing prior routing', () => {
    expect(renderedEventTypes()).toEqual([
      ...PRE_REFACTOR_RENDERED_EVENT_TYPES,
      'verdict_freshness',
    ]);
  });
});
