// Covers: task:7
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execa } from 'execa';

vi.mock('../../src/engine/build-review-effective.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-effective.js')>(),
  resolveBuildReviewFeatureIdentity: vi.fn(async () => ({
    version: 'v1' as const,
    repository: '/fixture/repository',
    feature: 'conductor-remediation-authority-routing',
  })),
}));

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { AcceptedWideningDecisionStore } from '../../src/engine/accepted-widenings.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import type { PrdAuditJudgment } from '../../src/engine/prd-audit-contract.js';
import {
  persistFixtureProjectedRemediationPlan,
  persistFixtureRemediationPlan,
  persistFixtureTestRemediationPlan,
} from './remediation-plan-fixtures.js';

async function persistFixturePrdAuditVerdict(
  projectRoot: string,
  criterionJudgments: PrdAuditJudgment['criterionJudgments'],
): Promise<void> {
  await persistPrdAuditVerdict(projectRoot, {
    complete: true,
    judgment: { version: 'v1', criterionJudgments, noOwnerObservations: [] },
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId: 'fixture-prd', codeStamp: null });
}

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

  it('does not dispatch remediation for a late accepted-only OVER_SCOPE route', async () => {
    await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
      '# Stories', '', '## Story 1: scoped behavior', '', '#### Happy Path',
      '- Given completed work, when accepted, then it advances.',
    ].join('\n'), 'utf8');
    await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
      '**PRD:** none', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | PRD: | Evidence | Intent relation |',
      '| --- | --- | --- | --- | --- | --- |',
      '| S1.1 | OVER_SCOPE | 1 | none | Accepted scope objection | outside-visible |',
    ].join('\n'), 'utf8');
    await persistPrdAuditVerdict(projectRoot, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'OVER_SCOPE',
          evidence: 'Accepted scope objection', rationale: 'Fixture scope judgment.',
          requirementAssociations: [], evidenceTaskIds: ['1'], intentRelation: 'outside-visible',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'fixture-run', codeStamp: null });
    const accepted = await new AcceptedWideningDecisionStore(projectRoot, {
      version: 1, repository: '/fixture/repository', feature: 'conductor-remediation-authority-routing',
    }).append({
      criterion: 'S1.1', authority: 'accept',
      rationale: 'Operator accepted the completed scope.', operator: 'test',
    });
    if (!accepted.ok) throw new Error(`fixture acceptance failed: ${accepted.reason}`);
    let remediationDispatches = 0;
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
      stepRunner: { run: async () => { remediationDispatches += 1; return { success: true }; } },
      events: new ConductorEventEmitter(), projectRoot, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'stale pending prd-audit route',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );

    expect({ outcome: outcome.kind, remediationDispatches }).toEqual({ outcome: 'none', remediationDispatches: 0 });
  });

  it('rejects an unprovenanced remediation task without a growth allowance', async () => {
    const dispatched: StepName[] = [];
    const runner: StepRunner = {
      run: async (step, _state, options) => {
        dispatched.push(step);
        await persistFixtureTestRemediationPlan(projectRoot, options, [{
          id: 'ARCH-1', disposition: 'build', category: null,
          rationale: 'Approved architecture remains authoritative; implementation drift is confined to src/provider-home.ts:42 and its tests.',
          tasks: [{ id: 'rem-adr-1250-1', title: 'src/provider-home.ts:42 — align implementation and tests with the approved provider lifecycle' }],
        }]);
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
        hintSource: { source: string; evidence: Array<{ gate: StepName; evidenceFile: string }> },
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      {
        session_started_at: Date.now() - 1_000,
        feature_desc: 'feature',
      } as ConductState,
      ALL_STEPS,
      'finish verification reported an unprovenanced remediation',
      {
        source: 'finish-verification',
        evidence: [{ gate: 'finish' as StepName, evidenceFile: '.pipeline/finish-verification.md' }],
      },
    );

    const observation = {
      outcome,
      dispatched,
      taskAppended: (await readFile(planPath, 'utf8')).includes(
        '### Task rem-adr-1250-1: src/provider-home.ts:42 — align implementation and tests with the approved provider lifecycle',
      ),
      decideHaltWritten: await access(join(projectRoot, '.pipeline/halt-user-input-required'))
        .then(() => true)
        .catch(() => false),
    };

    expect(observation).toMatchObject({
      outcome: { kind: 'halt', detail: expect.stringContaining('no plan-growth allowance') },
      dispatched: ['remediate'],
      taskAppended: false,
      decideHaltWritten: false,
    });
  });

  it('does not route when an ordinary taskless BUILD response yields no typed plan', async () => {
    const runner: StepRunner = {
      run: async () => {
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
        hintSource: { source: string; evidence: Array<{ gate: StepName; evidenceFile: string }> },
      ) => Promise<{ kind: string; target?: string; detail?: string }>;
    }).planRemediation(
      {
        session_started_at: Date.now() - 1_000,
        feature_desc: 'feature',
      } as ConductState,
      ALL_STEPS,
      'finish verification returned no remediation plan',
      {
        source: 'finish-verification',
        evidence: [{ gate: 'finish' as StepName, evidenceFile: '.pipeline/finish-verification.md' }],
      },
    );

    expect(outcome).toMatchObject({ kind: 'none' });
  });

  it('sends BUILD only the criterion-bound prd_audit remediation gaps', async () => {
    await writeFile(
      planPath,
      Array.from({ length: 20 }, (_, index) => `### Task ${index + 1}: authored work\n`).join(''),
      'utf8',
    );
    await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
      '# Stories', '', '## Story 1: remediation', '', '#### Happy Path',
      '- Given input, when repaired, then it holds.',
    ].join('\n'), 'utf8');
    await persistFixturePrdAuditVerdict(projectRoot, [{
      criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'FIXABLE',
      evidence: 'Missing implementation', rationale: 'Fixture repair.',
      requirementAssociations: [{ path: '.docs/specs/feature.md', requirementId: 'FR-7' }],
      evidenceTaskIds: ['1'], ownerTaskId: '1',
    }]);
    const runner: StepRunner = {
      run: async (_step, _state, options) => {
        // The foreign FR-42 entry was a legacy-reader behavior.  A typed
        // plan may contain only the engine-projected S1.1 reference.
        await persistFixtureProjectedRemediationPlan(projectRoot, options, [{
          id: 'S1.1', disposition: 'build', category: null,
          rationale: 'Repair the authorized criterion.',
          tasks: [{ id: 'rem-authorized', title: 'Implement the authorized repair' }],
        }]);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      config: { prd_audit: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 } } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; target?: string; hint?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(outcome.hint).toContain('S1.1');
    expect(outcome.hint).not.toContain('FR-42');
    const plan = await readFile(planPath, 'utf8');
    expect(plan).toContain('rem-authorized');
    expect(plan).not.toContain('rem-unmatched');
  });

  it.each([
    ['S5.1', 's5.1'],
    ['s5.1', 'S5.1'],
  ])('routes a criterion-bound remediation when report criterion %s and gap id %s differ only by case', async (criterion, gapId) => {
    await writeFile(
      planPath,
      Array.from({ length: 20 }, (_, index) => `### Task ${index + 1}: authored work\n`).join(''),
      'utf8',
    );
    await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
      '# Stories', '', '## Story 5: remediation', '', '#### Happy Path',
      '- Given input, when repaired, then it holds.',
    ].join('\n'), 'utf8');
    await persistFixturePrdAuditVerdict(projectRoot, [{
      criterion: { storyId: '5', ordinal: 1 }, criterionId: criterion, grade: 'FIXABLE',
      evidence: 'Missing implementation', rationale: 'Fixture repair.',
      requirementAssociations: [], evidenceTaskIds: ['1'], ownerTaskId: '1',
    }]);
    const runner: StepRunner = {
      run: async (_step, _state, options) => {
        await persistFixtureProjectedRemediationPlan(projectRoot, options, [{
          id: gapId, disposition: 'build', category: null,
          rationale: 'Repair the criterion-bound implementation.',
          tasks: [{ id: `rem-case-${gapId}`, title: 'Implement the criterion repair' }],
        }]);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
      config: { prd_audit: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 } } as never,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; target?: string; hint?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    // The validated projection keeps the canonical criterion spelling; a
    // case-variant provider reference never becomes a second gap identity.
    expect(outcome.hint).toContain(criterion);
    expect(await readFile(planPath, 'utf8')).toContain(`rem-case-${gapId}`);
  });

  it('does not route a foreign PRD reference that produces no typed plan', async () => {
    await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
      '# Stories', '', '## Story 5: remediation', '', '#### Happy Path',
      '- Given input, when repaired, then it holds.',
    ].join('\n'), 'utf8');
    await persistFixturePrdAuditVerdict(projectRoot, [{
      criterion: { storyId: '5', ordinal: 1 }, criterionId: 'S5.1', grade: 'FIXABLE',
      evidence: 'Missing implementation', rationale: 'Fixture repair.',
      requirementAssociations: [{ path: '.docs/specs/feature.md', requirementId: 'FR-S5.1' }],
      evidenceTaskIds: ['1'], ownerTaskId: '1',
    }]);
    const runner: StepRunner = {
      run: async () => ({ success: true }),
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );

    expect(outcome).toMatchObject({ kind: 'none' });
    expect(await readFile(planPath, 'utf8')).not.toContain('rem-invented');
  });

  it.each(['NC.1', 'nc.1'])(
    'does not route an owner-less PLAN_GAP-style append response for gap id %s',
    async (id) => {
      await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
      await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
        '# Stories', '', '## Story 5: remediation', '', '#### Happy Path',
        '- Given input, when repaired, then it holds.',
      ].join('\n'), 'utf8');
      await persistFixturePrdAuditVerdict(projectRoot, [{
        criterion: { storyId: '5', ordinal: 1 }, criterionId: 'S5.1', grade: 'PLAN_GAP',
        evidence: 'The approved plan has no owner for this work', rationale: 'Fixture plan gap.',
        requirementAssociations: [], evidenceTaskIds: [],
      }]);
      const runner: StepRunner = {
        run: async () => ({ success: true }),
      };
      const conductor = new Conductor({
        stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'), stepRunner: runner,
        events: new ConductorEventEmitter(), projectRoot, mode: 'auto', daemon: true,
        verifyArtifacts: false, maxRetries: 1,
      });

      const outcome = await (conductor as unknown as {
        planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; haltClass?: string; detail?: string }>;
      }).planRemediation(
        { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
        ALL_STEPS,
        'prd audit blocked',
        { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
      );

      expect(outcome).toMatchObject({ kind: 'none' });
      expect(await readFile(planPath, 'utf8')).not.toContain(`rem-ownerless-${id}`);
    },
  );

  it('does not route an unprojected answer when prd_audit has no admission keys', async () => {
    await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
      '# Stories', '', '## Story 5: remediation', '', '#### Happy Path',
      '- Given input, when repaired, then it holds.',
    ].join('\n'), 'utf8');
    await persistFixturePrdAuditVerdict(projectRoot, [{
      criterion: { storyId: '5', ordinal: 1 }, criterionId: 'S5.1', grade: 'PASS',
      evidence: 'Implementation is complete', rationale: 'Fixture pass.',
      requirementAssociations: [{ path: '.docs/specs/feature.md', requirementId: 'FR-S5.1' }],
      evidenceTaskIds: [],
    }]);
    const runner: StepRunner = {
      run: async () => ({ success: true }),
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );

    expect(outcome).toMatchObject({ kind: 'none' });
    expect(await readFile(planPath, 'utf8')).not.toContain('rem-unadmitted');
  });

  it('halts a taskless unprovenanced remediation instead of routing its target', async () => {
    const runner: StepRunner = {
      run: async (_step, _state, options) => {
        await persistFixtureTestRemediationPlan(projectRoot, options, [{
          id: 'INVENTED-9', disposition: 'architecture_review', category: null,
          rationale: 'Off-plan publication work.', tasks: [],
        }]);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'finish verification rejected an unprovenanced remediation',
      {
        source: 'finish-verification',
        evidence: [{ gate: 'finish' as StepName, evidenceFile: '.pipeline/finish-verification.md' }],
      },
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('no admitted remediation gap'),
    });
  });

  it.each([
    {
      source: 'build_stall',
      evidenceFile: '.pipeline/build-stall-question.md',
    },
    {
      source: 'build-stall',
      evidenceFile: '.pipeline/halt-user-input-required',
    },
  ])('preserves a taskless BUILD answer to an admitted $source build-stall question', async ({ source, evidenceFile }) => {
    const runner: StepRunner = {
      run: async (_step, _state, options) => {
        await persistFixtureRemediationPlan(projectRoot, options, {
          version: 'v1',
          dispositions: [{
            reference: { kind: 'stall', id: 'stall:validation-layer' },
            disposition: 'build', category: null,
            rationale: 'The committed boundary contract answers the stall question.',
            tasks: [], boundTaskIds: [],
          }],
        });
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
        hintSource: {
          source: string;
          evidence: Array<{ gate: StepName; evidenceFile: string }>;
        },
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      {
        session_started_at: Date.now() - 1_000,
        feature_desc: 'feature',
      } as ConductState,
      ALL_STEPS,
      'Remediate build stall: which validation boundary applies?',
      {
        source,
        evidence: [{ gate: 'build' as StepName, evidenceFile }],
      },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
  });

  it('halts an unadmitted taskless build_stall_zero_work remediation instead of routing raw fixes', async () => {
    const runner: StepRunner = {
      run: async (_step, _state, options) => {
        await persistFixtureRemediationPlan(projectRoot, options, {
          version: 'v1',
          dispositions: [{
            reference: { kind: 'stall', id: 'stall:validation-layer' },
            disposition: 'build', category: null,
            rationale: 'The committed boundary contract answers the stall question.',
            tasks: [], boundTaskIds: [],
          }],
        });
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
      'Remediate zero-work build stall: which validation boundary applies?',
      {
        source: 'build_stall_zero_work',
        evidenceFile: '.pipeline/build-stall-question.md',
      },
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('no admitted remediation gap'),
    });
  });

  it.each([
    {
      caseName: 'when build_stall carries no structured provenance',
      hintSource: {
        source: 'build_stall',
        evidenceFile: '.pipeline/build-stall-question.md',
      },
    },
    {
      caseName: 'when build_stall carries the build-stall evidence file',
      hintSource: {
        source: 'build_stall',
        evidence: [{ gate: 'build' as StepName, evidenceFile: '.pipeline/halt-user-input-required' }],
      },
    },
    {
      caseName: 'when build-stall carries the build_stall evidence file',
      hintSource: {
        source: 'build-stall',
        evidence: [{ gate: 'build' as StepName, evidenceFile: '.pipeline/build-stall-question.md' }],
      },
    },
    {
      caseName: 'when build_stall carries a non-build gate',
      hintSource: {
        source: 'build_stall',
        evidence: [{ gate: 'architecture_review_as_built' as StepName, evidenceFile: '.pipeline/build-stall-question.md' }],
      },
    },
    {
      caseName: 'when build_stall_zero_work carries canonical build provenance',
      hintSource: {
        source: 'build_stall_zero_work',
        evidence: [{ gate: 'build' as StepName, evidenceFile: '.pipeline/build-stall-question.md' }],
      },
    },
  ])('halts an unadmitted taskless build-stall remediation $caseName', async ({ hintSource }) => {
    const runner: StepRunner = {
      run: async (_step, _state, options) => {
        await persistFixtureRemediationPlan(projectRoot, options, {
          version: 'v1',
          dispositions: [{
            reference: { kind: 'stall', id: 'stall:validation-layer' },
            disposition: 'build', category: null,
            rationale: 'The committed boundary contract answers the stall question.',
            tasks: [], boundTaskIds: [],
          }],
        });
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

    const remediationState = {
      session_started_at: Date.now() - 1_000,
      feature_desc: 'feature',
    } as ConductState;
    (conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot = { ...remediationState };
    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: unknown,
      ) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      remediationState,
      ALL_STEPS,
      'Remediate build stall: which validation boundary applies?',
      hintSource,
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining(
        hintSource.evidence?.some((provenance) => provenance.gate === 'architecture_review_as_built')
          ? 'remediation projection input fault: source as-built verdict'
          : 'no admitted remediation gap',
      ),
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
    'halts an unprovenanced taskless remediation that names DECIDE target $target',
    async ({ id, target, rationale }) => {
      const dispatched: StepName[] = [];
      const runner: StepRunner = {
        run: async (step, _state, options) => {
          dispatched.push(step);
          await persistFixtureTestRemediationPlan(projectRoot, options, [{
            id,
            disposition: target,
            category: null,
            rationale,
            tasks: [],
          }]);
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
          hintSource: { source: string; evidence: Array<{ gate: StepName; evidenceFile: string }> },
        ) => Promise<{ kind: string; detail?: string }>;
      }).planRemediation(
        {
          session_started_at: Date.now() - 1_000,
          feature_desc: 'feature',
        } as ConductState,
        ALL_STEPS,
        'as-built architecture review blocked',
        {
          source: 'finish-verification',
          evidence: [{ gate: 'finish' as StepName, evidenceFile: '.pipeline/finish-verification.md' }],
        },
      );

      expect({ outcome, dispatched }).toMatchObject({
        outcome: {
          kind: 'halt',
          detail: expect.stringContaining('no admitted remediation gap'),
        },
        dispatched: ['remediate'],
      });
    },
  );
});

describe('build-stall remediation halt classes', () => {
  let projectRoot: string;
  let statePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'build-stall-remediation-halt-class-'));
    statePath = join(projectRoot, '.pipeline', 'conduct-state.json');
    await mkdir(join(projectRoot, '.docs/plans'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/plans/feature.md'), '# Plan\n\n### Task 1: repair\n', 'utf8');
    const state: Record<string, unknown> = {
      session_started_at: Date.now() - 1_000,
      feature_desc: 'feature',
      complexity_tier: 'S',
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'build') break;
      state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it.each([
    {
      name: 'a classified halt',
      outcome: { kind: 'halt', detail: 'Plan growth requires operator approval.', haltClass: 'kickback-cap' },
      haltClass: 'kickback-cap',
    },
    {
      name: 'an unclassified halt',
      outcome: { kind: 'halt', detail: 'A human decision is required.' },
      haltClass: 'needs-human',
    },
    {
      name: 'a route to a non-build step',
      outcome: { kind: 'route', target: 'plan', hint: 'wrong route', evidence: 'wrong route' },
      haltClass: 'needs-human',
    },
    {
      name: 'no valid remediation dispositions',
      outcome: { kind: 'none', reason: 'no valid dispositions' },
      haltClass: 'needs-human',
    },
  ])('writes needs-human unless remediation returns $name', async ({ outcome, haltClass }) => {
    const question = 'Which approved boundary should this repair use?';
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
          await writeFile(join(projectRoot, '.pipeline/halt-user-input-required'), question, 'utf8');
          await writeFile(
            join(projectRoot, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }),
            'utf8',
          );
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build',
    });
    (conductor as unknown as { planRemediation: unknown }).planRemediation = vi.fn().mockResolvedValue(outcome);

    await conductor.run();

    expect(await readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf8')).toBe(haltClass);
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8');
    expect(halt).toMatch(new RegExp(`^${question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    if (outcome.kind === 'halt') expect(halt).toContain(outcome.detail);
  });

  it('forwards the remediation halt class from the budget-gated post-retry build-stall halt', async () => {
    // Attempt 1 stalls on a halt marker and remediation routes back to build
    // (one round spent, no attempt burned). Attempt 2 makes task progress but
    // misses completion; with the progress bypass off, retries exhaust without a further in-loop dispatch.
    // The post-retry stall path then dispatches with budget left and halts.
    await writeFile(
      join(projectRoot, '.docs/plans/feature.md'),
      '# Plan\n\n### Task 1: repair\n\n### Task 2: finish\n',
      'utf8',
    );
    const question = 'Which approved boundary should this repair use?';
    let buildRuns = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          buildRuns++;
          await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
          if (buildRuns === 1) {
            await writeFile(join(projectRoot, '.pipeline/halt-user-input-required'), question, 'utf8');
          }
          await writeFile(
            join(projectRoot, '.pipeline/task-status.json'),
            JSON.stringify({
              tasks: ['1', '2'].map((id) => ({
                id,
                status: Number(id) < buildRuns ? 'completed' : 'pending',
              })),
            }),
            'utf8',
          );
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build',
      config: { build_progress_halt: { enabled: false } } as HarnessConfig,
    });
    const planRemediation = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'route', target: 'build', hint: 'use the approved boundary', evidence: 'answered' })
      .mockResolvedValue({ kind: 'halt', detail: 'Plan growth requires operator approval.', haltClass: 'kickback-cap' });
    (conductor as unknown as { planRemediation: unknown }).planRemediation = planRemediation;

    await conductor.run();

    expect(buildRuns).toBe(2);
    expect(planRemediation).toHaveBeenCalledTimes(2);
    expect(planRemediation.mock.calls[1][3]).toMatchObject({ source: 'build-stall' });
    expect(await readFile(join(projectRoot, '.pipeline/HALT.class'), 'utf8')).toBe('kickback-cap');
    const halt = await readFile(join(projectRoot, '.pipeline/HALT'), 'utf8');
    expect(halt).toContain('Plan growth requires operator approval.');
  });

  it('attributes a build-stall marker clear and its halt-record resolution to stall remediation', async () => {
    const question = 'Which approved boundary should this repair use?';
    const slug = basename(projectRoot);
    const recordPath = join(projectRoot, '.docs/halted', `${slug}.md`);
    await execa('git', ['init', '-q', '-b', 'feature'], { cwd: projectRoot });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: projectRoot });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: projectRoot });
    await mkdir(join(projectRoot, '.docs/halted'), { recursive: true });
    await writeFile(recordPath, `# Halt: ${slug}\n\nStatus: halted\nClass: needs-human\nStep: build\n`);
    await execa('git', ['add', '.'], { cwd: projectRoot });
    await execa('git', ['commit', '-q', '-m', 'seed halted record'], { cwd: projectRoot });

    const runner: StepRunner = {
      run: async (step) => {
        if (step === 'build') {
          await writeFile(join(projectRoot, '.pipeline/halt-user-input-required'), question, 'utf8');
          await writeFile(
            join(projectRoot, '.pipeline/task-status.json'),
            JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }),
            'utf8',
          );
        }
        return { success: true };
      },
    };
    const events = new ConductorEventEmitter();
    const haltClearedCauses: string[] = [];
    const haltClearAuthorizations: unknown[] = [];
    events.on('halt_cleared', (event) => {
      if (event.type === 'halt_cleared') haltClearedCauses.push(event.cause);
    });
    events.on('halt_clear_authorized', (event) => {
      if (event.type === 'halt_clear_authorized') haltClearAuthorizations.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build',
    });
    (conductor as unknown as { planRemediation: unknown }).planRemediation = vi.fn().mockResolvedValue({
      kind: 'halt', detail: 'Plan growth requires operator approval.', haltClass: 'kickback-cap',
    });

    await conductor.run();

    expect(haltClearedCauses).toEqual(['stall-remediation']);
    expect(haltClearedCauses).not.toContain('operator');
    expect(haltClearAuthorizations).toEqual([]);
    const record = await readFile(recordPath, 'utf8');
    expect(record).toContain('Status: resolved');
    expect(record).toContain('Resolution cause: stall-remediation');
    const { stdout: committedRecord } = await execa(
      'git', ['show', `HEAD:.docs/halted/${slug}.md`], { cwd: projectRoot },
    );
    expect(committedRecord).toContain('Resolution cause: stall-remediation');
  });
});
