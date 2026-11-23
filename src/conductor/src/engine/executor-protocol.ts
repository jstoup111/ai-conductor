import type { ConductorEvent } from '../types/events.js';
import type { FeatureExecutionOutcome } from './feature-executor.js';
import type { WorkOrder } from './work-order.js';

/** Increment when an incompatible executor IPC message change is made. */
export const EXECUTOR_PROTOCOL_VERSION = 1;

export type BrokeredMeterInstrumentKind = 'counter' | 'upDownCounter' | 'histogram' | 'gauge';

export interface ExecutorOtelProjectionTrace {
  readonly runId: string;
  readonly project: string;
  readonly branch: string;
  readonly harnessVersion: string;
  readonly sourceRef?: string;
}

/** The closed, versioned message envelope shared by the supervisor and executor. */
export type ExecutorMessage =
  | {
      kind: 'hello';
      protocolVersion: number;
      engineVersionId: string;
      otelProjection?: true;
    }
  | {
      kind: 'work-order';
      order: WorkOrder;
      /**
       * Supervisor pool width, carried independently of the order so a child
       * can preserve the legacy provider-environment concurrency guard.
       */
      effectiveConcurrency?: number;
      otelProjection?: { trace: ExecutorOtelProjectionTrace };
    }
  | {
      /** Child confirmation that an accepted OTel projection is actually live. */
      kind: 'otel-projection';
      started: boolean;
    }
  | {
      kind: 'meter';
      op: 'create';
      instrumentId: string;
      name: string;
      instrumentKind: BrokeredMeterInstrumentKind;
      description?: string;
      unit?: string;
      advice?: Record<string, unknown>;
    }
  | {
      kind: 'meter';
      op: 'record';
      instrumentId: string;
      value: number;
      attributes: Record<string, unknown>;
    }
  | {
      kind: 'event';
      scope: 'feature' | 'root';
      payload: ConductorEvent;
    }
  | {
      kind: 'log';
      level: string;
      message: string;
    }
  | {
      kind: 'request';
      requestId: string;
      method: string;
      params: unknown;
    }
  | {
      kind: 'response';
      requestId: string;
      result: unknown;
    }
  | {
      kind: 'stop';
      reason: string;
    }
  | {
      kind: 'yield';
    }
  | {
      kind: 'outcome';
      outcome: FeatureExecutionOutcome;
    };

export type ParsedExecutorMessage = { kind: 'ok'; message: ExecutorMessage } | { kind: 'malformed'; reason: string };

type MessageRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MessageRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(reason: string): ParsedExecutorMessage {
  return { kind: 'malformed', reason };
}

function requiredString(message: MessageRecord, field: string): string | undefined {
  const value = message[field];
  return typeof value === 'string' ? value : undefined;
}

function parseOtelProjectionTrace(value: unknown): ExecutorOtelProjectionTrace | undefined {
  if (!isRecord(value)) return undefined;
  const runId = requiredString(value, 'runId');
  const project = requiredString(value, 'project');
  const branch = requiredString(value, 'branch');
  const harnessVersion = requiredString(value, 'harnessVersion');
  if (runId === undefined || project === undefined || branch === undefined || harnessVersion === undefined) {
    return undefined;
  }
  if (value.sourceRef !== undefined && typeof value.sourceRef !== 'string') return undefined;
  return {
    runId,
    project,
    branch,
    harnessVersion,
    ...(value.sourceRef === undefined ? {} : { sourceRef: value.sourceRef }),
  };
}

function isBrokeredMeterInstrumentKind(value: unknown): value is BrokeredMeterInstrumentKind {
  return value === 'counter' || value === 'upDownCounter' || value === 'histogram' || value === 'gauge';
}

/**
 * Parses a JSON-serializable executor IPC message without allowing malformed
 * child input to throw through the supervisor boundary.
 */
