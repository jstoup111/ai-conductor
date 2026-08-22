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

  it('forwards tier_skip events', async () => {
    const event: ConductorEvent = { type: 'tier_skip', step: 'conflict_check', tier: 'S' };
    await emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards config_skip events', async () => {
    const event: ConductorEvent = { type: 'config_skip', step: 'retro' };
    await emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards gate_blocked events', async () => {
    const event: ConductorEvent = { type: 'gate_blocked', step: 'build', reason: 'no plan' };
    await emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards feature_complete events', async () => {
    const event: ConductorEvent = { type: 'feature_complete', prUrl: 'https://example.com' };
    await emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards provider_fallback events', async () => {
    const event: ConductorEvent = {
      type: 'provider_fallback',
      step: 'plan',
      failedProvider: 'codex',
      reason: 'executable not found',
      nextProvider: 'claude',
    };
    await emitter.emit(event);
    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards discarded build-review cache verdicts', async () => {
    const event = {
      type: 'build_review_cache_discarded',
      rubric: 'scope',
      lapId: 'lap-1',
      reason: 'engine-version-mismatch',
      currentEngineStamp: 'current-engine',
    } satisfies ConductorEvent;

    await emitter.emit(event);

    expect(renderCallback).toHaveBeenCalledWith(event);
  });

  it('forwards closed probe-failure recovery progress', async () => {
    const event = {
      type: 'credentials_park_progress',
      provider: 'codex',
      source: 'cached-login',
      readiness: 'probe-failed',
      elapsedSeconds: 3,
      degradation: 'probe-failure',
      probeFailureKind: 'timeout',
      nextDisposition: 'trial-required',
    } satisfies ConductorEvent;

    await emitter.emit(event);

    expect(renderCallback).toHaveBeenCalledWith(event);
  });
});
