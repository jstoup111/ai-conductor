import { SeverityNumber } from '@opentelemetry/api-logs';
import type { Logger } from '@opentelemetry/api-logs';
import type { ConductorEvent } from '../../types/events.js';
import type { ConductorEventEmitter, EventHandler } from '../../ui/events.js';
import { logEventTypes, type LogEventType } from '../event-sinks.js';
import { observedAtOf } from '../../ui/events.js';
import { normalizeLogRecord, type ProjectedLogRecord } from './log-record.js';

type LogEvent = Extract<ConductorEvent, { type: LogEventType }>;

const severity = { info: SeverityNumber.INFO, warn: SeverityNumber.WARN, error: SeverityNumber.ERROR } as const;

/** The closed projection boundary: never serialize arbitrary event objects. */
export function projectLogRecord(event: ConductorEvent, project = 'unknown', worker = 'unknown'): ProjectedLogRecord | undefined {
  if (event.type === 'step_started' || event.type === 'step_completed' || event.type === 'feature_complete') {
    const body = event.type === 'step_started' ? `step started: ${event.step}`
      : event.type === 'step_completed' ? `step completed: ${event.step}`
        : 'feature completed';
    return {
      timestamp: Date.parse(observedAtOf(event) ?? '') || Date.now(), severityText: 'INFO', severityNumber: SeverityNumber.INFO, body,
      attributes: {
        'conductor.project': project, 'conductor.worker': worker, 'conductor.event': event.type,
        // Lifecycle events do not carry a slug in the public event union;
        // their root-owner projection is intentionally project scoped.
        'conductor.scope': 'project',
      },
    };
  }
  if (event.type !== 'operational_log') return undefined;
  const feature = event.ownership.scope === 'feature' ? event.ownership.featureSlug : undefined;
  const attrs: Record<string, string | number | boolean> = {
    'conductor.project': project,
    'conductor.worker': worker,
    'conductor.event': event.type,
    'conductor.scope': feature === undefined ? 'project' : 'feature',
    ...(feature === undefined ? {} : { 'conductor.feature': feature }),
    ...(observedAtOf(event) === undefined ? {} : { 'conductor.observed_at': observedAtOf(event)! }),
  };
  return {
    timestamp: event.occurredAt,
    severityText: event.severity.toUpperCase() as 'INFO' | 'WARN' | 'ERROR',
    severityNumber: severity[event.severity],
    body: event.body,
    attributes: attrs,
  };
}

/** Projects only registry-selected events into the SDK logger. */
export class LogListener {
  private readonly handlers: Array<[ConductorEvent['type'], EventHandler]> = [];
  private emitter: ConductorEventEmitter | undefined;
  constructor(private readonly logger: Logger, private readonly project?: string, private readonly worker?: string, private readonly onDrop?: () => void) {}

  start(emitter: ConductorEventEmitter): void {
    this.emitter = emitter;
    for (const type of logEventTypes()) {
      const handler: EventHandler = (event) => {
        const record = projectLogRecord(event as LogEvent, this.project, this.worker);
        if (!record) return;
        const normalized = normalizeLogRecord(record);
        if (!normalized) { this.onDrop?.(); return; }
        this.logger.emit({ timestamp: normalized.timestamp, severityText: normalized.severityText,
          severityNumber: normalized.severityNumber as SeverityNumber, body: normalized.body,
          attributes: normalized.attributes, eventName: normalized.attributes['conductor.event'] as string });
      };
      this.handlers.push([type, handler]);
      emitter.on(type, handler);
    }
  }
  stop(): void {
    if (this.emitter) for (const [type, handler] of this.handlers) this.emitter.off(type, handler);
    this.handlers.length = 0; this.emitter = undefined;
  }
}
