import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { TerminalSubscriber } from '../../src/ui/subscriber.js';
import type { ConductorEvent } from '../../src/types/index.js';

describe('TerminalSubscriber event forwarding', () => {
  let emitter: ConductorEventEmitter;
  let renderCallback: ReturnType<typeof vi.fn>;
  let subscriber: TerminalSubscriber;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new ConductorEventEmitter();
    renderCallback = vi.fn();
    subscriber = new TerminalSubscriber(emitter, renderCallback);
    subscriber.start();
  });

  afterEach(() => {
    subscriber.stop();
    vi.useRealTimers();
  });

  it('forwards tier_skip events', () => {
    const event: ConductorEvent = { type: 'tier_skip', step: 'conflict_check', tier: 'S' };
    emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards config_skip events', () => {
    const event: ConductorEvent = { type: 'config_skip', step: 'retro' };
    emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards gate_blocked events', () => {
    const event: ConductorEvent = { type: 'gate_blocked', step: 'build', reason: 'no plan' };
    emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards feature_complete events', () => {
    const event: ConductorEvent = { type: 'feature_complete', prUrl: 'https://example.com' };
    emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });
});
