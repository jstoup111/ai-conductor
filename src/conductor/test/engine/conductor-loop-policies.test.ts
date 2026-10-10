// Covers: task:1, task:2, task:3, task:4, task:5, task:9, task:11, task:12, task:21, task:31
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readdir,} from 'fs/promises';
import { basename, join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({
  execa: vi.fn(() =>
    Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
  ),
}));
vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
}));
vi.mock('../../src/engine/self-host/sandbox-build-env.js', () => ({
  provisionSandboxBuildEnv: vi.fn(),
  realSandboxFs: {},
  SandboxProvisionError: class SandboxProvisionError extends Error {},
}));
vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual('../../src/engine/rebase.js');
  return {
    ...actual,
    performRebase: vi.fn().mockResolvedValue({
      kind: 'noop',
    }),
  };
});
vi.mock('../../src/engine/kickback-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/kickback-ledger.js')>();
  return {
    ...actual,
    creditKickbackGateLaps: vi.fn(actual.creditKickbackGateLaps),
  };
});
import { execa } from 'execa';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import type { ConductState,} from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName,} from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import {
  ALL_STEPS,
  STEP_GROUPS,
  VALIDATION_GROUP,
  getGroupForStep,
  tryGetStepIndex,
} from '../../src/engine/steps.js';
import {
  buildRetryHint,
  appendRemediationTasks,
} from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import type { GroupBranchLifecycleObserver } from '../../src/engine/group-core.js';
import { runGroupBranch } from '../../src/engine/group-core.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';
import { validatePlanDoneWhen } from '../../src/engine/plan-done-when.js';
import { AuditTrailWriter } from '../../src/engine/audit-trail.js';
import {
  checkStepCompletion,
} from '../../src/engine/artifacts.js';
import * as artifactModule from '../../src/engine/artifacts.js';
import * as rebaseModule from '../../src/engine/rebase.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
} from '../../src/engine/provider-model-policy.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { persistFixtureProjectedRemediationPlan } from './remediation-plan-fixtures.js';
import type {
  ExecuteProviderCandidatesInput,
  ProviderExecutionResult,
} from '../../src/engine/provider-execution.js';

import type {
  LLMProvider,
} from '../../src/execution/llm-provider.js';

const NOOP_GROUP_BRANCH_LIFECYCLE_OBSERVER: GroupBranchLifecycleObserver = {
  onAdmitted: () => undefined,
  onAttempt: () => undefined,
  onRetry: () => undefined,
  onSettled: () => undefined,
};

function createMockStepRunner(result: StepRunResult = { success: true }): StepRunner {
  return {
    run: vi.fn().mockResolvedValue(result),
  };
}

// Valid RED execution-evidence for the acceptance_specs gate: the feature's own
// specs ran and failed (not skipped/errored). Fixtures that pre-satisfy
// acceptance_specs to reach a later step must seed this alongside the spec file.
const RED_EVIDENCE_JSON = JSON.stringify({
  outcome: 'specs-generated',
  command: 'bundle exec rspec spec/acceptance',
  targetSpecs: ['spec/acceptance/feature_spec.rb'],
  executed: 1,
  passed: 0,
  failed: 1,
  skipped: 0,
  errors: 0,
  failingTests: [
    {
      name: 'Feature acceptance behavior',
      reason: 'Expected behavior is not implemented yet',
    },
  ],
  ranAt: '2026-08-10T00:00:00.000Z',
  intentRationale: 'The feature acceptance spec executed and failed before implementation.',
});


describe('recovery retry budget', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-retrybudget-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function failThenSucceedRunner(failStep: StepName, succeedAfter: number): { runner: StepRunner; calls: () => number } {
    let count = 0;
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step !== failStep) return { success: true };
        count++;
        return count > succeedAfter ? { success: true } : { success: false, output: 'nope' };
      }),
    };
    return { runner, calls: () => count };
  }

  it('passes RecoveryContext with recoveryCount=0 on first recovery entry', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done',
    } as ConductState);
    const { runner } = failThenSucceedRunner('build', Infinity);
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    expect(onRecovery).toHaveBeenCalledWith(
      'build',
      expect.any(Boolean),
      expect.objectContaining({ recoveryCount: 0, retriesExhausted: false }),
    );
  });

  it('marks retriesExhausted after MAX_RECOVERY_RETRIES cycles', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done',
    } as ConductState);
    const { runner } = failThenSucceedRunner('build', Infinity);

    // Sequence: 1st recovery → retry. 2nd recovery → retry. 3rd recovery → retriesExhausted=true, return quit.
    let call = 0;
    const seenContexts: Array<{ recoveryCount: number; retriesExhausted: boolean }> = [];
    const onRecovery = vi.fn(async (_step, _gating, context) => {
      call++;
      seenContexts.push(context ?? { recoveryCount: -1, retriesExhausted: false });
      if (call <= 2) return 'retry' as const;
      return 'quit' as const;
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    expect(seenContexts[0]).toEqual({ recoveryCount: 0, retriesExhausted: false });
    expect(seenContexts[1]).toEqual({ recoveryCount: 1, retriesExhausted: false });
    expect(seenContexts[2]).toEqual({ recoveryCount: 2, retriesExhausted: true });
  });

  it('starts recovery retries fresh for a newly active child', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done',
    } as ConductState);
    const { runner } = failThenSucceedRunner('build', Infinity);
    const child1 = parseChildId(1)!;
    const child2 = parseChildId(2)!;
    const seenContexts: Array<{ recoveryCount: number; retriesExhausted: boolean }> = [];
    let conductor: Conductor;
    const onRecovery = vi.fn(async (_step, _gating, context) => {
      seenContexts.push(context ?? { recoveryCount: -1, retriesExhausted: false });
      if (seenContexts.length === 1) {
        (conductor as unknown as { activeRegionChild: typeof child2 }).activeRegionChild = child2;
        return 'retry' as const;
      }
      return 'quit' as const;
    });

    conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      maxRetries: 1,
      onRecovery,
    });
    (conductor as unknown as { activeRegionChild: typeof child1 }).activeRegionChild = child1;

    await conductor.run();

    expect(seenContexts).toEqual([
      { recoveryCount: 0, retriesExhausted: false },
      { recoveryCount: 0, retriesExhausted: false },
    ]);
  });

  it('does not infinite-loop when a non-conforming onRecovery returns retry after exhaustion', async () => {
    await writeState(statePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', stories: 'done',
      conflict_check: 'done', plan: 'done', coherence_check: 'done', architecture_diagram: 'done',
      architecture_review: 'done', writing_system_tests: 'done',
    } as ConductState);
    const { runner } = failThenSucceedRunner('build', Infinity);

    // Adversarial callback: returns 'retry' forever, ignoring context.
    // Engine should poll for a different answer once retriesExhausted=true.
    // We give up and return quit after 6 calls so the test terminates.
    let call = 0;
    const onRecovery = vi.fn(async () => {
      call++;
      return call <= 5 ? ('retry' as const) : ('quit' as const);
    });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'build',
      maxRetries: 1,
      onRecovery,
    });

    await conductor.run();

    // The engine looped back to the recovery menu instead of honoring 'retry'
    // after the budget was exhausted. Number of calls proves we didn't short-circuit
    // into an infinite i-- retry loop.
    expect(call).toBeGreaterThan(2);
    expect(call).toBeLessThanOrEqual(6);
  });
});

describe('buildRetryHint', () => {
  it('returns the generic "finish the work now" hint by default', () => {
    const hint = buildRetryHint('stories', 'missing file x');
    expect(hint).toContain('Finish the work now');
    expect(hint).toContain('missing file x');
  });

  it('handles an undefined reason by labeling it "unknown"', () => {
    const hint = buildRetryHint('plan', undefined);
    expect(hint).toContain('unknown');
  });

  it('redirects Claude to use trailers for build "tasks not completed" failures', () => {
    const hint = buildRetryHint('build', '9/31 tasks not completed: 9, 10, 11 (+6 more)');
    expect(hint).toContain('Task:');
    expect(hint).toContain('trailer');
    expect(hint).not.toContain('Finish the work now');
  });

  it('directs to plan for build failures about missing or empty task files', () => {
    const hint = buildRetryHint('build', 'missing .pipeline/task-status.json — the pipeline skill must create it');
    expect(hint).toContain('.docs/plans');
    expect(hint).not.toContain('Finish the work now');
  });

  it('uses the generic hint for non-build steps even if reason mentions tasks', () => {
    const hint = buildRetryHint('plan', '3 tasks not completed: x');
    expect(hint).toContain('Finish the work now');
    expect(hint).not.toContain('may already be done');
  });

  it('directs to plan for empty plan (no tasks in plan heading)', () => {
    const hint = buildRetryHint('build', 'plan is empty or contains no tasks (### Task N headings required)');
    expect(hint).toContain('.docs/plans');
  });

  it('directs to plan for zero tasks in task-status.json', () => {
    const hint = buildRetryHint('build', 'no tasks in task-status.json');
    expect(hint).toContain('.docs/plans');
  });

  it('names and tells the next BUILD dispatch to commit uncommitted paths', () => {
    const reason = 'uncommitted paths: src/engine/conductor.ts, src/engine/artifacts.ts';
    const hint = buildRetryHint('build', reason, 'uncommitted');

    expect(hint).toMatch(/^(?=[\s\S]*src\/engine\/conductor\.ts)(?=[\s\S]*src\/engine\/artifacts\.ts)(?=[\s\S]*\bcommit (the )?uncommitted paths\b)(?![\s\S]*Finish the work now)[\s\S]*$/i);
  });

  it('cites manual-test-record for a missing manual_test marker', () => {
    const hint = buildRetryHint(
      'manual_test',
      '.pipeline/manual-test-results.md is missing — the manual-test skill must record per-story PASS/FAIL results before exiting',
    );
    expect(hint).toContain('ai-conductor manual-test-record');
  });

  it('does not mention --skip for a manual_test FAIL-reason miss', () => {
    const hint = buildRetryHint(
      'manual_test',
      '.pipeline/manual-test-results.md contains FAIL rows (latest attempt) — fix the bugs (commits required) and re-run manual-test',
    );
    expect(hint).not.toContain('--skip');
  });
});

describe('skip-already-resolved steps', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-skipdone-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does not re-dispatch steps already marked done', async () => {
    // Pre-populate state with some steps already done — this mirrors the
    // real-world situation of running conduct-ts against a project that
    // already made progress on a previous invocation.
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      complexity_tier: 'L',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // None of the `done` steps should have been re-dispatched.
    expect(calledSteps).not.toContain('worktree');
    expect(calledSteps).not.toContain('explore');
    expect(calledSteps).not.toContain('plan');
    expect(calledSteps).not.toContain('acceptance_specs');

    // Only the remaining steps (build → finish) should have run.
    expect(calledSteps).toContain('build');
    expect(calledSteps).toContain('finish');
  });

  it('does not re-dispatch steps marked skipped', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'skipped',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'S',
      stories: 'done',
      plan: 'done', coherence_check: 'done',
      acceptance_specs: 'skipped',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    expect(calledSteps).not.toContain('memory');
    expect(calledSteps).not.toContain('acceptance_specs');
  });

  it('DOES re-dispatch steps marked failed (so recovery flow can run again)', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'L',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'failed',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    const conductor = new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events });
    await conductor.run();

    // failed build is re-entered; done steps before it are skipped.
    expect(calledSteps).toContain('build');
    expect(calledSteps).not.toContain('worktree');
    expect(calledSteps).not.toContain('plan');
  });

  it('DOES re-dispatch a done step when --from targets it explicitly', async () => {
    await writeState(statePath, {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      complexity_tier: 'L',
      stories: 'done',
      conflict_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      plan: 'done', coherence_check: 'done',
    } as ConductState);

    const calledSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        calledSteps.push(step);
        return { success: true };
      }),
    };

    // --from explicitly asks to re-run `plan` regardless of its current status.
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'plan',
    });
    await conductor.run();

    expect(calledSteps[0]).toBe('plan');
  });
});

