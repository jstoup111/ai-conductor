import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for RateLimitEpisode coordinator (Task 1).
// Happy path 1: enter/active window tracks an active episode.
//
// Story: "RateLimitEpisode coordinator tracks an active episode"
// Files: src/conductor/src/engine/rate-limit-episode.ts (to be created)
//
// Spec: enter(untilMs) sets an episode deadline; active(now) returns true
// before that deadline and false at or after it.
// ─────────────────────────────────────────────────────────────────────────────

const MOD_PATH = '../src/engine/rate-limit-episode.js';

async function load(): Promise<Record<string, unknown>> {
  return (await import(MOD_PATH)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

describe('rate-limit-episode', () => {
  it('create() returns an episode coordinator', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const episode = create();
    expect(episode).toBeDefined();
  });

  it('enter(untilMs) and active(now) track an active episode deadline — returns true before, false at/after', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    // Fixed timeline for testing
    const baseTime = 1000;
    const episode = create({ now: () => baseTime });

    const deadline = baseTime + 5000; // 5 seconds from base

    // Enter the episode with the deadline
    episode.enter(deadline);

    // Before deadline: should be active
    expect(episode.active(baseTime)).toBe(true);
    expect(episode.active(baseTime + 2500)).toBe(true);
    expect(episode.active(deadline - 1)).toBe(true);

    // At deadline: should NOT be active
    expect(episode.active(deadline)).toBe(false);

    // After deadline: should NOT be active
    expect(episode.active(deadline + 1)).toBe(false);
    expect(episode.active(deadline + 5000)).toBe(false);
  });

  it('active(now) returns false when no episode has been entered', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const episode = create({ now: () => 1000 });

    // Without calling enter(), active() should return false
    expect(episode.active(1000)).toBe(false);
    expect(episode.active(999999999)).toBe(false);
  });

  it('clear() exits the episode, so active(now) returns false again', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const episode = create({ now: () => baseTime });
    const deadline = baseTime + 5000;

    // Enter an episode
    episode.enter(deadline);
    expect(episode.active(baseTime)).toBe(true);

    // Clear the episode
    episode.clear();

    // Now active should return false
    expect(episode.active(baseTime)).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Task 2: Later-deadline-wins + guards (Infinity, NaN, past deadline)
  // ─────────────────────────────────────────────────────────────────────────────

  it('enter(laterDeadline) extends the deadline when later > existing', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const episode = create({ now: () => baseTime });

    // Enter with first deadline
    const deadline1 = baseTime + 5000; // 6000
    episode.enter(deadline1);
    expect(episode.active(baseTime)).toBe(true);
    expect(episode.active(deadline1 - 1)).toBe(true);
    expect(episode.active(deadline1)).toBe(false);

    // Enter with later deadline — should extend
    const deadline2 = baseTime + 8000; // 9000 (later than 6000)
    episode.enter(deadline2);
    expect(episode.active(deadline1 - 1)).toBe(true); // Still active with old deadline time
    expect(episode.active(deadline1)).toBe(true); // Now active past old deadline
    expect(episode.active(deadline2 - 1)).toBe(true);
    expect(episode.active(deadline2)).toBe(false); // Finally inactive at new deadline
  });

  it('enter(earlierDeadline) does not truncate — earlier ignored', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const episode = create({ now: () => baseTime });

    // Enter with later deadline first
    const deadline1 = baseTime + 8000; // 9000
    episode.enter(deadline1);
    expect(episode.active(baseTime)).toBe(true);

    // Try to enter with earlier deadline — should be ignored
    const deadline2 = baseTime + 3000; // 4000 (earlier than 9000)
    episode.enter(deadline2);

    // Episode should still use the later deadline (9000)
    expect(episode.active(baseTime + 3500)).toBe(true); // Would be inactive at 4000 if deadline2 was active
    expect(episode.active(deadline1 - 1)).toBe(true);
    expect(episode.active(deadline1)).toBe(false);
  });

  it('enter(Infinity) clears the episode (non-finite guard)', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const episode = create({ now: () => baseTime });

    // Enter with valid deadline
    episode.enter(baseTime + 5000);
    expect(episode.active(baseTime)).toBe(true);

    // Enter with Infinity — should clear
    episode.enter(Infinity);
    expect(episode.active(baseTime)).toBe(false);
    expect(episode.active(baseTime + 5000)).toBe(false);
  });

  it('enter(NaN) clears the episode (NaN guard)', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const episode = create({ now: () => baseTime });

    // Enter with valid deadline
    episode.enter(baseTime + 5000);
    expect(episode.active(baseTime)).toBe(true);

    // Enter with NaN — should clear
    episode.enter(NaN);
    expect(episode.active(baseTime)).toBe(false);
    expect(episode.active(baseTime + 5000)).toBe(false);
  });

  it('enter(pastDeadline) clears the episode (past deadline guard)', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const episode = create({ now: () => baseTime });

    // Enter with valid deadline
    episode.enter(baseTime + 5000);
    expect(episode.active(baseTime)).toBe(true);

    // Enter with past deadline — should clear (not throw)
    episode.enter(baseTime - 100); // Deadline in the past
    expect(episode.active(baseTime)).toBe(false);

    // Also test with deadline equal to now
    episode.enter(baseTime + 5000); // Reset to valid
    expect(episode.active(baseTime)).toBe(true);
    episode.enter(baseTime); // Deadline exactly at now
    expect(episode.active(baseTime)).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Task 3: clear() resolves at deadline + abort (RED then GREEN)
  // ─────────────────────────────────────────────────────────────────────────────

  it('clear() returns a promise that resolves when injected timer fires', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const timers: Array<() => void> = [];
    const setTimer = (fn: () => void, delayMs: number) => {
      timers.push(fn);
      return { cancel: () => timers.splice(timers.indexOf(fn), 1) };
    };

    const episode = create({ now: () => baseTime, setTimer });
    const deadline = baseTime + 5000;
    episode.enter(deadline);

    // clear() should return a promise
    const clearPromise = episode.clear();
    expect(clearPromise).toBeDefined();
    expect(clearPromise instanceof Promise).toBe(true);

    // Timer should be armed
    expect(timers.length).toBe(1);

    // Simulate timer fire
    timers[0]();
    await clearPromise;
    // Should resolve without error
    expect(true).toBe(true);
  });

  it('clear() arms timer with (deadline - now) delay', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    let capturedDelay = -1;
    const setTimer = (fn: () => void, delayMs: number) => {
      capturedDelay = delayMs;
      return { cancel: () => {} };
    };

    const episode = create({ now: () => baseTime, setTimer });
    const deadline = baseTime + 3000; // 4000
    episode.enter(deadline);

    episode.clear();
    expect(capturedDelay).toBe(3000); // 4000 - 1000
  });

  it('clear(signal) with pre-aborted signal settles promptly', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    let timerArmed = false;
    const setTimer = (fn: () => void, delayMs: number) => {
      timerArmed = true;
      return { cancel: () => {} };
    };

    const episode = create({ now: () => baseTime, setTimer });
    episode.enter(baseTime + 5000);

    // Pre-aborted signal
    const controller = new AbortController();
    controller.abort();

    const clearPromise = episode.clear(controller.signal);
    await clearPromise;

    // Should settle quickly without hanging
    expect(clearPromise).toBeDefined();
  });

  it('clear(signal) with mid-episode abort settles promptly', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const timers: Array<() => void> = [];
    const setTimer = (fn: () => void, delayMs: number) => {
      timers.push(fn);
      return { cancel: () => timers.splice(timers.indexOf(fn), 1) };
    };

    const episode = create({ now: () => baseTime, setTimer });
    const deadline = baseTime + 5000;
    episode.enter(deadline);

    const controller = new AbortController();
    const clearPromise = episode.clear(controller.signal);

    // Timer should be armed
    expect(timers.length).toBe(1);

    // Abort before timer fires
    controller.abort();
    await clearPromise;

    // Promise should resolve after abort
    expect(true).toBe(true);
  });

  it('after clear() resolves, no pending timer remains', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const timers: Array<() => void> = [];
    const setTimer = (fn: () => void, delayMs: number) => {
      timers.push(fn);
      return { cancel: () => timers.splice(timers.indexOf(fn), 1) };
    };

    const episode = create({ now: () => baseTime, setTimer });
    const deadline = baseTime + 5000;
    episode.enter(deadline);

    const clearPromise = episode.clear();
    expect(timers.length).toBe(1);

    // Fire timer
    timers[0]();
    await clearPromise;

    // Timer should be cleaned up
    expect(timers.length).toBe(0);
  });

  it('clear() with delay <= 0 resolves immediately', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const baseTime = 1000;
    const deadline = baseTime + 100; // Only 100ms
    let timerArmed = false;
    const setTimer = (fn: () => void, delayMs: number) => {
      timerArmed = true;
      return { cancel: () => {} };
    };

    const episode = create({ now: () => baseTime, setTimer });
    episode.enter(deadline);

    // Move time forward past deadline
    const futureEpisode = create({ now: () => baseTime + 200, setTimer });
    futureEpisode.enter(deadline);

    const clearPromise = futureEpisode.clear();
    await clearPromise;

    // Should resolve without arming timer since delay <= 0
    // This is implicit in the test passing without hanging
    expect(clearPromise).toBeDefined();
  });
});
