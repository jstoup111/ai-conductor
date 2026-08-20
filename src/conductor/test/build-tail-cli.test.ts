import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProgram } from '../src/cli.js';
import {
  detectBuildTailCommand,
  dispatchBuildTailCommand,
} from '../src/engine/build-tail-cli.js';
import { computeBuildReviewMetrics } from '../src/engine/build-tail-rollup.js';

it('projects effective laps while retaining raw failures and excluding skipped rubrics', () => {
  expect(computeBuildReviewMetrics([
    { type: 'build_review_rubric_result', ts: 1, rubric: 'scope', lapId: 'lap-1', verdict: 'FAIL' },
    { type: 'build_review_rubric_infrastructure_failure', ts: 2, rubric: 'wiring', lapId: 'lap-1', reason: 'provider-error' },
    { type: 'build_review_rubric_skipped', ts: 3, rubric: 'tautology', lapId: 'lap-1', reason: 'disabled' },
    { type: 'build_review_cache_hit', ts: 4, rubric: 'scope', lapId: 'lap-1' },
    { type: 'build_review_outer_verdict', ts: 5, lapId: 'lap-1', rawVerdict: 'FAIL', effectiveVerdict: 'PASS' },
  ])).toEqual({ lapsToPass: 1, rubricFailureRates: { scope: { failures: 1, judged: 1 } }, skipped: 1, cacheHits: 1, infrastructureFailures: 1, skipReasons: { disabled: 1 } });
});

it('counts skip-only and infrastructure-only review laps before a later passing lap', () => {
  expect(computeBuildReviewMetrics([
    { type: 'build_review_rubric_skipped', ts: 1, rubric: 'scope', lapId: 'lap-skipped', reason: 'disabled' },
    { type: 'build_review_rubric_infrastructure_failure', ts: 2, rubric: 'scope', lapId: 'lap-infrastructure', reason: 'artifact-read-failed' },
    { type: 'build_review_outer_verdict', ts: 3, lapId: 'lap-passed', rawVerdict: 'PASS', effectiveVerdict: 'PASS' },
  ])).toMatchObject({ lapsToPass: 3, skipped: 1, infrastructureFailures: 1, skipReasons: { disabled: 1 } });
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function writeLedgers(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'build-tail-cli-'));
  temporaryDirectories.push(directory);
  const pipelineDirectory = join(directory, '.pipeline');
  await mkdir(pipelineDirectory, { recursive: true });
  await writeFile(join(pipelineDirectory, 'events.jsonl'), [
    { type: 'step_started', step: 'build', ts: 10 },
    { type: 'build_progress', resolved: 1, total: 2, ts: 20 },
    { type: 'build_progress', resolved: 2, total: 2, ts: 30 },
    { type: 'build_progress', resolved: 2, total: 2, headMoved: true, ts: 40 },
    { type: 'step_completed', step: 'build', status: 'done', ts: 50 },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
  await writeFile(join(pipelineDirectory, 'pipeline-events.jsonl'), [
    { type: 'pipeline_closeout', obligation: 'summary', startedAt: 42, endedAt: 47, ts: 42 },
    { type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 31, endedAt: 36, ts: 31 },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
  return directory;
}

describe('build-tail CLI', () => {
  it('registers and deterministically renders each window plus aggregate distribution', async () => {
    const directory = await writeLedgers();
    const command = detectBuildTailCommand(['node', 'conduct-ts', 'build-tail']);
    const first: string[] = [];
    const second: string[] = [];

    expect(createProgram().commands.map((entry) => entry.name())).toContain('build-tail');
    expect(command).toEqual({ kind: 'build-tail' });
    await expect(dispatchBuildTailCommand(command!, { cwd: directory, print: (line) => first.push(line) }))
      .resolves.toBe(0);
    await expect(dispatchBuildTailCommand(command!, { cwd: directory, print: (line) => second.push(line) }))
      .resolves.toBe(0);
    expect(first).toEqual(second);
    expect(first).toEqual([
      'Build tail rollup: measured\n' +
        'Windows: 1\n' +
        'Window 1: first-pass\n' +
        '  Task execution: 20ms\n' +
        '  Post-resolution ticks: remediation=1, closeout=0\n' +
        '  Closeout: 10ms (evaluator=5ms, summary=5ms)\n' +
        'Aggregate:\n' +
        '  Classifications: first-pass=1, re-entry=0\n' +
        '  Task execution: 20ms across 1 window\n' +
        '  Post-resolution ticks: remediation=1, closeout=0\n' +
        '  Closeout: 10ms recorded across 1 window\n' +
        '  Obligations: evaluator=5ms, summary=5ms',
    ]);
  });

  it('reports unavailable cleanly when no ledger exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'build-tail-cli-'));
    temporaryDirectories.push(directory);
    const output: string[] = [];

    await expect(dispatchBuildTailCommand({ kind: 'build-tail' }, {
      cwd: directory,
      print: (line) => output.push(line),
    })).resolves.toBe(0);

    expect(output).toEqual(['Build tail rollup: unavailable']);
  });

  it('renders closeout timing when only the sibling ledger records closeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'build-tail-cli-'));
    temporaryDirectories.push(directory);
    const pipelineDirectory = join(directory, '.pipeline');
    await mkdir(pipelineDirectory, { recursive: true });
    await writeFile(join(pipelineDirectory, 'events.jsonl'), `${JSON.stringify({ type: 'feature_started', ts: 10 })}\n`, 'utf8');
    await writeFile(join(pipelineDirectory, 'pipeline-events.jsonl'), [
      { type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 100, endedAt: 3100, ts: 3100 },
      { type: 'pipeline_closeout', obligation: 'summary', startedAt: 3200, endedAt: 3700, ts: 3700 },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
    const output: string[] = [];

    await expect(dispatchBuildTailCommand({ kind: 'build-tail' }, {
      cwd: directory,
      print: (line) => output.push(line),
    })).resolves.toBe(0);

    expect(output).toEqual([
      'Build tail rollup: partial\n' +
        'Closeout: 3500ms (evaluator=3000ms, summary=500ms)',
    ]);
  });
});
