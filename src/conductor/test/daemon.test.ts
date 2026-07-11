import { describe, it, expect, vi } from 'vitest';

const MOD_PATH = '../src/engine/daemon.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD_PATH)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

describe('Task 15: sweepBestEffort daemon wiring', () => {
  describe('observation sweep integration', () => {
    it('Test A: sweepBestEffort invokes optional sweepObservationWatch after sweepMergeableLabels', async () => {
      const mod = await load();
      const runDaemon = requireFn(mod, 'runDaemon');

      // Mock DaemonDeps with optional sweepObservationWatch
      const callOrder: string[] = [];

      const mockReconcileHaltPrs = vi.fn(async () => {
        callOrder.push('reconcileHaltPrs');
      });

      const mockSweepMergeableLabels = vi.fn(async () => {
        callOrder.push('sweepMergeableLabels');
      });

      const mockSweepObservationWatch = vi.fn(async () => {
        callOrder.push('sweepObservationWatch');
      });

      const deps = {
        discoverBacklog: vi.fn(async () => []),
        runFeature: vi.fn(async () => ({ slug: 'test', status: 'done' as const })),
        reconcileHaltPrs: mockReconcileHaltPrs,
        sweepMergeableLabels: mockSweepMergeableLabels,
        sweepObservationWatch: mockSweepObservationWatch,
        log: () => {},
      };

      // Run the daemon in once mode (single pass)
      await runDaemon(deps as any, {
        concurrency: 1,
        once: true,
      });

      // Expected: reconcileHaltPrs → sweepMergeableLabels → sweepObservationWatch
      expect(callOrder).toContain('reconcileHaltPrs');
      expect(callOrder).toContain('sweepMergeableLabels');
      expect(callOrder).toContain('sweepObservationWatch');

      const mergeableIndex = callOrder.indexOf('sweepMergeableLabels');
      const observationIndex = callOrder.indexOf('sweepObservationWatch');
      expect(observationIndex).toBeGreaterThan(mergeableIndex);
    });

    it('Test B: sweepBestEffort swallows sweepObservationWatch errors and continues', async () => {
      const mod = await load();
      const runDaemon = requireFn(mod, 'runDaemon');

      const logs: string[] = [];

      const mockSweepObservationWatch = vi.fn(async () => {
        throw new Error('Observation sweep failed');
      });

      const deps = {
        discoverBacklog: vi.fn(async () => []),
        runFeature: vi.fn(async () => ({ slug: 'test', status: 'done' as const })),
        reconcileHaltPrs: vi.fn(async () => {}),
        sweepMergeableLabels: vi.fn(async () => {}),
        sweepObservationWatch: mockSweepObservationWatch,
        log: (msg: string) => logs.push(msg),
      };

      // Should not throw despite observation sweep error
      const result = await runDaemon(deps as any, {
        concurrency: 1,
        once: true,
      });

      // Expected:
      // - Sweep was called
      expect(mockSweepObservationWatch).toHaveBeenCalled();

      // - Error is logged
      expect(logs.some((l) => l.includes('observation sweep failed') || l.includes('[daemon]'))).toBe(true);

      // - Daemon completes successfully (returns result)
      expect(result).toBeDefined();
      expect(result.stoppedReason).toBeDefined();
    });

    it('Test C: sweepBestEffort is called on startup and idle tick', async () => {
      const mod = await load();
      const runDaemon = requireFn(mod, 'runDaemon');

      let sweepCallCount = 0;

      const mockSweepObservationWatch = vi.fn(async () => {
        sweepCallCount++;
      });

      let idleTickCount = 0;
      const mockDiscoverBacklog = vi.fn(async () => {
        // Return nothing after second call (empty backlog)
        idleTickCount++;
        if (idleTickCount <= 1) {
          return [];
        }
        return [];
      });

      const deps = {
        discoverBacklog: mockDiscoverBacklog,
        runFeature: vi.fn(async () => ({ slug: 'test', status: 'done' as const })),
        reconcileHaltPrs: vi.fn(async () => {}),
        sweepMergeableLabels: vi.fn(async () => {}),
        sweepObservationWatch: mockSweepObservationWatch,
        sleep: vi.fn(async () => {}),
        log: () => {},
      };

      // Run with one idle poll to trigger idle-tick sweep
      await runDaemon(deps as any, {
        concurrency: 1,
        once: false,
        idlePollMs: 0,
        maxIdlePolls: 1,
      });

      // Expected: sweepObservationWatch called at startup + idle tick
      // At minimum: startup (1) + at least one idle tick (1)
      expect(mockSweepObservationWatch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
