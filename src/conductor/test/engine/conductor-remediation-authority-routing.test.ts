// Covers: task:7
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
    await writeFile(join(projectRoot, '.pipeline/accepted-widenings.json'), JSON.stringify({
      version: 1,
      decisions: [{
        criterion: 'S1.1', summary: 'Accepted scope objection', decision: 'accept',
        rationale: 'Operator accepted the completed scope.', operator: 'test',
        decidedAt: '2026-09-06T00:00:00.000Z',
      }],
    }), 'utf8');
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
    await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
      '**PRD:** none', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      `| ${criterion} | FIXABLE | 1 | none | Missing implementation |`,
    ].join('\n'), 'utf8');
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [{
            id: gapId, disposition: 'build', category: null,
            rationale: 'Repair the criterion-bound implementation.',
            tasks: [{ id: `rem-case-${gapId}`, title: 'Implement the criterion repair' }],
          }],
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
    expect(outcome.hint).toContain(gapId);
    expect(await readFile(planPath, 'utf8')).toContain(`rem-case-${gapId}`);
  });

  it('halts the FR-S5.1 non-match without prefix admission and names available criterion keys', async () => {
    await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
      '# Stories', '', '## Story 5: remediation', '', '#### Happy Path',
      '- Given input, when repaired, then it holds.',
    ].join('\n'), 'utf8');
    await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
      '**PRD:** present', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      '| S5.1 | FIXABLE | 1 | FR-S5.1 | Missing implementation |',
    ].join('\n'), 'utf8');
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'FR-S5.1', disposition: 'build', category: null,
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
      haltClass: 'kickback-cap',
      detail: expect.stringContaining('no admitted remediation gap'),
    });
    expect(outcome.detail).toContain('Rejected append-disposition gap IDs: FR-S5.1.');
    expect(outcome.detail).toContain('Available admission keys: S5.1.');
    expect(await readFile(planPath, 'utf8')).not.toContain('rem-invented');
  });

  it.each(['NC.1', 'nc.1'])(
    'halts the owner-less PLAN_GAP-style append disposition for gap id %s',
    async (id) => {
      await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
      await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
        '# Stories', '', '## Story 5: remediation', '', '#### Happy Path',
        '- Given input, when repaired, then it holds.',
      ].join('\n'), 'utf8');
      await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
        '**PRD:** none', '', '## Verdict Table',
        '| Criterion | Grade | Plan task | PRD: | Evidence |',
        '| --- | --- | --- | --- | --- |',
        '| S5.1 | PLAN_GAP | — | none | The approved plan has no owner for this work |',
        '', '## Findings without an owning criterion',
        '| Finding | Grade | Evidence |',
        '| --- | --- | --- |',
        '| NC.1 | OVER_SCOPE | No owning criterion admits remediation work |',
      ].join('\n'), 'utf8');
      const runner: StepRunner = {
        run: async () => {
          await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({
            dispositions: [{
              id, disposition: 'plan', category: null,
              rationale: 'Attempted plan growth without an admitting criterion.',
              tasks: [{ id: `rem-ownerless-${id}`, title: 'Append unowned plan work' }],
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
        planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; haltClass?: string; detail?: string }>;
      }).planRemediation(
        { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
        ALL_STEPS,
        'prd audit blocked',
        { source: 'prd-audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
      );

      expect(outcome).toMatchObject({
        kind: 'halt',
        haltClass: 'kickback-cap',
        detail: expect.stringContaining('no admitted remediation gap'),
      });
      expect(await readFile(planPath, 'utf8')).not.toContain(`rem-ownerless-${id}`);
    },
  );

  it('reports when a validated prd_audit report has no admission keys', async () => {
    await mkdir(join(projectRoot, '.docs/stories'), { recursive: true });
    await writeFile(join(projectRoot, '.docs/stories/feature.md'), [
      '# Stories', '', '## Story 5: remediation', '', '#### Happy Path',
      '- Given input, when repaired, then it holds.',
    ].join('\n'), 'utf8');
    await writeFile(join(projectRoot, '.pipeline/prd-audit.md'), [
      '**PRD:** present', '', '## Verdict Table',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '| --- | --- | --- | --- | --- |',
      '| S5.1 | PASS | — | FR-S5.1 | Implementation is complete |',
    ].join('\n'), 'utf8');
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(projectRoot, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'FR-S5.1', disposition: 'build', category: null,
            rationale: 'Attempted repair despite no FIXABLE finding.',
            tasks: [{ id: 'rem-unadmitted', title: 'Build an unadmitted repair' }],
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
    expect(outcome.detail).toContain('Rejected append-disposition gap IDs: FR-S5.1.');
    expect(outcome.detail).toContain('No admission keys were available.');
    expect(await readFile(planPath, 'utf8')).not.toContain('rem-unadmitted');
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
        source: 'architecture-review-as-built',
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
