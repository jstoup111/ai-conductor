import { ProtobufLogsSerializer } from '@opentelemetry/otlp-transformer';
import type { SdkLogRecord } from '@opentelemetry/sdk-logs';
import { authorizeLogDestination, type LogPolicyOptions } from './log-policy.js';

export type LogDeliveryResult = { ok: true; status: number } | { ok: false; reason: 'policy' | 'timeout' | 'network' | 'response' };

export interface LogTransportOptions {
  startDir: string;
  destinationId: string;
  policy?: LogPolicyOptions;
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Exact once normalization even when callers supplied the suffix. */
export function logEndpoint(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '').replace(/(?:\/v1\/logs)+$/, '')}/v1/logs`;
}

/** Resolve secret values only immediately before the authorized HTTP request. */
export async function sendLogBatch(records: SdkLogRecord[], options: LogTransportOptions): Promise<LogDeliveryResult> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const controller = new AbortController();
  let expired = false;
  const timeout = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);
  timeout.unref?.();
  try {
    const policy = await authorizeLogDestination(options.startDir, options.destinationId, options.policy);
    if (!policy || expired) return { ok: false, reason: expired ? 'timeout' : 'policy' };
    const headers = policy.config.headerReferences
      ? Object.fromEntries(Object.entries(policy.config.headerReferences).map(([name, ref]) => [name, (options.env ?? process.env)[ref.env] ?? '']))
      : {};
    const body = ProtobufLogsSerializer.serializeRequest(records) ?? new Uint8Array();
    if (expired || controller.signal.aborted) return { ok: false, reason: 'timeout' };
    const response = await (options.fetch ?? globalThis.fetch)(logEndpoint(policy.config.endpoint), {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-protobuf' },
      body: new Uint8Array(body).buffer as ArrayBuffer, signal: controller.signal,
    });
    return response.ok ? { ok: true, status: response.status } : { ok: false, reason: 'response' };
  } catch (error) {
    return { ok: false, reason: expired || (error instanceof Error && error.name === 'AbortError') ? 'timeout' : 'network' };
  } finally { clearTimeout(timeout); }
}
