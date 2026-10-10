import type { ConductorEvent } from '../types/events.js';
import type { ComplexityTier } from '../types/steps.js';

/** Adds the run tier to substantive gate events without overwriting event provenance. */
export function withGateTier(event: ConductorEvent, tier: ComplexityTier | undefined): ConductorEvent {
  if (
    tier === undefined
    || (event.type !== 'gate_verdict' && event.type !== 'kickback')
    || event.tier !== undefined
    || (event.type === 'kickback' && event.from === 'rebase')
  ) {
    return event;
  }

  return { ...event, tier };
}
