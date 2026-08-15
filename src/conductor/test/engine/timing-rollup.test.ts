import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
import {
  intersectIntervalUnions,
  unionIntervals,
} from '../../src/engine/interval-algebra.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function writeFeatureEvents(events: readonly object[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'timing-rollup-'));
  temporaryDirectories.push(directory);
  const pipelineDirectory = join(directory, '.pipeline');
  await mkdir(pipelineDirectory, { recursive: true });
  await writeFile(
    join(pipelineDirectory, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
  return directory;
}

async function writeRawFeatureEvents(raw: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'timing-rollup-'));
  temporaryDirectories.push(directory);
  const pipelineDirectory = join(directory, '.pipeline');
  await mkdir(pipelineDirectory, { recursive: true });
  await writeFile(join(pipelineDirectory, 'events.jsonl'), raw, 'utf8');
  return directory;
}

describe('unionIntervals', () => {
  it.each([
    {
      name: 'disjoint intervals',
      input: [
        { startedAtMs: 0, durationMs: 10 },
        { startedAtMs: 20, durationMs: 5 },
      ],
      expected: [
        { startedAtMs: 0, durationMs: 10 },
        { startedAtMs: 20, durationMs: 5 },
      ],
    },
    {
      name: 'overlapping intervals',
      input: [
        { startedAtMs: 100, durationMs: 200 },
        { startedAtMs: 200, durationMs: 200 },
      ],
      expected: [{ startedAtMs: 100, durationMs: 300 }],
    },
    {
      name: 'nested intervals',
      input: [
        { startedAtMs: 0, durationMs: 100 },
        { startedAtMs: 25, durationMs: 10 },
      ],
      expected: [{ startedAtMs: 0, durationMs: 100 }],
    },
    {
      name: 'adjacent intervals',
      input: [
        { startedAtMs: 0, durationMs: 10 },
        { startedAtMs: 10, durationMs: 5 },
      ],
      expected: [{ startedAtMs: 0, durationMs: 15 }],
    },
    {
      name: 'duplicate intervals',
      input: [
        { startedAtMs: 5, durationMs: 10 },
        { startedAtMs: 5, durationMs: 10 },
      ],
      expected: [{ startedAtMs: 5, durationMs: 10 }],
    },
    {
      name: 'shuffled intervals',
      input: [
        { startedAtMs: 30, durationMs: 10 },
        { startedAtMs: 0, durationMs: 10 },
        { startedAtMs: 8, durationMs: 25 },
      ],
      expected: [{ startedAtMs: 0, durationMs: 40 }],
    },
  ])('returns the exact deterministic union for $name', ({ input, expected }) => {
    expect(unionIntervals(input)).toEqual({ intervals: expected, invalidIntervals: [] });
  });

  it('reports reversed and non-finite inputs without inflating the union', () => {
    const reversed = { startedAtMs: 20, durationMs: -10 };
    const nonFinite = { startedAtMs: Number.POSITIVE_INFINITY, durationMs: 50 };
    const result = unionIntervals([
      { startedAtMs: 0, durationMs: 10 },
      reversed,
      nonFinite,
    ]);

    expect(result).toEqual({
      intervals: [{ startedAtMs: 0, durationMs: 10 }],
      invalidIntervals: [reversed, nonFinite],
    });
  });
});

describe('intersectIntervalUnions', () => {
  it('returns the exact overlap between two interval sets', () => {
    expect(
      intersectIntervalUnions(
        [
          { startedAtMs: 0, durationMs: 20 },
          { startedAtMs: 30, durationMs: 20 },
        ],
        [
          { startedAtMs: 10, durationMs: 30 },
          { startedAtMs: 45, durationMs: 10 },
        ],
      ),
    ).toEqual({
      intervals: [
        { startedAtMs: 10, durationMs: 10 },
        { startedAtMs: 30, durationMs: 10 },
        { startedAtMs: 45, durationMs: 5 },
      ],
      invalidIntervals: [],
    });
  });
});

