/**
 * Covers: S6.1, task:12
 * Covers: S7.1, S7.N3, task:14
 *
 * These specs drive the real daemon pool entry point. The backlog, feature
 * executor, stale-engine probe, and restart request are deterministic fakes;
 * no provider, network, GitHub, or package-registry boundary is crossed.
 */
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  runDaemon,
  type BacklogItem,
  type FeatureOutcome,
} from '../../src/engine/daemon.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function yieldDispatcher(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await waitForImmediate();
  }
}

const feature = (slug: string): BacklogItem => ({ slug, track: 'technical' });
const done = (slug: string): FeatureOutcome => ({ slug, status: 'done' });

describe('single-repo daemon concurrency', () => {
  it('refreshes while one executor is busy and dispatches a newly merged feature into the free slot', async () => {
    const alphaStarted = deferred<void>();
    const alphaFinished = deferred<FeatureOutcome>();
    const events: string[] = [];
    let mergedFeatureVisible = false;

    const daemon = runDaemon(
      {
        discoverBacklog: async ({ refresh }) => {
          if (refresh && events.includes('start:alpha')) mergedFeatureVisible = true;
          return mergedFeatureVisible
            ? [feature('alpha'), feature('beta')]
            : [feature('alpha')];
        },
        runFeature: async (item) => {
          events.push(`start:${item.slug}`);
          if (item.slug === 'alpha') {
            alphaStarted.resolve();
            const outcome = await alphaFinished.promise;
            events.push('finish:alpha');
            return outcome;
          }
          events.push(`finish:${item.slug}`);
          return done(item.slug);
        },
        sleep: async () => {},
      },
      { concurrency: 2, once: true, idlePollMs: 0 },
    );

    await alphaStarted.promise;
    await yieldDispatcher();
    alphaFinished.resolve(done('alpha'));
    const result = await daemon;

    expect(result.processed.map((outcome) => outcome.slug).sort()).toEqual(['alpha', 'beta']);
    expect(events.indexOf('start:beta')).toBeLessThan(events.indexOf('finish:alpha'));
  });

  it('enters drain on stale-engine detection, refuses a newly eligible feature, and restarts once after both workers finish', async () => {
    const alphaFinished = deferred<FeatureOutcome>();
    const betaFinished = deferred<FeatureOutcome>();
    const bothStarted = deferred<void>();
    const started: string[] = [];
    const logs: string[] = [];
    let stale = false;
    let gammaEligible = false;

    const requestRestart = vi.fn(async () => ({ fired: true }));
    const daemon = runDaemon(
      {
        discoverBacklog: async () => [
          feature('alpha'),
          feature('beta'),
          ...(gammaEligible ? [feature('gamma')] : []),
        ],
        runFeature: async (item) => {
          started.push(item.slug);
          if (started.includes('alpha') && started.includes('beta')) bothStarted.resolve();
          if (item.slug === 'alpha') return alphaFinished.promise;
          if (item.slug === 'beta') return betaFinished.promise;
          return done(item.slug);
        },
        staleEngineChecker: {
          check: () => (stale ? 'stale' : 'current'),
          capturedIdentity: () => 'engine-old',
          targetIdentity: () => 'engine-new',
        },
        requestRestart,
        log: (line) => logs.push(line),
        sleep: async () => {},
      },
      {
        concurrency: 2,
        once: false,
        maxIdlePolls: 0,
        idlePollMs: 0,
        isSelfHost: true,
        autoRestartOnStaleEngine: true,
      },
    );

    await bothStarted.promise;
    stale = true;
    gammaEligible = true;
    await yieldDispatcher();
    alphaFinished.resolve(done('alpha'));
    await yieldDispatcher();
    betaFinished.resolve(done('beta'));
    const result = await daemon;

    expect(started).toEqual(['alpha', 'beta']);
    expect(result.processed.map((outcome) => outcome.slug).sort()).toEqual(['alpha', 'beta']);
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(logs).toContainEqual(expect.stringMatching(/^\[daemon\].*drain.*stale/i));
  });
});
