import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import type { VisualizerPlugin, VisualizerStartContext } from '../../src/types/plugin.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

class FakeVisualizer implements VisualizerPlugin {
  readonly name = 'fake-visualizer';
  startCalled = 0;
  stopCalled = 0;
  receivedContext: VisualizerStartContext | undefined;

  start(_emitter: ConductorEventEmitter, context: VisualizerStartContext): void {
    this.startCalled++;
    this.receivedContext = context;
  }

  async stop(): Promise<void> {
    this.stopCalled++;
  }
}

describe('VisualizerPlugin interface + registry', () => {
  it('VisualizerPlugin can be registered under kind "visualizer"', () => {
    const registry = new PluginRegistry();
    const plugin = new FakeVisualizer();
    registry.register('visualizer', plugin.name, plugin);
    registry.markInitialized();
    const retrieved = registry.get<VisualizerPlugin>('visualizer', 'fake-visualizer');
    expect(retrieved).toBe(plugin);
  });

  it('list("visualizer") returns registered plugin names', () => {
    const registry = new PluginRegistry();
    const plugin = new FakeVisualizer();
    registry.register('visualizer', plugin.name, plugin);
    const names = registry.list('visualizer');
    expect(names).toContain('fake-visualizer');
  });

  // Covers: task:1
  it('VisualizerPlugin.start() passes every identity context field to the visualizer', () => {
    const plugin = new FakeVisualizer();
    const emitter = new ConductorEventEmitter();
    const context: VisualizerStartContext = {
      runId: 'run-123',
      project: 'ai-conductor',
      branch: 'feature/visualizer-seam',
      feature: 'connector-seam-for-event-submissions-is-registered',
      engineVersion: '1.2.3',
      pipelineDir: '/tmp/project/.pipeline',
    };

    plugin.start(emitter, context);

    expect(plugin.startCalled).toBe(1);
    expect(plugin.receivedContext).toEqual(context);
  });

  it('VisualizerPlugin.stop() returns a Promise', async () => {
    const plugin = new FakeVisualizer();
    await expect(plugin.stop()).resolves.toBeUndefined();
    expect(plugin.stopCalled).toBe(1);
  });

  it('multiple visualizer plugins can be registered', () => {
    const registry = new PluginRegistry();
    const plugin1 = new FakeVisualizer();
    const plugin2 = new FakeVisualizer();
    (plugin2 as { name: string }).name = 'another-visualizer';
    registry.register('visualizer', 'fake-visualizer', plugin1);
    registry.register('visualizer', 'another-visualizer', plugin2);
    registry.markInitialized();
    expect(registry.list('visualizer')).toEqual(['fake-visualizer', 'another-visualizer']);
  });
});
