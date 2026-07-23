// Unit tests for delivery-guard module — verifyPrState probe (Task 1, TR-1)
//
// verifyPrState(gh, url) probes a GitHub PR via gh runner and returns a
// discriminated PR state:
//   'open'              — state is OPEN
//   'merged'            — state is MERGED (regardless of mergedAt)
//   'closed-unmerged'   — state is CLOSED and mergedAt is null
//   'unknown'           — gh throws, stdout unparseable, or state unrecognized

import { describe, it, expect } from 'vitest';
import type { GuardLedger } from '../../../../src/engine/engineer/intake/delivery-guard.js';

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
  ack(e: any): Promise<void>;
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
    async ack(e: any) {
      releasedEnvelopes.push(e);
    },
    async release(e: any) {
      releasedEnvelopes.push(e);
    },
  };

  return { queue, releasedEnvelopes };
}

/**
 * Fake queue that ALSO supports `list()`/`enqueue()` — the two members
 * `reapStaleClaimed` (delivery-guard.ts) type-guards for before synthesizing a
 * minimal envelope for a stale-claimed ledger entry whose original envelope is
 * no longer present in the queue (already ack'd, long before the process that
 * held the claim died). `makeFakeQueueWithEnvelopes` above deliberately omits
 * these two methods so unrelated tests exercise the (typeof-guarded) "queue
 * doesn't support list/enqueue" short-circuit; this variant is for tests that
 * must drive the synthesis branch itself.
 */
function makeFakeQueueWithEnvelopesAndCatalog(envelopes: any[]): {
  queue: FakeQueue & { list(): Promise<any[]>; enqueue(e: any): Promise<void> };
  releasedEnvelopes: any[];
  enqueued: any[];
} {
  const pending = [...envelopes];
  const catalog = [...envelopes];
  const releasedEnvelopes: any[] = [];
  const enqueued: any[] = [];

  const queue = {
    async claim() {
      const e = pending.shift();
      return e || null;
    },
    async ack(e: any) {
      releasedEnvelopes.push(e);
    },
    async release(e: any) {
      releasedEnvelopes.push(e);
    },
    async list() {
      return [...catalog];
    },
    async enqueue(e: any) {
      enqueued.push(e);
      catalog.push(e);
      pending.push(e);
    },
  };

  return { queue, releasedEnvelopes, enqueued };
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

// ─── Task 4: heal-path failure tolerance (ENOENT ack race, ledger write failure) ────

describe('Task 4: createDeliveryGuardedQueue — heal-path failure tolerance', () => {
  it('heal path: queue.release() throws ENOENT → treat as success, next candidate served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    // Simulate queue.release throwing ENOENT for first candidate (benign race)
    const originalRelease = queue.release.bind(queue);
    let releaseCallCount = 0;
    queue.release = async (e: any) => {
      releaseCallCount++;
      if (releaseCallCount === 1 && e.sourceRef === 'idea-1') {
        // First release (healing the stale entry) throws ENOENT
        const err = new Error('ENOENT: no such file or directory');
        (err as any).code = 'ENOENT';
        throw err;
      }
      await originalRelease(e);
    };

    // Pre-populate ledger with a claimed entry that has prUrl
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

    // First claim should skip candidate1 (heal it despite ENOENT) and serve candidate2
    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify transition was called for healing
    expect(transitionCalls.length).toBeGreaterThan(0);
    expect(transitionCalls[0][2]).toBe('done');
  });

  it('heal path: ledger.transition() throws DB error → candidate NOT served, envelope stays pending, error logged, next candidate served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    // Simulate ledger.transition throwing a DB error
    const originalTransition = ledger.transition.bind(ledger);
    ledger.transition = async (...args: any[]) => {
      if (args[1] === 'idea-1') {
        // First transition (healing candidate1) throws DB error
        throw new Error('Database connection lost');
      }
      await originalTransition(...args);
    };

    // Capture stderr
    const stderrLogs: string[] = [];
    const originalStderr = process.stderr.write;
    process.stderr.write = ((msg: string) => {
      stderrLogs.push(msg);
      return true;
    }) as any;

    // Pre-populate ledger with a claimed entry that has prUrl
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

    try {
      // First claim should skip candidate1 (ledger write failed) and serve candidate2
      const first = await guarded.claim();
      expect(first).toEqual(candidate2);

      // Verify error was logged to stderr
      expect(stderrLogs.length).toBeGreaterThan(0);
      const errorLog = stderrLogs.join('');
      expect(errorLog).toMatch(/Database connection lost|error|Error/i);
    } finally {
      // Restore stderr
      process.stderr.write = originalStderr;
    }
  });

  it('single candidate, ledger.transition() throws → claim() returns null, not the failed candidate', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1]);
    const { ledger } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    // Simulate ledger.transition throwing a DB error
    ledger.transition = async () => {
      throw new Error('Database write failed');
    };

    // Capture stderr
    const stderrLogs: string[] = [];
    const originalStderr = process.stderr.write;
    process.stderr.write = ((msg: string) => {
      stderrLogs.push(msg);
      return true;
    }) as any;

    // Pre-populate ledger with a claimed entry that has prUrl
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

    try {
      // Claim should return null (queue exhausted after skipping failed candidate)
      const first = await guarded.claim();
      expect(first).toBeNull();

      // Verify error was logged
      expect(stderrLogs.length).toBeGreaterThan(0);

      // Verify held candidate was released before returning null
      expect(releasedEnvelopes).toContain(candidate1);
    } finally {
      // Restore stderr
      process.stderr.write = originalStderr;
    }
  });

  it('three candidates: first heal throws, second healthy, third pending → first skipped, second served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const candidate3 = makeEnvelope('idea-3');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1, candidate2, candidate3]);
    const { ledger } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    // Simulate ledger.transition throwing a DB error for candidate1
    let transitionCount = 0;
    ledger.transition = async (...args: any[]) => {
      transitionCount++;
      if (args[1] === 'idea-1') {
        throw new Error('Database write failed');
      }
    };

    // Capture stderr
    const stderrLogs: string[] = [];
    const originalStderr = process.stderr.write;
    process.stderr.write = ((msg: string) => {
      stderrLogs.push(msg);
      return true;
    }) as any;

    // Pre-populate ledger with entries
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
      // candidate3 has pending status (passthrough)
      if (sourceRef === 'idea-3') {
        return {
          source: candidate3.source,
          sourceRef: candidate3.sourceRef,
          status: 'pending',
        };
      }
      // candidate2 has no entry (passthrough)
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    try {
      // First claim should skip candidate1 (ledger write failed) and serve candidate2
      const first = await guarded.claim();
      expect(first).toEqual(candidate2);

      // Second claim should get candidate3
      const second = await guarded.claim();
      expect(second).toEqual(candidate3);

      // Third claim should return null (queue exhausted)
      const third = await guarded.claim();
      expect(third).toBeNull();

      // Verify error was logged
      expect(stderrLogs.length).toBeGreaterThan(0);

      // Verify all held candidates were released
      expect(releasedEnvelopes).toContain(candidate1);
    } finally {
      // Restore stderr
      process.stderr.write = originalStderr;
    }
  });
});

