// Unit RED spec for Task 19: intake claim defers blocked entries
// (oldest-unblocked wins). FR-8 happy path.
//
// Full contract (including the Task 21 all-blocked outcome) is covered by
// Flow C in test/acceptance/dependency-ordered-intake-and-dispatch.test.ts.
// This file exercises just the Task 19 slice in isolation.

import { describe, it, expect } from 'vitest';

async function loadClaimModule() {
  return import('../../../../src/engine/engineer/intake/dependency-claim.js') as Promise<any>;
}

function makeEnvelope(sourceRef: string, receivedAt: string) {
  return {
    id: `id-${sourceRef}`,
    source: 'github-issues',
    sourceRef,
    text: `idea for ${sourceRef}`,
    status: 'pending' as const,
    receivedAt,
  };
}

/** In-memory IntakeQueue fake mirroring the acceptance-spec fake: FIFO claim(),
 * release() pushes back onto the pending list. */
function makeFakeQueue(envelopes: ReturnType<typeof makeEnvelope>[]) {
  const pending = [...envelopes];
  const claimed = new Map<string, any>();
  return {
    async enqueue(e: any) {
      pending.push(e);
    },
    async claim() {
      const e = pending.shift();
      if (!e) return null;
      claimed.set(e.id, e);
      return e;
    },
    async ack(e: any) {
      claimed.delete(e.id);
    },
    async release(e: any) {
      claimed.delete(e.id);
      pending.push(e);
    },
    async listPending() {
      return [...pending];
    },
  };
}

function makeResolveDependency(verdicts: Record<string, unknown>) {
  return async (sourceRef: string | undefined) => {
    if (!sourceRef) return { kind: 'unblocked' };
    return verdicts[sourceRef] ?? { kind: 'unblocked' };
  };
}

describe('Task 19: dependency-claim — oldest-unblocked wins', () => {
  it('[A(blocked), B(unblocked), C(blocked)] → claim returns B; A and C remain pending', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const C = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z');
    const queue = makeFakeQueue([A, B, C]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'unblocked' },
      'acme/app#3': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });

    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#2');

    const stillPending = (await queue.listPending()).map((e: any) => e.sourceRef);
    expect(stillPending).toContain('acme/app#1');
    expect(stillPending).toContain('acme/app#3');
    expect(stillPending).not.toContain('acme/app#2');
  });

  it('all entries blocked → claimUnblocked defers every entry without claiming (no crash, no throw)', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const queue = makeFakeQueue([A]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });

    expect(outcome.kind).not.toBe('claim');
    const stillPending = (await queue.listPending()).map((e: any) => e.sourceRef);
    expect(stillPending).toContain('acme/app#1');
  });
});

describe('Task 2: resolveClaimBands — labels to band map', () => {
  function makeFakeReader(byRef: Record<string, string[] | 'not-found'>) {
    return async (refs: string[]) => {
      const result = new Map<string, string[] | 'not-found'>();
      for (const ref of refs) {
        if (Object.prototype.hasOwnProperty.call(byRef, ref)) {
          result.set(ref, byRef[ref]);
        }
      }
      return result;
    };
  }

  it('returns critical for a priority: critical ref', async () => {
    const { resolveClaimBands } = await loadClaimModule();
    const reader = makeFakeReader({ 'acme/app#1': ['priority: critical'] });

    const bands = await resolveClaimBands(reader, ['acme/app#1']);

    expect(bands.get('acme/app#1')).toBe('critical');
  });

  it('returns unlabeled for a not-found ref and for a ref absent from the reader result', async () => {
    const { resolveClaimBands } = await loadClaimModule();
    const reader = makeFakeReader({ 'acme/app#1': 'not-found' });

    const bands = await resolveClaimBands(reader, ['acme/app#1', 'acme/app#2']);

    expect(bands.get('acme/app#1')).toBe('unlabeled');
    expect(bands.get('acme/app#2')).toBe('unlabeled');
  });

  it('returns highest band for a multi-label ref', async () => {
    const { resolveClaimBands } = await loadClaimModule();
    const reader = makeFakeReader({
      'acme/app#1': ['priority: low', 'priority: high', 'priority: medium'],
    });

    const bands = await resolveClaimBands(reader, ['acme/app#1']);

    expect(bands.get('acme/app#1')).toBe('high');
  });

  it('a throwing reader propagates the throw', async () => {
    const { resolveClaimBands } = await loadClaimModule();
    const reader = async () => {
      throw new Error('reader boom');
    };

    await expect(resolveClaimBands(reader, ['acme/app#1'])).rejects.toThrow('reader boom');
  });

  it('calls the reader exactly once with unique refs', async () => {
    const { resolveClaimBands } = await loadClaimModule();
    let calls = 0;
    let receivedRefs: string[] = [];
    const reader = async (refs: string[]) => {
      calls += 1;
      receivedRefs = refs;
      return new Map<string, string[] | 'not-found'>();
    };

    await resolveClaimBands(reader, ['acme/app#1', 'acme/app#2', 'acme/app#1']);

    expect(calls).toBe(1);
    expect(receivedRefs).toEqual(['acme/app#1', 'acme/app#2']);
  });
});

