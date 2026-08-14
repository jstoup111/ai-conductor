import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';

describe('engine/conductor — build_review remediation dispatch (Tasks 7–9)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('asks remediation to inspect approved-plan tasks before proposing a plan-level change', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-remediate-dispatch-'));
    const statePath = join(dir, '.pipeline', 'state.json');
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name !== 'build_review') state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
    );
    const activePlanPath = '.docs/plans/active-remediation-plan.md';
    await writeFile(
      join(dir, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath }),
    );

    let remediationContext: string | undefined;
    const runner: StepRunner = {
      run: async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'build_review') {
          await writeFile(
            join(dir!, '.pipeline', 'build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ['implementation does not cover the approved plan'],
              rubric: { tautology: false, scope: false, rootCause: false, completeness: true, wiring: false },
            }),
          );
        }
        if (step === 'remediate') {
          remediationContext = options?.retryReason;
          await writeFile(
            join(dir!, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'completeness-boundary',
                  disposition: 'halt',
                  category: 'architectural-clarity',
                  rationale: 'End the focused dispatch after observing its context.',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
    });

    await conductor.run();

    expect(remediationContext).toBeDefined();
    expect(remediationContext).not.toContain('under-decomposed');
    expect(remediationContext).toContain(
      'Check the approved plan’s existing tasks before proposing a plan-level change.',
    );
    expect(remediationContext).toContain(activePlanPath);
  });

  it('dispatches remediation without an active-plan path and retains the coverage-check direction', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-remediate-no-plan-'));
    const statePath = join(dir, '.pipeline', 'state.json');
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name !== 'build_review') state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
    );

    let remediationContext: string | undefined;
    const runner: StepRunner = {
      run: async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'build_review') {
          await writeFile(
            join(dir!, '.pipeline', 'build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ['implementation does not cover the approved plan'],
              rubric: { tautology: false, scope: false, rootCause: false, completeness: true, wiring: false },
            }),
          );
        }
        if (step === 'remediate') {
          remediationContext = options?.retryReason;
          await writeFile(
            join(dir!, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'completeness-boundary',
                  disposition: 'halt',
                  category: 'architectural-clarity',
                  rationale: 'End the focused dispatch after observing its context.',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
    });

    await conductor.run();

    expect(remediationContext).toContain(
      'Check the approved plan’s existing tasks before proposing a plan-level change.',
    );
    expect(remediationContext).not.toContain('Active plan:');
  });

  it('leaves the validation-group remediation dispatch context unchanged', async () => {
    dir = await mkdtemp(join(tmpdir(), 'validation-group-remediate-context-'));
    const statePath = join(dir, '.pipeline', 'state.json');
    await writeState(
      statePath,
      {
        worktree: 'done', memory: 'done', explore: 'done', complexity: 'done', prd: 'done',
        stories: 'done', conflict_check: 'done', plan: 'done', coherence_check: 'done',
        architecture_diagram: 'done', architecture_review: 'done', acceptance_specs: 'done',
        build: 'done', build_review: 'skipped', wiring_check: 'skipped', test_suite: 'done',
        retro: 'done', rebase: 'done', finish: 'done',
      } as ConductState,
    );
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );

    let validationGroupContext: string | undefined;
    const runner: StepRunner = {
      run: async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'manual_test') {
          await writeFile(
            join(dir!, '.pipeline', 'manual-test-results.md'),
            '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n',
          );
        } else if (step === 'prd_audit') {
          await writeFile(
            join(dir!, '.pipeline', 'prd-audit.md'),
            '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n| FR-1 | GAP | missing | evidence.ts:1 | no |\n',
          );
        } else if (step === 'architecture_review_as_built') {
          await writeFile(
            join(dir!, '.pipeline', 'architecture-review-as-built.md'),
            '# As-Built Architecture Review\n\nVerdict: BLOCKED\n',
          );
        } else if (step === 'remediate') {
          validationGroupContext = options?.retryReason;
          await writeFile(
            join(dir!, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'validation-group-boundary',
                  disposition: 'halt',
                  category: 'architectural-clarity',
                  rationale: 'End the focused dispatch after observing its context.',
                  tasks: [],
                },
              ],
            }),
          );
        }
        return { success: true };
      },
    };

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'manual_test',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
    });

    await conductor.run();

    expect(validationGroupContext).toBe(
      'Blocking validation-group gaps at .pipeline/prd-audit.md and ' +
        '.pipeline/architecture-review-as-built.md. Plan remediation per the /remediate ' +
        'skill and write .pipeline/remediation.json.',
    );
  });
});
