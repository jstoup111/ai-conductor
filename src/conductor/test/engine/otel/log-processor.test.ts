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
});
