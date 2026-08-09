import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBuildWindows } from '../src/engine/build-tail-rollup.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function writeLedgers(args: {
  engine: readonly object[];
  pipeline?: readonly object[];
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'build-tail-rollup-'));
  temporaryDirectories.push(directory);
  const pipelineDirectory = join(directory, '.pipeline');
  await mkdir(pipelineDirectory, { recursive: true });
  await writeFile(
    join(pipelineDirectory, 'events.jsonl'),
    `${args.engine.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
  if (args.pipeline !== undefined) {
    await writeFile(
      join(pipelineDirectory, 'pipeline-events.jsonl'),
      `${args.pipeline.map((event) => JSON.stringify(event)).join('\n')}\n`,
      'utf8',
    );
  }
  return directory;
}

describe('readBuildWindows', () => {
  it('stably merges both ledgers by ts and retains closeout events within a build window', async () => {
    const directory = await writeLedgers({
      engine: [
        { type: 'step_started', step: 'build', index: 0, ts: 10 },
        { type: 'build_progress', step: 'build', resolved: 1, total: 2, ts: 30 },
        { type: 'step_completed', step: 'build', status: 'done', ts: 50 },
      ],
      pipeline: [
        { type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 20, endedAt: 25, ts: 20 },
        { type: 'pipeline_closeout', obligation: 'summary', startedAt: 35, endedAt: 40, ts: 35 },
      ],
    });

    await expect(readBuildWindows(directory)).resolves.toEqual([
      {
        startedAt: 10,
        endedAt: 50,
        events: [
          { type: 'step_started', step: 'build', index: 0, ts: 10 },
          { type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 20, endedAt: 25, ts: 20 },
          { type: 'build_progress', step: 'build', resolved: 1, total: 2, ts: 30 },
          { type: 'pipeline_closeout', obligation: 'summary', startedAt: 35, endedAt: 40, ts: 35 },
          { type: 'step_completed', step: 'build', status: 'done', ts: 50 },
        ],
      },
    ]);
  });

  it('extracts adjacent build windows, including one with no build_progress events', async () => {
    const directory = await writeLedgers({
      engine: [
        { type: 'step_started', step: 'build', index: 0, ts: 10 },
        { type: 'step_completed', step: 'build', status: 'done', ts: 20 },
        { type: 'step_started', step: 'build', index: 1, ts: 20 },
        { type: 'step_completed', step: 'build', status: 'done', ts: 30 },
      ],
    });

    await expect(readBuildWindows(directory)).resolves.toEqual([
      {
        startedAt: 10,
        endedAt: 20,
        events: [
          { type: 'step_started', step: 'build', index: 0, ts: 10 },
          { type: 'step_completed', step: 'build', status: 'done', ts: 20 },
        ],
      },
      {
        startedAt: 20,
        endedAt: 30,
        events: [
          { type: 'step_started', step: 'build', index: 1, ts: 20 },
          { type: 'step_completed', step: 'build', status: 'done', ts: 30 },
        ],
      },
    ]);
  });
});