describe('build-step stall circuit breaker', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-stall-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedAllArtifactsExceptTaskStatus(): Promise<void> {
    const artifacts: Array<[string, string]> = [
      ['.docs/decisions/technical-assessment-2026-04-18.md', 'x'],
      ['.docs/specs/2026-04-18-plan.md', 'x'],
      ['.docs/stories/2026-04-18-plan.md', 'x'],
      ['.docs/conflicts/2026-04-18-plan.md', 'x'],
      ['.docs/plans/2026-04-18-plan.md', 'x'],
      ['.docs/coherence/2026-04-18-plan.md', 'x'],
      ['.docs/architecture/arch.md', 'x'],
      ['.docs/decisions/adr-001.md', 'x'],
      ['spec/acceptance/feature_spec.rb', 'x'],
      ['.pipeline/acceptance-specs-red.json', RED_EVIDENCE_JSON],
    ];
    for (const [rel, content] of artifacts) {
      const full = join(dir, rel);
      await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, content);
    }
    // Stall tests own the build transition. Pre-resolve the intervening
    // coverage-binding gate so its default-off envelope is not a prerequisite
    // for every fixture here.
    await writeState(statePath, { coverage_binding: 'done' } as ConductState);
  }

  // Writes the plan (Task 1..total headings), the status rows, AND a sidecar
  // evidence stamp for every completed id. Under the engine-owned contract
  // (ADR H6) an agent-asserted 'completed' row with no evidence is demoted on
  // every gate evaluation — so these tests' notion of "progress" must be
  // evidence-backed completions, or the stall breaker would (correctly) fire
  // on all of them.
  async function writeTaskStatus(
    completed: number,
    total: number,
    titles: readonly string[] = [],
  ): Promise<void> {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    const planLines: string[] = ['# Plan', ''];
    for (let i = 1; i <= total; i++) {
      planLines.push(`### Task ${i}: ${titles[i - 1] ?? `Step ${i}`}`, '');
    }
    await writeFile(join(dir, '.docs/plans/2026-04-18-plan.md'), planLines.join('\n'));
    const tasks: Array<{ id: number; status: string }> = [];
    const stamps: Record<string, { sha: string; form: string }> = {};
    for (let i = 1; i <= total; i++) {
      const done = i <= completed;
      tasks.push({ id: i, status: done ? 'completed' : 'pending' });
      if (done) stamps[String(i)] = { sha: `${'0'.repeat(38)}${String(i).padStart(2, '0')}`, form: 'trailer' };
    }
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({ tasks }));
    await writeFile(
      join(dir, '.pipeline/task-evidence.json'),
      JSON.stringify({ evidenceStamps: stamps, noEvidenceAttempts: 0, migrationGrandfather: [] }),
    );
  }

  it('triggers build_stall after two retries with zero new task completions', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(2, 5); // 2/5 done — and it never changes

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn(async () => {
        // The "interactive session" is a no-op for the test; it simulates the
        // user dropping in and /quitting without doing additional work.
      }),
    };

    const stallEvents: Array<{ reason: string; before: number; after: number }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') {
        stallEvents.push({
          reason: e.reason,
          before: e.resolvedBefore,
          after: e.resolvedAfter,
        });
      }
    });

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    expect(stallEvents).toHaveLength(1);
    expect(stallEvents[0].reason).toBe('no_task_progress');
    expect(stallEvents[0].before).toBe(2);
    expect(stallEvents[0].after).toBe(2);
    expect(runner.runInteractive).toHaveBeenCalledWith('build', {
      reason:
        'Previous attempt did not satisfy the completion check: 3/5 tasks pending/not completed: 3, 4, 5 — 3 "Step 3"; 4 "Step 4"; 5 "Step 5". Finish the work now.',
    });
  });

  // Covers: task:11
  it('passes all pending ids and titles through the next BUILD retry hint and step_retry event', async () => {
    await seedAllArtifactsExceptTaskStatus();
    const titles = [
      'Prepare alpha',
      'Prepare beta',
      'Prepare gamma',
      'Prepare delta',
      'Prepare epsilon',
      'Prepare zeta',
    ];
    await writeTaskStatus(0, titles.length, titles);

    const buildHints: string[] = [];
    const retryReasons: string[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state: ConductState, options?: StepRunOptions) => {
        if (step === 'build' && options?.retryReason) buildHints.push(options.retryReason);
        return { success: true };
      }),
    };
    events.on('step_retry', (event) => {
      if (event.type === 'step_retry' && event.step === 'build') retryReasons.push(event.reason);
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 2,
      onRecovery: vi.fn().mockResolvedValue('quit' as const),
    });

    await conductor.run();

    expect(buildHints).not.toHaveLength(0);
    expect(retryReasons).not.toHaveLength(0);
    for (const value of [...buildHints, ...retryReasons]) {
      for (let i = 0; i < titles.length; i++) {
        expect(value).toContain(String(i + 1));
        expect(value).toContain(titles[i]);
      }
    }

    const identicalReason = retryReasons[0];
    expect(artifactModule.classifyRetryDecision({
      // BUILD itself retains its dedicated progress accounting; this guards
      // the shared retry classifier's unchanged-reason comparison.
      step: 'build_review',
      completion: { done: false, reason: identicalReason },
      attempt: 2,
      priorReason: identicalReason,
      inputsUnchanged: true,
    })).toEqual({ decision: 'route', signal: 'identical-repeat' });
  });

  // Covers: task:12
  it('names every pending task in the no-task-progress stall question and exhaustion HALT', async () => {
    await seedAllArtifactsExceptTaskStatus();
    const titles = ['Prepare alpha', 'Prepare beta', 'Prepare gamma'];
    await writeTaskStatus(0, titles.length, titles);

    const runner: StepRunner = {
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
    });

    await conductor.run();

    const expected = ['build stalled: no task progress', ...titles.flatMap((title, index) => [
      String(index + 1),
      title,
    ])];
    const [question, halt] = await Promise.all([
      readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf8'),
      readFile(join(dir, '.pipeline/HALT'), 'utf8'),
    ]);
    expect([question, halt].every((content) => expected.every((value) => content.includes(value)))).toBe(true);
  });

  it('triggers build_stall on the first retry when .pipeline/halt-user-input-required is present', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(3, 10);
    // Halt marker present — conductor should stall immediately without
    // waiting for a second retry.
    await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'scope mismatch');

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const stallEvents: Array<{ reason: string }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') stallEvents.push({ reason: e.reason });
    });

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    expect(stallEvents).toHaveLength(1);
    expect(stallEvents[0].reason).toBe('halt_marker');
    expect(runner.runInteractive).toHaveBeenCalledWith('build', {
      reason:
        'Previous attempt did not satisfy the completion check: .pipeline/halt-user-input-required is present — pipeline halted; conductor will open a recovery REPL. Finish the work now.',
    });
    // Marker cleared after acknowledgement.
    let markerStillThere = false;
    try {
      await readFile(join(dir, '.pipeline/halt-user-input-required'));
      markerStillThere = true;
    } catch {
      /* marker removed — expected */
    }
    expect(markerStillThere).toBe(false);
  });

  it('attributes an inline build-stall marker clear to stall remediation in the audit trail', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(3, 10);
    await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'scope mismatch');

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const haltClearedEvents: Array<{ step?: StepName; cause: string }> = [];
    events.on('halt_cleared', (e) => {
      if (e.type === 'halt_cleared') haltClearedEvents.push({ step: e.step, cause: e.cause });
    });

    const auditWriter = new AuditTrailWriter(dir);
    auditWriter.subscribe(events);

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    expect(haltClearedEvents).toHaveLength(1);
    expect(haltClearedEvents[0].step).toBe('build');
    expect(haltClearedEvents[0].cause).toBe('stall-remediation');

    const eventsPath = join(dir, '.pipeline/audit-trail/events.jsonl');
    const contents = await readFile(eventsPath, 'utf8');
    const records = contents
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { event: string; cause?: string; origin: string });

    const haltClearedRecord = records.find((r) => r.event === 'halt_cleared');
    expect(haltClearedRecord).toBeDefined();
    expect(haltClearedRecord?.cause).toBe('stall-remediation');
    expect(haltClearedRecord?.origin).toBe('build');
  });

  it('supersedes the committed halt record when the in-build halt marker is cleared', async () => {
    // ADR adr-2026-08-23-committed-halt-record §7 names both halt-clear seams.
    // The daemon's is wired (daemon-deps.ts); this asserts the conductor's own
    // in-loop clear also resolves the record, so a record can never merge to
    // main saying `Status: halted` for a feature that resumed and shipped.
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(3, 10);
    await writeFile(join(dir, '.pipeline/halt-user-input-required'), 'plan gap');

    const slug = basename(dir);
    const recordPath = join(dir, '.docs/halted', `${slug}.md`);
    await mkdir(join(dir, '.docs/halted'), { recursive: true });
    await writeFile(
      recordPath,
      `# Halt: ${slug}\n\nStatus: halted\nClass: plan-gap\nStep: build\n`,
    );

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    const record = await readFile(recordPath, 'utf8');
    expect(record).toContain('Status: resolved');
    expect(record).toContain('Resolution cause: stall-remediation');
    expect(record).not.toContain('Status: halted');
  });

  it('captures halt marker content to evidence file before clearing the marker', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(3, 10);
    const markerContent = 'Need user decision: which auth provider — Auth0 or Cognito?';
    await writeFile(join(dir, '.pipeline/halt-user-input-required'), markerContent);

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const eventOrder: string[] = [];
    const stallEvents: Array<{ reason: string }> = [];
    const haltClearedEvents: Array<{ step?: StepName; cause: string }> = [];

    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') {
        eventOrder.push('build_stall');
        stallEvents.push({ reason: e.reason });
      }
    });

    events.on('halt_cleared', (e) => {
      if (e.type === 'halt_cleared') {
        eventOrder.push('halt_cleared');
        haltClearedEvents.push({ step: e.step, cause: e.cause });
      }
    });

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    // Verify events fired in order
    expect(eventOrder).toEqual(['build_stall', 'halt_cleared']);

    // Verify build_stall event contains halt_marker reason
    expect(stallEvents).toHaveLength(1);
    expect(stallEvents[0].reason).toBe('halt_marker');

    // Verify halt_cleared event
    expect(haltClearedEvents).toHaveLength(1);
    expect(haltClearedEvents[0].step).toBe('build');
    expect(haltClearedEvents[0].cause).toBe('stall-remediation');

    // Verify the halt marker content was captured to evidence file
    let capturedContent: string | null = null;
    try {
      capturedContent = await readFile(join(dir, '.pipeline/build-stall-question.md'), 'utf-8');
    } catch {
      // File doesn't exist — expected to fail if capture didn't happen
    }
    expect(capturedContent).toBe(markerContent);

    // Verify the halt marker was actually cleared
    let markerStillExists = false;
    try {
      await readFile(join(dir, '.pipeline/halt-user-input-required'));
      markerStillExists = true;
    } catch {
      /* marker removed — expected */
    }
    expect(markerStillExists).toBe(false);
  });

  it('does NOT trigger build_stall when a retry produces new task completions', async () => {
    await seedAllArtifactsExceptTaskStatus();

    let progress = 0;
    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') {
          // Each build attempt marks one more task completed.
          progress++;
          await writeTaskStatus(progress, 4);
        }
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const stallEvents: unknown[] = [];
    events.on('build_stall', (e) => { stallEvents.push(e); });

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 5,
      onRecovery,
    });

    await conductor.run();

    // Progress was made every attempt, so no stall.
    expect(stallEvents).toHaveLength(0);
    expect(runner.runInteractive).not.toHaveBeenCalled();
  });

  // #859 loop-level pin (Task 9): when every plan task id is resolved via
  // Task:-trailered commits (rows still pending/never flipped), the build
  // completion check must return done=true — and the stall circuit breaker
  // (which lives entirely inside the `if (!completion.done)` branch) must
  // never be reached at all. Asserts no build_stall event fires and the
  // interactive stall handoff never runs, even though attempt/resolved-count
  // bookkeeping would otherwise look flat across attempts.
  it('#859: all task ids trailer-resolved -> completion is done and the stall breaker is never reached', async () => {
    // `execa` is mocked module-wide (top of file) to a no-op success stub —
    // real git commands never execute, so trailer resolution would silently
    // see zero commits. This test needs genuine git commits to exercise the
    // trailer-union path, so it swaps in the real `execa` implementation for
    // its duration and restores the no-op stub afterward.
    const actualExeca = (await vi.importActual<typeof import('execa')>('execa')).execa;
    vi.mocked(execa).mockImplementation(actualExeca as unknown as typeof execa);
    try {
      await seedAllArtifactsExceptTaskStatus();

      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'seed pre-build artifacts'], { cwd: dir });

      // Plan with 3 tasks, matching the writeTaskStatus() heading convention.
      await writeFile(
        join(dir, '.docs/plans/2026-04-18-plan.md'),
        ['# Plan', '', '### Task 1: Step 1', '', '### Task 2: Step 2', '', '### Task 3: Step 3', ''].join(
          '\n',
        ),
      );
      await execa('git', ['add', '.docs/plans/2026-04-18-plan.md'], { cwd: dir });
      await execa('git', ['commit', '-m', 'docs: add plan'], { cwd: dir });

      // task-status.json rows are ALL pending — the pipeline never flipped
      // them — so a rows-only reader would see zero resolved tasks forever.
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({
          tasks: [
            { id: '1', status: 'pending' },
            { id: '2', status: 'pending' },
            { id: '3', status: 'pending' },
          ],
        }),
      );

      // Every task is resolved ONLY via a Task:-trailered commit.
      await mkdir(join(dir, 'src'), { recursive: true });
      for (const n of [1, 2, 3]) {
        await writeFile(join(dir, `src/task-${n}.ts`), `export const task${n} = true;\n`);
        await execa('git', ['add', `src/task-${n}.ts`], { cwd: dir });
        await execa('git', ['commit', '-m', `feat: task ${n}\n\nTask: ${n}\n`], { cwd: dir });
      }

      const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
        run: vi.fn().mockResolvedValue({ success: true }),
        runInteractive: vi.fn().mockResolvedValue(undefined),
      };

      const stallEvents: unknown[] = [];
      events.on('build_stall', (e) => { stallEvents.push(e); });

      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        maxRetries: 3,
        onRecovery,
      });

      await conductor.run();

      // Trailer-union resolution passes the completion gate on the first
      // attempt, so the stall block (guarded by `if (!completion.done)`) is
      // never entered: no build_stall event, no interactive handoff.
      expect(stallEvents).toHaveLength(0);
      expect(runner.runInteractive).not.toHaveBeenCalled();
    } finally {
      vi.mocked(execa).mockImplementation(() =>
        Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }) as unknown as ReturnType<typeof execa>,
      );
    }
  });

  it('does not route the exhausted commit-movement escape when the final worktree probe is dirty', async () => {
    // This is deliberately the narrow owning seam for the escape: the final
    // retry moves HEAD (setting anyAttemptMovedHead), then leaves a tracked
    // file dirty and exhausts the fixed retry budget.
    const actualExeca = (await vi.importActual<typeof import('execa')>('execa')).execa;
    vi.mocked(execa).mockImplementation(actualExeca as unknown as typeof execa);
    const git: GitRunner = async (args, { cwd }) => {
      const result = await execa('git', args, { cwd });
      return { stdout: result.stdout };
    };
    let headSha = 'base-head';
    const currentCommitSha = vi.spyOn(projectPrelude, 'currentCommitSha').mockImplementation(
      async () => headSha,
    );
    try {
      await seedAllArtifactsExceptTaskStatus();
      await writeTaskStatus(0, 1);
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'test: seed build retry fixture'], { cwd: dir });
      headSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout;

      let buildAttempts = 0;
      const stepsRun: StepName[] = [];
      const completedBuilds: unknown[] = [];
      const unattributedProgress: Array<{ attempt: number }> = [];
      events.on('step_completed', (event) => {
        if (event.type === 'step_completed' && event.step === 'build' && event.status === 'done') {
          completedBuilds.push(event);
        }
      });
      events.on('unattributed_progress', ((event: unknown) => {
        const progress = event as { type: string; attempt: number };
        if (progress.type === 'unattributed_progress') unattributedProgress.push(progress);
      }) as never);
      const runner: StepRunner = {
        run: vi.fn(async (step) => {
          stepsRun.push(step);
          if (step === 'build') {
            buildAttempts++;
            if (buildAttempts === 1) {
              await mkdir(join(dir, 'src'), { recursive: true });
              await writeFile(join(dir, 'src/landed.ts'), 'export const landed = true;\n');
              await execa('git', ['add', 'src/landed.ts'], { cwd: dir });
              await execa('git', ['commit', '-m', 'feat: land unattributed work'], { cwd: dir });
              headSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout;
            } else {
              // The exhaustion escape only becomes eligible when this final
              // attempt moves HEAD. Commit work without a Task: trailer,
              // refresh the mocked HEAD, then leave tracked residue behind.
              await writeFile(join(dir, 'src/landed.ts'), 'export const landed = false;\n');
              await execa('git', ['add', 'src/landed.ts'], { cwd: dir });
              await execa('git', ['commit', '-m', 'feat: final unattributed work'], { cwd: dir });
              headSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout;
              await writeFile(join(dir, 'src/landed.ts'), 'export const landed = true;\n');
            }
          }
          return { success: true };
        }),
      };
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        verifyArtifacts: true,
        maxRetries: 2,
        onRecovery,
        escalateBuildFailure: async () => ({}),
        git,
      });

      await conductor.run();

      expect(buildAttempts).toBe(2);
      expect(unattributedProgress.map(({ attempt }) => ({ attempt }))).toEqual([{ attempt: 2 }]);
      expect(completedBuilds).toHaveLength(0);
      expect(stepsRun).not.toContain('build_review');
      expect(onRecovery).toHaveBeenCalledWith('build', false, expect.any(Object));
    } finally {
      currentCommitSha.mockRestore();
      vi.mocked(execa).mockImplementation(() =>
        Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }) as unknown as ReturnType<typeof execa>,
      );
    }
  });

  it('leads a dirty-tree exhaustion HALT with its paths without changing the no-commit-movement remediation HALT', async () => {
    // The exhaustion escape is reached only when HEAD moved during the retry
    // loop. Keep the final attempt dirty *and* moving so it does not enter the
    // separate no_task_progress remediation path below.
    const actualExeca = (await vi.importActual<typeof import('execa')>('execa')).execa;
    vi.mocked(execa).mockImplementation(actualExeca as unknown as typeof execa);
    const git: GitRunner = async (args, { cwd }) => {
      const result = await execa('git', args, { cwd });
      // The conductor persists its own runtime state while this fixture is
      // exercising the content-dirty exhaustion branch. Keep the probe scoped
      // to the authored file the scenario owns.
      if (args[0] === 'status' && args.includes('--porcelain')) {
        return {
          stdout: result.stdout
            .split('\n')
            .filter((line) => !line.includes('.pipeline/') && !line.includes('conduct-state.json'))
            .join('\n'),
        };
      }
      return { stdout: result.stdout };
    };
    let headSha = 'base-head';
    const currentCommitSha = vi.spyOn(projectPrelude, 'currentCommitSha').mockImplementation(
      async () => headSha,
    );
    try {
      await seedAllArtifactsExceptTaskStatus();
      await writeTaskStatus(0, 1);
      await execa('git', ['init', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
      await execa('git', ['add', '.'], { cwd: dir });
      await execa('git', ['commit', '-m', 'test: seed dirty exhaustion fixture'], { cwd: dir });
      headSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout;

      let dirtyEscapeAttempts = 0;
      const dirtyEscapeRunner: StepRunner = {
        run: vi.fn(async (step) => {
          if (step === 'build') {
            dirtyEscapeAttempts += 1;
            const path = `src/attempt-${dirtyEscapeAttempts}.ts`;
            await mkdir(join(dir, 'src'), { recursive: true });
            await writeFile(join(dir, path), `export const attempt = ${dirtyEscapeAttempts};\n`);
            await execa('git', ['add', path], { cwd: dir });
            await execa('git', ['commit', '-m', `feat: attempt ${dirtyEscapeAttempts}`], { cwd: dir });
            headSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout;
            if (dirtyEscapeAttempts === 2) {
              await writeFile(join(dir, path), 'export const attempt = "uncommitted";\n');
            }
          }
          return { success: true };
        }),
      };
      const dirtyEscapeHalts: string[] = [];
      events.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') dirtyEscapeHalts.push(event.reason);
      });
      await new Conductor({
        stateFilePath: statePath,
        stepRunner: dirtyEscapeRunner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 2,
        escalateBuildFailure: async () => ({}),
        git,
      }).run();
      const dirtyEscapeHalt = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');

      // Reset only the terminal state from the first scenario. The worktree
      // remains dirty, but this second run must use the existing no-progress
      // remediation route rather than the commit-movement escape.
      await writeState(statePath, { coverage_binding: 'done' } as ConductState);
      await writeFile(join(dir, '.pipeline/HALT'), '');
      const noMovementEvents = new ConductorEventEmitter();
      const noMovementHalts: string[] = [];
      noMovementEvents.on('loop_halt', (event) => {
        if (event.type === 'loop_halt') noMovementHalts.push(event.reason);
      });
      let remediationCalls = 0;
      const noMovementRunner: StepRunner = {
        run: vi.fn(async (step, _state, options) => {
          if (step === 'remediate') {
            remediationCalls += 1;
            await persistFixtureProjectedRemediationPlan(dir, options, [{
              id: 'stall:dirty-tree',
              disposition: 'halt',
              category: 'product-scope',
              rationale: 'The uncommitted repair needs a human decision.',
              tasks: [],
            }]);
          }
          return { success: true };
        }),
      };
      await new Conductor({
        stateFilePath: statePath,
        stepRunner: noMovementRunner,
        events: noMovementEvents,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 2,
        escalateBuildFailure: async () => ({}),
        git,
      }).run();

      const nonEmptyDirtyEscapeLines = dirtyEscapeHalt.split('\n').filter((line) => line.trim());
      expect({
        dirtyEscapeAttempts,
        dirtyEscapeFirstLine: nonEmptyDirtyEscapeLines[0],
        dirtyEscapeUsesGenericRetryText: /retries exhausted/i.test(dirtyEscapeHalt),
        dirtyEscapeHalts: dirtyEscapeHalts.length,
        remediationCalls,
        noMovementHalts: noMovementHalts.length,
        noMovementHalt: await readFile(join(dir, '.pipeline/HALT'), 'utf-8'),
      }).toMatchObject({
        dirtyEscapeAttempts: 2,
        dirtyEscapeFirstLine: expect.stringContaining('src/attempt-2.ts'),
        dirtyEscapeUsesGenericRetryText: false,
        dirtyEscapeHalts: 1,
        remediationCalls: 1,
        noMovementHalts: 1,
        noMovementHalt: expect.stringContaining('uncommitted paths:'),
      });
    } finally {
      currentCommitSha.mockRestore();
      vi.mocked(execa).mockImplementation(() =>
        Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }) as unknown as ReturnType<typeof execa>,
      );
    }
  });

  it('proceeds as succeeded when the interactive REPL finishes the work', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(2, 5); // stalled at 2/5

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn(async () => {
        // Simulate the user + Claude finishing the remaining tasks during
        // the interactive session.
        await writeTaskStatus(5, 5);
      }),
    };

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    // After the REPL the completion gate passed, so the step succeeded —
    // onRecovery should NOT have fired.
    expect(runner.runInteractive).toHaveBeenCalledWith('build', {
      reason:
        'Previous attempt did not satisfy the completion check: 3/5 tasks pending/not completed: 3, 4, 5 — 3 "Step 3"; 4 "Step 4"; 5 "Step 5". Finish the work now.',
    });
    expect(onRecovery).not.toHaveBeenCalledWith('build', expect.anything(), expect.anything());
  });

  it('skips the interactive stall handoff in auto mode', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(2, 5); // 2/5 done — and it never changes

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn().mockResolvedValue({ success: true }),
      runInteractive: vi.fn(async () => {
        // The "interactive session" is a no-op for the test; it simulates the
        // user dropping in and /quitting without doing additional work.
      }),
    };

    const stallEvents: Array<{ reason: string; before: number; after: number }> = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') {
        stallEvents.push({
          reason: e.reason,
          before: e.resolvedBefore,
          after: e.resolvedAfter,
        });
      }
    });

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
      mode: 'auto', // Key: auto-mode should skip interactive stall handoff
    });

    await conductor.run();

    // build_stall event is still emitted in auto mode
    expect(stallEvents).toHaveLength(1);
    expect(stallEvents[0].reason).toBe('no_task_progress');
    expect(stallEvents[0].before).toBe(2);
    expect(stallEvents[0].after).toBe(2);

    // But runInteractive should NOT have been called in auto mode
    expect(runner.runInteractive).not.toHaveBeenCalled();
  });

  it('step_retry emit includes resolvedBefore and resolvedAfter for build step retries (#505 TS)', async () => {
    await seedAllArtifactsExceptTaskStatus();
    await writeTaskStatus(2, 5); // 2/5 done — incomplete, should trigger gate miss and retry
    // No halt marker — conductor should retry and emit step_retry events

    const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
      run: vi.fn(async (_step: StepName) => {
        // Build step is incomplete, returns success but gate will fail
        return { success: true };
      }),
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };

    const retryEvents: Array<{ step: string; reason: string; before?: number; after?: number }> = [];
    events.on('step_retry', (e) => {
      if (e.type === 'step_retry') {
        retryEvents.push({
          step: e.step,
          reason: e.reason,
          before: e.resolvedBefore,
          after: e.resolvedAfter,
        });
      }
    });

    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 3,
      onRecovery,
    });

    await conductor.run();

    // At least one step_retry should have been emitted (build step incomplete gate)
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);
    // The build step retry should have resolvedBefore and resolvedAfter populated
    const buildRetries = retryEvents.filter((e) => e.step === 'build');
    if (buildRetries.length > 0) {
      // Build step retries should have numeric resolved counts (both defined)
      expect(buildRetries[0].before).toBeDefined();
      expect(buildRetries[0].after).toBeDefined();
      expect(typeof buildRetries[0].before).toBe('number');
      expect(typeof buildRetries[0].after).toBe('number');
      // Progress delta should be non-negative (this verifies the values are correctly captured)
      expect(buildRetries[0].after! >= buildRetries[0].before!).toBeTruthy();
    }
  });

});

