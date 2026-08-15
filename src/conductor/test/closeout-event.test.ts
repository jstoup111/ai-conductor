import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readBuildWindows } from '../src/engine/build-tail-rollup.js';
import { appendCloseoutEvent } from '../src/engine/closeout-events.js';
import { CloseoutEventTail } from '../src/engine/closeout-tail.js';
import { EventPersister } from '../src/engine/event-persister.js';
import type { ConductorEvent } from '../src/types/events.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe('ConductorEvent union includes pipeline closeout events', () => {
  it('accepts a closeout event with its obligation timing', () => {
    const event: ConductorEvent = {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 1_720_000_000_000,
      endedAt: 1_720_000_001_500,
      ts: 1_720_000_001_500,
    };

    expect(event.type).toBe('pipeline_closeout');
  });

  it('re-emits an external accepted disposition once without duplicating its merged-ledger occurrence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'external-disposition-event-'));
    temporaryDirectories.push(projectRoot);
    const pipelineDir = join(projectRoot, '.pipeline');
    const engineLedger = join(pipelineDir, 'events.jsonl');
    const disposition = {
      type: 'build_review_disposition_accepted' as const,
      feature: 'review-rubrics',
      lapId: 'lap-current',
      findingId: 'sha256:finding',
      operator: 'operator',
      ts: '1970-01-01T00:00:00.020Z',
    };
    const engineRecords = [
      { type: 'step_started', step: 'build', index: 0, ts: '1970-01-01T00:00:00.010Z' },
      { type: 'step_completed', step: 'build', status: 'done', ts: '1970-01-01T00:00:00.030Z' },
    ];
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(engineLedger, `${engineRecords.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
    appendCloseoutEvent(projectRoot, disposition);

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(engineLedger, events);
    const received: ConductorEvent[] = [];
    events.on('build_review_disposition_accepted', (event) => {
      received.push(event);
    });
    const tail = new CloseoutEventTail({ projectRoot, events });

    persister.start();
    try {
      await tail.poll();
    } finally {
      persister.stop();
    }

    expect(received).toEqual([disposition]);
    expect((await readFile(engineLedger, 'utf8')).trim().split('\n')).toHaveLength(2);
    await expect(readBuildWindows(projectRoot)).resolves.toMatchObject({
      state: 'measured',
      windows: [{
        events: expect.arrayContaining([{ ...disposition, ts: 20 }]),
      }],
    });
    const windows = await readBuildWindows(projectRoot);
    expect(windows).toMatchObject({ state: 'measured' });
    if (windows.state === 'measured') {
      expect(windows.windows[0].events.filter((event) =>
        event.type === 'build_review_disposition_accepted',
      )).toEqual([expect.objectContaining({ ...disposition, ts: 20 })]);
    }
  });
});
