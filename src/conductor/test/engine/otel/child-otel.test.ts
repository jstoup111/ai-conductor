// Covers: task:5, task:6, task:rem-as-built-6a, task:rem-as-built-6b
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConductorEventEmitter } from '../../../src/engine/conductor-event-emitter.js';
import { buildDispatchTraceIdentity, startChildOtelProjection } from '../../../src/engine/otel/child-otel.js';

describe('child OTel projection identity', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('uses a fresh dispatch identity when no child session has been persisted', () => {
    const identity = buildDispatchTraceIdentity('/tmp/no-child-session', 'feature-a', {
      harnessVersion: '1.2.3',
      sourceRef: 'owner/repo#1',
    });
    const nextIdentity = buildDispatchTraceIdentity('/tmp/no-child-session', 'feature-a', {
      harnessVersion: '1.2.3',
      sourceRef: 'owner/repo#1',
    });
    expect(identity).toMatchObject({
      project: '/tmp/no-child-session',
      branch: 'feat/daemon-feature-a',
      harnessVersion: '1.2.3',
      sourceRef: 'owner/repo#1',
    });
    expect(identity.runId).not.toBe(nextIdentity.runId);
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

  it('uses the daemon-injected child session and stable dispatch identity fields', async () => {
    const project = await mkdtemp(join(tmpdir(), 'child-otel-identity-'));
    directories.push(project);

    expect(
      buildDispatchTraceIdentity(project, 'feature-a', {
        harnessVersion: '1.2.3',
        sourceRef: 'owner/repo#1',
        runId: 'child-session',
      }),
    ).toEqual({
      runId: 'child-session',
      project,
      branch: 'feat/daemon-feature-a',
      harnessVersion: '1.2.3',
      sourceRef: 'owner/repo#1',
    });
  });
});
