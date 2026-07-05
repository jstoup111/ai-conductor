// Unit tests for delivery-guard module — verifyPrState probe (Task 1, TR-1)
//
// verifyPrState(gh, url) probes a GitHub PR via gh runner and returns a
// discriminated PR state:
//   'open'              — state is OPEN
//   'merged'            — state is MERGED (regardless of mergedAt)
//   'closed-unmerged'   — state is CLOSED and mergedAt is null
//   'unknown'           — gh throws, stdout unparseable, or state unrecognized

import { describe, it, expect } from 'vitest';

async function loadDeliveryGuard() {
  return import('../../../../src/engine/engineer/intake/delivery-guard.js') as Promise<any>;
}

/** Recorded invocation from the fake runner. */
interface RecordedCall {
  args: string[];
  cwd: string;
}

/** Build a fake gh runner that records calls and returns pre-set stdout. */
function makeFakeGh(stdout: string): {
  runner: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const runner = async (args: string[], opts: { cwd: string }) => {
    calls.push({ args: [...args], cwd: opts.cwd });
    return { stdout };
  };
  return { runner, calls };
}

/** Build a fake gh runner that throws. */
function makeFailingGh(): {
  runner: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;
} {
  return {
    runner: async () => {
      throw new Error('gh command failed');
    },
  };
}

describe('verifyPrState — PR state probe', () => {
  it('OPEN state → returns "open"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/1');

    expect(result).toBe('open');
  });

  it('MERGED state with mergedAt → returns "merged"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFakeGh(
      JSON.stringify({ state: 'MERGED', mergedAt: '2026-07-05T10:00:00Z' }),
    );

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/2');

    expect(result).toBe('merged');
  });

  it('CLOSED state with mergedAt null → returns "closed-unmerged"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFakeGh(
      JSON.stringify({ state: 'CLOSED', mergedAt: null }),
    );

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/3');

    expect(result).toBe('closed-unmerged');
  });

  it('gh runner throws → returns "unknown"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFailingGh();

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/4');

    expect(result).toBe('unknown');
  });

  it('unparseable stdout (invalid JSON) → returns "unknown"', async () => {
    const { verifyPrState } = await loadDeliveryGuard();
    const { runner } = makeFakeGh('not valid json');

    const result = await verifyPrState(runner, 'https://github.com/owner/repo/pull/5');

    expect(result).toBe('unknown');
  });
});

// ─── Task 2: createDeliveryGuardedQueue decorator ─────────────────────────────

/** Minimal fake ledger for testing passthrough logic. */
interface FakeLedger {
  get(source: string, sourceRef: string): Promise<any>;
  record(input: { source: string; sourceRef: string }): Promise<void>;
  transition(...args: any[]): Promise<void>;
}

function makeFakeLedger(): { ledger: FakeLedger; recordCalls: any[]; transitionCalls: any[] } {
  const recordCalls: any[] = [];
  const transitionCalls: any[] = [];
  const store: Record<string, any> = {};

  const ledger: FakeLedger = {
    async get(source: string, sourceRef: string) {
      return store[`${source}:${sourceRef}`];
    },
    async record(input: { source: string; sourceRef: string }) {
      recordCalls.push(input);
      store[`${input.source}:${input.sourceRef}`] = {
        source: input.source,
        sourceRef: input.sourceRef,
        status: 'pending',
      };
    },
    async transition(...args: any[]) {
      transitionCalls.push(args);
    },
  };

  return { ledger, recordCalls, transitionCalls };
}

/** Minimal fake queue for testing. */
interface FakeQueue {
  claim(): Promise<any>;
  release(e: any): Promise<void>;
}

function makeFakeQueueWithEnvelopes(envelopes: any[]): {
  queue: FakeQueue;
  releasedEnvelopes: any[];
} {
  const pending = [...envelopes];
  const releasedEnvelopes: any[] = [];

  const queue: FakeQueue = {
    async claim() {
      const e = pending.shift();
      return e || null;
    },
    async release(e: any) {
      releasedEnvelopes.push(e);
    },
  };

  return { queue, releasedEnvelopes };
}

function makeEnvelope(sourceRef: string, source = 'test-source') {
  return {
    id: `id-${sourceRef}`,
    source,
    sourceRef,
    text: `idea for ${sourceRef}`,
    status: 'pending' as const,
    receivedAt: '2026-07-05T00:00:00.000Z',
  };
}

