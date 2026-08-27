// Covers: task:4
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
    };
    buildExporters.mockReturnValue({
      spanExporter,
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    });

    try {
      const disabled = wireOtelVisualizer({}, context, events);
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
        name: visualizer?.name,
        started: subscribed.mock.calls.length > 0,
        runId: spanExporter.getFinishedSpans().find((span) => span.name === 'conductor.run')
          ?.resource.attributes['conductor.run.id'],
        wroteSessionId: existsSync(join(pipelineDir, 'conduct-session-id')),
      }).toEqual({
        disabled: null,
        name: 'otel',
        started: true,
        runId: 'wire-test-run',
        wroteSessionId: false,
      });
    } finally {
      await rm(pipelineDir, { recursive: true, force: true });
    }
  });
});
