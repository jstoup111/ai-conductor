import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';

import { appendCloseoutEvent } from '../src/engine/closeout-events.js';

describe('appendCloseoutEvent', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true,
    })));
  });

  it('creates the pipeline ledger when absent', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-events-'));
    directories.push(projectRoot);

    appendCloseoutEvent(projectRoot, {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 140,
    });
    await expect(readFile(join(projectRoot, '.pipeline/pipeline-events.jsonl'), 'utf8'))
      .resolves.toBe(
        '{"type":"pipeline_closeout","obligation":"evaluator","startedAt":100,"endedAt":140,"ts":140}\n',
      );
  });

  it('appends events in order and leaves the engine ledger unchanged', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'closeout-events-'));
    directories.push(projectRoot);
    const engineLedger = join(projectRoot, '.pipeline/events.jsonl');
    const originalEngineLedger = '{"type":"step_started","step":"build","ts":1}\n';
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(engineLedger, originalEngineLedger, 'utf8');

    appendCloseoutEvent(projectRoot, {
      type: 'pipeline_closeout',
      obligation: 'evaluator',
      startedAt: 100,
      endedAt: 140,
      ts: 140,
    });
    appendCloseoutEvent(projectRoot, {
      type: 'pipeline_closeout',
      obligation: 'summary',
      startedAt: 150,
      endedAt: 180,
      ts: 180,
    });

    const pipelineLedger = await readFile(
      join(projectRoot, '.pipeline/pipeline-events.jsonl'),
      'utf8',
    );

    expect(pipelineLedger.trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      {
        type: 'pipeline_closeout',
        obligation: 'evaluator',
        startedAt: 100,
        endedAt: 140,
        ts: 140,
      },
      {
        type: 'pipeline_closeout',
        obligation: 'summary',
        startedAt: 150,
        endedAt: 180,
        ts: 180,
      },
    ]);
    await expect(readFile(engineLedger, 'utf8')).resolves.toBe(originalEngineLedger);
  });
});
