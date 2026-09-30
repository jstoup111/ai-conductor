// Covers: task:14, task:16
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { DeferralKey } from '../../../src/engine/monitor/deferrals.js';
import type { ProjectHalt } from '../../../src/engine/monitor/halt-inventory.js';

type GuidedMonitorLoopDeps = {
  deriveMembership: () => Promise<readonly ProjectHalt[]>;
  launch: (halt: ProjectHalt) => Promise<unknown>;
  offer: (halt: ProjectHalt) => void;
  snapshotHaltMarker?: (halt: ProjectHalt) => Promise<DeferralKey['haltIdentity']>;
  writeHaltMarker?: (halt: ProjectHalt, contents: Uint8Array) => Promise<void>;
  recordDeferral?: (key: DeferralKey) => Promise<void>;
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

describe('Task 15 — deferring a skipped guided session', () => {
  it('persists the skip without changing its marker and keeps it behind unseen work after restart', async () => {
    const skipped = halt('deferred-critical');
    const unseenCritical = halt('unseen-critical');
    const unseenLow = halt('unseen-low');
    const haltMarkerBytes = Buffer.from('needs-human: defer me without resolving me');
    const markerBeforeSkip = Buffer.from(haltMarkerBytes);
    const skippedIdentity = { present: true, mtimeMs: 17, size: haltMarkerBytes.length } as const;
    const durableDeferrals: DeferralKey[] = [];
    let liveHalts: readonly ProjectHalt[] = [skipped, unseenCritical, unseenLow];
    const recordDeferral = vi.fn(async (key: DeferralKey) => {
      durableDeferrals.push(key);
    });
    const deriveMembership = vi.fn(async () => {
      const skippedIsDeferred = durableDeferrals.some((key) =>
        key.project === skipped.project &&
        key.feature === skipped.slug &&
        key.haltIdentity.mtimeMs === skippedIdentity.mtimeMs &&
        key.haltIdentity.size === skippedIdentity.size,
      );
      return skippedIsDeferred
        ? liveHalts.filter((item) => item.slug !== skipped.slug).concat(liveHalts.filter((item) => item.slug === skipped.slug))
        : liveHalts;
    });
    const snapshotHaltMarker = vi.fn(async (item: ProjectHalt) => {
      expect(item).toEqual(skipped);
      return skippedIdentity;
    });
    const writeHaltMarker = vi.fn(async (_item: ProjectHalt, _contents: Uint8Array) => {});
    const firstOffer = vi.fn();

    await advanceAfterGuidedSession({
      deriveMembership,
      launch: async () => ({ kind: 'operator-skip' }),
      offer: firstOffer,
      snapshotHaltMarker,
      writeHaltMarker,
      recordDeferral,
    });

    expect({
      recorded: recordDeferral.mock.calls,
      markerAfterSkip: haltMarkerBytes,
      markerWrites: writeHaltMarker.mock.calls,
      offeredAfterSkip: firstOffer.mock.calls.map(([item]) => item.slug),
    }).toEqual({
      recorded: [[{
        project: skipped.project,
        feature: skipped.slug,
        haltIdentity: skippedIdentity,
      }]],
      markerAfterSkip: markerBeforeSkip,
      markerWrites: [],
      offeredAfterSkip: ['deferred-critical', 'unseen-critical'],
    });

    const restartOffer = vi.fn();
    const restartLaunch = vi.fn(async (item: ProjectHalt) => {
      liveHalts = liveHalts.filter((candidate) => candidate.slug !== item.slug);
      return { kind: 'exited', exitCode: 0 };
    });

    await runGuidedMonitorQueue({
      deriveMembership,
      launch: restartLaunch,
      offer: restartOffer,
      snapshotHaltMarker,
      writeHaltMarker,
      recordDeferral,
    });

    expect({
      launchedAfterRestart: restartLaunch.mock.calls.map(([item]) => item.slug),
      offeredAfterRestart: restartOffer.mock.calls.map(([item]) => item.slug),
      durableDeferrals,
      markerAfterRestart: haltMarkerBytes,
      markerWrites: writeHaltMarker.mock.calls,
    }).toEqual({
      launchedAfterRestart: ['unseen-critical', 'unseen-low', 'deferred-critical'],
      offeredAfterRestart: ['unseen-critical', 'unseen-low', 'deferred-critical'],
      durableDeferrals: [{
        project: skipped.project,
        feature: skipped.slug,
        haltIdentity: skippedIdentity,
      }],
      markerAfterRestart: markerBeforeSkip,
      markerWrites: [],
    });
  });
});

describe('Task 16 — deriving resolution only from halt membership', () => {
  it('re-offers a marker that persists after a zero-exit session claiming resolution with its original context', async () => {
    const persistent = halt('persistent-marker');
    const currentContext = {
      project: persistent.project,
      feature: persistent.slug,
      reason: persistent.reason,
      classification: persistent.haltClass,
    };
    let markerStillPresent = true;
    const offer = vi.fn();
    const launch = vi.fn(async () => {
      if (launch.mock.calls.length === 1) {
        return { kind: 'exited', exitCode: 0, output: 'halt resolved' };
      }
      markerStillPresent = false;
      return { kind: 'exited', exitCode: 0 };
    });

    await runGuidedMonitorQueue({
      deriveMembership: async () => markerStillPresent ? [{ ...persistent }] : [],
      launch,
      offer,
    });

    expect({
      offeredContexts: offer.mock.calls.map(([item]) => ({
        project: item.project,
        feature: item.slug,
        reason: item.reason,
        classification: item.haltClass,
      })),
    }).toEqual({
      offeredContexts: [currentContext, currentContext],
    });
  });

  it('does not parse session output or reports, or write a resolution verdict', async () => {
    const source = await readFile(new URL('../../../src/engine/monitor/loop.ts', import.meta.url), 'utf8');

    expect({
      parsesSessionOutputOrReports: /\b(?:outcome|session)\s*(?:\.|\[)\s*['\"]?(?:output|reports?)\b/i.test(source),
      writesHaltMarkerOrResolutionVerdict: /\b(?:writeHaltMarker|writeFile|rm|unlink)\s*\(|\b(?:record|mark|set)\w*(?:resolution|resolved)\w*\s*\(/i.test(source),
    }).toEqual({
      parsesSessionOutputOrReports: false,
      writesHaltMarkerOrResolutionVerdict: false,
    });
  });
});
