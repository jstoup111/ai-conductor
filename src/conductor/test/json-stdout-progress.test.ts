import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ConductorEvent } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { TerminalSubscriber } from '../src/ui/subscriber.js';
import { dispatchRenderers } from '../src/ui/dispatch.js';
import { JsonStdoutSubscriber } from '../../plugins/json-stdout-subscriber/index.ts';
import type { UIRenderer } from '../src/ui/types.js';

/**
 * JsonStdoutSubscriber.handle() is synchronous (void), while dispatchRenderers
 * expects UIRenderer.handle() to return a Promise<void> (this is how the
 * plugin loader composes json-stdout as a ui_renderer in production). This
 * thin adapter mirrors that composition without touching the plugin's
 * index.ts, which must remain untouched per this task's acceptance criteria.
 */
function asRenderer(subscriber: JsonStdoutSubscriber, name = 'json-stdout'): UIRenderer {
  return {
    handle: async (event) => {
      subscriber.handle(event);
    },
    stop: () => subscriber.stop(),
    ...({ name } as Record<string, unknown>),
  } as UIRenderer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 14: UI fan-out list feeds every ui_renderer
// (adr-2026-07-10-intra-step-build-progress-events)
// ─────────────────────────────────────────────────────────────────────────────

describe('TerminalSubscriber subscription list', () => {
  it('subscribes to build_progress, build_no_progress, and build_stall', () => {
    const emitter = new ConductorEventEmitter();
    const onRender = vi.fn();
    const subscriber = new TerminalSubscriber(emitter, onRender);
    subscriber.start();

    const progress: ConductorEvent = { type: 'build_progress', step: 'build', resolved: 1, total: 2 };
    const noProgress: ConductorEvent = {
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 1,
      total: 2,
    };
    const stall: ConductorEvent = { type: 'build_stall' } as ConductorEvent;

    emitter.emit(progress);
    emitter.emit(noProgress);
    emitter.emit(stall);

    expect(onRender).toHaveBeenCalledTimes(3);
    expect(onRender).toHaveBeenNthCalledWith(1, progress);
    expect(onRender).toHaveBeenNthCalledWith(2, noProgress);
    expect(onRender).toHaveBeenNthCalledWith(3, stall);

    subscriber.stop();
  });
});

describe('json-stdout renderer fan-out for progress/stall events', () => {
  let subscriber: JsonStdoutSubscriber;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    subscriber = new JsonStdoutSubscriber();
    subscriber.start();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    subscriber.stop();
    stdoutWriteSpy.mockRestore();
  });

  it('emits exactly one {...event, ts} JSON line per build_progress event via dispatchRenderers', async () => {
    const event: ConductorEvent = { type: 'build_progress', step: 'build', resolved: 5, total: 21 };

    await dispatchRenderers([asRenderer(subscriber)], event);

    expect(stdoutWriteSpy).toHaveBeenCalledOnce();
    const written = stdoutWriteSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed.type).toBe('build_progress');
    expect(parsed.resolved).toBe(5);
    expect(parsed.total).toBe(21);
    expect(parsed.ts).toBeDefined();
  });

  it('emits exactly one {...event, ts} JSON line per build_no_progress event via dispatchRenderers', async () => {
    const event: ConductorEvent = {
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 20,
      total: 21,
    };

    await dispatchRenderers([asRenderer(subscriber)], event);

    expect(stdoutWriteSpy).toHaveBeenCalledOnce();
    const written = stdoutWriteSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed.type).toBe('build_no_progress');
    expect(parsed.quietMinutes).toBe(15);
    expect(parsed.ts).toBeDefined();
  });

  it('emits exactly one {...event, ts} JSON line per build_stall event via dispatchRenderers', async () => {
    const event: ConductorEvent = { type: 'build_stall' } as ConductorEvent;

    await dispatchRenderers([asRenderer(subscriber)], event);

    expect(stdoutWriteSpy).toHaveBeenCalledOnce();
    const written = stdoutWriteSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed.type).toBe('build_stall');
    expect(parsed.ts).toBeDefined();
  });

  it('a throwing sibling renderer does not prevent json-stdout from receiving the event', async () => {
    const throwingRenderer = {
      name: 'broken',
      handle: vi.fn(async () => {
        throw new Error('boom');
      }),
      stop: vi.fn(),
    };

    const event: ConductorEvent = { type: 'build_progress', step: 'build', resolved: 1, total: 2 };

    await dispatchRenderers([throwingRenderer, asRenderer(subscriber)], event);
    // Allow the fire-and-forget renderer_error re-dispatch to land.
    await new Promise((r) => setImmediate(r));

    // json-stdout still received the original event plus the re-dispatched
    // renderer_error event caused by the sibling's failure.
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(2);
    const firstWritten = JSON.parse((stdoutWriteSpy.mock.calls[0][0] as string).trimEnd());
    expect(firstWritten.type).toBe('build_progress');
  });
});
