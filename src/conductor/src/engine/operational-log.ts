import type {
  ConductorEvent,
  OperationalLogOwnership,
  OperationalLogSeverity,
} from '../types/events.js';
import { AsyncLocalStorage } from 'node:async_hooks';

type OperationalLogOccurrence = Extract<ConductorEvent, { type: 'operational_log' }>;

/**
 * Rendering event-derived output can reach the same diagnostic adapters that
 * create operational records. Keep that output local without suppressing
 * unrelated diagnostics running in another async execution context.
 */
const logRenderSuppression = new AsyncLocalStorage<boolean>();

export function withLogRenderSuppressed<TResult>(render: () => TResult): TResult {
  return logRenderSuppression.run(true, render);
}

function isLogRenderSuppressed(): boolean {
  return logRenderSuppression.getStore() === true;
}

export interface OperationalLoggerOptions<TResult> {
  emit: (occurrence: OperationalLogOccurrence) => void | Promise<void>;
  localSink: (severity: OperationalLogSeverity, body: string) => TResult;
  now: () => number;
  ownership: OperationalLogOwnership;
}

export interface OperationalLogger<TResult> {
  info(body: string): TResult;
  warn(body: string): TResult;
  error(body: string): TResult;
}

/**
 * Capture a structured diagnostic before its local sink formats or renders it.
 * Event delivery is strictly best-effort: the original local result remains the
 * caller's result even when a listener is unavailable.
 */
export function createOperationalLogger<TResult>(
  options: OperationalLoggerOptions<TResult>,
): OperationalLogger<TResult> {
  const ownership: OperationalLogOwnership = options.ownership.scope === 'project'
    ? Object.freeze({ scope: 'project' })
    : Object.freeze({ scope: 'feature', featureSlug: options.ownership.featureSlug });

  const write = (severity: OperationalLogSeverity, body: string): TResult => {
    if (!isLogRenderSuppressed()) {
      try {
        void Promise.resolve(options.emit({
          type: 'operational_log',
          severity,
          body,
          occurredAt: options.now(),
          ownership,
        })).catch(() => {
          // The original diagnostic must not be disrupted by event delivery.
        });
      } catch {
        // The original diagnostic must not be disrupted by event delivery.
      }
    }
    return options.localSink(severity, body);
  };

  return {
    info: (body) => write('info', body),
    warn: (body) => write('warn', body),
    error: (body) => write('error', body),
  };
}
