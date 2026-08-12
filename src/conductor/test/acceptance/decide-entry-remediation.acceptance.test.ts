import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CUSTOM_COMPLETION_PREDICATES } from '../../src/engine/artifacts.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const originalPlanCompletion = CUSTOM_COMPLETION_PREDICATES.plan;

describe('acceptance: remediation rewind observes the DECIDE-entry policy', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (originalPlanCompletion) CUSTOM_COMPLETION_PREDICATES.plan = originalPlanCompletion;
    else delete CUSTOM_COMPLETION_PREDICATES.plan;
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function runRemediation(
    targetCompletion: () => Promise<{ done: boolean; reason?: string }>,
    options: { grant?: boolean; stopAfterPlan?: boolean } = {},
  ) {
    root = await mkdtemp(join(tmpdir(), 'decide-entry-remediation-'));
    const statePath = join(root, 'conduct-state.json');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const state: Record<string, unknown> = {
      feature_desc: 'decide-entry-remediation',
      complexity_tier: 'L',
      track: 'technical',
    };
    for (const step of ALL_STEPS) state[step.name] = 'done';
    await writeState(statePath, state as ConductState);
    CUSTOM_COMPLETION_PREDICATES.plan = targetCompletion;
    if (options.grant) {
      await writeFile(
        join(root, '.pipeline/decide-grant.json'),
        JSON.stringify({ step: 'plan', grantedBy: 'operator' }),
        'utf8',
      );
    }

    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        calls.push(step);
        if (step === 'build_review') {
          await writeFile(
            join(root!, '.pipeline/build-review.json'),
            JSON.stringify({
              verdict: 'FAIL',
              reasons: ['the approved plan lacks the tested remediation path'],
              rubric: { tautology: false, scope: false, rootCause: false, completeness: true, wiring: false },
            }),
            'utf8',
          );
        }
        if (step === 'remediate') {
          await writeFile(
            join(root!, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id: 'remediation-plan-gap',
                  disposition: 'plan',
                  category: null,
                  rationale: 'The plan requires a scoped correction.',
                  tasks: [],
                },
              ],
            }),
            'utf8',
          );
        }
        if (step === 'plan' && options.stopAfterPlan) {
          return { success: false, output: 'stop after observing plan dispatch' };
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      fromStep: 'build_review',
      maxRetries: 1,
    });

    await conductor.run();
    return {
      calls,
      halt: await readFile(join(root, '.pipeline/HALT'), 'utf8'),
      haltClass: await readFile(join(root, '.pipeline/HALT.class'), 'utf8'),
      grantConsumed: await readFile(join(root, '.pipeline/decide-grant.json'), 'utf8')
        .then(() => false)
        .catch(() => true),
    };
  }

  it.each([
    {
      name: 'an unsatisfied DECIDE contract',
      completion: async () => ({ done: false, reason: 'plan artifact is unsatisfied' }),
      refusal: 'artifact unsatisfied — plan artifact is unsatisfied',
    },
    {
      name: 'an unknown DECIDE contract',
      completion: async () => {
        throw new Error('completion verifier unavailable');
      },
      refusal: 'artifact satisfaction is unknown',
    },
  ])('writes needs-human and launches no plan provider for $name', async ({ completion, refusal }) => {
    const result = await runRemediation(completion);

    expect(result.calls).toContain('build_review');
    expect(result.calls).toContain('remediate');
    expect(result.calls).not.toContain('plan');
    expect(result.haltClass).toBe('needs-human');
    expect(result.halt).toContain('DECIDE entry refused — autonomous run may not enter DECIDE');
    expect(result.halt).toContain('Source gate:       remediate');
    expect(result.halt).toContain(refusal);
  });

  it('a matching grant still refuses entry when remediation reopens a satisfied DECIDE artifact', async () => {
    const result = await runRemediation(
      async () => ({ done: false, reason: 'plan needs a pass' }),
      { grant: true, stopAfterPlan: true },
    );

    // DECIDE is human-only under the daemon: the grant neither admits nor is consumed.
    expect(result.calls).not.toContain('plan');
    expect(result.grantConsumed).toBe(false);
    expect(result.haltClass).toBe('needs-human');
  });
});
