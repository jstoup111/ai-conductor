// Covers: task:1, task:9
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/engine/routing/revalidation-queue.js', () => ({
  consumeLowestQueued: vi.fn(),
}));
vi.mock('../../../src/engine/routing/round-admission.js', () => ({
  reconcileRounds: vi.fn(),
}));
vi.mock('../../../src/engine/routing/route-record-store.js', () => ({
  drainRoutingOutboxes: vi.fn(),
}));

import { admitQueuedRevalidation } from '../../../src/engine/routing/queue-admission.js';
import { consumeLowestQueued } from '../../../src/engine/routing/revalidation-queue.js';
import { reconcileRounds } from '../../../src/engine/routing/round-admission.js';
import { drainRoutingOutboxes } from '../../../src/engine/routing/route-record-store.js';
import { parseChildId } from '../../../src/engine/child-context.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const worktree = '/worktree';
const slug = 'demo';
const r1 = parseRoundId('r1')!;
const r2 = parseRoundId('r2')!;
const child1 = parseChildId(1)!;
const child2 = parseChildId(2)!;
const persist = vi.fn(async () => 'persisted' as const);

afterEach(() => {
  vi.clearAllMocks();
});

describe('admitQueuedRevalidation', () => {
  it.each([
    { kind: 'none' },
    { kind: 'aborted', roundId: 'r1' },
    { kind: 'deferred' },
    { kind: 'leaf-returned', roundId: r1 },
    { kind: 'quiescent' },
  ] as const)('consumes a queued child after a $kind reconciliation', async (reconciled) => {
    vi.mocked(consumeLowestQueued).mockResolvedValueOnce({ kind: 'admitted', roundId: r2, host: child2 } as never);

    await expect(admitQueuedRevalidation({ worktree, slug, reconciled })).resolves.toEqual({
      kind: 'admitted', roundId: r2, host: child2,
    });
    expect(consumeLowestQueued).toHaveBeenCalledWith(worktree, slug, {});
  });

  it.each([
    { kind: 'navigate-host', roundId: r1, host: child1 },
    { kind: 'navigate-leaf-to-build', roundId: r1, host: child2 },
    { kind: 'resume-exit', roundId: r1, host: child1 },
  ] as const)('passes through $kind without consuming the queue', async (reconciled) => {
    await expect(admitQueuedRevalidation({ worktree, slug, reconciled })).resolves.toEqual({
      kind: 'continue', reconciled,
    });
    expect(consumeLowestQueued).not.toHaveBeenCalled();
  });

  it('returns the re-reconciled stall after consumption stalls', async () => {
    const stalled = { kind: 'stalled', detail: 'round r1 stalled', rounds: [] } as const;
    vi.mocked(consumeLowestQueued).mockResolvedValueOnce({ kind: 'stalled', detail: 'queue CAS lost' } as never);
    vi.mocked(reconcileRounds).mockResolvedValueOnce(stalled as never);

    await expect(admitQueuedRevalidation({ worktree, slug, reconciled: { kind: 'none' } })).resolves.toBe(stalled);
    expect(reconcileRounds).toHaveBeenCalledWith(worktree, slug, {});
  });

  it('returns a mechanical stall with the consumption detail when re-reconciliation progresses', async () => {
    vi.mocked(consumeLowestQueued).mockResolvedValueOnce({ kind: 'stalled', detail: 'queue CAS lost' } as never);
    vi.mocked(reconcileRounds).mockResolvedValueOnce({ kind: 'none' } as never);

    await expect(admitQueuedRevalidation({ worktree, slug, reconciled: { kind: 'none' } })).resolves.toEqual({
      kind: 'stalled', detail: 'queue CAS lost', haltClass: 'mechanical',
    });
  });

  it('drains before reconciling when no reconciliation was supplied', async () => {
    vi.mocked(drainRoutingOutboxes).mockImplementationOnce(async () => {
      expect(reconcileRounds).not.toHaveBeenCalled();
      return { kind: 'drained' };
    });
    vi.mocked(reconcileRounds).mockResolvedValueOnce({ kind: 'none' } as never);
    vi.mocked(consumeLowestQueued).mockResolvedValueOnce({ kind: 'none' } as never);

    await expect(admitQueuedRevalidation({ worktree, slug, persist })).resolves.toEqual({ kind: 'none' });
    expect(drainRoutingOutboxes).toHaveBeenCalledWith(worktree, slug, persist, {});
    expect(reconcileRounds).toHaveBeenCalledWith(worktree, slug, {});
  });

  it('returns unavailable without reconciling or consuming when the drain fails', async () => {
    vi.mocked(drainRoutingOutboxes).mockResolvedValueOnce({ kind: 'persist-failed' } as never);

    await expect(admitQueuedRevalidation({ worktree, slug, persist })).resolves.toEqual({
      kind: 'unavailable', detail: 'cannot drain routing outbox: persist-failed',
    });
    expect(reconcileRounds).not.toHaveBeenCalled();
    expect(consumeLowestQueued).not.toHaveBeenCalled();
  });
});