export function parseExecutorMessage(raw: unknown): ParsedExecutorMessage {
  if (!isRecord(raw)) return malformed('executor message must be an object');

  const kind = requiredString(raw, 'kind');
  if (!kind) return malformed('executor message kind must be a string');

  switch (kind) {
    case 'hello': {
      if (typeof raw.protocolVersion !== 'number') {
        return malformed('hello protocolVersion must be a number');
      }
      const engineVersionId = requiredString(raw, 'engineVersionId');
      if (!engineVersionId) return malformed('hello engineVersionId must be a string');
      if (raw.otelProjection !== undefined && raw.otelProjection !== true) {
        return malformed('hello otelProjection must be true when provided');
      }
      return {
        kind: 'ok',
        message: {
          kind,
          protocolVersion: raw.protocolVersion,
          engineVersionId,
          ...(raw.otelProjection === undefined ? {} : { otelProjection: true }),
        },
      };
    }
    case 'work-order': {
      if (!isRecord(raw.order)) return malformed('work-order order must be an object');
      if (
        raw.effectiveConcurrency !== undefined &&
        (typeof raw.effectiveConcurrency !== 'number' ||
          !Number.isSafeInteger(raw.effectiveConcurrency) ||
          raw.effectiveConcurrency < 1)
      ) {
        return malformed('work-order effectiveConcurrency must be a positive integer when provided');
      }
      if (raw.otelProjection !== undefined && !isRecord(raw.otelProjection)) {
        return malformed('work-order otelProjection must be an object when provided');
      }
      const trace = raw.otelProjection === undefined ? undefined : parseOtelProjectionTrace(raw.otelProjection.trace);
      if (raw.otelProjection !== undefined && trace === undefined) {
        return malformed('work-order otelProjection trace must carry the dispatch identity');
      }
      return {
        kind: 'ok',
        message: {
          kind,
          order: raw.order as unknown as WorkOrder,
          ...(raw.effectiveConcurrency === undefined ? {} : { effectiveConcurrency: raw.effectiveConcurrency }),
          ...(trace === undefined ? {} : { otelProjection: { trace } }),
        },
      };
    }
    case 'otel-projection': {
      if (typeof raw.started !== 'boolean') return malformed('otel-projection started must be a boolean');
      return { kind: 'ok', message: { kind, started: raw.started } };
    }
    case 'meter': {
      const op = requiredString(raw, 'op');
      if (op === 'create') {
        const instrumentId = requiredString(raw, 'instrumentId');
        const name = requiredString(raw, 'name');
        if (instrumentId === undefined || name === undefined || !isBrokeredMeterInstrumentKind(raw.instrumentKind)) {
          return malformed('meter create requires an instrumentId, name, and supported instrumentKind');
        }
        if (raw.description !== undefined && typeof raw.description !== 'string') {
          return malformed('meter create description must be a string when provided');
        }
        if (raw.unit !== undefined && typeof raw.unit !== 'string') {
          return malformed('meter create unit must be a string when provided');
        }
        if (raw.advice !== undefined && !isRecord(raw.advice)) {
          return malformed('meter create advice must be an object when provided');
        }
        return {
          kind: 'ok',
          message: {
            kind,
            op,
            instrumentId,
            name,
            instrumentKind: raw.instrumentKind,
            ...(raw.description === undefined ? {} : { description: raw.description }),
            ...(raw.unit === undefined ? {} : { unit: raw.unit }),
            ...(raw.advice === undefined ? {} : { advice: raw.advice }),
          },
        };
      }
      if (op === 'record') {
        const instrumentId = requiredString(raw, 'instrumentId');
        if (
          instrumentId === undefined ||
          typeof raw.value !== 'number' ||
          !Number.isFinite(raw.value) ||
          !isRecord(raw.attributes)
        ) {
          return malformed('meter record requires an instrumentId, numeric value, and object attributes');
        }
        return { kind: 'ok', message: { kind, op, instrumentId, value: raw.value, attributes: raw.attributes } };
      }
      return malformed('meter op must be create or record');
    }
    case 'event': {
      const scope = raw.scope;
      if (scope !== 'feature' && scope !== 'root') {
        return malformed('event scope must be feature or root');
      }
      if (!isRecord(raw.payload) || typeof raw.payload.type !== 'string') {
        return malformed('event payload must be a JSON object with a type');
      }
      // Do not validate against the local event union: a newer executor may
      // legitimately forward an event type this supervisor does not know yet.
      return { kind: 'ok', message: { kind, scope, payload: raw.payload as ConductorEvent } };
    }
    case 'log': {
      const level = requiredString(raw, 'level');
      const message = requiredString(raw, 'message');
      if (level === undefined || message === undefined) {
        return malformed('log level and message must be strings');
      }
      return { kind: 'ok', message: { kind, level, message } };
    }
    case 'request': {
      const requestId = requiredString(raw, 'requestId');
      const method = requiredString(raw, 'method');
      if (requestId === undefined || method === undefined || !('params' in raw)) {
        return malformed('request requestId, method, and params are required');
      }
      return { kind: 'ok', message: { kind, requestId, method, params: raw.params } };
    }
    case 'response': {
      const requestId = requiredString(raw, 'requestId');
      if (requestId === undefined || !('result' in raw)) {
        return malformed('response requestId and result are required');
      }
      return { kind: 'ok', message: { kind, requestId, result: raw.result } };
    }
    case 'stop': {
      const reason = requiredString(raw, 'reason');
      if (reason === undefined) return malformed('stop reason must be a string');
      return { kind: 'ok', message: { kind, reason } };
    }
    case 'yield':
      return { kind: 'ok', message: { kind } };
    case 'outcome':
      if (!isRecord(raw.outcome)) return malformed('outcome must be an object');
      return { kind: 'ok', message: { kind, outcome: raw.outcome as unknown as FeatureExecutionOutcome } };
    default:
      return malformed(`unknown executor message kind: ${kind}`);
  }
}
