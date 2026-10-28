// Covers: task:3
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { Conductor, type StepRunner } from '../../../src/engine/conductor.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { emptyUnsettledReceipt, parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeKickbackLedger } from '../../kickback-ledger-test-support.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r8')!;
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function subject(options: { added?: number; cap?: number; growth?: number; laps?: number; effectiveLapCap?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'conductor-routed-settlement-halt-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'halt@example.test']);
  await git(['config', 'user.name', 'Halt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
    ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
    build: 'pending', feature_desc: 'demo', session_started_at: Date.now() - 1_000, run_started_at: Date.now() - 1_000,
  }));
  await writeKickbackLedger(root, {
    version: 1, effectiveGrowthCap: options.cap ?? 14,
    gates: { prd_audit: { count: 0, cumulative: 0, laps: options.laps ?? 0, ...(options.effectiveLapCap === undefined ? {} : { effectiveLapCap: options.effectiveLapCap }), treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 } },
    growth: { authored: 1, added: options.added ?? 13, byGate: {} },
  });
  const created = await createRouteRecord(root, 'demo', {
    roundId, sealedAuthored: 1, kind: 'audit',
    items: [
      { findingId: 'S1.1', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] },
      { findingId: 'S3.1', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] },
    ],
    allocation: { [child]: { remTaskIds: ['rem-prd-audit-6.r1', 'rem-prd-audit-6.r2'], blockBodies: ['### Task rem-prd-audit-6.r1\n', '### Task rem-prd-audit-6.r2\n'] } },
    receipt: { ...emptyUnsettledReceipt(), laps: { prd_audit: 1 }, growth: options.growth ?? 2 },
  });
  if (created.kind !== 'created') throw new Error(`route fixture: ${created.kind}`);
  if ((await admitRound(root, 'demo', created.record, child, { git })).kind !== 'admitted') {
    throw new Error('route fixture admission failed');
  }
  let parkAfterBuild = false;
  const build = vi.fn(async () => {
    parkAfterBuild = true;
    return { success: true };
  });
  const runner: StepRunner = { run: async (step) => step === 'build' ? build() : { success: true } };
  const conductor = new Conductor({
    projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
    mode: 'auto', daemon: true, resume: true, fromStep: 'build', verifyArtifacts: false, maxRetries: 1,
    events: new ConductorEventEmitter(), stepRunner: runner,
    operatorParkBoundary: async () => parkAfterBuild,
    config: { defaults: { model: 'test', effort: 'low', max_retries: 1, escalate: false }, prd_audit: { max_remediation_laps: 2, max_appended_tasks: 4, max_appended_ratio: 1 }, stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({ kind: 'active', child, position: child, isLeaf: true, branch: 'feat/demo', routedRepair: { child, roundId } }) as never,
      enterHostRegion: async () => ({ kind: 'resume', pinnedBase: 'a'.repeat(40) }) as never,
      enterChildRegion: async () => ({ kind: 'completed' }) as never,
    },
  });
  return { root, build, conductor, git };
}

describe('routed BUILD settlement cap halt', () => {
  it('renders the refused round growth, concrete recovery raise, and reconciled cap evidence', async () => {
    const fixture = await subject();
    await fixture.conductor.run();

    expect(fixture.build).not.toHaveBeenCalled();
    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('BUILD dispatch halted: prd_audit growth allowance exhausted.');
    expect(halt).toContain('Plan growth: 13/14 added; 0 remaining (raised cap)\nPending growth: 2 (prd_audit 2); would reach 15/14 when build dispatches; minimum raise 1');
    expect(halt).toContain('kickback-budget raise --feature demo --gate prd_audit --by 1');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('kickback-cap');
    await expect(readKickbackLedger(fixture.root)).resolves.toMatchObject({
      gates: { prd_audit: { capEvidence: { allowance: 'growth', consumed: 13, limit: 14 } } },
      growth: { added: 13 },
    });
  });

  it('renders pending in-cap growth on a lap halt without inventing a minimum raise', async () => {
    const fixture = await subject({ added: 6, cap: 10, growth: 1, laps: 2, effectiveLapCap: 2 });
    await fixture.conductor.run();

    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('BUILD dispatch halted: prd_audit laps allowance exhausted.');
    expect(halt).toContain('Pending growth: 1 (prd_audit 1); would reach 7/10 when build dispatches');
    expect(halt).not.toContain('minimum raise');
    expect(halt).toContain('--by «N»');
  });

  it('settles and dispatches after a sufficient raise, while an unchanged cap remains side-effect free', async () => {
    const raised = await subject({ cap: 15 });
    await raised.conductor.run();
    expect(raised.build).toHaveBeenCalledOnce();
    await expect(readKickbackLedger(raised.root)).resolves.toMatchObject({ growth: { added: 15 }, gates: { prd_audit: { laps: 1 } } });
    await expect(readRouteRecord(raised.root, 'demo', roundId, { git: raised.git })).resolves.toMatchObject({ kind: 'record', record: { receipt: { settlementId: expect.any(String) } } });
    await expect(readFile(join(raised.root, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });

    const unchanged = await subject();
    await unchanged.conductor.run();
    await expect(readKickbackLedger(unchanged.root)).resolves.toMatchObject({ growth: { added: 13 }, gates: { prd_audit: { laps: 0 } } });
    const unsettled = await readRouteRecord(unchanged.root, 'demo', roundId, { git: unchanged.git });
    expect(unsettled).toMatchObject({ kind: 'record' });
    if (unsettled.kind === 'record') expect(unsettled.record.receipt).not.toHaveProperty('settlementId');
  });
});