describe('computeTimingRollup', () => {
  it('consumes provider intervals from the merged feature-event stream', async () => {
    const directory = await writeFeatureEvents([
      { type: 'step_completed', step: 'build', activeInterval: { startedAtMs: 0, durationMs: 100 } },
    ]);
    await writeFile(join(directory, '.pipeline', 'pipeline-events.jsonl'), `${JSON.stringify({
      type: 'provider_attempt', step: 'build', invoked: true,
      observedIntervals: [{ startedAtMs: 20, durationMs: 40 }], ts: Date.now(),
    })}\n`);

    expect(await computeTimingRollup(directory)).toEqual({
      state: 'measured', activeMs: 100, providerActiveMs: 40, noProviderActiveMs: 60,
    });
  });

  it('partitions overlapping active and provider intervals exactly', async () => {
    const directory = await writeFeatureEvents([
      {
        type: 'step_completed',
        step: 'manual_test',
        activeInterval: { startedAtMs: 100, durationMs: 200.6 },
        observedIntervals: [
          { startedAtMs: 120, durationMs: 70.4 },
          { startedAtMs: 160, durationMs: 80.2 },
        ],
      },
      {
        type: 'parallel_completed',
        step: 'ship_validation',
        activeInterval: { startedAtMs: 250, durationMs: 150 },
        observedIntervals: [{ startedAtMs: 275, durationMs: 60 }],
      },
    ]);

    const result = await computeTimingRollup(directory);

    expect(result).toEqual({
      state: 'measured',
      activeMs: 300,
      providerActiveMs: 180,
      noProviderActiveMs: 120,
    });
  });

  it('includes failed and retried provider occupancy in the measured partition', async () => {
    const directory = await writeFeatureEvents([
      {
        type: 'provider_attempt',
        step: 'plan',
        outcome: 'failure',
        invoked: true,
        observedIntervals: [{ startedAtMs: 10, durationMs: 30 }],
      },
      {
        type: 'step_failed',
        step: 'plan',
        retryCount: 1,
        activeInterval: { startedAtMs: 0, durationMs: 50 },
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        outcome: 'success',
        invoked: true,
        observedIntervals: [{ startedAtMs: 60, durationMs: 20 }],
      },
      {
        type: 'step_completed',
        step: 'plan',
        activeInterval: { startedAtMs: 50, durationMs: 50 },
      },
    ]);

    expect(await computeTimingRollup(directory)).toEqual({
      state: 'measured',
      activeMs: 100,
      providerActiveMs: 50,
      noProviderActiveMs: 50,
    });
  });

  it('measures a failed parallel group once when several branches emit failures', async () => {
    const directory = await writeFeatureEvents([
      {
        type: 'parallel_started',
        step: 'ship_validation',
        branches: ['manual_test', 'prd_audit'],
      },
      {
        type: 'parallel_failure',
        step: 'ship_validation',
        branch: 'manual_test',
        error: 'manual test failed',
        activeInterval: { startedAtMs: 100, durationMs: 80 },
      },
      {
        type: 'parallel_failure',
        step: 'ship_validation',
        branch: 'prd_audit',
        error: 'PRD audit failed',
      },
    ]);

    expect(await computeTimingRollup(directory)).toEqual({
      state: 'measured',
      activeMs: 80,
      providerActiveMs: 0,
      noProviderActiveMs: 80,
    });
  });

  it.each([
    {
      name: 'an invoked provider attempt without observed intervals',
      events: [
        {
          type: 'provider_attempt',
          step: 'plan',
          invoked: true,
          outcome: 'success',
        },
        {
          type: 'step_completed',
          step: 'plan',
          activeInterval: { startedAtMs: 0, durationMs: 100 },
        },
      ],
      expected: { state: 'partial', activeMs: 100 },
    },
    {
      name: 'a malformed provider interval beside trustworthy active evidence',
      events: [
        {
          type: 'provider_attempt',
          step: 'plan',
          invoked: true,
          observedIntervals: [{ startedAtMs: 10, durationMs: -5 }],
        },
        {
          type: 'step_completed',
          step: 'plan',
          activeInterval: { startedAtMs: 0, durationMs: 100 },
        },
      ],
      expected: { state: 'partial', activeMs: 100 },
    },
    {
      name: 'an unmatched step start',
      events: [{ type: 'step_started', step: 'plan' }],
      expected: { state: 'partial' },
    },
    {
      name: 'an unmatched parallel failure',
      events: [
        {
          type: 'parallel_failure',
          step: 'ship_validation',
          branch: 'manual_test',
          error: 'manual test failed',
        },
      ],
      expected: { state: 'partial' },
    },
    {
      name: 'a parallel lifecycle whose terminal is missing active evidence',
      events: [
        {
          type: 'parallel_started',
          step: 'ship_validation',
          branches: ['manual_test'],
        },
        {
          type: 'parallel_failure',
          step: 'ship_validation',
          branch: 'manual_test',
          error: 'manual test failed',
        },
      ],
      expected: { state: 'partial' },
    },
    {
      name: 'provider evidence outside known active execution',
      events: [
        {
          type: 'provider_attempt',
          step: 'plan',
          invoked: true,
          observedIntervals: [{ startedAtMs: 200, durationMs: 20 }],
        },
        {
          type: 'step_completed',
          step: 'plan',
          activeInterval: { startedAtMs: 0, durationMs: 100 },
        },
      ],
      expected: { state: 'partial' },
    },
    {
      name: 'provider-only evidence',
      events: [
        {
          type: 'provider_attempt',
          step: 'plan',
          invoked: true,
          observedIntervals: [{ startedAtMs: 10, durationMs: 20 }],
        },
      ],
      expected: { state: 'unavailable' },
    },
    {
      name: 'no timing evidence',
      events: [{ type: 'feature_started', feature: 'example' }],
      expected: { state: 'unavailable' },
    },
    {
      name: 'a mixed-version ledger with a legacy terminal event',
      events: [
        { type: 'step_completed', step: 'explore' },
        {
          type: 'step_completed',
          step: 'plan',
          activeInterval: { startedAtMs: 100, durationMs: 50 },
          observedIntervals: [{ startedAtMs: 110, durationMs: 20 }],
        },
      ],
      expected: { state: 'partial' },
    },
  ])('classifies $name without fabricating components', async ({ events, expected }) => {
    const directory = await writeFeatureEvents(events);

    expect(await computeTimingRollup(directory)).toEqual(expected);
  });

  it('fails soft on malformed JSON without exposing an untrustworthy partition', async () => {
    const directory = await writeRawFeatureEvents(
      [
        JSON.stringify({
          type: 'step_completed',
          step: 'plan',
          activeInterval: { startedAtMs: 0, durationMs: 100 },
          observedIntervals: [{ startedAtMs: 10, durationMs: 20 }],
        }),
        '{"type":',
      ].join('\n'),
    );

    expect(await computeTimingRollup(directory)).toEqual({ state: 'partial' });
  });
});
