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

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
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
  let firstOutput = '';
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

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

async function currentHead(dir: string): Promise<string> {
  const ref = (await readFile(join(dir, '.git', 'HEAD'), 'utf8')).trim().replace(/^ref: /, '');
  return (await readFile(join(dir, '.git', ref), 'utf8')).trim();
}

function projectionFromPrompt(prompt: string): {
  rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness';
  lapId: string;
  snapshotDigest: string;
} {
  return JSON.parse(prompt.split('\n\n').at(-1)!);
}

async function runVocabularyRepairEffectivePassScenario() {
  const dir = await mkdtemp(join(tmpdir(), 'equivalent-vocabulary-repair-'));
  dirs.push(dir);
  const pipelineDir = join(dir, '.pipeline');
  const statePath = join(pipelineDir, 'conduct-state.json');
  const planPath = '.docs/plans/finding-disposition-race.md';
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(pipelineDir, { recursive: true });
  await writeFile(join(dir, planPath), '# Plan\n\n### Task 1: preserve accepted findings\n');
  await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
  await writeFile(join(dir, 'src', 'feature.ts'), 'export const reviewed = false;\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'acceptance@example.com');
  git(dir, 'config', 'user.name', 'Acceptance Test');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'feature/vocabulary-repair');
  await writeFile(join(dir, 'src', 'feature.ts'), 'export const reviewed = true;\n');
  git(dir, 'add', 'src/feature.ts');
  git(dir, 'commit', '-qm', 'implement reviewed behavior', '-m', 'Task: 1');
  const head = await currentHead(dir);
  await writeFile(join(pipelineDir, 'engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
  await writeFile(join(pipelineDir, 'task-status.json'), JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }));

  const state: Record<string, unknown> = { complexity_tier: 'M', feature_desc: 'equivalent-re-worded-findings-escape-their-accepte', track: 'technical' };
  for (const step of ALL_STEPS) state[step.name] = step.name === 'build_review' ? 'pending' : 'done';
  await writeState(statePath, state as ConductState);

  let initialScopeReply = true;
  let repairReplies = 0;
  const provider: LLMProvider = {
    invoke: vi.fn(async ({ prompt }) => {
      if (prompt.includes('previous response for the Build Review Scope rubric')) {
        repairReplies += 1;
        return { success: true, exitCode: 0, output: JSON.stringify({
          findings: [{ concernKind: 'out-of-plan-change', summary: 'The change needs review.', evidenceLocations: ['src/feature.ts:1'], anchor: { rubric: 'scope', path: 'src/feature.ts', relation: 'not-authorized-by-plan' } }],
        }) };
      }
      const projection = projectionFromPrompt(prompt);
      if (projection.rubric === 'scope' && initialScopeReply) {
        initialScopeReply = false;
        return { success: true, exitCode: 0, output: JSON.stringify({
          findings: [{ concernKind: 'other', summary: 'The change needs review.', evidenceLocations: ['src/feature.ts:1'], anchor: { rubric: 'scope', path: 'src/feature.ts', relation: 'other' } }],
        }) };
      }
      return { success: true, exitCode: 0, output: JSON.stringify({ findings: [] }) };
    }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
  const realBuildReviewRunner = new DefaultStepRunner(provider, 'acceptance-session', dir, {
    planPath: join(dir, planPath),
    pipelineDir,
    config: { build_review: { enabled: true, perTaskFloor: false, rubrics: { tautology: { enabled: true } } }, wiring: { entry_points: ['src/feature.ts'] } } as HarnessConfig,
    buildReviewInputOptions: { inspectTestSuite: async () => ({ status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' } } as never) },
    buildReviewEffectiveResolver: async () => effective(false),
  });
  let buildReviewRuns = 0;
  const runner: StepRunner = {
    run: async (step, currentState) => {
      if (step !== 'build_review') return { success: true };
      buildReviewRuns += 1;
      if (buildReviewRuns === 1) {
        return realBuildReviewRunner.run(step, currentState);
      }
      await writeFile(join(pipelineDir, 'build-review.json'), JSON.stringify({ verdict: 'PASS', rubric: { tautology: false, scope: false, rootCause: false, completeness: false } }));
      return { success: true };
    },
    resetSession: async () => {},
  };
  const kickbacks: Array<{ from: string; to: string }> = [];
  const events = new ConductorEventEmitter();
  events.on('kickback', (event) => { if (event.type === 'kickback') kickbacks.push({ from: event.from, to: event.to }); });
  await new Conductor({ projectRoot: dir, stateFilePath: statePath, stepRunner: runner, events, fromStep: 'build_review', verifyArtifacts: true, mode: 'auto', daemon: true, buildReviewEffectiveResolver: async () => effective(true), escalateBuildFailure: async () => ({}), config: { build_review: { enabled: true }, kickback_escalation: { enabled: false } } }).run();
  return { dir, repairReplies, buildReviewRuns, kickbacks };
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

  it('keeps a vocabulary-repaired effective PASS out of the kickback budget and event stream', async () => {
    const result = await runVocabularyRepairEffectivePassScenario();

    expect(result.repairReplies).toBe(1);
    expect(result.buildReviewRuns).toBe(1);
    expect(result.kickbacks).toEqual([]);
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
