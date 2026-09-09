import { describe, expect, it } from 'vitest';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { MetricsListener } from '../../../src/engine/otel/metrics-listener.js';
import { MetricsRecorder } from '../../../src/engine/otel/metrics.js';

// Covers: task:1
describe('memory setup OTel projection', () => {
  it('exports setup outcomes before any step starts without exporting failure text', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })] });
    const emitter = new ConductorEventEmitter();
    const listener = new MetricsListener(new MetricsRecorder(provider.getMeter('test'), { project: 'project', worker: 'worker' }), undefined, 'feature');
    listener.start(emitter);
    try {
      await emitter.emit({ type: 'memory_setup', before: 'absent', canonical: true });
      await emitter.emit({ type: 'memory_setup', before: 'directory', canonical: false, reason: '/private/home: permission denied' });
      await provider.forceFlush();
      const metric = exporter.getMetrics().flatMap(batch => batch.scopeMetrics).flatMap(scope => scope.metrics).find(item => item.descriptor.name === 'conductor.memory.setup');
      expect(metric?.dataPoints).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: 1, attributes: { project: 'project', worker: 'worker', feature: 'feature', before: 'absent', canonical: true } }),
        expect.objectContaining({ value: 1, attributes: { project: 'project', worker: 'worker', feature: 'feature', before: 'directory', canonical: false } }),
      ]));
      expect(metric?.dataPoints).toHaveLength(2);
      expect(JSON.stringify(metric)).not.toContain('/private/home');
    } finally {
      listener.stop();
      await provider.shutdown();
    }
  });
});
