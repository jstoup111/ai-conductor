// Covers: task:13
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMergedFeatureEvents } from '../../src/engine/build-tail-rollup.js';
import { scanInheritedState } from '../../src/engine/daemon-dashboard.js';
import { runDaemonStatus } from '../../src/engine/daemon-observe-cli.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('legacy event history', () => {
  it('loads retired coverage-binding events through event-history, dashboard, and daemon status readers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'legacy-event-history-'));
    directories.push(root);
    const worktree = join(root, '.worktrees', 'legacy-feature');
    const pipeline = join(worktree, '.pipeline');
    const legacyEvents = [
      { type: 'coverage_binding_disabled', step: 'coverage_binding', ts: 1 },
      {
        type: 'plan_slices_changed', step: 'coverage_binding', moved: [], added: [], removed: [], manifest: 'unchanged', ts: 2,
      },
    ];
    await mkdir(pipeline, { recursive: true });
    await mkdir(join(root, '.daemon'), { recursive: true });
    await writeFile(join(pipeline, 'events.jsonl'), `${legacyEvents.map((event) => JSON.stringify(event)).join('\n')}\n`);
    await writeFile(join(pipeline, 'pipeline-events.jsonl'), '');
    await writeFile(join(root, '.daemon', 'events.jsonl'), `${legacyEvents.map((event) => JSON.stringify(event)).join('\n')}\n`);
    const registryPath = join(root, 'registry.json');
    await writeFile(registryPath, JSON.stringify([{
      schemaVersion: 1,
      name: 'legacy',
      path: root,
      status: 'registered',
      registeredAt: '2026-10-24T00:00:00.000Z',
    }]));

    const [history, dashboard, status] = await Promise.all([
      readMergedFeatureEvents(worktree),
      scanInheritedState({
        worktreeBase: join(root, '.worktrees'),
        processedDir: join(root, '.daemon', 'processed'),
        discover: async () => [],
      }),
      runDaemonStatus({ registryPath, kill: () => {}, out: () => {} }),
    ]);

    expect({
      eventTypes: history?.map((event) => event.type),
      dashboardNeverStarted: dashboard.neverStarted,
      statusCode: status.code,
    }).toEqual({
      eventTypes: ['coverage_binding_disabled', 'plan_slices_changed'],
      dashboardNeverStarted: ['legacy-feature'],
      statusCode: 0,
    });
  });
});
