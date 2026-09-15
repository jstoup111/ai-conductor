// Covers: task:6, task:2, task:5, task:9
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { MetricsListener } from '../../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../../src/engine/otel/metrics.js';
import type { ConductorEvent } from '../../../src/types/events.js';

interface MetricPoint {
  attributes: Record<string, unknown>;
}

function attributesFor(
  exporter: InMemoryMetricExporter,
  name: string,
  step: string,
): Record<string, unknown> | undefined {
  return exporter.getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[])
    .find((point) => point.attributes.step === step)
    ?.attributes;
}

function attributesForInstrument(
  exporter: InMemoryMetricExporter,
  name: string,
): Record<string, unknown>[] {
  return exporter.getMetrics()
    .flatMap((batch) => batch.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[])
    .map((point) => point.attributes);
}

describe('MetricsListener dispatch dimensions', () => {
  it('keeps the terminal-event tier for complete and halt outcomes before daemon dispatch-end', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      undefined,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'feature_complete', tier: 'M' });
      await emitter.emit({ type: 'feature_dispatch_ended', slug: 'feature', outcome: 'complete', tier: 'L' });
      await emitter.emit({ type: 'loop_halt', reason: 'halted', tier: 'S' });
      await emitter.emit({
        type: 'feature_dispatch_ended', slug: 'feature', outcome: 'halted', haltClass: 'mechanical', step: 'build', tier: 'L',
      });
      await provider.forceFlush();

      expect({
        outcomes: attributesForInstrument(exporter, 'conductor.run.outcomes'),
        halts: attributesForInstrument(exporter, 'conductor.feature.halts'),
      }).toEqual({
        outcomes: [
          { outcome: 'complete', tier: 'M', project: 'project', worker: 'worker', feature: 'feature' },
          { outcome: 'halted', tier: 'S', project: 'project', worker: 'worker', feature: 'feature' },
        ],
        halts: [{ haltClass: 'mechanical', step: 'build', tier: 'L', project: 'project', worker: 'worker', feature: 'feature' }],
      });
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('records resolved interactive terminal-only outcomes without dispatch-end', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const completeEmitter = new ConductorEventEmitter();
    const haltEmitter = new ConductorEventEmitter();
    const completeListener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      undefined,
      'interactive-complete',
    );
    const haltListener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      undefined,
      'interactive-halt',
    );
    completeListener.start(completeEmitter);
    haltListener.start(haltEmitter);

    try {
      await completeEmitter.emit({ type: 'feature_complete', tier: 'M' });
      await haltEmitter.emit({ type: 'loop_halt', reason: 'interactive halt', tier: 'S' });
      await provider.forceFlush();

      expect(attributesForInstrument(exporter, 'conductor.run.outcomes')).toEqual([
        { outcome: 'complete', tier: 'M', project: 'project', worker: 'worker', feature: 'interactive-complete' },
        { outcome: 'halted', tier: 'S', project: 'project', worker: 'worker', feature: 'interactive-halt' },
      ]);
    } finally {
      completeListener.stop();
      haltListener.stop();
      await provider.shutdown();
    }
  });

  it('replays tierless historical terminal events through the event persister and listener', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metrics-listener-legacy-terminal-'));
    const eventsPath = join(directory, 'events.jsonl');
    const persisterEmitter = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, persisterEmitter);
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const completeEmitter = new ConductorEventEmitter();
    const haltEmitter = new ConductorEventEmitter();
    const completeListener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }), undefined, 'legacy-complete',
    );
    const haltListener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }), undefined, 'legacy-halt',
    );
    persister.start();
    completeListener.start(completeEmitter);
    haltListener.start(haltEmitter);

    try {
      await persisterEmitter.emit({ type: 'feature_complete' });
      await persisterEmitter.emit({ type: 'loop_halt', reason: 'legacy halt' });
      const historical = (await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as ConductorEvent);
      await completeEmitter.emit(historical[0]!);
      await haltEmitter.emit(historical[1]!);
      await provider.forceFlush();

      expect(attributesForInstrument(exporter, 'conductor.run.outcomes')).toEqual([
        { outcome: 'complete', project: 'project', worker: 'worker', feature: 'legacy-complete' },
        { outcome: 'halted', project: 'project', worker: 'worker', feature: 'legacy-halt' },
      ]);
    } finally {
      persister.stop();
      completeListener.stop();
      haltListener.stop();
      await provider.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('replays a tierless historical dispatch-end record through the event persister and listener', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'metrics-listener-legacy-event-'));
    const eventsPath = join(directory, 'events.jsonl');
    const persisterEmitter = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, persisterEmitter);
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const listenerEmitter = new ConductorEventEmitter();
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
    );
    persister.start();
    listener.start(listenerEmitter);

    try {
      await expect(persisterEmitter.emit({
        type: 'feature_dispatch_ended', slug: 'legacy-feature', outcome: 'terminated',
      })).resolves.toBeUndefined();
      const [line] = (await readFile(eventsPath, 'utf8')).trim().split('\n');
      const historical = JSON.parse(line) as ConductorEvent;

      expect(historical).not.toHaveProperty('tier');
      await expect(listenerEmitter.emit(historical)).resolves.toBeUndefined();
      await provider.forceFlush();

      expect(attributesForInstrument(exporter, 'conductor.run.outcomes')).toContainEqual({
        outcome: 'terminated', project: 'project', worker: 'worker', feature: 'legacy-feature',
      });
    } finally {
      persister.stop();
      listener.stop();
      await provider.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains the latest complete dispatch dimensions when a step fails', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    let now = 100;
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      () => now,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', model: 'opus', effort: 'high', tier: 'M', invoked: true, outcome: 'failure',
      });
      now = 125;
      await emitter.emit({ type: 'step_failed', step: 'build', error: 'failed', retryCount: 0 });
      await provider.forceFlush();

      expect(attributesFor(exporter, 'conductor.step.duration', 'build')).toEqual({
        step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M',
        project: 'project', worker: 'worker', feature: 'feature',
      });
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('counts invoked attempts once with provider and explicit fallback state', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      undefined,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', preferredProvider: 'codex',
        model: 'opus', effort: 'high', tier: 'M', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'provider_attempt', step: 'plan', provider: 'claude', preferredProvider: 'claude',
        invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'provider_attempt', step: 'finish', provider: 'claude', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'provider-lifecycle', invoked: false,
        outcome: 'success', lifecycle: { phase: 'settled', attemptId: 'attempt-1', recoveryCount: 0 },
      });
      await emitter.emit({
        type: 'step_completed', step: 'build', status: 'done', actualProvider: 'claude',
      });
      await provider.forceFlush();

      expect(attributesForInstrument(exporter, 'conductor.step.dispatches')).toEqual([
        { step: 'build', metering: 'unmetered', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', fallback: true, project: 'project', worker: 'worker', feature: 'feature' },
        { step: 'plan', metering: 'unmetered', provider: 'claude', fallback: false, project: 'project', worker: 'worker', feature: 'feature' },
        { step: 'finish', metering: 'unmetered', provider: 'claude', project: 'project', worker: 'worker', feature: 'feature' },
      ]);
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('keeps fallback on dispatches while omitting it from duration and retries', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      undefined,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', preferredProvider: 'codex',
        model: 'opus', effort: 'high', tier: 'M', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry',
        model: 'opus', effort: 'high', provider: 'claude', tier: 'M',
      });
      await emitter.emit({
        type: 'step_completed', step: 'build', status: 'done', actualProvider: 'claude',
        model: 'opus', effort: 'high', tier: 'M',
      });
      await provider.forceFlush();

      expect(attributesFor(exporter, 'conductor.step.duration', 'build')).not.toHaveProperty('fallback');
      expect(attributesFor(exporter, 'conductor.step.retries', 'build')).not.toHaveProperty('fallback');
      expect(attributesFor(exporter, 'conductor.step.dispatches', 'build')).toMatchObject({ fallback: true });
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('projects close and retry dimensions without retaining them for dimensionless or orphan events', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    let now = 100;
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      () => now,
      'feature',
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'step_started', step: 'build', index: 0 });
      await emitter.emit({
        type: 'provider_attempt', step: 'build', provider: 'claude', model: 'opus', invoked: true, outcome: 'success',
      });
      await emitter.emit({
        type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry',
        model: 'opus', effort: 'high', provider: 'claude', tier: 'M',
      });
      await emitter.emit({ type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'dimensionless retry' });
      now = 125;
      await emitter.emit({
        type: 'step_completed', step: 'build', status: 'done', model: 'opus', effort: 'high', tier: 'M', actualProvider: 'claude',
      });

      await emitter.emit({ type: 'step_started', step: 'plan', index: 1 });
      now = 150;
      await emitter.emit({ type: 'step_completed', step: 'plan', status: 'done' });
      await emitter.emit({ type: 'step_retry', step: 'plan', attempt: 1, maxAttempts: 3, reason: 'dimensionless retry' });
      await emitter.emit({ type: 'step_retry', step: 'finish', attempt: 1, maxAttempts: 3, reason: 'orphan retry' });
      await provider.forceFlush();

      const identity = { project: 'project', worker: 'worker', feature: 'feature' };
      expect(attributesFor(exporter, 'conductor.step.duration', 'build')).toEqual({
        step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', ...identity,
      });
      const buildRetryPoints = exporter.getMetrics()
        .flatMap((batch) => batch.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === 'conductor.step.retries')
        .flatMap((metric) => metric.dataPoints as unknown as MetricPoint[])
        .filter((point) => point.attributes.step === 'build')
        .map((point) => point.attributes);
      expect(buildRetryPoints).toContainEqual({
        step: 'build', model: 'opus', effort: 'high', provider: 'claude', tier: 'M', ...identity,
      });
      expect(buildRetryPoints).toContainEqual({ step: 'build', ...identity });
      expect(attributesFor(exporter, 'conductor.step.duration', 'plan')).toEqual({ step: 'plan', ...identity });
      expect(attributesFor(exporter, 'conductor.step.retries', 'plan')).toEqual({ step: 'plan', ...identity });
      expect(attributesFor(exporter, 'conductor.step.retries', 'finish')).toEqual({ step: 'finish', ...identity });
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });

  it('projects feature-event tiers to activity and outcome points without inferring absent tiers', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    const emitter = new ConductorEventEmitter();
    let now = 100;
    const listener = new MetricsListener(
      new MetricsRecorder(provider.getMeter('metrics-listener'), { project: 'project', worker: 'worker' }),
      () => now,
    );
    listener.start(emitter);

    try {
      await emitter.emit({ type: 'feature_dispatch_started', slug: 'tiered', kind: 'fresh', tier: 'M' });
      await emitter.emit({
        type: 'feature_dispatch_ended', slug: 'tiered', outcome: 'halted', haltClass: 'mechanical', step: 'build', tier: 'L',
      });
      now = 125;
      await emitter.emit({
        type: 'feature_shipped', slug: 'tiered', runStartedAt: 100, active: { state: 'exact', activeMs: 20 }, tier: 'S',
      });
      now = 150;
      await emitter.emit({
        type: 'feature_shipped', slug: 'partial', runStartedAt: 100, active: { state: 'partial' }, tier: 'S',
      });

      await emitter.emit({ type: 'feature_dispatch_started', slug: 'untiered', kind: 'fresh' });
      await emitter.emit({
        type: 'feature_dispatch_ended', slug: 'untiered', outcome: 'halted', haltClass: 'mechanical', step: 'build',
      });
      await emitter.emit({
        type: 'feature_shipped', slug: 'untiered', runStartedAt: 100, active: { state: 'exact', activeMs: 20 },
      });
      await provider.forceFlush();

      const tiered = (name: string) => attributesForInstrument(exporter, name).filter((attributes) => attributes.tier !== undefined);
      const untiered = (name: string) => attributesForInstrument(exporter, name).filter((attributes) => attributes.feature === 'untiered');
      expect(tiered('conductor.feature.dispatches')).toEqual([{ kind: 'fresh', tier: 'M', project: 'project', worker: 'worker', feature: 'tiered' }]);
      expect(tiered('conductor.feature.halts')).toEqual([{ haltClass: 'mechanical', step: 'build', tier: 'L', project: 'project', worker: 'worker', feature: 'tiered' }]);
      expect(tiered('conductor.run.outcomes')).toEqual([{ outcome: 'halted', tier: 'L', project: 'project', worker: 'worker', feature: 'tiered' }]);
      expect(tiered('conductor.feature.shipped')).toEqual([
        { tier: 'S', project: 'project', worker: 'worker', feature: 'tiered' },
        { tier: 'S', project: 'project', worker: 'worker', feature: 'partial' },
      ]);
      expect(tiered('conductor.feature.duration.wall')).toEqual([
        { tier: 'S', project: 'project', worker: 'worker', feature: 'tiered' },
        { tier: 'S', project: 'project', worker: 'worker', feature: 'partial' },
      ]);
      expect(tiered('conductor.feature.duration.active')).toEqual([{ tier: 'S', project: 'project', worker: 'worker', feature: 'tiered' }]);
      expect(untiered('conductor.feature.dispatches')).toEqual([{ kind: 'fresh', project: 'project', worker: 'worker', feature: 'untiered' }]);
      expect(untiered('conductor.feature.halts')).toEqual([{ haltClass: 'mechanical', step: 'build', project: 'project', worker: 'worker', feature: 'untiered' }]);
      expect(untiered('conductor.run.outcomes')).toEqual([{ outcome: 'halted', project: 'project', worker: 'worker', feature: 'untiered' }]);
      expect(untiered('conductor.feature.shipped')).toEqual([{ project: 'project', worker: 'worker', feature: 'untiered' }]);
      expect(untiered('conductor.feature.duration.wall')).toEqual([{ project: 'project', worker: 'worker', feature: 'untiered' }]);
      expect(untiered('conductor.feature.duration.active')).toEqual([{ project: 'project', worker: 'worker', feature: 'untiered' }]);
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });
});
