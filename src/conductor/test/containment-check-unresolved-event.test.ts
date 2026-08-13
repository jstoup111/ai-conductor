import { describe, expect, it } from 'vitest';

import type { ConductorEvent } from '../src/types/events.js';

describe('ConductorEvent union includes containment-check-unresolved events', () => {
  it('accepts the failure classification, resolvable task id, and timestamp', () => {
    const event: ConductorEvent = {
      type: 'containment_check_unresolved',
      failure: 'task-status-malformed',
      taskId: '10',
      ts: 1_723_231_600_000,
    };

    expect(event.type).toBe('containment_check_unresolved');
  });
});
