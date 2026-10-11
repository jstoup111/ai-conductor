// Covers: task:8
import { describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { LogListener } from '../../../src/engine/otel/log-listener.js';
import { logRecordByteSize, normalizeLogRecord } from '../../../src/engine/otel/log-record.js';
import { projectLogRecord } from '../../../src/engine/otel/log-listener.js';

describe('LogListener delivery health isolation', () => {
  it('does not project rendered delivery-health events into remote log records', async () => {
    const emit = vi.fn();
    const events = new ConductorEventEmitter();
    const listener = new LogListener({ emit } as never, 'project', 'worker');
    listener.start(events);

    try {
      await events.emit({
        type: 'renderer_error',
        rendererName: 'otel',
        error: '[otel] log delivery network; records remain local',
      });
      expect(emit).not.toHaveBeenCalled();
    } finally {
      listener.stop();
    }
  });

  it('propagates the normalized record size to the processor context', async () => {
    const emit = vi.fn();
    const events = new ConductorEventEmitter();
    const listener = new LogListener({ emit } as never, 'project', 'worker');
    const event = { type: 'operational_log' as const, severity: 'warn' as const, body: 'bounded body', occurredAt: 42,
      ownership: { scope: 'feature' as const, featureSlug: 'feature' } };
    listener.start(events);

    try {
      await events.emit(event);
      const emitted = emit.mock.calls[0]?.[0] as { context?: Parameters<typeof logRecordByteSize>[0] };
      expect(logRecordByteSize(emitted.context)).toBe(normalizeLogRecord(projectLogRecord(event, 'project', 'worker'))?.byteSize);
    } finally {
      listener.stop();
    }
  });
});
