// Covers: task:2, task:6, task:10, task:11
import { describe, expect, it, vi } from 'vitest';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { CapturingSpanExporter as InMemorySpanExporter } from './fixtures/capturing-span-exporter.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildInteractiveVisualizers } from '../src/index.js';
import { PluginRegistry } from '../src/engine/plugin-registry.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import type { HarnessConfig } from '../src/types/config.js';
import type { VisualizerFactoryContext } from '../src/types/plugin.js';
import type { OtelVisualizerStartContext } from '../src/engine/otel/wire.js';

const buildExporters = vi.hoisted(() => vi.fn());

vi.mock('../src/engine/otel/transport.js', () => ({ buildExporters }));

describe('interactive OTel wiring', () => {
  it('carries valid configured attributes through both interactive OTel constructors and reports dropped keys once', async () => {
    const pipelineDir = await mkdtemp(join(process.env.TMPDIR!, 'interactive-otel-'));
    const emitter = new ConductorEventEmitter();
    const spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const rendererErrors: Array<{ rendererName: string; error: string }> = [];
    buildExporters.mockReturnValue({ spanExporter, metricExporter });
    emitter.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') {
        rendererErrors.push({ rendererName: event.rendererName, error: event.error });
      }
    });
    const config = {
      otel: {
        exporter: 'otlp',
        endpoint: 'http://fake-collector:4318',
        attributes: {
          'deployment.environment.name': ' staging ',
          'team.name': ' platform ',
          invalid: 'dropped',
        },
      },
    } as HarnessConfig;
    const context: VisualizerFactoryContext & { startContext: OtelVisualizerStartContext } = {
      config,
      pipelineDir,
      emitter,
      startContext: {
        feature: 'interactive-feature',
        project: '/interactive-project',
        pipelineDir,
        branch: undefined,
        engineVersion: undefined,
        harnessVersion: undefined,
      },
    };

    try {
      const visualizers = buildInteractiveVisualizers(new PluginRegistry(), config, context);
      await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
      await emitter.emit({ type: 'feature_complete', featureDesc: 'interactive-feature' });
      await Promise.all(visualizers.map((visualizer) => visualizer.stop()));

      const metricPoint = metricExporter.getMetrics()
        .flatMap((batch) => batch.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .find((metric) => metric.descriptor.name === 'conductor.step.duration')
        ?.dataPoints[0];
      const traceResource = spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')?.resource.attributes;
      const metricResource = metricExporter.getMetrics()[0]?.resource.attributes;
      const metricPointAttributes = metricPoint?.attributes;
      expect({
        traceResource,
        metricResource,
        metricPoint: metricPointAttributes,
        invalidKeyPresent: {
          traceResource: Object.hasOwn(traceResource ?? {}, 'invalid'),
          metricResource: Object.hasOwn(metricResource ?? {}, 'invalid'),
          metricPoint: Object.hasOwn(metricPointAttributes ?? {}, 'invalid'),
        },
        rendererErrors: { count: rendererErrors.length, events: rendererErrors },
      }).toMatchObject({
        traceResource: { 'deployment.environment.name': 'staging', 'team.name': 'platform' },
        metricResource: { 'deployment.environment.name': 'staging', 'team.name': 'platform' },
        metricPoint: { 'deployment.environment.name': 'staging', 'team.name': 'platform' },
        invalidKeyPresent: { traceResource: false, metricResource: false, metricPoint: false },
        rendererErrors: {
          count: 1,
          events: [{ rendererName: 'otel', error: expect.stringContaining('invalid') }],
        },
      });
    } finally {
      await rm(pipelineDir, { recursive: true, force: true });
    }
  });

  it('starts one helper-wired visualizer with the run identity context and no run-id override', async () => {
    const pipelineDir = await mkdtemp(join(process.env.TMPDIR!, 'interactive-otel-'));
    const emitter = new ConductorEventEmitter();
    const spanExporter = new InMemorySpanExporter();
    buildExporters.mockReturnValue({
      spanExporter,
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    });
    await writeFile(join(pipelineDir, 'conduct-session-id'), 'persisted-interactive-run');
    const context: VisualizerFactoryContext & { startContext: OtelVisualizerStartContext } = {
      config: { otel: { exporter: 'otlp', endpoint: 'http://fake-collector:4318' } } as HarnessConfig,
      pipelineDir,
      emitter,
      startContext: {
        feature: 'interactive-feature',
        project: '/interactive-project',
        pipelineDir,
        branch: undefined,
        engineVersion: undefined,
        harnessVersion: undefined,
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
        names: ['otel', 'otel-metrics'],
        feature: 'interactive-feature',
        project: '/interactive-project',
        pipelineDir,
        runId: 'persisted-interactive-run',
      });
    } finally {
      await rm(pipelineDir, { recursive: true, force: true });
    }
  });

  it('does not read OTEL_RESOURCE_ATTRIBUTES when no operator attributes are declared', async () => {
    const pipelineDir = await mkdtemp(join(process.env.TMPDIR!, 'interactive-otel-'));
    const emitter = new ConductorEventEmitter();
    const spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const rendererErrors: Array<{ error: string }> = [];
    buildExporters.mockReturnValue({ spanExporter, metricExporter });
    emitter.on('renderer_error', (event) => {
      if (event.type === 'renderer_error') rendererErrors.push({ error: event.error });
    });
    vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'deployment.environment=from-environment,team.name=from-environment');
    const config = { otel: { exporter: 'otlp', endpoint: 'http://fake-collector:4318' } } as HarnessConfig;
    const context: VisualizerFactoryContext & { startContext: OtelVisualizerStartContext } = {
      config,
      pipelineDir,
      emitter,
      startContext: {
        feature: 'interactive-feature',
        project: '/interactive-project',
        pipelineDir,
        branch: undefined,
        engineVersion: undefined,
        harnessVersion: undefined,
      },
    };

    try {
      const visualizers = buildInteractiveVisualizers(new PluginRegistry(), config, context);
      await emitter.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await emitter.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
      await emitter.emit({ type: 'feature_complete', featureDesc: 'interactive-feature' });
      await Promise.all(visualizers.map((visualizer) => visualizer.stop()));

      const exportedAttributes = [
        spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')?.resource.attributes,
        metricExporter.getMetrics()[0]?.resource.attributes,
        ...metricExporter.getMetrics()
          .flatMap((batch) => batch.scopeMetrics)
          .flatMap((scope) => scope.metrics)
          .flatMap((metric) => metric.dataPoints.map((point) => point.attributes)),
      ];

      expect(exportedAttributes).not.toContainEqual(expect.objectContaining({
        'deployment.environment': 'from-environment',
        'team.name': 'from-environment',
      }));
      expect(rendererErrors.filter(({ error }) => /attributes/i.test(error))).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await rm(pipelineDir, { recursive: true, force: true });
    }
  });
});
