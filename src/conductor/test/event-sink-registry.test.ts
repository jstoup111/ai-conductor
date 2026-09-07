// Covers: task:1
import { describe, expect, it } from 'vitest';

import {
  EVENT_SINKS,
  type OtelTracedEventType,
  type SinkDeclaration,
} from '../src/engine/event-sinks.js';
import type { ConductorEvent } from '../src/types/events.js';

const { provider_stream_progress: _omitted, ...missingProviderStreamProgress } = EVENT_SINKS;
// @ts-expect-error -- every ConductorEvent type requires a sink declaration.
missingProviderStreamProgress satisfies Record<ConductorEvent['type'], SinkDeclaration>;

const tracedEventType: OtelTracedEventType = 'loop_halt';
// @ts-expect-error -- gate_blocked does not declare the OTel sink.
const untracedEventType: OtelTracedEventType = 'gate_blocked';
void tracedEventType;
void untracedEventType;

describe('event sink registry', () => {
  it('renders and persists setup repair dispositions without audit or OTel subscriptions', () => {
    expect(EVENT_SINKS.setup_repair).toEqual({
      render: true,
      persist: true,
      audit: false,
      otel: false,
    });
  });

  it('persists provider stream progress without rendering or auditing it', () => {
    expect(EVENT_SINKS.provider_stream_progress).toEqual({
      render: false,
      persist: true,
      audit: false,
      otel: false,
    });
  });
});
