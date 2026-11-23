import type { Attributes, Meter, MetricOptions } from '@opentelemetry/api';
import type { BrokeredMeterInstrumentKind, ExecutorMessage } from '../executor-protocol.js';

type Send = (message: Extract<ExecutorMessage, { kind: 'meter' }>) => unknown;
type Instrument = { add(value: number, attributes?: Attributes): void; record(value: number, attributes?: Attributes): void };

/** A synchronous Meter facade which forwards measurements to the dispatcher. */
export function createBrokeredMeter(send: Send): Meter {
  let sequence = 0;
  const create = (instrumentKind: BrokeredMeterInstrumentKind, name: string, options: MetricOptions = {}): Instrument => {
    const instrumentId = `meter-${++sequence}`;
    send({ kind: 'meter', op: 'create', instrumentId, name, instrumentKind,
      ...(options.description === undefined ? {} : { description: options.description }),
      ...(options.unit === undefined ? {} : { unit: options.unit }),
      ...(options.advice === undefined ? {} : { advice: options.advice as unknown as Record<string, unknown> }),
    });
    const record = (value: number, attributes: Attributes = {}) => send({ kind: 'meter', op: 'record', instrumentId, value, attributes: { ...attributes } });
    return { add: record, record };
  };
  const unsupported = () => { throw new Error('brokered meter does not support observable instruments'); };
  return {
    createCounter: (name, options) => create('counter', name, options),
    createUpDownCounter: (name, options) => create('upDownCounter', name, options),
    createHistogram: (name, options) => create('histogram', name, options),
    createGauge: (name, options) => create('gauge', name, options),
    createObservableGauge: unsupported, createObservableCounter: unsupported, createObservableUpDownCounter: unsupported,
    addBatchObservableCallback: unsupported, removeBatchObservableCallback: unsupported,
  } as Meter;
}

type SynchronousInstrument = { add?: (value: number, attributes?: Attributes) => void; record?: (value: number, attributes?: Attributes) => void };
export interface BrokeredInstrumentHost { forDispatch(slug: string): { handle(message: Extract<ExecutorMessage, { kind: 'meter' }>): void; close(): void }; }

/** Dispatcher-owned materialization of child-created synchronous instruments. */
export function createBrokeredInstrumentHost(meter: Meter, identity: { project: string; worker: string }): BrokeredInstrumentHost {
  return { forDispatch(slug) {
    const instruments = new Map<string, SynchronousInstrument>(); let closed = false;
    return {
      handle(message) {
        if (closed) return;
        if (message.op === 'create') {
          const options = { description: message.description, unit: message.unit, advice: message.advice };
          const instrument = message.instrumentKind === 'counter' ? meter.createCounter(message.name, options)
            : message.instrumentKind === 'upDownCounter' ? meter.createUpDownCounter(message.name, options)
              : message.instrumentKind === 'histogram' ? meter.createHistogram(message.name, options) : meter.createGauge(message.name, options);
          instruments.set(message.instrumentId, instrument); return;
        }
        const instrument = instruments.get(message.instrumentId); if (!instrument) return;
        const attributes = { ...message.attributes, project: identity.project, worker: identity.worker, feature: slug };
        if (instrument.add) instrument.add(message.value, attributes); else instrument.record?.(message.value, attributes);
      },
      close() { closed = true; instruments.clear(); },
    };
  } };
}
