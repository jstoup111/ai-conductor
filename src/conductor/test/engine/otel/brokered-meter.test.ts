// Covers: task:2, task:3
import { describe, expect, it } from 'vitest';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { createBrokeredInstrumentHost, createBrokeredMeter } from '../../../src/engine/otel/brokered-meter.js';
import { MetricsRecorder } from '../../../src/engine/otel/metrics.js';

describe('brokered meter', () => {
  it('forwards every MetricsRecorder instrument and recording synchronously', () => {
    const messages: unknown[] = [];
    let returned = false;
    let recordWasSynchronous = false;
    const recorder = new MetricsRecorder(
      createBrokeredMeter((message) => {
        if (message.op === 'record') recordWasSynchronous ||= !returned;
        messages.push(message);
      }),
      { project: 'p', worker: 'w' },
      { team: 'core' },
    );
    recorder.onStepClose('build', 2, 0);
    returned = true;
    recorder.onStepTerminal('build', 'success');
    expect(returned).toBe(true);
    expect(recordWasSynchronous).toBe(true);
    const creates = messages.filter((message) => (message as { op: string }).op === 'create') as Array<{
      instrumentId: string;
    }>;
    expect(new Set(creates.map((message) => message.instrumentId)).size).toBe(creates.length);
    expect(messages.filter((message) => (message as { op: string }).op === 'record')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 2,
          attributes: expect.objectContaining({ project: 'p', worker: 'w', team: 'core' }),
        }),
        expect.objectContaining({
          value: 1,
          attributes: expect.objectContaining({ project: 'p', worker: 'w', team: 'core' }),
        }),
      ]),
    );
    const before = messages.length;
    const meter = createBrokeredMeter((message) => messages.push(message));
    for (const create of [
      meter.createObservableGauge,
      meter.createObservableCounter,
      meter.createObservableUpDownCounter,
    ]) {
      expect(() => create.call(meter, 'unsupported')).toThrow(/observable/);
    }
    expect(messages).toHaveLength(before);
  });

  it('materializes instruments once and overwrites reserved dispatcher identity', () => {
    const records: Array<{ value: number; attributes: Record<string, unknown> }> = [];
    const meter = {
      createCounter: () => ({
        add: (value: number, attributes: Record<string, unknown>) => records.push({ value, attributes }),
      }),
    } as never;
    const handler = createBrokeredInstrumentHost(meter, { project: 'project', worker: 'worker' }).forDispatch(
      'feature',
    );
    handler.handle({
      kind: 'meter',
      op: 'create',
      instrumentId: 'i',
      name: 'conductor.test',
      instrumentKind: 'counter',
    });
    handler.handle({
      kind: 'meter',
      op: 'record',
      instrumentId: 'i',
      value: 1,
      attributes: { project: 'bad', feature: 'bad' },
    });
    handler.close();
    handler.handle({ kind: 'meter', op: 'record', instrumentId: 'i', value: 2, attributes: {} });
    handler.handle({ kind: 'meter', op: 'create', instrumentId: 'late', name: 'late', instrumentKind: 'counter' });
    expect(records).toEqual([{ value: 1, attributes: { project: 'project', worker: 'worker', feature: 'feature' } }]);
  });

  it('uses the provider meter storage for host and brokered points in one stream', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    try {
      const meter = provider.getMeter('shared');
      meter.createHistogram('conductor.step.duration').record(1, { feature: 'host' });
      const host = createBrokeredInstrumentHost(meter, { project: 'p', worker: 'w' }).forDispatch('child');
      host.handle({
        kind: 'meter',
        op: 'create',
        instrumentId: 'step',
        name: 'conductor.step.duration',
        instrumentKind: 'histogram',
      });
      host.handle({ kind: 'meter', op: 'record', instrumentId: 'step', value: 2, attributes: {} });
      await provider.forceFlush();
      const metrics = exporter
        .getMetrics()
        .flatMap((batch) => batch.scopeMetrics)
        .flatMap((scope) => scope.metrics)
        .filter((metric) => metric.descriptor.name === 'conductor.step.duration');
      expect(metrics).toHaveLength(1);
      expect(metrics[0]!.dataPoints).toHaveLength(2);
    } finally {
      await provider.shutdown();
    }
  });
});
