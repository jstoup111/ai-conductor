// Covers: task:6, task:7, task:8
import { describe, expect, it } from 'vitest';
import { normalizeLogRecord } from '../../../src/engine/otel/log-record.js';
import { projectLogRecord } from '../../../src/engine/otel/log-listener.js';

if (false) {
  // @ts-expect-error -- only events explicitly selected in EVENT_SINKS are projectable.
  projectLogRecord({ type: 'dashboard_refresh' });
}

describe('log projection', () => {
  it('projects only structured operational diagnostics with full feature ownership', () => {
    const record = projectLogRecord({ type: 'operational_log', severity: 'warn', body: 'complete local body', occurredAt: 42,
      ownership: { scope: 'feature', featureSlug: 'feature-with-a-long-identity' } }, 'project', 'worker');
    expect(record).toMatchObject({ timestamp: 42, severityText: 'WARN', body: 'complete local body', attributes: {
      'conductor.scope': 'feature', 'conductor.feature': 'feature-with-a-long-identity', 'conductor.project': 'project',
    } });
  });

  it('projects every selected lifecycle event through the closed projection table', () => {
    expect(projectLogRecord({ type: 'step_started', step: 'build', index: 1 })).toMatchObject({
      body: 'step started: build', attributes: { 'conductor.event': 'step_started' },
    });
    expect(projectLogRecord({ type: 'step_completed', step: 'build', status: 'done' })).toMatchObject({
      body: 'step completed: build', attributes: { 'conductor.event': 'step_completed' },
    });
    expect(projectLogRecord({ type: 'feature_complete' })).toMatchObject({
      body: 'feature completed', attributes: { 'conductor.event': 'feature_complete' },
    });
  });

  it('bounds remote body and attributes without abbreviating identity', () => {
    const normalized = normalizeLogRecord({ timestamp: 1, severityText: 'INFO', severityNumber: 9,
      body: 'x'.repeat(40 * 1024), attributes: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`a${i}`, i]).concat([['conductor.feature', 'full-feature-slug']])), });
    expect(normalized?.body).toContain('[truncated]');
    expect(normalized?.attributes['conductor.feature']).toBe('full-feature-slug');
    expect(Object.keys(normalized?.attributes ?? {}).length).toBeLessThanOrEqual(64);
  });

});
