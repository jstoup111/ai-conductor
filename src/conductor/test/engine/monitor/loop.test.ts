// Covers: task:14
import { describe, expect, it, vi } from 'vitest';

import type { ProjectHalt } from '../../../src/engine/monitor/halt-inventory.js';

type GuidedMonitorLoopDeps = {
  deriveMembership: () => Promise<readonly ProjectHalt[]>;
  launch: (halt: ProjectHalt) => Promise<unknown>;
  offer: (halt: ProjectHalt) => void;
  report?: (message: string) => void;
};

async function advanceAfterGuidedSession(deps: GuidedMonitorLoopDeps): Promise<void> {
  const loop = await import('../../../src/engine/monitor/loop.js') as {
    advanceAfterGuidedSession(deps: GuidedMonitorLoopDeps): Promise<void>;
  };
  await loop.advanceAfterGuidedSession(deps);
}

async function runGuidedMonitorQueue(deps: GuidedMonitorLoopDeps): Promise<{ active: true }> {
  const loop = await import('../../../src/engine/monitor/loop.js') as {
    runGuidedMonitorQueue(deps: GuidedMonitorLoopDeps): Promise<{ active: true }>;
  };
  return loop.runGuidedMonitorQueue(deps);
}

function halt(slug: string): ProjectHalt {
  return {
    project: '/projects/alpha',
    projectName: 'alpha',
    slug,
    reason: `${slug} needs recovery`,
    haltClass: 'needs-human',
  };
}

describe('Task 14 — returning to the monitor queue', () => {
  it('recomputes membership after a completed session and offers the next remaining item', async () => {
    const completed = halt('completed-session');
    const next = halt('next-session');
    let currentMembership: readonly ProjectHalt[] = [completed, next];
    const deriveMembership = vi.fn(async () => currentMembership);
    const launch = vi.fn(async (item: ProjectHalt) => {
      expect(item).toEqual(completed);
      currentMembership = [next];
    });
    const offer = vi.fn();

    await advanceAfterGuidedSession({ deriveMembership, launch, offer });

    expect(deriveMembership).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(offer.mock.calls).toEqual([[completed], [next]]);
  });

  it('advances after zero, non-zero, and signal-like session outcomes without restarting', async () => {
    const items = [halt('zero'), halt('non-zero'), halt('signal')];
    let currentMembership: readonly ProjectHalt[] = items;
    const outcomes = [
      { kind: 'exited', exitCode: 0 },
      { kind: 'exited', exitCode: 1 },
      { kind: 'signaled', signal: 'SIGTERM' },
    ];
    const launch = vi.fn(async (item: ProjectHalt) => {
      currentMembership = currentMembership.filter((halt) => halt.slug !== item.slug);
      return outcomes.shift();
    });
    const offer = vi.fn();

    const result = await runGuidedMonitorQueue({
      deriveMembership: async () => currentMembership,
      launch,
      offer,
    });

    expect({
      result,
      launched: launch.mock.calls.map(([item]) => item.slug),
      offered: offer.mock.calls.map(([item]) => item.slug),
    }).toEqual({
      result: { active: true },
      launched: ['zero', 'non-zero', 'signal'],
      offered: ['zero', 'non-zero', 'signal'],
    });
  });

  it('puts an unchanged halt behind remaining work and offers it again on a later rotation', async () => {
    const unchanged = halt('unchanged');
    const remaining = halt('remaining');
    let currentMembership: readonly ProjectHalt[] = [unchanged, remaining];
    const report = vi.fn();
    const launch = vi.fn(async (item: ProjectHalt) => {
      if (item.slug === 'remaining') currentMembership = [unchanged];
      if (launch.mock.calls.length === 3) currentMembership = [];
    });
    const offer = vi.fn();

    await runGuidedMonitorQueue({
      deriveMembership: async () => currentMembership,
      launch,
      offer,
      report,
    });

    expect({
      offered: offer.mock.calls.map(([item]) => item.slug),
      emptyReport: report.mock.calls,
    }).toEqual({
      offered: ['unchanged', 'remaining', 'unchanged'],
      emptyReport: [['Monitor queue is empty; staying active.']],
    });
  });
});
