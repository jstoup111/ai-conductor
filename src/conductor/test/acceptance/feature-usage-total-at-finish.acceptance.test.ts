/**
 * Acceptance spec: when a feature's `finish` step completes, the build logs
 * ONE whole-feature usage line.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): the aggregation itself (`computeCostRollup`
 * → `toFeatureUsageTotals`) and the rendering (`formatFeatureUsageTotal`,
 * `renderDaemonEvent`) are already unit-covered in
 * `test/engine/cost-rollup.test.ts`, `test/execution/provider-diagnostics.test.ts`,
 * and `test/daemon-render-provider-attempt.test.ts`. What NONE of those can
 * prove is the thing that actually matters here: that the engine calls the
 * rollup at the finish boundary at all. A summation helper that is never
 * invoked from its one real call site is exactly the "new primitive, orphaned
 * at its call site" failure (writing-system-tests §3b), and the call site is
 * an inline branch of the conductor's step loop with no smaller seam to test.
 *
 * BOUNDED FIXTURE (writing-system-tests §3):
 *   1. First step that may run: `finish` (`fromStep: 'finish'`).
 *   2. Steps expected to dispatch: `finish` only.
 *   3. End condition: finish completes (the runner writes `.pipeline/finish-choice`
 *      and a pr_url), so the run reaches its terminal state without a kickback.
 *   4. Required evidence: every step before `finish` pre-resolved in
 *      conduct-state.json; the SHIP tail seeded skipped; `verifyArtifacts: false`,
 *      so the mocked runner's success is the authority.
 *
 * No EventPersister is wired here, so the seeded `.pipeline/events.jsonl` is
 * the whole authority for what the feature spent — which makes the expected
 * sums exact rather than dependent on how many events this fixture happens to
 * emit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import type { ConductorEvent, ConductState, StepName } from '../../src/types/index.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

// daemon-cli transitively imports the provider layer (execa); this suite never
// dispatches a real provider, so stub it rather than pull a live process
// dependency in for one rendering assertion.
vi.mock('execa', () => ({ execa: vi.fn() }));

let dir: string;
let statePath: string;

const fakeGit: GitRunner = async (args) =>
  args.includes('--symbolic-full-name')
    ? { stdout: 'refs/remotes/origin/feature/x\n' }
    : { stdout: '' };

/** Pre-resolve everything upstream of `finish`, plus the SHIP tail. */
async function seedShipTail(): Promise<void> {
  const res = await readState(statePath);
  const state = (res.ok ? res.value : {}) as Record<string, unknown>;
  for (const s of ALL_STEPS) {
    if (s.name === 'finish') break;
    state[s.name] = 'done';
  }
  Object.assign(state, {
    complexity_tier: 'L',
    feature_desc: 'feat',
    build_review: 'skipped',
    manual_test: 'skipped',
    prd_audit: 'skipped',
    retro: 'skipped',
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

/** The durable per-dispatch usage record a real build accumulates. */
async function seedEventLog(lines: Record<string, unknown>[]): Promise<void> {
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await writeFile(
    join(dir, '.pipeline/events.jsonl'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

/** A runner whose `finish` succeeds by writing the choice + PR the gate wants. */
function shippingRunner(): StepRunner {
  return {
    run: vi.fn(async (step: StepName) => {
      if (step === 'finish') {
        await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
        const res = await readState(statePath);
        const state = (res.ok ? res.value : {}) as Record<string, unknown>;
        state.pr_url = 'https://github.com/org/repo/pull/1';
        await writeState(statePath, state as unknown as ConductState);
        await writeState(
          join(dir, '.pipeline/conduct-state.json'),
          state as unknown as ConductState,
        );
      }
      return { success: true };
    }),
  };
}

async function runToFinish(): Promise<ConductorEvent[]> {
  const events = new ConductorEventEmitter();
  const totals: ConductorEvent[] = [];
  events.on('feature_usage_total', (e) => {
    totals.push(e);
  });

  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: shippingRunner(),
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

  await conductor.run();
  return totals;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'feature-usage-total-'));
  statePath = join(dir, 'conduct-state.json');
  await seedShipTail();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('acceptance: finish logs the whole-feature usage total', () => {
  it('sums every dispatch the feature recorded and logs one aggregate line', async () => {
    await seedEventLog([
      {
        type: 'provider_attempt',
        step: 'build',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 1200, output: 400, costUsd: 2.5, numTurns: 30 },
      },
      {
        type: 'provider_attempt',
        step: 'acceptance_specs',
        provider: 'claude',
        outcome: 'success',
        invoked: true,
        tokenUsage: { input: 800, output: 100, costUsd: 1.25, numTurns: 12 },
      },
    ]);

    const [total, ...extra] = await runToFinish();

    // Exactly one line — an aggregate emitted per finish, not per step.
    expect(extra).toEqual([]);
    expect(total).toMatchObject({
      type: 'feature_usage_total',
      dispatches: 2,
      meteredDispatches: 2,
      unmeteredDispatches: 0,
      costUsd: 3.75,
      inputTokens: 2000,
      outputTokens: 500,
    });

    const logged: string[] = [];
    renderDaemonEvent(total, (m) => logged.push(m));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('finish: total usage — 2 dispatches, $3.75, 2k→500 tok');
  });

  it('marks unmetered dispatches instead of fabricating a free build', async () => {
    await seedEventLog([
      {
        type: 'provider_attempt',
        step: 'build',
        provider: 'codex',
        outcome: 'success',
        invoked: true,
      },
      {
        type: 'provider_attempt',
        step: 'plan',
        provider: 'codex',
        outcome: 'success',
        invoked: true,
      },
    ]);

    const [total] = await runToFinish();

    expect(total).toMatchObject({
      type: 'feature_usage_total',
      dispatches: 2,
      meteredDispatches: 0,
      unmeteredDispatches: 2,
      costUsd: 0,
    });

    const logged: string[] = [];
    renderDaemonEvent(total, (m) => logged.push(m));
    expect(logged[0]).toContain('2 dispatches, 2 unmetered');
    expect(logged[0]).not.toContain('$');
  });

  it('still ships when the feature has no readable event log at all', async () => {
    // No .pipeline/events.jsonl written: the rollup marks the whole feature
    // unmetered rather than blocking the finish or reporting a $0.00 build.
    const [total, ...extra] = await runToFinish();

    expect(extra).toEqual([]);
    expect(total).toMatchObject({
      type: 'feature_usage_total',
      dispatches: 0,
      meteredDispatches: 0,
      unmeteredDispatches: 1,
    });

    const res = await readState(statePath);
    expect(res.ok && res.value.finish).toBe('done');
  });
});
