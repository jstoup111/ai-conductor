import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { CUSTOM_COMPLETION_PREDICATES, STEP_ARTIFACT_GLOBS } from '../../src/engine/artifacts.js';
import type { ConductState, StepDefinition, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

let projectRoot: string;
const originalPlanCompletion = CUSTOM_COMPLETION_PREDICATES.plan;
const originalPlanGlobs = STEP_ARTIFACT_GLOBS.plan;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'earliest-remediation-target-'));
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
});

afterEach(async () => {
  if (originalPlanCompletion) CUSTOM_COMPLETION_PREDICATES.plan = originalPlanCompletion;
  else delete CUSTOM_COMPLETION_PREDICATES.plan;
  STEP_ARTIFACT_GLOBS.plan = originalPlanGlobs;
  await rm(projectRoot, { recursive: true, force: true });
});

async function planRemediation(
  dispositions: unknown[],
  steps: StepDefinition[] = ALL_STEPS,
  state: ConductState = { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
) {
  const dispatched: StepName[] = [];
  const runner: StepRunner = {
    run: async (step) => {
      dispatched.push(step);
      await writeFile(
        join(projectRoot, '.pipeline/remediation.json'),
        JSON.stringify({ dispositions }),
        'utf8',
      );
      return { success: true };
    },
  };
  const conductor = new Conductor({
    stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
  });

  const outcome = await (conductor as unknown as {
    planRemediation: (
      state: ConductState,
      steps: StepDefinition[],
      dispatchContext: string,
      hintSource: { source: string; evidenceFile: string },
    ) => Promise<{ kind: string; target?: string; detail?: string }>;
  }).planRemediation(
    state,
    steps,
    'prd audit blocked',
    { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' },
  );

  return { dispatched, outcome };
}

const buildGap = {
  id: 'build-gap',
  disposition: 'build',
  category: null,
  rationale: 'Repair the implementation.',
  tasks: [{ id: 'rem-build', title: 'Repair the implementation.' }],
};

const planGap = {
  id: 'plan-gap',
  disposition: 'plan',
  category: null,
  rationale: 'Correct the remediation plan.',
  tasks: [],
};

const unresolvableDisposition = 'acceptance_specs';
const stepsWithoutAcceptanceSpecs = ALL_STEPS.filter(
  (step) => step.name !== unresolvableDisposition,
) as typeof ALL_STEPS;

describe('planRemediation unresolvable disposition handling', () => {
  it('halts naming a disposition that does not resolve to a step', async () => {
    const { outcome } = await planRemediation(
      [{ ...buildGap, disposition: unresolvableDisposition }],
      stepsWithoutAcceptanceSpecs,
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining(unresolvableDisposition),
    });
  });

  it('routes a fully resolvable BUILD ledger as before', async () => {
    const { outcome } = await planRemediation([buildGap]);

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
  });

  it('halts a mixed ledger instead of routing its resolvable BUILD subset', async () => {
    const { outcome } = await planRemediation(
      [buildGap, { ...buildGap, id: 'unknown-gap', disposition: unresolvableDisposition }],
      stepsWithoutAcceptanceSpecs,
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining(unresolvableDisposition),
    });
  });
});

describe('planRemediation DECIDE-entry policy wiring', () => {
  it('halts an undefined target phase before any target provider dispatch', async () => {
    const steps = ALL_STEPS.map((step) =>
      step.name === 'plan' ? ({ ...step, phase: undefined } as unknown as StepDefinition) : step,
    );

    const { dispatched, outcome } = await planRemediation([planGap], steps);

    expect(dispatched).toEqual(['remediate']);
    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('Source gate:       remediate'),
    });
    expect(outcome.detail).toContain("DECIDE target 'plan' could not be resolved");
  });

  it('halts an unsatisfied DECIDE completion contract before target dispatch', async () => {
    CUSTOM_COMPLETION_PREDICATES.plan = async () => ({
      done: false,
      reason: 'plan artifact is incomplete',
    });

    const { dispatched, outcome } = await planRemediation([planGap]);

    expect(dispatched).toEqual(['remediate']);
    expect(outcome).toMatchObject({ kind: 'halt' });
    expect(outcome.detail).toContain('artifact unsatisfied — plan artifact is incomplete');
  });

  it('halts an unknown DECIDE completion contract before target dispatch', async () => {
    CUSTOM_COMPLETION_PREDICATES.plan = async () => {
      throw new Error('completion backend unavailable');
    };

    const { dispatched, outcome } = await planRemediation([planGap]);

    expect(dispatched).toEqual(['remediate']);
    expect(outcome).toMatchObject({ kind: 'halt' });
    expect(outcome.detail).toContain('artifact satisfaction is unknown');
  });

  it('leaves a matching operator grant available for the subsequent dispatch seam', async () => {
    CUSTOM_COMPLETION_PREDICATES.plan = async () => ({ done: false, reason: 'plan needs a pass' });
    await writeFile(
      join(projectRoot, '.pipeline/decide-grant.json'),
      JSON.stringify({ step: 'plan', grantedBy: 'operator' }),
      'utf8',
    );

    const { dispatched, outcome } = await planRemediation([planGap]);

    expect(dispatched).toEqual(['remediate']);
    expect(outcome).toMatchObject({ kind: 'route', target: 'plan' });
    await expect(readFile(join(projectRoot, '.pipeline/decide-grant.json'), 'utf8')).resolves.toContain('plan');
  });

  it('routes contract-less and verified-satisfied DECIDE targets through their fast-forward path', async () => {
    delete CUSTOM_COMPLETION_PREDICATES.plan;
    STEP_ARTIFACT_GLOBS.plan = [];

    await expect(planRemediation([planGap])).resolves.toMatchObject({
      dispatched: ['remediate'],
      outcome: { kind: 'route', target: 'plan' },
    });

    CUSTOM_COMPLETION_PREDICATES.plan = async () => ({ done: true, reason: 'plan is current' });
    await expect(planRemediation([planGap])).resolves.toMatchObject({
      dispatched: ['remediate'],
      outcome: { kind: 'route', target: 'plan' },
    });
  });

  it('keeps tier-skipped DECIDE and BUILD targets routable for their existing fast-forward paths', async () => {
    const tierSkippedGap = { ...planGap, id: 'architecture-gap', disposition: 'architecture_review' };
    const state = {
      session_started_at: Date.now() - 1_000,
      feature_desc: 'feature',
      complexity_tier: 'S',
    } as ConductState;

    await expect(planRemediation([tierSkippedGap], ALL_STEPS, state)).resolves.toMatchObject({
      outcome: { kind: 'route', target: 'architecture_review' },
    });
    await expect(planRemediation([buildGap], ALL_STEPS, state)).resolves.toMatchObject({
      outcome: { kind: 'route', target: 'build' },
    });
  });
});