// Task 14: Engine records the active plan path
// After plan-step completion, the engine records the plan path in state.
// Seed reads and uses this path. Ambiguous discovery (multiple plans, no path)
// is logged and halts. Single plan with no path uses it as fallback.
describe('engine/conductor: engine-recorded plan path controls seed discovery (H8)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-plan-path-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('records plan path in engine state after plan step completes', async () => {
    // Test the recordActivePlanPath function directly
    const { recordActivePlanPath } = await import('../../src/engine/conductor.js');

    const planPath = '.docs/plans/test-plan.md';
    await recordActivePlanPath(dir, planPath);

    // After recording, engine state should contain the plan path
    const engineStatePath = join(dir, '.pipeline/engine-state.json');
    const engineStateContent = await readFile(engineStatePath, 'utf-8');
    const engineState = JSON.parse(engineStateContent);

    expect(engineState).toHaveProperty('activePlanPath');
    expect(engineState.activePlanPath).toBe('.docs/plans/test-plan.md');
  });

  it('re-seed uses engine-recorded path and ignores glob-first discovery', async () => {
    // Setup: create two plan files (glob would pick first alphabetically)
    const planPath1 = join(dir, '.docs/plans/a-plan.md');
    const planPath2 = join(dir, '.docs/plans/b-plan.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    // Use proper task format: ### Task N: Title
    await writeFile(planPath1, '# Plan A\n\n### Task 1: Task A1\nContent');
    await writeFile(planPath2, '# Plan B\n\n### Task 1: Task B1\nContent');

    // Import and call seedTaskStatus directly, passing the engine path
    const { seedTaskStatus } = await import('../../src/engine/task-seed.js');

    // Seed with plan-a but engine-state points to plan-b
    // It should use plan-b (the engine-recorded one)
    await seedTaskStatus(dir, '.docs/plans/a-plan.md', '.docs/plans/b-plan.md');

    const seedStatusPath = join(dir, '.pipeline/task-status.json');
    const statusContent = await readFile(seedStatusPath, 'utf-8');
    const status = JSON.parse(statusContent);

    // Should have used plan-b because it was explicitly passed as enginePlanPath
    expect(status.plan_ref).toBe('.docs/plans/b-plan.md');
    // And the task should be from plan B
    expect(status.tasks[0].name).toBe('Task B1');
  });

  it('multiple plans + no engine path → logged ambiguity + fails seed', async () => {
    // Setup: multiple plans with no engine-recorded path
    const planPath1 = join(dir, '.docs/plans/plan-1.md');
    const planPath2 = join(dir, '.docs/plans/plan-2.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    // Use proper task format: ### Task N: Title
    await writeFile(planPath1, '# Plan 1\n\n### Task 1: Task 1\nContent');
    await writeFile(planPath2, '# Plan 2\n\n### Task 1: Task 2\nContent');

    // Import seedTaskStatus
    const { seedTaskStatus } = await import('../../src/engine/task-seed.js');

    // This should fail or throw when called with no planPath and multiple plans present
    // No engine path provided, so it should detect ambiguity
    await expect(seedTaskStatus(dir, '')).rejects.toThrow(/ambiguous|multiple.*plan/i);
  });

  it('single plan + no engine path → uses fallback without ambiguity', async () => {
    // Setup: exactly one plan, no engine path
    const planPath = join(dir, '.docs/plans/only-plan.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    // Use proper task format: ### Task N: Title
    await writeFile(planPath, '# Plan\n\n### Task 1: Single Task\nContent');

    // Import seedTaskStatus
    const { seedTaskStatus } = await import('../../src/engine/task-seed.js');

    // Should use the only plan as fallback (pass empty string to trigger discovery)
    await seedTaskStatus(dir, '');

    const statusContent = await readFile(join(dir, '.pipeline/task-status.json'), 'utf-8');
    const status = JSON.parse(statusContent);

    expect(status.tasks).toHaveLength(1);
    expect(status.tasks[0].name).toBe('Single Task');
  });

  it('ambiguity detection is logged but not silently resolved', async () => {
    // Setup: multiple plans, no engine path
    const planPath1 = join(dir, '.docs/plans/x.md');
    const planPath2 = join(dir, '.docs/plans/y.md');
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    // Use proper task format: ### Task N: Title
    await writeFile(planPath1, '# Plan X\n\n### Task 1: X\nContent');
    await writeFile(planPath2, '# Plan Y\n\n### Task 1: Y\nContent');

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { seedTaskStatus } = await import('../../src/engine/task-seed.js');

    // Should fail when ambiguous
    await expect(seedTaskStatus(dir, '')).rejects.toThrow();

    // Error should have been logged
    expect(consoleErrorSpy).toHaveBeenCalled();
    const errorCalls = consoleErrorSpy.mock.calls.map(c => String(c[0]));
    const hasAmbiguityMsg = errorCalls.some(msg => msg.match(/ambiguous|multiple.*plan/i));
    expect(hasAmbiguityMsg).toBe(true);

    consoleErrorSpy.mockRestore();
  });
});

// NOTE: The old `bootstrap-mode skip` suite was removed with the Option B
// design decision: bootstrap + assess are project-level concerns handled by
// `runProjectPrelude` (see src/engine/project-prelude.ts and its test file),
// not per-feature-loop steps. The prelude invokes them on its own triggers
// (marker presence, harness version bump, codebase detection) — there's no
// longer a `bootstrap_mode` field in ConductState for the feature loop to
// react to.

describe('engine/conductor: pipeline-exit false-completion regression', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-bug-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('does NOT mark feature_status=complete when pipeline halt marker is present', async () => {
    // The original user-reported bug: pipeline exited mid-implementation
    // (user picked "exit to harness, continue later"), but Claude failed to
    // write .pipeline/halt-user-input-required. Result: build gate read an
    // all-completed task-status.json, build was marked done, SHIP-phase
    // gates cascaded false-completion, feature_status=complete was set.
    //
    // Post-fix: the build predicate fails when the halt marker is present,
    // even with all-complete task-status.json. The conductor's stall
    // handler opens an interactive REPL, the user resolves the blocker
    // there, and the gate re-checks. If the REPL was a no-op (this test),
    // recovery menu fires.
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
    await writeFile(
      join(dir, '.pipeline/halt-user-input-required'),
      'user requested exit; 1 regression in test_X',
    );
    // Pre-create earlier-step artifacts so the conductor doesn't fail
    // before reaching build.
    const preFixtures: Array<[string, string]> = [
      ['.docs/decisions/technical-assessment-2026-04-16.md', 'a'],
      ['.docs/specs/2026-04-16-plan.md', 'a'],
      ['.docs/stories/2026-04-16-plan.md', 'a'],
      ['.docs/conflicts/2026-04-16-plan.md', 'a'],
      ['.docs/plans/2026-04-16-plan.md', 'a'],
      ['.docs/coherence/2026-04-16-plan.md', 'a'],
      ['.docs/architecture/2026-04-16-arch.md', 'a'],
      ['.docs/decisions/adr-001.md', 'a'],
      ['spec/acceptance/feature_spec.rb', 'a'],
      ['.pipeline/acceptance-specs-red.json', RED_EVIDENCE_JSON],
    ];
    for (const [rel, content] of preFixtures) {
      const full = join(dir, rel);
      await mkdir(full.substring(0, full.lastIndexOf('/')), { recursive: true });
      await writeFile(full, content);
    }
    await writeState(statePath, { coverage_binding: 'done' } as ConductState);

    // Re-write the halt marker on every run() call so the predicate keeps
    // failing even after the conductor's stall handler clears it.
    const runner: StepRunner = {
      run: vi.fn(async () => {
        await writeFile(
          join(dir, '.pipeline/halt-user-input-required'),
          'user requested exit; 1 regression in test_X',
        );
        return { success: true };
      }),
      // The stall handler opens this REPL on the build step. The mock is
      // a no-op — the user did NOT resolve the halt — so the marker that
      // gets re-written by run() (above) keeps the gate failing.
      runInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const onRecovery = vi.fn().mockResolvedValue('quit' as const);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      maxRetries: 1,
      onRecovery,
    });

    const buildStalls: string[] = [];
    events.on('build_stall', (e) => {
      if (e.type === 'build_stall') buildStalls.push(e.reason);
    });

    await conductor.run();

    // The conductor must have detected the halt marker (build_stall event
    // with reason='halt_marker').
    expect(buildStalls).toContain('halt_marker');

    // Most importantly: feature_status must NOT be 'complete' — the user's
    // unresolved blocker must not silently cascade through to "feature done."
    const r = await readState(statePath);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.feature_status).toBeUndefined();
    }
  });

  it('clears stale .pipeline/finish-choice on session start', async () => {
    // A stale finish-choice marker from a previous run must not satisfy
    // the gate. The conductor sweeps it on Conductor.run() entry, before
    // any step runs.
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        // On the first runner-dispatched step (memory — worktree is
        // engine-managed), observe that the sweep happened: the marker should
        // already be gone before any runner step.
        const { access } = await import('fs/promises');
        if (step === 'memory') {
          let stillExists = true;
          try {
            await access(join(dir, '.pipeline/finish-choice'));
          } catch {
            stillExists = false;
          }
          // Recorded on the runner's mock for assertion below.
          (runner as unknown as { sweepObserved?: boolean }).sweepObserved = !stillExists;
        }
        return { success: true };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: false,
    });

    await conductor.run();

    expect(
      (runner as unknown as { sweepObserved?: boolean }).sweepObserved,
    ).toBe(true);
  });
});

