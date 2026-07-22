// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Conductor test suite determinism under parallel
// forks" (#573).
//
// Stories: .docs/stories/conductor-suite-fork-determinism.md — Story 1
// (BuildProgressWatcher exposes an injectable clock) + Story 2 (timer/
// heartbeat/quiet tests are deterministic under fork load), covered together
// because Story 2's acceptance criterion ("each asserted emit count is
// produced only by awaited ticks, driven by the injected clock — never by
// fake-timer flushing settling real fs/git I/O") is only observable as a
// multi-tick flow: construct with an injected clock, advance that clock,
// await tick() directly, and assert the emission is a pure function of the
// injected value — not of real wall-clock time elapsed during the test run.
// A single-tick/single-operation test cannot distinguish "reads the injected
// clock" from "reads Date.now() and got lucky" — the seam is only provable
// across 2+ ticks with a controlled delta, so per writing-system-tests §3a
// this belongs here, not in the lower unit layer.
//
// Per §3a, Story 3 (rate-limit / spy tests) is NOT covered here: reading
// test/engine/conductor.test.ts's `rate-limit handling` describe block (line
// ~7485) shows it already asserts on the injected `sleepFn` spy and the
// emitted `rate_limit` event after `await conductor.run()`, never on
// wall-clock timing — already-tested, no acceptance spec needed.
//
// NONE of this feature's production code exists yet: `BuildProgressWatcher`
// has no `now` option on `BuildProgressWatcherOptions`, and every internal
// time read is a direct `Date.now()` call (src/engine/build-progress-watcher.ts
// lines ~304/325/326/368/374). These specs construct the watcher with an
// injected `now: () => clock` and advance ONLY that in-memory value (no real
// timers, no `vi.advanceTimersByTimeAsync`) between two directly-awaited
// `tick()` calls. Today the injected value is silently ignored, so the
// watcher's real internal clock never crosses the heartbeat/quiet threshold
// during the test's near-zero real wall-clock runtime — the assertions below
// fail with an observed count of 0, not a crash or missing-symbol error. That
// is the correct RED for a seam that doesn't exist yet (Story 1's happy path
// under "test seam"): the failure is on the OBSERVABLE OUTCOME (no emission),
// exactly the shape TDD's Task 1 (add the `now` option and route every
// internal Date.now() read through it) makes pass.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BuildProgressWatcher } from '../../src/engine/build-progress-watcher.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/index.js';

describe('BuildProgressWatcher clock-seam determinism (Story 1 + Story 2)', () => {
  let dir: string;
  let emitter: ConductorEventEmitter;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-progress-watcher-clock-seam-'));
    emitter = new ConductorEventEmitter();
    emitSpy = vi.spyOn(emitter, 'emit');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeTasks(resolved: number, total: number): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    const tasks = Array.from({ length: total }, (_, i) => ({
      id: String(i + 1),
      status: i < resolved ? 'completed' : 'pending',
    }));
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  }

  function eventsOfType<T extends ConductorEvent['type']>(
    type: T
  ): Extract<ConductorEvent, { type: T }>[] {
    return emitSpy.mock.calls
      .map((call) => call[0] as ConductorEvent)
      .filter((e): e is Extract<ConductorEvent, { type: T }> => e.type === type);
  }

  // Casts to the private tick(), matching the project's existing convention
  // in test/build-progress-watcher.test.ts (tick() is intentionally not
  // public — tests reach it via a narrow structural cast, never by widening
  // the class's public surface for tests).
  function tick(watcher: BuildProgressWatcher): Promise<void> {
    return (watcher as unknown as { tick(): Promise<void> }).tick();
  }

  it('re-emits the heartbeat as a pure function of the injected clock — never of real elapsed wall-clock time', async () => {
    await writeTasks(5, 21);

    let clock = 0;
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'clock-seam-heartbeat',
      config: { build_progress: { heartbeat_minutes: 5 } },
      // @ts-expect-error — `now` does not exist on BuildProgressWatcherOptions
      // yet (Story 1, Task 1). This is the seam under test.
      now: () => clock,
    });

    // Baseline tick — establishes lastEmitAt at the injected clock's t=0.
    await tick(watcher);
    emitSpy.mockClear();

    // Advance ONLY the injected clock past the 5-minute heartbeat threshold.
    // No real time passes, no fake timers, no vi.advanceTimersByTimeAsync —
    // the emission must be driven purely by this awaited-tick + injected-
    // clock sequence (Story 2's happy path).
    clock += 5 * 60 * 1000 + 1000;
    await tick(watcher);
    watcher.stop();

    const heartbeats = eventsOfType('build_progress');
    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0].resolved).toBe(5);
    expect(heartbeats[0].total).toBe(21);
  });

  it('fires build_no_progress as a pure function of the injected clock crossing quiet_minutes', async () => {
    await writeTasks(3, 10);

    let clock = 0;
    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'clock-seam-quiet',
      config: { build_progress: { quiet_minutes: 15 } },
      // @ts-expect-error — same seam as above (Story 1).
      now: () => clock,
    });

    // Baseline tick — establishes lastChangeAt at the injected clock's t=0.
    await tick(watcher);
    emitSpy.mockClear();

    // Advance ONLY the injected clock past the 15-minute quiet threshold,
    // then tick again with nothing changed in task-status.json.
    clock += 15 * 60 * 1000 + 1000;
    await tick(watcher);
    watcher.stop();

    const quiet = eventsOfType('build_no_progress');
    expect(quiet).toHaveLength(1);
    expect(quiet[0].resolved).toBe(3);
    expect(quiet[0].total).toBe(10);
  });

  it('falls back to Date.now when no clock is injected — production path is unchanged (Story 1 negative path)', async () => {
    await writeTasks(1, 4);

    const watcher = new BuildProgressWatcher({
      projectRoot: dir,
      events: emitter,
      step: 'build',
      featureSlug: 'no-injected-clock',
    });

    // With no `now` option, the very first (baseline) tick must still
    // succeed and read a real, current timestamp — never undefined/NaN. That
    // baseline tick always emits (previous snapshot is null → "changed"), so
    // clear the spy after it, matching this file's other tests and
    // test/build-progress-watcher.test.ts's existing convention. A second
    // tick fired ~10ms later (real time, well under the 5-minute heartbeat
    // default) must then emit NOTHING: if the Date.now fallback ever
    // produced undefined/NaN, `Date.now() - NaN` is NaN and every future
    // elapsed-time comparison degrades unpredictably — tick() must not throw
    // and must leave `lastEmitAt`/`lastChangeAt` as finite numbers.
    await tick(watcher);
    emitSpy.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tick(watcher);
    watcher.stop();

    // This assertion is expected to ALREADY PASS today (no code changed on
    // the production path) — it is a regression guard co-located with the
    // seam tests above so a future change to the `now` default can't
    // silently swap in `undefined`. Included per Story 1's negative path.
    expect(eventsOfType('build_progress')).toHaveLength(0);
    expect(eventsOfType('build_no_progress')).toHaveLength(0);
  });
});
