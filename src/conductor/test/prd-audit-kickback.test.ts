import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import {
  Conductor,
  remediationLapCapForGate,
  routePrdAuditPlanGaps,
  routePrdAuditOverScope,
  type StepRunner,
} from '../src/engine/conductor.js';
import {
  acceptClearedOverScopeHalt,
  readAcceptedWidenings,
  renderOverScopeAcceptanceCandidate,
} from '../src/engine/accepted-widenings.js';
import { readGrowth, readKickbackLedger, writeKickbackLedger } from '../src/engine/kickback-ledger.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import { readState, writeState } from '../src/engine/state.js';
import type { ConductState, StepName } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';
import { DefaultStepRunner } from '../src/engine/step-runners.js';
import { PROTECTED_ARTIFACT_SEAL_PATH } from '../src/engine/protected-artifact-seal.js';

const dirs: string[] = [];

function planGapReport(criterion: string, summary = 'The approved plan has no task for this behavior.') {
  return [
    '**PRD:** present',
    '',
    '## Verdict Table',
    '| Criterion | Grade | Plan task | Evidence |',
    '| --- | --- | --- | --- |',
    `| ${criterion} | PLAN_GAP | | ${summary} |`,
  ].join('\n');
}

function storiesWithCriterion(section: 'Happy Path' | 'Negative Paths') {
  return [
    '# Stories',
    '',
    '## Story 2: behavior',
    '',
    `#### ${section}`,
    '- Given input, when exercised, then the expected behavior occurs.',
  ].join('\n');
}

function overScopeReport(
  criterion: string,
  relation: 'within' | 'outside-harmless' | 'outside-visible',
  summary = 'The change adds behavior beyond the approved plan.',
  includeIntentRelation = true,
) {
  const header = includeIntentRelation
    ? '| Criterion | Grade | Plan task | Evidence | Intent relation |'
    : '| Criterion | Grade | Plan task | Evidence |';
  const separator = includeIntentRelation
    ? '| --- | --- | --- | --- | --- |'
    : '| --- | --- | --- | --- |';
  const row = includeIntentRelation
    ? `| ${criterion} | OVER_SCOPE | | ${summary} | ${relation} |`
    : `| ${criterion} | OVER_SCOPE | | ${summary} |`;
  return [
    '**PRD:** present',
    '',
    '## Verdict Table',
    header,
    separator,
    row,
  ].join('\n');
}

