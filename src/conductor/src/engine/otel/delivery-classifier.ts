import { ProtobufMetricsSerializer, ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';

export type DeliveryClassification =
  | { action: 'delete' }
  | { action: 'drop'; reason: 'rejected'; status: number; rejectedItems: number }
  | { action: 'keep'; failureClass: 'auth' | 'endpoint' | 'throttled' | 'server' | 'network'; retryAfterMs?: number };

type Headers = Record<string, string | undefined> | undefined;

function retryAfterMs(headers: Headers): number | undefined {
  const value = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
  if (value === undefined) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function rejectedItems(body: Uint8Array, signal: 'traces' | 'metrics'): number {
  const response = signal === 'traces'
    ? ProtobufTraceSerializer.deserializeResponse(body).partialSuccess?.rejectedSpans
    : ProtobufMetricsSerializer.deserializeResponse(body).partialSuccess?.rejectedDataPoints;
  return response ?? 0;
}

/** Classifies an OTLP/HTTP response without performing I/O or changing spool state. */
export function classifyResponse(
  status: number,
  body?: Uint8Array,
  headers?: Headers,
  signal: 'traces' | 'metrics' = 'traces',
): DeliveryClassification {
  if (status >= 200 && status < 300) {
    const rejected = body === undefined || body.length === 0 ? 0 : rejectedItems(body, signal);
    return rejected > 0
      ? { action: 'drop', reason: 'rejected', status, rejectedItems: rejected }
      : { action: 'delete' };
  }
  if (status === 400 || status === 413) return { action: 'drop', reason: 'rejected', status, rejectedItems: 0 };
  if (status === 401 || status === 403) return { action: 'keep', failureClass: 'auth' };
  if (status === 404) return { action: 'keep', failureClass: 'endpoint' };
  if (status === 408 || status === 429) {
    const retryAfter = retryAfterMs(headers);
    return { action: 'keep', failureClass: 'throttled', ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }) };
  }
  return { action: 'keep', failureClass: 'server' };
}

/** A connection failure has no HTTP response and must always remain queued. */
export function classifyNetworkError(): DeliveryClassification {
  return { action: 'keep', failureClass: 'network' };
}
