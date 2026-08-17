/**
 * RED acceptance coverage for #1611.
 *
 * Story 4 is the feature's multi-operation acceptance flow: a real Conductor
 * build_review FAIL dispatches remediation, an operator acceptance becomes
 * visible while remediation is running, and the refusal exit must re-enter
 * build_review rather than HALT. Stories 1-3 and 5-6 are single-operation
 * identity, parser, reporting, and integrity contracts owned by the plan's
 * narrower engine tests.
 *
 * Production call site exercised:
 * - src/engine/conductor.ts: build_review raw-FAIL handling, remediation
 *   refusal, routing-time effective-verdict resolution, kickback accounting,
 *   HALT writing, and build_review re-entry.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function effective(accepted: boolean) {
  return {
    ok: true as const,
    feature: { version: 'v1' as const, repository: '/fixture', feature: 'finding-disposition-race' },
    effective: {
      rawVerdict: 'FAIL' as const,
      verdict: accepted ? ('PASS' as const) : ('FAIL' as const),
      acceptedFindingIds: accepted ? ['sha256:accepted-completeness-finding'] : [],
      unresolvedFindingIds: accepted ? [] : ['sha256:unresolved-completeness-finding'],
      skippedRubrics: [],
      infrastructureFailureRubrics: [],
    },
  };
}

async function runRemediationRefusalScenario(acceptDuringRemediation: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'equivalent-finding-disposition-'));
  dirs.push(dir);
  const pipelineDir = join(dir, '.pipeline');
  const statePath = join(pipelineDir, 'conduct-state.json');
  const planPath = '.docs/plans/finding-disposition-race.md';

  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await mkdir(pipelineDir, { recursive: true });
  await writeFile(join(dir, planPath), '# Plan\n\n### Task 1: preserve accepted findings\n');
  await writeFile(join(pipelineDir, 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
  await writeFile(
    join(pipelineDir, 'task-status.json'),
    JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
  );

  const state: Record<string, unknown> = {
    complexity_tier: 'M',
    feature_desc: 'equivalent-re-worded-findings-escape-their-accepte',
    track: 'technical',
  };
  for (const step of ALL_STEPS) state[step.name] = step.name === 'build_review' ? 'pending' : 'done';
  await writeState(statePath, state as ConductState);

  let remediationFinished = false;
  let buildReviewRuns = 0;
  let remediationRuns = 0;
  const dispatched: StepName[] = [];
  const runner: StepRunner = {
    run: async (step: StepName): Promise<StepRunResult> => {
      dispatched.push(step);
      if (step === 'build_review') {
        buildReviewRuns += 1;
        await writeFile(
          join(pipelineDir, 'build-review.json'),
          JSON.stringify(buildReviewRuns === 1
            ? {
                verdict: 'FAIL',
                reasons: ['completeness: accepted plan boundary needs operator judgement'],
                rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
              }
            : {
                verdict: 'PASS',
                rubric: { tautology: false, scope: false, rootCause: false, completeness: false },
              }),
        );
      }
      if (step === 'remediate') {
        remediationRuns += 1;
        await writeFile(
          join(pipelineDir, 'remediation.json'),
          JSON.stringify({
            dispositions: [{
              id: 'accepted-plan-boundary',
              disposition: 'halt',
              category: 'architectural-clarity',
              rationale: 'The operator must decide whether the accepted boundary should change.',
              tasks: [],
            }],
          }),
        );
        remediationFinished = true;
      }
      return { success: true };
    },
    resetSession: async () => {},
  };

  const resolver = vi.fn(async () => effective(acceptDuringRemediation && remediationFinished));
  const events = new ConductorEventEmitter();
  const haltReasons: string[] = [];
  const kickbacks: Array<{ from: string; to: string }> = [];
  events.on('loop_halt', (event) => {
    if (event.type === 'loop_halt') haltReasons.push(event.reason);
  });
  events.on('kickback', (event) => {
    if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to });
  });

  await new Conductor({
    projectRoot: dir,
    stateFilePath: statePath,
    stepRunner: runner,
    events,
    fromStep: 'build_review',
    verifyArtifacts: true,
    mode: 'auto',
    daemon: true,
    buildReviewEffectiveResolver: resolver,
    escalateBuildFailure: async () => ({}),
    config: {
      build_review: { enabled: true },
      kickback_escalation: { enabled: false },
    },
  }).run();

  return {
    dir,
    dispatched,
    haltReasons,
    kickbacks,
    resolver,
    buildReviewRuns,
    remediationRuns,
  };
}

describe('acceptance: every build_review FAIL exit uses the effective verdict (#1611 Story 4)', () => {
  it('re-enters build_review when acceptance lands before remediation refuses, without consuming a kickback', async () => {
    const result = await runRemediationRefusalScenario(true);

    expect(result.remediationRuns).toBe(1);
    expect(result.resolver).toHaveBeenCalled();
    expect(result.buildReviewRuns).toBe(2);
    expect(result.dispatched).not.toContain('build');
    expect(result.kickbacks).toEqual([]);
    expect(result.haltReasons).toEqual([]);
    await expect(readFile(join(result.dir, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readKickbackLedger(result.dir)).resolves.toEqual({ version: 1, gates: {} });
  });

  it('preserves the needs-human refusal HALT while any finding remains unresolved', async () => {
    const result = await runRemediationRefusalScenario(false);

    expect(result.buildReviewRuns).toBe(1);
    expect(result.remediationRuns).toBe(1);
    expect(result.dispatched).not.toContain('build');
    expect(result.haltReasons).toHaveLength(1);
    expect(result.haltReasons[0]).toContain('build_review completeness FAIL needs a human');
    await expect(readFile(join(result.dir, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });
});
