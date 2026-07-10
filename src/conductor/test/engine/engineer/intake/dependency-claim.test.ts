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

describe('Task 6: dependency-claim — reader throw fails open to FIFO, one warning', () => {
  it('resolveBands (backed by resolveClaimBands + a reader that throws mid-map) → claim still returns oldest unblocked, log called exactly once, never a partial band sort', async () => {
    const { claimUnblocked, resolveClaimBands } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'); // oldest
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z'); // would be critical
    const C = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z'); // would be low
    const queue = makeFakeQueue([A, B, C]);
    const resolveDependency = makeResolveDependency({});

    // Reader is a single whole-batch call; it throws while "mid-map" over the
    // refs it was given (on the 2nd ref) rather than ever returning a partial
    // Map. This proves the walk sees either the whole map or a throw — never
    // a half-populated band map driving a partial sort.
    const reader = async (refs: string[]) => {
      const result = new Map<string, string[] | 'not-found'>();
      for (let i = 0; i < refs.length; i++) {
        if (i === 1) {
          throw new Error('reader boom mid-map');
        }
        result.set(refs[i], ['priority: critical']);
      }
      return result;
    };
    const resolveBands = (refs: string[]) => resolveClaimBands(reader, refs);

    const warnings: unknown[][] = [];
    const log = (...args: unknown[]) => warnings.push(args);

    const outcome = await claimUnblocked({ queue, resolveDependency, resolveBands, log });

    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBe('acme/app#1');
    expect(warnings.length).toBe(1);

    const stillPending = (await queue.listPending()).map((e: any) => e.sourceRef);
    expect(stillPending).toEqual(['acme/app#2', 'acme/app#3']);
  });

  it('a second later claim with the same throwing resolveBands logs again (one warning per claim cycle, not a global suppression)', async () => {
    const { claimUnblocked, resolveClaimBands } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([A, B]);
    const resolveDependency = makeResolveDependency({});
    const reader = async (_refs: string[]) => {
      throw new Error('reader boom');
    };
    const resolveBands = (refs: string[]) => resolveClaimBands(reader, refs);
    const warnings: unknown[][] = [];
    const log = (...args: unknown[]) => warnings.push(args);

    const first = await claimUnblocked({ queue, resolveDependency, resolveBands, log });
    expect(first.kind).toBe('claim');
    expect(warnings.length).toBe(1);

    await queue.enqueue(first.envelope as any);
    const second = await claimUnblocked({ queue, resolveDependency, resolveBands, log });
    expect(second.kind).toBe('claim');
    expect(warnings.length).toBe(2);
  });
});

describe('Task 4: dependency-claim — no-sourceRef parity (no-issue band ranks first)', () => {
  it('X (no sourceRef) beats Y (critical); reader receives only Y\'s ref', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const X = { ...makeEnvelope('unused', '2026-07-01T00:00:00.000Z'), sourceRef: undefined };
    const Y = makeEnvelope('acme/app#2', '2026-07-05T00:00:00.000Z');
    const queue = makeFakeQueue([X, Y]);
    const resolveDependency = makeResolveDependency({});
    let receivedRefs: string[] = [];
    const resolveBands = async (refs: string[]) => {
      receivedRefs = refs;
      return new Map([['acme/app#2', 'critical']]);
    };

    const outcome = await claimUnblocked({ queue, resolveDependency, resolveBands });

    expect(outcome.kind).toBe('claim');
    expect(outcome.envelope.sourceRef).toBeUndefined();

    expect(receivedRefs).toEqual(['acme/app#2']);
    expect(receivedRefs).not.toContain(undefined);
    expect(receivedRefs).not.toContain('');

    const stillPending = (await queue.listPending()).map((e: any) => e.sourceRef);
    expect(stillPending).toEqual(['acme/app#2']);
  });
});

