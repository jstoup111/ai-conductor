import { describe, expect, it, vi } from 'vitest';

import {
  createProviderStreamThrottle,
  DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS,
  resolveProviderStreamMinIntervalMs,
} from '../src/engine/step-runners.js';

describe('provider stream dispatch throttle', () => {
  it('admits one of one thousand observations per interval, for each fresh provider attempt', () => {
    const now = vi.fn(() => 1_000);
    const emit = vi.fn();
    const claudeAttempt = createProviderStreamThrottle(emit, { now, minIntervalMs: 100 });
    for (let index = 0; index < 1_000; index += 1) claudeAttempt({ provider: 'claude', total: index });

    const codexAttempt = createProviderStreamThrottle(emit, { now, minIntervalMs: 100 });
    codexAttempt({ provider: 'codex', total: 1 });

    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('uses the documented default for absent, zero, and negative config', () => {
    expect([
      resolveProviderStreamMinIntervalMs(undefined),
      resolveProviderStreamMinIntervalMs({ provider_stream: { min_interval_ms: 0 } }),
      resolveProviderStreamMinIntervalMs({ provider_stream: { min_interval_ms: -1 } }),
    ]).toEqual([DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS, DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS, DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS]);
  });

  it('emits changed observations at the next admissible point and unchanged observations on the slow heartbeat', () => {
    let current = 0;
    const emit = vi.fn();
    const throttle = createProviderStreamThrottle(emit, {
      now: () => current,
      minIntervalMs: 100,
      heartbeatMs: 1_000,
    });

    throttle({ activeChildren: 0 });
    current = 50;
    throttle({ activeChildren: 1 });
    current = 100;
    throttle({ activeChildren: 1 });
    current = 200;
    throttle({ activeChildren: 1 });
    current = 1_100;
    throttle({ activeChildren: 1 });

    expect(emit).toHaveBeenCalledTimes(3);
  });

  it('flushes the final observed state once, including an open child, and skips an empty attempt', () => {
    const emit = vi.fn();
    const throttle = createProviderStreamThrottle(emit, { minIntervalMs: 100, now: () => 0 });
    const emptyAttempt = createProviderStreamThrottle(emit, { minIntervalMs: 100, now: () => 0 });

    throttle({ activeChildren: 0 });
    throttle({ activeChildren: 1 });
    throttle.flush();
    throttle.flush();
    emptyAttempt.flush();

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith({ activeChildren: 1 });
  });

  it('swallows a throwing close-boundary emitter', () => {
    let calls = 0;
    const throttle = createProviderStreamThrottle(() => {
      calls += 1;
      if (calls > 1) throw new Error('emit failed');
    }, { minIntervalMs: 100, now: () => 0 });
    throttle({ activeChildren: 1 });

    expect(() => throttle.flush()).not.toThrow();
  });
});
