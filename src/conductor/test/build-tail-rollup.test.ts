import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeBuildTailRollup, readBuildWindows } from '../src/engine/build-tail-rollup.js';

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

async function writeRawLedgers(args: {
  engine: string;
  pipeline?: string;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'build-tail-rollup-'));
  temporaryDirectories.push(directory);
  const pipelineDirectory = join(directory, '.pipeline');
  await mkdir(pipelineDirectory, { recursive: true });
  await writeFile(join(pipelineDirectory, 'events.jsonl'), args.engine, 'utf8');
  if (args.pipeline !== undefined) {
    await writeFile(join(pipelineDirectory, 'pipeline-events.jsonl'), args.pipeline, 'utf8');
  }
  return directory;
}

describe('readBuildWindows', () => {
  it('normalizes ISO ledger timestamps while retaining numeric timestamp compatibility', async () => {
    const directory = await writeLedgers({
      engine: [
        { type: 'step_started', step: 'build', index: 0, ts: '1970-01-01T00:00:00.010Z' },
        { type: 'build_progress', step: 'build', resolved: 1, total: 1, ts: '1970-01-01T00:00:00.030Z' },
        { type: 'step_completed', step: 'build', status: 'done', ts: '1970-01-01T00:00:00.050Z' },
      ],
      pipeline: [
        { type: 'pipeline_closeout', obligation: 'summary', startedAt: 15, endedAt: 20, ts: 20 },
      ],
    });

    await expect(readBuildWindows(directory)).resolves.toEqual({
      state: 'measured',
      windows: [
        {
          startedAt: 10,
          endedAt: 50,
          events: [
            { type: 'step_started', step: 'build', index: 0, ts: 10 },
            { type: 'pipeline_closeout', obligation: 'summary', startedAt: 15, endedAt: 20, ts: 20 },
            { type: 'build_progress', step: 'build', resolved: 1, total: 1, ts: 30 },
            { type: 'step_completed', step: 'build', status: 'done', ts: 50 },
          ],
        },
      ],
    });
  });

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

    await expect(readBuildWindows(directory)).resolves.toEqual({
      state: 'measured',
      windows: [
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
      ],
    });
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

    await expect(readBuildWindows(directory)).resolves.toEqual({
      state: 'measured',
      windows: [
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
      ],
    });
  });
});

describe('computeBuildTailRollup', () => {
  it('classifies first-pass task execution, re-entry, remediation, and closeout obligations', () => {
    expect(computeBuildTailRollup([
      {
        startedAt: 100,
        endedAt: 200,
        events: [
          { type: 'step_started', step: 'build', ts: 100 },
          { type: 'build_progress', step: 'build', resolved: 1, total: 2, ts: 120 },
          { type: 'build_progress', step: 'build', resolved: 2, total: 2, ts: 140 },
          { type: 'build_progress', step: 'build', resolved: 2, total: 2, headMoved: true, ts: 160 },
          { type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 165, endedAt: 180, ts: 180 },
          { type: 'step_completed', step: 'build', ts: 200 },
        ],
      },
      {
        startedAt: 300,
        endedAt: 400,
        events: [
          { type: 'step_started', step: 'build', ts: 300 },
          { type: 'build_progress', step: 'build', resolved: 2, total: 2, ts: 320 },
          { type: 'step_completed', step: 'build', ts: 400 },
        ],
      },
    ])).toEqual({
      state: 'measured',
      windows: [
        {
          classification: 'first-pass',
          taskExecution: { startedAt: 100, endedAt: 140, durationMs: 40 },
          postResolutionTicks: [
            { ts: 160, classification: 'remediation' },
          ],
          closeout: {
            state: 'recorded',
            durationMs: 15,
            obligations: { evaluator: 15 },
          },
        },
        {
          classification: 're-entry',
          taskExecution: undefined,
          postResolutionTicks: [],
          closeout: { state: 'unrecorded' },
        },
      ],
    });
  });

  it('does not fabricate a zero closeout duration when no closeout event was recorded', () => {
    expect(computeBuildTailRollup([
      {
        startedAt: 10,
        endedAt: 20,
        events: [
          { type: 'build_progress', resolved: 1, total: 1, ts: 15 },
        ],
      },
    ])).toMatchObject({
      state: 'measured',
      windows: [{ closeout: { state: 'unrecorded' } }],
    });
  });

  it('returns partial for a completed window with no progress ticks or invalid closeout duration', () => {
    expect(computeBuildTailRollup([
      {
        startedAt: 10,
        endedAt: 20,
        events: [],
      },
    ])).toEqual({ state: 'partial' });

    expect(computeBuildTailRollup([
      {
        startedAt: 10,
        endedAt: 20,
        events: [
          { type: 'build_progress', resolved: 1, total: 1, ts: 15 },
          { type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 19, endedAt: 18, ts: 19 },
        ],
      },
    ])).toEqual({ state: 'partial' });
  });
});

describe('build-tail rollup evidence states', () => {
  it.each([
    ['engine', { engine: '{"type":' }],
    ['pipeline', {
      engine: `${JSON.stringify({ type: 'step_started', step: 'build', ts: 10 })}\n${JSON.stringify({ type: 'step_completed', step: 'build', ts: 20 })}\n`,
      pipeline: '{"type":',
    }],
  ])('returns partial rather than throwing when the %s ledger is malformed', async (_ledger, ledgers) => {
    const directory = await writeRawLedgers(ledgers);

    await expect(readBuildWindows(directory)).resolves.toEqual({ state: 'partial' });
  });

  it('returns unavailable when no build window exists', async () => {
    const directory = await writeLedgers({ engine: [{ type: 'feature_started', ts: 10 }] });

    await expect(readBuildWindows(directory)).resolves.toEqual({ state: 'unavailable' });
  });

  it('returns partial for an unterminated build window', async () => {
    const directory = await writeLedgers({ engine: [{ type: 'step_started', step: 'build', ts: 10 }] });

    await expect(readBuildWindows(directory)).resolves.toEqual({ state: 'partial' });
  });
});
