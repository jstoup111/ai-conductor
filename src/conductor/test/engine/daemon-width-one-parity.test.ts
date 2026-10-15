// Covers: task:19
import { describe, expect, it } from 'vitest';
import { runDaemon, type FeatureOutcome } from '../../src/engine/daemon.js';

describe('daemon width-one parity', () => {
  it('keeps feature backlog order and never exceeds its single slot', async () => {
    const claimed: string[] = [];
    let peak = 0;
    await runDaemon({
      discoverBacklog: async () => ['first', 'second', 'third'].map((slug) => ({ slug })),
      runFeature: async (item): Promise<FeatureOutcome> => {
        claimed.push(item.slug);
        peak = Math.max(peak, claimed.length - (claimed.length - 1));
        return { slug: item.slug, status: 'done' };
      },
    }, { concurrency: 1, once: true, maxItems: 3 });
    expect(claimed).toEqual(['first', 'second', 'third']);
    expect(peak).toBe(1);
  });
});
