// Covers: task:19
import { describe, expect, it, vi } from 'vitest';
import { runDaemon, type FeatureOutcome } from '../../src/engine/daemon.js';
import { RepairQueue } from '../../src/engine/repair-queue.js';
import { InMemoryWorkClaims } from '../../src/engine/work-claims.js';

describe('daemon width-one parity', () => {
  it('keeps feature backlog order and never exceeds its single slot', async () => {
    const claimed: string[] = [];
    await runDaemon({
      discoverBacklog: async () => ['first', 'second', 'third'].map((slug) => ({ slug })),
      runFeature: async (item): Promise<FeatureOutcome> => {
        claimed.push(item.slug);
        return { slug: item.slug, status: 'done' };
      },
    }, { concurrency: 1, once: true, maxItems: 3 });
    expect(claimed).toEqual(['first', 'second', 'third']);
  });

  it('fills the released width-one slot with a queued repair before the next feature', async () => {
    const queue = new RepairQueue();
    const events: string[] = [];
    let peak = 0;
    let claims: SamplingClaims;
    const sampleInFlight = (): void => {
      peak = Math.max(peak, claims.list().length);
    };
    claims = new SamplingClaims(sampleInFlight);

    let resolveRepairStarted!: () => void;
    const repairStarted = new Promise<void>((resolve) => { resolveRepairStarted = resolve; });
    let resolveRepair!: () => void;
    const repairPending = new Promise<void>((resolve) => { resolveRepair = resolve; });
    const runRepair = vi.fn(async () => {
      events.push('repair:start');
      sampleInFlight();
      resolveRepairStarted();
      await repairPending;
      sampleInFlight();
      events.push('repair:finish');
    });

    const daemon = runDaemon({
      claims,
      repairQueue: queue,
      runRepair,
      discoverBacklog: async () => ['first', 'second', 'third'].map((slug) => ({ slug })),
      runFeature: async (item): Promise<FeatureOutcome> => {
        events.push(`feature:start:${item.slug}`);
        sampleInFlight();
        if (item.slug === 'first') {
          queue.enqueue({
            kind: 'ci-fix',
            prUrl: 'https://example.test/repair',
            slug: item.slug,
            prCreatedAt: '2026-10-15T00:00:00Z',
            queuedAt: '2026-10-15T00:00:00Z',
          });
        }
        await Promise.resolve();
        sampleInFlight();
        events.push(`feature:finish:${item.slug}`);
        return { slug: item.slug, status: 'done' };
      },
      reconcileHaltPrs: async () => { sampleInFlight(); },
    }, { concurrency: 1, once: true, maxItems: 3 });

    await repairStarted;
    sampleInFlight();
    resolveRepair();
    await daemon;

    expect(peak).toBe(1);
    expect(runRepair).toHaveBeenCalledOnce();
    expect(events.indexOf('repair:start')).toBeGreaterThan(events.indexOf('feature:finish:first'));
    expect(events.indexOf('repair:start')).toBeLessThan(events.indexOf('feature:start:second'));
    expect(events).toEqual([
      'feature:start:first',
      'feature:finish:first',
      'repair:start',
      'repair:finish',
      'feature:start:second',
      'feature:finish:second',
      'feature:start:third',
      'feature:finish:third',
    ]);
  });
});

class SamplingClaims extends InMemoryWorkClaims {
  constructor(private readonly sample: () => void) {
    super();
  }

  override claim(slug: string): boolean {
    const claimed = super.claim(slug);
    this.sample();
    return claimed;
  }

  override release(slug: string): void {
    super.release(slug);
    this.sample();
  }
}
