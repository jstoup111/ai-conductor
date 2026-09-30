import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { readKickbackLedger, type KickbackLedger, type PendingRepair } from '../../src/engine/kickback-ledger.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeKickbackLedger } from '../kickback-ledger-test-support.js';

describe('BUILD pending-repair settlement transition (Task 6)', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-kickback-transition-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const entry = (laps = 0) => ({
    count: 0, cumulative: 0, laps, treeHash: null,
    lastReason: 'blocking finding', priorVerdict: true, resolvedBefore: 0,
  });

  async function runBuild(pendingRepair: PendingRepair | unknown, ledger: Omit<KickbackLedger, 'pendingRepair'>): Promise<{
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
    const build = vi.fn(async () => ({ success: true }));
    const runner: StepRunner = { run: async (step) => step === 'build' ? build(step) : { success: true } };
    await new Conductor({
      stateFilePath: statePath,
      projectRoot: dir,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'auto', daemon: true, resume: true, fromStep: 'build', verifyArtifacts: false,
      config: {
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
    });
    await expect(readFile(join(dir, '.pipeline', 'task-status.json'), 'utf8')).resolves.toMatch(/"status": "pending"/);
  });

  it.each([
    ['prd_audit lap', { prd_audit: entry(1) }, { prd_audit: { laps: 1, growth: 0 } }, 'laps'],
    ['as-built lap', { architecture_review_as_built: entry(1) }, { architecture_review_as_built: { laps: 1, growth: 0 } }, 'laps'],
    ['mixed as-built lap', { prd_audit: entry(), architecture_review_as_built: entry(1) }, { prd_audit: { laps: 1, growth: 1 }, architecture_review_as_built: { laps: 1, growth: 1 } }, 'laps'],
    ['growth', { prd_audit: entry() }, { prd_audit: { laps: 1, growth: 1 } }, 'growth'],
  ])('halts before BUILD without charging a %s exhaustion', async (_name, gates, charges, allowance) => {
    const initialGrowth = {
      authored: 4,
      added: allowance === 'growth' ? 4 : 0,
      byGate: allowance === 'growth' ? { prd_audit: 4 } : {},
    };
    const { build } = await runBuild({ receiptId: `exhausted-${allowance}`, taskIds: ['rem-1'], charges }, {
      version: 1, gates, growth: initialGrowth,
    });

    expect(build).not.toHaveBeenCalled();
    await expect(readFile(join(dir, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(new RegExp(`${allowance}|Kickback halt generation`, 'i'));
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
