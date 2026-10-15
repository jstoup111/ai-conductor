// Covers: task:14, task:15, task:16, task:19
import { describe, expect, it, vi } from 'vitest';
import { runDaemon, type FeatureOutcome } from '../../src/engine/daemon.js';
import { RepairQueue } from '../../src/engine/repair-queue.js';
import { InMemoryWorkClaims } from '../../src/engine/work-claims.js';

const done = (slug: string): FeatureOutcome => ({ slug, status: 'done' });

describe('daemon pooled repairs', () => {
  it('claims repairs before features and releases their reserved pool key', async () => {
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/2', slug: 'p2', prCreatedAt: '2026-01-02T00:00:00Z', queuedAt: '2026-01-03T00:00:00Z' });
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/0', slug: 'p0', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '2026-01-03T00:00:00Z' });
    const claims = new InMemoryWorkClaims();
    const repairs: string[] = [];
    const features: string[] = [];

    await runDaemon({
      claims,
      repairQueue: queue,
      repairPriority: (slug) => slug === 'p0' ? 'P0' : 'P2',
      runRepair: async (request) => {
        repairs.push(request.prUrl);
        expect(claims.list()).toContain(`repair:${request.prUrl}`);
      },
      discoverBacklog: async () => [{ slug: 'feature' }],
      runFeature: async (item) => { features.push(item.slug); return done(item.slug); },
    }, { concurrency: 1, once: true, maxItems: 1 });

    expect(repairs).toEqual(['https://example.test/0', 'https://example.test/2']);
    expect(features).toEqual(['feature']);
    expect(claims.list()).toEqual([]);
  });

  it('does not claim queued repairs while paused or rate limited', async () => {
    const queue = new RepairQueue();
    queue.enqueue({ kind: 'ci-fix', prUrl: 'https://example.test/1', slug: 'one', prCreatedAt: '2026-01-01T00:00:00Z', queuedAt: '2026-01-01T00:00:00Z' });
    const runRepair = vi.fn(async () => {});
    await runDaemon({
      repairQueue: queue, runRepair, isPaused: async () => true,
      discoverBacklog: async () => [], runFeature: async (item) => done(item.slug),
    }, { concurrency: 1, once: true });
    expect(runRepair).not.toHaveBeenCalled();
    expect(queue.list()).toHaveLength(1);
  });
});
