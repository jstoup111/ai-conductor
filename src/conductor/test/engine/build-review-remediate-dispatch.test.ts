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

  it('adds coverage guidance only to build_review remediation, leaving validation-group dispatch unchanged', async () => {
    dir = await mkdtemp(join(tmpdir(), 'validation-group-remediate-dispatch-'));
    const buildReviewDir = join(dir, 'build-review');
    const buildReviewStatePath = join(buildReviewDir, '.pipeline', 'state.json');
    const buildReviewState: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name !== 'build_review') buildReviewState[step.name] = 'done';
    }
    await mkdir(buildReviewDir, { recursive: true });
    await writeState(buildReviewStatePath, buildReviewState as ConductState);
    await mkdir(join(buildReviewDir, '.pipeline'), { recursive: true });
    await writeFile(
      join(buildReviewDir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
    );

    let buildReviewContext: string | undefined;
    const buildReviewRunner: StepRunner = {
      run: async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'build_review') {
          await writeFile(
            join(buildReviewDir, '.pipeline', 'build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ['implementation does not cover the approved plan'],
              rubric: {
                tautology: false,
                scope: false,
                rootCause: false,
                completeness: true,
                wiring: false,
              },
            }),
          );
        }
        if (step === 'remediate') {
          buildReviewContext = options?.retryReason;
          await writeFile(
            join(buildReviewDir, '.pipeline', 'remediation.json'),
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

    await new Conductor({
      projectRoot: buildReviewDir,
      stateFilePath: buildReviewStatePath,
      stepRunner: buildReviewRunner,
      events: new ConductorEventEmitter(),
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
    }).run();

    expect(buildReviewContext).toContain(
      'Check the approved plan’s existing tasks before proposing a plan-level change.',
    );

    const validationGroupDir = join(dir, 'validation-group');
    await mkdir(validationGroupDir, { recursive: true });
    const statePath = join(validationGroupDir, '.pipeline', 'state.json');
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      state[step.name] = [
        'manual_test',
        'prd_audit',
        'architecture_review_as_built',
      ].includes(step.name)
        ? 'pending'
        : 'done';
    }
    state.build_review = 'skipped';
    await writeState(statePath, state as ConductState);
    await mkdir(join(validationGroupDir, '.pipeline'), { recursive: true });
    await writeFile(
      join(validationGroupDir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
    );

    let remediationContext: string | undefined;
    const runner: StepRunner = {
      run: async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'manual_test') {
          await writeFile(
            join(validationGroupDir, '.pipeline', 'manual-test-results.md'),
            '# Results\n\n| Story | Result |\n|--|--|\n| s1 | FAIL |\n',
          );
        }
        if (step === 'prd_audit') {
          await writeFile(
            join(validationGroupDir, '.pipeline', 'prd-audit.md'),
            '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|--|--|--|--|--|\n' +
              '| FR-1 | GAP | missing | evidence.ts:1 | no |\n',
          );
        }
        if (step === 'architecture_review_as_built') {
          await writeFile(
            join(validationGroupDir, '.pipeline', 'architecture-review-as-built.md'),
            '# As-Built Architecture Review\n\nVerdict: APPROVED\n',
          );
        }
        if (step === 'remediate') {
          remediationContext = options?.retryReason;
          await writeFile(
            join(validationGroupDir, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'FR-1',
                  disposition: 'halt',
                  category: 'architectural-clarity',
                  rationale: 'Stop after capturing the validation-group dispatch context.',
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
      projectRoot: validationGroupDir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'manual_test',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
    });

    await conductor.run();

    expect(remediationContext).toBe(
      'Blocking validation-group gaps at .pipeline/prd-audit.md. ' +
        'Plan remediation per the /remediate skill and write .pipeline/remediation.json.',
    );
  });
});
