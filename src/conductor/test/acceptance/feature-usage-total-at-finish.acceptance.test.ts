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
 *      conduct-state.json; the SHIP tail seeded skipped. Usage-only cases use
 *      `verifyArtifacts: false`; the failed-final-push case uses the production
 *      artifact gate plus a real local upstream tracking ref.
 *
 * Usage-only cases do not wire an EventPersister, so their seeded
 * `.pipeline/events.jsonl` is the whole authority for what the feature spent.
 * Refresh cases wire the real persister so the expected shipped Cost includes
 * the finish event at the same boundary production uses.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { createProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import {
  detectShippedRecordCommand,
  dispatchShippedRecord,
} from '../../src/engine/shipped-record-cli.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import type { ConductorEvent, ConductState, StepName } from '../../src/types/index.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

const execFile = promisify(execFileCb);

let dir: string;
let statePath: string;
let remoteDir: string | undefined;

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

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
}

const realGit: GitRunner = async (args, options) => {
  const { stdout } = await execFile('git', args, { cwd: options.cwd });
  return { stdout: String(stdout) };
};

async function seedPushedTrackingBranch(): Promise<string> {
  remoteDir = await mkdtemp(join(tmpdir(), 'feature-usage-remote-'));
  await execFile('git', ['init', '--bare', '-q', '-b', 'main', remoteDir], { cwd: dir });
  await git(['remote', 'add', 'origin', remoteDir]);
  await git(['push', '-q', '-u', 'origin', 'main']);
  return git(['rev-parse', 'HEAD']);
}

async function seedCommittedShippedRecord(): Promise<void> {
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  await mkdir(join(dir, '.docs/stories'), { recursive: true });
  await writeFile(join(dir, 'README.md'), 'seed\n');
  await writeFile(join(dir, '.docs/plans/feat.md'), '# Plan\n');
  await writeFile(join(dir, '.docs/stories/feat.md'), '# Stories\n**Status:** Accepted\n');
  await git(['add', 'README.md', '.docs']);
  await git(['commit', '-q', '-m', 'merge spec: feat']);
  await createProtectedArtifactSeal({
    projectRoot: dir,
    baselineCommit: await git(['rev-parse', 'HEAD']),
  });
  await seedEventLog([
    {
      type: 'step_completed',
      step: 'build',
      status: 'done',
      tokenUsage: { input: 10, output: 1, costUsd: 0.01 },
    },
  ]);

  const command = detectShippedRecordCommand([
    'node',
    'conduct',
    'shipped-record',
    '--slug',
    'feat',
    '--pr',
    'https://github.com/org/repo/pull/1',
  ]);
  if (!command || command.kind !== 'write') throw new Error('valid shipped-record command rejected');
  await dispatchShippedRecord(command, dir);
}

function meteredShippingRunner(onFinishDispatch: () => void = () => {}): StepRunner {
  return {
    run: vi.fn(async (step: StepName) => {
      if (step === 'finish') {
        onFinishDispatch();
        await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
        const current = await readState(statePath);
        const state = (current.ok ? current.value : {}) as ConductState;
        state.pr_url = 'https://github.com/org/repo/pull/1';
        await writeState(statePath, state);
        await writeState(join(dir, '.pipeline/conduct-state.json'), state);
      }
      return {
        success: true,
        preferredProvider: 'claude',
        actualProvider: 'claude',
        tokenUsage: { input: 40, output: 4, costUsd: 0.04 },
      };
    }),
  };
}

