// Covers: task:8, task:9, task:13, task:14, S5.1, S5.2
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CUSTOM_COMPLETION_PREDICATES,
  type CompletionContext,
} from '../../src/engine/artifacts.js';
import {
  Conductor,
  buildRetryHint,
  isNoTaskProgressBuildStall,
  type StepRunner,
} from '../../src/engine/conductor.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { bumpKickbackGateInLedger } from '../../src/engine/kickback-ledger.js';
import { ALL_STEPS } from '../../src/engine/steps.js';

const roots: string[] = [];
const predicate = CUSTOM_COMPLETION_PREDICATES.build!;
type NudgeMethods = {
  recordUnverifiedDoneWhenNudge(state: ConductState): Promise<void>;
  unverifiedDoneWhenNudgeSpent(state: ConductState): Promise<boolean>;
  initializeRunState(state: ConductState): Promise<boolean>;
};

async function completion(
  tasks: unknown,
  context: CompletionContext = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'build-unverified-nudge-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
  return predicate(root, context);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('BUILD completion nudge for unverified Done-when checks', () => {
  const unverifiedTasks = [
    {
      id: '7',
      status: 'completed',
      doneWhen: [{
        check: '[test] the unavailable integration proves the outcome',
        source: 'unverified',
        reason: 'integration environment unavailable',
      }],
    },
  ];

  it('withholds resolved BUILD completion once and carries every unverified check into the retry hint', async () => {
    const result = await completion(unverifiedTasks);

    expect(result).toMatchObject({ done: false });
    expect(result.reason).toContain('Task 7');
    expect(result.reason).toContain('[test] the unavailable integration proves the outcome');
    const hint = buildRetryHint('build', result.reason);
    expect(hint).toContain('Task 7');
    expect(hint).toContain('[test] the unavailable integration proves the outcome');
    expect(hint).toContain('Review each named check');
  });

  it('completes the same resolved state after the lap nudge is recorded', async () => {
    await expect(completion(unverifiedTasks, { unverifiedDoneWhenNudgeSpent: true }))
      .resolves.toEqual({ done: true });
  });

  it('completes resolved stamp and legacy rows when no unverified close record exists', async () => {
    await expect(completion([
      { id: '8', status: 'completed' },
      {
        id: '9',
        status: 'completed',
        doneWhen: [
          { check: '[test] a reported legacy check', source: 'reported' },
          { check: '[test] an older check without source', evidence: 'legacy' },
        ],
      },
    ])).resolves.toEqual({ done: true });
  });

  it('keeps the pending-task reason ahead of unverified checks', async () => {
    const result = await completion([
      ...unverifiedTasks,
      { id: '8', status: 'pending' },
    ]);

    expect(result).toMatchObject({ done: false });
    expect(result.reason).toContain('tasks not completed: 8');
    expect(result.reason).not.toContain('unverified Done-when');
  });

  it('exempts remediation-closure reopens with falling resolved work while retaining ordinary no-progress stalls', () => {
    expect(isNoTaskProgressBuildStall({
      attempt: 1,
      resolvedTasksBefore: 1,
      resolvedTasksAfter: 1,
      headMovedThisAttempt: false,
      completionReason: 'Done-when citation refused: Task 7 must repair its refused test citation(s): check 1',
    })).toBe(false);

    expect(isNoTaskProgressBuildStall({
      attempt: 2,
      resolvedTasksBefore: 1,
      resolvedTasksAfter: 0,
      headMovedThisAttempt: false,
      completionReason: 'Remediation closure reopened: Task rem-as-built-R5 must repair the named change',
    })).toBe(false);

    expect(isNoTaskProgressBuildStall({
      attempt: 2,
      resolvedTasksBefore: 1,
      resolvedTasksAfter: 1,
      headMovedThisAttempt: false,
      completionReason: 'unverified Done-when checks require one BUILD review pass: Task 7: [test] the unavailable integration proves the outcome',
    })).toBe(false);

    expect(isNoTaskProgressBuildStall({
      attempt: 2,
      resolvedTasksBefore: 1,
      resolvedTasksAfter: 1,
      headMovedThisAttempt: false,
      completionReason: 'Done-when citation refused: Task 7 must repair its refused test citation(s): check 1 ([test] expected behavior; test:test/example.test.ts::proves expected behavior; cited test proves another behavior)',
    })).toBe(false);

    expect(isNoTaskProgressBuildStall({
      attempt: 2,
      resolvedTasksBefore: 0,
      resolvedTasksAfter: 0,
      headMovedThisAttempt: false,
      completionReason: 'tasks not completed: 8',
    })).toBe(true);
  });

  it('does not emit a no-task-progress stall when attempt two reopens a remediation closure with falling resolved work and unchanged HEAD', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-remediation-closure-retry-'));
    roots.push(root);
    const pipeline = join(root, '.pipeline');
    const statePath = join(pipeline, 'conduct-state.json');
    const statusPath = join(pipeline, 'task-status.json');
    await mkdir(pipeline, { recursive: true });
    await writeState(statePath, {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      build: 'pending',
      session_started_at: Date.now() - 1_000,
      run_started_at: Date.now() - 1_000,
    });
    await writeFile(statusPath, JSON.stringify({ tasks: [{
      id: '13',
      status: 'completed',
    }] }));

    let buildAttempts = 0;
    const stallEvents: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('build_stall', (event) => {
      if (event.type === 'build_stall') stallEvents.push(event.reason);
    });
    const predicates = CUSTOM_COMPLETION_PREDICATES as {
      build: NonNullable<typeof CUSTOM_COMPLETION_PREDICATES.build>;
    };
    const originalPredicate = predicates.build;
    const runner: StepRunner = {
      run: async (step) => {
        if (step !== 'build') return { success: true };
        buildAttempts++;
        if (buildAttempts === 2) {
          await writeFile(statusPath, JSON.stringify({ tasks: [{
            id: '13', status: 'pending',
          }] }));
        }
        if (buildAttempts === 3) {
          await writeFile(statusPath, JSON.stringify({ tasks: [{
            id: '13', status: 'completed',
          }] }));
        }
        return { success: true };
      },
    };

    predicates.build = async () => {
      if (buildAttempts === 2) {
        return { done: false, reason: 'Remediation closure reopened: Task rem-as-built-R5: Named repair remains absent.' };
      }
      return buildAttempts >= 3 ? { done: true } : { done: false, reason: 'retry once before closure judgement' };
    };
    try {
      await new Conductor({
        projectRoot: root,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        mode: 'auto',
        resume: true,
        fromStep: 'build',
        verifyArtifacts: true,
        maxRetries: 3,
      } as never).run();
    } finally {
      predicates.build = originalPredicate;
    }

    expect(buildAttempts).toBe(3);
    expect(stallEvents).toEqual([]);
    await expect(readFile(join(pipeline, 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a recorded nudge spent after a fresh conductor stamps a new session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-unverified-nudge-restart-'));
    roots.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const statePath = join(root, '.pipeline', 'conduct-state.json');
    const state: ConductState = { run_started_at: 10, session_started_at: 10 };
    await writeState(statePath, state);
    const runner: StepRunner = { run: async () => ({ success: true }) };
    const options = {
      projectRoot: root,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
    };
    await (new Conductor(options) as unknown as NudgeMethods).recordUnverifiedDoneWhenNudge(state);
    const restartedStateResult = await readState(statePath);
    expect(restartedStateResult.ok).toBe(true);
    if (!restartedStateResult.ok) throw new Error(restartedStateResult.error.message);
    const restartedState = restartedStateResult.value;
    const restarted = new Conductor(options) as unknown as NudgeMethods;
    await restarted.initializeRunState(restartedState);

    expect(restartedState.session_started_at).not.toBe(10);
    await expect(restarted.unverifiedDoneWhenNudgeSpent(restartedState)).resolves.toBe(true);
    await expect(completion(unverifiedTasks, {
      unverifiedDoneWhenNudgeSpent: await restarted.unverifiedDoneWhenNudgeSpent(restartedState),
    })).resolves.toEqual({ done: true });
  });

  it('withholds resolved unverified checks once again after a kickback starts the next BUILD lap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-unverified-nudge-next-lap-'));
    roots.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const statePath = join(root, '.pipeline', 'conduct-state.json');
    const state: ConductState = { run_started_at: 10, session_started_at: 10 };
    await writeState(statePath, state);
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
    }) as unknown as Pick<NudgeMethods, 'recordUnverifiedDoneWhenNudge' | 'unverifiedDoneWhenNudgeSpent'>;

    await conductor.recordUnverifiedDoneWhenNudge(state);
    await expect(conductor.unverifiedDoneWhenNudgeSpent(state)).resolves.toBe(true);
    await bumpKickbackGateInLedger(root, 'prd_audit', {
      treeHash: null,
      resolvedCount: 0,
      reason: 'kick back into BUILD',
    });

    const result = await completion(unverifiedTasks, {
      unverifiedDoneWhenNudgeSpent: await conductor.unverifiedDoneWhenNudgeSpent(state),
    });
    expect(result).toMatchObject({ done: false });
    expect(result.reason).toContain('unverified Done-when checks require one BUILD review pass');
  });
});
