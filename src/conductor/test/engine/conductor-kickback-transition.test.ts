// Covers: task:1, task:3, task:4, task:5, task:6, task:12, task:rem-prd-audit-11-r3
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOutcomeRung, Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { dispatchKickbackBudgetCommand } from '../../src/engine/kickback-budget-cli.js';
import { readKickbackLedger, type KickbackLedger, type PendingRepair } from '../../src/engine/kickback-ledger.js';
import type { BuildOutcomeStore } from '../../src/engine/build-outcome.js';
import { sameNoOpCycle } from '../../src/engine/build-outcome.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { writeKickbackLedger } from '../kickback-ledger-test-support.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import * as protectedArtifactSeal from '../../src/engine/protected-artifact-seal.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import {
  persistFixtureProjectedRemediationPlan,
  persistFixtureRemediationPlan,
} from './remediation-plan-fixtures.js';

describe('BUILD pending-repair settlement transition (Task 6)', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-kickback-transition-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  const entry = (laps = 0) => ({
    count: 0, cumulative: 0, laps, treeHash: null,
    lastReason: 'blocking finding', priorVerdict: true, resolvedBefore: 0,
  });

  const asBuiltFindings = [
    {
      gate: 'architecture_review_as_built' as const,
      finding: 'as-built:a:1',
      class: 'REMEDIABLE' as const,
      governingClause: 'Task 5',
      summary: 'first as-built finding',
      outcome: 'remediated' as const,
    },
    {
      gate: 'architecture_review_as_built' as const,
      finding: 'as-built:a:2',
      class: 'REMEDIABLE' as const,
      governingClause: 'Task 5',
      summary: 'second as-built finding',
      outcome: 'remediated' as const,
    },
  ];

  async function runBuild(
    pendingRepair: PendingRepair | unknown,
    ledger: Omit<KickbackLedger, 'pendingRepair'>,
    options: {
      refuseAtProtectedArtifact?: boolean;
      buildOutcome?: BuildOutcomeStore;
      treeHash?: string | null;
      effort?: 'low' | 'medium' | 'high';
      growthCap?: number;
      authoredTasks?: number;
      buildResult?: { success: true; model?: string; effort?: 'low' | 'medium' | 'high' };
      activeRegionChild?: number;
      complexityTier?: 'S' | 'M' | 'L';
      remediationCaps?: {
        prdAudit?: number | Partial<Record<'S' | 'M' | 'L', number>>;
        asBuilt?: number | Partial<Record<'S' | 'M' | 'L', number>>;
      };
    } = {},
  ): Promise<{
    build: ReturnType<typeof vi.fn>;
  }> {
    await writeState(statePath, {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      build: 'pending',
      session_started_at: Date.now() - 1_000,
      run_started_at: Date.now() - 1_000,
      feature_desc: 'transition',
      ...(options.complexityTier === undefined ? {} : { complexity_tier: options.complexityTier }),
    });
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: 'rem-1', status: 'pending' }],
    }));
    if (options.authoredTasks !== undefined) {
      await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
      await writeFile(join(dir, '.docs', 'plans', 'transition.md'), Array.from(
        { length: options.authoredTasks },
        (_, index) => `### Task ${index + 1}: Authored work`,
      ).join('\n'));
    }
    await writeKickbackLedger(dir, { ...ledger, pendingRepair } as KickbackLedger);
    if (options.buildOutcome !== undefined) {
      await writeFile(join(dir, '.pipeline', 'build-outcome.json'), JSON.stringify(options.buildOutcome));
    }
    const build = vi.fn(async () => options.buildResult ?? ({ success: true }));
    const runner: StepRunner = { run: async (step) => step === 'build' ? build() : { success: true } };
    if (options.refuseAtProtectedArtifact) {
      vi.spyOn(projectPrelude, 'currentCommitSha').mockResolvedValue('approved-commit');
      vi.spyOn(protectedArtifactSeal, 'verifyProtectedArtifactSeal').mockResolvedValue({
        ok: false,
        reason: 'protected artifact changed before dispatch',
      } as never);
    }
    if (options.treeHash !== undefined) {
      vi.spyOn(projectPrelude, 'currentTreeHash').mockResolvedValue(options.treeHash);
    }
    const conductor = new Conductor({
      stateFilePath: statePath,
      projectRoot: dir,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, resume: true, fromStep: 'build', verifyArtifacts: false, maxRetries: 1,
      config: {
        defaults: { model: 'test-model', effort: options.effort ?? 'medium', max_retries: 1, escalate: false },
        prd_audit: {
          ...(options.remediationCaps === undefined
            ? { max_remediation_laps: 1 }
            : options.remediationCaps.prdAudit === undefined
              ? {}
              : { max_remediation_laps: options.remediationCaps.prdAudit }),
          max_appended_tasks: options.growthCap ?? 5,
          max_appended_ratio: 1,
        },
        architecture_review_as_built: {
          ...(options.remediationCaps === undefined
            ? { max_remediation_laps: 1 }
            : options.remediationCaps.asBuilt === undefined
              ? {}
              : { max_remediation_laps: options.remediationCaps.asBuilt }),
          max_appended_tasks: 5,
          max_appended_ratio: 1,
        },
      },
    } as never);
    if (options.activeRegionChild !== undefined) {
      (conductor as unknown as { activeRegionChild: ReturnType<typeof parseChildId> }).activeRegionChild = parseChildId(options.activeRegionChild);
    }
    await conductor.run();
    return { build };
  }

  it('settles an in-allowance mixed repair before dispatching BUILD', async () => {
    const { build } = await runBuild({
      receiptId: 'mixed', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 1 }, architecture_review_as_built: { laps: 1, growth: 1 } },
    }, {
      version: 1,
      gates: { prd_audit: entry(), architecture_review_as_built: entry() },
      growth: { authored: 4, added: 0, byGate: {} },
    });

    expect(build).toHaveBeenCalledOnce();
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { prd_audit: { laps: 1 }, architecture_review_as_built: { laps: 1 } },
      growth: { added: 2, byGate: { prd_audit: 1, architecture_review_as_built: 1 } },
    });
  });

  // Covers: task:7
  it('charges an unconfigured tier-L as-built fourth lap and halts the fifth at BUILD dispatch', async () => {
    const pendingRepair: PendingRepair = {
      receiptId: 'tier-l-as-built', taskIds: ['rem-1'],
      charges: { architecture_review_as_built: { laps: 1, growth: 0 } },
    };
    const { build: fourth } = await runBuild(pendingRepair, {
      version: 1,
      gates: { architecture_review_as_built: entry(3) },
      growth: { authored: 4, added: 0, byGate: {} },
    }, { complexityTier: 'L', remediationCaps: {} });

    expect(fourth).toHaveBeenCalledOnce();
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { architecture_review_as_built: { laps: 4 } },
    });

    const { build: fifth } = await runBuild(pendingRepair, {
      version: 1,
      gates: { architecture_review_as_built: entry(4) },
      growth: { authored: 4, added: 0, byGate: {} },
    }, { complexityTier: 'L', remediationCaps: {} });

    expect(fifth).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'BUILD dispatch halted: architecture_review_as_built laps allowance exhausted',
    );
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'Kickback budget (architecture_review_as_built): 4/4 consumed; 0 remaining — tier L allowance 4 (default)',
    );
  });

  it('halts an unconfigured tier-S prd-audit third lap without charging it at BUILD dispatch', async () => {
    const { build } = await runBuild({
      receiptId: 'tier-s-prd', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 0 } },
    }, {
      version: 1,
      gates: { prd_audit: entry(2) },
      growth: { authored: 4, added: 0, byGate: {} },
    }, { complexityTier: 'S', remediationCaps: {} });

    expect(build).not.toHaveBeenCalled();
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({ gates: { prd_audit: { laps: 2 } } });
    await expect(readFile(join(dir, '.pipeline', 'HALT.class'), 'utf8')).resolves.toContain('kickback-cap');
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'Kickback budget (prd_audit): 2/2 consumed; 0 remaining — tier S allowance 2 (default)',
    );
  });

  it('halts an unconfigured feature with no recorded tier at the default M prd-audit allowance', async () => {
    const { build } = await runBuild({
      receiptId: 'unrecorded-tier-prd', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 0 } },
    }, {
      version: 1,
      gates: { prd_audit: entry(3) },
      growth: { authored: 4, added: 0, byGate: {} },
    }, { remediationCaps: {} });

    expect(build).not.toHaveBeenCalled();
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(
      'BUILD dispatch halted: prd_audit laps allowance exhausted',
    );
    expect(halt).toContain('Kickback budget (prd_audit): 3/3 consumed; 0 remaining — tier unrecorded, treated as M; allowance 3 (default)');
    expect(halt).not.toContain('tier L');
    expect(halt).not.toContain('allowance 4');
  });

  it('honors raised effective lap caps over tier defaults and configured caps at BUILD dispatch', async () => {
    const pendingRepair: PendingRepair = {
      receiptId: 'raised-tier-cap', taskIds: ['rem-1'],
      charges: { architecture_review_as_built: { laps: 1, growth: 0 } },
    };
    const { build: raisedDefault } = await runBuild(pendingRepair, {
      version: 1,
      gates: { architecture_review_as_built: { ...entry(3), effectiveLapCap: 5 } },
      growth: { authored: 4, added: 0, byGate: {} },
    }, { complexityTier: 'M', remediationCaps: {} });
    expect(raisedDefault).toHaveBeenCalledOnce();

    const { build: raisedConfigured } = await runBuild(pendingRepair, {
      version: 1,
      gates: { architecture_review_as_built: { ...entry(4), effectiveLapCap: 5 } },
      growth: { authored: 4, added: 0, byGate: {} },
    }, {
      complexityTier: 'L',
      remediationCaps: { asBuilt: { L: 2 } },
    });
    expect(raisedConfigured).toHaveBeenCalledOnce();
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { architecture_review_as_built: { laps: 5, effectiveLapCap: 5 } },
    });
  });

  it('charges a pending repair only once when BUILD retries and after a restart', async () => {
    await writeState(statePath, {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      build: 'pending',
      session_started_at: Date.now() - 1_000,
      run_started_at: Date.now() - 1_000,
      feature_desc: 'retry-transition',
    });
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: 'rem-1', status: 'pending' }],
    }));
    await writeKickbackLedger(dir, {
      version: 1,
      gates: { prd_audit: entry() },
      growth: { authored: 4, added: 0, byGate: {} },
      pendingRepair: {
        receiptId: 'retry-repair', taskIds: ['rem-1'],
        charges: { prd_audit: { laps: 1, growth: 1 } },
      },
    });

    let attempts = 0;
    const retryingRunner: StepRunner = { run: async (step) => {
      if (step !== 'build' || ++attempts > 1) return { success: true };
      return { success: false, error: 'retry once' };
    } };
    await new Conductor({
      stateFilePath: statePath, projectRoot: dir, stepRunner: retryingRunner,
      events: new ConductorEventEmitter(), mode: 'auto', daemon: true,
      resume: true, fromStep: 'build', verifyArtifacts: false,
      config: { prd_audit: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 } },
    } as never).run();

    await writeState(statePath, {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      build: 'pending',
      session_started_at: Date.now() - 1_000,
      run_started_at: Date.now() - 1_000,
      feature_desc: 'retry-transition',
    });
    await new Conductor({
      stateFilePath: statePath, projectRoot: dir,
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(), mode: 'auto', daemon: true,
      resume: true, fromStep: 'build', verifyArtifacts: false,
      config: { prd_audit: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 } },
    } as never).run();

    const ledger = await readKickbackLedger(dir);
    expect({ attempts, ledger: { ...ledger, pendingRepair: ledger.pendingRepair } }).toMatchObject({
      attempts: 2,
      ledger: {
        gates: { prd_audit: { laps: 1 } },
        growth: { added: 1, byGate: { prd_audit: 1 } },
        pendingRepair: undefined,
      },
    });
  });

  it('settles an obligation-keyed lap-only existing-task charge without growth', async () => {
    const { build } = await runBuild({
      receiptId: 'repair-existing-task-obligation', taskIds: ['1'],
      charges: { prd_audit: { laps: 1, growth: 0 } },
    }, {
      version: 1,
      gates: { prd_audit: entry() },
      growth: { authored: 4, added: 0, byGate: {} },
    });

    expect(build).toHaveBeenCalledOnce();
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { prd_audit: { laps: 1 } },
      growth: { added: 0, byGate: {} },
    });
  });

  it('refuses an exact no-op kickback cycle before settling its pending repair', async () => {
    const pendingRepair: PendingRepair = {
      receiptId: 'no-op-repair', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 1 } },
    };
    const { build } = await runBuild(pendingRepair, {
      version: 1,
      gates: { prd_audit: { ...entry(), priorVerdict: false } },
      growth: { authored: 4, added: 0, byGate: {} },
    }, {
      treeHash: 'tree-1',
      buildOutcome: {
        version: 1,
        records: [{
          outcome: 'no-movement', terminalOutcome: 'done', gate: 'prd_audit', verdict: false,
          rung: { model: 'test-model', effort: 'medium' },
          treeBefore: 'tree-1', treeAfter: 'tree-1', headBefore: 'head-1', headAfter: 'head-1',
        }],
      },
    });

    expect(build).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'prd_audit kickback-to-build refused',
    );
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { prd_audit: { laps: 0 } },
      growth: { added: 0 },
      pendingRepair,
    });
    await expect(readFile(statePath, 'utf8')).resolves.not.toMatch(/"build": "done"/);
  });

  it.each([
    ['moved tree', 'tree-2', 'medium'],
    ['null tree', null, 'medium'],
    ['higher rung', 'tree-1', 'high'],
  ] as const)('dispatches BUILD when a no-op cycle has a %s', async (_case, treeHash, effort) => {
    const { build } = await runBuild({
      receiptId: `different-${_case}`, taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 1 } },
    }, {
      version: 1,
      gates: { prd_audit: { ...entry(), priorVerdict: false } },
      growth: { authored: 4, added: 0, byGate: {} },
    }, {
      treeHash,
      effort,
      buildOutcome: {
        version: 1,
        records: [{
          outcome: 'no-movement', terminalOutcome: 'done', gate: 'prd_audit', verdict: false,
          rung: { model: 'test-model', effort: 'medium' },
          treeBefore: 'tree-1', treeAfter: 'tree-1', headBefore: 'head-1', headAfter: 'head-1',
        }],
      },
    });

    expect(build).toHaveBeenCalledOnce();
  });

  it('stamps an escalated no-movement attempt at its actual rung, so a base-rung re-dispatch proceeds', async () => {
    await runBuild(undefined, {
      version: 1,
      gates: { prd_audit: { ...entry(), priorVerdict: false } },
      growth: { authored: 4, added: 0, byGate: {} },
    }, {
      treeHash: 'tree-1',
      buildResult: { success: true, model: 'test-model', effort: 'high' },
    });
    const outcomes = JSON.parse(await readFile(join(dir, '.pipeline', 'build-outcome.json'), 'utf8')) as BuildOutcomeStore;
    const stamped = outcomes.records.at(-1)?.rung;
    expect(stamped).toEqual({ model: 'test-model', effort: 'high' });
    expect(sameNoOpCycle({
      outcome: 'no-movement', terminalOutcome: 'done', gate: 'prd_audit', verdict: false,
      rung: stamped!, treeBefore: 'tree-1', treeAfter: 'tree-1', headBefore: 'head-1', headAfter: 'head-1',
    }, {
      gate: 'prd_audit', treeHash: 'tree-1', verdict: false,
      rung: buildOutcomeRung(undefined, { model: 'test-model', effort: 'medium' }),
    })).toBe(false);
  });

  it('leaves a pending repair uncharged when protected-artifact admission refuses BUILD', async () => {
    const pendingRepair: PendingRepair = {
      receiptId: 'refused-repair', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 1 } },
      prdAuditCriteria: ['S2.1'],
    };
    const { build } = await runBuild(pendingRepair, {
      version: 1,
      gates: { prd_audit: entry() },
      growth: { authored: 4, added: 0, byGate: {} },
    }, { refuseAtProtectedArtifact: true });

    expect(build).not.toHaveBeenCalled();
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { prd_audit: { laps: 0 } },
      growth: { authored: 4, added: 0, byGate: {} },
      pendingRepair,
    });
  });

  it('records a prd-audit existing-task repair as an obligation-keyed lap-only pending charge', async () => {
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
    await writeFile(join(dir, '.docs', 'plans', 'existing-task.md'), '### Task 1: Existing repair\n');
    await writeFile(join(dir, '.docs', 'stories', 'existing-task.md'), '## Story 1: Repair\n\n### Happy Path\n- Given repair work, when it is completed, then it passes.\n');
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: '1', status: 'completed' }],
    }));
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 },
          criterionId: 'S1.1',
          grade: 'FIXABLE',
          evidence: 'Fixture identifies the existing repair.',
          rationale: 'Fixture repair requires the active owning task.',
          requirementAssociations: [],
          evidenceTaskIds: ['1'],
          ownerTaskId: '1',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'fixture-prd-audit', codeStamp: null });
    await writeKickbackLedger(dir, { version: 1, gates: {}, growth: { authored: 1, added: 0, byGate: {} } });
    const conductor = new Conductor({
      stateFilePath: statePath,
      projectRoot: dir,
      events: new ConductorEventEmitter(),
      config: { prd_audit: { max_remediation_laps: 1 } } as never,
      stepRunner: { run: async (step, _state, options) => {
        if (step === 'remediate') {
          await persistFixtureProjectedRemediationPlan(dir, options, [{
            id: 'S1.1', disposition: 'existing-task', category: null, rationale: 'Already owned.',
            tasks: [], boundTaskIds: ['1'],
          }]);
        }
        return { success: true };
      } },
    });

    await expect((conductor as any).planRemediation(
      { feature_desc: 'existing-task', session_started_at: Date.now() - 1_000 },
      ALL_STEPS,
      'restage existing work',
      { source: 'prd_audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
    )).resolves.toMatchObject({ kind: 'route', target: 'build' });

    const ledger = await readKickbackLedger(dir);
    expect(ledger.gates.prd_audit?.laps ?? 0).toBe(0);
    expect(ledger.pendingRepair).toMatchObject({
      receiptId: expect.stringMatching(/^repair-/),
      charges: { prd_audit: { laps: 1, growth: 0 } },
      taskIds: ['1'],
      prdAuditCriteria: ['S1.1'],
    });
    await expect(readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')).resolves.toMatch(/"status": "pending"/);
  });

  it('names every existing-task PRD finding when its lap is exhausted at BUILD admission', async () => {
    const { build } = await runBuild({
      receiptId: 'existing-task-exhausted', taskIds: ['1'],
      charges: { prd_audit: { laps: 1, growth: 0 } },
      prdAuditCriteria: ['S1.1', 'S1.2'],
    }, {
      version: 1,
      gates: { prd_audit: entry(1) },
      growth: { authored: 4, added: 0, byGate: {} },
    });

    expect(build).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'Findings (prd_audit): S1.1, S1.2',
    );
  });

  it.each([
    ['prd_audit lap', { prd_audit: entry(1) }, { prd_audit: { laps: 1, growth: 0 } }, 'laps'],
    ['as-built lap', { architecture_review_as_built: entry(1) }, { architecture_review_as_built: { laps: 1, growth: 0 } }, 'laps'],
    ['mixed as-built lap', { prd_audit: entry(), architecture_review_as_built: entry(1) }, { prd_audit: { laps: 1, growth: 1 }, architecture_review_as_built: { laps: 1, growth: 1 } }, 'laps'],
    ['growth', { prd_audit: entry() }, { prd_audit: { laps: 1, growth: 1 } }, 'growth'],
  ])('halts before BUILD without charging a %s exhaustion', async (_name, gates, charges, allowance) => {
    const initialGrowth: NonNullable<KickbackLedger['growth']> = {
      authored: 4,
      added: allowance === 'growth' ? 4 : 0,
      byGate: allowance === 'growth' ? { prd_audit: 4 } : {},
    };
    const { build } = await runBuild({
      receiptId: `exhausted-${allowance}`,
      taskIds: ['rem-1'],
      charges,
      ...(Object.hasOwn(charges, 'prd_audit') ? { prdAuditCriteria: ['S2.1'] } : {}),
    }, {
      version: 1, gates, growth: initialGrowth,
    });

    expect(build).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(new RegExp(allowance, 'i'));
    if (Object.hasOwn(charges, 'prd_audit')) {
      await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
        _name.includes('as-built') ? 'Also pending (prd_audit): S2.1' : 'Findings (prd_audit): S2.1',
      );
    }
    await expect(readFile(statePath, 'utf8')).resolves.not.toMatch(/"build": "done"/);
    await expect(readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')).resolves.toMatch(/"status":"pending"/);
    const haltedLedger = await readKickbackLedger(dir);
    expect(haltedLedger).toMatchObject({
      gates: Object.fromEntries(Object.entries(gates).map(([gate, value]) => [gate, { laps: value.laps }])),
      pendingRepair: { taskIds: ['rem-1'] },
    });
    expect(haltedLedger.growth).toEqual(initialGrowth);
    const exhaustedGate = allowance === 'growth' ? 'prd_audit' :
      _name.includes('as-built') ? 'architecture_review_as_built' : 'prd_audit';
    expect(haltedLedger.gates[exhaustedGate]?.capEvidence).toMatchObject({ allowance });
    expect(haltedLedger.gates[exhaustedGate]?.capEvidence?.haltGeneration).toEqual(expect.any(String));
  });

  it('records a raised lap cap as the cap evidence limit so the next raise matches', async () => {
    await runBuild({
      receiptId: 'raised-lap-exhausted', taskIds: ['rem-1'],
      charges: { architecture_review_as_built: { laps: 1, growth: 0 } },
    }, {
      version: 1,
      gates: { architecture_review_as_built: { ...entry(3), effectiveLapCap: 3 } },
      growth: { authored: 4, added: 0, byGate: {} },
    });

    const ledger = await readKickbackLedger(dir);
    expect(ledger.gates.architecture_review_as_built?.capEvidence).toMatchObject({
      allowance: 'laps', consumed: 3, limit: 3,
    });
  });

  it('renders a child inspect whole-feature cap line identically to its real child-qualified halt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conductor-kickback-inspect-root-'));
    const originalDir = dir;
    dir = join(root, '.worktrees', 'transition');
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    try {
      await runBuild({
        receiptId: 'child-as-built-exhausted', taskIds: ['rem-1'],
        charges: { architecture_review_as_built: { laps: 1, growth: 0 } },
      }, {
        version: 1,
        gates: { architecture_review_as_built: { ...entry(3), effectiveLapCap: 3 } },
        growth: { authored: 4, added: 0, byGate: {} },
      }, { activeRegionChild: 2 });

      const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
      expect(halt).toContain('for child 2');
      const childPipeline = join(dir, '.pipeline', 'children', '2');
      await mkdir(childPipeline, { recursive: true });
      await mkdir(join(dir, '.ai-conductor'), { recursive: true });
      await writeFile(join(dir, '.ai-conductor', 'config.yml'), 'architecture_review_as_built:\n  max_remediation_laps: 1\n');
      await writeFile(join(childPipeline, 'kickback-ledger.json'), JSON.stringify({
        version: 1,
        gates: { architecture_review_as_built: entry(0) },
      }));
      const output: string[] = [];
      expect(await dispatchKickbackBudgetCommand(
        { kind: 'kickback-budget', action: 'inspect', feature: 'transition', format: 'human', child: '2' },
        { cwd: root, resolveMainRoot: async () => root, print: (line) => output.push(line) },
      )).toBe(1);
      const haltLine = halt.split('\n').find((line) => line.startsWith('Kickback budget (architecture_review_as_built):'));
      const inspectLine = output.join('\n').split('\n').find((line) => line.startsWith('Kickback budget (architecture_review_as_built):'));
      expect(inspectLine).toBe(haltLine);
    } finally {
      dir = originalDir;
      statePath = join(dir, '.pipeline', 'conduct-state.json');
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed before BUILD for a malformed pending repair', async () => {
    const { build } = await runBuild({ receiptId: '', taskIds: [], charges: {} }, {
      version: 1, gates: { prd_audit: entry(), architecture_review_as_built: entry() }, growth: { authored: 4, added: 0, byGate: {} },
    });

    expect(build).not.toHaveBeenCalled();
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Pending remediation findings are unavailable because the repair record is malformed.');
    expect(halt).not.toContain('Findings (');
    expect(halt).not.toContain('Also pending (');
  });

  it('leads an as-built exhaustion with its findings and retains PRD findings as also pending', async () => {
    const { build } = await runBuild({
      receiptId: 'as-built-findings-first', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 0 }, architecture_review_as_built: { laps: 1, growth: 0 } },
      prdAuditCriteria: ['S5.1', 'S5.2', 'S5.3'],
    }, {
      version: 1,
      gates: { prd_audit: entry(), architecture_review_as_built: entry(1) },
      growth: { authored: 4, added: 0, byGate: {} },
      pendingAsBuiltRemediationFindings: asBuiltFindings,
    });

    expect(build).not.toHaveBeenCalled();
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Findings (architecture_review_as_built): as-built:a:1, as-built:a:2');
    expect(halt).toContain('Also pending (prd_audit): S5.1, S5.2, S5.3');
    expect(halt).not.toContain('Findings: S5.1');
    expect(halt).toContain('Blocking findings:\nas-built:a:1');
    expect((await readKickbackLedger(dir)).gates.architecture_review_as_built?.capEvidence?.latestReason).toMatch(
      /^Findings \(architecture_review_as_built\): as-built:a:1/,
    );
  });

  it('leads a PRD exhaustion with its criteria and retains as-built findings as also pending', async () => {
    const { build } = await runBuild({
      receiptId: 'prd-findings-first', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 0 }, architecture_review_as_built: { laps: 1, growth: 0 } },
      prdAuditCriteria: ['S5.1', 'S5.2', 'S5.3'],
    }, {
      version: 1,
      gates: { prd_audit: entry(1), architecture_review_as_built: entry() },
      growth: { authored: 4, added: 0, byGate: {} },
      pendingAsBuiltRemediationFindings: asBuiltFindings,
    });

    expect(build).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'Findings (prd_audit): S5.1, S5.2, S5.3\nAlso pending (architecture_review_as_built): as-built:a:1, as-built:a:2',
    );
  });

  it('does not add an also-pending line to a PRD-only exhaustion', async () => {
    const { build } = await runBuild({
      receiptId: 'prd-only-findings', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 0 } }, prdAuditCriteria: ['S1.1'],
    }, {
      version: 1, gates: { prd_audit: entry(1) }, growth: { authored: 4, added: 0, byGate: {} },
    });

    expect(build).not.toHaveBeenCalled();
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Findings (prd_audit): S1.1');
    expect(halt).not.toContain('Also pending (');
  });

  it('uses pending task ids when an as-built exhaustion has no as-built findings', async () => {
    const { build } = await runBuild({
      receiptId: 'as-built-task-fallback', taskIds: ['rem-1', 'rem-2'],
      charges: { architecture_review_as_built: { laps: 1, growth: 0 } }, prdAuditCriteria: ['S5.1'],
    }, {
      version: 1, gates: { architecture_review_as_built: entry(1) }, growth: { authored: 4, added: 0, byGate: {} },
    });

    expect(build).not.toHaveBeenCalled();
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Pending remediation tasks: rem-1, rem-2');
    expect(halt).not.toContain('Findings (architecture_review_as_built): S5.1');
  });

  it('renders projected pending growth and its minimum raise when BUILD growth is exhausted', async () => {
    const { build } = await runBuild({
      receiptId: 'growth-projection', taskIds: ['rem-1'],
      charges: {
        prd_audit: { laps: 1, growth: 3 },
        architecture_review_as_built: { laps: 1, growth: 8 },
      },
    }, {
      version: 1,
      gates: { prd_audit: entry(), architecture_review_as_built: entry() },
      growth: { authored: 40, added: 0, byGate: {} },
    }, { growthCap: 10, authoredTasks: 40 });

    expect(build).not.toHaveBeenCalled();
    const halt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(
      'Plan growth: 0/10 added; 0 remaining (config-derived cap)\n' +
      'Pending growth: 11 (prd_audit 3, architecture_review_as_built 8); would reach 11/10 when build dispatches; minimum raise 1',
    );
    expect(halt).toContain(
      'Plan-growth allowance exhausted. Recover with: ai-conductor kickback-budget raise --feature transition --gate architecture_review_as_built --by 1 --rationale "«why»"',
    );
    const uncharged = await readKickbackLedger(dir);
    expect(uncharged.gates).toMatchObject({
      prd_audit: { laps: 0 },
      architecture_review_as_built: { laps: 0, capEvidence: { allowance: 'growth' } },
    });
    expect(uncharged.growth).toMatchObject({ added: 0, byGate: {} });
  });

  it('renders the projected minimum raise for raised and at-cap growth exhaustion', async () => {
    const raised = await runBuild({
      receiptId: 'raised-growth-projection', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 3 }, architecture_review_as_built: { laps: 1, growth: 2 } },
    }, {
      version: 1, effectiveGrowthCap: 13,
      gates: { prd_audit: entry(), architecture_review_as_built: entry() },
      growth: { authored: 40, added: 9, byGate: { prd_audit: 9 } },
    }, { authoredTasks: 40 });
    expect(raised.build).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'Plan growth: 9/13 added; 0 remaining (raised cap)\nPending growth: 5 (prd_audit 3, architecture_review_as_built 2); would reach 14/13 when build dispatches; minimum raise 1',
    );

    const atCap = await runBuild({
      receiptId: 'at-cap-growth-projection', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 2 } },
    }, {
      version: 1,
      gates: { prd_audit: entry() },
      growth: { authored: 40, added: 10, byGate: { prd_audit: 10 } },
    }, { growthCap: 10, authoredTasks: 40 });
    expect(atCap.build).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'Plan growth: 10/10 added; 0 remaining (config-derived cap)\nPending growth: 2 (prd_audit 2); would reach 12/10 when build dispatches; minimum raise 2',
    );
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'BUILD dispatch halted: prd_audit growth allowance exhausted',
    );
  });

  it('settles the projected repair after a raise and leaves no HALT', async () => {
    const { build } = await runBuild({
      receiptId: 'raised-settlement', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 3 }, architecture_review_as_built: { laps: 1, growth: 8 } },
    }, {
      version: 1, effectiveGrowthCap: 11,
      gates: { prd_audit: entry(), architecture_review_as_built: entry() },
      growth: { authored: 40, added: 0, byGate: {} },
    }, { authoredTasks: 40 });

    expect(build).toHaveBeenCalledOnce();
    const settled = await readKickbackLedger(dir);
    expect(settled.growth?.added).toBe(11);
    expect(settled.pendingRepair).toBeUndefined();
    await expect(access(join(dir, '.pipeline', 'HALT'))).rejects.toThrow();
  });

  it('keeps a projected growth repair byte-identical when no raise is applied twice', async () => {
    const pendingRepair: PendingRepair = {
      receiptId: 'unraised-growth-projection', taskIds: ['rem-1'],
      charges: { prd_audit: { laps: 1, growth: 3 }, architecture_review_as_built: { laps: 1, growth: 8 } },
    };
    const ledger: KickbackLedger = {
      version: 1,
      gates: { prd_audit: entry(), architecture_review_as_built: entry() },
      growth: { authored: 40, added: 0, byGate: {} },
      pendingRepair,
    };
    await writeState(statePath, {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])), build: 'pending',
      session_started_at: Date.now() - 1_000, run_started_at: Date.now() - 1_000, feature_desc: 'transition',
    });
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [{ id: 'rem-1', status: 'pending' }] }));
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(join(dir, '.docs', 'plans', 'transition.md'), Array.from(
      { length: 40 }, (_, index) => `### Task ${index + 1}: Authored work`,
    ).join('\n'));
    await writeKickbackLedger(dir, ledger);
    const before = (await readKickbackLedger(dir)).pendingRepair;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const build = vi.fn(async () => ({ success: true }));
      await new Conductor({
        stateFilePath: statePath, projectRoot: dir, stepRunner: { run: async (step: string) => step === 'build' ? build() : { success: true } },
        events: new ConductorEventEmitter(), mode: 'auto', daemon: true, resume: true, fromStep: 'build', verifyArtifacts: false,
        config: {
          defaults: { model: 'test-model', effort: 'medium', max_retries: 1, escalate: false },
          prd_audit: { max_remediation_laps: 1, max_appended_tasks: 10, max_appended_ratio: 1 },
          architecture_review_as_built: { max_remediation_laps: 1, max_appended_tasks: 10, max_appended_ratio: 1 },
        },
      } as never).run();
      expect(build).not.toHaveBeenCalled();
      await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('minimum raise 1');
      const after = await readKickbackLedger(dir);
      expect(JSON.stringify(after.pendingRepair)).toBe(JSON.stringify(before));
      expect(after.gates).toMatchObject({ prd_audit: { laps: 0 }, architecture_review_as_built: { laps: 0 } });
      expect(after.growth).toMatchObject({ added: 0, byGate: {} });
    }
  });

  it('does not offer a growth raise for lap exhaustion or malformed pending repairs', async () => {
    await runBuild({
      receiptId: 'lap-with-growth', taskIds: ['rem-1'], charges: { prd_audit: { laps: 1, growth: 3 } },
    }, {
      version: 1, gates: { prd_audit: entry(1) }, growth: { authored: 40, added: 2, byGate: {} },
    }, { growthCap: 10, authoredTasks: 40 });
    const lapHalt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(lapHalt).toContain('laps allowance exhausted');
    expect(lapHalt).toContain('Pending growth: 3 (prd_audit 3); would reach 3/10 when build dispatches');
    expect(lapHalt).not.toContain('minimum raise');
    expect(lapHalt).toContain('--by «N»');

    await runBuild({
      receiptId: 'lap-without-growth', taskIds: ['rem-1'], charges: { prd_audit: { laps: 1, growth: 0 } },
    }, {
      version: 1, gates: { prd_audit: entry(1) }, growth: { authored: 40, added: 0, byGate: {} },
    }, { growthCap: 10, authoredTasks: 40 });
    const lapsOnlyHalt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(lapsOnlyHalt).toContain('Plan growth: 0/10 added; 10 remaining (config-derived cap)');
    expect(lapsOnlyHalt).not.toContain('Pending growth:');

    await runBuild({ receiptId: '', taskIds: [], charges: {} }, {
      version: 1, gates: { prd_audit: entry() }, growth: { authored: 40, added: 0, byGate: {} },
    });
    const malformedHalt = await readFile(join(dir, '.pipeline', 'HALT'), 'utf8');
    expect(malformedHalt).toContain('Kickback budget (prd_audit): growth allowance unavailable (');
    expect(malformedHalt).not.toContain('Pending growth:');
    expect(malformedHalt).toContain('--by «N»');
    await expect(readFile(join(dir, '.pipeline', 'HALT.class'), 'utf8')).resolves.toContain('needs-human');
  });

  it.each(['build_review', 'test_suite', 'manual_test'] as const)(
    'does not settle a remediation charge for a %s kickback into BUILD',
    async (sourceGate) => {
      const { build } = await runBuild(undefined, {
        version: 1,
        gates: {
          prd_audit: entry(2),
          architecture_review_as_built: entry(3),
          [sourceGate]: entry(4),
        },
        growth: { authored: 8, added: 3, byGate: { prd_audit: 2, architecture_review_as_built: 1 } },
      });

      expect(build).toHaveBeenCalledOnce();
      await expect(readKickbackLedger(dir)).resolves.toMatchObject({
        gates: {
          prd_audit: { laps: 2 },
          architecture_review_as_built: { laps: 3 },
          [sourceGate]: { laps: 4 },
        },
        growth: { added: 3, byGate: { prd_audit: 2, architecture_review_as_built: 1 } },
      });
    },
  );
});