// ─── Task 5: closed-unmerged reopen semantics (FR-39/40) ────────────────────────

describe('Task 5: createDeliveryGuardedQueue — closed-unmerged reopen semantics', () => {
  it('entry claimed+prUrl, attempts=0, PR CLOSED-unmerged → ledger.reopen() called, candidate served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(
      JSON.stringify({ state: 'CLOSED', mergedAt: null }),
    );

    let reopenCalls: string[] = [];
    const originalReopen = (ledger as any).reopen;
    (ledger as any).reopen = async (source: string, sourceRef: string) => {
      reopenCalls.push(`${source}:${sourceRef}`);
      if (originalReopen) await originalReopen(source, sourceRef);
    };

    // Pre-populate ledger with a claimed entry that has prUrl, attempts=0
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          prUrl: 'https://github.com/owner/repo/pull/123',
          branch: 'feat/test-branch',
          attempts: 0,
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    // First claim should skip candidate1 (closed-unmerged, reopen and serve next)
    // and serve candidate2
    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify reopen was called
    expect(reopenCalls.length).toBe(1);
    expect(reopenCalls[0]).toContain('idea-1');

    // Verify transition was NOT called (only reopen, not transition to needs-manual)
    expect(transitionCalls.length).toBe(0);
  });

  it('entry claimed+prUrl, attempts=1, PR CLOSED-unmerged → ledger.reopen() called, candidate served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(
      JSON.stringify({ state: 'CLOSED', mergedAt: null }),
    );

    let reopenCalls: string[] = [];
    (ledger as any).reopen = async (source: string, sourceRef: string) => {
      reopenCalls.push(`${source}:${sourceRef}`);
    };

    // Pre-populate ledger with a claimed entry, attempts=1
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          prUrl: 'https://github.com/owner/repo/pull/123',
          branch: 'feat/test-branch',
          attempts: 1,
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify reopen was called
    expect(reopenCalls.length).toBe(1);

    // Verify transition was NOT called
    expect(transitionCalls.length).toBe(0);
  });

  it('entry claimed+prUrl, attempts=2 (at cap), PR CLOSED-unmerged → transition to needs-manual, ack envelope, next candidate served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(
      JSON.stringify({ state: 'CLOSED', mergedAt: null }),
    );

    let reopenCalls: string[] = [];
    (ledger as any).reopen = async (source: string, sourceRef: string) => {
      reopenCalls.push(`${source}:${sourceRef}`);
    };

    // Pre-populate ledger with a claimed entry, attempts=2 (at cap, which is 2)
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          prUrl: 'https://github.com/owner/repo/pull/123',
          branch: 'feat/test-branch',
          attempts: 2,
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify reopen was NOT called
    expect(reopenCalls.length).toBe(0);

    // Verify transition WAS called with 'needs-manual' status
    expect(transitionCalls.length).toBeGreaterThan(0);
    const transitionCall = transitionCalls[0];
    expect(transitionCall[0]).toBe(candidate1.source);
    expect(transitionCall[1]).toBe(candidate1.sourceRef);
    expect(transitionCall[2]).toBe('needs-manual');
    expect(transitionCall[3]?.prUrl).toBe('https://github.com/owner/repo/pull/123');

    // Verify envelope was released (acked)
    expect(releasedEnvelopes).toContain(candidate1);
  });

  it('two candidates: first closed-unmerged at-cap, second healthy → first becomes needs-manual, second served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh(
      JSON.stringify({ state: 'CLOSED', mergedAt: null }),
    );

    let reopenCalls: string[] = [];
    (ledger as any).reopen = async (source: string, sourceRef: string) => {
      reopenCalls.push(`${source}:${sourceRef}`);
    };

    // Pre-populate ledger
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          prUrl: 'https://github.com/owner/repo/pull/123',
          branch: 'feat/test-branch',
          attempts: 2,
        };
      }
      // candidate2 has no entry (passthrough)
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });

    // First claim should skip candidate1 (at-cap closed-unmerged) and serve candidate2
    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify reopen was NOT called
    expect(reopenCalls.length).toBe(0);

    // Verify transition to needs-manual was called for candidate1
    expect(transitionCalls.length).toBeGreaterThan(0);
    expect(transitionCalls[0][2]).toBe('needs-manual');

    // Verify candidate1 was released (acked)
    expect(releasedEnvelopes).toContain(candidate1);

    // Second claim should return null (queue exhausted)
    const second = await guarded.claim();
    expect(second).toBeNull();
  });
});

