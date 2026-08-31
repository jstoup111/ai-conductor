// Covers: task:1, task:10, task:11
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  computeCostRollup,
  toFeatureCostSnapshot,
  toFeatureUsageTotals,
} from '../../src/engine/cost-rollup.js';
import { classifyMetering } from '../../src/engine/metering.js';
import { formatFeatureUsageTotal } from '../../src/execution/provider-diagnostics.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

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

  it.each([
    [{ input: 100, output: 10, costUsd: 0.12 }, 'fully-metered'],
    [{ input: 100, output: 10, costUsd: 0 }, 'fully-metered'],
    [{ input: 100, output: 10, costUsd: NaN }, 'cost-unmetered'],
    [{ input: 100, output: 10, costUsd: Infinity }, 'cost-unmetered'],
    [{ input: 100, output: 10 }, 'cost-unmetered'],
    [undefined, 'unmetered'],
  ] as const)('classifies %j as %s', (tokenUsage, expected) => {
    expect(classifyMetering(tokenUsage)).toBe(expected);
  });

  it('keeps token usage with absent provider cost visibly cost-unmetered', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt',
        step: 'build',
        provider: 'codex',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 600, output: 60, cacheRead: 40, cacheCreation: 7 },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup).toMatchObject({
      tokens: { input: 600, output: 60, cacheRead: 40, cacheCreation: 7 },
      costUsd: 0,
      dispatches: 1,
      unmetered: { count: 0, durationMs: 0 },
      costUnmetered: { count: 1 },
      providers: {
        codex: {
          tokens: { input: 600, output: 60, cacheRead: 40, cacheCreation: 7 },
          costUsd: 0,
          dispatches: 1,
          unmetered: { count: 0, durationMs: 0 },
          costUnmetered: { count: 1 },
        },
      },
    });
  });

  it('keeps an explicit zero provider cost fully-metered', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt',
        step: 'build',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 100, output: 10, costUsd: 0 },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup).toMatchObject({
      tokens: { input: 100, output: 10 },
      costUsd: 0,
      unmetered: { count: 0, durationMs: 0 },
      costUnmetered: { count: 0 },
      providers: { claude: { costUsd: 0, costUnmetered: { count: 0 } } },
    });
  });

  it('marks a mixed metered and unmetered ledger incomplete without dropping its metered bucket', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt', step: 'build', provider: 'claude', model: 'm1',
        outcome: 'success', invoked: true,
        tokenUsage: { input: 100, output: 10, costUsd: 1, costSource: 'provider' },
      }),
      JSON.stringify({
        type: 'provider_attempt', step: 'build_review', provider: 'codex',
        outcome: 'success', invoked: true,
      }),
    ]);

    const snapshot = toFeatureCostSnapshot(await computeCostRollup(dir));

    expect(snapshot).toMatchObject({ costUsd: 1, costComplete: false });
    expect(snapshot.byDimension).toEqual([
      { step: 'build', model: 'm1', source: 'provider', costUsd: 1 },
    ]);
  });

  it.each([
    [{ count: 0, durationMs: 0 }, undefined, true],
    [{ count: 0, durationMs: 0 }, { count: 0 }, true],
    [{ count: 1, durationMs: 0 }, { count: 0 }, false],
    [{ count: 0, durationMs: 0 }, { count: 1 }, false],
  ] as const)('projects cost completeness from unmetered and cost-unmetered dispatches', (
    unmetered,
    costUnmetered,
    costComplete,
  ) => {
    const byDimension = [{ step: 'build', model: 'm1', costUsd: 1.25 }];
    const tokensByDimension = [{ step: 'build', model: 'm1', tokens: { input: 100, output: 10 } }];

    expect(toFeatureCostSnapshot({
      tokens: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
      costUsd: 1.25,
      byDimension,
      tokensByDimension,
      dispatches: 1,
      retries: 0,
      halts: 0,
      unmetered,
      ...(costUnmetered === undefined ? {} : { costUnmetered }),
    })).toEqual({
      type: 'feature_cost_snapshot',
      costUsd: 1.25,
      costComplete,
      byDimension,
      tokensByDimension,
    });
  });

  it('rolls fully-metered costs into cumulative step, model, and source buckets', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt', step: 'build', provider: 'claude', model: 'm1',
        outcome: 'success', invoked: true,
        tokenUsage: { input: 100, output: 10, costUsd: 1, costSource: 'provider' },
      }),
      JSON.stringify({
        type: 'provider_attempt', step: 'build', provider: 'claude', model: 'm1',
        outcome: 'success', invoked: true,
        tokenUsage: { input: 50, output: 5, costUsd: 0.5, costSource: 'provider' },
      }),
      JSON.stringify({
        type: 'provider_attempt', step: 'build_review', provider: 'codex', model: 'm2',
        outcome: 'success', invoked: true,
        tokenUsage: { input: 200, output: 20, costUsd: 2, costSource: 'rate-card' },
      }),
      JSON.stringify({
        type: 'provider_attempt', step: 'build', provider: 'claude',
        outcome: 'success', invoked: true,
        tokenUsage: { input: 10, output: 1, costUsd: 0.25, costSource: 'provider' },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup.byDimension).toEqual([
      { step: 'build', model: 'm1', source: 'provider', costUsd: 1.5 },
      { step: 'build_review', model: 'm2', source: 'rate-card', costUsd: 2 },
      { step: 'build', source: 'provider', costUsd: 0.25 },
    ]);
    expect((rollup.byDimension ?? []).reduce((sum, bucket) => sum + bucket.costUsd, 0))
      .toBe(rollup.costUsd);
  });

  it('excludes cost-unmetered dispatches from cost buckets but includes their finite token kinds', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt', step: 'build', provider: 'claude', model: 'm1',
        outcome: 'success', invoked: true,
        tokenUsage: { input: 100, output: 10, cacheRead: 8, cacheCreation: 2, costUsd: 1 },
      }),
      JSON.stringify({
        type: 'provider_attempt', step: 'build', provider: 'codex', model: 'm1',
        outcome: 'success', invoked: true,
        tokenUsage: { input: 40, output: 4, cacheRead: 3 },
      }),
      JSON.stringify({
        type: 'provider_attempt', step: 'build_review', provider: 'codex', model: 'm2',
        outcome: 'success', invoked: true,
        tokenUsage: { input: 7, output: 2, costUsd: Number.NaN },
      }),
      JSON.stringify({ type: 'provider_attempt', step: 'review', provider: 'claude', outcome: 'success', invoked: true }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup.byDimension).toEqual([
      { step: 'build', model: 'm1', costUsd: 1 },
    ]);
    expect(rollup.costUnmetered).toEqual({ count: 2 });
    expect(rollup.tokensByDimension).toEqual([
      { step: 'build', model: 'm1', tokens: { input: 140, output: 14, cacheRead: 11, cacheCreation: 2 } },
      { step: 'build_review', model: 'm2', tokens: { input: 7, output: 2 } },
    ]);
  });

  it('keeps partial cost-unmetered and unknown-model token buckets exact', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt', step: 'no_usage', provider: 'claude', outcome: 'success', invoked: true,
      }),
      JSON.stringify({
        type: 'provider_attempt', step: 'build', provider: 'codex', model: 'm1',
        outcome: 'success', invoked: true, tokenUsage: { input: 40, output: 4 },
      }),
      JSON.stringify({
        type: 'provider_attempt', step: 'unknown_model', provider: 'codex',
        outcome: 'success', invoked: true, tokenUsage: { input: 10 },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup.tokensByDimension).toEqual([
      { step: 'build', model: 'm1', tokens: { input: 40, output: 4 } },
      { step: 'unknown_model', tokens: { input: 10 } },
    ]);
    expect(rollup.tokensByDimension).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'no_usage' }),
    ]));
    expect(toFeatureCostSnapshot(rollup)).toMatchObject({ costComplete: false });
  });

  it('preserves all three metering states without inventing a cost', async () => {
    await writeEvents([
      JSON.stringify({
        type: 'provider_attempt',
        step: 'build',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 100, output: 10, costUsd: 0.42, costSource: 'provider' },
      }),
      JSON.stringify({
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 80, output: 8 },
      }),
      JSON.stringify({
        type: 'provider_attempt',
        step: 'review',
        provider: 'codex',
        outcome: 'success',
        invoked: true,
      }),
      JSON.stringify({
        type: 'provider_attempt',
        step: 'rebase',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 60, output: 6, costUsd: 'not-a-number' },
      }),
    ]);

    const rollup = await computeCostRollup(dir);

    expect(rollup).toMatchObject({
      tokens: { input: 240, output: 24, cacheRead: 0, cacheCreation: 0 },
      costUsd: 0.42,
      dispatches: 4,
      unmetered: { count: 1, durationMs: 0 },
      costUnmetered: { count: 2 },
    });
    expect(classifyMetering({ input: 60, output: 6, costUsd: 'not-a-number' } as never))
      .toBe('cost-unmetered');
  });

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

  it('counts a loop halt only when the production event sink persists it', async () => {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(dir, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await events.emit({ type: 'loop_halt', reason: 'retry budget exhausted' });
      expect((await computeCostRollup(dir)).halts).toBe(1);
    } finally {
      persister.stop();
    }

    const noHaltDir = await mkdtemp(join(tmpdir(), 'cost-rollup-no-halt-'));
    const noHaltEvents = new ConductorEventEmitter();
    const noHaltPersister = new EventPersister(join(noHaltDir, '.pipeline', 'events.jsonl'), noHaltEvents);
    try {
      noHaltPersister.start();
      await noHaltEvents.emit({
        type: 'step_retry', step: 'build', attempt: 2, maxAttempts: 3, reason: 'tests failed',
      });
      noHaltPersister.stop();
      expect((await computeCostRollup(noHaltDir)).halts).toBe(0);
    } finally {
      noHaltPersister.stop();
      await rm(noHaltDir, { recursive: true, force: true });
    }
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
      byDimension: [
        { step: 'plan', costUsd: expect.closeTo(0.07, 5) },
        { step: 'legacy', costUsd: expect.closeTo(0.01, 5) },
      ],
      tokensByDimension: [
        { step: 'plan', tokens: { input: 140, output: 30, cacheRead: 14, cacheCreation: 3 } },
        { step: 'legacy', tokens: { input: 7, output: 3, cacheRead: 0, cacheCreation: 0 } },
      ],
      dispatches: 3,
      retries: 0,
      halts: 0,
      readErrors: 0,
      unmetered: { count: 0, durationMs: 0 },
      costUnmetered: { count: 0 },
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
          costUnmetered: { count: 0 },
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
          costUnmetered: { count: 0 },
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
        costUnmetered: { count: 0 },
      },
      ['__proto__']: {
        tokens: { input: 23, output: 5, cacheRead: 0, cacheCreation: 0 },
        costUsd: expect.closeTo(0.02, 5),
        dispatches: 1,
        unmetered: { count: 0, durationMs: 0 },
        costUnmetered: { count: 0 },
      },
    });
  });

  it('marks the rollup unmetered when events.jsonl is missing', async () => {
    const rollup = await computeCostRollup(dir);

    expect(rollup).toEqual({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      costUsd: 0,
      byDimension: [],
      tokensByDimension: [],
      dispatches: 0,
      retries: 0,
      halts: 0,
      readErrors: 1,
      unmetered: { count: 1, durationMs: 0 },
      costUnmetered: { count: 0 },
    });
  });

  it('returns a clean all-zero rollup for a readable empty events.jsonl', async () => {
    await writeEvents([]);

    const rollup = await computeCostRollup(dir);

    expect(rollup).toEqual({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      costUsd: 0,
      byDimension: [],
      tokensByDimension: [],
      dispatches: 0,
      retries: 0,
      halts: 0,
      readErrors: 0,
      unmetered: { count: 0, durationMs: 0 },
      costUnmetered: { count: 0 },
    });
  });

  it('marks the rollup unmetered when events.jsonl cannot be read', async () => {
    await mkdir(join(dir, '.pipeline', 'events.jsonl'), { recursive: true });

    const rollup = await computeCostRollup(dir);

    expect(rollup.unmetered.count).toBeGreaterThan(0);
    expect(rollup.readErrors).toBe(1);
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
    expect(rollup.readErrors).toBe(1);
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
    expect(rollup.costUnmetered).toEqual({ count: 0 });
  });

  // The whole-feature usage line logged when `finish` completes reads the same
  // event log the shipped record's Cost block does. These pin the projection
  // from that rollup onto the line, so the two can never disagree about what a
  // build cost.
  describe('toFeatureUsageTotals', () => {
    it('sums a mixed-provider build into the line an operator reads at finish', async () => {
      await writeEvents([
        JSON.stringify({
          type: 'provider_attempt',
          step: 'build',
          provider: 'claude',
          outcome: 'success',
          invoked: true,
          tokenUsage: { input: 1200, output: 400, costUsd: 2.5 },
        }),
        JSON.stringify({
          type: 'provider_attempt',
          step: 'build_review',
          provider: 'claude',
          outcome: 'success',
          invoked: true,
          tokenUsage: { input: 800, output: 100, costUsd: 1.25 },
        }),
        // A provider that reported no usage at all — counted as a dispatch,
        // but never folded into the money figure.
        JSON.stringify({
          type: 'provider_attempt',
          step: 'plan',
          provider: 'codex',
          outcome: 'success',
          invoked: true,
        }),
      ]);

      const totals = toFeatureUsageTotals(await computeCostRollup(dir));

      expect(totals).toEqual({
        dispatches: 3,
        meteredDispatches: 2,
        unmeteredDispatches: 1,
        costUsd: 3.75,
        inputTokens: 2000,
        outputTokens: 500,
        cachedInputTokens: 0,
        costUnmeteredDispatches: 0,
      });
      expect(formatFeatureUsageTotal(totals)).toBe(
        'finish: total usage — 3 dispatches, $3.75, 2k→500 tok, 1 unmetered',
      );
    });

    it('carries the cost-unmetered count through to the line an operator reads', async () => {
      // The defect this closes: a dispatch that reports tokens but no cost
      // contributes its FULL token volume and $0. Before the count surfaced,
      // the finish line paired all-provider tokens with one provider's dollars
      // and read as an authoritative total.
      await writeEvents([
        JSON.stringify({
          type: 'provider_attempt',
          step: 'build',
          provider: 'claude',
          outcome: 'success',
          invoked: true,
          tokenUsage: { input: 1000, output: 100, costUsd: 5.63, costSource: 'provider' },
        }),
        JSON.stringify({
          type: 'provider_attempt',
          step: 'build_review',
          provider: 'codex',
          outcome: 'success',
          invoked: true,
          tokenUsage: { input: 2_250_000, output: 148_000, cacheRead: 58_000_000 },
        }),
      ]);

      const totals = toFeatureUsageTotals(await computeCostRollup(dir));

      expect(totals.costUnmeteredDispatches).toBe(1);
      expect(totals.costUsd).toBe(5.63);
      expect(formatFeatureUsageTotal(totals)).toContain(
        '1 cost-unmetered (tokens counted, cost not)',
      );
    });

    it('reports zero cost-unmetered once every dispatch carries a cost', async () => {
      // With the codex adapter pricing its own dispatches from the rate card,
      // the same two-provider build has nothing left unpriced.
      await writeEvents([
        JSON.stringify({
          type: 'provider_attempt',
          step: 'build',
          provider: 'claude',
          outcome: 'success',
          invoked: true,
          tokenUsage: { input: 1000, output: 100, costUsd: 5.63, costSource: 'provider' },
        }),
        JSON.stringify({
          type: 'provider_attempt',
          step: 'build_review',
          provider: 'codex',
          outcome: 'success',
          invoked: true,
          tokenUsage: {
            input: 2_250_000,
            output: 148_000,
            cacheRead: 58_000_000,
            costUsd: 18.97,
            costSource: 'rate-card',
          },
        }),
      ]);

      const totals = toFeatureUsageTotals(await computeCostRollup(dir));

      expect(totals.costUnmeteredDispatches).toBe(0);
      expect(totals.costUsd).toBeCloseTo(24.6, 6);
      expect(formatFeatureUsageTotal(totals)).not.toContain('cost-unmetered');
    });

    it('never reports negative metered dispatches when unreadable records outnumber them', async () => {
      // A corrupt line increments the unmetered count without contributing a
      // dispatch, so the naive subtraction would go negative and print a build
      // as having *fewer than zero* measured dispatches.
      await writeEvents(['{not valid json', '{also not valid']);

      const totals = toFeatureUsageTotals(await computeCostRollup(dir));

      expect(totals.dispatches).toBe(0);
      expect(totals.meteredDispatches).toBe(0);
      expect(totals.unmeteredDispatches).toBe(2);
      expect(formatFeatureUsageTotal(totals)).toBe(
        'finish: total usage — 0 dispatches, 2 unmetered',
      );
    });
  });
});
