// Covers: task:1
import { describe, expect, it } from 'vitest';

import { withGateTier } from '../../src/engine/gate-event-tier.js';
import type { ConductorEvent } from '../../src/types/events.js';

describe('withGateTier', () => {
  it('adds the supplied tier to a gate verdict', () => {
    const event: ConductorEvent = { type: 'gate_verdict', step: 'build_review', satisfied: true };

    expect(withGateTier(event, 'M')).toEqual({ ...event, tier: 'M' });
  });

  it('adds the supplied tier to a gate-originated kickback', () => {
    const event: ConductorEvent = { type: 'kickback', from: 'prd_audit', to: 'build', count: 1 };

    expect(withGateTier(event, 'S')).toEqual({ ...event, tier: 'S' });
  });

  it('returns the same tierless event when no run tier is available', () => {
    const event: ConductorEvent = { type: 'gate_verdict', step: 'build_review', satisfied: true };
    const result = withGateTier(event, undefined);

    expect(result).toBe(event);
    expect(Object.hasOwn(result, 'tier')).toBe(false);
  });

  it('returns a rebase invalidation unchanged even when the run has a tier', () => {
    const event: ConductorEvent = { type: 'kickback', from: 'rebase', to: 'build', count: 1 };
    const result = withGateTier(event, 'M');

    expect(result).toBe(event);
    expect(Object.hasOwn(result, 'tier')).toBe(false);
  });

  it('preserves an existing gate tier and leaves non-gate events unchanged', () => {
    const tiered: ConductorEvent = { type: 'gate_verdict', step: 'build_review', satisfied: true, tier: 'L' };
    const other: ConductorEvent = { type: 'step_started', step: 'build' };

    expect(withGateTier(tiered, 'S')).toBe(tiered);
    expect(withGateTier(tiered, 'S')).toMatchObject({ tier: 'L' });
    expect(withGateTier(other, 'S')).toBe(other);
  });
});
