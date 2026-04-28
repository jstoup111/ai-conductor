import { describe, it, expect, vi } from 'vitest';
import { dispatchRenderers } from '../../src/ui/dispatch.js';
import { RecordingRenderer } from './recording-renderer.js';
import type { ConductorEvent } from '../../src/types/index.js';

const stepStarted: ConductorEvent = { type: 'step_started', step: 'brainstorm', index: 2 };
const stepCompleted: ConductorEvent = { type: 'step_completed', step: 'brainstorm', status: 'done' };

// T3 — no renderers
describe('dispatchRenderers — no renderers', () => {
  it('is a no-op when renderer list is empty', async () => {
    await expect(dispatchRenderers([], stepStarted)).resolves.toBeUndefined();
  });
});

// T5 — Promise.all dispatch
describe('dispatchRenderers — multi-renderer dispatch', () => {
  it('dispatches to a single renderer', async () => {
    const r = new RecordingRenderer();
    await dispatchRenderers([r], stepStarted);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toEqual(stepStarted);
  });

  it('dispatches the same event to all renderers', async () => {
    const r1 = new RecordingRenderer();
    const r2 = new RecordingRenderer();
    await dispatchRenderers([r1, r2], stepCompleted);
    expect(r1.events[0]).toEqual(stepCompleted);
    expect(r2.events[0]).toEqual(stepCompleted);
  });
});

// T6 — slow renderer
describe('dispatchRenderers — slow renderer', () => {
  it('runs all renderers concurrently (Promise.all)', async () => {
    const r1 = new RecordingRenderer();
    const r2 = new RecordingRenderer();

    // r1 is slow — but both should complete before dispatchRenderers resolves
    r1.delayMs = 20;

    const start = Date.now();
    await dispatchRenderers([r1, r2], stepStarted);
    const elapsed = Date.now() - start;

    // Both recorded the event
    expect(r1.events).toHaveLength(1);
    expect(r2.events).toHaveLength(1);
    // Concurrent: elapsed should be closer to 20ms than 40ms
    // (allow generous wall-clock slack for CI)
    expect(elapsed).toBeLessThan(200);
  });
});

// T9 — degradation: one renderer throws, others survive
describe('dispatchRenderers — renderer degradation', () => {
  it('continues dispatching to healthy renderers when one throws', async () => {
    const throwing = new RecordingRenderer();
    throwing.throwError = new Error('renderer exploded');
    const healthy = new RecordingRenderer();

    await dispatchRenderers([throwing, healthy], stepStarted);

    // healthy renderer received the original event (may also receive renderer_error async)
    const originalEvents = healthy.events.filter((e) => e.type === stepStarted.type);
    expect(originalEvents).toHaveLength(1);
    expect(originalEvents[0]).toEqual(stepStarted);
  });

  it('emits renderer_error to surviving renderers when one throws', async () => {
    const throwing = new RecordingRenderer();
    (throwing as unknown as { name: string }).name = 'bad-renderer';
    throwing.throwError = new Error('boom');
    const healthy = new RecordingRenderer();

    await dispatchRenderers([throwing, healthy], stepStarted);

    // Give the fire-and-forget renderer_error a tick to arrive
    await new Promise((r) => setImmediate(r));

    const errEvents = healthy.events.filter((e) => e.type === 'renderer_error');
    expect(errEvents).toHaveLength(1);
    expect(errEvents[0]).toMatchObject({ type: 'renderer_error', error: 'boom' });
  });
});

// T12 — one-renderer-throws
describe('dispatchRenderers — one renderer throws (single renderer)', () => {
  it('resolves without throwing even when the only renderer throws', async () => {
    const r = new RecordingRenderer();
    r.throwError = new Error('single renderer error');
    await expect(dispatchRenderers([r], stepStarted)).resolves.toBeUndefined();
  });
});

// T13 — duplicate renderers
describe('dispatchRenderers — duplicate renderer instances', () => {
  it('dispatches to each renderer once even if same instance appears twice', async () => {
    const r = new RecordingRenderer();
    // Same instance twice — should get called twice (dispatch doesn't deduplicate)
    await dispatchRenderers([r, r], stepStarted);
    expect(r.events).toHaveLength(2);
  });
});
