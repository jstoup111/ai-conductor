// Covers: task:5, task:6
import { describe, expect, it } from 'vitest';
import { buildDispatchTraceIdentity } from '../../../src/engine/otel/child-otel.js';

describe('child OTel projection identity', () => {
  it('uses a fresh dispatch identity when no child session has been persisted', () => {
    const identity = buildDispatchTraceIdentity('/tmp/no-child-session', 'feature-a', {
      harnessVersion: '1.2.3',
      sourceRef: 'owner/repo#1',
    });
    expect(identity).toMatchObject({
      project: '/tmp/no-child-session',
      branch: 'feat/daemon-feature-a',
      harnessVersion: '1.2.3',
      sourceRef: 'owner/repo#1',
    });
    expect(identity.runId).not.toBe('');
  });
});