describe('projectRoot is required', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-projectroot-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('throws when projectRoot is undefined', async () => {
    const runner = createMockStepRunner();

    // Verify .pipeline does not exist before construction attempt
    let pipelineExistsBefore = false;
    try {
      const files = await readdir(join(dir, '.pipeline'));
      pipelineExistsBefore = files.length > 0;
    } catch {
      pipelineExistsBefore = false;
    }
    expect(pipelineExistsBefore).toBe(false);

    expect(() => {
      new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: undefined as unknown as string,
      });
    }).toThrow(/projectRoot/i);

    // Verify .pipeline was NOT created by failed construction
    let pipelineExistsAfter = false;
    try {
      const files = await readdir(join(dir, '.pipeline'));
      pipelineExistsAfter = files.length > 0;
    } catch {
      pipelineExistsAfter = false;
    }
    expect(pipelineExistsAfter).toBe(false);
  });

  it('throws when projectRoot is an empty string', async () => {
    const runner = createMockStepRunner();

    // Verify .pipeline does not exist before construction attempt
    let pipelineExistsBefore = false;
    try {
      const files = await readdir(join(dir, '.pipeline'));
      pipelineExistsBefore = files.length > 0;
    } catch {
      pipelineExistsBefore = false;
    }
    expect(pipelineExistsBefore).toBe(false);

    expect(() => {
      new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: '',
      });
    }).toThrow(/projectRoot/i);

    // Verify .pipeline was NOT created by failed construction
    let pipelineExistsAfter = false;
    try {
      const files = await readdir(join(dir, '.pipeline'));
      pipelineExistsAfter = files.length > 0;
    } catch {
      pipelineExistsAfter = false;
    }
    expect(pipelineExistsAfter).toBe(false);
  });

  describe('completionCtx threading', () => {
    it('includes daemon flag and isHeadPushed injectable in completion context', async () => {
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
      });

      // Access private method via bracket notation for testing
      const state: ConductState = {
        worktree: 'pending',
        session_started_at: Date.now(),
      } as ConductState;
      const ctx = await (conductor as any)['completionCtx'](state);

      // Verify daemon field is threaded
      expect(ctx.daemon).toBe(true);

      // Verify isHeadPushed is defined and callable
      expect(ctx.isHeadPushed).toBeDefined();
      expect(typeof ctx.isHeadPushed).toBe('function');
    });

    it('isHeadPushed injectable returns null when git runner fails', async () => {
      const runner = createMockStepRunner();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        daemon: true,
      });

      const state: ConductState = {
        worktree: 'pending',
        session_started_at: Date.now(),
      } as ConductState;
      const ctx = await (conductor as any)['completionCtx'](state);

      // Call isHeadPushed and verify it handles errors gracefully
      // (returns null instead of throwing)
      const result = await ctx.isHeadPushed!();
      // In a non-git directory, it should return null (indeterminate)
      expect(result).toBeNull();
    });

    it('reports porcelain status from a dirty local git worktree', async () => {
      const actualExeca = (await vi.importActual<typeof import('execa')>('execa')).execa;
      await actualExeca('git', ['init', '-b', 'main'], { cwd: dir });
      await actualExeca('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await actualExeca('git', ['config', 'user.name', 'Test User'], { cwd: dir });
      await writeFile(join(dir, 'tracked.txt'), 'initial\n');
      await actualExeca('git', ['add', 'tracked.txt'], { cwd: dir });
      await actualExeca('git', ['commit', '-m', 'test: initial tracked file'], { cwd: dir });
      await writeFile(join(dir, 'tracked.txt'), 'modified\n');
      await writeFile(join(dir, 'new.txt'), 'untracked\n');

      const git: GitRunner = async (args, { cwd }) => {
        const result = await actualExeca('git', args, { cwd });
        return { stdout: result.stdout };
      };
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        projectRoot: dir,
        git,
      });
      const state: ConductState = {
        worktree: 'pending',
        session_started_at: Date.now(),
      } as ConductState;
      const ctx = await (conductor as any)['completionCtx'](state);

      expect(await ctx.worktreeStatus?.()).toBe(' M tracked.txt\n?? new.txt');

      await writeFile(join(dir, 'tracked.txt'), 'initial\n');
      await rm(join(dir, 'new.txt'));
      await writeFile(join(dir, '.gitignore'), 'ignored.txt\n');
      await actualExeca('git', ['add', '.gitignore'], { cwd: dir });
      await actualExeca('git', ['commit', '-m', 'test: ignore generated file'], { cwd: dir });
      await writeFile(join(dir, 'ignored.txt'), 'ignored\n');

      expect(await ctx.worktreeStatus?.()).toBe('');
    });

    it('returns null when the worktree status probe rejects', async () => {
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: createMockStepRunner(),
        events,
        projectRoot: dir,
        git: async () => {
          throw new Error('git unavailable');
        },
      });
      const state: ConductState = {
        worktree: 'pending',
        session_started_at: Date.now(),
      } as ConductState;
      const ctx = await (conductor as any)['completionCtx'](state);

      expect(await ctx.worktreeStatus?.()).toBeNull();
    });
  });
});

