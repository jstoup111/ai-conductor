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

    const episode = create();

    // Fixed timeline for testing
    const baseTime = 1000;
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

    const episode = create();

    // Without calling enter(), active() should return false
    expect(episode.active(1000)).toBe(false);
    expect(episode.active(999999999)).toBe(false);
  });

  it('clear() exits the episode, so active(now) returns false again', async () => {
    const mod = await load();
    const create = requireFn(mod, 'create');

    const episode = create();
    const baseTime = 1000;
    const deadline = baseTime + 5000;

    // Enter an episode
    episode.enter(deadline);
    expect(episode.active(baseTime)).toBe(true);

    // Clear the episode
    episode.clear();

    // Now active should return false
    expect(episode.active(baseTime)).toBe(false);
  });
});
