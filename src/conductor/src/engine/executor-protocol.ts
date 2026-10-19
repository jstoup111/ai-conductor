import type { ConductorEvent } from '../types/events.js';
import type { FeatureExecutionOutcome } from './feature-executor.js';
import type { WorkOrder } from './work-order.js';

/** Increment when an incompatible executor IPC message change is made. */
export const EXECUTOR_PROTOCOL_VERSION = 1;

/** The closed, versioned message envelope shared by the supervisor and executor. */
export type ExecutorMessage =
  | {
      kind: 'hello';
      protocolVersion: number;
      engineVersionId: string;
    }
  | {
      kind: 'work-order';
      order: WorkOrder;
      /**
       * Supervisor pool width, carried independently of the order so a child
       * can preserve the legacy provider-environment concurrency guard.
       */
      effectiveConcurrency?: number;
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
      kind: 'outcome';
      outcome: FeatureExecutionOutcome;
    };

export type ParsedExecutorMessage =
  | { kind: 'ok'; message: ExecutorMessage }
  | { kind: 'malformed'; reason: string };

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
      return { kind: 'ok', message: { kind, protocolVersion: raw.protocolVersion, engineVersionId } };
    }
    case 'work-order':
      if (!isRecord(raw.order)) return malformed('work-order order must be an object');
      if (
        raw.effectiveConcurrency !== undefined &&
        (typeof raw.effectiveConcurrency !== 'number' ||
          !Number.isSafeInteger(raw.effectiveConcurrency) ||
          raw.effectiveConcurrency < 1)
      ) {
        return malformed('work-order effectiveConcurrency must be a positive integer when provided');
      }
      return {
        kind: 'ok',
        message: {
          kind,
          order: raw.order as unknown as WorkOrder,
          ...(raw.effectiveConcurrency === undefined ? {} : { effectiveConcurrency: raw.effectiveConcurrency }),
        },
      };
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
    case 'outcome':
      if (!isRecord(raw.outcome)) return malformed('outcome must be an object');
      return { kind: 'ok', message: { kind, outcome: raw.outcome as unknown as FeatureExecutionOutcome } };
    default:
      return malformed(`unknown executor message kind: ${kind}`);
  }
}