// ─── Task 6: unknown PR state fails safe (no sticky state) ──────────────────

describe('Task 6: createDeliveryGuardedQueue — unknown PR state fails safe', () => {
  it('entry claimed+prUrl, gh throws (network error) → candidate held, not served, log includes sourceRef, release list contains it', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFailingGh();

    // Capture logger
    const logMessages: string[] = [];
    const mockLogger = {
      info: (msg: string) => {
        logMessages.push(msg);
      },
    };

    // Pre-populate ledger with a claimed entry that has prUrl
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

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });

    // First claim should skip candidate1 (gh threw) and serve candidate2
    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify no transition was called (ledger not mutated for unknown state)
    expect(transitionCalls).toHaveLength(0);

    // Verify log includes sourceRef
    expect(logMessages.some((msg) => msg.includes('idea-1') && msg.toLowerCase().includes('unknown'))).toBe(
      true,
    );

    // Verify claim() returns null when queue is exhausted
    const second = await guarded.claim();
    expect(second).toBeNull();

    // Verify candidate1 was released (in held list) when queue became empty
    expect(releasedEnvelopes).toContain(candidate1);
  });

  it('single candidate, gh throws → claim() returns null after releasing the held candidate', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFailingGh();

    const mockLogger = {
      info: (msg: string) => {
        // Log captured but not asserted in this test
      },
    };

    // Pre-populate ledger with a claimed entry that has prUrl
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

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });

    // Claim should return null (only candidate threw, so held and released)
    const first = await guarded.claim();
    expect(first).toBeNull();

    // Verify no transition was called
    expect(transitionCalls).toHaveLength(0);

    // Verify candidate1 was released when queue became empty
    expect(releasedEnvelopes).toContain(candidate1);
  });

  it('two candidates: first claimed+prUrl with gh throws, second pending → first held, second served', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger } = makeFakeLedger();
    const { runner: gh } = makeFailingGh();

    const mockLogger = {
      info: (msg: string) => {
        // Log captured
      },
    };

    // Pre-populate ledger
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
      // candidate2 has pending status (passthrough)
      if (sourceRef === 'idea-2') {
        return {
          source: candidate2.source,
          sourceRef: candidate2.sourceRef,
          status: 'pending',
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });

    // First claim should skip candidate1 (gh threw) and serve candidate2 (pending)
    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Second claim should return null (queue exhausted)
    const second = await guarded.claim();
    expect(second).toBeNull();
  });

  it('entry held due to gh failure, then released; next claim() call with healthy gh → entry served normally (no sticky state)', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger } = makeFakeLedger();

    const mockLogger = {
      info: (msg: string) => {
        // Log captured
      },
    };

    // First guard with failing gh
    const { runner: failingGh } = makeFailingGh();
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

    const guarded1 = createDeliveryGuardedQueue(queue, ledger, { gh: failingGh, logger: mockLogger });

    // First attempt should skip candidate1 and serve candidate2
    const first = await guarded1.claim();
    expect(first).toEqual(candidate2);

    // Exhausting the queue should release candidate1
    const exhausted = await guarded1.claim();
    expect(exhausted).toBeNull();
    expect(releasedEnvelopes).toContain(candidate1);

    // Now simulate the entry being retried with healthy gh
    // Reset queue with both candidates again (simulating retry scenario)
    const { queue: queue2, releasedEnvelopes: releasedEnvelopes2 } = makeFakeQueueWithEnvelopes([candidate1]);
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        // Still has prUrl but now the PR might be in a different state
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

    // Second guard with healthy gh (returns 'open')
    const { runner: healthyGh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));
    const guarded2 = createDeliveryGuardedQueue(queue2, ledger, { gh: healthyGh, logger: mockLogger });

    // This time, candidate1 should be healed (gh is healthy now)
    const retried = await guarded2.claim();
    expect(retried).toBeNull(); // No more candidates in queue2, but candidate1 was healed

    // Verify candidate1 was released (acked after healing, not held)
    expect(releasedEnvelopes2).toContain(candidate1);
  });
});

// ─── Task 4: GuardLedger exposes forget() ────────────────────────────────────

