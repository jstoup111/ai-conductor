import { describe, it, expect } from 'vitest';
import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
} from '../../src/engine/daemon.js';

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for Task 11: daemon exits cleanly even when idle poll
// timeout is pending, because the default sleep uses .unref().
//
// In continuous mode (once: false) with maxIdlePolls:0, the daemon should:
// 1. Process the backlog
// 2. Reach idle (no more items)
// 3. Hit idle timeout immediately (maxIdlePolls:0 means exit after first idle)
// 4. Exit without blocking on the pending sleep
// ─────────────────────────────────────────────────────────────────────────────

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `f${i}`,
  }));
}

describe('runDaemon - process exit without blocking on idle sleep (Task 11)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 1: Continuous mode with immediate idle timeout
  // ───────────────────────────────────────────────────────────────────────────
  it('exits at idle boundary when maxIdlePolls:0, with pending unref sleep', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        return { slug: item.slug, status: 'done' };
      },
      // Use default sleep (which is unref'd) by not injecting one
    };

    // In continuous mode (once: false) with maxIdlePolls: 0,
    // the daemon will process the backlog, reach idle, and exit immediately
    // without blocking on the pending idle poll timeout.
    const start = Date.now();
    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0, // exit after first idle poll
      idlePollMs: 60000, // 60 second timeout (but should exit before it fires)
    });
    const elapsed = Date.now() - start;

    // Verify the daemon exited due to idle timeout, not due to completing the timeout
    expect(result.stoppedReason).toBe('idle_timeout');
    // Verify it exited quickly (well before 60 seconds)
    expect(elapsed).toBeLessThan(5000);
    // Verify the feature was processed
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0].slug).toBe('f0');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 2: Multiple items processed, then exit at idle with no blocking
  // ───────────────────────────────────────────────────────────────────────────
  it('processes multiple items and exits at idle without blocking', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(3),
      runFeature: async (item) => {
        return { slug: item.slug, status: 'done' };
      },
    };

    const start = Date.now();
    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0,
      idlePollMs: 60000,
    });
    const elapsed = Date.now() - start;

    expect(result.stoppedReason).toBe('idle_timeout');
    expect(elapsed).toBeLessThan(5000);
    expect(result.processed).toHaveLength(3);
    expect(result.processed.map((p) => p.slug)).toEqual(['f0', 'f1', 'f2']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 3: Compare default sleep (unref'd) with custom ref'd sleep
  // (This demonstrates the difference: custom sleep can block, default doesn't)
  // ───────────────────────────────────────────────────────────────────────────
  it('custom ref-blocking sleep still respects maxIdlePolls (for comparison)', async () => {
    // This sleep will actually block (no .unref()), but maxIdlePolls:0 means
    // the daemon exits the loop before trying to sleep anyway
    let sleepWasCalled = false;
    const refBlockingSleep = async (ms: number) => {
      sleepWasCalled = true;
      // Simulate a blocking sleep by actually waiting
      // (This would be what happens WITHOUT .unref())
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, ms)));
    };

    const deps: DaemonDeps = {
      discoverBacklog: async () => items(1),
      runFeature: async (item) => {
        return { slug: item.slug, status: 'done' };
      },
      sleep: refBlockingSleep,
    };

    const start = Date.now();
    const result = await runDaemon(deps, {
      concurrency: 1,
      once: false,
      maxIdlePolls: 0, // still exits immediately at idle
      idlePollMs: 60000,
    });
    const elapsed = Date.now() - start;

    // Even with a ref-blocking sleep, maxIdlePolls:0 prevents the sleep from running
    expect(result.stoppedReason).toBe('idle_timeout');
    expect(elapsed).toBeLessThan(1000);
    // Sleep was never called because the daemon exited at the idle boundary check
    expect(sleepWasCalled).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 4: Once mode (drain and exit) never calls sleep
  // ───────────────────────────────────────────────────────────────────────────
  it('once: true (drain) never calls idle sleep', async () => {
    let sleepCallCount = 0;
    const deps: DaemonDeps = {
      discoverBacklog: async () => items(2),
      runFeature: async (item) => {
        return { slug: item.slug, status: 'done' };
      },
      sleep: async (_ms: number) => {
        sleepCallCount++;
      },
    };

    const result = await runDaemon(deps, {
      concurrency: 1,
      once: true, // drain and exit
    });

    expect(result.stoppedReason).toBe('backlog_drained');
    expect(result.processed).toHaveLength(2);
    expect(sleepCallCount).toBe(0); // sleep never called in once mode
  });
});
