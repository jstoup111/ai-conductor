/**
 * T5: Generic visualizer wiring in index.ts.
 *
 * Verifies that when a VisualizerPlugin is returned by `buildVisualizers()`,
 * the lifecycle (start/stop) is exercised correctly by the conductor's run flow.
 *
 * Tests the exported `buildVisualizers` helper and the wiring contract, without
 * running the full CLI main() (which is too heavy for unit tests).
 */
import { describe, it, expect, vi } from 'vitest';
import type { VisualizerPlugin } from '../../src/types/plugin.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { buildVisualizers } from '../../src/index.js';

class FakeVisualizer implements VisualizerPlugin {
  readonly name = 'fake';
  startCalled = 0;
  stopCalled = 0;
  lastEmitter: ConductorEventEmitter | null = null;

  start(emitter: ConductorEventEmitter): void {
    this.startCalled++;
    this.lastEmitter = emitter;
  }

  async stop(): Promise<void> {
    this.stopCalled++;
  }
}

describe('Visualizer wiring helpers', () => {
  it('buildVisualizers returns an empty array when no visualizers configured', () => {
    const emitter = new ConductorEventEmitter();
    const visualizers = buildVisualizers([], emitter);
    expect(visualizers).toHaveLength(0);
  });

  it('buildVisualizers calls start() on each visualizer with the emitter', () => {
    const emitter = new ConductorEventEmitter();
    const vis1 = new FakeVisualizer();
    const vis2 = new FakeVisualizer();
    (vis2 as { name: string }).name = 'fake2';
    buildVisualizers([vis1, vis2], emitter);
    expect(vis1.startCalled).toBe(1);
    expect(vis2.startCalled).toBe(1);
    expect(vis1.lastEmitter).toBe(emitter);
  });

  it('continues starting visualizers when one start() throws synchronously', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emitter = new ConductorEventEmitter();
    const throwingVisualizer: VisualizerPlugin = {
      name: 'throwing',
      start: () => {
        throw new Error('visualizer start failed');
      },
      stop: async () => {},
    };
    const nextVisualizer = new FakeVisualizer();

    try {
      buildVisualizers([throwingVisualizer, nextVisualizer], emitter);
      expect(nextVisualizer.startCalled).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('detaches a visualizer listener after its synchronous event-handler failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emitter = new ConductorEventEmitter();
    const throwingHandler = vi.fn(() => {
      throw new Error('visualizer handler failed');
    });
    const healthyHandler = vi.fn();
    const visualizer: VisualizerPlugin = {
      name: 'throwing-listener',
      start: (visualizerEmitter) => {
        visualizerEmitter.on('step_started', throwingHandler);
      },
      stop: async () => {},
    };

    try {
      emitter.on('step_started', healthyHandler);
      buildVisualizers([visualizer], emitter);
      await emitter.emit({ type: 'step_started', step: 'explore', index: 0 });
      await emitter.emit({ type: 'step_started', step: 'explore', index: 0 });

      expect([
        throwingHandler.mock.calls.length,
        healthyHandler.mock.calls.length,
      ]).toEqual([1, 2]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('detaches a visualizer listener after its asynchronous event-handler failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emitter = new ConductorEventEmitter();
    const rejectingHandler = vi.fn(async () => {
      throw new Error('async visualizer handler failed');
    });
    const healthyHandler = vi.fn();
    const visualizer: VisualizerPlugin = {
      name: 'rejecting-listener',
      start: (visualizerEmitter) => {
        visualizerEmitter.on('step_started', rejectingHandler);
      },
      stop: async () => {},
    };

    try {
      emitter.on('step_started', healthyHandler);
      buildVisualizers([visualizer], emitter);
      await emitter.emit({ type: 'step_started', step: 'explore', index: 0 });
      await Promise.resolve();
      await emitter.emit({ type: 'step_started', step: 'explore', index: 0 });
      await Promise.resolve();

      expect([
        rejectingHandler.mock.calls.length,
        healthyHandler.mock.calls.length,
        warnSpy.mock.calls.length,
      ]).toEqual([1, 2, 1]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not stall event delivery when a visualizer listener never settles', async () => {
    vi.useFakeTimers();
    const emitter = new ConductorEventEmitter();
    const visualizer: VisualizerPlugin = {
      name: 'never-settling-listener',
      start: (visualizerEmitter) => {
        visualizerEmitter.on(
          'step_started',
          () => new Promise<void>(() => {}),
        );
      },
      stop: async () => {},
    };

    try {
      buildVisualizers([visualizer], emitter);
      const outcome = Promise.race([
        emitter
          .emit({ type: 'step_started', step: 'explore', index: 0 })
          .then(() => 'delivered' as const),
        new Promise<'timed-out'>((resolve) => {
          setTimeout(() => resolve('timed-out'), 25);
        }),
      ]);

      await vi.advanceTimersByTimeAsync(25);

      expect(await outcome).toBe('delivered');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopVisualizers calls stop() on each visualizer', async () => {
    const { stopVisualizers } = await import('../../src/index.js');
    const vis = new FakeVisualizer();
    await stopVisualizers([vis]);
    expect(vis.stopCalled).toBe(1);
  });

  it('stopVisualizers resolves even if a visualizer throws', async () => {
    const { stopVisualizers } = await import('../../src/index.js');
    const badVis: VisualizerPlugin = {
      name: 'bad',
      start: () => {},
      stop: () => Promise.reject(new Error('export failed')),
    };
    await expect(stopVisualizers([badVis])).resolves.toBeUndefined();
  });

  it('bounds a never-settling visualizer stop without blocking other plugins', async () => {
    const { stopVisualizers } = await import('../../src/index.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    const healthyStop = vi.fn(async () => {});
    const hangingVisualizer: VisualizerPlugin = {
      name: 'never-stopping',
      start: () => {},
      stop: () => new Promise<void>(() => {}),
    };
    const healthyVisualizer: VisualizerPlugin = {
      name: 'healthy-stop',
      start: () => {},
      stop: healthyStop,
    };

    try {
      const outcome = Promise.race([
        stopVisualizers([hangingVisualizer, healthyVisualizer]).then(
          () => 'resolved' as const,
        ),
        new Promise<'timed-out'>((resolve) => {
          setTimeout(() => resolve('timed-out'), 10_000);
        }),
      ]);

      await vi.advanceTimersByTimeAsync(10_000);

      expect([
        await outcome,
        healthyStop.mock.calls.length,
        warnSpy.mock.calls.length,
      ]).toEqual(['resolved', 1, 1]);
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });
});
