import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeBuildReviewMetrics, computeBuildTailRollup, readBuildWindows } from '../src/engine/build-tail-rollup.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function ledger(events: object[], pipeline: object[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'build-tail-rollup-')); directories.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline/events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  await writeFile(join(root, '.pipeline/pipeline-events.jsonl'), `${pipeline.map((event) => JSON.stringify(event)).join('\n')}\n`);
  return root;
}

describe('build tail rollup', () => {
  it('counts scope-empty as a skip rather than a judged rubric result', () => {
    expect(computeBuildReviewMetrics([
      { type: 'build_review_rubric_skipped', rubric: 'testQuality', lapId: 'lap-2', reason: 'scope-empty' },
    ])).toMatchObject({
      skipped: 1,
      skipReasons: { 'scope-empty': 1 },
      rubricFailureRates: {},
    });
  });

  it('measures task execution and post-resolution ticks without a closeout duration', () => {
    const rollup = computeBuildTailRollup([{ startedAt: 10, endedAt: 50, events: [
      { type: 'build_progress', resolved: 1, total: 2, ts: 20 }, { type: 'build_progress', resolved: 2, total: 2, ts: 30 },
      { type: 'build_progress', resolved: 2, total: 2, headMoved: true, ts: 40 }, { type: 'build_progress', resolved: 2, total: 2, ts: 45 },
    ] }]);
    expect(rollup).toEqual({ state: 'measured', windows: [{ classification: 'first-pass', taskExecution: { startedAt: 10, endedAt: 30, durationMs: 20 }, postResolutionTicks: [{ ts: 40, classification: 'remediation' }, { ts: 45, classification: 'closeout' }] }] });
  });

  it('is unavailable without a completed build window even when historical closeout records exist', async () => {
    const root = await ledger([{ type: 'feature_started', ts: 1 }], [{ type: 'pipeline_closeout', ts: 2 }]);
    await expect(readBuildWindows(root)).resolves.toEqual({ state: 'unavailable' });
  });

  it('ignores historical closeout records while preserving measured execution and ticks', async () => {
    const events = [
      { type: 'step_started', step: 'build', ts: 10 }, { type: 'build_progress', resolved: 0, total: 1, ts: 15 },
      { type: 'build_progress', resolved: 1, total: 1, ts: 20 }, { type: 'build_progress', resolved: 1, total: 1, ts: 25 },
      { type: 'step_completed', step: 'build', status: 'done', ts: 30 },
    ];
    const withoutCloseout = await ledger(events);
    const withCloseout = await ledger(events, [{ type: 'pipeline_closeout', ts: 22 }]);
    const [baseline, historical] = await Promise.all([readBuildWindows(withoutCloseout), readBuildWindows(withCloseout)]);
    expect(baseline).toMatchObject({ state: 'measured' });
    expect(historical).toMatchObject({ state: 'measured' });
    if (baseline.state !== 'measured' || historical.state !== 'measured') throw new Error('expected measured windows');
    expect(computeBuildTailRollup(historical.windows)).toEqual(computeBuildTailRollup(baseline.windows));
  });

  it('is partial when a completed window has no progress ticks', () => {
    expect(computeBuildTailRollup([{ startedAt: 10, endedAt: 20, events: [] }])).toEqual({ state: 'partial' });
  });
});
