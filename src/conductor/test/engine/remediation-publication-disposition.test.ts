/**
 * The `publication` remediation disposition.
 *
 * `/remediate`'s vocabulary used to be build | acceptance_specs |
 * architecture_review | plan | halt — no route for "the prose we publish is
 * wrong". Every presentation gap therefore had to launder through `build`,
 * which re-opened an entire implementation phase to fix a PR body AND appended
 * a task to `.docs/plans/<slug>.md`, tripping the protected-artifact
 * self-amendment guard.
 *
 * `publication` routes to `finish` (the step that owns PR prose) and is
 * excluded from the plan-append contract.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildRemediationHint,
  earliestRemediationTarget,
  Conductor,
} from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import {
  readRemediationPlanResult,
  remediationDispositionAppendsToPlan,
  remediationDispositionStep,
} from '../../src/engine/artifacts.js';
import type { RemediationGap } from '../../src/engine/artifacts.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const PUBLICATION_GAP = {
  id: 'FR-2',
  disposition: 'publication',
  category: null,
  rationale:
    'The shipped code satisfies FR-2; only the PR body still describes the superseded approach.',
  tasks: [{ id: 'rem-fr2-1', title: 'rewrite the PR body ## What Changed section', status: 'pending' }],
};

const EXISTING_TASK_GAP = {
  id: 'FR-3',
  disposition: 'existing-task',
  category: null,
  rationale: 'Task 1 already owns the approved guard.',
  tasks: [{ id: '1', title: 'Add the approved guard' }],
};

describe('remediation `publication` disposition', () => {
  let projectRoot: string;
  let planPath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'remediation-publication-'));
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

  it('readRemediationPlanResult accepts `publication` as a valid disposition', async () => {
    await writeFile(
      join(projectRoot, '.pipeline/remediation.json'),
      JSON.stringify({ dispositions: [PUBLICATION_GAP] }),
      'utf8',
    );

    const plan = (await readRemediationPlanResult(projectRoot, Date.now() - 60_000, 'prd-audit')).plan;

    expect(plan?.gaps).toHaveLength(1);
    expect(plan?.gaps[0].disposition).toBe('publication');
    expect(plan?.invalidTasklessBuild).toBe(false);
  });

  it('readRemediationPlanResult accepts a taskless `publication` gap (the rationale is the fix)', async () => {
    await writeFile(
      join(projectRoot, '.pipeline/remediation.json'),
      JSON.stringify({ dispositions: [{ ...PUBLICATION_GAP, tasks: [] }] }),
      'utf8',
    );

    const plan = (await readRemediationPlanResult(projectRoot, Date.now() - 60_000, 'prd-audit')).plan;

    expect(plan?.gaps[0]?.disposition).toBe('publication');
    expect(plan?.invalidTasklessBuild).toBe(false);
  });

  it('earliestRemediationTarget routes `publication` to finish, never to build', () => {
    const gap = { ...PUBLICATION_GAP, tasks: [] } as unknown as RemediationGap;
    expect(earliestRemediationTarget([gap], ALL_STEPS)).toEqual({
      target: 'finish',
      unresolved: [],
    });
  });

  it('buildRemediationHint for a publication-only plan asks for prose, not code', () => {
    const gap = { ...PUBLICATION_GAP, tasks: [] } as unknown as RemediationGap;
    const hint = buildRemediationHint([gap], 'prd-audit', '.pipeline/prd-audit.md');
    expect(hint).toMatch(/pull request|PR body/i);
    expect(hint).not.toContain('make the code/spec changes');
  });

  it('planRemediation routes a publication gap to finish WITHOUT appending to the protected plan', async () => {
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        dispatched.push(step);
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({ dispositions: [PUBLICATION_GAP] }),
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

    const planBefore = await readFile(planPath, 'utf8');
    const outcome = await (
      conductor as unknown as {
        planRemediation: (
          state: ConductState,
          steps: typeof ALL_STEPS,
          dispatchContext: string,
          hintSource: { source: string; evidenceFile: string },
        ) => Promise<{ kind: string; target?: string }>;
      }
    ).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked on a presentation gap',
      { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'finish' });
    expect(dispatched).toEqual(['remediate']);
    // The plan is a protected artifact: a PR-prose fix must never amend it.
    expect(await readFile(planPath, 'utf8')).toBe(planBefore);
  });
});

describe('remediation `existing-task` disposition', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'remediation-existing-task-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('admits non-empty bound task ids', async () => {
    await writeFile(
      join(projectRoot, '.pipeline/remediation.json'),
      JSON.stringify({ dispositions: [EXISTING_TASK_GAP] }),
      'utf8',
    );

    const plan = (await readRemediationPlanResult(projectRoot, Date.now() - 60_000, 'prd-audit')).plan;

    expect(plan?.gaps).toHaveLength(1);
    expect(plan?.gaps[0]).toMatchObject({ disposition: 'existing-task', tasks: [{ id: '1' }] });
  });

  it('rejects an empty task binding as malformed', async () => {
    await writeFile(
      join(projectRoot, '.pipeline/remediation.json'),
      JSON.stringify({ dispositions: [{ ...EXISTING_TASK_GAP, tasks: [] }] }),
      'utf8',
    );

    await expect(readRemediationPlanResult(projectRoot, Date.now() - 60_000, 'prd-audit').then((r) => r.plan)).resolves.toBeNull();
  });

  it('drops unknown dispositions without dropping a valid existing-task gap', async () => {
    await writeFile(
      join(projectRoot, '.pipeline/remediation.json'),
      JSON.stringify({
        dispositions: [
          { ...EXISTING_TASK_GAP, id: 'unknown', disposition: 'unknown-disposition' },
          EXISTING_TASK_GAP,
        ],
      }),
      'utf8',
    );

    const plan = (await readRemediationPlanResult(projectRoot, Date.now() - 60_000, 'prd-audit')).plan;

    expect(plan?.gaps).toHaveLength(1);
    expect(plan?.gaps[0]?.disposition).toBe('existing-task');
  });

  it('routes to build without appending to the plan', () => {
    expect(remediationDispositionStep('existing-task')).toBe('build');
    expect(remediationDispositionAppendsToPlan('existing-task')).toBe(false);
  });
});