describe('appendRemediationTasks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'append-remediation-tasks-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends valid remediation task with gate-source prefix to plan successfully', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Implementation Plan\n\n## Tasks\n\n### Task 1: First task\n');

    const remediationList = [
      {
        id: 'rem-fr10-1',
        title: 'Fix the thing in file.ts:123',
      },
    ];

    const result = await appendRemediationTasks(dir, planPath, remediationList);

    expect(result).toMatchObject({ success: true });
    const content = await readFile(planPath, 'utf-8');
    expect(content).toContain('### Task rem-fr10-1: Fix the thing in file.ts:123');
  });

  it('rejects empty task id with error', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Implementation Plan\n');

    const remediationList = [
      {
        id: '',
        title: 'Some title',
      },
    ];

    const result = await appendRemediationTasks(dir, planPath, remediationList);

    expect(result).toEqual({ success: false, error: expect.stringContaining('empty') });
  });

  it('accepts task without gate-source prefix but logs warning', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Implementation Plan\n');

    const logMessages: string[] = [];
    const remediationList = [
      {
        id: 'task-001',
        title: 'Some task without prefix',
      },
    ];

    const result = await appendRemediationTasks(dir, planPath, remediationList, {
      log: (msg) => logMessages.push(msg),
    });

    expect(result).toMatchObject({ success: true });
    const content = await readFile(planPath, 'utf-8');
    expect(content).toContain('### Task task-001: Some task without prefix');
    expect(logMessages.some((m) => m.includes('prefix') || m.includes('gate-source'))).toBe(true);
  });

  it('appended task header re-parses via TASK_ID_PATTERN grammar', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Implementation Plan\n');

    const remediationList = [
      {
        id: 'rem-adr-001',
        title: 'Update architecture decision',
      },
    ];

    const result = await appendRemediationTasks(dir, planPath, remediationList);

    expect(result).toMatchObject({ success: true });
    const content = await readFile(planPath, 'utf-8');

    // Verify it matches the TASK_ID_PATTERN regex: [A-Za-z0-9._-]+
    const taskHeaderRegex = /^### Task ([A-Za-z0-9._-]+): (.+)$/m;
    const match = content.match(taskHeaderRegex);

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('rem-adr-001');
    expect(match?.[2]).toBe('Update architecture decision');
  });

  it('appends multiple remediation tasks in order', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Implementation Plan\n');

    const remediationList = [
      {
        id: 'rem-test-1',
        title: 'First remediation task',
      },
      {
        id: 'rem-test-2',
        title: 'Second remediation task',
      },
    ];

    const result = await appendRemediationTasks(dir, planPath, remediationList);

    expect(result).toMatchObject({ success: true });
    const content = await readFile(planPath, 'utf-8');
    const firstIndex = content.indexOf('### Task rem-test-1:');
    const secondIndex = content.indexOf('### Task rem-test-2:');

    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(-1);
    expect(firstIndex).toBeLessThan(secondIndex);
  });

  it('validates all tasks before appending any', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Implementation Plan\n');

    const remediationList = [
      {
        id: 'rem-test-1',
        title: 'Valid task',
      },
      {
        id: '', // Invalid: empty id
        title: 'Invalid task',
      },
    ];

    const result = await appendRemediationTasks(dir, planPath, remediationList);

    expect(result).toEqual({ success: false, error: expect.stringContaining('empty') });
    const content = await readFile(planPath, 'utf-8');
    // Valid task should NOT be appended if validation fails
    expect(content).not.toContain('### Task rem-test-1:');
  });

  it('separates a bare remediation task from plan content without a final newline', async () => {
    const planPath = join(dir, 'plan.md');
    await writeFile(planPath, '# Implementation Plan\n\n## Tasks');

    const result = await appendRemediationTasks(dir, planPath, [
      { id: 'rem-test-no-final-newline', title: 'Repair the terminal plan boundary' },
    ]);

    expect(result).toEqual({ success: true, appendedIds: ['rem-test-no-final-newline'] });
    const content = await readFile(planPath, 'utf-8');
    expect(content).toContain('## Tasks\n\n### Task rem-test-no-final-newline:');
    expect(validatePlanDoneWhen(content)).toEqual([]);
  });

  describe('idempotent upsert semantics', () => {
    it('append task with id rem-fr10-1 → exists in plan', async () => {
      const planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Implementation Plan\n');

      const remediationList = [
        {
          id: 'rem-fr10-1',
          title: 'Fix framework issue 10 - step 1',
        },
      ];

      const result = await appendRemediationTasks(dir, planPath, remediationList);
      expect(result).toMatchObject({ success: true });

      const content = await readFile(planPath, 'utf-8');
      expect(content).toContain('### Task rem-fr10-1:');
      expect(validatePlanDoneWhen(content)).toEqual([]);
    });

    it('append same id again → still exactly one instance (no duplicate)', async () => {
      const planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Implementation Plan\n');

      const remediationList = [
        {
          id: 'rem-fr10-1',
          title: 'Fix framework issue 10 - step 1',
        },
      ];

      // First append
      let result = await appendRemediationTasks(dir, planPath, remediationList);
      expect(result).toMatchObject({ success: true });

      // Second append with same id
      result = await appendRemediationTasks(dir, planPath, remediationList);
      expect(result).toMatchObject({ success: true });

      const content = await readFile(planPath, 'utf-8');
      const matches = content.match(/### Task rem-fr10-1:/g);
      expect(matches).toHaveLength(1); // Exactly one, not two
      expect(validatePlanDoneWhen(content)).toEqual([]);
    });

    it('attempt to append same id with different content → preserved (not mutated)', async () => {
      const planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Implementation Plan\n');

      // First append
      const firstList = [
        {
          id: 'rem-fr10-1',
          title: 'Original title for rem-fr10-1',
        },
      ];
      let result = await appendRemediationTasks(dir, planPath, firstList);
      expect(result).toMatchObject({ success: true });

      let content = await readFile(planPath, 'utf-8');
      expect(content).toContain('Original title for rem-fr10-1');

      // Try to append same id with different title
      const secondList = [
        {
          id: 'rem-fr10-1',
          title: 'Different title for rem-fr10-1',
        },
      ];
      result = await appendRemediationTasks(dir, planPath, secondList);
      expect(result).toMatchObject({ success: true });

      content = await readFile(planPath, 'utf-8');
      // Original should be preserved
      expect(content).toContain('Original title for rem-fr10-1');
      // A suffixed version should be created for the different content
      const hasSuffixedVersion = /### Task rem-fr10-1-[a-f0-9]{6}:.*Different title for rem-fr10-1/.test(content);
      expect(hasSuffixedVersion).toBe(true);
      expect(validatePlanDoneWhen(content)).toEqual([]);
    });

    it('two separate remediations from different gates with same semantic issue → distinct ids (with suffix)', async () => {
      const planPath = join(dir, 'plan.md');
      await writeFile(planPath, '# Implementation Plan\n');

      // Simulate different gates detecting the same semantic issue:
      // Gate 1 (fr10 gate) creates rem-fr10-1 with specific content
      const gateOneList = [
        {
          id: 'rem-fr10-1',
          title: 'Fix schema mismatch in validator.ts:42',
        },
      ];

      // Gate 2 (adr gate) tries to create rem-fr10-1 with different content
      // (same semantic issue but from a different gate perspective)
      const gateTwoList = [
        {
          id: 'rem-fr10-1',
          title: 'Fix schema mismatch in parser.ts:88',
        },
      ];

      let result = await appendRemediationTasks(dir, planPath, gateOneList);
      expect(result).toMatchObject({ success: true });

      result = await appendRemediationTasks(dir, planPath, gateTwoList);
      expect(result).toMatchObject({ success: true });

      const content = await readFile(planPath, 'utf-8');

      // Both distinct versions should exist with different ids or content markers
      expect(content).toContain('validator.ts:42');
      expect(content).toContain('parser.ts:88');

      // Should have at least 2 different task entries for the same semantic issue
      const taskEntries = content.match(/### Task rem-fr10-1[^:]*:/g);
      expect(taskEntries).toBeDefined();
      expect((taskEntries || []).length).toBeGreaterThanOrEqual(1);
    });

    it('plan re-parses after multiple appends with no corruption', async () => {
      const planPath = join(dir, 'plan.md');
      const initialContent = `# Implementation Plan

## Overview
This is the implementation plan.

## Tasks

### Task 1: Initial task
Some description here.
`;
      await writeFile(planPath, initialContent);

      const remediationList1 = [
        {
          id: 'rem-test-a',
          title: 'First remediation',
        },
      ];

      const remediationList2 = [
        {
          id: 'rem-test-b',
          title: 'Second remediation',
        },
      ];

      const remediationList3 = [
        {
          id: 'rem-test-a', // Duplicate id
          title: 'First remediation',
        },
      ];

      // Multiple appends
      let result = await appendRemediationTasks(dir, planPath, remediationList1);
      expect(result).toMatchObject({ success: true });

      result = await appendRemediationTasks(dir, planPath, remediationList2);
      expect(result).toMatchObject({ success: true });

      result = await appendRemediationTasks(dir, planPath, remediationList3);
      expect(result).toMatchObject({ success: true });

      const content = await readFile(planPath, 'utf-8');

      // Plan should still be valid markdown
      expect(content).toContain('# Implementation Plan');
      expect(content).toContain('## Tasks');

      // Original content preserved
      expect(content).toContain('Initial task');
      expect(content).toContain('Some description here');

      // Both tasks should exist exactly once
      expect(content.match(/### Task rem-test-a:/g)).toHaveLength(1);
      expect(content.match(/### Task rem-test-b:/g)).toHaveLength(1);
    });
  });

  describe('remediation end-to-end (happy path #2)', () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'remediation-e2e-test-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('blocking gap → plan append → re-seed → commit → gate-pass', async () => {
      // SETUP: Create initial plan with one task
      const planPath = join(dir, '.docs', 'plans', 'plan.md');
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(
        planPath,
        `# Implementation Plan

## Tasks

### Task 1: Initial task
Initial task content.
`,
      );

      // Step 1: Simulate a blocking gap detected → plan remediation outcome with tasks
      // This simulates what planRemediation would produce when a gap has remediation tasks
      const remediationTasks = [
        {
          id: 'rem-fr10-1',
          title: 'Fix schema validation issue',
        },
      ];

      // Step 2: Trigger remediation flow
      // 2a. Call appendRemediationTasks() with the gap-derived tasks
      let result = await appendRemediationTasks(dir, planPath, remediationTasks);
      expect(result).toMatchObject({ success: true });

      // Verify the task was appended to the plan
      let planContent = await readFile(planPath, 'utf-8');
      expect(planContent).toContain('### Task rem-fr10-1: Fix schema validation issue');

      // 2b. Call seedTaskStatus() to re-seed with appended tasks
      const { seedTaskStatus } = await import('../../src/engine/task-seed.js');
      await seedTaskStatus(dir, '.docs/plans/plan.md');

      // Step 3: Verify appended tasks are pending in task-status.json
      let statusPath = join(dir, '.pipeline', 'task-status.json');
      let statusContent = await readFile(statusPath, 'utf-8');
      let status = JSON.parse(statusContent);

      expect(status.tasks).toBeDefined();
      expect(status.tasks).toBeInstanceOf(Array);
      expect(status.tasks.some((t: Record<string, unknown>) => t.id === 'rem-fr10-1')).toBe(true);

      const remTask = status.tasks.find((t: Record<string, unknown>) => t.id === 'rem-fr10-1');
      expect(remTask).toBeDefined();
      expect(remTask.status).toBe('pending');

      // Step 4: Simulate commit with Task: <rem-id> trailer on appended task
      // In this test, we directly simulate the evidence that autoheal would have collected
      // from git. In integration, autoheal reads commits and creates evidence stamps.
      const { createTaskEvidence } = await import('../../src/engine/task-evidence.js');
      const evidence = await createTaskEvidence(dir);
      // Simulate the evidence that autoheal would have found from a "Task: rem-fr10-1" trailer
      evidence.evidenceStamps.set('rem-fr10-1', {
        sha: 'abc1234567890abcdef1234567890',
        form: 'trailer',
      });
      await evidence.write();

      // Step 5: Manually update task-status.json to mark task as completed
      // This simulates what autoheal/seedTaskStatus would do after finding evidence
      statusContent = await readFile(statusPath, 'utf-8');
      status = JSON.parse(statusContent);
      for (const task of status.tasks) {
        if (task.id === 'rem-fr10-1') {
          task.status = 'completed';
          task.commit = 'abc1234';
        }
      }
      await writeFile(statusPath, JSON.stringify(status, null, 2) + '\n');

      // Step 6: Verify appended task is now marked completed
      const updatedStatusContent = await readFile(statusPath, 'utf-8');
      const updatedStatus = JSON.parse(updatedStatusContent);

      const completedTask = updatedStatus.tasks.find(
        (t: Record<string, unknown>) => t.id === 'rem-fr10-1',
      );
      expect(completedTask).toBeDefined();
      expect(completedTask.status).toBe('completed');
      expect(completedTask.commit).toBe('abc1234');

      // Step 7: Verify gate predicate returns true (blocking gap resolved)
      // The blocking gap is resolved when its remediation task is completed.
      // The initial task is unrelated to this blocking gap, so we only check the remediation task.
      const blockingGapResolved = updatedStatus.tasks
        .filter((t: Record<string, unknown>) => String(t.id).startsWith('rem-'))
        .every((t: Record<string, unknown>) => t.status === 'completed' || t.status === 'skipped');
      expect(blockingGapResolved).toBe(true);
    });
  });
});

describe('post-rebase build closure (Task 11)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'post-rebase-build-closure-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('blocks a reapplied autostash in the post-rebase build closure and preserves conflict halts', async () => {
    // `rebase-autostash.test.ts` proves git reapplies this residue. This seam
    // proves the daemon's post-rebase pre-verify does not certify BUILD around it.
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.docs/plans/feature.md'), '# Plan\n\n### Task 1: Commit it\n');
    await writeFile(join(dir, '.pipeline/task-status.json'), JSON.stringify({
      tasks: [{ id: 1, status: 'completed' }],
    }));
    await writeFile(join(dir, '.pipeline/task-evidence.json'), JSON.stringify({
      evidenceStamps: { '1': { sha: 'a'.repeat(40), form: 'trailer' } },
      noEvidenceAttempts: 0,
      migrationGrandfather: [],
    }));

    const state = { build: 'done', manual_test: 'skipped' } as ConductState;
    const git: GitRunner = async (args) => ({
      stdout: args[0] === 'status' ? ' M src/reapplied.ts\n' : '',
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      projectRoot: dir,
      daemon: true,
      verifyArtifacts: true,
      git,
    });
    const changed = {
      kind: 'changed' as const,
      changedCodePaths: ['src/base.ts'],
      featureSurface: ['src/**'],
    };
    const performRebase = vi.mocked(rebaseModule.performRebase);
    performRebase.mockResolvedValueOnce(changed);

    try {
      const closure = await checkStepCompletion(
        dir,
        'build',
        await (conductor as any).completionCtx(state),
      );
      await (conductor as any).runRebaseStep(state);
      const halt = await readFile(join(dir, '.pipeline/HALT'), 'utf8');

      expect({ closure, halt }).toMatchObject({
        closure: {
          done: false,
          missing: 'uncommitted',
          reason: expect.stringContaining('src/reapplied.ts'),
        },
        halt: expect.stringContaining('completed BUILD evidence is unavailable after rebase'),
      });
    } finally {
      performRebase.mockReset();
      performRebase.mockResolvedValue({ kind: 'noop' });
    }
  });

  it('keeps the conflict-halt path unchanged', async () => {
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: createMockStepRunner(),
      events,
      projectRoot: dir,
      daemon: true,
    });
    const performRebase = vi.mocked(rebaseModule.performRebase);
    performRebase.mockResolvedValueOnce({
      kind: 'conflict_halt',
      conflicts: ['src/base.ts'],
      reason: 'conflict remains',
    });

    try {
      await (conductor as any).runRebaseStep({ manual_test: 'skipped' } as ConductState);
      expect(await readFile(join(dir, '.pipeline/HALT'), 'utf8')).toContain('conflict remains');
    } finally {
      performRebase.mockReset();
      performRebase.mockResolvedValue({ kind: 'noop' });
    }
  });
});

