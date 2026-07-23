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
    const { runner: gh } = makeFailingGh().runner;

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
    const { runner: gh } = makeFailingGh().runner;

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
    const { runner: gh } = makeFailingGh().runner;

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
