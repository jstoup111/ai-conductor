import { createContextKey, type Context } from '@opentelemetry/api';

export interface ProjectedLogRecord {
  timestamp: number;
  severityText: 'INFO' | 'WARN' | 'ERROR';
  severityNumber: number;
  body: string;
  attributes: Record<string, string | number | boolean>;
}

export interface NormalizedLogRecord extends ProjectedLogRecord {
  byteSize: number;
}

const MAX_BODY_BYTES = 32 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_ATTRIBUTES = 64;
const LOG_RECORD_BYTE_SIZE = createContextKey('conductor.log.record.byte_size');

/** Carries the bounded local representation's size to the SDK processor. */
export function withLogRecordByteSize(context: Context, byteSize: number): Context {
  return context.setValue(LOG_RECORD_BYTE_SIZE, byteSize);
}

/** Returns a listener-provided normalized size, never an untrusted estimate. */
export function logRecordByteSize(context?: Context): number | undefined {
  const byteSize = context?.getValue(LOG_RECORD_BYTE_SIZE);
  return typeof byteSize === 'number' && Number.isSafeInteger(byteSize) && byteSize >= 0 ? byteSize : undefined;
}

function truncateUtf8(value: string, limit: number): string {
  if (Buffer.byteLength(value, 'utf8') <= limit) return value;
  const marker = '…[truncated]';
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character + marker, 'utf8') > limit) break;
    result += character;
  }
  return result + marker;
}

/** Bound only the remote representation; callers retain their original event. */
export function normalizeLogRecord(record: ProjectedLogRecord): NormalizedLogRecord | undefined {
  const required = Object.entries(record.attributes).filter(([key]) => key.startsWith('conductor.'));
  const optional = Object.entries(record.attributes).filter(([key]) => !key.startsWith('conductor.'));
  const attributes = Object.fromEntries([...required, ...optional].slice(0, MAX_ATTRIBUTES));
  const body = truncateUtf8(record.body, MAX_BODY_BYTES);
  const mark = (key: string) => {
    if (Object.keys(attributes).length >= MAX_ATTRIBUTES) {
      const removable = Object.keys(attributes).find((name) => !name.startsWith('conductor.'));
      if (removable) delete attributes[removable];
    }
    if (Object.keys(attributes).length < MAX_ATTRIBUTES || key in attributes) attributes[key] = true;
  };
  if (body !== record.body) mark('conductor.body.truncated');
  if (Object.keys(record.attributes).length > MAX_ATTRIBUTES) mark('conductor.attributes.truncated');
  const normalized = { ...record, body, attributes };
  const byteSize = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  // Required identity is never abbreviated: reject instead of lying about it.
  if (byteSize > MAX_RECORD_BYTES) return undefined;
  return { ...normalized, byteSize };
}
