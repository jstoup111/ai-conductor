// Covers: task:5
import { describe, expect, it, vi } from 'vitest';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildInteractiveVisualizers } from '../src/index.js';
import { PluginRegistry } from '../src/engine/plugin-registry.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import type { HarnessConfig } from '../src/types/config.js';
import type { VisualizerFactoryContext } from '../src/types/plugin.js';

const buildExporters = vi.hoisted(() => vi.fn());

vi.mock('../src/engine/otel/transport.js', () => ({ buildExporters }));

describe('interactive OTel wiring', () => {
  it('starts one helper-wired visualizer with the run identity context and no run-id override', async () => {
    const pipelineDir = await mkdtemp(join(process.env.TMPDIR!, 'interactive-otel-'));
    const emitter = new ConductorEventEmitter();
    const spanExporter = new InMemorySpanExporter();
    buildExporters.mockReturnValue({
      spanExporter,
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    });
    await writeFile(join(pipelineDir, 'conduct-session-id'), 'persisted-interactive-run');
    const context: VisualizerFactoryContext = {
      config: { otel: { exporter: 'otlp', endpoint: 'http://fake-collector:4318' } } as HarnessConfig,
      pipelineDir,
      emitter,
      startContext: {
        feature: 'interactive-feature',
        project: '/interactive-project',
        pipelineDir,
      },
    };

    try {
      const visualizerList = buildInteractiveVisualizers(new PluginRegistry(), context.config, context);
      await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await emitter.emit({ type: 'feature_complete', featureDesc: 'interactive-feature' });
      await Promise.all(visualizerList.map((visualizer) => visualizer.stop()));

      const resource = spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')?.resource.attributes;
      expect({
        names: visualizerList.map((visualizer) => visualizer.name),
        feature: resource?.['conductor.feature'],
        project: resource?.['conductor.project'],
        pipelineDir: context.startContext.pipelineDir,
        runId: resource?.['conductor.run.id'],
      }).toEqual({
        names: ['otel'],
        feature: 'interactive-feature',
        project: '/interactive-project',
        pipelineDir,
        runId: 'persisted-interactive-run',
      });
    } finally {
      await rm(pipelineDir, { recursive: true, force: true });
    }
  });
});
