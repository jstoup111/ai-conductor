// Covers: task:2
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StepInFlightTicker } from '../../src/engine/step-in-flight-ticker.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductorEvent } from '../../src/types/events.js';

describe('StepInFlightTicker', () => {
  const startedAtMs = 1_000;
  let nowMs: number;
  let events: ConductorEvent[];
  let emitter: ConductorEventEmitter;

  beforeEach(() => {
    nowMs = startedAtMs;
    events = [];
    emitter = new ConductorEventEmitter();
    emitter.on('step_in_flight', (event) => {
      events.push(event);
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function ticker(
    config: Pick<HarnessConfig, 'build_progress'> = { build_progress: { heartbeat_minutes: 5 } },
  ): StepInFlightTicker {
    return new StepInFlightTicker({
      events: emitter,
      step: 'test_suite',
      startedAtMs,
      featureSlug: 'feature-x',
      config,
      now: () => nowMs,
    });
  }

  it('emits a step_in_flight heartbeat at every configured interval with elapsed time from start', async () => {
    const subject = ticker();
    subject.start();

    nowMs += 5 * 60_000;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    nowMs += 5 * 60_000;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    subject.stop();

    expect(events).toEqual([
      { type: 'step_in_flight', step: 'test_suite', elapsedMs: 5 * 60_000, featureSlug: 'feature-x' },
      { type: 'step_in_flight', step: 'test_suite', elapsedMs: 10 * 60_000, featureSlug: 'feature-x' },
    ]);
  });

  it('emits nothing when stopped before an interval and stops emitting after a heartbeat', async () => {
    const beforeFirstInterval = ticker();
    beforeFirstInterval.start();
    nowMs += 4 * 60_000;
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    beforeFirstInterval.stop();
    nowMs += 20 * 60_000;
    await vi.advanceTimersByTimeAsync(20 * 60_000);

    nowMs = startedAtMs;
    const afterHeartbeat = ticker();
    afterHeartbeat.start();
    nowMs += 5 * 60_000;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    afterHeartbeat.stop();
    nowMs += 20 * 60_000;
    await vi.advanceTimersByTimeAsync(20 * 60_000);

    expect(events).toEqual([
      { type: 'step_in_flight', step: 'test_suite', elapsedMs: 5 * 60_000, featureSlug: 'feature-x' },
    ]);
  });

  it('does not start when disabled and can stop before or after start more than once', async () => {
    const enabled = ticker();
    expect(() => {
      enabled.start();
      enabled.stop();
      enabled.stop();
    }).not.toThrow();

    nowMs += 20 * 60_000;
    await vi.advanceTimersByTimeAsync(20 * 60_000);

    const disabled = ticker({ build_progress: { enabled: false, heartbeat_minutes: 5 } });

    expect(() => {
      disabled.stop();
      disabled.stop();
      disabled.start();
      disabled.stop();
    }).not.toThrow();

    nowMs += 20 * 60_000;
    await vi.advanceTimersByTimeAsync(20 * 60_000);

    expect(events).toEqual([]);
  });
});
