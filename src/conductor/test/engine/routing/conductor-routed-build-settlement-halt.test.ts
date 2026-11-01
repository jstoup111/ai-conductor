// Covers: task:3, task:4, task:5, task:8
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { Conductor, type StepRunner } from '../../../src/engine/conductor.js';
import { renderKickbackBudgetView } from '../../../src/engine/kickback-budget-view.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { readBuildOutcome } from '../../../src/engine/build-outcome.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeKickbackLedger } from '../../kickback-ledger-test-support.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';

const settlementSeam = vi.hoisted(() => ({
  haltedReason: undefined as string | undefined,
}));

const claimSeam = vi.hoisted(() => ({
  detail: undefined as string | undefined,
  calls: [] as unknown[],
}));

vi.mock('../../../src/engine/routing/round-receipt.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/round-receipt.js')>();
  return {
    ...actual,
    settleRoundAtDispatch: vi.fn(async (input) => settlementSeam.haltedReason === undefined
      ? actual.settleRoundAtDispatch(input)
      : { kind: 'halted' as const, reason: settlementSeam.haltedReason }),
  };
});

vi.mock('../../../src/engine/routing/prerequisite-claim.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/prerequisite-claim.js')>();
  return {
    ...actual,
    settleRoutedBuildClaim: vi.fn(async (input) => {
      claimSeam.calls.push(input.structuredResult);
      return claimSeam.detail === undefined
        ? actual.settleRoutedBuildClaim(input)
        : { kind: 'failed' as const, detail: claimSeam.detail };
    }),
  };
});