describe('remediation halts without a planned repair (Task 11)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-kickback-no-repair-'));
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps the no-recognized-disposition needs-human halt uncharged', async () => {
    const dispatched: string[] = [];
    const conductor = new Conductor({
      stateFilePath: join(dir, '.pipeline', 'conduct-state.json'),
      projectRoot: dir,
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, verifyArtifacts: false,
      stepRunner: {
        run: async (step, _state, options) => {
          dispatched.push(step);
          await persistFixtureRemediationPlan(dir, options, { version: 'v1', dispositions: [] });
          return { success: true };
        },
      },
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: { session_started_at: number; feature_desc: string },
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidence: [] },
      ) => Promise<{ kind: string; haltClass?: string; detail?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'no-repair' },
      ALL_STEPS,
      'no recognized remediation disposition',
      { source: 'build_review', evidence: [] },
    );

    expect(dispatched).toEqual(['remediate']);
    expect(outcome).toEqual(expect.objectContaining({
      kind: 'halt',
      haltClass: 'needs-human',
      detail: expect.stringContaining('remediation planner returned no recognized disposition'),
    }));
    expect((await readKickbackLedger(dir)).pendingRepair).toBeUndefined();
  });
});

describe('whole-feature kickbacks from an active child (rem-prd-audit-11-r3)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-flat-kickback-'));
    await mkdir(join(dir, '.pipeline', 'children', '2', 'gates'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'children', '2', 'conduct-state.json'), '{"build":"done"}\n');
    await writeFile(join(dir, '.pipeline', 'children', '2', 'gates', 'build.json'), '{"satisfied":true}\n');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function childFiles(): Promise<Record<string, string>> {
    const base = join(dir, '.pipeline', 'children');
    const files: Record<string, string> = {};
    const visit = async (path: string, relative = ''): Promise<void> => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const childRelative = join(relative, entry.name);
        const childPath = join(path, entry.name);
        if (entry.isDirectory()) await visit(childPath, childRelative);
        else files[childRelative] = await readFile(childPath, 'utf8');
      }
    };
    await visit(base);
    return files;
  }

  it('keeps a manual-test kickback to plan feature-scoped even while child 2 is active', async () => {
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        plan: {
          count: 2, cumulative: 2, treeHash: null, lastReason: 'prior plan finding',
          priorVerdict: true, resolvedBefore: 0,
        },
      },
      growth: { authored: 0, added: 0, byGate: {} },
    });
    const before = await childFiles();
    const events = new ConductorEventEmitter();
    const kickbacks: unknown[] = [];
    events.on('kickback', (event) => { kickbacks.push(event); });
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: join(dir, '.pipeline', 'conduct-state.json'),
      events,
      daemon: false,
    } as never);
    (conductor as unknown as { activeRegionChild: ReturnType<typeof parseChildId> }).activeRegionChild = parseChildId(2);

    const result = await (conductor as unknown as {
      scanKickbackVerdicts: (
        step: 'manual_test', state: Record<string, never>,
        verdicts: { plan: { satisfied: false; checkedAt: number; kickback: { from: 'manual_test'; evidence: string } } },
        steps: typeof ALL_STEPS, options: { navigate: false },
      ) => Promise<'halt' | 'kicked' | null>;
    }).scanKickbackVerdicts(
      'manual_test',
      {},
      { plan: { satisfied: false, checkedAt: Date.now(), kickback: { from: 'manual_test', evidence: 'plan needs repair' } } },
      ALL_STEPS,
      { navigate: false },
    );

    expect(result).toBe('halt');
    expect(await childFiles()).toEqual(before);
    expect(kickbacks).toHaveLength(1);
    expect(kickbacks[0]).toMatchObject({ type: 'kickback', from: 'manual_test', to: 'plan' });
    expect(kickbacks[0]).not.toHaveProperty('child');
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain('for child 2');
  });
});


