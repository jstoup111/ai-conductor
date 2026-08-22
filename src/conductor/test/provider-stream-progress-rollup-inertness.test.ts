import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { computeCostRollup, toFeatureUsageTotals } from '../src/engine/cost-rollup.js';
import { renderDaemonEvent } from '../src/daemon-cli.js';
import { computeTimingRollup } from '../src/engine/timing-rollup.js';
import type { ConductorEvent } from '../src/types/events.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function writeLedger(events: readonly object[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'provider-stream-progress-inertness-'));
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

const completedStep = {
  type: 'step_completed',
  step: 'build',
  status: 'done',
  actualProvider: 'codex',
  activeInterval: { startedAtMs: 0, durationMs: 100 },
  observedIntervals: [{ startedAtMs: 20, durationMs: 40 }],
  tokenUsage: { input: 100, output: 20, cacheRead: 10, cacheCreation: 5, costUsd: 0.03 },
};

const progress: ConductorEvent = {
  type: 'provider_stream_progress',
  step: 'build',
  provider: 'codex',
  childObservability: 'unsupported',
  uncachedInputTokens: 1_000,
  cachedInputTokens: 400,
  outputTokens: 200,
  ts: '2026-08-20T12:00:00.000Z',
};

describe('provider stream progress inertness', () => {
  it('leaves timing and cost rollups byte-identical to a ledger without live records', async () => {
    const baseline = await writeLedger([{ type: 'step_started', step: 'build' }, completedStep]);
    const interleaved = await writeLedger([
      { type: 'step_started', step: 'build' },
      progress,
      completedStep,
      { ...progress, ts: '2026-08-20T12:00:01.000Z', uncachedInputTokens: 1_500 },
    ]);

    const [baselineTiming, interleavedTiming, baselineCost, interleavedCost] = await Promise.all([
      computeTimingRollup(baseline),
      computeTimingRollup(interleaved),
      computeCostRollup(baseline),
      computeCostRollup(interleaved),
    ]);

    expect({
      timing: JSON.stringify(interleavedTiming),
      cost: JSON.stringify(interleavedCost),
      featureTotals: toFeatureUsageTotals(interleavedCost),
    }).toEqual({
      timing: JSON.stringify(baselineTiming),
      cost: JSON.stringify(baselineCost),
      featureTotals: {
        dispatches: 1,
        meteredDispatches: 1,
        unmeteredDispatches: 0,
        costUsd: 0.03,
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 15,
      },
    });
  });

  it('writes no daemon-log line for live provider progress', () => {
    const lines: string[] = [];

    renderDaemonEvent(progress, (line) => lines.push(line));

    expect(lines).toEqual([]);
  });
});
