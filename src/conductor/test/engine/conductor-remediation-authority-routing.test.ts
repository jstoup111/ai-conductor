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

  type RemediationOutcome = {
    kind: string;
    target?: StepName;
    hint?: string;
    evidence?: string;
    detail?: string;
    haltClass?: string;
  };

  const prdAuditSource = {
    source: 'prd-audit',
    evidence: [{ gate: 'prd_audit' as StepName, evidenceFile: '.pipeline/prd-audit.md' }],
  };
  const asBuiltSource = {
    source: 'as-built architecture review',
    evidence: [{
      gate: 'architecture_review_as_built' as StepName,
      evidenceFile: '.pipeline/architecture-review-as-built.md',
    }],
  };
  const finishSource = {
    source: 'finish-verification',
    evidence: [{ gate: 'finish' as StepName, evidenceFile: '.pipeline/test-failures.md' }],
  };

  async function preparePrdAuditAuthorityFixture(): Promise<void> {
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
    await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
      '**PRD:** present', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      '| S1.1 | FIXABLE | 1 | FR-7 | Missing implementation |',
    ].join('\n'), 'utf8');
  }

  async function driveRemediation(
    dispositions: unknown[],
    hintSource: unknown,
  ): Promise<{ outcome: RemediationOutcome; plan: string }> {
    const runner: StepRunner = {
      run: async () => {
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
      config: {
        prd_audit: {
          max_remediation_laps: 3,
          max_appended_tasks: 5,
          max_appended_ratio: 1,
        },
      } as never,
    });
    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        source: unknown,
      ) => Promise<RemediationOutcome>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'remediation authority routing',
      hintSource,
    );
    return { outcome, plan: await readFile(planPath, 'utf8') };
  }

  it('rejects an ADR-keyed remediation task from a gate without a growth allowance', async () => {
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

  it('does not route an ordinary taskless BUILD disposition', async () => {
    const runner: StepRunner = {
      run: async () => {
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'adr-2026-07-27-provider-lifecycle',
                disposition: 'build',
                category: null,
                rationale: 'Implementation drift needs a concrete correction.',
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
      ) => Promise<{ kind: string; target?: string; detail?: string }>;
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

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('ordinary BUILD disposition with no concrete task'),
    });
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
    await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
      '**PRD:** present', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      '| S1.1 | FIXABLE | 1 | FR-7 | Missing implementation |',
    ].join('\n'), 'utf8');
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [
            {
              id: 'FR-7', disposition: 'build', category: null,
              rationale: 'Repair the authorized criterion.',
              tasks: [{ id: 'rem-authorized', title: 'Implement the authorized repair' }],
            },
            {
              id: 'FR-42', disposition: 'build', category: null,
              rationale: 'Invented unmatched work.',
              tasks: [{ id: 'rem-unmatched', title: 'Implement the unmatched repair' }],
            },
          ],
        }), 'utf8');
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
    expect(outcome.hint).toContain('FR-7');
    expect(outcome.hint).not.toContain('FR-42');
    const plan = await readFile(planPath, 'utf8');
    expect(plan).toContain('rem-authorized');
    expect(plan).not.toContain('rem-unmatched');
  });

  it('halts an all-unbound prd_audit remediation instead of sending it to BUILD', async () => {
    await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
      '# Stories', '', '## Story 1: remediation', '', '#### Happy Path',
      '- Given input, when repaired, then it holds.',
    ].join('\n'), 'utf8');
    await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
      '**PRD:** present', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      '| S1.1 | FIXABLE | 1 | FR-7 | Missing implementation |',
    ].join('\n'), 'utf8');
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'INVENTED-9', disposition: 'build', category: null,
            rationale: 'Off-plan telemetry work.',
            tasks: [{ id: 'rem-invented', title: 'Build off-plan telemetry' }],
          }],
        }), 'utf8');
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
      'prd audit blocked',
      { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('no admitted remediation gap'),
    });
    expect(await readFile(planPath, 'utf8')).not.toContain('rem-invented');
  });

  it('halts a taskless unbound as-built remediation instead of routing its target', async () => {
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'INVENTED-9', disposition: 'architecture_review', category: null,
            rationale: 'Off-plan publication work.', tasks: [],
          }],
        }), 'utf8');
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
      'as-built architecture review blocked',
      {
        source: 'as-built architecture review',
        evidence: [{
          gate: 'architecture_review_as_built',
          evidenceFile: '.pipeline/architecture-review-as-built.md',
        }],
      },
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('no admitted remediation gap'),
    });
  });

  it('routes only the admitted prd_audit gap when a mixed plan also names an unbound DECIDE gap', async () => {
    await preparePrdAuditAuthorityFixture();

    const { outcome, plan } = await driveRemediation([
      {
        id: 'FR-7', disposition: 'build', category: null,
        rationale: 'Repair the authorized criterion.',
        tasks: [{ id: 'rem-mixed-authorized', title: 'Implement the authorized repair' }],
      },
      {
        id: 'FR-99', disposition: 'plan', category: null,
        rationale: 'The approved plan omits an in-scope need entirely.', tasks: [],
      },
    ], prdAuditSource);

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    expect(outcome.hint).toContain('FR-7');
    expect(outcome.hint).not.toContain('FR-99');
    expect(plan).toContain('rem-mixed-authorized');
  });

  it('halts an as-built publication mix when its unadmitted BUILD gap requests plan growth', async () => {
    const { outcome, plan } = await driveRemediation([
      {
        id: 'G-1', disposition: 'publication', category: null,
        rationale: 'Repair the pull request prose.', tasks: [],
      },
      {
        id: 'G-2', disposition: 'build', category: null,
        rationale: 'Perform off-plan code work.',
        tasks: [{ id: 'rem-as-built-unadmitted', title: 'Perform off-plan code work' }],
      },
    ], asBuiltSource);

    expect(outcome).toMatchObject({
      kind: 'halt',
      haltClass: 'kickback-cap',
      detail: expect.stringContaining('no plan-growth allowance'),
    });
    expect(plan).not.toContain('rem-as-built-unadmitted');
  });

  it('routes only publication in an as-built mix with an unadmitted taskless gap', async () => {
    const { outcome } = await driveRemediation([
      {
        id: 'G-1', disposition: 'publication', category: null,
        rationale: 'Repair the pull request prose.', tasks: [],
      },
      {
        id: 'G-2', disposition: 'acceptance_specs', category: null,
        rationale: 'Perform off-plan acceptance-spec work.', tasks: [],
      },
    ], asBuiltSource);

    expect(outcome).toMatchObject({
      kind: 'route',
      target: 'finish',
      evidence: 'G-1→publication',
    });
    expect(outcome.hint).toContain('G-1 [publication]');
    expect(outcome.hint).not.toContain('G-2');
  });

  it.each([
    {
      caseName: 'taskless acceptance-spec work',
      disposition: 'acceptance_specs',
      tasks: [],
      detail: 'no admitted remediation gap',
      taskId: undefined,
    },
    {
      caseName: 'taskless BUILD work',
      disposition: 'build',
      tasks: [],
      detail: 'ordinary BUILD disposition with no concrete task',
      taskId: undefined,
    },
    {
      caseName: 'tasked BUILD work',
      disposition: 'build',
      tasks: [{ id: 'rem-finish-unadmitted', title: 'Repair the failing test' }],
      detail: 'no plan-growth allowance',
      taskId: 'rem-finish-unadmitted',
    },
  ])('halts finish-verification remediation that requests $caseName', async ({ disposition, tasks, detail, taskId }) => {
    const { outcome, plan } = await driveRemediation([
      {
        id: 'TEST-FAIL-1', disposition, category: null,
        rationale: 'Repair the failing verification.', tasks,
      },
    ], finishSource);

    expect(outcome).toMatchObject({ kind: 'halt', detail: expect.stringContaining(detail) });
    if (taskId !== undefined) expect(plan).not.toContain(taskId);
  });

  it('uses prd_audit criterion authority when validation-group provenance includes multiple gates', async () => {
    await preparePrdAuditAuthorityFixture();
    const validationGroupSource = {
      source: 'validation-group',
      evidence: [
        ...prdAuditSource.evidence,
        ...asBuiltSource.evidence,
      ],
    };

    const { outcome, plan } = await driveRemediation([
      {
        id: 'FR-7', disposition: 'build', category: null,
        rationale: 'Repair the authorized criterion.',
        tasks: [{ id: 'rem-validation-group', title: 'Implement the authorized repair' }],
      },
    ], validationGroupSource);

    expect(outcome).toMatchObject({ kind: 'route', target: 'build', evidence: 'FR-7→build' });
    expect(plan).toContain('rem-validation-group');
  });

  it.each([
    { caseName: 'prd_audit', source: prdAuditSource, id: 'ANYTHING-GOES' },
    { caseName: 'as-built review', source: asBuiltSource, id: 'G-1' },
  ])('routes an admitted publication-only $caseName remediation to finish', async ({ source, id }) => {
    await preparePrdAuditAuthorityFixture();

    const { outcome } = await driveRemediation([
      {
        id, disposition: 'publication', category: null,
        rationale: 'Repair the pull request prose only.', tasks: [],
      },
    ], source);

    expect(outcome).toMatchObject({
      kind: 'route',
      target: 'finish',
      evidence: `${id}→publication`,
    });
    expect(outcome.hint).toContain('implementation is complete and must not change');
  });

  it('matches lowercase prd_audit gap ids to their uppercase criterion authority', async () => {
    await preparePrdAuditAuthorityFixture();

    const { outcome, plan } = await driveRemediation([
      {
        id: 'fr-7', disposition: 'build', category: null,
        rationale: 'Repair the authorized criterion.',
        tasks: [{ id: 'rem-lowercase', title: 'Implement the authorized repair' }],
      },
    ], prdAuditSource);

    expect(outcome).toMatchObject({ kind: 'route', target: 'build', evidence: 'fr-7→build' });
    expect(plan).toContain('rem-lowercase');
  });

  it('halts mechanically when prd_audit provenance points to a missing authorization artifact', async () => {
    await preparePrdAuditAuthorityFixture();
    await rm(join(projectRoot, '.pipeline/prd-audit.md'));

    const { outcome, plan } = await driveRemediation([
      {
        id: 'FR-7', disposition: 'build', category: null,
        rationale: 'Repair the authorized criterion.',
        tasks: [{ id: 'rem-stale-artifact', title: 'Implement the authorized repair' }],
      },
    ], prdAuditSource);

    expect(outcome).toMatchObject({
      kind: 'halt',
      haltClass: 'mechanical',
      detail: expect.stringContaining('could not be read for remediation authorization'),
    });
    expect(plan).not.toContain('rem-stale-artifact');
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
      run: async () => {
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'stall:validation-layer',
                disposition: 'build',
                category: null,
                rationale: 'The committed boundary contract answers the stall question.',
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
      run: async () => {
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'stall:validation-layer',
                disposition: 'build',
                category: null,
                rationale: 'The committed boundary contract answers the stall question.',
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
      run: async () => {
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'stall:validation-layer',
                disposition: 'build',
                category: null,
                rationale: 'The committed boundary contract answers the stall question.',
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
        hintSource: unknown,
      ) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      {
        session_started_at: Date.now() - 1_000,
        feature_desc: 'feature',
      } as ConductState,
      ALL_STEPS,
      'Remediate build stall: which validation boundary applies?',
      hintSource,
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('no admitted remediation gap'),
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
          detail: expect.stringContaining('no admitted remediation gap'),
        },
        dispatched: ['remediate'],
      });
    },
  );
});