async function createPrdAuditRemediationFixture(input: {
  taskCount: number;
  criteria: string[];
  config?: Record<string, unknown>;
  priorLaps?: number;
  report?: string;
}) {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-kickback-'));
  dirs.push(root);
  const planPath = join(root, '.docs', 'plans', 'feature.md');
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  const plan = Array.from(
    { length: input.taskCount },
    (_, index) => `### Task ${index + 1}: authored work ${index + 1}\n`,
  ).join('\n');
  await writeFile(planPath, plan);
  const maxOrdinal = Math.max(0, ...input.criteria.map((criterion) => Number(criterion.match(/^S2\.(\d+)$/)?.[1] ?? 0)));
  await writeFile(
    join(root, '.docs', 'stories', 'feature.md'),
    ['# Stories', '', '## Story 2: remediation', '', '#### Happy Path',
      ...Array.from({ length: maxOrdinal }, (_, index) => `- Given S2.${index + 1}, when repaired, then it holds.`),
    ].join('\n'),
  );
  await writeFile(
    join(root, '.pipeline', 'engine-state.json'),
    JSON.stringify({ activePlanPath: planPath }),
  );
  await writeFile(
    join(root, '.pipeline', 'prd-audit.md'),
    input.report ?? [
      '**PRD:** present',
      '',
      '## Verdict Table',
      '| Criterion | Grade | Plan task | Evidence |',
      '| --- | --- | --- | --- |',
      ...input.criteria.map(
        (criterion, index) =>
          `| ${criterion} | FIXABLE | ${index + 1} | Missing ${criterion} behavior |`,
      ),
    ].join('\n'),
  );
  if (input.priorLaps !== undefined) {
    await writeKickbackLedger(root, {
      version: 1,
      gates: {
        prd_audit: {
          count: 0,
          cumulative: 0,
          treeHash: null,
          lastReason: '',
          priorVerdict: true,
          resolvedBefore: 0,
          laps: input.priorLaps,
        },
      },
    } as never);
  }

  const runner: StepRunner = {
    run: async () => {
      await writeFile(
        join(root, '.pipeline', 'remediation.json'),
        JSON.stringify({
          dispositions: input.criteria.map((criterion) => ({
            id: criterion,
            disposition: 'build',
            category: null,
            rationale: `Repair ${criterion}.`,
            tasks: [{ id: `rem-${criterion.toLowerCase()}`, title: `Repair ${criterion}` }],
          })),
        }),
      );
      return { success: true };
    },
  };
  const events = new ConductorEventEmitter();
  const gateBlocks: Array<{ step: string; reason: string }> = [];
  events.on('gate_blocked', (event) => {
    if (event.type === 'gate_blocked') {
      gateBlocks.push({ step: event.step, reason: event.reason });
    }
  });
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: runner,
    events,
    projectRoot: root,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: false,
    maxRetries: 1,
    config: { prd_audit: { max_remediation_laps: 1, ...input.config } } as never,
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
    ) => Promise<{ kind: string; target?: string; detail?: string; haltClass?: string }>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
    ALL_STEPS,
    'prd audit blocked',
    {
      source: 'prd-audit',
      evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }],
    },
  );

  return { outcome, plan, planPath, root, gateBlocks };
}

