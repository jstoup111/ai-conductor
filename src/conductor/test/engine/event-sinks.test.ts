import { describe, expect, it } from 'vitest';

import { ALL_EVENT_TYPES } from '../../src/engine/event-persister.js';
import { SUBSCRIBED_EVENT_TYPES } from '../../src/engine/audit-trail.js';

describe('event sink subscriptions', () => {
  it('pins the 32 pre-refactor event types subscribed by EventPersister', () => {
    expect(ALL_EVENT_TYPES).toEqual([
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
    ]);
  });

  it('pins the 6 pre-refactor event types subscribed by AuditTrailWriter', () => {
    expect(SUBSCRIBED_EVENT_TYPES).toEqual([
      'gate_verdict',
      'step_retry',
      'kickback',
      'loop_halt',
      'step_completed',
      'halt_cleared',
    ]);
  });
});