describe('Task 4: GuardLedger interface — exposes forget()', () => {
  it('a ledger stub implementing forget(source, sourceRef) satisfies the GuardLedger contract used by the guard constructor', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('idea-1');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { runner: gh } = makeFakeGh('');

    const forgetCalls: Array<[string, string]> = [];
    // Type-level assertion: GuardLedger must declare forget(source, sourceRef).
    // If the interface doesn't declare it, this fails to compile (RED).
    const ledgerWithForget: GuardLedger = {
      async get() {
        return undefined;
      },
      async record() {},
      async transition() {},
      async reopen() {},
      async forget(source: string, sourceRef: string) {
        forgetCalls.push([source, sourceRef]);
      },
    };

    const guarded = createDeliveryGuardedQueue(queue, ledgerWithForget, { gh });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    // forget() is callable through the ledger the guard was constructed with
    await ledgerWithForget.forget('test-source', 'idea-1');
    expect(forgetCalls).toEqual([['test-source', 'idea-1']]);
  });
});

// ─── Task 5: claim guard probes issue state for github-issues envelopes (open → deliver) ────

describe('Task 5: createDeliveryGuardedQueue — probes issue state for github-issues, open delivers', () => {
  it('pending github-issues candidate with OPEN issue → delivered, getIssueState probe reached (gh invoked)', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('owner/repo#42', 'github-issues');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger } = makeFakeLedger();
    (ledger as any).get = async () => ({
      source: 'github-issues',
      sourceRef: 'owner/repo#42',
      status: 'pending',
    });
    const { runner: gh, calls } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].args).toContain('--repo');
    expect(calls[0].args[calls[0].args.indexOf('--repo') + 1]).toBe('owner/repo');
  });
});

// ─── Task 6: claim guard drops closed issue and continues scan ──────────────

describe('Task 6: createDeliveryGuardedQueue — closed issue dropped, scan continues', () => {
  it('closed github-issues candidate followed by open candidate → closed forgotten+acked, open candidate returned', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const closedCandidate = makeEnvelope('owner/repo#42', 'github-issues');
    const openCandidate = makeEnvelope('idea-1', 'test-source');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([
      closedCandidate,
      openCandidate,
    ]);
    const { ledger, transitionCalls } = makeFakeLedger();
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === 'github-issues' && sourceRef === 'owner/repo#42') {
        return { source, sourceRef, status: 'pending' };
      }
      return undefined;
    };
    const forgetCalls: Array<[string, string]> = [];
    (ledger as any).forget = async (source: string, sourceRef: string) => {
      forgetCalls.push([source, sourceRef]);
    };

    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'CLOSED' }));

    const guarded = createDeliveryGuardedQueue(queue, ledger as any, { gh });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(openCandidate);
    expect(forgetCalls).toEqual([['github-issues', 'owner/repo#42']]);
    expect(releasedEnvelopes).toContain(closedCandidate);
    expect(releasedEnvelopes).not.toContain(openCandidate);
    expect(transitionCalls).toHaveLength(0);
  });
});

// ─── Task 7: closed last/only candidate returns null; ENOENT-on-ack is benign ──

describe('Task 7: createDeliveryGuardedQueue — closed last candidate returns null; ack ENOENT benign', () => {
  it('single closed github-issues candidate → forgotten+dropped, claim() returns null (empty queue)', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const closedCandidate = makeEnvelope('owner/repo#99', 'github-issues');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([closedCandidate]);
    const { ledger, transitionCalls } = makeFakeLedger();
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === 'github-issues' && sourceRef === 'owner/repo#99') {
        return { source, sourceRef, status: 'pending' };
      }
      return undefined;
    };
    const forgetCalls: Array<[string, string]> = [];
    (ledger as any).forget = async (source: string, sourceRef: string) => {
      forgetCalls.push([source, sourceRef]);
    };

    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'CLOSED' }));

    const guarded = createDeliveryGuardedQueue(queue, ledger as any, { gh });
    const claimed = await guarded.claim();

    expect(claimed).toBeNull();
    expect(forgetCalls).toEqual([['github-issues', 'owner/repo#99']]);
    expect(releasedEnvelopes).toContain(closedCandidate);
    expect(transitionCalls).toHaveLength(0);
  });

  it('single closed candidate, queue.ack throws ENOENT → swallowed, claim() still returns null', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const closedCandidate = makeEnvelope('owner/repo#100', 'github-issues');
    const { queue } = makeFakeQueueWithEnvelopes([closedCandidate]);
    const enoentError = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
    enoentError.code = 'ENOENT';
    queue.ack = async () => {
      throw enoentError;
    };
    const { ledger, transitionCalls } = makeFakeLedger();
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === 'github-issues' && sourceRef === 'owner/repo#100') {
        return { source, sourceRef, status: 'pending' };
      }
      return undefined;
    };
    const forgetCalls: Array<[string, string]> = [];
    (ledger as any).forget = async (source: string, sourceRef: string) => {
      forgetCalls.push([source, sourceRef]);
    };

    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'CLOSED' }));

    let threw = false;
    let claimed: any;
    try {
      const guarded = createDeliveryGuardedQueue(queue, ledger as any, { gh });
      claimed = await guarded.claim();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(claimed).toBeNull();
    expect(forgetCalls).toEqual([['github-issues', 'owner/repo#100']]);
    expect(transitionCalls).toHaveLength(0);
  });
});

