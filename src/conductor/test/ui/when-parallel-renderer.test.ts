/**
 * T23 — terminal renderer handles when_skip and parallel events
 * T24 — zero-subscriber: events emitted with no subscriber don't throw
 */
import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import { createRenderer } from '../../src/ui/create-renderer.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent, ConductState } from '../../src/types/index.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

class CaptureStream extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer | string, _e: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  output(): string { return this.chunks.join(''); }
}

function makeRenderer() {
  const state: ConductState = { complexity_tier: 'L' };
  const readStateMock = vi.fn(async () => ({ ok: true as const, value: state }));
  const stream = new CaptureStream();
  const renderer = createRenderer({
    stateFilePath: '/tmp/test-state.json',
    steps: ALL_STEPS,
    readStateFn: readStateMock,
    liveRegion: createLiveRegion({ stream, forceTTY: false }),
  });
  return { renderer, stream };
}

describe('T23 — terminal renderer: when_skip event', () => {
  it('logs when_skip with expression', async () => {
    const { renderer, stream } = makeRenderer();
    const event: ConductorEvent = {
      type: 'when_skip',
      step: 'brainstorm',
      expression: 'tier == L',
    };
    await renderer(event);
    expect(stream.output()).toMatch(/brainstorm/);
    expect(stream.output()).toMatch(/tier == L/);
  });

  it('includes undefinedKey note when key is missing', async () => {
    const { renderer, stream } = makeRenderer();
    const event: ConductorEvent = {
      type: 'when_skip',
      step: 'plan',
      expression: '${bootstrap_mode} == new',
      undefinedKey: 'bootstrap_mode',
    };
    await renderer(event);
    const out = stream.output();
    expect(out).toMatch(/bootstrap_mode/);
    expect(out).toMatch(/undefined.*false|false.*undefined/i);
  });
});

describe('T23 — terminal renderer: parallel events', () => {
  it('logs parallel_started', async () => {
    const { renderer, stream } = makeRenderer();
    const event: ConductorEvent = {
      type: 'parallel_started',
      step: 'brainstorm',
      branches: ['frontend', 'backend'],
    };
    await renderer(event);
    const out = stream.output();
    expect(out).toMatch(/brainstorm/);
    expect(out).toMatch(/frontend/);
    expect(out).toMatch(/backend/);
  });

  it('logs parallel_completed', async () => {
    const { renderer, stream } = makeRenderer();
    const event: ConductorEvent = {
      type: 'parallel_completed',
      step: 'brainstorm',
      branches: ['a', 'b'],
    };
    await renderer(event);
    const out = stream.output();
    expect(out).toMatch(/brainstorm/);
    expect(out).toMatch(/completed/);
  });

  it('logs parallel_failure with branch name and error', async () => {
    const { renderer, stream } = makeRenderer();
    const event: ConductorEvent = {
      type: 'parallel_failure',
      step: 'brainstorm',
      branch: 'backend',
      error: 'skill timed out',
    };
    await renderer(event);
    const out = stream.output();
    expect(out).toMatch(/backend/);
    expect(out).toMatch(/skill timed out/);
  });
});

describe('T24 — zero-subscriber: events emitted without subscribers do not throw', () => {
  it('emits when_skip with no subscribers safely', async () => {
    const emitter = new ConductorEventEmitter();
    // No subscriber attached — must not throw
    await expect(
      emitter.emit({
        type: 'when_skip',
        step: 'brainstorm',
        expression: 'tier == L',
      }),
    ).resolves.toBeUndefined();
  });

  it('emits parallel_started with no subscribers safely', async () => {
    const emitter = new ConductorEventEmitter();
    await expect(
      emitter.emit({
        type: 'parallel_started',
        step: 'brainstorm',
        branches: ['a', 'b'],
      }),
    ).resolves.toBeUndefined();
  });

  it('emits parallel_completed with no subscribers safely', async () => {
    const emitter = new ConductorEventEmitter();
    await expect(
      emitter.emit({
        type: 'parallel_completed',
        step: 'brainstorm',
        branches: ['a'],
      }),
    ).resolves.toBeUndefined();
  });

  it('emits parallel_failure with no subscribers safely', async () => {
    const emitter = new ConductorEventEmitter();
    await expect(
      emitter.emit({
        type: 'parallel_failure',
        step: 'brainstorm',
        branch: 'x',
        error: 'err',
      }),
    ).resolves.toBeUndefined();
  });
});
