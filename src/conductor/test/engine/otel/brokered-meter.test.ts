// Covers: task:2, task:3
import { describe, expect, it } from 'vitest';
import { createBrokeredInstrumentHost, createBrokeredMeter } from '../../../src/engine/otel/brokered-meter.js';

describe('brokered meter', () => {
  it('synchronously sends creates and records without observable support', () => {
    const messages: unknown[] = [];
    const meter = createBrokeredMeter((message) => messages.push(message));
    meter.createCounter('conductor.test').add(2, { team: 'core' });
    expect(messages).toEqual([
      expect.objectContaining({ kind: 'meter', op: 'create', name: 'conductor.test', instrumentKind: 'counter' }),
      expect.objectContaining({ kind: 'meter', op: 'record', value: 2, attributes: { team: 'core' } }),
    ]);
    expect(() => meter.createObservableGauge('unsupported')).toThrow(/observable/);
  });

  it('materializes instruments once and overwrites reserved dispatcher identity', () => {
    const records: Array<{ value: number; attributes: Record<string, unknown> }> = [];
    const meter = { createCounter: () => ({ add: (value: number, attributes: Record<string, unknown>) => records.push({ value, attributes }) }) } as never;
    const handler = createBrokeredInstrumentHost(meter, { project: 'project', worker: 'worker' }).forDispatch('feature');
    handler.handle({ kind: 'meter', op: 'create', instrumentId: 'i', name: 'conductor.test', instrumentKind: 'counter' });
    handler.handle({ kind: 'meter', op: 'record', instrumentId: 'i', value: 1, attributes: { project: 'bad', feature: 'bad' } });
    handler.close();
    handler.handle({ kind: 'meter', op: 'record', instrumentId: 'i', value: 2, attributes: {} });
    expect(records).toEqual([{ value: 1, attributes: { project: 'project', worker: 'worker', feature: 'feature' } }]);
  });
});
