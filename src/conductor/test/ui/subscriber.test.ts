import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { TerminalSubscriber } from '../../src/ui/subscriber.js';
import type { ConductorEvent } from '../../src/types/index.js';

describe('TerminalSubscriber', () => {
  let emitter: ConductorEventEmitter;
  let renderCallback: ReturnType<typeof vi.fn>;
  let subscriber: TerminalSubscriber;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new ConductorEventEmitter();
    renderCallback = vi.fn();
    subscriber = new TerminalSubscriber(emitter, renderCallback);
  });

  afterEach(() => {
    subscriber.stop();
    vi.useRealTimers();
  });

  it('subscribes to events on start()', () => {
    subscriber.start();

    const event: ConductorEvent = { type: 'step_started', step: 'brainstorm', index: 2 };
    emitter.emit(event);

    expect(renderCallback).toHaveBeenCalledOnce();
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('unsubscribes on stop()', () => {
    subscriber.start();
    subscriber.stop();

    emitter.emit({ type: 'step_started', step: 'brainstorm', index: 2 });

    expect(renderCallback).not.toHaveBeenCalled();
  });

  it('triggers dashboard render on step events', () => {
    subscriber.start();

    emitter.emit({ type: 'step_started', step: 'worktree', index: 0 });
    emitter.emit({ type: 'step_completed', step: 'worktree', status: 'done' });
    emitter.emit({ type: 'step_failed', step: 'build', error: 'test fail', retryCount: 1 });

    expect(renderCallback).toHaveBeenCalledTimes(3);
  });

  it('periodic refresh emits dashboard_refresh every 10s', () => {
    subscriber.start();

    vi.advanceTimersByTime(10_000);
    // The interval emits dashboard_refresh, which triggers the render callback
    expect(renderCallback).toHaveBeenCalledWith({ type: 'dashboard_refresh' });

    vi.advanceTimersByTime(10_000);
    // Two refreshes now
    const refreshCalls = renderCallback.mock.calls.filter(
      (call) => (call[0] as ConductorEvent).type === 'dashboard_refresh',
    );
    expect(refreshCalls.length).toBe(2);
  });

  it('clears refresh interval on stop', () => {
    subscriber.start();
    subscriber.stop();

    vi.advanceTimersByTime(30_000);

    expect(renderCallback).not.toHaveBeenCalled();
  });
});
