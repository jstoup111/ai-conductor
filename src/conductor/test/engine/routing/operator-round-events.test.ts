// Covers: task:25
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { operatorRoundEvent } from '../../../src/engine/routing/routing-events.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

describe('operator round events', () => {
  it('emits an identified spine occurrence carrying the landing work order', () => {
    const event = operatorRoundEvent(
      parseRoundId('r1')!,
      { origin: 'land', reason: 'repair reviewer edit', operator: 'operator', entryStep: 'acceptance_specs', carried: [], otherTips: {}, priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} } },
      parseChildId(1)!,
      'declared',
    );
    expect(event).toMatchObject({ type: 'operator_round', roundId: 'r1', child: 1, origin: 'land', reason: 'repair reviewer edit', phase: 'declared' });
    expect(event.eventId).toEqual(expect.any(String));
    expect(event.occurredAt).toEqual(expect.any(String));
  });
});
