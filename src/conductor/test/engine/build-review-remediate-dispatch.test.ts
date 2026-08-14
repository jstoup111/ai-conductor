import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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

  it('keeps the validation-group remediation context unchanged', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../src/engine/conductor.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain(
      "mtMergeHandled = true;\n" +
        "                const evidenceFiles: string[] = [];\n" +
        "                if (gapMemberNamesForMerge.includes('prd_audit' as StepName)) {\n" +
        "                  evidenceFiles.push('.pipeline/prd-audit.md');\n" +
        "                }\n" +
        "                if (gapMemberNamesForMerge.includes('architecture_review_as_built' as StepName)) {\n" +
        "                  evidenceFiles.push('.pipeline/architecture-review-as-built.md');\n" +
        "                }\n" +
        '                const dispatchContext =\n' +
        "                  `Blocking validation-group gaps at ${evidenceFiles.join(' and ')}. ` +\n" +
        "                  'Plan remediation per the /remediate skill and write ' +\n" +
        "                  '.pipeline/remediation.json.';",
    );
  });
});