const child = parseChildId(1)!;
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  settlementSeam.haltedReason = undefined;
  claimSeam.detail = undefined;
  claimSeam.calls.length = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function subject(options: {
  added?: number;
  allocation?: Record<number, { remTaskIds: string[]; blockBodies: string[] }>;
  authored?: number;
  cap?: number;
  configGrowthCap?: number;
  growth?: number;
  items?: RouteRecord['items'];
  laps?: number;
  receiptLaps?: Partial<Record<'prd_audit' | 'architecture_review_as_built', number>>;
  effectiveLapCap?: number;
  pendingAsBuiltFindings?: { gate: 'architecture_review_as_built'; finding: string; class: 'REMEDIABLE'; governingClause: string; summary: string; outcome: 'remediated' }[];
  omitEffectiveGrowthCap?: boolean;
  roundId?: string;
  settledEarlierGrowth?: number;
  buildResult?: unknown;
  activeChild?: number;
  maxRetries?: number;
  operatorParkAfterBuild?: boolean;
} = {}) {
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
    version: 1, ...(options.omitEffectiveGrowthCap ? {} : { effectiveGrowthCap: options.cap ?? 14 }),
    gates: { prd_audit: { count: 0, cumulative: 0, laps: options.laps ?? 0, ...(options.effectiveLapCap === undefined ? {} : { effectiveLapCap: options.effectiveLapCap }), treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 } },
    growth: { authored: options.authored ?? 1, added: options.added ?? 13, byGate: {} },
  });
  const routeRoundId = parseRoundId(options.roundId ?? 'r8')!;
  const created = await createRouteRecord(root, 'demo', {
    roundId: routeRoundId, sealedAuthored: options.authored ?? 1, kind: 'audit',
    items: options.items ?? [
      { findingId: 'S1.1', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] },
      { findingId: 'S3.1', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] },
    ],
    allocation: options.allocation ?? { [child]: { remTaskIds: ['rem-prd-audit-6.r1', 'rem-prd-audit-6.r2'], blockBodies: ['### Task rem-prd-audit-6.r1\n', '### Task rem-prd-audit-6.r2\n'] } },
    ...(options.pendingAsBuiltFindings === undefined ? {} : { pendingAsBuiltFindings: options.pendingAsBuiltFindings }),
    receipt: { ...emptyUnsettledReceipt(), laps: options.receiptLaps ?? { prd_audit: 1 }, growth: options.growth ?? 2 },
  });
  if (created.kind !== 'created') throw new Error(`route fixture: ${created.kind}`);
  if (options.settledEarlierGrowth !== undefined) {
    const earlierRoundId = parseRoundId('r4')!;
    const earlier = await createRouteRecord(root, 'demo', {
      roundId: earlierRoundId, sealedAuthored: options.authored ?? 1, kind: 'audit',
      items: [{ findingId: 'earlier', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
      allocation: { [child]: { remTaskIds: ['rem-earlier-1', 'rem-earlier-2'], blockBodies: ['### Task rem-earlier-1\n', '### Task rem-earlier-2\n'] } },
      receipt: { ...emptyUnsettledReceipt(), laps: { prd_audit: 1 }, growth: options.settledEarlierGrowth },
    });
    if (earlier.kind !== 'created') throw new Error(`earlier route fixture: ${earlier.kind}`);
    const storedEarlier = await readRouteRecord(root, 'demo', earlierRoundId, { git });
    if (storedEarlier.kind !== 'record') throw new Error('earlier route fixture missing');
    const updated = await writeRouteRecord(root, storedEarlier, {
      ...storedEarlier.record,
      receipt: { ...storedEarlier.record.receipt, settlementId: 'r4-settled', acks: { [child]: true } },
    }, { git });
    if (updated.kind !== 'updated') throw new Error(`earlier route fixture settlement: ${updated.kind}`);
  }
  if ((await admitRound(root, 'demo', created.record, child, { git })).kind !== 'admitted') {
    throw new Error('route fixture admission failed');
  }
  let parkAfterBuild = false;
  const build = vi.fn(async () => {
    parkAfterBuild = options.operatorParkAfterBuild ?? true;
    return { success: true, ...(options.buildResult === undefined ? {} : { finalStructuredResult: options.buildResult }) };
  });
  const runner: StepRunner = { run: async (step, _state, options) => step === 'build' ? build(options) : { success: true } };
  const events = new ConductorEventEmitter();
  const conductor = new Conductor({
    projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
    mode: 'auto', daemon: true, resume: true, fromStep: 'build', verifyArtifacts: false, maxRetries: options.maxRetries ?? 1,
    events, stepRunner: runner,
    operatorParkBoundary: async () => parkAfterBuild,
    config: { defaults: { model: 'test', effort: 'low', max_retries: 1, escalate: false }, prd_audit: { max_remediation_laps: 2, max_appended_tasks: options.configGrowthCap ?? 4, max_appended_ratio: 1 }, stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({ kind: 'active', child: options.activeChild ?? child, position: options.activeChild ?? child, isLeaf: true, branch: 'feat/demo', routedRepair: { child: options.activeChild ?? child, roundId: routeRoundId } }) as never,
      enterHostRegion: async () => ({ kind: 'resume', pinnedBase: 'a'.repeat(40) }) as never,
      enterChildRegion: async () => ({ kind: 'completed' }) as never,
    },
  });
  return { root, build, conductor, events, git, roundId: routeRoundId };
}

async function enableRoutedGrowthSnapshot(root: string) {
  await mkdir(join(root, '.pipeline', 'children'), { recursive: true });
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), [
    'stacked_prs:',
    '  enabled: true',
    '  max_slices: 2',
    '  route_whole_feature_fixes: true',
    '',
  ].join('\n'));
  await writeSliceTopologyFixture(root, {
    slug: 'demo',
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['First', 'Second'] },
  });
}