describe('Task 5: dependency-claim — within-band receivedAt FIFO stability', () => {
  it('three same-band (high) entries with distinct receivedAt → three sequential claims serve strictly oldest-first', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'); // high, oldest
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z'); // high, middle
    const C = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z'); // high, newest
    const queue = makeFakeQueue([A, B, C]);
    const resolveDependency = makeResolveDependency({});
    const bands = new Map([
      ['acme/app#1', 'high'],
      ['acme/app#2', 'high'],
      ['acme/app#3', 'high'],
    ]);
    const resolveBands = async (_refs: string[]) => bands;

    const first = await claimUnblocked({ queue, resolveDependency, resolveBands });
    const second = await claimUnblocked({ queue, resolveDependency, resolveBands });
    const third = await claimUnblocked({ queue, resolveDependency, resolveBands });

    expect((first as any).envelope.sourceRef).toBe('acme/app#1');
    expect((second as any).envelope.sourceRef).toBe('acme/app#2');
    expect((third as any).envelope.sourceRef).toBe('acme/app#3');
  });

  it('mixed banded/unlabeled set → unlabeled entries keep their relative drain order (stable sort)', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z'); // unlabeled, drain order 1
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z'); // high
    const C = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z'); // unlabeled, drain order 2
    const D = makeEnvelope('acme/app#4', '2026-07-04T00:00:00.000Z'); // unlabeled, drain order 3
    const queue = makeFakeQueue([A, B, C, D]);
    const resolveDependency = makeResolveDependency({});
    const bands = new Map([
      ['acme/app#1', 'unlabeled'],
      ['acme/app#2', 'high'],
      ['acme/app#3', 'unlabeled'],
      ['acme/app#4', 'unlabeled'],
    ]);
    const resolveBands = async (_refs: string[]) => bands;

    const first = await claimUnblocked({ queue, resolveDependency, resolveBands });
    const second = await claimUnblocked({ queue, resolveDependency, resolveBands });
    const third = await claimUnblocked({ queue, resolveDependency, resolveBands });
    const fourth = await claimUnblocked({ queue, resolveDependency, resolveBands });

    // high band drains first; the three unlabeled entries then drain in
    // their original relative (drain) order — A, C, D — never reordered
    // amongst themselves by the stable sort.
    expect((first as any).envelope.sourceRef).toBe('acme/app#2');
    expect((second as any).envelope.sourceRef).toBe('acme/app#1');
    expect((third as any).envelope.sourceRef).toBe('acme/app#3');
    expect((fourth as any).envelope.sourceRef).toBe('acme/app#4');
  });

  it('two identical-receivedAt same-band entries → identical order across two runs (deterministic tie-break = drain order)', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const sameTimestamp = '2026-07-01T00:00:00.000Z';
    const resolveDependency = makeResolveDependency({});
    const bands = new Map([
      ['acme/app#1', 'high'],
      ['acme/app#2', 'high'],
    ]);
    const resolveBands = async (_refs: string[]) => bands;

    async function runOnce() {
      const A = makeEnvelope('acme/app#1', sameTimestamp);
      const B = makeEnvelope('acme/app#2', sameTimestamp);
      const queue = makeFakeQueue([A, B]);
      const first = await claimUnblocked({ queue, resolveDependency, resolveBands });
      const second = await claimUnblocked({ queue, resolveDependency, resolveBands });
      return [(first as any).envelope.sourceRef, (second as any).envelope.sourceRef];
    }

    const run1 = await runOnce();
    const run2 = await runOnce();

    expect(run1).toEqual(['acme/app#1', 'acme/app#2']);
    expect(run2).toEqual(['acme/app#1', 'acme/app#2']);
    expect(run1).toEqual(run2);
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

describe('Task 7: composability — blocked critical defers to next banded candidate', () => {
  it('critical(blocked), high(unblocked) → high claimed, critical released, no ledger write for deferred', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const critical = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const high = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const queue = makeFakeQueue([critical, high]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'unblocked' },
    });
    const resolveBands = async (_refs: string[]) =>
      new Map([
        ['acme/app#1', 'critical'],
        ['acme/app#2', 'high'],
      ]);
    const transitions: Array<{ source: string; sourceRef: string; status: string }> = [];
    const ledger = {
      async transition(source: string, sourceRef: string, status: string) {
        transitions.push({ source, sourceRef, status });
      },
    };

    const outcome = await claimUnblocked({ queue, resolveDependency, resolveBands, ledger });

    expect(outcome.kind).toBe('claim');
    expect((outcome as any).envelope.sourceRef).toBe('acme/app#2');

    const stillPending = (await queue.listPending()).map((e: any) => e.sourceRef);
    expect(stillPending).toEqual(['acme/app#1']);

    expect(transitions.length).toBe(0);
  });

  it('all pending blocked (banded) → all-blocked outcome with entries in banded order', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const low = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const critical = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const medium = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z');
    const queue = makeFakeQueue([low, critical, medium]);
    const resolveDependency = makeResolveDependency({
      'acme/app#1': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#2': { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] },
      'acme/app#3': { kind: 'indeterminate', detail: 'unparseable' },
    });
    const resolveBands = async (_refs: string[]) =>
      new Map([
        ['acme/app#1', 'low'],
        ['acme/app#2', 'critical'],
        ['acme/app#3', 'medium'],
      ]);
    const transitions: unknown[] = [];
    const ledger = {
      async transition(...args: unknown[]) {
        transitions.push(args);
      },
    };

    const outcome = await claimUnblocked({ queue, resolveDependency, resolveBands, ledger });

    expect(outcome.kind).toBe('all-blocked');
    const refs = (outcome as any).entries.map((e: any) => e.envelope.sourceRef);
    expect(refs).toEqual(['acme/app#2', 'acme/app#3', 'acme/app#1']);

    const stillPending = (await queue.listPending()).map((e: any) => e.sourceRef);
    expect(stillPending).toEqual(['acme/app#2', 'acme/app#3', 'acme/app#1']);

    expect(transitions.length).toBe(0);
  });
});

