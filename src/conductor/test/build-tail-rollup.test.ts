import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeBuildTailRollup, readBuildWindows } from '../src/engine/build-tail-rollup.js';

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
});
