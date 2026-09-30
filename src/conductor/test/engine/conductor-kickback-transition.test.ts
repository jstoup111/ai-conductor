import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { readKickbackLedger, type KickbackLedger, type PendingRepair } from '../../src/engine/kickback-ledger.js';
import { writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
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
});