// ─── Task 8: claim guard fails safe on unknown/throwing issue state ─────────

describe('Task 8: createDeliveryGuardedQueue — fails safe on unknown/throwing issue state', () => {
  it('getIssueState resolves unknown (unparseable gh output) → candidate delivered, no forget call, ledger untouched', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('owner/repo#42', 'github-issues');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger, transitionCalls } = makeFakeLedger();
    (ledger as any).get = async () => ({
      source: 'github-issues',
      sourceRef: 'owner/repo#42',
      status: 'pending',
    });
    const forgetCalls: Array<[string, string]> = [];
    (ledger as any).forget = async (source: string, sourceRef: string) => {
      forgetCalls.push([source, sourceRef]);
    };

    // Unparseable stdout → getIssueState resolves 'unknown', not 'closed'.
    const { runner: gh } = makeFakeGh('not valid json');

    const guarded = createDeliveryGuardedQueue(queue, ledger as any, { gh });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    expect(forgetCalls).toHaveLength(0);
    expect(transitionCalls).toHaveLength(0);
  });

  it('gh runner throws during issue-state probe → candidate delivered, no forget call, no crash', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('owner/repo#42', 'github-issues');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger, transitionCalls } = makeFakeLedger();
    (ledger as any).get = async () => ({
      source: 'github-issues',
      sourceRef: 'owner/repo#42',
      status: 'pending',
    });
    const forgetCalls: Array<[string, string]> = [];
    (ledger as any).forget = async (source: string, sourceRef: string) => {
      forgetCalls.push([source, sourceRef]);
    };

    // gh throws unconditionally on every call (including the issue-state probe).
    const gh = async () => {
      throw new Error('gh command failed');
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger as any, { gh });

    let threw = false;
    let claimed: any;
    try {
      claimed = await guarded.claim();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(claimed).toEqual(candidate);
    expect(forgetCalls).toHaveLength(0);
    expect(transitionCalls).toHaveLength(0);
  });
});

// ─── Task 7: in-flight duplicate envelope dropped without ledger mutation ────

describe('Task 7: createDeliveryGuardedQueue — in-flight duplicate envelope dropped', () => {
  it('entry claimed (no prUrl) + matching duplicate envelope → envelope acked, ledger entry unchanged (deep equal), log includes "engineer forget {sourceRef}"', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('idea-1');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh('');

    // Capture logger
    const logMessages: string[] = [];
    const mockLogger = {
      info: (msg: string) => {
        logMessages.push(msg);
      },
    };

    // Pre-populate ledger with a claimed entry that has NO prUrl (in-flight)
    const originalEntry = {
      source: candidate.source,
      sourceRef: candidate.sourceRef,
      status: 'claimed',
      // NO prUrl — this is in-flight
      branch: 'feat/in-flight-branch',
    };
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate.source && sourceRef === candidate.sourceRef) {
        return { ...originalEntry }; // Return a copy to check if it was mutated
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });

    // Claim should drop the duplicate envelope and return null (no more candidates)
    const claimed = await guarded.claim();
    expect(claimed).toBeNull();

    // Verify the envelope was acked (released)
    expect(releasedEnvelopes).toContain(candidate);

    // Verify no transition was called (ledger untouched)
    expect(transitionCalls).toHaveLength(0);

    // Verify log includes "engineer forget {sourceRef}"
    const logText = logMessages.join('\n');
    expect(logText).toMatch(/engineer forget/i);
    expect(logText).toContain('idea-1');
  });

  it('two candidates: first claimed (no prUrl), second pending, matching envelope on first → first acked/dropped, second served, ledger untouched', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue, releasedEnvelopes } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh('');

    const logMessages: string[] = [];
    const mockLogger = {
      info: (msg: string) => {
        logMessages.push(msg);
      },
    };

    // Pre-populate ledger
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          // NO prUrl — in-flight
        };
      }
      if (sourceRef === 'idea-2') {
        return {
          source: candidate2.source,
          sourceRef: candidate2.sourceRef,
          status: 'pending',
        };
      }
      return undefined;
    };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });

    // First claim should skip candidate1 (drop duplicate) and serve candidate2
    const first = await guarded.claim();
    expect(first).toEqual(candidate2);

    // Verify candidate1 was acked (released)
    expect(releasedEnvelopes).toContain(candidate1);

    // Verify no transition was called for candidate1 (ledger untouched)
    expect(transitionCalls).toHaveLength(0);

    // Verify log includes "engineer forget" for candidate1
    const logText = logMessages.join('\n');
    expect(logText).toMatch(/engineer forget/i);
    expect(logText).toContain('idea-1');

    // Third claim should return null (queue exhausted)
    const second = await guarded.claim();
    expect(second).toBeNull();
  });

  it('entry after forget (cleared) → fresh envelope serves normally (regression test for recovery path)', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const { queue: queue1, releasedEnvelopes: releasedEnvelopes1 } = makeFakeQueueWithEnvelopes([candidate1]);
    const { ledger, transitionCalls } = makeFakeLedger();
    const { runner: gh } = makeFakeGh('');

    const logMessages: string[] = [];
    const mockLogger = {
      info: (msg: string) => {
        logMessages.push(msg);
      },
    };

    // Pre-populate ledger with in-flight entry
    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (source === candidate1.source && sourceRef === candidate1.sourceRef) {
        return {
          source: candidate1.source,
          sourceRef: candidate1.sourceRef,
          status: 'claimed',
          // NO prUrl — in-flight
        };
      }
      return undefined;
    };

    const guarded1 = createDeliveryGuardedQueue(queue1, ledger, { gh, logger: mockLogger });

    // First claim should drop the duplicate and return null (no more candidates)
    const first = await guarded1.claim();
    expect(first).toBeNull();

    // Verify candidate1 was acked (released)
    expect(releasedEnvelopes1).toContain(candidate1);

    // Verify log includes "engineer forget" for the dropped duplicate
    const logText1 = logMessages.join('\n');
    expect(logText1).toMatch(/engineer forget/i);

    // Now simulate recovery: operator runs "engineer forget {sourceRef}" to clear the entry
    // Reset the ledger to return undefined for the same sourceRef
    (ledger as any).get = async (source: string, sourceRef: string) => {
      // Entry is now cleared after forget
      return undefined;
    };

    // Create a fresh queue with the same candidate (simulating retry after forget)
    const candidate2 = makeEnvelope('idea-1'); // Same sourceRef
    const { queue: queue2, releasedEnvelopes: releasedEnvelopes2 } = makeFakeQueueWithEnvelopes([candidate2]);

    // Clear the log for the second phase
    logMessages.length = 0;

    const guarded2 = createDeliveryGuardedQueue(queue2, ledger, { gh, logger: mockLogger });

    // Second claim should now serve candidate2 normally (entry is cleared)
    const second = await guarded2.claim();
    expect(second).toEqual(candidate2);

    // Verify no transition was called (should be a passthrough)
    expect(transitionCalls).toHaveLength(0);

    // Third claim should return null (queue exhausted)
    const third = await guarded2.claim();
    expect(third).toBeNull();
  });
});

