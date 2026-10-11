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

  it('counts an unfit required identity without changing the local occurrence', async () => {
    const emit = vi.fn();
    const drops = vi.fn();
    const local = vi.fn();
    const events = new ConductorEventEmitter();
    const body = 'complete local diagnostic';
    const event = { type: 'operational_log' as const, severity: 'warn' as const, body, occurredAt: 42,
      ownership: { scope: 'feature' as const, featureSlug: 'f'.repeat(64 * 1024) } };
    events.on('operational_log', local);
    const listener = new LogListener({ emit } as never, 'project', 'worker', drops);
    listener.start(events);

    try {
      await events.emit(event);
      expect(drops).toHaveBeenCalledTimes(1);
      expect(emit).not.toHaveBeenCalled();
      expect(local).toHaveBeenCalledWith(event);
      expect(event.body).toBe(body);
    } finally {
      listener.stop();
      events.off('operational_log', local);
    }
  });
});
