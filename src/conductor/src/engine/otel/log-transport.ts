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
  /** Injectable async credential seam; the production resolver reads env references. */
  resolveCredentials?: (
    references: Record<string, { env: string }> | undefined,
    env: NodeJS.ProcessEnv,
    signal: AbortSignal,
  ) => Promise<Record<string, string>>;
  /** Injectable async serialization seam; timeout covers encoding as well as I/O. */
  serialize?: (records: SdkLogRecord[], signal: AbortSignal) => Promise<Uint8Array>;
}

/** Exact once normalization even when callers supplied the suffix. */
export function logEndpoint(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '').replace(/(?:\/v1\/logs)+$/, '')}/v1/logs`;
}

const DEADLINE_EXPIRED = Symbol('log delivery deadline expired');

function resolveLogCredentials(
  references: Record<string, { env: string }> | undefined,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<Record<string, string>> {
  if (signal.aborted) return Promise.reject(signal.reason ?? DEADLINE_EXPIRED);
  return Promise.resolve(references
    ? Object.fromEntries(Object.entries(references).map(([name, ref]) => [name, env[ref.env] ?? '']))
    : {});
}

function serializeLogRecords(records: SdkLogRecord[], signal: AbortSignal): Promise<Uint8Array> {
  if (signal.aborted) return Promise.reject(signal.reason ?? DEADLINE_EXPIRED);
  return Promise.resolve(new Uint8Array(ProtobufLogsSerializer.serializeRequest(records) ?? new Uint8Array()));
}

/** Resolve secret values only immediately before the authorized HTTP request. */
export async function sendLogBatch(records: SdkLogRecord[], options: LogTransportOptions): Promise<LogDeliveryResult> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 2_000);
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  let expired = false;
  let expire!: (value: typeof DEADLINE_EXPIRED) => void;
  const expiredAttempt = new Promise<typeof DEADLINE_EXPIRED>((resolve) => { expire = resolve; });
  const timeout = setTimeout(() => { expired = true; controller.abort(DEADLINE_EXPIRED); expire(DEADLINE_EXPIRED); }, timeoutMs);
  timeout.unref?.();
  const withinDeadline = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (expired || controller.signal.aborted || Date.now() >= deadlineAt) throw DEADLINE_EXPIRED;
    const result = await Promise.race([Promise.resolve().then(operation), expiredAttempt]);
    if (result === DEADLINE_EXPIRED || expired || controller.signal.aborted || Date.now() >= deadlineAt) {
      throw DEADLINE_EXPIRED;
    }
    return result;
  };
  try {
    const policy = await withinDeadline(() => authorizeLogDestination(options.startDir, options.destinationId, {
      ...options.policy, signal: controller.signal,
    }));
    if (!policy) return { ok: false, reason: 'policy' };
    const headers = await withinDeadline(() => (options.resolveCredentials ?? resolveLogCredentials)(
      policy.config.headerReferences, options.env ?? process.env, controller.signal,
    ));
    const body = await withinDeadline(() => (options.serialize ?? serializeLogRecords)(records, controller.signal));
    const response = await withinDeadline(() => (options.fetch ?? globalThis.fetch)(logEndpoint(policy.config.endpoint), {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-protobuf' },
      body: new Uint8Array(body).buffer as ArrayBuffer, signal: controller.signal,
    }));
    return response.ok ? { ok: true, status: response.status } : { ok: false, reason: 'response' };
  } catch (error) {
    return { ok: false, reason: expired || controller.signal.aborted || error === DEADLINE_EXPIRED || (error instanceof Error && error.name === 'AbortError') ? 'timeout' : 'network' };
  } finally { clearTimeout(timeout); }
}