// ─── Task 5: delivery-guard reaps stale claimed → pending at claim time ─────

describe('Task 5: createDeliveryGuardedQueue — reaps stale claimed entries to pending', () => {
  it('stale claimed entry (no prUrl) → requeueClaimed called, logger.info announces reap, delivered-heal runs first (precedence)', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('idea-1');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger, transitionCalls } = makeFakeLedger();

    const staleEntry = {
      source: 'test-source',
      sourceRef: 'stale-idea',
      status: 'claimed',
      lastSeenAt: '2020-01-01T00:00:00.000Z', // far in the past — always stale
    };

    (ledger as any).list = async () => [staleEntry];

    const requeueCalls: Array<[string, string]> = [];
    (ledger as any).requeueClaimed = async (source: string, sourceRef: string) => {
      requeueCalls.push([source, sourceRef]);
      return { acted: true };
    };

    // The claimed candidate itself has no ledger entry keyed to it (passthrough).
    (ledger as any).get = async () => undefined;

    const logMessages: string[] = [];
    const mockLogger = { info: (msg: string) => logMessages.push(msg) };

    const { runner: gh } = makeFakeGh('');

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    expect(requeueCalls).toEqual([['test-source', 'stale-idea']]);
    expect(logMessages.some((m) => m.includes('stale-idea'))).toBe(true);
    // Precedence: no delivered-heal transitions were triggered by this reap.
    expect(transitionCalls).toHaveLength(0);
  });

  it('delivered-heal (→ done) runs before the stale-claimed reap pass (precedence)', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate1 = makeEnvelope('idea-1');
    const candidate2 = makeEnvelope('idea-2');
    const { queue } = makeFakeQueueWithEnvelopes([candidate1, candidate2]);
    const { ledger, transitionCalls } = makeFakeLedger();

    // candidate1's ledger entry is claimed + has an open prUrl → delivered-heal path.
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

    // A separate, unrelated stale claimed entry exists in the ledger (no prUrl).
    const staleEntry = {
      source: 'test-source',
      sourceRef: 'stale-idea',
      status: 'claimed',
      lastSeenAt: '2020-01-01T00:00:00.000Z',
    };
    (ledger as any).list = async () => [staleEntry];

    const requeueCalls: Array<[string, string]> = [];
    (ledger as any).requeueClaimed = async (source: string, sourceRef: string) => {
      requeueCalls.push([source, sourceRef]);
      return { acted: true };
    };

    const logMessages: string[] = [];
    const mockLogger = { info: (msg: string) => logMessages.push(msg) };

    const { runner: gh } = makeFakeGh(JSON.stringify({ state: 'OPEN' }));

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });
    const first = await guarded.claim();

    // Delivered-heal serves candidate2 after healing candidate1 to done.
    expect(first).toEqual(candidate2);
    expect(transitionCalls.length).toBeGreaterThan(0);
    expect(transitionCalls[0][2]).toBe('done');

    // Stale-claimed reap also ran and requeued the unrelated stale entry.
    expect(requeueCalls).toEqual([['test-source', 'stale-idea']]);
    expect(logMessages.some((m) => m.includes('stale-idea'))).toBe(true);
  });
});

