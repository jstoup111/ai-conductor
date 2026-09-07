import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Writable } from 'node:stream';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { UIRenderer } from '../../src/ui/types.js';
import { TerminalSubscriber } from '../../src/ui/subscriber.js';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

class CaptureStream extends Writable {
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: string, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  output(): string {
    return this.chunks.join('');
  }
}

describe('TerminalSubscriber', () => {
  let emitter: ConductorEventEmitter;
  let renderCallback: Mock<(event: ConductorEvent) => void>;
  let subscriber: TerminalSubscriber;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new ConductorEventEmitter();
    renderCallback = vi.fn<(event: ConductorEvent) => void>();
    subscriber = new TerminalSubscriber(emitter, renderCallback);
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

  it('forwards tail diagnostics to the renderer', async () => {
    subscriber.start();
    const event: ConductorEvent = {
      type: 'pipeline_tail_diagnostic', reason: 'malformed-line',
      path: '.pipeline/pipeline-events.jsonl', byteOffset: 42,
    };

    await emitter.emit(event);

    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards satisfied gate verdicts from the event bus to the injected terminal renderer once', async () => {
    const stream = new CaptureStream();
    const terminalRenderer = new TerminalRenderer({
      stateFilePath: '/tmp/test-state.json',
      steps: ALL_STEPS,
      readStateFn: async () => ({ ok: true, value: {} }),
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });
    const handle = vi.spyOn(terminalRenderer, 'handle');
    subscriber = new TerminalSubscriber(emitter, renderCallback, terminalRenderer);
    subscriber.start();
    const event: ConductorEvent = {
      type: 'gate_verdict', step: 'plan', satisfied: true, reason: 'covered',
    };

    await emitter.emit(event);

    expect(renderCallback).toHaveBeenCalledOnce();
    expect(renderCallback).toHaveBeenCalledWith(event);
    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith(event);
    expect(stream.output()).toBe('  gate plan: satisfied — covered\n');
  });

  it('does not re-render a feature-forwarded gate verdict on the daemon-wide renderer', async () => {
    const stream = new CaptureStream();
    const terminalRenderer = new TerminalRenderer({
      stateFilePath: '/tmp/test-state.json',
      steps: ALL_STEPS,
      readStateFn: async () => ({ ok: true, value: {} }),
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });
    const handle = vi.spyOn(terminalRenderer, 'handle');
    subscriber = new TerminalSubscriber(emitter, renderCallback, terminalRenderer);
    subscriber.start();

    // A feature-scoped bus renders its own events (tagged) via its own
    // listeners and then forwards a marked copy onto the daemon-wide bus this
    // subscriber listens to. Rendering that copy here duplicates the line.
    const worktreePath = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'subscriber-forward-'));
    mkdirSync(join(worktreePath, '.pipeline'), { recursive: true });
    const featureEvents = startFeatureEventPersistence(worktreePath, emitter);
    await featureEvents.events.emit({
      type: 'gate_verdict', step: 'plan', satisfied: true, reason: 'covered',
    });
    featureEvents.stop();
    rmSync(worktreePath, { recursive: true, force: true });

    expect(handle).not.toHaveBeenCalled();
    expect(stream.output()).toBe('');
  });
});
