import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeCostRollup } from '../../src/engine/cost-rollup.js';

describe('engine/cost-rollup', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cost-rollup-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeEvents(lines: string[]) {
    const pipelineDir = join(dir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(join(pipelineDir, 'events.jsonl'), lines.join('\n') + '\n', 'utf-8');
  }

  it('sums tokens/cost, counts dispatches/retries/halts for metered events', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'step_completed',
        step: 'build',
        status: 'done',
        tokenUsage: { input: 1000, output: 200, cacheRead: 50, cacheCreation: 10, costUsd: 0.12, numTurns: 3, durationMs: 4213 },
        model: 'claude-sonnet-5',
      }),
      JSON.stringify({
        type: 'step_completed',
        step: 'gate',
        status: 'done',
        tokenUsage: { input: 500, output: 100, cacheRead: 0, cacheCreation: 0, costUsd: 0.05 },
        model: 'claude-sonnet-5',
      }),
      JSON.stringify({ type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'tests failed' }),
      JSON.stringify({ type: 'loop_halt', reason: 'stuck cap' }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup.tokens).toEqual({ input: 1500, output: 300, cacheRead: 50, cacheCreation: 10 });
    expect(rollup.costUsd).toBeCloseTo(0.17, 5);
    expect(rollup.dispatches).toBe(2);
    expect(rollup.retries).toBe(1);
    expect(rollup.halts).toBe(1);
    expect(rollup.unmetered).toEqual({ count: 0, durationMs: 0 });
  });

  it('returns an all-zero rollup when events.jsonl is missing', async () => {
    const rollup = await computeCostRollup(dir);

    expect(rollup).toEqual({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      costUsd: 0,
      dispatches: 0,
      retries: 0,
      halts: 0,
      unmetered: { count: 0, durationMs: 0 },
    });
  });

  it('skips unparseable lines, folding them into unmetered.count, and still sums good lines', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'step_completed',
        step: 'build',
        status: 'done',
        tokenUsage: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0, costUsd: 0.01 },
      }),
      '{not valid json::',
      JSON.stringify({
        type: 'step_completed',
        step: 'gate',
        status: 'done',
        tokenUsage: { input: 200, output: 40, cacheRead: 0, cacheCreation: 0, costUsd: 0.02 },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup.tokens.input).toBe(300);
    expect(rollup.tokens.output).toBe(60);
    expect(rollup.costUsd).toBeCloseTo(0.03, 5);
    expect(rollup.dispatches).toBe(2);
    expect(rollup.unmetered.count).toBe(1);
  });

  it('handles an all-unmetered fixture', async () => {
    await writeEvents([
      JSON.stringify({ type: 'step_completed', step: 'explore', status: 'done', unmetered: true }),
      JSON.stringify({ type: 'step_completed', step: 'plan', status: 'done', unmetered: true }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup.dispatches).toBe(2);
    expect(rollup.unmetered.count).toBe(2);
    expect(rollup.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
    expect(rollup.costUsd).toBe(0);
  });
});
