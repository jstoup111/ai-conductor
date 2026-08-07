import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'earliest-remediation-target-'));
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

async function planRemediation(dispositions: unknown[], steps = ALL_STEPS) {
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
      steps: typeof ALL_STEPS,
      dispatchContext: string,
      hintSource: { source: string; evidenceFile: string },
    ) => Promise<{ kind: string; target?: string; detail?: string }>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
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
