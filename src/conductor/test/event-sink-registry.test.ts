import { describe, expect, it } from 'vitest';

import { EVENT_SINKS, type SinkDeclaration } from '../src/engine/event-sinks.js';
import type { ConductorEvent } from '../src/types/events.js';

const { provider_stream_progress: _omitted, ...missingProviderStreamProgress } = EVENT_SINKS;
// @ts-expect-error -- every ConductorEvent type requires a sink declaration.
missingProviderStreamProgress satisfies Record<ConductorEvent['type'], SinkDeclaration>;

describe('event sink registry', () => {
  it('persists provider stream progress without rendering or auditing it', () => {
    expect(EVENT_SINKS.provider_stream_progress).toEqual({
      render: false,
      persist: true,
      audit: false,
    });
  });
});
