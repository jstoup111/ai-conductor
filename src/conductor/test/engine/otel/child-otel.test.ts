// Covers: task:5, task:6
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

  it('uses the persisted child session and stable dispatch identity fields', async () => {
    const project = await mkdtemp(join(tmpdir(), 'child-otel-identity-'));
    directories.push(project);
    const pipeline = join(project, '.worktrees', 'feature-a', '.pipeline');
    await mkdir(pipeline, { recursive: true });
    await writeFile(join(pipeline, 'conduct-session-id'), 'child-session\n');

    expect(
      buildDispatchTraceIdentity(project, 'feature-a', {
        harnessVersion: '1.2.3',
        sourceRef: 'owner/repo#1',
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
