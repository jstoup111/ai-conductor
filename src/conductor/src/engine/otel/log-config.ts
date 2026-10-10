import type { HarnessConfig, OtelHeaderEnvironmentReference } from '../../types/config.js';

const DEFAULT_SPOOL_MAX_BYTES = 64 * 1024 * 1024;

export type ResolvedLogConfig =
  | { enabled: false; error?: string }
  | {
      enabled: true;
      endpoint: string;
      headerReferences?: Record<string, OtelHeaderEnvironmentReference>;
      spool: { enabled: boolean; maxBytes: number };
    };

function hasLogsSuffix(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '').replace(/(?:\/v1\/logs)+$/, '');
  return `${base}/v1/logs`;
}

/**
 * Resolve the optional log exporter without resolving parent credentials.
 * Log export is independently enabled and may inherit only a usable OTLP/HTTP
 * parent transport.
 */
export function resolveLogConfig(config: Pick<HarnessConfig, 'otel'>): ResolvedLogConfig {
  const logs = config.otel?.logs;
  if (!logs || logs.enabled !== true) return { enabled: false };

  const parent = config.otel;
  const parentIsHttpOtlp = parent?.exporter === 'otlp'
    && parent.protocol !== 'grpc'
    && typeof parent.endpoint === 'string'
    && /^https?:\/\//i.test(parent.endpoint);
  const endpoint = typeof logs.endpoint === 'string' && logs.endpoint
    ? logs.endpoint
    : parentIsHttpOtlp
      ? parent.endpoint
      : undefined;

  if (!endpoint) {
    return {
      enabled: false,
      error: 'otel.logs.enabled: true requires an OTLP/HTTP endpoint or an OTLP/HTTP parent endpoint.',
    };
  }

  const configuredSpool = logs.spool;
  const configuredMaxBytes = configuredSpool?.max_bytes;
  const maxBytes = typeof configuredMaxBytes === 'number'
    && Number.isInteger(configuredMaxBytes)
    && configuredMaxBytes > 0
    ? configuredMaxBytes
    : DEFAULT_SPOOL_MAX_BYTES;
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
