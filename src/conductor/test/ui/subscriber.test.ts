// Covers: task:1, task:2, task:3
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { TerminalSubscriber, NON_RENDERABLE_DASHBOARD_EVENT_TYPES } from '../../src/ui/subscriber.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductorEvent } from '../../src/types/index.js';
import type { UIRenderer } from '../../src/ui/types.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import { renderedEventTypes } from '../../src/engine/event-sinks.js';

type RendererMock = UIRenderer & { handle: ReturnType<typeof vi.fn> };

const renderer = (handle = vi.fn(async () => {})): RendererMock => ({ name: 'test', handle, stop: vi.fn(async () => {}) });

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
  const subscribers: TerminalSubscriber[] = [];
  afterEach(async () => { await Promise.all(subscribers.splice(0).map((subscriber) => subscriber.stop())); });

  it('subscribes once to the renderable union and fans each event to every renderer exactly once', async () => {
    const events = new ConductorEventEmitter();
    const on = vi.spyOn(events, 'on');
    const first = renderer();
    const second = renderer();
    const subscriber = new TerminalSubscriber(events);
    subscribers.push(subscriber);
    subscriber.start([first, second]);
    const event: ConductorEvent = { type: 'step_started', step: 'explore', index: 2 };
    await events.emit(event);
    expect(first.handle).toHaveBeenCalledOnce();
    expect(second.handle).toHaveBeenCalledOnce();
    expect(on.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining([...renderedEventTypes(), ...NON_RENDERABLE_DASHBOARD_EVENT_TYPES]));
  });

  it('isolates renderer errors while retaining other renderers and later events', async () => {
    const events = new ConductorEventEmitter();
    const bad = renderer(vi.fn(async () => { throw new Error('broken'); }));
    const good = renderer();
    const errors: ConductorEvent[] = [];
    events.on('renderer_error', async (event) => { errors.push(event); });
    const subscriber = new TerminalSubscriber(events);
    subscribers.push(subscriber);
    subscriber.start([bad, good]);
    const event: ConductorEvent = { type: 'step_started', step: 'explore', index: 2 };
    await events.emit(event);
    await events.emit(event);
    expect(good.handle.mock.calls.filter(([seen]) => seen === event)).toHaveLength(2);
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ rendererName: 'test', error: 'Error: broken' })]));
  });

  it('fans an ordinary gate verdict to the renderer once', async () => {
    const events = new ConductorEventEmitter();
    const target = renderer();
    const subscriber = new TerminalSubscriber(events);
    subscribers.push(subscriber);
    subscriber.start([target]);
    // Marking is kept out of the event payload; this test owns only ordinary fan-out.
    await events.emit({ type: 'gate_verdict', step: 'plan', satisfied: false, reason: 'x' });
    expect(target.handle).toHaveBeenCalledOnce();
  });

  it('delivers an allowance-bearing retry once to TerminalRenderer instead of the foreground callback', async () => {
    const events = new ConductorEventEmitter();
    const callback = renderer();
    const stream = new CaptureStream();
    const terminal = new TerminalRenderer({
      stateFilePath: '/tmp/conduct-state.json',
      steps: ALL_STEPS,
      readStateFn: async () => ({ ok: true, value: {} }),
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });
    const subscriber = new TerminalSubscriber(events);
    subscribers.push(subscriber);
    subscriber.start([callback, terminal]);

    await events.emit({
      type: 'step_retry',
      step: 'build',
      attempt: 2,
      maxAttempts: 3,
      reason: 'tasks remain',
      progressAttempt: 2,
      progressAttemptCeiling: 30,
    });

    expect(callback.handle).not.toHaveBeenCalled();
    expect(stream.output()).toContain('2/3 (progress allowance: attempt 2 of 30)');
    expect(stream.output().match(/progress allowance: attempt 2 of 30/g)).toHaveLength(1);
  });

  it('delivers a retry to the foreground callback when TerminalRenderer is absent', async () => {
    const events = new ConductorEventEmitter();
    const callback = renderer();
    const subscriber = new TerminalSubscriber(events);
    subscribers.push(subscriber);
    subscriber.start([callback]);
    const event: ConductorEvent = { type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'retry' };

    await events.emit(event);

    expect(callback.handle).toHaveBeenCalledOnce();
    expect(callback.handle).toHaveBeenCalledWith(event);
  });

  it('delivers a feature-forwarded retry only to the foreground callback', async () => {
    const globalEvents = new ConductorEventEmitter();
    const callback = renderer();
    const terminal = renderer();
    terminal.name = 'terminal';
    const subscriber = new TerminalSubscriber(globalEvents);
    subscribers.push(subscriber);
    subscriber.start([callback, terminal]);
    const worktree = await mkdtemp(join(tmpdir(), 'subscriber-forwarded-retry-'));
    await mkdir(join(worktree, '.pipeline'));
    const scope = startFeatureEventPersistence(worktree, globalEvents, 'feature');
    const event: ConductorEvent = { type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'retry' };

    try {
      await scope.events.emit(event);
      expect(callback.handle).toHaveBeenCalledOnce();
      expect(callback.handle).toHaveBeenCalledWith(expect.objectContaining(event));
      expect(terminal.handle).not.toHaveBeenCalled();
    } finally {
      scope.stop();
      await rm(worktree, { recursive: true, force: true });
    }
  });
});
