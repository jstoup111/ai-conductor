import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { TerminalSubscriber } from '../../src/ui/subscriber.js';
import type { ConductorEvent } from '../../src/types/index.js';
import type { UIRenderer } from '../../src/ui/types.js';

describe('TerminalSubscriber', () => {
  let emitter: ConductorEventEmitter;
  let renderCallback: ReturnType<typeof vi.fn>;
  let terminalHandle: ReturnType<typeof vi.fn>;
  let subscriber: TerminalSubscriber;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new ConductorEventEmitter();
    renderCallback = vi.fn();
    terminalHandle = vi.fn().mockResolvedValue(undefined);
    const terminalRenderer: UIRenderer = { handle: terminalHandle, stop: vi.fn() };
    subscriber = new TerminalSubscriber(emitter, renderCallback, terminalRenderer);
  });

  afterEach(() => {
    subscriber.stop();
    vi.useRealTimers();
  });

  it('subscribes to events on start()', async () => {
    subscriber.start();

    const event: ConductorEvent = { type: 'step_started', step: 'explore', index: 2 };
    await emitter.emit(event);

    expect(renderCallback).toHaveBeenCalledOnce();
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('unsubscribes on stop()', async () => {
    subscriber.start();
    subscriber.stop();

    await emitter.emit({ type: 'step_started', step: 'explore', index: 2 });

    expect(renderCallback).not.toHaveBeenCalled();
  });

  it('triggers dashboard render on step events', async () => {
    subscriber.start();

    await emitter.emit({ type: 'step_started', step: 'worktree', index: 0 });
    await emitter.emit({ type: 'step_completed', step: 'worktree', status: 'done' });
    await emitter.emit({ type: 'step_failed', step: 'build', error: 'test fail', retryCount: 1 });

    expect(renderCallback).toHaveBeenCalledTimes(3);
  });

  it('does NOT emit periodic dashboard_refresh (renders are event-driven)', () => {
    subscriber.start();

    vi.advanceTimersByTime(60_000);

    // No periodic emissions — dashboard refreshes only when conductor events fire.
    const refreshCalls = renderCallback.mock.calls.filter(
      (call) => (call[0] as ConductorEvent).type === 'dashboard_refresh',
    );
    expect(refreshCalls.length).toBe(0);
  });

  it('still forwards an explicit dashboard_refresh event to the renderer', async () => {
    subscriber.start();
    await emitter.emit({ type: 'dashboard_refresh' });
    expect(renderCallback).toHaveBeenCalledWith({ type: 'dashboard_refresh' });
  });

  it('forwards pipeline closeout events to the renderer', async () => {
    subscriber.start();
    const event: ConductorEvent = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 140,
    };

    await emitter.emit(event);

    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards only containment events to the terminal renderer', async () => {
    subscriber.start();
    const containedDrift: ConductorEvent = {
      type: 'contained_live_checkout_drift',
      evidence: 'bwrap live checkout read-only',
      attribution: 'concurrent-operator',
      summary: 'changed .claude/settings.local.json',
    };
    const containmentVerdict: ConductorEvent = {
      type: 'self_host_containment_verdict',
      contained: true,
      evidence: 'bwrap probe passed',
    };

    await emitter.emit(containedDrift);
    await emitter.emit(containmentVerdict);
    await emitter.emit({ type: 'step_started', step: 'explore', index: 2 });

    expect(terminalHandle.mock.calls.map(([event]) => event)).toEqual([
      containedDrift,
      containmentVerdict,
    ]);
  });
});
