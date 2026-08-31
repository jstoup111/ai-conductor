// Covers: S1.1, S1.2, S1.5, S1.6, S1.7, S1.9, S2.1, S2.2, S2.3, S2.4, S2.7, S2.9, S2.10, S5.1, S5.2, S5.3, S5.6, S5.9, task:3
/**
 * Acceptance seam: a real Conductor step terminal must project the durable
 * feature ledger onto the shared event bus. Unit tests own rollup arithmetic;
 * this spec proves the production step-close call site invokes that rollup,
 * preserves usage from an earlier process lifetime, and suppresses an
 * unreadable projection without changing the step verdict.
 *
 * Bounded fixture:
 *   1. First step: finish (`fromStep: 'finish'`).
 *   2. Dispatched steps: finish only.
 *   3. End: the runner writes finish-choice + pr_url and finish completes.
 *   4. Evidence: all upstream and SHIP-tail steps are pre-resolved; artifact
 *      verification is disabled because the injected runner is authoritative.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, ConductorEvent, StepName } from '../../src/types/index.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

interface FeatureCostSnapshot {
  type: 'feature_cost_snapshot';
  costUsd: number;
  costComplete: boolean;
  byDimension: Array<{ step: string; model?: string; source?: string; costUsd: number }>;
  tokensByDimension: Array<{
    step: string;
    model?: string;
    tokens: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number };
  }>;
}

type StepTerminal = Extract<ConductorEvent, { type: 'step_completed' | 'step_failed' }>;

function stepVerdicts(terminals: StepTerminal[]): Array<[string, string, string | undefined]> {
  return terminals.map((event) => [
    event.type,
    event.step,
    event.type === 'step_completed' ? event.status : undefined,
  ]);
}

let dir: string;
let statePath: string;

const fakeGit: GitRunner = async (args) =>
  args.includes('--symbolic-full-name')
    ? { stdout: 'refs/remotes/origin/feature/cost-snapshot\n' }
    : { stdout: '' };

async function seedFinishBoundary(): Promise<void> {
  const state: Record<string, unknown> = {};
  for (const step of ALL_STEPS) {
    if (step.name === 'finish') break;
    state[step.name] = 'done';
  }
  Object.assign(state, {
    complexity_tier: 'L',
    feature_desc: 'feature-cost-snapshot',
    build_review: 'skipped',
    manual_test: 'skipped',
    prd_audit: 'skipped',
    architecture_review_as_built: 'skipped',
    rebase: 'skipped',
  });
  await writeState(statePath, state as unknown as ConductState);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(
    join(dir, '.pipeline/task-status.json'),
    JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
  );
}

async function writeLedger(lines: Record<string, unknown>[]): Promise<void> {
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(
    join(dir, '.pipeline/events.jsonl'),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
  );
}

interface RunOptions {
  usage?: {
  input: number;
  output: number;
  costUsd: number;
  costSource: 'provider' | 'rate-card';
  };
  success?: boolean;
  persist?: boolean;
}

function finishingRunner(
  options: RunOptions,
  emitProviderAttempt: (event: Extract<ConductorEvent, { type: 'provider_attempt' }>) => Promise<void>,
): StepRunner {
  return {
    run: vi.fn(async (step: StepName) => {
      if (step === 'finish') {
        await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
        const current = await readState(statePath);
        const state = (current.ok ? current.value : {}) as ConductState;
        state.pr_url = 'https://github.com/org/repo/pull/1';
        await writeState(statePath, state);
        await writeState(join(dir, '.pipeline/conduct-state.json'), state);
      }
      if (options.usage) {
        await emitProviderAttempt({
          type: 'provider_attempt',
          step,
          provider: 'claude',
          outcome: options.success === false ? 'failure' : 'success',
          invoked: true,
          model: 'm2',
          tokenUsage: options.usage,
        });
      }
      return {
        success: options.success ?? true,
        preferredProvider: 'claude',
        actualProvider: 'claude',
        model: 'm2',
        ...(options.usage ? { tokenUsage: options.usage } : {}),
      };
    }),
  };
}

async function runFinish(options: RunOptions = {}): Promise<{
  snapshots: FeatureCostSnapshot[];
  terminals: StepTerminal[];
  order: string[];
}> {
  const events = new ConductorEventEmitter();
  const snapshots: FeatureCostSnapshot[] = [];
  const terminals: StepTerminal[] = [];
  const order: string[] = [];
  events.on('step_completed', (event) => {
    terminals.push(event as StepTerminal);
    order.push(event.type);
  });
  events.on('step_failed', (event) => {
    terminals.push(event as StepTerminal);
    order.push(event.type);
  });
  events.on('feature_cost_snapshot' as ConductorEvent['type'], (event) => {
    snapshots.push(event as unknown as FeatureCostSnapshot);
    order.push('feature_cost_snapshot');
  });
  const persister = options.persist === false
    ? undefined
    : new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
  persister?.start();
  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: finishingRunner(options, (event) => events.emit(event)),
    events,
    projectRoot: dir,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    fromStep: 'finish',
    maxRetries: 1,
    escalateBuildFailure: async () => ({}),
    git: fakeGit,
  });
  try {
    await conductor.run();
  } finally {
    persister?.stop();
  }
  return { snapshots, terminals, order };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'feature-cost-snapshot-'));
  statePath = join(dir, 'conduct-state.json');
  await seedFinishBoundary();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('acceptance: ledger-derived feature cost snapshot at the real step-close boundary', () => {
  it('exports the cumulative earlier-run plus current-run cost and token buckets after the terminal', async () => {
    await writeLedger([
      {
        type: 'provider_attempt',
        step: 'build',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        model: 'm1',
        tokenUsage: { input: 100, output: 10, costUsd: 2.1, costSource: 'provider' },
      },
    ]);

    const result = await runFinish({
      usage: {
        input: 50,
        output: 5,
        costUsd: 1.4,
        costSource: 'rate-card',
      },
    });

    expect(result.terminals.filter((event) => event.type === 'step_completed' && event.step === 'finish')).toHaveLength(1);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.costUsd).toBeCloseTo(3.5, 4);
    expect(result.snapshots[0]?.costComplete).toBe(true);
    expect(result.snapshots[0]?.byDimension).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'build', model: 'm1', source: 'provider', costUsd: 2.1 }),
      expect.objectContaining({ step: 'finish', model: 'm2', source: 'rate-card', costUsd: 1.4 }),
    ]));
    expect(result.snapshots[0]?.byDimension.reduce((sum, bucket) => sum + bucket.costUsd, 0)).toBeCloseTo(
      result.snapshots[0]?.costUsd ?? Number.NaN,
      4,
    );
    expect(result.snapshots[0]?.tokensByDimension).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'build', model: 'm1', tokens: expect.objectContaining({ input: 100, output: 10 }) }),
      expect.objectContaining({ step: 'finish', model: 'm2', tokens: expect.objectContaining({ input: 50, output: 5 }) }),
    ]));
    expect(result.order.indexOf('feature_cost_snapshot')).toBeGreaterThan(
      result.order.indexOf('step_completed'),
    );
  });

  it('re-emits cumulative, non-decreasing ledger totals across sequential process lifetimes', async () => {
    const values: number[] = [];
    for (const costUsd of [1.2, 0.8, 2]) {
      const result = await runFinish({
        usage: { input: 10, output: 1, costUsd, costSource: 'provider' },
      });
      values.push(result.snapshots[0]?.costUsd ?? Number.NaN);
      await seedFinishBoundary();
    }

    expect(values).toEqual([1.2, 2, 4]);
  });

  it('emits a snapshot after a failed step terminal that includes the failed provider attempt', async () => {
    const result = await runFinish({
      success: false,
      usage: { input: 25, output: 3, costUsd: 0.75, costSource: 'provider' },
    });

    expect(result.terminals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'step_failed', step: 'finish' }),
    ]));
    expect(result.snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ costUsd: 0.75, costComplete: true }),
    ]));
    expect(result.order.indexOf('feature_cost_snapshot')).toBeGreaterThan(
      result.order.indexOf('step_failed'),
    );
  });

  it('suppresses a malformed-ledger projection without changing the clean step-verdict sequence', async () => {
    const clean = await runFinish({ persist: false });
    await seedFinishBoundary();
    await writeFile(join(dir, '.pipeline/events.jsonl'), '{ malformed\n');

    const result = await runFinish();
    const ledger = await readFile(join(dir, '.pipeline/events.jsonl'), 'utf8');

    expect(ledger).toContain('{ malformed');
    expect(result.snapshots).toEqual([]);
    expect(stepVerdicts(result.terminals)).toEqual(stepVerdicts(clean.terminals));
  });

  it('suppresses a missing-ledger projection without changing the clean step-verdict sequence', async () => {
    const clean = await runFinish({ persist: false });
    await seedFinishBoundary();
    await rm(join(dir, '.pipeline/events.jsonl'), { force: true });

    const result = await runFinish({ persist: false });

    expect(result.snapshots).toEqual([]);
    expect(stepVerdicts(result.terminals)).toEqual(stepVerdicts(clean.terminals));
  });
});