// ─── Plan-Task 6: reap respects the window, never touches non-claimed entries ──
// (.docs/plans/engineer-unclaim-requeue-verb-stale-claimed-ledger.md, Task 6 —
// distinct from the pre-existing "Task 6" describe blocks above, which belong to
// an unrelated, earlier plan's task numbering.)

describe('Plan-Task 6: createDeliveryGuardedQueue — reap never touches fresh or terminal entries', () => {
  it('fresh claimed entry (age <= window) is NOT reaped and NOT announced', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('idea-1');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger } = makeFakeLedger();

    const freshEntry = {
      source: 'test-source',
      sourceRef: 'fresh-idea',
      status: 'claimed',
      lastSeenAt: new Date().toISOString(), // just now — well within the window
    };

    (ledger as any).list = async () => [freshEntry];
    (ledger as any).get = async () => undefined;

    const requeueCalls: Array<[string, string]> = [];
    (ledger as any).requeueClaimed = async (source: string, sourceRef: string) => {
      requeueCalls.push([source, sourceRef]);
      return { acted: true };
    };

    const logMessages: string[] = [];
    const mockLogger = { info: (msg: string) => logMessages.push(msg) };
    const { runner: gh } = makeFakeGh('');

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    expect(requeueCalls).toHaveLength(0);
    expect(logMessages.some((m) => m.includes('fresh-idea'))).toBe(false);
  });

  it('old done entry is never reaped by the stale-claim rule (non-claimed status is untouched)', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('idea-1');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger } = makeFakeLedger();

    const doneEntry = {
      source: 'test-source',
      sourceRef: 'done-idea',
      status: 'done',
      prUrl: 'https://github.com/owner/repo/pull/900',
      lastSeenAt: '2020-01-01T00:00:00.000Z', // far in the past — would be stale if claimed
    };

    (ledger as any).list = async () => [doneEntry];
    (ledger as any).get = async () => undefined;

    const requeueCalls: Array<[string, string]> = [];
    (ledger as any).requeueClaimed = async (source: string, sourceRef: string) => {
      requeueCalls.push([source, sourceRef]);
      return { acted: true };
    };

    const logMessages: string[] = [];
    const mockLogger = { info: (msg: string) => logMessages.push(msg) };
    const { runner: gh } = makeFakeGh('');

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    expect(requeueCalls).toHaveLength(0);
    expect(logMessages.some((m) => m.includes('done-idea'))).toBe(false);
  });
});

// ─── Synthetic-envelope reap: stale claimed entry with no queue envelope ──────
// (commit e22ba810 added `queue.list()`/`queue.enqueue()` synthesis inside
// `reapStaleClaimed` for exactly this case — the original envelope was ack'd
// away when it was first claimed, so nothing in the queue matches the stale
// ledger entry any more. Every other reap test above seeds `pending` with an
// envelope whose sourceRef matches the stale entry, so the synth branch never
// actually ran; this test's queue starts with ONLY an unrelated pending
// envelope — proving the reap manufactures one and serves it.)

describe('Synthetic-envelope reap: stale claimed entry with no matching queue envelope', () => {
  it('synthesizes a minimal envelope for a stale claimed entry absent from queue.list() and serves it same-pull', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();

    // The queue has NO envelope for 'stale-idea' — it was ack'd away when
    // originally claimed. Only an unrelated, genuinely pending envelope exists.
    const pendingCandidate = makeEnvelope('pending-idea');
    const { queue, enqueued } = makeFakeQueueWithEnvelopesAndCatalog([pendingCandidate]);
    const { ledger } = makeFakeLedger();

    const staleEntry = {
      source: 'test-source',
      sourceRef: 'stale-idea',
      status: 'claimed',
      capturedAt: '2020-01-01T00:00:00.000Z',
      lastSeenAt: '2020-01-01T00:00:00.000Z', // far in the past — always stale
    };
    (ledger as any).list = async () => [staleEntry];

    const requeueCalls: Array<[string, string]> = [];
    (ledger as any).requeueClaimed = async (source: string, sourceRef: string) => {
      requeueCalls.push([source, sourceRef]);
      return { acted: true };
    };
    // The pending candidate has no ledger entry (healthy passthrough).
    (ledger as any).get = async () => undefined;

    const logMessages: string[] = [];
    const mockLogger = { info: (msg: string) => logMessages.push(msg) };
    const { runner: gh } = makeFakeGh('');

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });
    const first = await guarded.claim();

    expect(requeueCalls).toEqual([['test-source', 'stale-idea']]);
    // A synthetic envelope was manufactured for the reaped entry, backdated to
    // its original capturedAt so a real (time-ordered) queue would serve it
    // ahead of the newer pending candidate.
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      source: 'test-source',
      sourceRef: 'stale-idea',
      receivedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(logMessages.some((m) => m.includes('stale-idea'))).toBe(true);

    // The synthesized envelope is now genuinely claimable — served on a
    // subsequent pull from the SAME guarded queue (this fake's `claim()`
    // preserves push order rather than re-sorting by receivedAt, so the two
    // claim()s here stand in for a real queue's single FIFO-ordered pull).
    expect(first).toMatchObject({ source: 'test-source', sourceRef: 'pending-idea' });
    const second = await guarded.claim();
    expect(second).toMatchObject({ source: 'test-source', sourceRef: 'stale-idea' });
  });

  it('does not duplicate-enqueue when a matching envelope already exists in queue.list()', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const staleCandidate = makeEnvelope('stale-idea');
    const { queue, enqueued } = makeFakeQueueWithEnvelopesAndCatalog([staleCandidate]);
    const { ledger } = makeFakeLedger();

    const staleEntry = {
      source: 'test-source',
      sourceRef: 'stale-idea',
      status: 'claimed',
      capturedAt: '2020-01-01T00:00:00.000Z',
      lastSeenAt: '2020-01-01T00:00:00.000Z',
    };
    (ledger as any).list = async () => [staleEntry];
    (ledger as any).requeueClaimed = async () => ({ acted: true });
    (ledger as any).get = async () => undefined;

    const { runner: gh } = makeFakeGh('');
    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });
    const claimed = await guarded.claim();

    expect(enqueued).toHaveLength(0);
    expect(claimed).toEqual(staleCandidate);
  });
});

