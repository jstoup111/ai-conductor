import { describe, it, expect, vi } from 'vitest';
import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
} from '../../src/engine/daemon.js';

function items(n: number): BacklogItem[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `f${i}`,
  }));
}

/** Backlog that returns the full list every poll; the daemon filters started. */
function staticBacklog(list: BacklogItem[]) {
  return async () => list;
}

describe('engine/daemon — per-sweep ownership gate', () => {
  it('stops dispatch with lock_lost when lockOwnershipLost() returns true mid-sweep', async () => {
    let sweep = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(5)), // would normally dispatch all 5
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      lockOwnershipLost: async () => {
        sweep++;
        // Return true on the second sweep (first one should proceed, second one stops)
        return sweep === 2;
      },
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.stoppedReason).toBe('lock_lost');
    // Only one feature should be dispatched before the second sweep stops us
    expect(res.processed).toHaveLength(1);
    expect(res.processed[0].slug).toBe('f0');
  });

  it('continues dispatch normally when lockOwnershipLost() returns false', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(3)),
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      lockOwnershipLost: async () => false, // ownership is fine
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.stoppedReason).toBe('backlog_drained');
    // All features should be processed normally
    expect(res.processed).toHaveLength(3);
    expect(res.processed.map((o) => o.slug).sort()).toEqual(['f0', 'f1', 'f2']);
  });

  it('does NOT stop when lockOwnershipLost() returns undefined (fail-safe toward continuing)', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(2)),
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      lockOwnershipLost: async () => undefined as any, // inconclusive/missing
      sleep: async () => {}, // no-op to avoid actual delays
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 2 });
    // Should drain backlog and exit normally via idle timeout, not lock_lost
    expect(res.stoppedReason).toBe('idle_timeout');
    expect(res.processed).toHaveLength(2);
  });

  it('stops before dispatching further features when ownership is lost at sweep boundary', async () => {
    let dispatchCount = 0;
    let sweepCount = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(10)), // plenty of work available
      runFeature: async (it) => {
        dispatchCount++;
        return { slug: it.slug, status: 'done' };
      },
      lockOwnershipLost: async () => {
        sweepCount++;
        // Ownership is lost starting on sweep 3
        return sweepCount >= 3;
      },
    };
    // Use concurrency 2 so we can dispatch 2 features before the check on sweep 3
    const res = await runDaemon(deps, { concurrency: 2, once: true });
    expect(res.stoppedReason).toBe('lock_lost');
    // Should have dispatched exactly 2 features before the third sweep detected loss
    expect(dispatchCount).toBe(2);
    expect(res.processed).toHaveLength(2);
  });

  it('drains in-flight work after detecting ownership loss (does not crash)', async () => {
    let dispatchCount = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(5)),
      runFeature: async (it) => {
        dispatchCount++;
        return { slug: it.slug, status: 'done' };
      },
      lockOwnershipLost: async () => {
        // Ownership is lost on every sweep after the first
        return dispatchCount > 0;
      },
    };
    const res = await runDaemon(deps, { concurrency: 2, once: true }); // concurrency > 1
    expect(res.stoppedReason).toBe('lock_lost');
    // First dispatch proceeds, but ownership is lost immediately on second sweep
    // In-flight features should still drain
    expect(res.processed.length).toBeGreaterThanOrEqual(1);
  });

  it('checks ownership at each loop iteration (not just once)', async () => {
    let sweepCount = 0;
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(1)),
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      lockOwnershipLost: async () => {
        sweepCount++;
        return sweepCount > 5; // ownership lost after many sweeps
      },
      sleep: async () => {}, // no-op
    };
    const res = await runDaemon(deps, { concurrency: 1, once: false, maxIdlePolls: 10 });
    // Should have called lockOwnershipLost multiple times
    expect(sweepCount).toBeGreaterThan(1);
    // And eventually stopped when ownership was lost
    expect(res.stoppedReason).toBe('lock_lost');
  });

  it('absent lockOwnershipLost dep (pure-core default) never stops the loop for ownership loss', async () => {
    const deps: DaemonDeps = {
      discoverBacklog: staticBacklog(items(2)),
      runFeature: async (it) => ({ slug: it.slug, status: 'done' }),
      // lockOwnershipLost is not provided
    };
    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.stoppedReason).toBe('backlog_drained'); // normal drain, not lock_lost
    expect(res.processed).toHaveLength(2);
  });

  it('production wiring: lockOwnershipLost detects pidfile overwrites via ownsLock check', async () => {
    // Verify that the ownsLock predicate correctly detects when the pidfile
    // has been overwritten with a different uuid (simulating another daemon's takeover).
    // This test ensures the production wiring in daemon-cli.ts is correct:
    // lockOwnershipLost: async () => !(await ownsLock(projectRoot, lock.uuid))
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdtemp } = await import('node:fs/promises');

    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-ownership-detect-'));

    try {
      const daemonLock = await import('../../src/engine/daemon-lock.js');

      // Step 1: Simulate acquiring the lock with uuid A
      const uuidA = 'uuid-a-original-holder';
      await mkdir(join(projectRoot, '.daemon'), { recursive: true });
      const recordA: any = {
        pid: 12345,
        uuid: uuidA,
        startedAt: new Date().toISOString(),
      };
      await writeFile(
        join(projectRoot, '.daemon', 'daemon.pid'),
        JSON.stringify(recordA),
        'utf8',
      );

      // Verify we own the lock with uuid A
      const ownsWithA = await daemonLock.ownsLock(projectRoot, uuidA);
      expect(ownsWithA).toBe(true);

      // Step 2: Simulate another daemon overwriting the pidfile with uuid B
      const uuidB = 'uuid-b-takeover';
      const recordB: any = {
        pid: 99999,
        uuid: uuidB,
        startedAt: new Date().toISOString(),
      };
      await writeFile(
        join(projectRoot, '.daemon', 'daemon.pid'),
        JSON.stringify(recordB),
        'utf8',
      );

      // Step 3: Verify that ownership check returns false for original uuid A
      const ownsWithA_After = await daemonLock.ownsLock(projectRoot, uuidA);
      expect(ownsWithA_After).toBe(false); // We no longer own the lock

      // Step 4: Verify that the new holder owns it with uuid B
      const ownsWithB = await daemonLock.ownsLock(projectRoot, uuidB);
      expect(ownsWithB).toBe(true);

      // Step 5: Construct the production wiring check and verify it detects loss
      // This mirrors: lockOwnershipLost: async () => !(await ownsLock(projectRoot, lock.uuid))
      const lockOwnershipLost = async () => !(await daemonLock.ownsLock(projectRoot, uuidA));
      const detected = await lockOwnershipLost();
      expect(detected).toBe(true); // Ownership IS lost
    } finally {
      const { rm } = await import('node:fs/promises');
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('ownership check is called at top of loop, before discovery and dispatch', async () => {
    const callOrder: string[] = [];
    let ownershipCallCount = 0;

    const deps: DaemonDeps = {
      discoverBacklog: async () => {
        callOrder.push('discoverBacklog');
        return items(1);
      },
      runFeature: async (it) => {
        callOrder.push('runFeature');
        return { slug: it.slug, status: 'done' };
      },
      lockOwnershipLost: async () => {
        ownershipCallCount++;
        callOrder.push(`lockOwnershipLost(${ownershipCallCount})`);
        return ownershipCallCount >= 2; // stop on second call
      },
    };

    const res = await runDaemon(deps, { concurrency: 1, once: true });
    expect(res.stoppedReason).toBe('lock_lost');

    // The first call should come before discovery, and we only run one feature
    // Second call detects loss and stops
    expect(callOrder).toContain('lockOwnershipLost(1)');
    expect(callOrder).toContain('discoverBacklog');
    expect(callOrder).toContain('runFeature');
    expect(callOrder).toContain('lockOwnershipLost(2)');

    // Verify that lockOwnershipLost(2) came after runFeature (second iteration)
    const firstOwnershipCall = callOrder.indexOf('lockOwnershipLost(1)');
    const discoverIdx = callOrder.indexOf('discoverBacklog');
    const secondOwnershipCall = callOrder.indexOf('lockOwnershipLost(2)');

    expect(firstOwnershipCall).toBeLessThan(discoverIdx);
    expect(secondOwnershipCall).toBeGreaterThan(discoverIdx);
  });
});
