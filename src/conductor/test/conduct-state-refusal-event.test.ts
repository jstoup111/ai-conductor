// Covers: task:6
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { Conductor } from './test-conductor.js';
import { EventPersister } from '../src/engine/event-persister.js';
import {
  createStepStatusWriteRefusalDiagnostics,
  resolveConductorStateStore,
} from '../src/engine/conductor-deps.js';
import { writeState } from '../src/engine/state.js';
import type { StepRunner } from '../src/engine/conductor.js';
import type { ConductState } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('skipped-to-stale state-write refusal event', () => {
  it('persists the conductor-store refusal with field, expected, requested, and intent', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conduct-state-refusal-event-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await writeState(stateFilePath, { manual_test: 'skipped' } as ConductState);

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const stepRunner: StepRunner = { run: async () => ({ success: true }) };
    const conductor = new Conductor({ projectRoot, stateFilePath, stepRunner, events });

    const result = await (conductor as any).stateStore.apply({
      field: 'manual_test',
      expected: 'skipped',
      intent: 'restage ship tail after build kickback',
      next: 'stale',
    });
    persister.stop();

    const records = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect({ result, records }).toEqual({
      result: { kind: 'resolved' },
      records: [expect.objectContaining({
        type: 'step_status_write_refused',
        field: 'manual_test',
        expected: 'skipped',
        requested: 'stale',
        intent: 'restage ship tail after build kickback',
      })],
    });
  });

  it('does not report an unrelated terminal-state resolution as a status-write refusal', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'conduct-state-refusal-event-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await writeState(stateFilePath, { feature_status: 'complete' } as ConductState);

    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('step_status_write_refused', (event) => {
      refusals.push(event);
    });
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: { run: async () => ({ success: true }) },
      events,
    });

    await expect((conductor as any).stateStore.apply({
      field: 'feature_status',
      expected: undefined,
      intent: 'preserve terminal completion',
      next: undefined,
    })).resolves.toEqual({ kind: 'resolved' });

    expect(refusals).toEqual([]);
  });

});
