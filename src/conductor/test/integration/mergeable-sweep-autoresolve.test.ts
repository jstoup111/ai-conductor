/**
 * Task 17: Sweep integration — serial, label-pass-first.
 *
 * Story: "Sweep detects a conflicting watched PR and dispatches resolution"
 *
 * Verifies the `autoresolve` DI seam on `sweepMergeableLabels`:
 *   AC1: first eligible CONFLICTING PR gets exactly one dispatch call.
 *   AC2: a second eligible CONFLICTING PR the same tick is deferred (logged,
 *        not dispatched).
 *   AC3: the attempt counter and lastResolveAt are bumped BEFORE dispatch is
 *        called (dispatch observes the already-updated entry).
 *   AC4: when `autoresolve` is entirely absent (disabled config), the sweep's
 *        label behavior and watch registry are byte-identical to today.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { enrollWatch, sweepMergeableLabels } from '../../src/engine/mergeable-sweep.js';
import type { WatchEntry } from '../../src/engine/mergeable-sweep.js';
import type { GhRunner, PrMergeState } from '../../src/engine/pr-labels.js';

function prViewJson(mergeable: string): { stdout: string } {
  return {
    stdout: JSON.stringify({
      state: 'OPEN',
      mergeable,
      statusCheckRollup: [],
      labels: [],
    }),
  };
}

function makeGh(prStates: Record<string, string>): GhRunner {
  return async (args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      const prUrl = args[2] as string;
      return prViewJson(prStates[prUrl] ?? 'MERGEABLE');
    }
    if (args[0] === 'label' && args[1] === 'create') return { stdout: '' };
    if (args[0] === 'api') return { stdout: '' };
    return { stdout: '' };
  };
}

describe('mergeable-sweep autoresolve dispatch (Task 17)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'sweep-autoresolve-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('AC1: dispatches resolution for the first eligible CONFLICTING PR', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const gh = makeGh({ [prUrl]: 'CONFLICTING' });
    const dispatched: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      autoresolve: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (entry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].prUrl).toBe(prUrl);
  });

  it('AC2: defers a second eligible CONFLICTING PR the same tick with a log line', async () => {
    const prUrlA = 'https://github.com/acme/widget/pull/1';
    const prUrlB = 'https://github.com/acme/widget/pull/2';
    await enrollWatch(projectRoot, { prUrl: prUrlA, slug: 'widget-a', repoCwd: projectRoot });
    await enrollWatch(projectRoot, { prUrl: prUrlB, slug: 'widget-b', repoCwd: projectRoot });

    const gh = makeGh({ [prUrlA]: 'CONFLICTING', [prUrlB]: 'CONFLICTING' });
    const dispatched: WatchEntry[] = [];
    const logs: string[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      log: (msg) => logs.push(msg),
      autoresolve: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (entry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(1);
    expect(logs.some((l) => l.includes('in-flight'))).toBe(true);
  });

  it('AC3: bumps attempt counter and sets lastResolveAt BEFORE dispatch is called', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const gh = makeGh({ [prUrl]: 'CONFLICTING' });
    let observedAtDispatch: WatchEntry | undefined;

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      autoresolve: {
        enabled: true,
        isEligible: async () => ({ eligible: true }),
        dispatch: async (entry) => {
          // Captured here so the assertion proves the counter/timestamp were
          // already applied before any "git work" (this callback) began.
          observedAtDispatch = { ...entry };
        },
      },
    });

    expect(observedAtDispatch?.resolveAttempts).toBe(1);
    expect(observedAtDispatch?.lastResolveAt).toBeDefined();

    // And the bump is persisted to the registry (not just the callback's copy).
    const raw = await readFile(join(projectRoot, '.daemon/mergeable-watch.jsonl'), 'utf-8');
    const persisted = JSON.parse(raw.trim());
    expect(persisted.resolveAttempts).toBe(1);
    expect(persisted.lastResolveAt).toBeDefined();
  });

  it('AC4: with autoresolve absent (disabled config), sweep is unchanged — no dispatch, no attempt bump', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const gh = makeGh({ [prUrl]: 'CONFLICTING' });

    await sweepMergeableLabels({ projectRoot, runGh: gh });

    const raw = await readFile(join(projectRoot, '.daemon/mergeable-watch.jsonl'), 'utf-8');
    const persisted = JSON.parse(raw.trim());
    expect(persisted.resolveAttempts).toBe(0);
    expect(persisted.lastResolveAt).toBeUndefined();
  });

  it('does not dispatch when the candidate is ineligible', async () => {
    const prUrl = 'https://github.com/acme/widget/pull/1';
    await enrollWatch(projectRoot, { prUrl, slug: 'widget', repoCwd: projectRoot });

    const gh = makeGh({ [prUrl]: 'CONFLICTING' });
    const dispatched: WatchEntry[] = [];

    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      autoresolve: {
        enabled: true,
        isEligible: async () => ({ eligible: false, reason: 'cooldown not elapsed' }),
        dispatch: async (entry) => {
          dispatched.push(entry);
        },
      },
    });

    expect(dispatched).toHaveLength(0);
  });

  // ── FR-15 Regression Tests ─────────────────────────────────────────────────
  // Verify counter reset on successful refresh and preservation on escalation.

  it('should reset resolveAttempts on successful refresh', async () => {
    // Setup: two conflicting PRs with different attempt counts.
    const prUrlA = 'https://github.com/acme/widget/pull/1';
    const prUrlB = 'https://github.com/acme/widget/pull/2';

    // Entry A: already has 2 resolve attempts
    await enrollWatch(projectRoot, {
      prUrl: prUrlA,
      slug: 'widget-a',
      repoCwd: projectRoot,
      resolveAttempts: 2,
      lastResolveAt: '2026-07-05T10:00:00Z',
    });

    // Entry B: has 1 attempt (to verify single-element clobber guard)
    await enrollWatch(projectRoot, {
      prUrl: prUrlB,
      slug: 'widget-b',
      repoCwd: projectRoot,
      resolveAttempts: 1,
      lastResolveAt: '2026-07-05T09:00:00Z',
    });

    const gh = makeGh({ [prUrlA]: 'CONFLICTING', [prUrlB]: 'CONFLICTING' });

    // Dispatch with 'refreshed' outcome → counter should reset to 0
    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      autoresolve: {
        enabled: true,
        isEligible: async (entry) => {
          // Only Entry A is eligible (dispatch happens once per tick)
          return { eligible: entry.prUrl === prUrlA };
        },
        dispatch: async () => {
          // Simulate successful refresh
          return { kind: 'refreshed' };
        },
      },
    });

    // Read persisted registry
    const raw = await readFile(join(projectRoot, '.daemon/mergeable-watch.jsonl'), 'utf-8');
    const entries = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    // Find entries by prUrl
    const persistedA = entries.find((e) => e.prUrl === prUrlA);
    const persistedB = entries.find((e) => e.prUrl === prUrlB);

    // Assertions
    expect(persistedA).toBeDefined();
    expect(persistedA?.resolveAttempts).toBe(0); // Reset by 'refreshed' outcome
    expect(persistedA?.lastResolveAt).toBeDefined(); // Timestamp still set

    expect(persistedB).toBeDefined();
    expect(persistedB?.resolveAttempts).toBe(1); // Unchanged (not dispatched)
  });

  it('should preserve resolveAttempts on escalated outcome', async () => {
    // Setup: same as above
    const prUrlA = 'https://github.com/acme/widget/pull/1';
    const prUrlB = 'https://github.com/acme/widget/pull/2';

    await enrollWatch(projectRoot, {
      prUrl: prUrlA,
      slug: 'widget-a',
      repoCwd: projectRoot,
      resolveAttempts: 2,
      lastResolveAt: '2026-07-05T10:00:00Z',
    });

    await enrollWatch(projectRoot, {
      prUrl: prUrlB,
      slug: 'widget-b',
      repoCwd: projectRoot,
      resolveAttempts: 1,
      lastResolveAt: '2026-07-05T09:00:00Z',
    });

    const gh = makeGh({ [prUrlA]: 'CONFLICTING', [prUrlB]: 'CONFLICTING' });

    // Dispatch with 'escalated' outcome → counter should NOT reset
    await sweepMergeableLabels({
      projectRoot,
      runGh: gh,
      autoresolve: {
        enabled: true,
        isEligible: async (entry) => {
          return { eligible: entry.prUrl === prUrlA };
        },
        dispatch: async () => {
          // Simulate escalated failure
          return { kind: 'escalated' };
        },
      },
    });

    // Read persisted registry
    const raw = await readFile(join(projectRoot, '.daemon/mergeable-watch.jsonl'), 'utf-8');
    const entries = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    const persistedA = entries.find((e) => e.prUrl === prUrlA);
    const persistedB = entries.find((e) => e.prUrl === prUrlB);

    // Assertions
    expect(persistedA).toBeDefined();
    expect(persistedA?.resolveAttempts).toBe(3); // Bumped from 2 to 3, NOT reset
    expect(persistedA?.lastResolveAt).toBeDefined(); // Timestamp updated

    expect(persistedB).toBeDefined();
    expect(persistedB?.resolveAttempts).toBe(1); // Unchanged
  });
});
