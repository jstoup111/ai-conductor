import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId, type BuildReviewFinding } from '../../src/engine/build-review-domain.js';
import { Conductor } from '../test-conductor.js';

describe('engine/conductor — build_review remediation dispatch (Tasks 7–9)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function dispatchPointerContext(options: {
    readonly activePlan: boolean;
    readonly priorArtifacts: Readonly<Record<string, string>>;
    readonly planTask?: string;
    readonly priorLapDirectory?: boolean;
  }): Promise<string | undefined> {
    if (!dir) throw new Error('test directory was not initialized');
    const statePath = join(dir, '.pipeline', 'state.json');
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name !== 'build_review') state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    if (options.priorLapDirectory ?? true) {
      await mkdir(join(dir, '.pipeline', 'build-review', 'lap-prior'), { recursive: true });
    }
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '42', status: 'completed' }] }),
    );

    const currentLapId = parseBuildReviewLapId('lap-current')!;
    const priorLapId = parseBuildReviewLapId('lap-prior')!;
    const finding: BuildReviewFinding = {
      concernKind: 'missing-outcome',
      summary: 'The remediation context does not identify its governing task.',
      evidenceLocations: ['src/engine/conductor.ts:7500'],
      anchor: {
        rubric: 'completeness',
        planTask: options.planTask ?? '42',
        missingOutcome: 'pass plan and prior-attempt pointers to remediation',
      },
    };
    const judged = (lapId = currentLapId) => ({
      kind: 'judged' as const,
      rubric: 'completeness' as const,
      lapId,
      snapshotDigest: 'sha256:pointer-context',
      contractVersion: 'v1' as never,
      findings: [finding],
      verdict: 'FAIL' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: currentLapId,
      snapshotDigest: 'sha256:pointer-context',
      results: {
        tautology: { ...judged(), rubric: 'tautology', findings: [], verdict: 'PASS' },
        scope: { ...judged(), rubric: 'scope', findings: [], verdict: 'PASS' },
        rootCause: { ...judged(), rubric: 'rootCause', findings: [], verdict: 'PASS' },
        completeness: judged(),
      },
    });
    if (options.activePlan) {
      const activePlanPath = '.docs/plans/active-remediation-plan.md';
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(join(dir, activePlanPath), '### Task 42: Preserve the remediation context contract\n');
      await writeFile(join(dir, '.pipeline', 'engine-state.json'), JSON.stringify({ activePlanPath }));
    }
    for (const [file, contents] of Object.entries(options.priorArtifacts)) {
      await writeFile(join(dir, '.pipeline', 'build-review', 'lap-prior', file), contents);
    }

    let remediationContext: string | undefined;
    const runner: StepRunner = {
      run: async (step: StepName, _state, runOptions): Promise<StepRunResult> => {
        if (step === 'build_review') {
          await writeFile(join(dir!, '.pipeline', 'build-review.json'), JSON.stringify(aggregate));
        }
        if (step === 'remediate') {
          remediationContext = runOptions?.retryReason;
          await writeFile(join(dir!, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [{
              id: 'completeness-boundary',
              disposition: 'halt',
              category: 'architectural-clarity',
              rationale: 'End the focused dispatch after observing its context.',
              tasks: [],
            }],
          }));
        }
        return { success: true };
      },
    };
    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
    }).run();
    return remediationContext;
  }

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
              rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
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

  it('adds resolved plan-contract and prior-attempt pointers to the build_review remediation dispatch', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-remediate-pointer-dispatch-'));
    const statePath = join(dir, '.pipeline', 'state.json');
    const state: Record<string, unknown> = { complexity_tier: 'M' };
    for (const step of ALL_STEPS) {
      if (step.name !== 'build_review') state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
    await mkdir(join(dir, '.pipeline', 'build-review', 'lap-prior'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '42', status: 'completed' }] }),
    );
    const activePlanPath = '.docs/plans/active-remediation-plan.md';
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(
      join(dir, activePlanPath),
      '### Task 42: Preserve the remediation context contract\n',
    );
    await writeFile(
      join(dir, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath }),
    );

    const currentLapId = parseBuildReviewLapId('lap-current')!;
    const priorLapId = parseBuildReviewLapId('lap-prior')!;
    const finding: BuildReviewFinding = {
      concernKind: 'missing-outcome',
      summary: 'The remediation context does not identify its governing task.',
      evidenceLocations: ['src/engine/conductor.ts:7500'],
      anchor: {
        rubric: 'completeness',
        planTask: '42',
        missingOutcome: 'pass plan and prior-attempt pointers to remediation',
      },
    };
    const judged = (
      rubric: 'tautology' | 'scope' | 'rootCause' | 'completeness',
      findings: readonly BuildReviewFinding[] = [],
      lapId = currentLapId,
    ) => ({
      kind: 'judged' as const,
      rubric,
      lapId,
      snapshotDigest: 'sha256:pointer-context',
      contractVersion: 'v1' as never,
      findings,
      verdict: findings.length === 0 ? 'PASS' as const : 'FAIL' as const,
    });
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: currentLapId,
      snapshotDigest: 'sha256:pointer-context',
      results: {
        tautology: judged('tautology'),
        scope: judged('scope'),
        rootCause: judged('rootCause'),
        completeness: judged('completeness', [finding]),
      },
    });
    await writeFile(
      join(dir, '.pipeline', 'build-review', 'lap-prior', 'completeness.json'),
      JSON.stringify({
        version: 1,
        rubric: 'completeness',
        lapId: priorLapId,
        snapshotDigest: 'sha256:pointer-context',
        result: judged('completeness', [finding], priorLapId),
        provenance: { kind: 'fresh' },
      }),
    );

    let remediationContext: string | undefined;
    const runner: StepRunner = {
      run: async (step: StepName, _state, options): Promise<StepRunResult> => {
        if (step === 'build_review') {
          await writeFile(join(dir!, '.pipeline', 'build-review.json'), JSON.stringify(aggregate));
        }
        if (step === 'remediate') {
          remediationContext = options?.retryReason;
          await writeFile(
            join(dir!, '.pipeline', 'remediation.json'),
            JSON.stringify({
              dispositions: [{
                id: 'completeness-boundary',
                disposition: 'halt',
                category: 'architectural-clarity',
                rationale: 'End the focused dispatch after observing its context.',
                tasks: [],
              }],
            }),
          );
        }
        return { success: true };
      },
    };

    await new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      fromStep: 'build_review',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
    }).run();

    expect(remediationContext).toMatch(
      /plan contract: \.docs\/plans\/active-remediation-plan\.md — Task 42 \(anchor: pass plan and prior-attempt pointers to remediation\)\nprior attempts \(1\): \.pipeline\/build-review\/lap-prior\/completeness\.json#\S+/,
    );
  });

  it('keeps the remediation dispatch context byte-identical when both pointer joins miss', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-remediate-pointer-miss-'));
    const remediationContext = await dispatchPointerContext({
      activePlan: true,
      planTask: 'drifted-task',
      priorArtifacts: {},
      priorLapDirectory: false,
    });

    expect(remediationContext).toBe(
      'build_review FAILED on completeness:\n' +
      '[completeness] missing-outcome\n[completeness] missing-outcome\n' +
      'The plan task requires review. Check the approved plan’s existing tasks before ' +
      'proposing a plan-level change. Active plan: .docs/plans/active-remediation-plan.md. ' +
      'Plan remediation per the /remediate skill and write .pipeline/remediation.json.',
    );
    expect(remediationContext).not.toContain('plan contract:');
    expect(remediationContext).not.toContain('prior attempts:');
    expect(remediationContext).not.toContain('error');
  });

  it('retains a same-anchor prior-attempt pointer without an active plan', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-remediate-prior-no-plan-'));
    const context = await dispatchPointerContext({
      activePlan: false,
      priorArtifacts: {
        'completeness.json': JSON.stringify({
          version: 1,
          rubric: 'completeness',
          lapId: parseBuildReviewLapId('lap-prior'),
          snapshotDigest: 'sha256:pointer-context',
          result: {
            kind: 'judged', rubric: 'completeness', lapId: parseBuildReviewLapId('lap-prior'),
            snapshotDigest: 'sha256:pointer-context', contractVersion: 'v1',
            findings: [{
              concernKind: 'missing-outcome',
              summary: 'The remediation context does not identify its governing task.',
              evidenceLocations: ['src/engine/conductor.ts:7500'],
              anchor: {
                rubric: 'completeness', planTask: '42',
                missingOutcome: 'pass plan and prior-attempt pointers to remediation',
              },
            }], verdict: 'FAIL',
          },
          provenance: { kind: 'fresh' },
        }),
      },
    });

    expect(context).toContain('prior attempts (1): .pipeline/build-review/lap-prior/completeness.json#0');
  });

  it('skips a malformed prior artifact while retaining valid same-anchor pointers', async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-remediate-malformed-prior-'));
    const validArtifact = JSON.stringify({
      version: 1,
      rubric: 'completeness',
      lapId: parseBuildReviewLapId('lap-prior'),
      snapshotDigest: 'sha256:pointer-context',
      result: {
        kind: 'judged', rubric: 'completeness', lapId: parseBuildReviewLapId('lap-prior'),
        snapshotDigest: 'sha256:pointer-context', contractVersion: 'v1',
        findings: [{
          concernKind: 'missing-outcome',
          summary: 'The remediation context does not identify its governing task.',
          evidenceLocations: ['src/engine/conductor.ts:7500'],
          anchor: {
            rubric: 'completeness', planTask: '42',
            missingOutcome: 'pass plan and prior-attempt pointers to remediation',
          },
        }], verdict: 'FAIL',
      },
      provenance: { kind: 'fresh' },
    });
    const context = await dispatchPointerContext({
      activePlan: true,
      priorArtifacts: { 'malformed.json': '{not valid json', 'completeness.json': validArtifact },
    });

    expect(context).toContain('prior attempts (1): .pipeline/build-review/lap-prior/completeness.json#0');
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
              rubric: { tautology: false, scope: false, rootCause: false, completeness: true },
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
