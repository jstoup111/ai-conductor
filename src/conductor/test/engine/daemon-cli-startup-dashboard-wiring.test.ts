// Covers: task:8
import { describe, expect, it } from 'vitest';
import { createStartupDashboardBinding } from '../../src/daemon-cli.js';

describe('daemon-cli startup dashboard wiring (Task 8)', () => {
  it('renders the exact cached startup discovery without another discovery, root refresh, or git fetch', async () => {
    const cachedDiscovery = [{ slug: 'cached-eligible' }];
    const discoveryCalls: boolean[] = [];
    let fastForwardRootCalls = 0;
    let gitFetchCalls = 0;
    let scannedDiscovery: unknown;
    const reconciliationCalls: Array<{ autoCleanup: false; reclaimMergedWorktrees: false }> = [];
    const rendered: string[] = [];
    const binding = createStartupDashboardBinding({
      pausedAtBoot: false,
      projectRoot: '/project',
      worktreeBase: '/project/.worktrees',
      processedDir: '/project/.daemon/processed',
      log: () => {},
      discoverTick: async ({ refresh }) => {
        discoveryCalls.push(refresh);
        fastForwardRootCalls++;
        gitFetchCalls++;
        return cachedDiscovery;
      },
      scanInheritedState: async ({ discover }) => {
        scannedDiscovery = await discover();
        return {
          halted: [], inProgress: [], eligible: [{ slug: 'cached-eligible' }],
          processed: [], processedCount: 0,
        };
      },
      listOperatorParkedSlugs: async () => ['merged-feature', 'orphan-feature'],
      reconcileParkedFeatures: async ({ autoCleanup, reclaimMergedWorktrees }) => {
        reconciliationCalls.push({ autoCleanup, reclaimMergedWorktrees });
        return {
          entries: [
            { slug: 'merged-feature', classification: 'merged' },
            { slug: 'orphan-feature', classification: 'orphan' },
          ],
          counts: { reconciled: 0, deferred: 0, orphaned: 0, parked: 0, refused: 0, skipped: 0 },
          refusedByReason: {},
        };
      },
      isOperatorParked: async (_root, slug) => slug !== 'cached-eligible',
      getProvenanceType: async () => 'operator',
      writeDashboard: (_persisted, consoleOutput) => rendered.push(consoleOutput),
    });

    // This is the daemon's first dispatch discovery. Reset the counters so the
    // assertion below is specifically about the deferred dashboard binding.
    await binding.discoverAndCacheStartup({ refresh: true });
    discoveryCalls.length = 0;
    fastForwardRootCalls = 0;
    gitFetchCalls = 0;

    await binding.renderStartupDashboard();

    expect(scannedDiscovery).toBe(cachedDiscovery);
    expect(discoveryCalls).toEqual([]); // neither refresh:true nor refresh:false
    expect(fastForwardRootCalls).toBe(0);
    expect(gitFetchCalls).toBe(0);
    expect(reconciliationCalls).toEqual([{ autoCleanup: false, reclaimMergedWorktrees: false }]);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toContain('ELIGIBLE (1)');
    expect(rendered[0]).toContain('cached-eligible');
    expect(rendered[0]).toContain('merged — ready to reconcile');
    expect(rendered[0]).toContain('orphan — needs manual review');
  });
});
