import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { CapturingSpanExporter } from '../fixtures/capturing-span-exporter.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';

function makeVisualizer(feature: string, spanExporter: CapturingSpanExporter): OtelVisualizer {
  return new OtelVisualizer(
    resolveOtelConfig(
      { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
      join(process.cwd(), '.pipeline', 'otel-visualizer-parity', feature),
    ),
    { spanExporter },
  );
}

function features(exporter: CapturingSpanExporter): string[] {
  return exporter
    .getFinishedSpans()
    .map((span: ReadableSpan) => span.resource.attributes['conductor.feature'])
    .filter((feature): feature is string => typeof feature === 'string');
}

describe('OtelVisualizer concurrent dispatch isolation', () => {
  it('flushes two feature-scoped buses without crossing enriched spans', async () => {
    const alphaEmitter = new ConductorEventEmitter();
    const betaEmitter = new ConductorEventEmitter();
    const alphaExporter = new CapturingSpanExporter();
    const betaExporter = new CapturingSpanExporter();
    const alpha = makeVisualizer('alpha', alphaExporter);
    const beta = makeVisualizer('beta', betaExporter);

    alpha.start(alphaEmitter, { runId: 'run-alpha', feature: 'alpha', project: 'repo' });
    beta.start(betaEmitter, { runId: 'run-beta', feature: 'beta', project: 'repo' });
    await Promise.all([
      alphaEmitter.emit({ type: 'step_started', step: 'build', index: 0 }),
      betaEmitter.emit({ type: 'step_started', step: 'build', index: 0 }),
    ]);
    await Promise.all([
      alphaEmitter.emit({ type: 'step_completed', step: 'build', status: 'done' }),
      betaEmitter.emit({ type: 'step_completed', step: 'build', status: 'done' }),
    ]);
    await Promise.all([
      alphaEmitter.emit({ type: 'feature_complete' }),
      betaEmitter.emit({ type: 'feature_complete' }),
    ]);
    await Promise.all([alpha.stop(), beta.stop()]);

    expect(features(alphaExporter)).toEqual(['alpha', 'alpha']);
    expect(features(betaExporter)).toEqual(['beta', 'beta']);
  });
});
