/**
 * T5: Generic visualizer wiring in index.ts.
 *
 * Verifies that when a VisualizerPlugin is returned by `buildVisualizers()`,
 * the lifecycle (start/stop) is exercised correctly by the conductor's run flow.
 *
 * Tests the exported `buildVisualizers` helper and the wiring contract, without
 * running the full CLI main() (which is too heavy for unit tests).
 */
import { describe, it, expect } from 'vitest';
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

  // Covers: task:7
  it('isolates a throwing start, reports it, and returns only started visualizers', async () => {
    const emitter = new ConductorEventEmitter();
    const first = new FakeVisualizer();
    const third = new FakeVisualizer();
    (first as { name: string }).name = 'first';
    (third as { name: string }).name = 'third';
    const second: VisualizerPlugin & { startCalled: number; stopCalled: number } = {
      name: 'second',
      startCalled: 0,
      stopCalled: 0,
      start: () => {
        second.startCalled++;
        throw new Error('second start failed');
      },
      stop: async () => {
        second.stopCalled++;
      },
    };
    const errors: Array<{ rendererName: string; error: string }> = [];
    emitter.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') {
        errors.push(event);
      }
    });

    const started = buildVisualizers([first, second, third], emitter);

    expect(errors).toEqual([
      { type: 'renderer_error', rendererName: 'second', error: 'second start failed' },
    ]);
    expect(first.startCalled).toBe(1);
    expect(second.startCalled).toBe(1);
    expect(third.startCalled).toBe(1);
    expect(started).toEqual([first, third]);

    const { stopVisualizers } = await import('../../src/index.js');
    await stopVisualizers(started);
    expect(first.stopCalled).toBe(1);
    expect(second.stopCalled).toBe(0);
    expect(third.stopCalled).toBe(1);
  });

  it('returns an empty started list when every visualizer start throws', () => {
    const emitter = new ConductorEventEmitter();
    const onlyThrowing: VisualizerPlugin = {
      name: 'only-throwing',
      start: () => {
        throw new Error('unavailable');
      },
      stop: async () => {},
    };

    expect(buildVisualizers([onlyThrowing], emitter)).toEqual([]);
  });

  it('stopVisualizers calls stop() on each visualizer', async () => {
    const { stopVisualizers } = await import('../../src/index.js');
    const vis = new FakeVisualizer();
    await stopVisualizers([vis]);
    expect(vis.stopCalled).toBe(1);
  });

  it('stopVisualizers continues to sibling stops when a visualizer rejects', async () => {
    const { stopVisualizers } = await import('../../src/index.js');
    const badVis: VisualizerPlugin = {
      name: 'bad',
      start: () => {},
      stop: () => Promise.reject(new Error('export failed')),
    };
    const sibling = new FakeVisualizer();
    await expect(stopVisualizers([badVis, sibling])).resolves.toBeUndefined();
    expect(sibling.stopCalled).toBe(1);
  });

  it('continues delivering events when another handler throws', async () => {
    const emitter = new ConductorEventEmitter();
    const received: string[] = [];
    emitter.on('feature_complete', () => {
      throw new Error('broken handler');
    });
    emitter.on('feature_complete', (event) => {
      if (event.type === 'feature_complete') {
        received.push(event.featureDesc ?? '');
      }
    });

    await emitter.emit({ type: 'feature_complete', featureDesc: 'still-delivered' });

    expect(received).toEqual(['still-delivered']);
  });
});