describe('Task 8: no-loss invariant — crash mid-walk releases every drained envelope', () => {
  /** Fake queue that tracks claims vs releases explicitly — used to assert
   * every drained-but-not-selected envelope is released even when the
   * verdict loop throws. */
  function makeAccountingQueue(envelopes: ReturnType<typeof makeEnvelope>[]) {
    const pending = [...envelopes];
    let claims = 0;
    const released: any[] = [];
    let claimed: any[] = [];
    return {
      queue: {
        async claim() {
          const e = pending.shift();
          if (!e) return null;
          claims += 1;
          claimed.push(e);
          return e;
        },
        async release(e: any) {
          released.push(e);
          claimed = claimed.filter((c) => c !== e);
        },
      },
      stats: {
        get claims() {
          return claims;
        },
        get released() {
          return released;
        },
        get stillClaimed() {
          return claimed;
        },
      },
    };
  }

  it('resolver throws on the 2nd candidate → throw propagates AND every drained, non-selected envelope was released', async () => {
    const { claimUnblocked } = await loadClaimModule();
    const A = makeEnvelope('acme/app#1', '2026-07-01T00:00:00.000Z');
    const B = makeEnvelope('acme/app#2', '2026-07-02T00:00:00.000Z');
    const C = makeEnvelope('acme/app#3', '2026-07-03T00:00:00.000Z');
    const { queue, stats } = makeAccountingQueue([A, B, C]);

    const resolveBands = async (refs: string[]) => new Map(refs.map((r) => [r, 'high' as const]));
    let calls = 0;
    const resolveDependency = async (_sourceRef: string | undefined) => {
      calls += 1;
      if (calls === 1) {
        return { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '9' }] } as const;
      }
      throw new Error('resolver boom on 2nd candidate');
    };

    await expect(claimUnblocked({ queue, resolveDependency, resolveBands })).rejects.toThrow(
      'resolver boom on 2nd candidate',
    );

    // All 3 entries were drained via claim() up front (drain-first shape).
    expect(stats.claims).toBe(3);
    // Nothing was ever selected (the throw happened during verdict
    // evaluation), so all 3 drained entries — including C, which was never
    // even evaluated — must be released. Losing C here would be exactly the
    // "drained but never released" bug this test guards against.
    expect(stats.released.length).toBe(3);
    expect(stats.released).toContain(A);
    expect(stats.released).toContain(B);
    expect(stats.released).toContain(C);
    expect(stats.stillClaimed.length).toBe(0);
  });

  it('a queue whose claim() returns null after the first drain (someone else drained) → empty outcome unchanged', async () => {
    const { claimUnblocked } = await loadClaimModule();
    let claimCalls = 0;
    const released: any[] = [];
    const queue = {
      async claim() {
        claimCalls += 1;
        // Simulate a concurrent claimant: from this walk's perspective the
        // queue is already empty on the very first call.
        return null;
      },
      async release(e: any) {
        released.push(e);
      },
    };
    const resolveDependency = async () => ({ kind: 'unblocked' }) as const;

    const outcome = await claimUnblocked({ queue, resolveDependency });

    expect(outcome.kind).toBe('empty');
    expect(claimCalls).toBe(1);
    expect(released.length).toBe(0);
  });
});
