// Covers: task:6, task:7, task:8
import { describe, expect, it } from 'vitest';
import { normalizeLogRecord } from '../../../src/engine/otel/log-record.js';
import { projectLogRecord } from '../../../src/engine/otel/log-listener.js';

describe('log projection', () => {
  it('projects only structured operational diagnostics with full feature ownership', () => {
    const record = projectLogRecord({ type: 'operational_log', severity: 'warn', body: 'complete local body', occurredAt: 42,
      ownership: { scope: 'feature', featureSlug: 'feature-with-a-long-identity' } }, 'project', 'worker');
    expect(record).toMatchObject({ timestamp: 42, severityText: 'WARN', body: 'complete local body', attributes: {
      'conductor.scope': 'feature', 'conductor.feature': 'feature-with-a-long-identity', 'conductor.project': 'project',
    } });
    expect(projectLogRecord({ type: 'dashboard_refresh', timestamp: 1 } as never)).toBeUndefined();
  });

  it('bounds remote body and attributes without abbreviating identity', () => {
    const normalized = normalizeLogRecord({ timestamp: 1, severityText: 'INFO', severityNumber: 9,
      body: 'x'.repeat(40 * 1024), attributes: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`a${i}`, i]).concat([['conductor.feature', 'full-feature-slug']])), });
    expect(normalized?.body).toContain('[truncated]');
    expect(normalized?.attributes['conductor.feature']).toBe('full-feature-slug');
    expect(Object.keys(normalized?.attributes ?? {}).length).toBeLessThanOrEqual(64);
  });
});
