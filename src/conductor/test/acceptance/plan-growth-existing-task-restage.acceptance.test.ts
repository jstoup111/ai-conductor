// Covers: S3.2, task:5
/**
 * Acceptance coverage for #2119's cross-dispatch contract: an as-built
 * finding bound to already-authored work is re-staged before the remediation
 * rewind, and the next BUILD dispatch receives that work as pending.
 *
 * The real Conductor owns the remediation route, task-status rewrite, rewind,
 * and next dispatch. Only the autonomous step runner and external Git/GitHub
 * boundaries are deterministic fakes. The BUILD sentinel terminates the run
 * immediately after the observable dispatch boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

let projectRoot: string;
let stateFilePath: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'existing-task-restage-acceptance-'));
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await mkdir(join(projectRoot, '.docs', 'plans'), { recursive: true });
  stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');

  const state = Object.fromEntries(
    ALL_STEPS.map((step) => [step.name, step.name === 'finish' ? 'pending' : 'done']),
  ) as unknown as ConductState;
  Object.assign(state, {
    track: 'technical',
    complexity_tier: 'M',
    feature_desc: 'plan-growth-existing-task-restage',
    build_review: 'skipped',
    manual_test: 'skipped',
    prd_audit: 'skipped',
    architecture_review_as_built: 'pending',
    rebase: 'skipped',
  });
  await writeState(stateFilePath, state);

  await writeFile(
    join(projectRoot, '.docs', 'plans', 'plan-growth-existing-task-restage.md'),
    '# Plan\n\n### Task 1: Add the approved guard\n',
  );
  await writeFile(
    join(projectRoot, '.pipeline', 'task-status.json'),
    JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
  );
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('existing-task remediation re-stages work across the BUILD rewind', () => {
  it('dispatches the bound authored task as pending without appending a replacement task', async () => {
    let pendingAtBuildDispatch = false;
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        dispatched.push(step);
        if (step === 'architecture_review_as_built') {
          await writeFile(
            join(projectRoot, '.pipeline', 'architecture-review-as-built.md'),
            [
              'Verdict: BLOCKED',
              '',
              '## Blocking Findings',
              '| Finding | Class | Governing clause | Summary |',
              '| --- | --- | --- | --- |',
              '| ARCH-1 | REMEDIABLE | Task 1 | Add the approved guard |',
            ].join('\n'),
          );
        } else if (step === 'remediate') {
          await writeFile(
            join(projectRoot, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'ARCH-1',
                  disposition: 'existing-task',
                  category: null,
                  rationale: 'Task 1 already owns the approved guard.',
                  tasks: [{ id: '1', title: 'Add the approved guard' }],
                },
              ],
            }),
          );
        } else if (step === 'build') {
          const status = JSON.parse(
            await readFile(join(projectRoot, '.pipeline', 'task-status.json'), 'utf8'),
          ) as { tasks: Array<{ id: string; status: string }> };
          pendingAtBuildDispatch = status.tasks.some(
            (task) => task.id === '1' && task.status === 'pending',
          );
          return { success: false, error: 'sentinel: stop after observing BUILD dispatch' };
        }
        return { success: true };
      }),
    };

    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'architecture_review_as_built',
      maxRetries: 1,
      config: { architecture_review_as_built: { remediation: { enabled: true } } } as never,
      escalateBuildFailure: async () => ({}),
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      sleepFn: async () => {},
    });

    await conductor.run();

    expect(dispatched).toContain('remediate');
    expect(dispatched).toContain('build');
    expect(pendingAtBuildDispatch).toBe(true);
    await expect(
      readFile(join(projectRoot, '.docs', 'plans', 'plan-growth-existing-task-restage.md'), 'utf8'),
    ).resolves.not.toContain('rem-as-built');

    const finalState = await readState(stateFilePath);
    expect(finalState.ok && finalState.value.architecture_review_as_built).toBe('stale');
  });
});
