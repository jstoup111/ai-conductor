/**
 * Covers: Story 1, Task 1
 *
 * The real daemon pool is bounded with injected backlog, feature, halt, and
 * progress seams. No provider, network, Git, or filesystem boundary is used.
 */
import { describe, expect, it } from 'vitest';

import {
  runDaemon,
  type BacklogItem,
  type DaemonDeps,
  type FeatureOutcome,
} from '../../src/engine/daemon.js';
import type { HaltDisposition } from '../../src/engine/halt-marker.js';

const slug = 'operator-action-halt';

async function runProgressingHalt(opts: {
  readHaltClass?: (slug: string) => Promise<HaltDisposition>;
}): Promise<{ dispatches: number; outcomes: FeatureOutcome[]; logs: string[] }> {
  const halted = new Set<string>();
  const logs: string[] = [];
  let dispatches = 0;

  const deps: DaemonDeps = {
    discoverBacklog: async () => [{ slug } satisfies BacklogItem],
    isHalted: async (candidate: string) => halted.has(candidate),
    isProgressReKickEligible: async () => true,
    progressReKickDispatchCeiling: 2,
    runFeature: async (item: BacklogItem) => {
      dispatches += 1;
      halted.add(item.slug);
      return { slug: item.slug, status: 'halted' };
    },
    log: (line: string) => logs.push(line),
    sleep: async () => {},
    ...(opts.readHaltClass ? { readHaltClass: opts.readHaltClass } : {}),
  };

  const result = await runDaemon(deps, {
    concurrency: 1,
    once: false,
    maxIdlePolls: 4,
    idlePollMs: 0,
  });
  return { dispatches, outcomes: result.processed, logs };
}

describe('progress re-kick refuses operator-action halt classifications', () => {
  it.each([
    ['needs-human', async () => 'needs-human' as HaltDisposition],
    ['an unreadable sidecar', async () => 'unclassified' as HaltDisposition],
    ['a failed classification read', async () => { throw new Error('sidecar unavailable'); }],
  ])('keeps %s halted and logs the blocking disposition once', async (_caseName, readHaltClass) => {
    const result = await runProgressingHalt({ readHaltClass });

    expect(result.dispatches).toBe(1);
    expect(result.outcomes).toHaveLength(1);
    const refusals = result.logs.filter((line) => line.includes(slug) && line.includes('unclassified'));
    if (_caseName === 'needs-human') {
      expect(result.logs.filter((line) => line.includes(slug) && line.includes('needs-human'))).toHaveLength(1);
    } else {
      expect(refusals).toHaveLength(1);
    }
  });

  it.each(['mechanical', 'legacy'] as const)(
    'continues ceiling-bounded progress re-kicks for %s',
    async (disposition) => {
      const result = await runProgressingHalt({ readHaltClass: async () => disposition });

      expect(result.dispatches).toBe(3);
      expect(result.outcomes).toHaveLength(3);
    },
  );

  it('preserves the legacy injected-dependency behavior when no reader is supplied', async () => {
    const result = await runProgressingHalt({});

    expect(result.dispatches).toBe(3);
    expect(result.outcomes).toHaveLength(3);
  });
});