describe('Task 3: dependency-claim — banded walk drains all, sorts band-first', () => {
  it('critical(newest) beats low(oldest) when resolveBands is injected', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'); // low, oldest
    const B = makeEnvelope('acme/app#2', '2026-07-05T00:00:00.000Z'); // critical, newest
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({});
    const bands = new Map([
      ['acme/app#1', 'low'],
      ['acme/app#2', 'critical'],
    ]);
    const resolveBands = async (_refs: string[]) => bands;

    const outcome = await claimUnblocked({ queue, resolveDependency, resolveBands });

    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#2');

    const stillPending = (await queue.listPending()).map((e: any) => e.sourceRef);
    expect(stillPending).toEqual(['acme/app#1']);
  });

  it('band drain across claims: unlabeled, high, medium → high then medium then unlabeled', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'); // unlabeled
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z'); // high
    const C = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z'); // medium
    const queue = makeFakeQueue([A, B, C]);
    const resolveDependency = makeResolveDependency({});
    const bands = new Map([
      ['acme/app#1', 'unlabeled'],
      ['acme/app#2', 'high'],
      ['acme/app#3', 'medium'],
    ]);
    const resolveBands = async (_refs: string[]) => bands;

    const first = await claimUnblocked({ queue, resolveDependency, resolveBands });
    expect(first.kind).toBe('claim');
    expect((first as any).envelope.sourceRef).toBe('acme/app#2');

    const second = await claimUnblocked({ queue, resolveDependency, resolveBands });
    expect(second.kind).toBe('claim');
    expect((second as any).envelope.sourceRef).toBe('acme/app#3');
  });

  it('no resolveBands injected → stays FIFO (oldest-unblocked wins, unchanged)', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'); // low, oldest
    const B = makeEnvelope('acme/app#2', '2026-07-05T00:00:00.000Z'); // critical, newest
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({});

    const outcome = await claimUnblocked({ queue, resolveDependency });

    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#1');
  });

  it('resolveBands throws → logs exactly one warning and keeps drain order', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'); // low, oldest
    const B = makeEnvelope('acme/app#2', '2026-07-05T00:00:00.000Z'); // critical, newest
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({});
    const resolveBands = async (_refs: string[]) => {
      throw new Error('bands boom');
    };
    const warnings: unknown[][] = [];
    const log = (...args: unknown[]) => warnings.push(args);

    const outcome = await claimUnblocked({ queue, resolveDependency, resolveBands, log });

    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#1');
    expect(warnings.length).toBe(1);
  });
});

describe('Task 20: dependency-claim — deferral is free; indeterminate defers; walk continues', () => {
  it('deferred entry keeps status pending and attempts unchanged after deferral', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = { ...makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'), attempts: 0 };
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'unblocked' },
    });
    let ledgerCalls = 0;
    const ledger = {
      async transition() {
        ledgerCalls += 1;
      },
    };

    const outcome = await claimUnblocked({ queue, resolveDependency, ledger });

    expect(outcome.kind).toBe('claim');
    const stillPending = await queue.listPending();
    const deferred = stillPending.find((e: any) => e.sourceRef === 'acme/app#1');
    expect(deferred.status).toBe('pending');
    expect(deferred.attempts).toBe(0);
    expect(ledgerCalls).toBe(0);
  });

  it('indeterminate verdict defers, same as blocked', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'indeterminate', detail: 'unparseable sourceRef' },
      'acme/app#2': { kind: 'unblocked' },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });

    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#2');
    const stillPending = (await queue.listPending()).map((e: any) => e.sourceRef);
    expect(stillPending).toContain('acme/app#1');
  });

  it('[blocked, blocked, unblocked] → third entry returned; earlier two remain unchanged', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = { ...makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'), attempts: 0 };
    const B = { ...makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z'), attempts: 0 };
    const C = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z');
    const queue = makeFakeQueue([A, B, C]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'indeterminate', detail: 'unparseable' },
      'acme/app#3': { kind: 'unblocked' },
    });

    const outcome = await claimUnblocked({ queue, resolveDependency });

    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#3');
    const stillPending = await queue.listPending();
    const a = stillPending.find((e: any) => e.sourceRef === 'acme/app#1');
    const b = stillPending.find((e: any) => e.sourceRef === 'acme/app#2');
    expect(a.status).toBe('pending');
    expect(a.attempts).toBe(0);
    expect(b.status).toBe('pending');
    expect(b.attempts).toBe(0);
  });
});
