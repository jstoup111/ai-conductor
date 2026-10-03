// Covers: task:6, task:12
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOutcomeRung, Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { readKickbackLedger, type KickbackLedger, type PendingRepair } from '../../src/engine/kickback-ledger.js';
import type { BuildOutcomeStore } from '../../src/engine/build-outcome.js';
import { sameNoOpCycle } from '../../src/engine/build-outcome.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeKickbackLedger } from '../kickback-ledger-test-support.js';
import * as projectPrelude from '../../src/engine/project-prelude.js';
import * as protectedArtifactSeal from '../../src/engine/protected-artifact-seal.js';

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

  async function runBuild(
    pendingRepair: PendingRepair | unknown,
    ledger: Omit<KickbackLedger, 'pendingRepair'>,
    options: {
      refuseAtProtectedArtifact?: boolean;
      buildOutcome?: BuildOutcomeStore;
      treeHash?: string | null;
      effort?: 'low' | 'medium' | 'high';
      buildResult?: { success: true; model?: string; effort?: 'low' | 'medium' | 'high' };
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
    });
    await writeFile(join(dir, '.pipeline', 'task-status.json'), JSON.stringify({
      tasks: [{ id: 'rem-1', status: 'pending' }],
    }));
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
    await new Conductor({
      stateFilePath: statePath,
      projectRoot: dir,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, resume: true, fromStep: 'build', verifyArtifacts: false, maxRetries: 1,
      config: {
        defaults: { model: 'test-model', effort: options.effort ?? 'medium', max_retries: 1, escalate: false },
        prd_audit: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 },
        architecture_review_as_built: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 },
      },
    } as never).run();
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
    await writeFile(join(dir, '.pipeline', 'prd-audit.md'), [
      '# PRD Audit', '', '**PRD:** present', '', '## Verdict Table', '',
      '| Criterion | Grade | Plan task | PRD: | Evidence |',
      '|---|---|---|---|---|', '| S1.1 | FIXABLE | 1 | FR-1 | x |',
    ].join('\n'));
    await writeKickbackLedger(dir, { version: 1, gates: {}, growth: { authored: 1, added: 0, byGate: {} } });
    const conductor = new Conductor({
      stateFilePath: statePath,
      projectRoot: dir,
      events: new ConductorEventEmitter(),
      config: { prd_audit: { max_remediation_laps: 1 } } as never,
      stepRunner: { run: async (step) => {
        if (step === 'remediate') {
          await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({ dispositions: [{
            id: 'S1.1', disposition: 'existing-task', category: null, rationale: 'Already owned.',
            tasks: [{ id: '1', title: 'Existing repair' }],
          }] }));
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
      'Findings: S1.1, S1.2',
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
      await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('Findings: S2.1');
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

  it('fails closed before BUILD for a malformed pending repair', async () => {
    const { build } = await runBuild({ receiptId: '', taskIds: [], charges: {} }, {
      version: 1, gates: { prd_audit: entry(), architecture_review_as_built: entry() }, growth: { authored: 4, added: 0, byGate: {} },
    });

    expect(build).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/kickback|allowance/i);
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
        run: async (step) => {
          dispatched.push(step);
          await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
            dispositions: [{ id: 'S1.1', disposition: 'unrecognized', rationale: 'Needs a human.' }],
          }));
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
