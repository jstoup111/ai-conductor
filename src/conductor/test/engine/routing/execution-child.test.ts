// Covers: task:14, task:rem-prd-audit-refusal-9e34528a-5d56-4ec3-adbc-e8c2a0a6002f
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { resolveExecutionChild } from '../../../src/engine/routing/execution-child.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const roundId = parseRoundId('r1')!;
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const c3 = parseChildId(3)!;

describe('resolveExecutionChild', () => {
  it('prefers a routed host, then a revalidation entry, without changing the cursor range', () => {
    const routed = resolveExecutionChild({
      kind: 'repair-pending', child: c3, position: c3, isLeaf: true, branch: 'feat/demo', repairChildren: [c1],
      routedRepair: { child: c1, roundId }, revalidating: { child: c2, generation: 2 },
    }, 'demo');
    expect(routed).toMatchObject({ source: 'routed-host', roundId, target: { child: 1, position: 1, isLeaf: false, branch: 'feat/c1/demo' } });

    const revalidating = resolveExecutionChild({
      kind: 'repair-pending', child: c3, position: c3, isLeaf: true, branch: 'feat/demo', repairChildren: [c1],
      revalidating: { child: c2, generation: 2 },
    }, 'demo');
    expect(revalidating).toMatchObject({ source: 'revalidating', generation: 2, target: { child: 2, branch: 'feat/c2/demo' } });
  });

  it('retains the cursor child and preserves a flat feature as none', () => {
    expect(resolveExecutionChild({ kind: 'active', child: c2, position: c2, isLeaf: false, branch: 'feat/c2/demo' }, 'demo'))
      .toMatchObject({ source: 'cursor', target: { child: 2, branch: 'feat/c2/demo' } });
    expect(resolveExecutionChild({ kind: 'no-child' }, 'demo')).toEqual({ source: 'none' });
  });

  it('retains the cursor child while a repair is pending without an execution overlay', () => {
    const cursor = {
      kind: 'repair-pending' as const, child: c3, position: c3, isLeaf: true, branch: 'feat/demo', repairChildren: [c1],
    };

    expect(resolveExecutionChild(cursor, 'demo')).toMatchObject({
      source: 'cursor', target: { child: 3, position: 3, isLeaf: true, branch: 'feat/daemon-demo' },
    });
  });
});
