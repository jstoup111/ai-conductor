import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Conductor,
  remediationLapCapForGate,
  type StepRunner,
} from '../src/engine/conductor.js';
import { readKickbackLedger, writeKickbackLedger } from '../src/engine/kickback-ledger.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import type { ConductState } from '../src/types/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const dirs: string[] = [];

async function createPrdAuditRemediationFixture(input: {
  taskCount: number;
  criteria: string[];
  config?: Record<string, unknown>;
  priorLaps?: number;
}) {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-kickback-'));
  dirs.push(root);
  const planPath = join(root, '.docs', 'plans', 'feature.md');
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  const plan = Array.from(
    { length: input.taskCount },
    (_, index) => `### Task ${index + 1}: authored work ${index + 1}\n`,
  ).join('\n');
  await writeFile(planPath, plan);
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
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
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
      hintSource: { source: string; evidenceFile: string },
    ) => Promise<{ kind: string; target?: string; detail?: string; haltClass?: string }>;
  }).planRemediation(
    { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
    ALL_STEPS,
    'prd audit blocked',
    { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' },
  );

  return { outcome, plan, planPath, root };
}

describe('prd_audit kickback', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('appends the first capped lap of FIXABLE work with criterion-bound completion checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prd-audit-kickback-'));
    dirs.push(root);
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    const plan = Array.from(
      { length: 20 },
      (_, index) => `### Task ${index + 1}: authored work ${index + 1}\n`,
    ).join('\n');
    await writeFile(planPath, plan);
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
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'feature' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'prd-audit', evidenceFile: '.pipeline/prd-audit.md' },
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
  });

  it('uses its configured lap cap even when the generic cap is unavailable', () => {
    expect(
      remediationLapCapForGate('prd_audit', { prd_audit: { max_remediation_laps: 1 } } as never, 0),
    ).toBe(1);
    expect(remediationLapCapForGate('manual_test', {} as never, 0)).toBe(0);
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
});
