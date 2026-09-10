import { describe, expect, it } from 'vitest';
import { TargetPathMissingError } from '../../../src/engine/engineer/target.js';
import {
  classifyLandGateRejection,
  landGateError,
} from '../../../src/engine/engineer/land-spec.js';
import { EVENT_SINKS } from '../../../src/engine/event-sinks.js';

describe('land-gate rejection classification', () => {
  it('preserves a closed gate identifier and its operator-facing reason', () => {
    const error = landGateError('stories-not-approved', 'stories must be accepted');

    expect(classifyLandGateRejection(error)).toEqual({
      gate: 'stories-not-approved',
      reason: 'stories must be accepted',
    });
    expect(error.message).toBe('stories must be accepted');
  });

  it('classifies missing targets and unexpected failures without dropping either', () => {
    expect(classifyLandGateRejection(new TargetPathMissingError('/missing')).gate).toBe('target-path-missing');
    expect(classifyLandGateRejection(new Error('unexpected')).gate).toBe('unclassified');
  });

  it('caps only the recorded reason and marks the truncation', () => {
    const error = new Error('x'.repeat(1_100));
    const rejection = classifyLandGateRejection(error);

    expect(rejection.reason).toHaveLength(1_000);
    expect(rejection.reason.endsWith('… [truncated]')).toBe(true);
    expect(error.message).toHaveLength(1_100);
    expect(Buffer.byteLength(JSON.stringify({
      type: 'land_gate_rejected',
      ...rejection,
      project: 'project-name',
      worktreePath: '/tmp/worktree',
      sourceRef: 'owner/repo#123',
      ts: new Date().toISOString(),
    }))).toBeLessThan(4_096);
  });

  it('persists rejection events without rendering, auditing, or exporting them', () => {
    expect(EVENT_SINKS.land_gate_rejected).toEqual({
      render: false,
      persist: true,
      audit: false,
      otel: false,
    });
  });
});
