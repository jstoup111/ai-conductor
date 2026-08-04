import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('planRemediation implementation-only authority routing', () => {
  let projectRoot: string;
  let planPath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'remediation-authority-routing-'));
    planPath = join(projectRoot, '.docs/plans/feature.md');
    await mkdir(join(projectRoot, '.docs/plans'), { recursive: true });
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(planPath, '# Implementation plan\n\n### Task 1: existing work\n', 'utf8');
    await writeFile(
      join(projectRoot, '.pipeline/engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('routes an ADR-keyed implementation-only remediation to BUILD and seeds its pending task', async () => {
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        dispatched.push(step);
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'adr-2026-07-27-provider-lifecycle',
                disposition: 'build',
                category: null,
                rationale:
                  'Approved architecture remains authoritative; implementation drift is confined to src/provider-home.ts:42 and its tests.',
                tasks: [
                  {
                    id: 'rem-adr-1250-1',
                    title:
                      'src/provider-home.ts:42 — align implementation and tests with the approved provider lifecycle',
                    status: 'pending',
                  },
                ],
              },
            ],
          }),
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
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      {
        session_started_at: Date.now() - 1_000,
        feature_desc: 'feature',
      } as ConductState,
      ALL_STEPS,
      'as-built architecture review blocked',
      {
        source: 'architecture-review-as-built',
        evidenceFile: '.pipeline/architecture-review-as-built.md',
      },
    );

    const taskStatus = JSON.parse(
      await readFile(join(projectRoot, '.pipeline/task-status.json'), 'utf8'),
    ) as { tasks: Array<{ id: string; status: string }> };
    const observation = {
      outcome,
      dispatched,
      taskAppended: (await readFile(planPath, 'utf8')).includes(
        '### Task rem-adr-1250-1: src/provider-home.ts:42 — align implementation and tests with the approved provider lifecycle',
      ),
      seededTask: taskStatus.tasks.find((task) => task.id === 'rem-adr-1250-1'),
      decideHaltWritten: await access(join(projectRoot, '.pipeline/halt-user-input-required'))
        .then(() => true)
        .catch(() => false),
    };

    expect(observation).toMatchObject({
      outcome: { kind: 'route', target: 'build' },
      dispatched: ['remediate'],
      taskAppended: true,
      seededTask: { id: 'rem-adr-1250-1', status: 'pending' },
      decideHaltWritten: false,
    });
  });

  it.each([
    {
      id: 'adr-2026-07-27-provider-lifecycle',
      target: 'architecture_review',
      rationale:
        'The approved provider lifecycle no longer accommodates the required credential handoff; change or clarify the approved architecture before implementation can proceed.',
    },
    {
      id: 'plan-in-scope-omission',
      target: 'plan',
      rationale:
        'The approved architecture is sound, but the active plan omits the in-scope credential handoff task required to implement it.',
    },
  ] as const)(
    'halts in daemon mode when remediation genuinely requires DECIDE target $target',
    async ({ id, target, rationale }) => {
      const dispatched: StepName[] = [];
      const runner: StepRunner = {
        run: async (step) => {
          dispatched.push(step);
          await writeFile(
            join(projectRoot, '.pipeline/remediation.json'),
            JSON.stringify({
              dispositions: [
                {
                  id,
                  disposition: target,
                  category: null,
                  rationale,
                  tasks: [],
                },
              ],
            }),
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
        ) => Promise<{ kind: string; detail?: string }>;
      }).planRemediation(
        {
          session_started_at: Date.now() - 1_000,
          feature_desc: 'feature',
        } as ConductState,
        ALL_STEPS,
        'as-built architecture review blocked',
        {
          source: 'architecture-review-as-built',
          evidenceFile: '.pipeline/architecture-review-as-built.md',
        },
      );

      expect({ outcome, dispatched }).toMatchObject({
        outcome: {
          kind: 'halt',
          detail: expect.stringContaining(`DECIDE step '${target}'`),
        },
        dispatched: ['remediate'],
      });
    },
  );
});