// ─── Plan-Task 7: reaped entry is claimable on the same pull, oldest-first ─────
// (.docs/plans/engineer-unclaim-requeue-verb-stale-claimed-ledger.md, Task 7 —
// distinct from the pre-existing "Task 7" describe blocks above, which belong to
// an unrelated, earlier plan's task numbering.)

describe('Plan-Task 7: createDeliveryGuardedQueue — reaped entry served same-pull, oldest-first (FIFO)', () => {
  it('stale claimed entry (older capturedAt) is reaped and returned before a newer pending entry', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();

    // The queue's FIFO order mirrors capturedAt: the stale entry's envelope was
    // captured first, so the underlying queue would naturally serve it first —
    // but its ledger status is still 'claimed' (stranded), so without the reap
    // it would otherwise be dropped as an in-flight duplicate (see Task 7 guard
    // logic) and the newer pending entry would be served instead.
    const staleCandidate = makeEnvelope('stale-idea');
    const pendingCandidate = makeEnvelope('pending-idea');
    const { queue } = makeFakeQueueWithEnvelopes([staleCandidate, pendingCandidate]);
    const { ledger } = makeFakeLedger();

    (ledger as any).list = async () => [
      {
        source: 'test-source',
        sourceRef: 'stale-idea',
        status: 'claimed',
        capturedAt: '2020-01-01T00:00:00.000Z',
        lastSeenAt: '2020-01-01T00:00:00.000Z', // far in the past — always stale
      },
    ];

    (ledger as any).get = async (source: string, sourceRef: string) => {
      if (sourceRef === 'stale-idea') {
        return {
          source,
          sourceRef,
          status: 'claimed',
          capturedAt: '2020-01-01T00:00:00.000Z',
          lastSeenAt: '2020-01-01T00:00:00.000Z',
        };
      }
      return undefined; // pending-idea is a healthy passthrough candidate
    };

    const requeueCalls: Array<[string, string]> = [];
    (ledger as any).requeueClaimed = async (source: string, sourceRef: string) => {
      requeueCalls.push([source, sourceRef]);
      (ledger as any).get = async (s: string, r: string) => {
        if (r === 'stale-idea') {
          return {
            source: s,
            sourceRef: r,
            status: 'pending',
            capturedAt: '2020-01-01T00:00:00.000Z',
          };
        }
        return undefined;
      };
      return { acted: true };
    };

    const logMessages: string[] = [];
    const mockLogger = { info: (msg: string) => logMessages.push(msg) };
    const { runner: gh } = makeFakeGh('');

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });
    const claimed = await guarded.claim();

    // The reaped, older entry wins over the newer healthy pending one — proving
    // the reap persisted to the ledger BEFORE the candidate's status was
    // inspected, on this same claim() call.
    expect(claimed).toEqual(staleCandidate);
    expect(requeueCalls).toEqual([['test-source', 'stale-idea']]);
  });
});

// ─── Task 9: issue-state probe scoped to parseable github-issues envelopes ────

describe('Task 9: createDeliveryGuardedQueue — probe scoped to parseable github-issues envelopes', () => {
  it('non-github-issues candidate → delivered, getIssueState probe never invoked (gh not called)', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('idea-1', 'test-source');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger } = makeFakeLedger();
    const { runner: gh, calls } = makeFakeGh('OPEN');

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    expect(calls).toHaveLength(0);
  });

  it('github-issues candidate with unparseable sourceRef → delivered, probe skipped, diagnostic logged', async () => {
    const { createDeliveryGuardedQueue } = await loadDeliveryGuard();
    const candidate = makeEnvelope('not-a-valid-ref', 'github-issues');
    const { queue } = makeFakeQueueWithEnvelopes([candidate]);
    const { ledger } = makeFakeLedger();
    const { runner: gh, calls } = makeFakeGh('OPEN');

    const logMessages: string[] = [];
    const mockLogger = { info: (msg: string) => logMessages.push(msg) };

    const guarded = createDeliveryGuardedQueue(queue, ledger, { gh, logger: mockLogger });
    const claimed = await guarded.claim();

    expect(claimed).toEqual(candidate);
    expect(calls).toHaveLength(0);
    expect(logMessages.some((m) => m.includes('not-a-valid-ref'))).toBe(true);
  });
});
