// Covers: task:8
import { describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { LogListener } from '../../../src/engine/otel/log-listener.js';

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
});
