// Covers: task:14
import { describe, expect, it } from 'vitest';

import { resolveExecutionChild } from '../../../src/engine/routing/execution-child.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const roundId = parseRoundId('r1')!;

describe('resolveExecutionChild', () => {
  it('prefers a routed host, then a revalidation entry, without changing the cursor range', () => {
    const routed = resolveExecutionChild({
      kind: 'repair-pending', child: 3, position: 3, isLeaf: true, branch: 'feat/demo', repairChildren: [1],
      routedRepair: { child: 1, roundId }, revalidating: { child: 2, generation: 2 },
    }, 'demo');
    expect(routed).toMatchObject({ source: 'routed-host', roundId, target: { child: 1, position: 1, isLeaf: false, branch: 'feat/c1/demo' } });

    const revalidating = resolveExecutionChild({
      kind: 'active', child: 3, position: 3, isLeaf: true, branch: 'feat/demo', revalidating: { child: 2, generation: 2 },
    }, 'demo');
    expect(revalidating).toMatchObject({ source: 'revalidating', generation: 2, target: { child: 2, branch: 'feat/c2/demo' } });
  });

  it('retains the cursor child and preserves a flat feature as none', () => {
    expect(resolveExecutionChild({ kind: 'active', child: 2, position: 2, isLeaf: false, branch: 'feat/c2/demo' }, 'demo'))
      .toMatchObject({ source: 'cursor', target: { child: 2, branch: 'feat/c2/demo' } });
    expect(resolveExecutionChild({ kind: 'no-child' }, 'demo')).toEqual({ source: 'none' });
  });
});
