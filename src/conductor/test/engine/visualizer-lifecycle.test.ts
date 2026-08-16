import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { startRegisteredVisualizers } from '../../src/engine/visualizer-lifecycle.js';
import type { VisualizerPlugin } from '../../src/types/plugin.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('visualizer lifecycle', () => {
  it('starts every registered visualizer with the shared emitter used for event delivery', async () => {
    const registry = new PluginRegistry();
    const emitter = new ConductorEventEmitter();
    const deliveredFirst = vi.fn();
    const deliveredSecond = vi.fn();
    let firstEmitter: ConductorEventEmitter | undefined;
    let secondEmitter: ConductorEventEmitter | undefined;
    const firstVisualizer: VisualizerPlugin = {
      name: 'first-registered-visualizer',
      start: (lifecycleEmitter) => {
        firstEmitter = lifecycleEmitter;
        lifecycleEmitter.on('step_started', deliveredFirst);
      },
      stop: async () => {},
    };
    const secondVisualizer: VisualizerPlugin = {
      name: 'second-registered-visualizer',
      start: (lifecycleEmitter) => {
        secondEmitter = lifecycleEmitter;
        lifecycleEmitter.on('step_started', deliveredSecond);
      },
      stop: async () => {},
    };
    registry.register('visualizer', firstVisualizer.name, firstVisualizer);
    registry.register('visualizer', secondVisualizer.name, secondVisualizer);
    registry.markInitialized();

    await startRegisteredVisualizers(registry, emitter);
    await emitter.emit({ type: 'step_started', step: 'explore', index: 0 });

    expect([
      firstEmitter === emitter,
      secondEmitter === emitter,
      deliveredFirst.mock.calls.length,
      deliveredSecond.mock.calls.length,
    ]).toEqual([true, true, 1, 1]);
  });
});
