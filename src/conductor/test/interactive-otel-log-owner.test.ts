// Covers: task:20
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildInteractiveVisualizers } from '../src/index.js';
import { PluginRegistry } from '../src/engine/plugin-registry.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import type { HarnessConfig } from '../src/types/config.js';
import type { VisualizerFactoryContext } from '../src/types/plugin.js';
import type { OtelLogOwner, OtelVisualizerStartContext } from '../src/engine/otel/wire.js';

type WireOtelLogs = typeof import('../src/engine/otel/wire.js').wireOtelLogs;

const wireOtelLogs = vi.hoisted(() => vi.fn<WireOtelLogs>());

vi.mock('../src/engine/otel/wire.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/otel/wire.js')>();
  return { ...actual, wireOtelLogs };
});

afterEach(() => {
  wireOtelLogs.mockReset();
});

function context(): VisualizerFactoryContext & { startContext: OtelVisualizerStartContext } {
  const pipelineDir = '/project/.pipeline';
  return {
    config: {} as HarnessConfig,
    pipelineDir,
    emitter: new ConductorEventEmitter(),
    startContext: {
      project: '/project',
      feature: 'interactive-feature',
      pipelineDir,
      branch: 'feature/interactive',
      engineVersion: 'test',
      harnessVersion: 'test',
    },
  };
}

describe('interactive log-owner lifecycle', () => {
  it('starts the shared owner immediately and stops the same owner once despite repeated visualizer cleanup', async () => {
    const owner: OtelLogOwner = { flush: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    wireOtelLogs.mockResolvedValue(owner);
    const start = context();
    const visualizers = buildInteractiveVisualizers(new PluginRegistry(), start.config, start);
    const logs = visualizers.find((visualizer) => visualizer.name === 'otel-logs');

    expect(logs).toBeDefined();
    expect(wireOtelLogs).toHaveBeenCalledWith(
      start.config,
      expect.objectContaining({ pipelineDir: '/project/.pipeline', feature: 'interactive-feature' }),
      start.emitter,
    );

    logs!.start(start.emitter, start.startContext);
    await Promise.all([logs!.stop(), logs!.stop()]);

    expect({ starts: wireOtelLogs.mock.calls.length, stops: (owner.stop as ReturnType<typeof vi.fn>).mock.calls.length })
      .toEqual({ starts: 1, stops: 1 });
  });

  it('does not retain a stopped run owner when a later interactive run starts in the same process', async () => {
    const first: OtelLogOwner = { flush: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    const second: OtelLogOwner = { flush: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) };
    wireOtelLogs.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const firstContext = context();
    const firstVisualizers = buildInteractiveVisualizers(new PluginRegistry(), firstContext.config, firstContext);
    await firstVisualizers.find((visualizer) => visualizer.name === 'otel-logs')!.stop();
    const secondContext = context();
    const secondVisualizers = buildInteractiveVisualizers(new PluginRegistry(), secondContext.config, secondContext);
    await secondVisualizers.find((visualizer) => visualizer.name === 'otel-logs')!.stop();

    expect({
      starts: wireOtelLogs.mock.calls.length,
      firstStops: (first.stop as ReturnType<typeof vi.fn>).mock.calls.length,
      secondStops: (second.stop as ReturnType<typeof vi.fn>).mock.calls.length,
    }).toEqual({ starts: 2, firstStops: 1, secondStops: 1 });
  });
});
