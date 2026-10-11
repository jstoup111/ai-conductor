// Covers: task:9, task:23
import { describe, expect, it } from 'vitest';
import { BoundedLogProcessor } from '../../../src/engine/otel/log-processor.js';

const record = (body: string) => ({ body, attributes: {}, resource: {}, instrumentationScope: {}, hrTime: [0, 0], hrTimeObserved: [0, 0], droppedAttributesCount: 0 }) as never;

describe('BoundedLogProcessor', () => {
  it('admits synchronously, drops overflowing newest records, and settles once', async () => {
    const delivered: unknown[][] = [];
    const dropped: number[] = [];
    const processor = new BoundedLogProcessor({ export(records, done) { delivered.push(records); done({ code: 0 }); } }, {
      delayMs: 1, maxRecords: 1, onDrop: (count) => dropped.push(count),
    });
    processor.onEmit(record('one'));
    processor.onEmit(record('two'));
    await processor.forceFlush();
    expect({ batches: delivered.length, records: delivered[0]?.length, dropped }).toEqual({ batches: 1, records: 1, dropped: [1] });
    await processor.shutdown(); await processor.shutdown();
  });

  it('returns from producers while an exporter is pending', async () => {
    const callbacks: Array<(result: { code: number }) => void> = [];
    const dropped: number[] = [];
    const processor = new BoundedLogProcessor({ export(_records, done) { callbacks.push(done); } }, {
      delayMs: 60_000, maxRecords: 2, onDrop: (count) => dropped.push(count),
    });

    processor.onEmit(record('first'));
    const flushing = processor.forceFlush();
    expect(callbacks).toHaveLength(1);

    expect(processor.onEmit(record('second'))).toBeUndefined();
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

    processor.onEmit(record('first'));
    await processor.forceFlush();
    processor.onEmit(record('second'));
    const flushing = processor.forceFlush();
    expect(pending).toHaveLength(1);
    processor.onEmit(record('third'));
    expect(dropped).toEqual([1]);
    pending[0]({ code: 0 });
    await flushing;

    const rejecting = new BoundedLogProcessor({
      export() { return Promise.reject(new Error('export rejected')); },
    }, { delayMs: 60_000, maxRecords: 1, onDrop: (count) => dropped.push(count) });
    rejecting.onEmit(record('rejected'));
    await rejecting.forceFlush();
    rejecting.onEmit(record('accepted after rejection'));
    rejecting.onEmit(record('dropped after rejection'));
    expect(dropped).toEqual([1, 1]);
    await rejecting.forceFlush();
    await processor.shutdown();
    await rejecting.shutdown();

    let throwCalls = 0;
    const throwing = new BoundedLogProcessor({
      export() { throwCalls += 1; throw new Error('export threw'); },
    }, { delayMs: 60_000, maxRecords: 1 });
    throwing.onEmit(record('thrown'));
    await throwing.forceFlush();
    throwing.onEmit(record('accepted after throw'));
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
    byteBounded.onEmit(large);
    await byteBounded.forceFlush();
    byteBounded.onEmit(large);
    const byteFlushing = byteBounded.forceFlush();
    expect(bytePending).toHaveLength(1);
    byteBounded.onEmit(large);
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
});