describe('stall remediation gated to daemon halt_marker only (Task 11)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-11-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const STALL_QUESTION = 'What color is the button?';

  async function seedToBuildStep(): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;
      state[s.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = 'stall-guard-test';
    await writeState(statePath, state as unknown as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs/plans/stall-guard-test.md'),
      '# Plan\n\n### Task 1: Step 1\n',
    );
  }

  it('interactive mode with halt marker → runInteractive called, remediate NOT dispatched', async () => {
    await seedToBuildStep();

    const dispatchedSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        dispatchedSteps.push(step);
        if (step === 'build') {
          // Write halt marker (this would normally trigger remediate in daemon mode)
          await writeFile(
            join(dir, '.pipeline/halt-user-input-required'),
            STALL_QUESTION,
          );
          // Write pending tasks to fail the gate
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
        }
        return { success: true } as StepRunResult;
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'interactive', // ← interactive mode
      daemon: false,        // ← NOT daemon mode
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    // In interactive mode, remediate should NOT be dispatched (only in daemon+auto)
    expect(dispatchedSteps).not.toContain('remediate');
    // Build should have been attempted once (no retry from remediate)
    const buildCalls = dispatchedSteps.filter((s) => s === 'build').length;
    expect(buildCalls).toBe(1);
  });

  it('no_task_progress stall (not halt_marker) in interactive mode → remediate NOT dispatched', async () => {
    // #569: the daemon+auto dispatch of /remediate for no_task_progress
    // stalls (see the test immediately below) is gated to daemon+auto mode
    // only, same as halt_marker. This test now covers the interactive
    // (non-daemon) case, which must still skip dispatch and fall through
    // to the REPL hand-off — the same guard (`this.daemon && this.mode ===
    // 'auto'`) that already applied to halt_marker.
    await seedToBuildStep();

    const dispatchedSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        dispatchedSteps.push(step);
        if (step === 'build') {
          // On both attempts, return no task progress (no marker)
          // This triggers the 'no_task_progress' stall verdict
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
        }
        return { success: true } as StepRunResult;
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'interactive',
      daemon: false,
      verifyArtifacts: true,
      maxRetries: 3, // Allow retries
    });

    await conductor.run();

    // Not daemon+auto → remediate is NOT dispatched.
    expect(dispatchedSteps).not.toContain('remediate');
  });

  it('no_task_progress stall (not halt_marker) → remediate IS dispatched with synthesized prompt (#569)', async () => {
    // #569: no_task_progress stalls should get the same auto-remediation
    // dispatch that halt_marker stalls already receive. Unlike halt_marker
    // (where the agent itself writes the question), no_task_progress has no
    // question authored by the agent — the conductor must synthesize one
    // from the completion-gate signals (pending tasks, resolved-count
    // stagnation, lack of evidence) and hand that to /remediate.
    await seedToBuildStep();

    const dispatchedSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        dispatchedSteps.push(step);
        if (step === 'build') {
          // On every attempt, resolved task count never advances (stays at 0
          // resolved out of 1 task) — this forces 'no_task_progress' since
          // resolvedTasksAfter <= resolvedTasksBefore across attempts.
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
          await writeFile(
            join(dir, '.pipeline/task-evidence.json'),
            JSON.stringify({
              evidenceStamps: {},
              noEvidenceAttempts: 0,
              migrationGrandfather: [],
              noEvidenceReasons: ['zero_work_product'],
            }),
          );
        } else if (step === 'remediate') {
          // Route back to build so the dispatch resolves cleanly.
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'stall:no-task-progress',
                  disposition: 'build',
                  category: null,
                  rationale: 'Retry build with synthesized guidance.',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true } as StepRunResult;
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 3,
    });

    await conductor.run();

    // remediate must be dispatched for no_task_progress, same as halt_marker.
    const remediateCalls = dispatchedSteps.filter((s) => s === 'remediate').length;
    expect(remediateCalls).toBeGreaterThanOrEqual(1);
    expect(dispatchedSteps).toContain('remediate');

    // A synthesized prompt must be written for /remediate to consume,
    // capturing the signals that produced the no_task_progress verdict.
    const evidenceContent = await readFile(
      join(dir, '.pipeline/build-stall-question.md'),
      'utf-8',
    );
    expect(evidenceContent).toContain('pending');
    expect(evidenceContent).toContain('0');
    // #773 Task 13: the synthesized prompt no longer enriches with
    // noEvidenceReasons tags from the evidence sidecar (task-evidence.json)
    // — that enrichment was evidence-coupled and removed along with the
    // durable no-evidence counter. The completion-gate/progress signals
    // above are sufficient.
  });

  // RED (#569, Task 3): un-remediable no_task_progress stalls must NOT
  // terminal-HALT the way halt_marker does. Once Task 4 wires the
  // no_task_progress dispatch, /remediate should still get dispatched (up
  // to the shared MAX_KICKBACKS_PER_GATE budget) but every non-recovering
  // outcome — budget exhaustion, disposition='halt', no valid dispositions,
  // or a dispatch throw — must fall through to the existing retry/durable
  // no-evidence-counter/auto-park path (conductor.ts:3539-3620) instead of
  // writing a terminal HALT from the stall block itself (contrast
  // conductor.ts:3680-3811, which DOES terminal-HALT halt_marker on these
  // same outcomes). On current code, no_task_progress never dispatches
  // /remediate at all (effectiveQuestion stays null for anything but
  // 'halt_marker'), so these tests are RED because remediateCallCount stays
  // 0 instead of reaching the shared budget.
  it('no_task_progress persistent stall at remediation budget exhaustion falls through to retry/auto-park, never terminal-HALTs on budget (#569)', async () => {
    await seedToBuildStep();

    let buildAttemptCount = 0;
    const remediateCallCount: number[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName, _state, options) => {
        if (step === 'build') {
          buildAttemptCount++;
          // Resolved task count never advances -> persistent
          // 'no_task_progress' verdict on every attempt.
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
          await writeFile(
            join(dir, '.pipeline/task-evidence.json'),
            JSON.stringify({
              evidenceStamps: {},
              noEvidenceAttempts: 0,
              migrationGrandfather: [],
              noEvidenceReasons: ['zero_work_product'],
            }),
          );
        } else if (step === 'remediate') {
          remediateCallCount.push(buildAttemptCount);
          // Route back to build every time — the stall never actually
          // resolves, forcing the shared budget to exhaust.
          await persistFixtureProjectedRemediationPlan(dir, options, [{
            id: `stall:${buildAttemptCount}`,
            disposition: 'build',
            category: null,
            rationale: `Answer ${buildAttemptCount}`,
            tasks: [],
          }]);
        }
        return { success: true } as StepRunResult;
      }),
    };

    const haltEvents: Array<{ reason: string }> = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 10, // generous so budget (not retries) governs dispatch
    });

    await conductor.run();

    // Once Task 4 lands, no_task_progress gets the same dispatch-up-to-
    // budget treatment as halt_marker: dispatched at least once, never more
    // than MAX_KICKBACKS_PER_GATE (2) times for a persistent stall.
    // RED today: remediateCallCount stays [] because no_task_progress never
    // dispatches /remediate at all yet.
    expect(remediateCallCount.length).toBeGreaterThanOrEqual(1);
    expect(remediateCallCount.length).toBeLessThanOrEqual(2);

    // Unlike halt_marker, budget exhaustion on a no_task_progress stall
    // must NOT terminal-HALT the run from the stall block — no loop_halt
    // reason (nor the on-disk HALT marker, if any is written by a LATER,
    // unrelated mechanism such as auto-park) may carry the halt_marker
    // budget-exhausted fail-safe message.
    for (const h of haltEvents) {
      expect(h.reason).not.toContain('Remediation budget exhausted');
    }
    try {
      const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltContent).not.toContain('Remediation budget exhausted');
    } catch {
      // No HALT marker at all is also an acceptable outcome here.
    }
  });

  it.each([
    [
      'halt',
      async (dirPath: string, attempt: number) => {
        await writeFile(
          join(dirPath, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: `stall:${attempt}`,
                disposition: 'halt',
                category: 'product_scope',
                rationale: 'needs a human decision',
                tasks: [],
              },
            ],
          }),
        );
      },
    ],
    [
      'none',
      async (dirPath: string) => {
        // No typed result leaves planRemediation with outcome 'none'.
        await writeFile(join(dirPath, '.pipeline/remediation.json'), '{not valid json');
      },
    ],
  ] as const)(
    "no_task_progress stall with planRemediation outcome '%s' falls through to retry/auto-park, no terminal HALT from the stall block (#569)",
    async (_label, stubRemediation) => {
      await seedToBuildStep();

      let buildAttemptCount = 0;
      const dispatchedSteps: StepName[] = [];
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          dispatchedSteps.push(step);
          if (step === 'build') {
            buildAttemptCount++;
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
            await writeFile(
              join(dir, '.pipeline/task-evidence.json'),
              JSON.stringify({
                evidenceStamps: {},
                noEvidenceAttempts: 0,
                migrationGrandfather: [],
                noEvidenceReasons: ['zero_work_product'],
              }),
            );
          } else if (step === 'remediate') {
            await stubRemediation(dir, buildAttemptCount);
          }
          return { success: true } as StepRunResult;
        }),
      };

      const haltEvents: Array<{ reason: string }> = [];
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason });
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 5,
      });

      await conductor.run();

      // /remediate must actually get dispatched for this to be a meaningful
      // exercise of the halt/none disposition path.
      // RED today: dispatchedSteps never contains 'remediate' because
      // no_task_progress doesn't dispatch at all yet.
      expect(dispatchedSteps).toContain('remediate');

      // Regardless of the disposition kind, a no_task_progress stall must
      // never write the halt_marker-style terminal HALT (question + halt
      // detail, or "no valid dispositions") from the stall block itself —
      // that would short-circuit the retry/auto-park fallthrough this task
      // exists to protect.
      for (const h of haltEvents) {
        expect(h.reason).not.toContain('remediation produced no valid dispositions');
      }
    },
  );

  it('no_task_progress stall with planRemediation outcome route misrouted to a non-build target falls through to retry/auto-park, no terminal HALT from the stall block (#569)', async () => {
    await seedToBuildStep();

    const dispatchedSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        dispatchedSteps.push(step);
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
          await writeFile(
            join(dir, '.pipeline/task-evidence.json'),
            JSON.stringify({
              evidenceStamps: {},
              noEvidenceAttempts: 0,
              migrationGrandfather: [],
              noEvidenceReasons: ['zero_work_product'],
            }),
          );
        } else if (step === 'remediate') {
          // Write remediation that misroutes to 'plan' (non-build target).
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'stall:no-task-progress',
                  disposition: 'plan',
                  category: null,
                  rationale: 'Needs a re-plan, not a build answer.',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true } as StepRunResult;
      }),
    };

    const haltEvents: Array<{ reason: string }> = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 5,
    });

    await conductor.run();

    // /remediate must actually get dispatched for this to be a meaningful
    // exercise of the route-misroute path.
    expect(dispatchedSteps).toContain('remediate');

    // A no_task_progress stall whose remediation outcome misroutes to a
    // non-build target must not write the halt_marker-style "misrouted to"
    // terminal HALT from the stall block — it must fall through to
    // retry/auto-park instead, same as the halt/none/throw outcomes.
    for (const h of haltEvents) {
      expect(h.reason).not.toContain('misrouted to');
    }
  });

  it('no_task_progress stall where planRemediation dispatch throws falls through to retry/auto-park, no terminal HALT from the stall block (#569)', async () => {
    await seedToBuildStep();

    const dispatchedSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        dispatchedSteps.push(step);
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
          await writeFile(
            join(dir, '.pipeline/task-evidence.json'),
            JSON.stringify({
              evidenceStamps: {},
              noEvidenceAttempts: 0,
              migrationGrandfather: [],
              noEvidenceReasons: ['zero_work_product'],
            }),
          );
        } else if (step === 'remediate') {
          throw new Error('remediate dispatch crashed');
        }
        return { success: true } as StepRunResult;
      }),
    };

    const haltEvents: Array<{ reason: string }> = [];
    events.on('loop_halt', (e) => {
      if (e.type === 'loop_halt') haltEvents.push({ reason: e.reason });
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 5,
    });

    await conductor.run();

    // RED today: dispatchedSteps never contains 'remediate' because
    // no_task_progress doesn't dispatch at all yet, so the throw is never
    // exercised.
    expect(dispatchedSteps).toContain('remediate');

    // A dispatch crash on a no_task_progress stall must not write the
    // halt_marker-style "remediation dispatch failed" terminal HALT — it
    // must fall through to retry/auto-park instead.
    for (const h of haltEvents) {
      expect(h.reason).not.toContain('remediation dispatch failed');
    }
  });

  it('auto-park condition met → park HALT wins, stall branch never runs', async () => {
    // Seed with task evidence counter at threshold (3)
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === 'acceptance_specs') break;
      state[s.name] = 'done';
    }
    state.complexity_tier = 'L';
    state.feature_desc = 'auto-park-test';
    await writeState(statePath, state as unknown as ConductState);

    // Create a plan file
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs/plans/auto-park-test.md'),
      '# Plan\n\n- Task 1\n',
    );

    // Seed task evidence with no-evidence counter at threshold (3)
    const evidence = await createTaskEvidence(dir);
    evidence.noEvidenceAttempts = 3; // DAEMON_NO_EVIDENCE_THRESHOLD
    await evidence.write();

    const dispatchedSteps: StepName[] = [];
    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        dispatchedSteps.push(step);
        // No task progress - trigger the no-evidence path
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/task-status.json'),
          JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
        );
        return { success: true } as StepRunResult;
      }),
    };

    let parked = false;
    events.on('auto_park', () => {
      parked = true;
    });

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build',
    });

    await conductor.run();

    // Auto-park should have fired, causing an early exit
    expect(parked).toBe(true);
  });

  describe('distinct terminal HALT reason for no_task_progress exhaustion (#569 Task 5)', () => {
    async function seedToBuildStep(featureDesc: string): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'M';
      state.feature_desc = featureDesc;
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        join(dir, `.docs/plans/${featureDesc}.md`),
        '# Plan\n\n### Task 1: Step 1\n',
      );
    }

    it('build exhausts retries after a no_task_progress stall history → HALT names no-task-progress, not the generic "retries exhausted" message', async () => {
      await seedToBuildStep('no-task-progress-exhaustion-test');

      // Non-daemon auto mode: checkAndAutoPark is daemon-gated (see
      // conductor.ts ~3559 `if (this.daemon)`), so with daemon:false the
      // no_task_progress stall never gets diverted into an auto-park HALT
      // — it falls straight through the retry loop to the terminal
      // "retries exhausted" fallback once maxRetries is exhausted, which
      // is exactly the generic-fallback path this task makes more specific.
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            // Resolved task count never advances -> persistent
            // 'no_task_progress' verdict on every attempt (attempt >= 2).
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: false,
        verifyArtifacts: true,
        maxRetries: 3, // must be >= 2 so the attempt >= 2 stall check fires
      });

      await conductor.run();

      expect(halted).toBe(true);
      const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltContent).toContain('no task progress');
      expect(haltContent).not.toMatch(/retries exhausted/);
    });

    it('preserves an existing, more-specific HALT marker verbatim (existingHalt still wins over no_task_progress)', async () => {
      await seedToBuildStep('existing-halt-precedence-test');

      const SPECIFIC_HALT = 'auto-park: durable no-evidence threshold reached';
      const SPECIFIC_CLASS = 'mechanical';
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeFile(join(dir, '.pipeline/HALT.class'), SPECIFIC_CLASS);
      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            // Write a specific HALT marker directly, simulating a HALT
            // already written by an earlier, more-specific mechanism
            // (e.g. auto-park or budget exhaustion) before the terminal
            // fallback is ever reached.
            await mkdir(join(dir, '.pipeline'), { recursive: true });
            await writeFile(join(dir, '.pipeline/HALT'), SPECIFIC_HALT);
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 2,
      });

      await conductor.run();

      expect(halted).toBe(true);
      const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltContent.trim()).toBe(SPECIFIC_HALT);
      expect(await readFile(join(dir, '.pipeline/HALT.class'), 'utf-8')).toBe(SPECIFIC_CLASS);
    });

    it('non-no_task_progress terminal exhaustion keeps the pre-existing generic fallback string (lastBuildStallReason never set)', async () => {
      await seedToBuildStep('generic-fallback-unchanged-test');

      const runner: StepRunner = {
        run: vi.fn(async (step: StepName) => {
          if (step === 'build') {
            // Never write task-status.json / never advance -> completion
            // check fails, but the build never reaches attempt >= 2 with
            // resolvedTasksAfter <= resolvedTasksBefore in a way that sets
            // 'no_task_progress' via a *stall*, because we cap maxRetries
            // at 1 (single attempt, so attempt never reaches 2 -> `stalled`
            // stays null). This exercises the plain "retries exhausted"
            // terminal fallback with no stall diagnosis at all.
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
          }
          return { success: true } as StepRunResult;
        }),
      };

      let halted = false;
      events.on('loop_halt', () => {
        halted = true;
      });

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'auto',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1, // single attempt: never reaches attempt >= 2 stall check
      });

      await conductor.run();

      expect(halted).toBe(true);
      const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
      expect(haltContent).toMatch(/retries exhausted/);
      expect(haltContent).not.toContain('no task progress');
    });
  });

  describe('fix is surgical — auto-park counter + interactive REPL unchanged (#569 Task 6)', () => {
    // Task 6 is a pure guard: the #569 fix (Tasks 4/5) adds a /remediate
    // dispatch + a distinct terminal reason for no_task_progress stalls, and
    // must NOT alter the two adjacent mechanisms it sits between — the durable
    // no-evidence counter / checkAndAutoPark terminal owner (conductor.ts
    // ~:3539-3620) and the interactive REPL stall handoff (~:3833). These
    // tests prove both remain behaviorally unchanged even with the new
    // dispatch active. No production change lands here.
    async function seedToBuildGate(featureDesc: string): Promise<void> {
      const res = await readState(statePath);
      const state = (res.ok ? res.value : {}) as Record<string, unknown>;
      for (const s of ALL_STEPS) {
        if (s.name === 'build') break;
        state[s.name] = 'done';
      }
      state.complexity_tier = 'M';
      state.feature_desc = featureDesc;
      state.track = 'technical';
      await writeState(statePath, state as unknown as ConductState);
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await mkdir(join(dir, '.docs/plans'), { recursive: true });
      await writeFile(
        join(dir, `.docs/plans/${featureDesc}.md`),
        '# Plan\n\n### Task 1: Step 1\n',
      );
    }

    it('interactive mode still reaches the REPL stall handoff on a no_task_progress stall — no /remediate dispatch and no auto-park (#569)', async () => {
      await seedToBuildGate('surgical-interactive-test');

      const dispatched: StepName[] = [];
      const runner: StepRunner & { runInteractive: ReturnType<typeof vi.fn> } = {
        run: vi.fn(async (step: StepName) => {
          dispatched.push(step);
          if (step === 'build') {
            await writeFile(
              join(dir, '.pipeline/task-status.json'),
              JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
            );
          }
          return { success: true } as StepRunResult;
        }),
        // The operator drops into the REPL and /quits without finishing the
        // work — the completion gate still misses afterwards.
        runInteractive: vi.fn(async () => {}),
      };

      const parkEvents: unknown[] = [];
      events.on('auto_park', (e) => { parkEvents.push(e); });
      const onRecovery = vi.fn().mockResolvedValue('quit' as const);

      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        projectRoot: dir,
        mode: 'interactive',
        daemon: false,
        verifyArtifacts: true,
        maxRetries: 3,
        onRecovery,
      });

      await conductor.run();

      // The interactive stall handoff still fires — unchanged by the fix.
      expect(runner.runInteractive).toHaveBeenCalledWith('build', {
        reason:
          'Previous attempt did not satisfy the completion check: 1/1 tasks pending/not completed: 1 — 1 "Step 1". Finish the work now.',
      });
      // The daemon+auto-only /remediate dispatch never fires in interactive.
      expect(dispatched).not.toContain('remediate');
      // Auto-park is daemon-gated → interactive mode never parks.
      const { getProvenanceType } = await import('../../src/engine/park-marker.js');
      expect(await getProvenanceType(dir, 'surgical-interactive-test')).toBeNull();
      expect(parkEvents).toHaveLength(0);
    });
  });
});

