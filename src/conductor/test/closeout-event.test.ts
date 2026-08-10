import { describe, expect, it } from 'vitest';

import type { ConductorEvent } from '../src/types/events.js';

describe('ConductorEvent union includes pipeline closeout events', () => {
  it('accepts a closeout event with its obligation timing', () => {
    const event: ConductorEvent = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 1_720_000_000_000,
      endedAt: 1_720_000_001_500,
      ts: 1_720_000_001_500,
    };

    expect(event.type).toBe('pipeline_closeout');
  });
});
