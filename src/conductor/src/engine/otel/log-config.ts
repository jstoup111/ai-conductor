import type { HarnessConfig, OtelHeaderEnvironmentReference } from '../../types/config.js';

const DEFAULT_SPOOL_MAX_BYTES = 64 * 1024 * 1024;
const LOG_KEYS = new Set(['enabled', 'endpoint', 'headers', 'spool']);
const LOG_SPOOL_KEYS = new Set(['enabled', 'max_bytes']);

export type ResolvedLogConfig =
  | { enabled: false; error?: string }
  | {
      enabled: true;
      endpoint: string;
      headerReferences?: Record<string, OtelHeaderEnvironmentReference>;
      spool: { enabled: boolean; maxBytes: number };
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasLogsSuffix(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '').replace(/(?:\/v1\/logs)+$/, '');
  return `${base}/v1/logs`;
}

function isHttpEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return false;
  try {
    const parsed = new URL(endpoint);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.hostname !== ''
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
}

function invalid(error: string): ResolvedLogConfig {
  return { enabled: false, error };
}

function validateHeaderReferences(headers: unknown): string | undefined {
  if (!isPlainObject(headers)) {
    return 'otel.logs.headers must be a mapping from header names to { env: <variable name> } references.';
  }
  for (const [header, reference] of Object.entries(headers)) {
    const headerPath = `otel.logs.headers.${header || "''"}`;
    if (header === '' || /[\x00-\x1F\x7F]/.test(header)) {
      return `${headerPath} must be a non-empty header name without control characters.`;
    }
    if (!isPlainObject(reference) || Object.keys(reference).length !== 1
      || typeof reference.env !== 'string' || reference.env === '') {
      return `${headerPath} must use the supported reference form { env: <variable name> }.`;
    }
  }
  return undefined;
}

/**
 * Resolve the optional log exporter without resolving parent credentials.
 * Log export is independently enabled and may inherit only a usable OTLP/HTTP
 * parent transport.
 */
export function resolveLogConfig(config: Pick<HarnessConfig, 'otel'>): ResolvedLogConfig {
  const logs = config.otel?.logs as unknown;
  if (logs === undefined) return { enabled: false };
  if (!isPlainObject(logs)) return invalid('otel.logs must be an object.');

  for (const key of Object.keys(logs)) {
    if (!LOG_KEYS.has(key)) return invalid(`Unknown otel.logs.${key}.`);
  }
  if (logs.enabled !== undefined && typeof logs.enabled !== 'boolean') {
    return invalid('otel.logs.enabled must be a boolean.');
  }
  if (logs.endpoint !== undefined && !isHttpEndpoint(logs.endpoint)) {
    return invalid('otel.logs.endpoint must be an HTTP(S) URL without userinfo, query parameters, or fragments; use credential headers for authentication.');
  }
  if (logs.headers !== undefined) {
    const error = validateHeaderReferences(logs.headers);
    if (error) return invalid(error);
  }
  if (logs.spool !== undefined) {
    if (!isPlainObject(logs.spool)) return invalid('otel.logs.spool must be an object.');
    for (const key of Object.keys(logs.spool)) {
      if (!LOG_SPOOL_KEYS.has(key)) return invalid(`Unknown otel.logs.spool.${key}.`);
    }
    if (logs.spool.enabled !== undefined && typeof logs.spool.enabled !== 'boolean') {
      return invalid('otel.logs.spool.enabled must be a boolean.');
    }
    if (logs.spool.max_bytes !== undefined
      && (!Number.isInteger(logs.spool.max_bytes) || (logs.spool.max_bytes as number) <= 0)) {
      return invalid('otel.logs.spool.max_bytes must be a positive integer number of bytes.');
    }
  }
  if (logs.enabled !== true) return { enabled: false };

  const parent = config.otel;
  const parentIsHttpOtlp = parent?.exporter === 'otlp'
    && parent.protocol !== 'grpc'
    && isHttpEndpoint(parent.endpoint);
  const endpoint = logs.endpoint !== undefined
    ? logs.endpoint
    : parentIsHttpOtlp
      ? parent.endpoint
      : undefined;

  if (!endpoint) {
    return invalid('otel.logs.endpoint is required when no OTLP/HTTP parent endpoint is available.');
  }

  const configuredSpool = logs.spool;
  const maxBytes = configuredSpool?.max_bytes ?? DEFAULT_SPOOL_MAX_BYTES;
  const headerReferences = logs.headers !== undefined
    ? logs.headers
    : parentIsHttpOtlp
      ? parent.headers
      : undefined;

  return {
    enabled: true,
    endpoint: hasLogsSuffix(endpoint),
    ...(headerReferences !== undefined ? { headerReferences } : {}),
    spool: {
      enabled: configuredSpool?.enabled === false ? false : true,
      maxBytes,
    },
  };
}