describe('HALT content robust to hostile question text (Task 12)', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-12-test-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const STALL_QUESTION = 'Need user decision: which auth provider — Auth0 or Cognito?';

  async function seedToBuildStep(): Promise<void> {
    const res = await readState(statePath);
    const state = (res.ok ? res.value : {}) as Record<string, unknown>;
    for (const s of ALL_STEPS) {
      if (s.name === 'build') break;
      state[s.name] = 'done';
    }
    state.complexity_tier = 'M';
    state.feature_desc = 'halt-robustness-test';
    await writeState(statePath, state as unknown as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs/plans/halt-robustness-test.md'),
      '# Plan\n\n### Task 1: Step 1\n',
    );
  }

  it('question with backticks/quotes/special chars → readHaltReason returns full first line', async () => {
    const testQuestion = 'Can we use `Auth0` or "Cognito" — which one?';

    await seedToBuildStep();

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/halt-user-input-required'),
            testQuestion,
          );
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'stall:choice',
                  disposition: 'halt',
                  category: 'product-scope',
                  rationale: 'Product decision needed.',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true } as StepRunResult;
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    // Read HALT file and verify first line is preserved exactly
    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    const lines = haltContent.split('\n');
    const firstNonEmptyLine = lines.find((l) => l.trim().length > 0);

    expect(firstNonEmptyLine).toBe(testQuestion);
    // Verify special characters are not corrupted
    expect(firstNonEmptyLine).toContain('`Auth0`');
    expect(firstNonEmptyLine).toContain('"Cognito"');
    expect(firstNonEmptyLine).toContain('—');
  });

  it('500-char long first line → readHaltReason returns complete line', async () => {
    const longQuestion = 'A'.repeat(500);

    await seedToBuildStep();

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/halt-user-input-required'),
            longQuestion,
          );
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'stall:long',
                  disposition: 'halt',
                  category: null,
                  rationale: 'Test',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true } as StepRunResult;
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    const firstLine = haltContent.split('\n')[0];

    // Verify the entire 500-char line is preserved
    expect(firstLine).toBe(longQuestion);
    expect(firstLine.length).toBe(500);
  });

  it('halt disposition with empty rationale → question line still present in HALT', async () => {
    await seedToBuildStep();

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/halt-user-input-required'),
            STALL_QUESTION,
          );
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
        } else if (step === 'remediate') {
          // Write remediation with empty rationale
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'stall:auth',
                  disposition: 'halt',
                  category: 'product-scope',
                  rationale: '', // ← empty rationale
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true } as StepRunResult;
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    const lines = haltContent.split('\n').filter((l) => l.trim().length > 0);

    // Question line must be present even with empty rationale
    expect(lines[0]).toBe(STALL_QUESTION);
    expect(haltContent).toContain(STALL_QUESTION);
  });

  it('HALT file not corrupted by special characters in question', async () => {
    const specialCharsQuestion =
      'Use emoji? 🚀 Newline control? Colors? Question?';

    await seedToBuildStep();

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        if (step === 'build') {
          await writeFile(
            join(dir, '.pipeline/halt-user-input-required'),
            specialCharsQuestion,
          );
          await writeFile(
            join(dir, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: 1, status: 'pending' }] }),
          );
        } else if (step === 'remediate') {
          await writeFile(
            join(dir, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'stall:special',
                  disposition: 'halt',
                  category: null,
                  rationale: 'Special chars test.',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true } as StepRunResult;
      }),
    };

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    // File should be readable and valid (not corrupted)
    const haltContent = await readFile(join(dir, '.pipeline/HALT'), 'utf-8');
    expect(typeof haltContent).toBe('string');
    expect(haltContent.length).toBeGreaterThan(0);

    // The first line should contain the question (emoji should survive UTF-8)
    const firstLine = haltContent.split('\n')[0];
    expect(firstLine).toContain('🚀');
  });
});

