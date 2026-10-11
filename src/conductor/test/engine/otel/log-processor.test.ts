// Covers: task:9, task:23
import { describe, expect, it, vi } from 'vitest';
import { context } from '@opentelemetry/api';
import { BoundedLogProcessor } from '../../../src/engine/otel/log-processor.js';
import { withLogRecordByteSize } from '../../../src/engine/otel/log-record.js';

const record = (body: string) => ({ body, attributes: {}, resource: {}, instrumentationScope: {}, hrTime: [0, 0], hrTimeObserved: [0, 0], droppedAttributesCount: 0 }) as never;
const emit = (processor: BoundedLogProcessor, logRecord: ReturnType<typeof record>, byteSize = Buffer.byteLength((logRecord as { body: string }).body, 'utf8')) => {
  processor.onEmit(logRecord, withLogRecordByteSize(context.active(), byteSize));
};

describe('BoundedLogProcessor', () => {
  it('bounds a stalled exporter completion and ignores its late callback', async () => {
    vi.useFakeTimers();
    const callbacks: Array<(result: { code: number }) => void> = [];
    const processor = new BoundedLogProcessor({
      export(_records, done) { callbacks.push(done); },
    }, { delayMs: 60_000, maxRecords: 2 });
    emit(processor, record('first'));
    const firstFlush = processor.forceFlush();

    try {
      expect(callbacks).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(firstFlush).resolves.toBeUndefined();

      emit(processor, record('second'));
      const secondFlush = processor.forceFlush();
      expect(callbacks).toHaveLength(2);
      callbacks[0]({ code: 0 });
      callbacks[1]({ code: 0 });
      await expect(secondFlush).resolves.toBeUndefined();
    } finally {
      await processor.shutdown();
      vi.useRealTimers();
    }
  });

  it('admits synchronously, drops overflowing newest records, and settles once', async () => {
    const delivered: unknown[][] = [];
    const dropped: number[] = [];
    const processor = new BoundedLogProcessor({ export(records, done) { delivered.push(records); done({ code: 0 }); } }, {
      delayMs: 1, maxRecords: 1, onDrop: (count) => dropped.push(count),
    });
    emit(processor, record('one'));
    emit(processor, record('two'));
    await processor.forceFlush();
    expect({ batches: delivered.length, records: delivered[0]?.length, dropped }).toEqual({ batches: 1, records: 1, dropped: [1] });
    expect((delivered[0]?.[0] as { body: string }).body).toBe('one');
    await processor.shutdown(); await processor.shutdown();
  });

  it('returns from producers while an exporter is pending', async () => {
    const callbacks: Array<(result: { code: number }) => void> = [];
    const dropped: number[] = [];
    const processor = new BoundedLogProcessor({ export(_records, done) { callbacks.push(done); } }, {
      delayMs: 60_000, maxRecords: 2, onDrop: (count) => dropped.push(count),
    });

    emit(processor, record('first'));
    const flushing = processor.forceFlush();
    expect(callbacks).toHaveLength(1);

    expect(emit(processor, record('second'))).toBeUndefined();
    expect(dropped).toEqual([]);

    callbacks[0]({ code: 0 });
    await Promise.resolve();
    expect(callbacks).toHaveLength(2);
    callbacks[1]({ code: 0 });
    await flushing;
    await processor.shutdown();
  });

  it('settles exporter callbacks and failures once without over-crediting capacity', async () => {
    const dropped: number[] = [];
    const pending: Array<(result: { code: number }) => void> = [];
    let calls = 0;
    const processor = new BoundedLogProcessor({
      export(_records, done) {
        calls += 1;
        if (calls === 1) {
          done({ code: 0 });
          done({ code: 0 });
          return;
        }
        pending.push(done);
      },
    }, { delayMs: 60_000, maxRecords: 1, onDrop: (count) => dropped.push(count) });

    emit(processor, record('first'));
    await processor.forceFlush();
    emit(processor, record('second'));
    const flushing = processor.forceFlush();
    expect(pending).toHaveLength(1);
    emit(processor, record('third'));
    expect(dropped).toEqual([1]);
    pending[0]({ code: 0 });
    await flushing;

    const rejecting = new BoundedLogProcessor({
      export() { return Promise.reject(new Error('export rejected')); },
    }, { delayMs: 60_000, maxRecords: 1, onDrop: (count) => dropped.push(count) });
    emit(rejecting, record('rejected'));
    await rejecting.forceFlush();
    emit(rejecting, record('accepted after rejection'));
    emit(rejecting, record('dropped after rejection'));
    expect(dropped).toEqual([1, 1]);
    await rejecting.forceFlush();
    await processor.shutdown();
    await rejecting.shutdown();

    let throwCalls = 0;
    const throwing = new BoundedLogProcessor({
      export() { throwCalls += 1; throw new Error('export threw'); },
    }, { delayMs: 60_000, maxRecords: 1 });
    emit(throwing, record('thrown'));
    await throwing.forceFlush();
    emit(throwing, record('accepted after throw'));
    await throwing.forceFlush();
    expect(throwCalls).toBe(2);
    await throwing.shutdown();

    const byteDrops: number[] = [];
    const bytePending: Array<(result: { code: number }) => void> = [];
    let byteExports = 0;
    const byteBounded = new BoundedLogProcessor({
      export(_records, done) {
        byteExports += 1;
        if (byteExports === 1) { done({ code: 0 }); done({ code: 0 }); }
        else bytePending.push(done);
      },
    }, { delayMs: 60_000, maxRecords: 10, maxBytes: 400 * 1024, onDrop: (count) => byteDrops.push(count) });
    const large = record('x'.repeat(256 * 1024));
    emit(byteBounded, large, 256 * 1024);
    await byteBounded.forceFlush();
    emit(byteBounded, large, 256 * 1024);
    const byteFlushing = byteBounded.forceFlush();
    expect(bytePending).toHaveLength(1);
    emit(byteBounded, large, 256 * 1024);
    expect(byteDrops).toEqual([1]);
    bytePending[0]({ code: 0 });
    await byteFlushing;
    await byteBounded.shutdown();
  });

  it('calls exporter shutdown exactly once', async () => {
    let shutdownCalls = 0;
    const processor = new BoundedLogProcessor({
      export(_records, done) { done({ code: 0 }); },
      async shutdown() { shutdownCalls += 1; },
    });

    await processor.shutdown();
    await processor.shutdown();
    expect(shutdownCalls).toBe(1);
  });

  it('uses the listener-provided normalized size and flushes on the batch limit', async () => {
    const delivered: unknown[][] = [];
    const dropped: number[] = [];
    const processor = new BoundedLogProcessor({ export(records, done) { delivered.push(records); done({ code: 0 }); } }, {
      delayMs: 60_000, maxBytes: 10, maxBatchRecords: 1, onDrop: (count) => dropped.push(count),
    });

    emit(processor, record('small body'), 10);
    await Promise.resolve();
    expect(delivered).toHaveLength(1);

    emit(processor, record('tiny'), 11);
    expect(dropped).toEqual([1]);
    await processor.shutdown();
  });
});
