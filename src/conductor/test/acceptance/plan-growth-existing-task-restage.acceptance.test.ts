// Covers: S3.2, S4.5, task:5, task:7, task:8
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
          // Re-completing the same re-staged row is bookkeeping-only: it
          // moves no source tree bytes and must not defeat D2's no-op guard.
          await writeFile(
            join(projectRoot, '.pipeline', 'task-status.json'),
            JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
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
    const captured = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'kickback-ledger.json'), 'utf8'),
    );
    // This is the pre-re-stage count. Sampling after re-stage made this zero,
    // so the BUILD re-completion above incorrectly looked like progress.
    expect(captured.gates.architecture_review_as_built.resolvedBefore).toBe(1);

    await writeState(stateFilePath, {
      ...(finalState.ok ? finalState.value : {}),
      architecture_review_as_built: 'pending',
      build: 'done',
    });
    await rm(join(projectRoot, '.pipeline', 'HALT'), { force: true });
    await rm(join(projectRoot, '.pipeline', 'HALT.class'), { force: true });
    await new Conductor({
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
    }).run();
    expect(dispatched.filter((step) => step === 'remediate')).toHaveLength(1);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8'))
      .resolves.toMatch(/as-built architecture review kickback-to-build no-op/);
  });
});

/**
 * Shared shape for the two Task 7 / Task 8 regressions below. The as-built
 * BLOCKED report and the planner's existing-task answer are the same in both;
 * only the sibling validators and the BUILD observation differ.
 */
const AS_BUILT_BLOCKED = (clause: string) => [
  'Verdict: BLOCKED',
  '',
  '## Blocking Findings',
  '| Finding | Class | Governing clause | Summary |',
  '| --- | --- | --- | --- |',
  `| ARCH-1 | REMEDIABLE | ${clause} | Add the approved guard |`,
].join('\n');

const MT_FAIL = '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n';

function makeConductor(runner: StepRunner, config: Record<string, unknown>, fromStep: StepName): Conductor {
  return new Conductor({
    projectRoot,
    stateFilePath,
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    mode: 'auto',
    daemon: true,
    verifyArtifacts: true,
    fromStep,
    maxRetries: 1,
    config: config as never,
    escalateBuildFailure: async () => ({}),
    git: async () => ({ stdout: '' }),
    gh: async () => ({ stdout: '' }),
    runGh: async () => ({ stdout: '' }),
    sleepFn: async () => {},
  });
}

describe('a consolidated manual-test FAIL round never runs the existing-task route (AB-1)', () => {
  it('rides the merged work order without a gate lap, pending finding, or re-stage', async () => {
    // Covers: S4.5, task:8
    // adr-2026-08-25 decision 8 (retained by decision 9) and sealed Story 4:
    // a manual_test FAIL in the same validation-group round makes the
    // consolidated kickback the owner of the work order. The as-built finding
    // still rides that single merged rewind, but the gate-local existing-task
    // mechanics must be unreachable — no lap charged under the as-built key,
    // no pending finding persisted, no task-status re-stage.
    const initial = await readState(stateFilePath);
    await writeState(stateFilePath, {
      ...(initial.ok ? initial.value : {}),
      track: 'product',
      manual_test: 'pending',
      prd_audit: 'skipped',
      architecture_review_as_built: 'pending',
    } as ConductState);

    let buildHint = '';
    let taskStatusAtBuildDispatch = '';
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, opts) => {
        dispatched.push(step);
        if (step === 'manual_test') {
          await writeFile(join(projectRoot, '.pipeline', 'manual-test-results.md'), MT_FAIL);
        } else if (step === 'architecture_review_as_built') {
          await writeFile(
            join(projectRoot, '.pipeline', 'architecture-review-as-built.md'),
            AS_BUILT_BLOCKED('Task 1'),
          );
        } else if (step === 'remediate') {
          await writeFile(
            join(projectRoot, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [{
                id: 'ARCH-1',
                disposition: 'existing-task',
                category: null,
                rationale: 'Task 1 already owns the approved guard.',
                tasks: [{ id: '1', title: 'Add the approved guard' }],
              }],
            }),
          );
        } else if (step === 'build') {
          buildHint = opts?.retryReason ?? '';
          taskStatusAtBuildDispatch = await readFile(
            join(projectRoot, '.pipeline', 'task-status.json'),
            'utf8',
          );
          return { success: false, error: 'sentinel: stop after observing the merged BUILD dispatch' };
        }
        return { success: true };
      }),
    };

    await makeConductor(
      runner,
      { architecture_review_as_built: { remediation: { enabled: true } } },
      'manual_test',
    ).run();

    // ONE /remediate over the as-built gap, ONE merged work order carrying
    // both evidence streams (adr-2026-07-10-validation-group-join decision 3).
    expect(dispatched.filter((step) => step === 'remediate')).toHaveLength(1);
    expect(dispatched.filter((step) => step === 'build')).toHaveLength(1);
    expect(buildHint).toContain('FAIL');
    expect(buildHint).toContain('ARCH-1');
    // The existing-task mechanics did not run: the bound row was not
    // re-staged, no as-built lap was charged, no pending finding persisted.
    expect((JSON.parse(taskStatusAtBuildDispatch) as { tasks: Array<{ id: string; status: string }> }).tasks)
      .toEqual([{ id: '1', status: 'completed' }]);
    const ledger = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'kickback-ledger.json'), 'utf8'),
    );
    expect(ledger.gates.architecture_review_as_built?.laps).toBeUndefined();
    expect(ledger.pendingAsBuiltRemediationFindings).toBeUndefined();
    expect(ledger.gates.manual_test).toBeDefined();
  });
});

