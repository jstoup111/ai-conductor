/**
 * Acceptance specs for cumulative feature token dimensions.
 *
 * This drives the real event path from a feature_cost_snapshot through the
 * visualizer and verifies the exported gauge's model labels.
 *
 * Story 6's negative path (OTel disabled/unconfigured must never block
 * ship-time rollup or `conduct kpi`) is proven structurally, not duplicated
 * here: the companion Story 3/4 acceptance specs
 * (per-feature-cost-rollup-committed-at-ship.acceptance.test.ts,
 * conduct-kpi-real-binary.acceptance.test.ts) drive `dispatchShippedRecord`
 * and the real `conduct kpi` binary with NO OtelVisualizer/OTel config
 * present at all, and both pass on their own — OTel is never a dependency
 * of either code path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
import { OtelVisualizer } from '../../src/engine/otel/otel-visualizer.js';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { InMemoryMetricExporter, AggregationTemporality } from '@opentelemetry/sdk-metrics';

function findTokensMetric(exporter: InMemoryMetricExporter) {
  return exporter
    .getMetrics()
    .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics))
    .find((m) => m.descriptor.name === 'conductor.feature.step.tokens');
}

let tempDir: string;
let pipelineDir: string;
let spanExporter: InMemorySpanExporter;
let metricExporter: InMemoryMetricExporter;
let emitter: ConductorEventEmitter;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'otel-model-attr-'));
  pipelineDir = join(tempDir, '.pipeline');
  spanExporter = new InMemorySpanExporter();
  metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  emitter = new ConductorEventEmitter();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeVisualizer(): OtelVisualizer {
  const resolved = resolveOtelConfig(
    { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
    pipelineDir,
  );
  return new OtelVisualizer(resolved, {
    runId: 'test-model-attr',
    feature: 'test-feature',
    project: 'test-project',
    spanExporter,
    metricExporter,
  });
}

describe('acceptance: conductor.feature.step.tokens carries the model attribute from a feature_cost_snapshot', () => {
  it('happy: a snapshot produces token gauge data points tagged with its model', async () => {
    const vis = makeVisualizer();
    vis.start(emitter);

    await emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 0.5, costComplete: true, byDimension: [],
      tokensByDimension: [{ step: 'build', model: 'claude-sonnet-5', tokens: { input: 800, output: 150 } }],
    });
    await vis.stop();

    const tokensMetric = findTokensMetric(metricExporter);
    expect(tokensMetric).toBeDefined();
    const buildPoints = tokensMetric!.dataPoints.filter((d) => d.attributes['step'] === 'build');
    expect(buildPoints.length).toBeGreaterThan(0);
    for (const point of buildPoints) {
      expect(point.attributes['model']).toBe('claude-sonnet-5');
    }
  });

  it('two snapshot dimensions at different models retain their own model labels', async () => {
    const vis = makeVisualizer();
    vis.start(emitter);

    await emitter.emit({
      type: 'feature_cost_snapshot', costUsd: 0.5, costComplete: true, byDimension: [],
      tokensByDimension: [
        { step: 'build', model: 'claude-sonnet-5', tokens: { input: 100, output: 20 } },
        { step: 'plan', model: 'claude-opus-4-8', tokens: { input: 300, output: 60 } },
      ],
    });
    await vis.stop();

    const tokensMetric = findTokensMetric(metricExporter);
    expect(tokensMetric).toBeDefined();
    const buildModels = new Set(
      tokensMetric!.dataPoints.filter((d) => d.attributes['step'] === 'build').map((d) => d.attributes['model']),
    );
    const planModels = new Set(
      tokensMetric!.dataPoints.filter((d) => d.attributes['step'] === 'plan').map((d) => d.attributes['model']),
    );
    expect(buildModels).toEqual(new Set(['claude-sonnet-5']));
    expect(planModels).toEqual(new Set(['claude-opus-4-8']));
  });
});
