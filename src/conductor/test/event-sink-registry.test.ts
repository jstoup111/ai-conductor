// Covers: task:1
import { describe, expect, it } from 'vitest';

import {
  EVENT_SINKS,
  otelEventTypes,
  otelTracedEventTypes,
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
// @ts-expect-error -- daemon backlog is metric-owned, not visualizer-owned.
const metricOnlyEventType: OtelTracedEventType = 'daemon_backlog_snapshot';
void metricOnlyEventType;

describe('event sink registry', () => {
  it('keeps metrics-only events covered without subscribing the trace visualizer', () => {
    const metricsOnly = [
      'daemon_backlog_snapshot', 'feature_dispatch_started',
      'feature_dispatch_ended', 'feature_shipped',
    ];
    expect(otelEventTypes()).toEqual(expect.arrayContaining(metricsOnly));
    expect(otelTracedEventTypes()).toEqual(expect.not.arrayContaining(metricsOnly));
    expect(otelTracedEventTypes()).toContain('step_started');
  });

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
