// Covers: task:2, task:4
import { describe, expect, it, vi } from 'vitest';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { wireOtelVisualizer } from '../src/engine/otel/wire.js';

const buildExporters = vi.hoisted(() => vi.fn());

vi.mock('../src/engine/otel/transport.js', () => ({ buildExporters }));

type OtelWireContext = Parameters<typeof wireOtelVisualizer>[1];

const resolvedOtelContext: OtelWireContext = {
  pipelineDir: '/tmp/otel-wire',
  branch: 'feature/otel-wire',
  engineVersion: '1.2.3',
};

const unresolvedOtelContext: OtelWireContext = {
  pipelineDir: '/tmp/otel-wire',
  branch: undefined,
  engineVersion: undefined,
};

// @ts-expect-error Supported OTel wiring must receive the branch resolution result.
const missingOtelBranch: OtelWireContext = {
  pipelineDir: '/tmp/otel-wire',
  engineVersion: '1.2.3',
};

// @ts-expect-error Supported OTel wiring must receive the engine-version resolution result.
const missingOtelEngineVersion: OtelWireContext = {
  pipelineDir: '/tmp/otel-wire',
  branch: 'feature/otel-wire',
};

void resolvedOtelContext;
void unresolvedOtelContext;
void missingOtelBranch;
void missingOtelEngineVersion;

describe('wireOtelVisualizer', () => {
  it('gates disabled OTel and starts enabled fake OTLP from the registry factory without writing an injected run id', async () => {
    const pipelineDir = await mkdtemp(join(tmpdir(), 'otel-wire-'));
    const events = new ConductorEventEmitter();
    const subscribed = vi.spyOn(events, 'on');
    const spanExporter = new InMemorySpanExporter();
    const context = {
      pipelineDir,
      runId: 'wire-test-run',
      feature: 'otel-wire',
      project: 'ai-conductor',
      branch: 'feature/otel-wire',
      engineVersion: '1.2.3',
    };
    buildExporters.mockReturnValue({
      spanExporter,
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    });

    try {
      const disabled = wireOtelVisualizer({}, context, events);
      const disabledListenerCount = subscribed.mock.calls.length;
      const visualizer = wireOtelVisualizer(
        { otel: { exporter: 'otlp', endpoint: 'http://fake-collector:4318' } },
        context,
        events,
      );
      await events.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await events.emit({ type: 'feature_complete', featureDesc: 'otel-wire' });

      await visualizer?.stop();

      expect({
        disabled,
        disabledListenerCount,
        name: visualizer?.name,
        started: subscribed.mock.calls.length > 0,
        runId: spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')
          ?.resource.attributes['conductor.run.id'],
        branch: spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')
          ?.resource.attributes['conductor.branch'],
        engineVersion: spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')
          ?.resource.attributes['conductor.engine.version'],
        wroteSessionId: existsSync(join(pipelineDir, 'conduct-session-id')),
      }).toEqual({
        disabled: null,
        disabledListenerCount: 0,
        name: 'otel',
        started: true,
        runId: 'wire-test-run',
        branch: 'feature/otel-wire',
        engineVersion: '1.2.3',
        wroteSessionId: false,
      });
    } finally {
      await rm(pipelineDir, { recursive: true, force: true });
    }
  });

  it('exports omitted resolution inputs as not-supplied while retaining explicit unresolved values', async () => {
    const omittedPipelineDir = await mkdtemp(join(tmpdir(), 'otel-wire-omitted-'));
    const unresolvedPipelineDir = await mkdtemp(join(tmpdir(), 'otel-wire-unresolved-'));
    const omittedEvents = new ConductorEventEmitter();
    const unresolvedEvents = new ConductorEventEmitter();
    const omittedExporter = new InMemorySpanExporter();
    const unresolvedExporter = new InMemorySpanExporter();
    const config = { otel: { exporter: 'otlp' as const, endpoint: 'http://fake-collector:4318' } };

    buildExporters
      .mockReturnValueOnce({
        spanExporter: omittedExporter,
        metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      })
      .mockReturnValueOnce({
        spanExporter: unresolvedExporter,
        metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      });

    try {
      const omitted = wireOtelVisualizer(
        config,
        {
          pipelineDir: omittedPipelineDir,
          runId: 'omitted-run',
          feature: 'otel-wire',
          project: 'ai-conductor',
        } as OtelWireContext,
        omittedEvents,
      );
      const unresolved = wireOtelVisualizer(
        config,
        {
          pipelineDir: unresolvedPipelineDir,
          runId: 'unresolved-run',
          feature: 'otel-wire',
          project: 'ai-conductor',
          branch: undefined,
          engineVersion: undefined,
        },
        unresolvedEvents,
      );

      await omittedEvents.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await unresolvedEvents.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await omittedEvents.emit({ type: 'feature_complete', featureDesc: 'otel-wire' });
      await unresolvedEvents.emit({ type: 'feature_complete', featureDesc: 'otel-wire' });
      await omitted?.stop();
      await unresolved?.stop();

      expect({
        omitted: omittedExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')
          ?.resource.attributes,
        unresolved: unresolvedExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')
          ?.resource.attributes,
      }).toMatchObject({
        omitted: {
          'conductor.branch': 'not-supplied',
          'conductor.engine.version': 'not-supplied',
        },
        unresolved: {
          'conductor.branch': 'unresolved',
          'conductor.engine.version': 'unresolved',
        },
      });
    } finally {
      await rm(omittedPipelineDir, { recursive: true, force: true });
      await rm(unresolvedPipelineDir, { recursive: true, force: true });
    }
  });
});
