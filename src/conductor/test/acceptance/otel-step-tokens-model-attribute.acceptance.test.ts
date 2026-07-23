/**
 * Acceptance specs for .docs/stories/per-feature-token-accounting.md Story 6
 * (#537), governed by .docs/plans/per-feature-token-accounting.md Task 9.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): `MetricsRecorder.onStepClose` (metrics.ts)
 * and `OtelVisualizer`'s `step_completed` handling (otel-visualizer.ts) both
 * already exist and are already unit-tested in isolation
 * (test/engine/otel/metrics.test.ts T15/T16) — those specs prove the
 * counter records token KINDS but never touch the `model` attribute, because
 * the event object flowing through today never carries `model` (Story 2 is
 * the same underlying gap: `conductor.ts:5127`'s emit call site doesn't
 * populate it). A unit test that calls `MetricsRecorder.onStepClose(...,
 * tokenUsage)` directly with a hand-built `model` argument would pass even
 * if the real event-driven wiring (`ConductorEventEmitter` ->
 * `OtelVisualizer.handleEvent` -> stashed model -> `onStepClose`) never
 * threads it through — the exact wiring-not-the-primitive gap this skill's
 * §3b targets. This file drives the REAL entry point: a `ConductorEvent`
 * emitted through a real `ConductorEventEmitter` into a real
 * `OtelVisualizer`, reading the exported counter's data-point attributes via
 * `InMemoryMetricExporter` (matching the existing T15/T16 convention) —
 * never calling `MetricsRecorder`/`SpanManager` methods directly.
 *
 * PRE-FIX RED: as of this file's authoring, `step_completed` has no `model`
 * field on the event type, `OtelVisualizer` never stashes/forwards one, and
 * `MetricsRecorder.recordTokens` never adds a `model` attribute — the token
 * counter's data points carry only `{step, kind}`.
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
    .find((m) => m.descriptor.name === 'conductor.step.tokens');
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

describe('acceptance: conductor.step.tokens carries the model attribute, fed end-to-end from step_completed (Story 6, #537)', () => {
  it('happy: a step_completed event with tokenUsage + model produces token counter data points tagged with that model', async () => {
    const vis = makeVisualizer();
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({
      type: 'step_completed',
      step: 'build',
      status: 'done',
      tokenUsage: { input: 800, output: 150, cacheRead: 0, cacheCreation: 0 },
      model: 'claude-sonnet-5',
    } as never);
    await vis.stop();

    const tokensMetric = findTokensMetric(metricExporter);
    expect(tokensMetric).toBeDefined();
    const buildPoints = tokensMetric!.dataPoints.filter((d) => d.attributes['step'] === 'build');
    expect(buildPoints.length).toBeGreaterThan(0);
    for (const point of buildPoints) {
      expect(point.attributes['model']).toBe('claude-sonnet-5');
    }
  });

  it('two steps dispatched at different models produce token data points tagged with their OWN model, not the other step\'s', async () => {
    const vis = makeVisualizer();
    vis.start(emitter);

    await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
    await emitter.emit({
      type: 'step_completed',
      step: 'build',
      status: 'done',
      tokenUsage: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
      model: 'claude-sonnet-5',
    } as never);
    await emitter.emit({ type: 'step_started', step: 'plan', index: 1 });
    await emitter.emit({
      type: 'step_completed',
      step: 'plan',
      status: 'done',
      tokenUsage: { input: 300, output: 60, cacheRead: 0, cacheCreation: 0 },
      model: 'claude-opus-4-8',
    } as never);
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
