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

  it('attributes every provider attempt without double-counting successful step totals', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'unavailable',
        invoked: true,
        tokenUsage: {
          input: 40,
          output: 10,
          cacheRead: 4,
          cacheCreation: 1,
          costUsd: 0.02,
        },
      }),
      JSON.stringify({
        type: 'provider_fallback',
        step: 'plan',
        failedProvider: 'codex',
        reason: 'model ladder exhausted',
        nextProvider: 'claude',
      }),
      JSON.stringify({
        type: 'provider_attempt',
        step: 'plan',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        tokenUsage: {
          input: 100,
          output: 20,
          cacheRead: 10,
          cacheCreation: 2,
          costUsd: 0.05,
        },
      }),
      JSON.stringify({
        type: 'step_completed',
        step: 'plan',
        status: 'done',
        preferredProvider: 'codex',
        actualProvider: 'claude',
        tokenUsage: {
          input: 100,
          output: 20,
          cacheRead: 10,
          cacheCreation: 2,
          costUsd: 0.05,
        },
      }),
      JSON.stringify({
        type: 'step_completed',
        step: 'legacy',
        status: 'done',
        tokenUsage: {
          input: 7,
          output: 3,
          cacheRead: 0,
          cacheCreation: 0,
          costUsd: 0.01,
        },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup).toEqual({
      tokens: {
        input: 147,
        output: 33,
        cacheRead: 14,
        cacheCreation: 3,
      },
      costUsd: expect.closeTo(0.08, 5),
      dispatches: 3,
      retries: 0,
      halts: 0,
      unmetered: { count: 0, durationMs: 0 },
      providers: {
        codex: {
          tokens: {
            input: 40,
            output: 10,
            cacheRead: 4,
            cacheCreation: 1,
          },
          costUsd: expect.closeTo(0.02, 5),
          dispatches: 1,
          unmetered: { count: 0, durationMs: 0 },
        },
        claude: {
          tokens: {
            input: 100,
            output: 20,
            cacheRead: 10,
            cacheCreation: 2,
          },
          costUsd: expect.closeTo(0.05, 5),
          dispatches: 1,
          unmetered: { count: 0, durationMs: 0 },
        },
      },
    });
  });

  it('never deduplicates an attributed completion against a future provider attempt', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'step_completed',
        step: 'plan',
        status: 'done',
        preferredProvider: 'codex',
        actualProvider: 'claude',
        tokenUsage: { input: 7, output: 2, costUsd: 0.01 },
      }),
      JSON.stringify({
        type: 'provider_attempt',
        step: 'plan',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 100, output: 20, costUsd: 0.05 },
      }),
      JSON.stringify({
        type: 'step_completed',
        step: 'plan',
        status: 'done',
        preferredProvider: 'claude',
        actualProvider: 'claude',
        tokenUsage: { input: 100, output: 20, costUsd: 0.05 },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup).toMatchObject({
      tokens: { input: 107, output: 22 },
      costUsd: expect.closeTo(0.06, 5),
      dispatches: 2,
      providers: {
        claude: {
          tokens: { input: 107, output: 22 },
          costUsd: expect.closeTo(0.06, 5),
          dispatches: 2,
        },
      },
    });
  });

  it('preserves provider keys that collide with inherited object properties', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt',
        step: 'plan',
        provider: 'toString',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 11, output: 2, costUsd: 0.01 },
      }),
      JSON.stringify({
        type: 'provider_attempt',
        step: 'build',
        provider: '__proto__',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 23, output: 5, costUsd: 0.02 },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup.providers).toEqual({
      toString: {
        tokens: { input: 11, output: 2, cacheRead: 0, cacheCreation: 0 },
        costUsd: expect.closeTo(0.01, 5),
        dispatches: 1,
        unmetered: { count: 0, durationMs: 0 },
      },
      ['__proto__']: {
        tokens: { input: 23, output: 5, cacheRead: 0, cacheCreation: 0 },
        costUsd: expect.closeTo(0.02, 5),
        dispatches: 1,
        unmetered: { count: 0, durationMs: 0 },
      },
    });
  });

  it('marks the rollup unmetered when events.jsonl is missing', async () => {
    const rollup = await computeCostRollup(dir);

    expect(rollup).toEqual({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      costUsd: 0,
      dispatches: 0,
      retries: 0,
      halts: 0,
      unmetered: { count: 1, durationMs: 0 },
    });
  });

  it('returns a clean all-zero rollup for a readable empty events.jsonl', async () => {
    await writeEvents([]);

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

  it('marks the rollup unmetered when events.jsonl cannot be read', async () => {
    await mkdir(join(dir, '.pipeline', 'events.jsonl'), { recursive: true });

    const rollup = await computeCostRollup(dir);

    expect(rollup.unmetered.count).toBeGreaterThan(0);
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
