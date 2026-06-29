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
});
