// Covers: task:4
import { describe, expect, it } from 'vitest';

import { MAX_CHILD_ID } from '../../../src/engine/child-context.js';
import {
  MAX_REJECTED_PINS_PER_ROUND,
  redRefFor,
  rejectedPinRefFor,
  repairMarkerRefFor,
  revalidationQueueRefFor,
  routeRecordRefFor,
  routingTeardownRefNames,
} from '../../../src/engine/routing/routing-refs.js';
import { MAX_ROUTE_ROUNDS, parseRoundId } from '../../../src/engine/routing/route-types.js';

describe('routing ref names', () => {
  it('builds bounded route, pin, marker, queue and red refs', () => {
    const round = parseRoundId('r1');
    if (!round) throw new Error('r1 should be valid');

    expect(routeRecordRefFor('demo', round)).toBe('refs/conductor/demo/routes/r1');
    expect(rejectedPinRefFor('demo', round, 1)).toBe('refs/conductor/demo/rejected/r1/1');
    expect(repairMarkerRefFor('demo')).toBe('refs/conductor/demo/repairing');
    expect(revalidationQueueRefFor('demo')).toBe('refs/conductor/demo/revalidate');
    expect(redRefFor('demo', MAX_CHILD_ID)).toBe(`refs/conductor/demo/red/c${MAX_CHILD_ID}`);
  });

  it('enumerates only finite, explicit routing teardown names', () => {
    const refs = routingTeardownRefNames('demo');

    expect(MAX_REJECTED_PINS_PER_ROUND).toBe(MAX_CHILD_ID - 1);
    expect(refs).toContain('refs/conductor/demo/repairing');
    expect(refs).toContain('refs/conductor/demo/revalidate');
    expect(refs).toContain('refs/conductor/demo/red/c9');
    expect(refs).toContain('refs/conductor/demo/rejected/r1/1');
    expect(refs).toContain(`refs/conductor/demo/rejected/r${MAX_ROUTE_ROUNDS}/${MAX_REJECTED_PINS_PER_ROUND}`);
    expect(refs).not.toContain('refs/conductor/demo/rejected/r1/9');
    expect(refs.every((ref) => ref.startsWith('refs/conductor/demo/'))).toBe(true);
  });
});