describe('Task 2: createDeliveryGuardedQueue — guard passthrough for healthy candidates', () => {
  it('candidate with no ledger entry (non-recording source) → served as-is unchanged', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('idea-1');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger } = makeFakeLedger();
    const { runner: gh } = makeFakeGh('');

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
  });

  it('candidate at pending status with duplicate envelope → served without ledger mutation', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger, recordCalls, transitionCalls } = makeFakeLedger();

    // Pre-populate ledger with a matching pending entry
    const key = `${candidate.source}:${candidate.sourceRef}`;
    (ledger as any).store = { [key]: { source: candidate.source, sourceRef: candidate.sourceRef, status: 'pending' } };

    const { runner: gh } = makeFakeGh('');
    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    expect(recordCalls).toHaveLength(0); // no ledger record calls
    expect(transitionCalls).toHaveLength(0); // no ledger transition calls
  });

  it('multiple candidates, first healthy → next served if first released', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger } = makeFakeLedger();
    const { runner: gh } = makeFakeGh('');

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    // First claim
    const first = await guarded.claim();
    expect(first).toEqual(candidate1);

    // Release the first candidate (puts it back to the queue end)
    await guarded.release(candidate1);
    expect(releasedEnvelopes).toContain(candidate1);

    // Second claim should get the second candidate
    const second = await guarded.claim();
    expect(second).toEqual(candidate2);
  });
});

// ─── Task 3: auto-heal delivered entries (open/merged) ──────────────────────

describe('Task 3: createDeliveryGuardedQueue — auto-heal delivered entries', () => {
  it('entry claimed + prUrl, PR OPEN → heals to done, prUrl/branch preserved, next candidate served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    // Pre-populate ledger with a claimed entry that has prUrl
    const key1 = `${candidate1.source}:${candidate1.sourceRef}`;
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          prUrl: 'https://github.com/owner/repo/pull/123',
          branch: 'feat/test-branch',
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    // First claim should skip the claimed entry and serve the next one
    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify transition was called with 'done' status and metadata preserved
    expect(transitionCalls.length).toBeGreaterThan(0);
    const transitionCall = transitionCalls[0];
    expect(transitionCall[0]).toBe(candidate1.source);
    expect(transitionCall[1]).toBe(candidate1.sourceRef);
    expect(transitionCall[2]).toBe('done');
    expect(transitionCall[3]?.prUrl).toBe('https://github.com/owner/repo/pull/123');
    expect(transitionCall[3]?.branch).toBe('feat/test-branch');
  });

  it('entry claimed + prUrl, PR MERGED → heals to done, prUrl/branch preserved, next candidate served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(
      JSON.stringify({ state: 'MERGED', mergedAt: '2026-07-05T10:00:00Z' }),
    );

    // Pre-populate ledger with a claimed entry that has prUrl
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          prUrl: 'https://github.com/owner/repo/pull/456',
          branch: 'feat/merged-branch',
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    expect(transitionCalls.length).toBeGreaterThan(0);
    const transitionCall = transitionCalls[0];
    expect(transitionCall[2]).toBe('done');
    expect(transitionCall[3]?.prUrl).toBe('https://github.com/owner/repo/pull/456');
    expect(transitionCall[3]?.branch).toBe('feat/merged-branch');
  });

  it('entry routed/deciding + prUrl, PR OPEN → heals to done, continues walk', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    // Test with 'routed' status
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'routed',
          prUrl: 'https://github.com/owner/repo/pull/789',
          branch: 'feat/routed-branch',
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });
    const first = await guarded.claim();

    expect(first).toEqual(candidate2);
    expect(transitionCalls.length).toBeGreaterThan(0);
    expect(transitionCalls[0][2]).toBe('done');
  });

  it('three candidates: first claimed+prUrl+OPEN → healed to done, second served, third available', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const candidate3 = makeEnvelope('idea-3');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2, candidate3]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          prUrl: 'https://github.com/owner/repo/pull/111',
          branch: 'feat/first-branch',
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    // First claim
    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify first entry was healed
    expect(transitionCalls.length).toBeGreaterThan(0);
    expect(transitionCalls[0][2]).toBe('done');

    // Second claim should get third candidate
    const second = await guarded.claim();
    expect(second).toEqual(candidate3);

    // Third claim should return null (queue exhausted)
    const third = await guarded.claim();
    expect(third).toBeNull();
  });
});
