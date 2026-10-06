// Covers: task:8, S5.1, S5.2
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const roots: string[] = [];
const predicate = CUSTOM_COMPLETION_PREDICATES.build!;

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

  it('does not classify an all-resolved nudge attempt as no_task_progress', () => {
    expect(isNoTaskProgressBuildStall({
      attempt: 2,
      resolvedTasksBefore: 1,
      resolvedTasksAfter: 1,
      headMovedThisAttempt: false,
      completionReason: 'unverified Done-when checks require one BUILD review pass: Task 7: [test] the unavailable integration proves the outcome',
    })).toBe(false);

    expect(isNoTaskProgressBuildStall({
      attempt: 2,
      resolvedTasksBefore: 0,
      resolvedTasksAfter: 0,
      headMovedThisAttempt: false,
      completionReason: 'tasks not completed: 8',
    })).toBe(true);
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
    type NudgeMethods = {
      recordUnverifiedDoneWhenNudge(state: ConductState): Promise<void>;
      unverifiedDoneWhenNudgeSpent(state: ConductState): Promise<boolean>;
      initializeRunState(state: ConductState): Promise<boolean>;
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
});