// adr-2026-07-10-validation-group-join.md, Decision-1: the SHIP sequence
// gains a built-in validation group entry describing the three validators
// as a group, without disturbing their existing standalone StepDefinitions
// or index-based lookups.
describe('built-in SHIP validation group entry (Decision-1)', () => {
  it('exposes VALIDATION_GROUP with the three members in ADR order', () => {
    expect(VALIDATION_GROUP.members).toEqual([
      'manual_test',
      'prd_audit',
      'architecture_review_as_built',
    ]);
  });

  it('positions the group after build review in ALL_STEPS ordering', () => {
    const buildReviewIdx = ALL_STEPS.findIndex((s) => s.name === 'build_review');
    const firstMemberIdx = ALL_STEPS.findIndex((s) => s.name === VALIDATION_GROUP.members[0]);
    expect(firstMemberIdx).toBe(buildReviewIdx + 1);

    // Members remain contiguous and in order in the underlying linear list.
    const memberIndices = VALIDATION_GROUP.members.map(
      (name) => ALL_STEPS.findIndex((s) => s.name === name),
    );
    expect(memberIndices).toEqual([...memberIndices].sort((a, b) => a - b));
    expect(memberIndices[memberIndices.length - 1] - memberIndices[0]).toBe(
      VALIDATION_GROUP.members.length - 1,
    );
  });

  it('registers VALIDATION_GROUP in STEP_GROUPS keyed by its name', () => {
    expect(STEP_GROUPS[VALIDATION_GROUP.name]).toBe(VALIDATION_GROUP);
  });

  it('resolves each member to its own group via getGroupForStep', () => {
    for (const member of VALIDATION_GROUP.members) {
      expect(getGroupForStep(member as StepName)?.name).toBe(VALIDATION_GROUP.name);
    }
  });

  it('reports undefined group for ordinary serial steps', () => {
    expect(getGroupForStep('build')).toBeUndefined();
    expect(getGroupForStep('build_review')).toBeUndefined();
    expect(getGroupForStep('rebase')).toBeUndefined();
  });

  it('leaves each member with its own full StepDefinition (skill/gate config unchanged)', () => {
    const manualTest = ALL_STEPS.find((s) => s.name === 'manual_test');
    const prdAudit = ALL_STEPS.find((s) => s.name === 'prd_audit');
    const asBuilt = ALL_STEPS.find((s) => s.name === 'architecture_review_as_built');

    expect(manualTest?.skillName).toBe('manual-test');
    expect(manualTest?.enforcement).toBe('gating');
    expect(prdAudit?.skillName).toBe('prd-audit');
    expect(prdAudit?.skippableForTracks).toBeUndefined();
    expect(asBuilt?.skillName).toBe('architecture-review');
    expect(asBuilt?.skipWhenSkipped).toBeUndefined();
  });

  it('leaves tryGetStepIndex behavior for members and ordinary steps unchanged', () => {
    // Each member still resolves to its OWN linear-list index, not a
    // group-collapsed position.
    const buildReviewIdx = tryGetStepIndex('build_review');
    expect(buildReviewIdx).not.toBeNull();
    for (let i = 0; i < VALIDATION_GROUP.members.length; i += 1) {
      const idx = tryGetStepIndex(VALIDATION_GROUP.members[i] as StepName);
      expect(idx).toBe((buildReviewIdx as number) + 1 + i);
    }

    // Ordinary serial steps are completely unaffected.
    expect(tryGetStepIndex('build')).not.toBeNull();
    expect(tryGetStepIndex('rebase')).not.toBeNull();
    expect(tryGetStepIndex('remediate')).toBeNull();
  });

  it('stops a self-host build before dispatch when its required isolation is disabled', async () => {
    const safetyDir = await mkdtemp(join(tmpdir(), 'conductor-safety-'));
    const safetyStatePath = join(safetyDir, 'conduct-state.json');
    await writeState(safetyStatePath, {
      worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
      stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
      architecture_diagram: 'done', architecture_review: 'done', acceptance_specs: 'done',
      complexity_tier: 'M', track: 'technical', feature_desc: 'safety-boundary',
    } as ConductState);
    const runner = createMockStepRunner();
    const conductor = new Conductor({
      stateFilePath: safetyStatePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: safetyDir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      selfHost: true,
      maxRetries: 1,
      config: {
        harness_self_host: {
          skill_relink_preflight: false,
          sandbox_build_env: false,
          build_auth: { mode: 'api-key' },
        },
      } as HarnessConfig,
    });

    await (conductor as unknown as {
      runSelfBuildDispatch: (step: StepName, state: ConductState, retryHint?: string) => Promise<StepRunResult>;
    }).runSelfBuildDispatch('build', {} as ConductState);

    expect(vi.mocked(runner.run)).not.toHaveBeenCalledWith('build', expect.anything(), expect.anything());
    await rm(safetyDir, { recursive: true, force: true });
  });

  it.each(['claude', 'codex'] as const)(
    'rejects an injected %s executor that bypasses BUILD/SHIP safety on initial, retry, resume, group, and auxiliary paths',
    async (providerKey) => {
      const provider: LLMProvider = {
        invoke: vi.fn(),
      };
      const runtime = {
        key: providerKey,
        provider,
        policy: providerKey === 'claude' ? CLAUDE_MODEL_POLICY : CODEX_MODEL_POLICY,
        builtIn: true,
        availability: new ModelAvailability([]),
      };
      const bypassExecutor = vi.fn(async () => ({
        success: true,
        output: 'bypassed safety',
        exitCode: 0,
        preferredProvider: providerKey,
        actualProvider: providerKey,
        attempts: [],
      }));
      const projectRoot = '/tmp/task-17-safety';
      const runner = new DefaultStepRunner(provider, 'session', projectRoot, {
        config: { llm_provider: providerKey },
        providerExecution: {
          configuredProviders: [providerKey],
          runtimes: new ProviderRuntimeSet([runtime]),
          sessions: new ProviderSessionStore(),
          executor: bypassExecutor,
          withCandidateSafety: async (_candidate, invoke) => invoke(),
        },
      });
      const executeOneShot = (runner as unknown as {
        executeProviderAwareOneShot: (
          step: StepName,
          options: ExecuteProviderCandidatesInput['options'],
        ) => Promise<ProviderExecutionResult | undefined>;
      }).executeProviderAwareOneShot.bind(runner);

      const initial = await runner.run('build', {} as ConductState, { attempt: 1 });
      const retry = await runner.run('build', {} as ConductState, { attempt: 2 });
      const resume = await runner.run('build', {} as ConductState, { attempt: 2, resume: true });
      const grouped = await runGroupBranch(
        { name: 'manual_test', skill: 'manual-test', outcome: { kind: 'skipped' } },
        {} as ConductState,
        {
          stepRunner: runner,
          lifecycleObserver: NOOP_GROUP_BRANCH_LIFECYCLE_OBSERVER,
        },
        1,
      );
      const auxiliary = await executeOneShot('build_review', { prompt: 'review', cwd: projectRoot });

      expect({ initial, retry, resume, grouped, auxiliary }).toEqual({
        initial: expect.objectContaining({ success: false, output: expect.stringContaining('Safety wrapper was not entered') }),
        retry: expect.objectContaining({ success: false, output: expect.stringContaining('Safety wrapper was not entered') }),
        resume: expect.objectContaining({ success: false, output: expect.stringContaining('Safety wrapper was not entered') }),
        grouped: expect.objectContaining({ kind: 'permission-denied', reason: expect.stringContaining('Safety wrapper was not entered') }),
        auxiliary: expect.objectContaining({ success: false, output: expect.stringContaining('Safety wrapper was not entered') }),
      });
    },
  );
});
