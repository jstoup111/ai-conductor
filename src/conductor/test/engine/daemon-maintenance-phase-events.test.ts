// Covers: task:18
import { describe, expect, it } from 'vitest';
import { runDaemon } from '../../src/engine/daemon.js';
import { RepairQueue } from '../../src/engine/repair-queue.js';
import type { ConductorEvent } from '../../src/types/events.js';

describe('daemon maintenance phase events', () => {
  it('emits startup, first-claim, maintenance, and repair occurrences on the supplied spine', async () => {
    const events: Extract<ConductorEvent, { type: 'daemon_maintenance_phase' }>[] = [];
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/repair', slug: 'repair', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '2026-01-01T00:00:00Z', run: async () => ({ kind: 'failed', stage: 'worktree' }) });
    let clock = 0;
    await runDaemon({
      repairs: { queue, run: async () => { clock += 2; } },
      discoverBacklog: async () => [{ slug: 'feature' }],
      runFeature: async (item) => ({ slug: item.slug, status: 'done' as const }),
      renderStartupDashboard: async () => {},
      reconcileHaltPrs: async () => {},
      reconcileParkedFeatures: async () => ({
        outcome: 'skipped-unchanged' as const,
        counts: { reconciled: 1, deferred: 2, orphaned: 3, parked: 4, refused: 5, skipped: 6 },
      }),
      sweepProviderScratch: async () => {},
      sweepMergeableLabels: async () => {},
      emitMaintenancePhase: async (event) => { events.push(event); },
      now: () => ++clock,
    }, { concurrency: 1, once: true, maxItems: 1 });

    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'startup-refresh', 'first-claim', 'startup-dashboard', 'halt-pr-reconcile',
      'parked-reconcile', 'provider-scratch', 'mergeable-sweep', 'repair',
    ]));
    expect(events.every((event) => Number.isFinite(event.durationMs))).toBe(true);
    expect(events.find((event) => event.phase === 'repair')).toMatchObject({ prUrl: 'https://example.test/repair', slug: 'repair' });
    expect(events.find((event) => event.phase === 'parked-reconcile')).toMatchObject({
      outcome: 'skipped-unchanged',
      summary: { reconciled: 1, deferred: 2, orphaned: 3, parked: 4, refused: 5, skipped: 6 },
    });
  });

  it('emits a deferred repair once while a pause holds the queue', async () => {
    const events: Extract<ConductorEvent, { type: 'daemon_maintenance_phase' }>[] = [];
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/held', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '2026-01-01T00:00:00Z', run: async () => ({ kind: 'failed', stage: 'worktree' }) });
    await runDaemon({
      repairs: { queue, run: async () => {} }, isPaused: async () => true,
      discoverBacklog: async () => [], runFeature: async (item) => ({ slug: item.slug, status: 'done' as const }),
      emitMaintenancePhase: async (event) => { events.push(event); },
    }, { concurrency: 1, once: true });
    expect(events.filter((event) => event.phase === 'repair' && event.outcome === 'deferred')).toHaveLength(1);
  });
});
