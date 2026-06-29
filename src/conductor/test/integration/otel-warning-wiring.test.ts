/**
 * FR-8 regression: onWarning MUST be wired at the production construction site.
 *
 * Before the fix: createOtelVisualizer did not exist; the orphaned OtelVisualizer
 * was constructed in main() WITHOUT onWarning, so a dead/refused transport produced
 * ZERO operator warnings. This test drives the REAL production construction path
 * (createOtelVisualizer) and asserts:
 *
 *  (a) onWarning IS wired — exporters are wrapped in WarnOnce* — so a failing
 *      transport surfaces exactly ONE renderer_error on the shared bus.
 *  (b) The visualizer is constructed successfully (not null on the happy path).
 *  (c) The run never throws even when every export call fails.
 *
 * Failing-test-first gate: before the fix, importing createOtelVisualizer from
 * src/index.ts fails (no such export) → import error = RED. After the fix: GREEN.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { PushMetricExporter, ResourceMetrics } from '@opentelemetry/sdk-metrics';
import type { ExportResult } from '@opentelemetry/core';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { resolveOtelConfig } from '../../src/engine/otel/otel-config.js';
// Import the PRODUCTION construction helper — this import is what drives RED
// before the fix (function does not exist as an export).
import { createOtelVisualizer } from '../../src/index.js';
import type { ConductorEvent } from '../../src/types/events.js';

/** Span exporter that always calls back with FAILED — dead/refused transport. */
function makeFailingSpanExporter(): SpanExporter {
  return {
    export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
      resultCallback({ code: ExportResultCode.FAILED, error: new Error('connection refused') });
    },
    async shutdown(): Promise<void> {},
  };
}

/** Metric exporter that always calls back with FAILED. */
function makeFailingMetricExporter(): PushMetricExporter {
  return {
    export(_metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
      resultCallback({ code: ExportResultCode.FAILED, error: new Error('connection refused') });
    },
    async forceFlush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

describe('FR-8: onWarning wired at production construction site (createOtelVisualizer)', () => {
  let tempDir: string;
  let pipelineDir: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-warn-wire-'));
    pipelineDir = join(tempDir, '.pipeline');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it(
    'dead exporter → exactly ONE renderer_error on the bus, nothing throws',
    async () => {
      const resolved = resolveOtelConfig(
        { otel: { exporter: 'otlp', endpoint: 'http://localhost:4318' } },
        pipelineDir,
      );

      const rendererErrors: ConductorEvent[] = [];
      events.on('renderer_error', (ev) => rendererErrors.push(ev));

      // PRODUCTION construction path — this is what main() must call.
      const vis = createOtelVisualizer(
        resolved,
        {
          runId: 'fr8-warn-1',
          feature: 'fr8-regression',
          project: 'test-project',
          spanExporter: makeFailingSpanExporter(),
          metricExporter: makeFailingMetricExporter(),
          exportTimeoutMillis: 200, // keep test fast
        },
        events,
      );

      // Visualizer must be constructed successfully on the happy path.
      expect(vis).not.toBeNull();

      vis!.start(events);
      await events.emit({ type: 'step_started', step: 'bootstrap', index: 0 });
      await events.emit({ type: 'step_completed', step: 'bootstrap', status: 'done' });
      await events.emit({ type: 'feature_complete', featureDesc: 'fr8-test' });
      await vis!.stop();

      // Exactly ONE renderer_error regardless of how many export callbacks fired.
      expect(rendererErrors).toHaveLength(1);
      expect(rendererErrors[0]).toMatchObject({
        type: 'renderer_error',
        rendererName: 'otel',
      });
      expect(typeof (rendererErrors[0] as { error: string }).error).toBe('string');
      expect((rendererErrors[0] as { error: string }).error.length).toBeGreaterThan(0);
    },
    15_000,
  );

  it('constructor throw (disabled config) → null returned, one renderer_error emitted, nothing throws', () => {
    // When OtelVisualizer is called with a disabled config its constructor throws
    // (FR-1 invariant). createOtelVisualizer must catch that and surface it.
    const disabledResolved = resolveOtelConfig({}, pipelineDir); // enabled=false
    expect(disabledResolved.enabled).toBe(false);

    const rendererErrors: ConductorEvent[] = [];
    events.on('renderer_error', (ev) => rendererErrors.push(ev));

    let threw = false;
    let vis: ReturnType<typeof createOtelVisualizer> | undefined;
    try {
      vis = createOtelVisualizer(
        disabledResolved,
        { runId: 'fr8-null', feature: 'test', project: 'test' },
        events,
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);       // must not propagate
    expect(vis).toBeNull();           // null = run proceeds with OTel disabled
    expect(rendererErrors).toHaveLength(1);
    expect(rendererErrors[0]).toMatchObject({ type: 'renderer_error', rendererName: 'otel' });
  });
});
