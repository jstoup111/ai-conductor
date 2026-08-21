import { describe, expect, it, vi } from 'vitest';

import {
  createProviderStreamThrottle,
  DefaultStepRunner,
  DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS,
  resolveProviderStreamMinIntervalMs,
} from '../src/engine/step-runners.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { validateConfig } from '../src/engine/config.js';
import type { ProviderExecutionResult } from '../src/engine/provider-execution.js';
import type { InvokeOptions, ProviderStreamObservation } from '../src/execution/llm-provider.js';
import type { StepName } from '../src/types/index.js';

const providerResult = (output = 'done'): ProviderExecutionResult => ({
  success: true, output, exitCode: 0, preferredProvider: 'codex', attempts: [],
});

function dispatchWithProviderStream(
  events: ConductorEventEmitter,
  run: (options: Pick<InvokeOptions, 'onProviderStream'>) => Promise<ProviderExecutionResult>,
): Promise<ProviderExecutionResult> {
  const runner = new DefaultStepRunner({
    invoke: vi.fn(),
    invokeInteractive: vi.fn(),
  }, 'stream-test', '/tmp/provider-stream-throttle', { events, configuredProviders: ['codex'] });
  const dispatch = (runner as unknown as {
    dispatchProviderWithLifecycleSupervision: (
      step: StepName,
      options: { prompt: string; cwd: string },
        invoke: (options: Pick<InvokeOptions, 'onProviderStream' | 'providerStreamObserverForCandidate'>) => Promise<ProviderExecutionResult>,
    ) => Promise<ProviderExecutionResult>;
  }).dispatchProviderWithLifecycleSupervision.bind(runner);
  return dispatch('build', { prompt: 'test', cwd: '/tmp/provider-stream-throttle' }, async (options) => {
    const observer = options.providerStreamObserverForCandidate?.('codex');
    try {
      return await run({ onProviderStream: observer?.onProviderStream });
    } finally {
      observer?.close();
    }
  });
}

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

  it('loads a valid provider_stream block, defaults non-positive values, and rejects unknown keys', () => {
    const valid = validateConfig({ provider_stream: { min_interval_ms: 250 } });
    expect(valid).toMatchObject({ ok: true, config: { provider_stream: { min_interval_ms: 250 } } });

    for (const min_interval_ms of [0, -1]) {
      expect(validateConfig({ provider_stream: { min_interval_ms } })).toMatchObject({
        ok: true,
        config: { provider_stream: { min_interval_ms: DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS } },
      });
    }
    expect(validateConfig({ provider_stream: { unexpected: true } })).toMatchObject({
      ok: false,
      error: { message: 'Unknown key in provider_stream: "unexpected"' },
    });
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

  it('re-emits a quiet stream on the dispatch-owned heartbeat and stops the timer on close', async () => {
    vi.useFakeTimers();
    const events = new ConductorEventEmitter();
    const emitted: unknown[] = [];
    events.on('provider_stream_progress', (event) => { emitted.push(event); });
    let resolveRun: ((result: ProviderExecutionResult) => void) | undefined;
    try {
      const completion = dispatchWithProviderStream(events, async (options) => {
        options.onProviderStream?.({ childObservability: 'unsupported', uncachedInputTokens: 1, outputTokens: 2 });
        return new Promise<ProviderExecutionResult>((resolve) => { resolveRun = resolve; });
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS);
      expect(emitted).toHaveLength(2);

      resolveRun!(providerResult());
      await expect(completion).resolves.toMatchObject({ success: true, output: 'done' });
      await vi.advanceTimersByTimeAsync(DEFAULT_PROVIDER_STREAM_MIN_INTERVAL_MS * 2);
      expect(emitted).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes one suppressed final observation at dispatch close without changing provider completion', async () => {
    const events = new ConductorEventEmitter();
    const emitted: unknown[] = [];
    events.on('provider_stream_progress', (event) => { emitted.push(event); });

    await expect(dispatchWithProviderStream(events, async (options) => {
      options.onProviderStream?.({ childObservability: 'observed', activeChildren: 0, uncachedInputTokens: 1, outputTokens: 2 });
      options.onProviderStream?.({ childObservability: 'observed', activeChildren: 1, uncachedInputTokens: 1, outputTokens: 2 });
      return providerResult('provider result');
    })).resolves.toMatchObject({ success: true, output: 'provider result' });

    expect(emitted).toHaveLength(2);
    expect(emitted.at(-1)).toMatchObject({ activeChildren: 1 });
  });

  it('emits nothing for a dispatch with no provider observation', async () => {
    const events = new ConductorEventEmitter();
    const emitted = vi.fn();
    events.on('provider_stream_progress', emitted);

    await dispatchWithProviderStream(events, async () => providerResult());

    expect(emitted).not.toHaveBeenCalled();
  });

  it('preserves the provider result when the final telemetry flush fails', async () => {
    const events = new ConductorEventEmitter();
    const runner = new DefaultStepRunner({ invoke: vi.fn(), invokeInteractive: vi.fn() }, 'flush-failure', '/tmp/provider-stream-throttle', {
      events,
      configuredProviders: ['codex'],
    });
    const dispatch = (runner as unknown as {
      dispatchProviderWithLifecycleSupervision: (
        step: StepName,
        options: { prompt: string; cwd: string },
        invoke: (options: Pick<InvokeOptions, 'onProviderStream' | 'providerStreamObserverForCandidate'>) => Promise<ProviderExecutionResult>,
      ) => Promise<ProviderExecutionResult>;
    }).dispatchProviderWithLifecycleSupervision.bind(runner);

    await expect(dispatch('build', { prompt: 'test', cwd: '/tmp/provider-stream-throttle' }, async (options) => {
      options.onProviderStream?.({ childObservability: 'unsupported', uncachedInputTokens: 1, outputTokens: 2 });
      (runner as unknown as { events: { emit: () => void } }).events = {
        emit: () => { throw new Error('telemetry failure'); },
      };
      options.onProviderStream?.({ childObservability: 'unsupported', uncachedInputTokens: 2, outputTokens: 3 });
      return providerResult('provider result');
    })).resolves.toMatchObject({ success: true, output: 'provider result' });
  });
});
