// Covers: task:5, task:6
import { describe, expect, it } from 'vitest';
import { ConductorEventEmitter } from '../../../src/engine/conductor-event-emitter.js';
import { buildDispatchTraceIdentity, startChildOtelProjection } from '../../../src/engine/otel/child-otel.js';

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

  it('reports that projection did not start when the worktree has no enabled OTel configuration', () => {
    const projection = startChildOtelProjection({
      config: {},
      trace: {
        runId: 'run',
        project: '/tmp/project',
        branch: 'feat/daemon-feature',
        harnessVersion: '1.2.3',
      },
      engineVersionId: '20261123T000000Z-aaaaaaaaaaaa',
      slug: 'feature',
      mainRoot: '/tmp/project',
      events: new ConductorEventEmitter(),
      sendMeter: () => undefined,
    });

    expect(projection.started).toBe(false);
  });
});