describe('kickback-cap resume into BUILD (Task 9)', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-kickback-resume-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('dispatches BUILD first after a consumed prd-audit cap raise', async () => {
    await writeState(statePath, {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      build: 'pending',
      session_started_at: Date.now() - 1_000,
      run_started_at: Date.now() - 1_000,
      feature_desc: 'raised-transition',
    });
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: 'rem-1', status: 'pending' }],
    }));
    await writeKickbackLedger(dir, {
      version: 1,
      gates: {
        prd_audit: {
          count: 0, cumulative: 0, laps: 1, treeHash: null,
          lastReason: 'cap', priorVerdict: true, resolvedBefore: 0,
          effectiveLapCap: 2,
          capEvidence: { gate: 'prd_audit', consumed: 1, limit: 1, latestReason: 'cap', haltGeneration: 'g1' },
          resumeAuthorization: { adjustmentId: 'raise-1', haltGeneration: 'g1', consumed: true },
        },
      },
      growth: { authored: 4, added: 0, byGate: {} },
      pendingRepair: {
        receiptId: 'raised-repair', taskIds: ['rem-1'],
        charges: { prd_audit: { laps: 1, growth: 0 } },
      },
    });
    await writeVerdict(dir, 'prd_audit', {
      satisfied: false,
      checkedAt: Date.now(),
      reason: 'remediation finding remains pending BUILD',
    });

    const dispatched: string[] = [];
    let releaseBuild: (() => void) | undefined;
    let signalBuildStarted: (() => void) | undefined;
    const buildStarted = new Promise<void>((resolve) => { signalBuildStarted = resolve; });
    const waitForBuildRelease = new Promise<void>((resolve) => { releaseBuild = resolve; });
    const run = new Conductor({
      stateFilePath: statePath,
      projectRoot: dir,
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, resume: true, verifyArtifacts: false,
      config: { prd_audit: { max_remediation_laps: 1 } } as never,
      stepRunner: { run: async (step) => {
        dispatched.push(step);
        if (step === 'build') {
          signalBuildStarted?.();
          await waitForBuildRelease;
        }
        return { success: true };
      } },
    }).run();

    await buildStarted;
    expect(dispatched).toEqual(['build']);
    expect(releaseBuild).toBeDefined();
    releaseBuild?.();
    await run;
    const settled = await readKickbackLedger(dir);
    expect(settled.gates.prd_audit?.laps).toBe(2);
    expect(settled.pendingRepair).toBeUndefined();
  });
});