async function runMeteredFinish(
  events: ConductorEventEmitter,
  runner: StepRunner,
  gitRunner: GitRunner,
  verifyArtifacts = false,
): Promise<void> {
  const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), events);
  persister.start();
  const conductor = new Conductor({
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    projectRoot: dir,
    mode: 'auto',
    daemon: true,
    verifyArtifacts,
    fromStep: 'finish',
    maxRetries: 1,
    escalateBuildFailure: async () => ({}),
    git: gitRunner,
    gh: async () => ({ stdout: '{}' }),
    shipmentEvidence: async (input) => ({
      kind: 'valid',
      slug: input.slug,
      pr: input.implementationPr,
      recordPath: `.docs/shipped/${input.slug}.md`,
      hash: 'fixture-hash',
      commit: input.candidateCommit,
    }),
  });
  try {
    await conductor.run();
  } finally {
    persister.stop();
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'feature-usage-total-'));
  statePath = join(dir, 'conduct-state.json');
  await seedShipTail();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  if (remoteDir) await rm(remoteDir, { recursive: true, force: true });
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

  it('commits a refreshed Cost block after finish token usage is persisted', async () => {
    await seedCommittedShippedRecord();
    const events = new ConductorEventEmitter();
    await runMeteredFinish(events, meteredShippingRunner(), fakeGit);

    const committedRecord = await git(['show', 'HEAD:.docs/shipped/feat.md']);
    expect(committedRecord).toMatch(/## Cost\ninput: 50\n/);
  });

  it('attempts one push and still completes finish when that push throws', async () => {
    await seedCommittedShippedRecord();
    const pushedHead = await seedPushedTrackingBranch();
    let pushAttempts = 0;
    let finishDispatches = 0;
    let loopHalts = 0;
    const events = new ConductorEventEmitter();
    events.on('loop_halt', () => {
      loopHalts += 1;
    });
    const failingPushGit: GitRunner = async (args, options) => {
      if (args[0] === 'push') {
        pushAttempts += 1;
        throw new Error('injected push failure');
      }
      return realGit(args, options);
    };

    await runMeteredFinish(
      events,
      meteredShippingRunner(() => {
        finishDispatches += 1;
      }),
      failingPushGit,
      true,
    );
    const finalState = await readState(statePath);
    const localHead = await git(['rev-parse', 'HEAD']);
    const upstreamHead = await git(['rev-parse', 'refs/remotes/origin/main']);

    expect({
      pushAttempts,
      finishDispatches,
      loopHalts,
      finishStatus: finalState.ok ? finalState.value.finish : undefined,
      localHead,
      upstreamHead,
    }).toEqual({
      pushAttempts: 1,
      finishDispatches: 1,
      loopHalts: 0,
      finishStatus: 'done',
      localHead: pushedHead,
      upstreamHead: pushedHead,
    });
  });

  it('adopts an upstream descendant with the identical post-refresh tree after the final push fails', async () => {
    await seedCommittedShippedRecord();
    await seedPushedTrackingBranch();
    let pushAttempts = 0;
    let finishDispatches = 0;
    let loopHalts = 0;
    let upstreamDescendant = '';
    let postRefreshTree = '';
    let upstreamTree = '';
    const events = new ConductorEventEmitter();
    events.on('loop_halt', () => {
      loopHalts += 1;
    });
    const racingPushGit: GitRunner = async (args, options) => {
      if (args[0] === 'push') {
        pushAttempts += 1;
        const postRefreshHead = await git(['rev-parse', 'HEAD']);
        postRefreshTree = await git(['rev-parse', `${postRefreshHead}^{tree}`]);
        upstreamDescendant = await git([
          'commit-tree',
          postRefreshTree,
          '-p',
          postRefreshHead,
          '-m',
          'metadata-only upstream advance',
        ]);
        await git(['update-ref', 'refs/remotes/origin/main', upstreamDescendant]);
        upstreamTree = await git(['rev-parse', `${upstreamDescendant}^{tree}`]);
        throw new Error('injected push race');
      }
      return realGit(args, options);
    };

    await runMeteredFinish(
      events,
      meteredShippingRunner(() => {
        finishDispatches += 1;
      }),
      racingPushGit,
      true,
    );
    const finalState = await readState(statePath);
    const localHead = await git(['rev-parse', 'HEAD']);
    const upstreamHead = await git(['rev-parse', 'refs/remotes/origin/main']);

    expect({
      pushAttempts,
      finishDispatches,
      loopHalts,
      finishStatus: finalState.ok ? finalState.value.finish : undefined,
      localHead,
      upstreamHead,
      upstreamTreeMatches: upstreamTree === postRefreshTree,
    }).toEqual({
      pushAttempts: 1,
      finishDispatches: 1,
      loopHalts: 0,
      finishStatus: 'done',
      localHead: upstreamDescendant,
      upstreamHead: upstreamDescendant,
      upstreamTreeMatches: true,
    });
  });

  it('does not adopt an upstream descendant with arbitrary source changes after the final push fails', async () => {
    await seedCommittedShippedRecord();
    const pushedHead = await seedPushedTrackingBranch();
    let pushAttempts = 0;
    let finishDispatches = 0;
    let loopHalts = 0;
    let upstreamDescendant = '';
    let postRefreshTree = '';
    let upstreamTree = '';
    const events = new ConductorEventEmitter();
    events.on('loop_halt', () => {
      loopHalts += 1;
    });
    const racingPushGit: GitRunner = async (args, options) => {
      if (args[0] === 'push') {
        pushAttempts += 1;
        const postRefreshHead = await git(['rev-parse', 'HEAD']);
        postRefreshTree = await git(['rev-parse', `${postRefreshHead}^{tree}`]);
        await mkdir(join(dir, 'src'), { recursive: true });
        await writeFile(join(dir, 'src/concurrent-upstream.ts'), 'export const unsafe = true;\n');
        await git(['add', 'src/concurrent-upstream.ts']);
        upstreamTree = await git(['write-tree']);
        await git(['reset', '--hard', postRefreshHead]);
        upstreamDescendant = await git([
          'commit-tree',
          upstreamTree,
          '-p',
          postRefreshHead,
          '-m',
          'concurrent upstream advance',
        ]);
        await git(['update-ref', 'refs/remotes/origin/main', upstreamDescendant]);
        throw new Error('injected push race');
      }
      return realGit(args, options);
    };

    await runMeteredFinish(
      events,
      meteredShippingRunner(() => {
        finishDispatches += 1;
      }),
      racingPushGit,
      true,
    );
    const finalState = await readState(statePath);
    const localHead = await git(['rev-parse', 'HEAD']);
    const upstreamHead = await git(['rev-parse', 'refs/remotes/origin/main']);

    expect({
      pushAttempts,
      finishDispatches,
      loopHalts,
      finishStatus: finalState.ok ? finalState.value.finish : undefined,
      localHead,
      upstreamHead,
      upstreamTreeDiffers: upstreamTree !== postRefreshTree,
    }).toEqual({
      pushAttempts: 1,
      finishDispatches: 1,
      loopHalts: 0,
      finishStatus: 'done',
      localHead: pushedHead,
      upstreamHead: upstreamDescendant,
      upstreamTreeDiffers: true,
    });
  });
});
