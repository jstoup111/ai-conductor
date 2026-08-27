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
import type { VisualizerPlugin, VisualizerStartContext } from '../../src/types/plugin.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { buildVisualizers } from '../../src/index.js';

class FakeVisualizer implements VisualizerPlugin {
  readonly name = 'fake';
  startCalled = 0;
  stopCalled = 0;
  lastEmitter: ConductorEventEmitter | null = null;
  lastContext: VisualizerStartContext | null = null;

  start(emitter: ConductorEventEmitter, context: VisualizerStartContext): void {
    this.startCalled++;
    this.lastEmitter = emitter;
    this.lastContext = context;
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

  // Covers: task:1
  it('buildVisualizers gives every visualizer the supplied emitter and identity context', () => {
    const emitter = new ConductorEventEmitter();
    const vis1 = new FakeVisualizer();
    const vis2 = new FakeVisualizer();
    (vis2 as { name: string }).name = 'fake2';
    const context: VisualizerStartContext = {
      runId: 'run-123',
      project: 'ai-conductor',
      branch: 'feature/visualizer-seam',
      feature: 'connector-seam-for-event-submissions-is-registered',
      engineVersion: '1.2.3',
      pipelineDir: '/tmp/project/.pipeline',
    };

    buildVisualizers([vis1, vis2], emitter, context);

    expect(vis1.startCalled).toBe(1);
    expect(vis2.startCalled).toBe(1);
    expect(vis1.lastEmitter).toBe(emitter);
    expect(vis1.lastContext).toBe(context);
    expect(vis2.lastContext).toBe(context);
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

});
