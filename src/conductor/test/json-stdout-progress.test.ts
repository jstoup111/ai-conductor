import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

import type { ConductorEvent } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { TerminalSubscriber } from '../src/ui/subscriber.js';
import { dispatchRenderers } from '../src/ui/dispatch.js';
import { JsonStdoutSubscriber } from '../../../plugins/json-stdout-subscriber/index.js';
import type { UIRenderer } from '../src/ui/types.js';

/**
 * JsonStdoutSubscriber is a UIRenderer, so it can receive the fan-out directly.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Task 14: UI fan-out list feeds every ui_renderer
// (adr-2026-07-10-intra-step-build-progress-events)
// ─────────────────────────────────────────────────────────────────────────────

describe('TerminalSubscriber subscription list', () => {
  it('subscribes to build_progress, build_no_progress, and build_stall', async () => {
    const emitter = new ConductorEventEmitter();
    const onRender = vi.fn(async () => {});
    const subscriber = new TerminalSubscriber(emitter);
    subscriber.start([{ name: 'capture', handle: onRender, stop: async () => {} }]);

    const progress: ConductorEvent = { type: 'build_progress', step: 'build', resolved: 1, total: 2 };
    const noProgress: ConductorEvent = {
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 1,
      total: 2,
    };
    const stall: ConductorEvent = { type: 'build_stall' } as ConductorEvent;

    await emitter.emit(progress);
    await emitter.emit(noProgress);
    await emitter.emit(stall);

    expect(onRender).toHaveBeenCalledTimes(3);
    expect(onRender).toHaveBeenNthCalledWith(1, progress);
    expect(onRender).toHaveBeenNthCalledWith(2, noProgress);
    expect(onRender).toHaveBeenNthCalledWith(3, stall);

    subscriber.stop();
  });
});

describe('json-stdout renderer fan-out for progress/stall events', () => {
  let subscriber: JsonStdoutSubscriber;
  let stdoutWriteSpy: MockInstance<typeof process.stdout.write>;

  beforeEach(() => {
    subscriber = new JsonStdoutSubscriber();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    await subscriber.stop();
    stdoutWriteSpy.mockRestore();
  });

  it('emits exactly one {...event, ts} JSON line per build_progress event via dispatchRenderers', async () => {
    const event: ConductorEvent = { type: 'build_progress', step: 'build', resolved: 5, total: 21 };

    await dispatchRenderers([subscriber], event);

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

    await dispatchRenderers([subscriber], event);

    expect(stdoutWriteSpy).toHaveBeenCalledOnce();
    const written = stdoutWriteSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed.type).toBe('build_no_progress');
    expect(parsed.quietMinutes).toBe(15);
    expect(parsed.ts).toBeDefined();
  });

  it('emits exactly one {...event, ts} JSON line per build_stall event via dispatchRenderers', async () => {
    const event: ConductorEvent = { type: 'build_stall' } as ConductorEvent;

    await dispatchRenderers([subscriber], event);

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
      stop: vi.fn(async () => {}),
    };

    const event: ConductorEvent = { type: 'build_progress', step: 'build', resolved: 1, total: 2 };

    await dispatchRenderers([throwingRenderer, subscriber], event);
    // Allow the fire-and-forget renderer_error re-dispatch to land.
    await new Promise((r) => setImmediate(r));

    // json-stdout still received the original event plus the re-dispatched
    // renderer_error event caused by the sibling's failure.
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(2);
    const firstWritten = JSON.parse((stdoutWriteSpy.mock.calls[0][0] as string).trimEnd());
    expect(firstWritten.type).toBe('build_progress');
  });
});
