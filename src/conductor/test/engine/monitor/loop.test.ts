// Covers: task:14, task:16, task:17
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { DeferralKey } from '../../../src/engine/monitor/deferrals.js';
import type { ProjectHalt } from '../../../src/engine/monitor/halt-inventory.js';

type GuidedMonitorLoopDeps = {
  deriveMembership: () => Promise<readonly ProjectHalt[]>;
  launch: (halt: ProjectHalt) => Promise<unknown>;
  offer: (halt: ProjectHalt) => void;
  untilStop?: Promise<void>;
  waitForNextPass?: () => Promise<void>;
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

async function runGuidedMonitorQueue(deps: GuidedMonitorLoopDeps): Promise<{ active: boolean }> {
  const loop = await import('../../../src/engine/monitor/loop.js') as {
    runGuidedMonitorQueue(deps: GuidedMonitorLoopDeps): Promise<{ active: boolean }>;
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
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

describe('Task 17 — staying ready and stopping cleanly', () => {
  it('keeps reporting an empty queue across passes without starting a session, then reports a clean stop', async () => {
    const firstPass = deferred<void>();
    const secondPass = deferred<void>();
    const thirdPass = deferred<void>();
    const stop = deferred<void>();
    const waits = [firstPass.promise, secondPass.promise, thirdPass.promise];
    const deriveMembership = vi.fn(async () => []);
    const launch = vi.fn();
    const report = vi.fn();
    const running = runGuidedMonitorQueue({
      deriveMembership,
      launch,
      offer: vi.fn(),
      report,
      untilStop: stop.promise,
      waitForNextPass: vi.fn(async () => waits.shift() ?? new Promise<void>(() => {})),
    });

    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    firstPass.resolve();
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(2));
    secondPass.resolve();
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(3));
    stop.resolve();
    await running;

    expect({
      passes: deriveMembership.mock.calls.length,
      launches: launch.mock.calls,
      reports: report.mock.calls,
    }).toEqual({
      passes: 3,
      launches: [],
      reports: [
        ['Monitor queue is empty; staying active.'],
        ['Monitor queue is empty; staying active.'],
        ['Monitor queue is empty; staying active.'],
        ['Monitor stopped.'],
      ],
    });
  });

  it('offers a halt discovered after an empty pass without a restart', async () => {
    const later = halt('halted-after-idle');
    const nextPass = deferred<void>();
    const stop = deferred<void>();
    const session = deferred<unknown>();
    let passes = 0;
    const offer = vi.fn();
    const launch = vi.fn((_item: ProjectHalt) => session.promise);

    const running = runGuidedMonitorQueue({
      deriveMembership: async () => {
        passes += 1;
        return passes === 2 ? [later] : [];
      },
      launch,
      offer,
      untilStop: stop.promise,
      waitForNextPass: () => nextPass.promise,
    });
    let stopped = false;
    const completed = running.then(() => {
      stopped = true;
    });

    await vi.waitFor(() => expect(passes).toBe(1));
    nextPass.resolve();
    await vi.waitFor(() => expect(offer).toHaveBeenCalledWith(later));
    stop.resolve();
    try {
      await vi.waitFor(() => expect(stopped).toBe(true));
    } finally {
      session.resolve({ kind: 'exited', exitCode: 0 });
      await completed;
    }

    expect({
      offered: offer.mock.calls.map(([item]) => item.slug),
      launched: launch.mock.calls.map(([item]) => item.slug),
    }).toEqual({
      offered: ['halted-after-idle'],
      launched: ['halted-after-idle'],
    });
  });

  it('stops an open session without deferring or resolving it, then offers its retained halt after restart', async () => {
    const retained = halt('retained-after-interrupt');
    const stop = deferred<void>();
    const session = deferred<unknown>();
    const recordDeferral = vi.fn(async (_key: DeferralKey) => {});
    const writeHaltMarker = vi.fn(async (_item: ProjectHalt, _contents: Uint8Array) => {});
    const report = vi.fn();
    const offer = vi.fn();
    const launch = vi.fn(() => session.promise);

    const running = runGuidedMonitorQueue({
      deriveMembership: async () => [retained],
      launch,
      offer,
      recordDeferral,
      writeHaltMarker,
      report,
      untilStop: stop.promise,
    });
    let stopped = false;
    const completed = running.then(() => {
      stopped = true;
    });

    await vi.waitFor(() => expect(launch).toHaveBeenCalledWith(retained));
    stop.resolve();
    try {
      await vi.waitFor(() => expect(stopped).toBe(true));
    } finally {
      session.resolve({ kind: 'operator-skip' });
      await completed;
    }

    const restartStop = deferred<void>();
    const restartSession = deferred<unknown>();
    const restartOffer = vi.fn();
    const restarted = runGuidedMonitorQueue({
      deriveMembership: async () => [retained],
      launch: () => restartSession.promise,
      offer: restartOffer,
      untilStop: restartStop.promise,
    });
    let restartStopped = false;
    const restartCompleted = restarted.then(() => {
      restartStopped = true;
    });
    await vi.waitFor(() => expect(restartOffer).toHaveBeenCalledWith(retained));
    restartStop.resolve();
    try {
      await vi.waitFor(() => expect(restartStopped).toBe(true));
    } finally {
      restartSession.resolve({ kind: 'exited', exitCode: 0 });
      await restartCompleted;
    }

    expect({
      deferrals: recordDeferral.mock.calls,
      markerWrites: writeHaltMarker.mock.calls,
      reports: report.mock.calls,
      offeredAfterRestart: restartOffer.mock.calls.map(([item]) => item.slug),
    }).toEqual({
      deferrals: [],
      markerWrites: [],
      reports: [['Monitor stopped.']],
      offeredAfterRestart: ['retained-after-interrupt'],
    });
  });

  it('stops cleanly from an idle queue before it opens a session', async () => {
    const stop = deferred<void>();
    const report = vi.fn();
    const deriveMembership = vi.fn(async () => []);
    const launch = vi.fn();
    const offer = vi.fn();
    stop.resolve();

    await runGuidedMonitorQueue({
      deriveMembership,
      launch,
      offer,
      report,
      untilStop: stop.promise,
    });

    expect({
      membershipCalls: deriveMembership.mock.calls,
      launches: launch.mock.calls,
      offers: offer.mock.calls,
      reports: report.mock.calls,
    }).toEqual({
      membershipCalls: [],
      launches: [],
      offers: [],
      reports: [['Monitor stopped.']],
    });
  });

  it('offers initial work and remains active until interrupted', async () => {
    const initial = halt('initial-work');
    const stop = deferred<void>();
    const session = deferred<unknown>();
    const offer = vi.fn();
    let settled = false;
    const running = runGuidedMonitorQueue({
      deriveMembership: async () => [initial],
      launch: () => session.promise,
      offer,
      untilStop: stop.promise,
    }).then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(offer).toHaveBeenCalledWith(initial));
    expect(settled).toBe(false);
    stop.resolve();
    try {
      await vi.waitFor(() => expect(settled).toBe(true));
    } finally {
      session.resolve({ kind: 'exited', exitCode: 0 });
      await running;
    }
  });
});
