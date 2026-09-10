// Covers: task:1, task:2, task:3
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { TerminalSubscriber, NON_RENDERABLE_DASHBOARD_EVENT_TYPES } from '../../src/ui/subscriber.js';
import type { ConductorEvent } from '../../src/types/index.js';
import type { UIRenderer } from '../../src/ui/types.js';
import { renderedEventTypes } from '../../src/engine/event-sinks.js';

type RendererMock = UIRenderer & { handle: ReturnType<typeof vi.fn> };

const renderer = (handle = vi.fn(async () => {})): RendererMock => ({ name: 'test', handle, stop: vi.fn(async () => {}) });

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
});
