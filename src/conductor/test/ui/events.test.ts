import { describe, it, expect, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent, RecoveryOption } from '../../src/types/index.js';

describe('ConductorEventEmitter', () => {
  it('emit step_started triggers registered listener with correct payload', () => {
    const emitter = new ConductorEventEmitter();
    const handler = vi.fn();
    emitter.on('step_started', handler);

    const event: ConductorEvent = { type: 'step_started', step: 'brainstorm', index: 2 };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('emit checkpoint_reached triggers listener', () => {
    const emitter = new ConductorEventEmitter();
    const handler = vi.fn();
    emitter.on('checkpoint_reached', handler);

    const event: ConductorEvent = { type: 'checkpoint_reached', step: 'stories' };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('emit recovery_needed triggers listener with options array', () => {
    const emitter = new ConductorEventEmitter();
    const handler = vi.fn();
    emitter.on('recovery_needed', handler);

    const options: RecoveryOption[] = ['retry', 'interactive', 'back', 'skip', 'quit'];
    const event: ConductorEvent = { type: 'recovery_needed', step: 'build', options };
    emitter.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
    expect((handler.mock.calls[0][0] as Extract<ConductorEvent, { type: 'recovery_needed' }>).options).toEqual(options);
  });

  it('off() removes listener so subsequent emit does not trigger it', () => {
    const emitter = new ConductorEventEmitter();
    const handler = vi.fn();
    emitter.on('step_started', handler);
    emitter.off('step_started', handler);

    emitter.emit({ type: 'step_started', step: 'worktree', index: 0 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('waitFor() resolves with the emitted event', async () => {
    const emitter = new ConductorEventEmitter();

    const promise = emitter.waitFor('feature_complete');
    const event: ConductorEvent = { type: 'feature_complete', prUrl: 'https://github.com/pr/1' };
    emitter.emit(event);

    const result = await promise;
    expect(result).toEqual(event);
  });

  it('multiple listeners on same event type all fire', () => {
    const emitter = new ConductorEventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    emitter.on('dashboard_refresh', handler1);
    emitter.on('dashboard_refresh', handler2);
    emitter.on('dashboard_refresh', handler3);

    const event: ConductorEvent = { type: 'dashboard_refresh' };
    emitter.emit(event);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    expect(handler3).toHaveBeenCalledOnce();
  });
});