describe('prd_audit kickback', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function runGroupedPrdAudit(report: string, stories: string) {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-group-route-'));
    dirs.push(root);
    const statePath = join(root, '.pipeline', 'conduct-state.json');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    await writeFile(join(root, '.docs', 'stories', 'feature.md'), stories);
    await writeFile(
      join(root, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );

    const state: Record<string, unknown> = {
      feature_desc: 'feature',
      complexity_tier: 'M',
      track: 'product',
      run_started_at: Date.now() - 1_000,
      retro: 'done',
      rebase: 'done',
      finish: 'done',
    };
    for (const step of ALL_STEPS) {
      if (step.name === 'manual_test') break;
      state[step.name] = 'done';
    }
    await writeState(statePath, state as ConductState);

    const calls: StepName[] = [];
    const runner: StepRunner = {
      run: async (step) => {
        calls.push(step);
        if (step === 'manual_test') {
          await writeFile(
            join(root, '.pipeline', 'manual-test-results.md'),
            '# Results\n\n| Story | Result |\n|--|--|\n| s1 | PASS |\n',
          );
        } else if (step === 'prd_audit') {
          await writeFile(join(root, '.pipeline', 'prd-audit.md'), report);
          if (report.includes('S13.4')) {
            await writeFile(join(root, '.pipeline', 's13.4-probe-file'), 'keep this review finding\n');
          }
        } else if (step === 'architecture_review_as_built') {
          await writeFile(
            join(root, '.pipeline', 'architecture-review-as-built.md'),
            '# As-Built Architecture Review\n\n**Verdict:** APPROVED\n',
          );
        }
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'manual_test',
    });
    await conductor.run();
    return { root, calls, state: await readState(statePath) };
  }

  it('appends the first capped lap of FIXABLE work with criterion-bound completion checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-kickback-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.docs', 'stories'), { recursive: true });
    const plan = Array.from(
      { length: 20 },
      (_, index) => `### Task ${index + 1}: authored work ${index + 1}\n`,
    ).join('\n');
    await writeFile(planPath, plan);
    await writeFile(join(root, '.docs', 'stories', 'feature.md'), [
      '# Stories', '', '## Story 2: remediation', '', '#### Happy Path',
      '- Given S2.1, when repaired, then it holds.',
      '- Given S2.2, when repaired, then it holds.',
      '- Given S2.3, when repaired, then it holds.',
    ].join('\n'));
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
    );
    await writeFile(
      join(root, '.pipeline', 'prd-audit.md'),
      [
        '**PRD:** present',
        '',
        '## Verdict Table',
        '| Criterion | Grade | Plan task | Evidence |',
        '| --- | --- | --- | --- |',
        '| S2.1 | FIXABLE | 4 | Missing first behavior |',
        '| S2.2 | FIXABLE | 5 | Missing second behavior |',
        '| S2.3 | FIXABLE | 6 | Missing third behavior |',
      ].join('\n'),
    );

    const runner: StepRunner = {
      run: async () => {
        await writeFile(
          join(root, '.pipeline', 'remediation.json'),
          JSON.stringify({
            dispositions: ['S2.1', 'S2.2', 'S2.3'].map((criterion) => ({
              id: criterion,
              disposition: 'build',
              category: null,
              rationale: `Repair ${criterion}.`,
              tasks: [{ id: `rem-${criterion.toLowerCase()}`, title: `Repair ${criterion}` }],
            })),
          }),
        );
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
      config: { prd_audit: { max_remediation_laps: 1 } } as never,
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
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      {
        source: 'prd-audit',
        evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }],
      },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });
    const appendedPlan = await readFile(planPath, 'utf8');
    for (const [criterion, parentTask] of [['S2.1', 4], ['S2.2', 5], ['S2.3', 6]] as const) {
      expect(appendedPlan).toContain(`**Criterion:** ${criterion}`);
      expect(appendedPlan).toContain(`**Parent task:** ${parentTask}`);
      expect(appendedPlan).toContain(`**Done when:**\n- ${criterion} is satisfied by this task.`);
    }
    const ledger = await readKickbackLedger(root);
    expect((ledger.gates.prd_audit as { laps?: number } | undefined)?.laps).toBe(1);
    expect(ledger.growth).toMatchObject({ added: 3, byGate: { prd_audit: 3 } });
  });

  it('halts a non-prd_audit task append without consuming prd_audit allowance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-cross-gate-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(planPath, [
      '### Task 1: authored', '### Task 2: authored', '### Task rem-prd: recorded prd addition',
    ].join('\n'));
    await writeFile(join(root, '.pipeline/engine-state.json'), JSON.stringify({ activePlanPath: planPath }));
    await writeKickbackLedger(root, {
      version: 1,
      gates: {},
      growth: { authored: 2, added: 1, byGate: { prd_audit: 1 } },
    });
    const runner: StepRunner = {
      run: async () => {
        await writeFile(join(root, '.pipeline/remediation.json'), JSON.stringify({
          dispositions: [{
            id: 'arch-gap', disposition: 'build', category: null, rationale: 'Foreign append.',
            tasks: [{ id: 'rem-arch', title: 'Unbounded architecture task' }],
          }],
        }));
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(root, '.pipeline/conduct-state.json'), stepRunner: runner,
      events: new ConductorEventEmitter(), projectRoot: root, mode: 'auto', daemon: true,
      verifyArtifacts: false, maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (state: ConductState, steps: typeof ALL_STEPS, dispatchContext: string, hintSource: unknown) => Promise<{ kind: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'as-built blocked',
      { source: 'as-built', evidence: [{ gate: 'architecture_review_as_built', evidenceFile: '.pipeline/architecture-review-as-built.md' }] },
    );

    expect(outcome).toMatchObject({
      kind: 'halt',
      detail: expect.stringContaining('no plan-growth allowance'),
    });
    expect(await readFile(planPath, 'utf8')).not.toContain('rem-arch');
    await expect(readGrowth(root, 4)).resolves.toEqual({
      authored: 2, added: 1, byGate: { prd_audit: 1 }, remaining: 3,
    });
  });

  it('uses its configured lap cap even when the generic cap is unavailable', () => {
    expect(
      remediationLapCapForGate('prd_audit', { prd_audit: { max_remediation_laps: 1 } } as never, 0),
    ).toBe(1);
    expect(remediationLapCapForGate('manual_test', {} as never, 0)).toBe(0);
  });

  it('halts a malformed PRD-audit report before remediation can append its task', async () => {
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 1,
      criteria: ['S2.1'],
      report: [
        '**PRD:** present',
        '',
        '## Verdict Table',
        '| Criterion | Grade | Plan task | Evidence |',
        '| --- | --- | --- | --- |',
        '| S2.1 | MAYBE | 1 | Missing behavior |',
      ].join('\n'),
    });

    expect(fixture.outcome).toMatchObject({
      kind: 'halt',
      haltClass: 'mechanical',
      detail: 'PRD audit report mechanical fault: PRD audit finding S2.1 has an invalid Grade.',
    });
    expect(fixture.gateBlocks).toEqual([{
      step: 'prd_audit',
      reason: 'PRD audit report mechanical fault: PRD audit finding S2.1 has an invalid Grade.',
    }]);
    expect(await readFile(fixture.planPath, 'utf8')).toBe(fixture.plan);
  });

  it('halts without appending when FIXABLE work exceeds the growth cap, listing every finding', async () => {
    const criteria = ['S2.1', 'S2.2', 'S2.3', 'S2.4'];
    const fixture = await createPrdAuditRemediationFixture({ taskCount: 12, criteria });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'kickback-cap' });
    expect(fixture.outcome.detail).toContain('growth cap');
    for (const criterion of criteria) expect(fixture.outcome.detail).toContain(criterion);
    expect(await readFile(fixture.planPath, 'utf8')).toBe(fixture.plan);
  });

  it('halts a second prd_audit lap without appending and lists the new finding', async () => {
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 12,
      criteria: ['S2.5'],
      priorLaps: 1,
    });

    expect(fixture.outcome).toMatchObject({ kind: 'halt', haltClass: 'kickback-cap' });
    expect(fixture.outcome.detail).toContain('S2.5');
    expect(await readFile(fixture.planPath, 'utf8')).toBe(fixture.plan);
  });

  it('honors a raised configurable growth cap before appending every FIXABLE task', async () => {
    const criteria = ['S2.1', 'S2.2', 'S2.3', 'S2.4', 'S2.5', 'S2.6'];
    const fixture = await createPrdAuditRemediationFixture({
      taskCount: 20,
      criteria,
      config: { max_appended_tasks: 8, max_appended_ratio: 0.5 },
    });

    expect(fixture.outcome).toMatchObject({ kind: 'route', target: 'build' });
    const appended = await readFile(fixture.planPath, 'utf8');
    for (const criterion of criteria) expect(appended).toContain(`**Criterion:** ${criterion}`);
    expect(appended.match(/^\*\*Criterion:\*\*/gm)).toHaveLength(6);
  });

  it('halts a PLAN_GAP for a happy-path criterion with a plan-gap class', () => {
    const route = routePrdAuditPlanGaps(
      planGapReport('S2.1'),
      storiesWithCriterion('Happy Path'),
      {} as never,
    );

    expect(route).toMatchObject({ kind: 'halt', haltClass: 'plan-gap' });
    if (route.kind !== 'halt') throw new Error('expected happy-path plan gap to halt');
    expect(route.detail).toContain('S2.1');
  });

  it('records a negative-path PLAN_GAP finding and lets the gate pass', () => {
    const route = routePrdAuditPlanGaps(
      planGapReport('S2.1', 'An edge case is not in the approved plan.'),
      storiesWithCriterion('Negative Paths'),
      {} as never,
    );

    expect(route).toMatchObject({
      kind: 'record',
      findings: [{
        grade: 'PLAN_GAP',
        criterion: 'S2.1',
        summary: 'An edge case is not in the approved plan.',
        gate: 'prd_audit',
      }],
    });
  });

  it('treats an unclassifiable PLAN_GAP criterion as happy-path and halts', () => {
    const route = routePrdAuditPlanGaps(planGapReport('S2.3'), '# Stories\n', {} as never);

    expect(route).toMatchObject({ kind: 'halt', haltClass: 'plan-gap' });
  });

  it('uses the finding story and ordinal when another story has the same criterion prose', () => {
    const sharedCriterion = 'Given a request, when it is malformed, then the engine refuses it.';
    const stories = [
      '# Stories',
      '',
      '## Story 1: primary flow',
      '',
      '#### Happy Path',
      `- ${sharedCriterion}`,
      '',
      '## Story 2: edge flow',
      '',
      '#### Negative Paths',
      `- ${sharedCriterion}`,
    ].join('\n');

    const route = routePrdAuditPlanGaps(planGapReport('S2.1'), stories, {} as never);

    expect(route).toMatchObject({
      kind: 'record',
      findings: [expect.objectContaining({ criterion: 'S2.1', grade: 'PLAN_GAP' })],
    });
  });

  it('halts a negative-path PLAN_GAP when halt_on_any_plan_gap is enabled', () => {
    const route = routePrdAuditPlanGaps(
      planGapReport('S2.1'),
      storiesWithCriterion('Negative Paths'),
      { prd_audit: { halt_on_any_plan_gap: true } } as never,
    );

    expect(route).toMatchObject({ kind: 'halt', haltClass: 'plan-gap' });
  });

  it('records an in-intent OVER_SCOPE finding as an accepted widening and passes', () => {
    const route = routePrdAuditOverScope(overScopeReport('S3.1', 'within'), []);

    expect(route).toMatchObject({
      kind: 'record',
      findings: [{ grade: 'OVER_SCOPE', criterion: 'S3.1', accepted: true }],
    });
  });

  it('records a harmless out-of-intent OVER_SCOPE finding and passes', () => {
    const route = routePrdAuditOverScope(overScopeReport('S3.2', 'outside-harmless'), []);

    expect(route).toMatchObject({
      kind: 'record',
      findings: [{ grade: 'OVER_SCOPE', criterion: 'S3.2', accepted: false }],
    });
  });

  it('halts a visible out-of-intent OVER_SCOPE finding with its own class', () => {
    const route = routePrdAuditOverScope(overScopeReport('S3.3', 'outside-visible'), []);

    expect(route).toMatchObject({ kind: 'halt', haltClass: 'over-scope' });
  });

  it('joins a negative-path PLAN_GAP as a recorded, satisfied prd_audit member', async () => {
    const stories = [
      '# Stories', '', '## Story 11: negative boundary', '', '#### Negative Paths',
      '- Given an unsupported condition, when it occurs, then it is recorded.',
    ].join('\n');
    const fixture = await runGroupedPrdAudit(planGapReport('S11.1'), stories);

    expect(fixture.calls).not.toContain('remediate');
    expect(fixture.state.ok && fixture.state.value.prd_audit).toBe('done');
    expect(await readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8')).toContain(
      '"grade": "PLAN_GAP"',
    );
  });

  it('joins a within-intent OVER_SCOPE finding as a recorded, satisfied prd_audit member', async () => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport('S9.1', 'within'),
      storiesWithCriterion('Happy Path'),
    );

    expect(fixture.calls).not.toContain('remediate');
    expect(fixture.state.ok && fixture.state.value.prd_audit).toBe('done');
    expect(await readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8')).toContain(
      '"accepted": true',
    );
  });

  it('records the S13.4 outside-harmless probe-file finding without deleting its evidence', async () => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport(
        'S13.4',
        'outside-harmless',
        'Unadmitted .pipeline/s13.4-probe-file is outside intent but harmless.',
      ),
      storiesWithCriterion('Happy Path'),
    );

    expect(fixture.calls).not.toContain('remediate');
    expect(fixture.state.ok && fixture.state.value.prd_audit).toBe('done');
    await expect(readFile(join(fixture.root, '.pipeline', 's13.4-probe-file'), 'utf8')).resolves.toBe(
      'keep this review finding\n',
    );
    expect(await readFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'utf8')).toContain(
      '"criterion": "S13.4"',
    );
  });

  it('halts a grouped outside-visible OVER_SCOPE finding with the serial over-scope class', async () => {
    const fixture = await runGroupedPrdAudit(
      overScopeReport('S9.6', 'outside-visible'),
      storiesWithCriterion('Happy Path'),
    );

    expect(fixture.calls).not.toContain('remediate');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('over-scope');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'user-visible scope requires operator acceptance',
    );
  });

  it('requires the explicit Intent relation field instead of inferring within intent from evidence', () => {
    const route = routePrdAuditOverScope(
      overScopeReport('S3.4', 'within', 'within', false),
      [],
    );

    expect(route).toEqual({ kind: 'none' });
  });

  it('records an operator acceptance from a cleared over-scope halt and regrades it within intent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accepted-widenings-'));
    dirs.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const report = overScopeReport('S3.4', 'outside-visible', 'A visible optional feature.');
    await writeFile(
      join(root, '.pipeline', 'HALT.cleared'),
      `prd-audit halted\n\n${renderOverScopeAcceptanceCandidate({
        criterion: 'S3.4',
        summary: 'A visible optional feature.',
      })}\n`,
    );

    await acceptClearedOverScopeHalt(root);
    const accepted = await readAcceptedWidenings(root);
    expect(accepted.entries).toHaveLength(1);
    expect(routePrdAuditOverScope(report, accepted.entries)).toMatchObject({
      kind: 'record',
      findings: [{ criterion: 'S3.4', accepted: true }],
    });
  });

  it('passes reseal and feature-commit Scope rationale evidence into the prd_audit prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-scope-prompt-'));
    dirs.push(root);
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
    await writeFile(join(root, 'base.ts'), 'export const base = true;\n');
    await execa('git', ['add', 'base.ts'], { cwd: root });
    await execa('git', ['commit', '-q', '-m', 'base'], { cwd: root });
    await writeFile(join(root, 'optional.ts'), 'export const optional = true;\n');
    await execa('git', ['add', 'optional.ts'], { cwd: root });
    await execa('git', [
      'commit',
      '-q',
      '-m',
      'add optional behavior\n\nScope: optional.ts — supports the optional behavior',
    ], { cwd: root });
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, PROTECTED_ARTIFACT_SEAL_PATH),
      JSON.stringify({
        version: 2,
        baselineCommit: 'baseline',
        protectedArtifacts: [],
        rebaselines: [{
          fromCommit: 'before',
          toCommit: 'after',
          trigger: 'operator-reseal',
          paths: ['.docs/plans/feature.md'],
          reason: 'corrected plan',
        }],
      }),
    );
    const invokeInteractive = vi.fn().mockResolvedValue(undefined);
    const runner = new DefaultStepRunner({
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(),
      invokeInteractive,
    }, 'session', root, { pipelineDir: join(root, '.pipeline') });

    await runner.run('prd_audit', {});

    const prompt = invokeInteractive.mock.calls[0][0].systemPrompt as string;
    expect(prompt).toContain('PRD-AUDIT SCOPE EVIDENCE');
    expect(prompt).toContain('.docs/plans/feature.md');
    expect(prompt).toContain('corrected plan');
    expect(prompt).toContain('optional.ts');
    expect(prompt).toContain('supports the optional behavior');
  });
});