describe('a mixed prd_audit/as-built existing-task lap keeps every gate armed for no-op escalation (AB-2)', () => {
  it('captures the pre-re-stage baseline for both gates and halts the as-built no-op instead of admitting another lap', async () => {
    // Covers: S4.4, task:7
    // Task 7 and adr-2026-08-25 decision 9: the no-op escalation pair stays
    // armed for EVERY gate on an existing-task lap. The route re-stages the
    // bound rows to pending before the rewind, so each participating gate
    // must bank the pre-re-stage resolved count. A gate that samples the
    // depressed post-re-stage count sees the next BUILD's re-completion of
    // those same rows as progress on a byte-identical tree.
    await mkdir(join(projectRoot, '.docs', 'stories'), { recursive: true });
    await writeFile(
      join(projectRoot, '.docs', 'plans', 'plan-growth-existing-task-restage.md'),
      '# Plan\n\n### Task 1: PRD work\n\n### Task 2: Add the approved guard\n',
    );
    await writeFile(
      join(projectRoot, '.docs', 'stories', 'plan-growth-existing-task-restage.md'),
      '## Story 1: Existing work\n\n### Happy Path\n- Given work, when repaired, then it passes.\n',
    );
    const completedRows = JSON.stringify({
      tasks: [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }],
    });
    await writeFile(join(projectRoot, '.pipeline', 'task-status.json'), completedRows);
    const initial = await readState(stateFilePath);
    await writeState(stateFilePath, {
      ...(initial.ok ? initial.value : {}),
      track: 'product',
      manual_test: 'skipped',
      prd_audit: 'pending',
      architecture_review_as_built: 'pending',
    } as ConductState);

    let remediateCalls = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'prd_audit') {
          await writeFile(join(projectRoot, '.pipeline', 'prd-audit.md'), [
            '# PRD Audit', '', '**PRD:** none', '', '## Verdict Table',
            '| Criterion | Grade | Plan task | PRD: | Evidence |',
            '|---|---|---|---|---|',
            '| S1.1 | FIXABLE | 1 | FR-1 | Missing implementation |',
          ].join('\n'));
        } else if (step === 'architecture_review_as_built') {
          await writeFile(
            join(projectRoot, '.pipeline', 'architecture-review-as-built.md'),
            AS_BUILT_BLOCKED('Task 2'),
          );
        } else if (step === 'remediate') {
          remediateCalls++;
          await writeFile(
            join(projectRoot, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'FR-1',
                  disposition: 'existing-task',
                  category: null,
                  rationale: 'Task 1 already owns this repair.',
                  tasks: [{ id: '1', title: 'PRD work' }],
                },
                {
                  id: 'ARCH-1',
                  disposition: 'existing-task',
                  category: null,
                  rationale: 'Task 2 already owns the approved guard.',
                  tasks: [{ id: '2', title: 'Add the approved guard' }],
                },
              ],
            }),
          );
        } else if (step === 'build') {
          // Re-completing the re-staged rows moves no source tree bytes.
          await writeFile(join(projectRoot, '.pipeline', 'task-status.json'), completedRows);
          return { success: false, error: 'sentinel: stop after observing BUILD dispatch' };
        }
        return { success: true };
      }),
    };
    const config = {
      prd_audit: { max_remediation_laps: 2 },
      architecture_review_as_built: { remediation: { enabled: true }, max_remediation_laps: 2 },
    };

    await makeConductor(runner, config, 'prd_audit').run();

    expect(remediateCalls).toBe(1);
    const captured = JSON.parse(
      await readFile(join(projectRoot, '.pipeline', 'kickback-ledger.json'), 'utf8'),
    );
    // Both gates bank the same pre-re-stage count (2 completed rows).
    expect(captured.gates.prd_audit.resolvedBefore).toBe(2);
    expect(captured.gates.architecture_review_as_built.resolvedBefore).toBe(2);

    const afterFirst = await readState(stateFilePath);
    await writeState(stateFilePath, {
      ...(afterFirst.ok ? afterFirst.value : {}),
      prd_audit: 'pending',
      architecture_review_as_built: 'pending',
      build: 'done',
    } as ConductState);
    await rm(join(projectRoot, '.pipeline', 'HALT'), { force: true });
    await rm(join(projectRoot, '.pipeline', 'HALT.class'), { force: true });

    await makeConductor(runner, config, 'prd_audit').run();

    // The unchanged tree with re-completed rows is `no-work` for the as-built
    // check too: it halts, and the second lap its cap would allow is refused.
    expect(remediateCalls).toBe(1);
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8'))
      .resolves.toMatch(/as-built architecture review kickback-to-build no-op/);
  });
});