describe('routed BUILD settlement cap halt', () => {
  it('renders the refused round growth, concrete recovery raise, and reconciled cap evidence', async () => {
    const fixture = await subject();
    await fixture.conductor.run();

    expect(fixture.build).not.toHaveBeenCalled();
    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt.split('\n')[0]).toBe('BUILD dispatch halted: prd_audit growth allowance exhausted.');
    expect(halt).toContain('Plan growth: 13/14 added; 0 remaining (raised cap)\nPending growth: 2 (prd_audit 2); would reach 15/14 when build dispatches; minimum raise 1');
    expect(halt).toContain('kickback-budget raise --feature demo --gate prd_audit --by 1');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('kickback-cap');
    await expect(readKickbackLedger(fixture.root)).resolves.toMatchObject({
      gates: { prd_audit: { capEvidence: { allowance: 'growth', consumed: 13, limit: 14 } } },
      growth: { added: 13 },
    });
  });

  it('renders an as-built-only refused receipt against its config-derived growth cap', async () => {
    const fixture = await subject({
      added: 0, authored: 3, configGrowthCap: 3, growth: 4, omitEffectiveGrowthCap: true,
      receiptLaps: { architecture_review_as_built: 1 },
    });
    await fixture.conductor.run();

    expect(fixture.build).not.toHaveBeenCalled();
    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Plan growth: 0/3 added; 0 remaining (config-derived cap)\nPending growth: 4 (architecture_review_as_built 4); would reach 4/3 when build dispatches; minimum raise 1');
    expect(halt).toContain('kickback-budget raise --feature demo --gate architecture_review_as_built --by 1');
  });

  it('renders joined-round growth once under prd audit at the routed BUILD boundary', async () => {
    const fixture = await subject({
      added: 6, cap: 8, growth: 3,
      receiptLaps: { prd_audit: 1, architecture_review_as_built: 1 },
    });
    await fixture.conductor.run();

    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Pending growth: 3 (prd_audit 3); would reach 9/8 when build dispatches; minimum raise 1');
  });

  it('renders reconciled earlier receipt growth against a config-derived cap', async () => {
    const fixture = await subject({
      added: 6, authored: 10, configGrowthCap: 10, growth: 3, omitEffectiveGrowthCap: true, settledEarlierGrowth: 2,
    });
    await fixture.conductor.run();

    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Plan growth: 8/10 added; 0 remaining (config-derived cap)');
    expect(halt).toContain('would reach 11/10 when build dispatches; minimum raise 1');
    await expect(readKickbackLedger(fixture.root)).resolves.toMatchObject({
      gates: { prd_audit: { capEvidence: { consumed: 8, limit: 10 } } },
      growth: { added: 8 },
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
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('kickback-cap');
  });

  it('settles and dispatches after a sufficient raise, while an unchanged cap remains side-effect free', async () => {
    const raised = await subject({ cap: 15 });
    await raised.conductor.run();
    expect(raised.build).toHaveBeenCalledOnce();
    await expect(readKickbackLedger(raised.root)).resolves.toMatchObject({ growth: { added: 15 }, gates: { prd_audit: { laps: 1 } } });
    await expect(readRouteRecord(raised.root, 'demo', raised.roundId, { git: raised.git })).resolves.toMatchObject({ kind: 'record', record: { receipt: { settlementId: expect.any(String) } } });
    await expect(readFile(join(raised.root, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });

    const unchanged = await subject();
    await unchanged.conductor.run();
    await expect(readFile(join(unchanged.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('minimum raise 1');
    await expect(readKickbackLedger(unchanged.root)).resolves.toMatchObject({ growth: { added: 13 }, gates: { prd_audit: { laps: 0 } } });
    const unsettled = await readRouteRecord(unchanged.root, 'demo', unchanged.roundId, { git: unchanged.git });
    expect(unsettled).toMatchObject({ kind: 'record' });
    if (unsettled.kind === 'record') expect(unsettled.record.receipt).not.toHaveProperty('settlementId');
  });

  it('names the refused r8 findings and remediation tasks in order and records the same reason', async () => {
    const fixture = await subject();
    await fixture.conductor.run();

    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Routed round r8 findings: S1.1, S3.1\nRouted round r8 remediation tasks: rem-prd-audit-6.r1, rem-prd-audit-6.r2');
    expect(halt).not.toContain('repair record is malformed');
    await expect(readKickbackLedger(fixture.root)).resolves.toMatchObject({
      gates: { prd_audit: { capEvidence: { latestReason: 'Routed round r8 findings: S1.1, S3.1' } } },
    });
  });

  it('renders routed pending as-built findings and tasks from a two-host round', async () => {
    const fixture = await subject({
      roundId: 'r1',
      allocation: {
        1: { remTaskIds: ['rem-ab-1.r1', 'rem-ab-1.r2'], blockBodies: ['### Task rem-ab-1.r1\n', '### Task rem-ab-1.r2\n'] },
        2: { remTaskIds: ['rem-ab-1.r3', 'rem-ab-1.r4'], blockBodies: ['### Task rem-ab-1.r3\n', '### Task rem-ab-1.r4\n'] },
      },
      pendingAsBuiltFindings: [{ gate: 'architecture_review_as_built', finding: 'AB-1', class: 'REMEDIABLE', governingClause: 'adr-x D2', summary: 'drift', outcome: 'remediated' }],
    });
    await fixture.conductor.run();

    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Routed round r1 remediation tasks: rem-ab-1.r1, rem-ab-1.r2, rem-ab-1.r3, rem-ab-1.r4');
    expect(halt).toContain('Blocking findings:\nAB-1 (REMEDIABLE; adr-x D2): drift');
  });

  it('names existing task repairs for a routed lap halt without a remediation-task line', async () => {
    const fixture = await subject({
      added: 0, cap: 10, growth: 0, laps: 2, effectiveLapCap: 2, roundId: 'r3',
      allocation: { 1: { remTaskIds: [], blockBodies: [] } },
      items: [{ findingId: 'S2.1', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [], existingTask: true, taskIds: ['4', '7'] }],
    });
    await fixture.conductor.run();

    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Routed round r3 findings: S2.1');
    expect(halt).toContain('Routed round r3 repairs existing tasks: 4, 7');
    expect(halt).not.toContain('Routed round r3 remediation tasks:');
    expect(halt).not.toContain('repair record is malformed');
    expect(halt).not.toContain('Pending growth:');
    const planGrowthLine = halt.split('\n').find((line) => line.startsWith('Plan growth:'));
    const noPendingLine = renderKickbackBudgetView(undefined, 'prd_audit', 2, {
      authored: 1, added: 0, byGate: {}, remaining: 10, cap: 10,
      capSource: 'raised', authoredSource: 'plan',
    }).split('\n').find((line) => line.startsWith('Plan growth:'));
    expect(planGrowthLine).toBe(noPendingLine);
  });

  it('refuses an oversized routed round without dispatching or settling it', async () => {
    const fixture = await subject({ added: 0, cap: 16, growth: 17 });
    const before = await readKickbackLedger(fixture.root);
    await fixture.conductor.run();

    expect(fixture.build).not.toHaveBeenCalled();
    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Plan growth: 0/16 added; 0 remaining (raised cap)');
    expect(halt).toContain('would reach 17/16 when build dispatches; minimum raise 1');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('kickback-cap');
    const after = await readKickbackLedger(fixture.root);
    expect(after).toMatchObject(before);
    expect(after).toMatchObject({
      effectiveGrowthCap: 16,
      growth: { authored: 1, added: 0, byGate: {} },
    });
    const record = await readRouteRecord(fixture.root, 'demo', fixture.roundId, { git: fixture.git });
    expect(record).toMatchObject({ kind: 'record' });
    if (record.kind === 'record') expect(record.record.receipt).not.toHaveProperty('settlementId');
  });

  it('names remediation tasks before existing task repairs when both are routed', async () => {
    const fixture = await subject({
      roundId: 'r9',
      items: [
        { findingId: 'S1.1', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] },
        { findingId: 'S2.1', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [], existingTask: true, taskIds: ['4', '7'] },
      ],
    });
    await fixture.conductor.run();

    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('Routed round r9 remediation tasks: rem-prd-audit-6.r1, rem-prd-audit-6.r2\nRouted round r9 repairs existing tasks: 4, 7');
  });

  it('halts needs-human with the unreadable route ref before BUILD', async () => {
    const fixture = await subject();
    await enableRoutedGrowthSnapshot(fixture.root);
    const malformed = await fixture.git(['hash-object', '-w', '--stdin'], { input: '{not-json' });
    await fixture.git(['update-ref', `refs/conductor/demo/routes/${fixture.roundId}`, malformed.stdout.trim()]);

    await fixture.conductor.run();

    expect(fixture.build).not.toHaveBeenCalled();
    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(new RegExp(`Pending remediation findings are unavailable: .*refs/conductor/demo/routes/${fixture.roundId}`));
    expect(halt).not.toContain('Pending growth:');
    expect(halt).toContain('--by «N»');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it.each([
    'route record r8 is unreadable',
    'route record r8 is absent',
    'routing round r8 has an open restack journal',
  ])('halts needs-human with a routed settlement failure reason: %s', async (reason) => {
    settlementSeam.haltedReason = reason;
    const fixture = await subject();

    await fixture.conductor.run();

    expect(fixture.build).not.toHaveBeenCalled();
    const halt = await readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(`Pending remediation findings are unavailable: ${reason}.`);
    if (reason.includes('restack')) expect(halt).not.toContain('malformed');
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  // Covers: task:8
  // Rejected prerequisite claims are ordinary, region-local failed BUILD
  // attempts. The actual claim normalization is covered by the real-Git
  // settlement tests; this keeps the conductor assertion at its orchestration
  // boundary.
  it.each([
    [{ outcome: 'blocked-by-prerequisite', child: 2, paths: ['src/engine/a.ts'] }, 'claimed prerequisite is already present at host 1', 1],
    [{ outcome: 'blocked-by-prerequisite', child: 2, paths: ['src/engine/'] }, 'claim names no prerequisite file', 1],
    [{ outcome: 'blocked-by-prerequisite', child: 2, paths: ['index.ts'] }, 'claim names no prerequisite file', 1],
    [{ outcome: 'blocked-by-prerequisite', child: 2, paths: ['src/engine/register-artifact-cli.ts'] }, 'claimed destination 2 lacks prerequisite paths', 1],
  ])('passes every rejected claim through as a child-one unsuccessful attempt without a routing halt', async (claim, detail, activeChild) => {
    claimSeam.detail = `routed prerequisite claim unverified: ${detail}`;
    // Keep one retry available so the injected operator park ends after the
    // failed, charged attempt rather than synthesizing the generic exhausted
    // BUILD HALT that is outside this routed-claim boundary.
    const fixture = await subject({ cap: 15, activeChild, buildResult: claim, maxRetries: 2 });
    const failures: unknown[] = [];
    const retries: unknown[] = [];
    fixture.events.on('step_failed', (event) => failures.push(event));
    fixture.events.on('step_retry', (event) => retries.push(event));

    await fixture.conductor.run();

    expect(claimSeam.calls).toContainEqual(claim);
    expect(fixture.build).toHaveBeenCalled();
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readRouteRecord(fixture.root, 'demo', fixture.roundId, { git: fixture.git })).resolves.toMatchObject({
      kind: 'record', record: { items: expect.arrayContaining([expect.objectContaining({ host: child })]) },
    });
    await expect(readBuildOutcome(fixture.root)).resolves.toMatchObject({
      records: [expect.objectContaining({
        terminalOutcome: 'failed',
        note: [`routed prerequisite claim unverified: ${detail}`],
        reason: 'routed-prerequisite-claim',
      })],
    });
    expect(failures).toEqual([]);
    expect(retries).toContainEqual(expect.objectContaining({
      type: 'step_retry', step: 'build', attempt: 2,
      reason: `routed prerequisite claim unverified: ${detail}`,
    }));
  });

  it.each([
    [{ outcome: 'blocked-by-prerequisite', child: 2, paths: ['src/engine/a.ts'] }, 'claimed prerequisite is already present at host 1'],
    [{ outcome: 'blocked-by-prerequisite', child: 2, paths: ['src/engine/'] }, 'claim names no prerequisite file'],
    [{ outcome: 'blocked-by-prerequisite', child: 2, paths: ['index.ts'] }, 'claim names no prerequisite file'],
    [{ outcome: 'blocked-by-prerequisite', child: 2, paths: ['src/engine/register-artifact-cli.ts'] }, 'claimed destination 2 lacks prerequisite paths'],
  ])('bounds repeated rejected claims within the child-one BUILD retry allowance: %o', async (claim, detail) => {
    const maxRetries = 3;
    claimSeam.detail = `routed prerequisite claim unverified: ${detail}`;
    const fixture = await subject({
      cap: 15,
      activeChild: child,
      buildResult: claim,
      maxRetries,
      operatorParkAfterBuild: false,
    });
    const terminalEvents: unknown[] = [];
    fixture.events.on('step_retry', (event) => terminalEvents.push(event));
    fixture.events.on('step_failed', (event) => terminalEvents.push(event));
    await fixture.conductor.run();

    expect(fixture.build).toHaveBeenCalledTimes(maxRetries);
    expect(claimSeam.calls).toEqual(Array(maxRetries).fill(claim));
    expect(fixture.build.mock.calls.map(([options]) => options?.attempt)).toEqual([1, 2, 3]);
    await expect(readFile(join(fixture.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      "step 'build' failed in auto mode (retries exhausted)",
    );
    await expect(readBuildOutcome(fixture.root)).resolves.toMatchObject({
      records: expect.arrayContaining([expect.objectContaining({
        reason: 'routed-prerequisite-claim',
        note: [`routed prerequisite claim unverified: ${detail}`],
      })]),
    });
    await expect(readRouteRecord(fixture.root, 'demo', fixture.roundId, { git: fixture.git })).resolves.toMatchObject({
      kind: 'record', record: { items: expect.arrayContaining([expect.objectContaining({ host: child })]) },
    });
    expect(terminalEvents).toEqual([
      expect.objectContaining({
        type: 'step_retry', step: 'build', attempt: 2,
        reason: `routed prerequisite claim unverified: ${detail}`,
      }),
      expect.objectContaining({
        type: 'step_retry', step: 'build', attempt: 3,
        reason: `routed prerequisite claim unverified: ${detail}`,
      }),
      expect.objectContaining({
        type: 'step_failed', step: 'build', retryCount: maxRetries, child,
        error: `routed prerequisite claim unverified: ${detail}`,
      }),
    ]);
  });
});
