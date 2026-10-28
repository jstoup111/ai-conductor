// Covers: task:1, task:7, task:60
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const receiptTestSpies = vi.hoisted(() => ({ order: undefined as string[] | undefined }));

vi.mock('../../../src/engine/kickback-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/kickback-ledger.js')>();
  return {
    ...actual,
    writeKickbackLedgerUnlocked: async (...args: Parameters<typeof actual.writeKickbackLedgerUnlocked>) => {
      receiptTestSpies.order?.push('flat-ledger-write');
      await actual.writeKickbackLedgerUnlocked(...args);
    },
  };
});

import { parseChildId } from '../../../src/engine/child-context.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { writeKickbackLedger } from '../../kickback-ledger-test-support.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { settleRoundAtDispatch } from '../../../src/engine/routing/round-receipt.js';
import { currentHostOf, emptyUnsettledReceipt, parseRoundId, parseRouteRecord, type ReceiptLapCharges, type RouteRecord, type SettledRoundReceipt } from '../../../src/engine/routing/route-types.js';

const host = parseChildId(1)!;
const leaf = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const routing = { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } } as const;

function budgets(gates: readonly ('prd_audit' | 'architecture_review_as_built')[] = ['prd_audit']) {
  return gates.map((gate) => ({
    gate, lapCap: 2, growthCap: 4,
    growth: { authored: 4, added: 0, byGate: {}, remaining: 4 },
    authoredSource: 'plan' as const,
  }));
}

async function fixture(options: { readonly laps?: ReceiptLapCharges; readonly leafOnly?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-'));
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'receipt@example.test']);
  await git(['config', 'user.name', 'Receipt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const allocation = options.leafOnly
    ? { [leaf]: { remTaskIds: ['rem-prd-audit-T2'], blockBodies: ['### Task rem-prd-audit-T2\n'] } }
    : {
        [host]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] },
        [leaf]: { remTaskIds: ['rem-prd-audit-T2'], blockBodies: ['### Task rem-prd-audit-T2\n'] },
      };
  const made = await createRouteRecord(root, 'demo', {
    roundId,
    sealedAuthored: 1,
    kind: 'audit',
    items: [
      { findingId: 'prd-fixable', kind: 'audit', owner: host, host, reason: 'task-slice', fallback: [] },
      ...(options.leafOnly ? [] : [{ findingId: 'as-built-remediable', kind: 'audit' as const, owner: leaf, host: leaf, reason: 'task-slice', fallback: [] }]),
    ],
    allocation,
    receipt: {
      ...emptyUnsettledReceipt(),
      laps: options.laps ?? { prd_audit: 1 },
      growth: Object.values(allocation).reduce((sum, value) => sum + value.remTaskIds.length, 0),
    },
  });
  if (made.kind !== 'created') throw new Error(made.kind);
  return { root, git, firstHost: options.leafOnly ? leaf : host };
}

async function settlementFixture(options: {
  readonly roundId?: string;
  readonly laps?: ReceiptLapCharges;
  readonly growth?: number;
  readonly allocation?: RouteRecord['allocation'];
  readonly items?: RouteRecord['items'];
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-settlement-'));
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'receipt@example.test']);
  await git(['config', 'user.name', 'Receipt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const fixtureRoundId = parseRoundId(options.roundId ?? 'r8')!;
  const allocation = options.allocation ?? {
    [host]: { remTaskIds: ['rem-prd-audit-6.r1', 'rem-prd-audit-6.r2'], blockBodies: ['### Task rem-prd-audit-6.r1\n', '### Task rem-prd-audit-6.r2\n'] },
  };
  const made = await createRouteRecord(root, 'demo', {
    roundId: fixtureRoundId,
    sealedAuthored: 1,
    kind: 'audit',
    items: options.items ?? [
      { findingId: 'S1.1', kind: 'audit', owner: host, host, reason: 'task-slice', fallback: [] },
      { findingId: 'S3.1', kind: 'audit', owner: host, host, reason: 'task-slice', fallback: [] },
    ],
    allocation,
    receipt: {
      ...emptyUnsettledReceipt(),
      laps: options.laps ?? { prd_audit: 1 },
      growth: options.growth ?? Object.values(allocation).reduce((sum, value) => sum + value.remTaskIds.length, 0),
    },
  });
  if (made.kind !== 'created') throw new Error(made.kind);
  return { root, git, roundId: fixtureRoundId };
}

async function operatorFixture() {
  const subject = await fixture({ leafOnly: true });
  const initial = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
  if (initial.kind !== 'record') throw new Error('missing initial operator route record');
  if ((await admitRound(subject.root, 'demo', initial.record, subject.firstHost, { git: subject.git })).kind !== 'admitted') {
    throw new Error('cannot admit operator route record');
  }
  const stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
  if (stored.kind !== 'record') throw new Error('missing operator route record');
  const tip = parseCommitSha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim());
  if (!tip) throw new Error('invalid operator tip');
  const operator: RouteRecord = {
    ...stored.record,
    kind: 'operator',
    receipt: emptyUnsettledReceipt(),
    operator: {
      origin: 'land',
      reason: 'reviewer requested change',
      operator: 'operator@example.test',
      entryStep: 'build',
      carried: [],
      otherTips: { 'feat/daemon-demo': tip },
      priorRegion: {
        statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' },
        verdicts: {},
      },
    },
  };
  if ((await writeRouteRecord(subject.root, stored, operator, { git: subject.git })).kind !== 'updated') {
    throw new Error('cannot write operator route record');
  }
  return subject;
}

describe('round receipt settlement', () => {
  it('describes a growth-refused round with its findings, tasks, charge, and settled ledger position', async () => {
    const subject = await settlementFixture();
    try {
      await writeKickbackLedger(subject.root, {
        version: 1, effectiveGrowthCap: 14, gates: {}, growth: { authored: 1, added: 13, byGate: {} },
      });

      await expect(settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId: subject.roundId, dispatchingChild: host, budgets: budgets(), routing, git: subject.git }))
        .resolves.toEqual({
          kind: 'exhausted', gate: 'prd_audit', allowance: 'growth', round: {
            roundId: 'r8', findingIds: ['S1.1', 'S3.1'], remTaskIds: ['rem-prd-audit-6.r1', 'rem-prd-audit-6.r2'], existingTaskIds: [], pendingAsBuiltFindings: [],
            charges: { prd_audit: { laps: 1, growth: 2 } }, settledAdded: 13, growthCap: 14,
          },
        });
    } finally { await rm(subject.root, { recursive: true, force: true }); }
  });

  it('uses host order, deterministic growth ownership, and existing-task bindings in refused-round detail', async () => {
    const subject = await settlementFixture({
      laps: { architecture_review_as_built: 1, prd_audit: 1 }, growth: 3,
      allocation: {
        [host]: { remTaskIds: ['rem-host-1'], blockBodies: ['### Task rem-host-1\n'] },
        [leaf]: { remTaskIds: ['rem-host-2'], blockBodies: ['### Task rem-host-2\n'] },
      },
    });
    const existing = await settlementFixture({
      roundId: 'r3', growth: 0, allocation: { [host]: { remTaskIds: [], blockBodies: [] } },
      items: [{ findingId: 'S2.1', kind: 'audit', owner: host, host, reason: 'task-slice', fallback: [], existingTask: true, taskIds: ['4', '7'] }],
    });
    try {
      await writeKickbackLedger(subject.root, { version: 1, effectiveGrowthCap: 2, gates: {}, growth: { authored: 1, added: 0, byGate: {} } });
      await writeKickbackLedger(existing.root, { version: 1, gates: { prd_audit: { count: 0, cumulative: 0, laps: 2, treeHash: null, lastReason: '', priorVerdict: false, resolvedBefore: 0 } }, growth: { authored: 1, added: 0, byGate: {} } });

      await expect(settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId: subject.roundId, dispatchingChild: host, budgets: budgets(['prd_audit', 'architecture_review_as_built']), routing, git: subject.git }))
        .resolves.toMatchObject({ round: { remTaskIds: ['rem-host-1', 'rem-host-2'], charges: { prd_audit: { laps: 1, growth: 3 }, architecture_review_as_built: { laps: 1, growth: 0 } } } });
      await expect(settleRoundAtDispatch({ projectRoot: existing.root, slug: 'demo', roundId: existing.roundId, dispatchingChild: host, budgets: budgets(), routing, git: existing.git }))
        .resolves.toMatchObject({ kind: 'exhausted', round: { remTaskIds: [], existingTaskIds: ['4', '7'] } });
    } finally { await Promise.all([subject.root, existing.root].map((root) => rm(root, { recursive: true, force: true }))); }
  });

  it('reports reconciled settled growth, then settles after the necessary growth-cap raise', async () => {
    const subject = await settlementFixture({ growth: 3 });
    try {
      const earlierRoundId = parseRoundId('r4')!;
      const created = await createRouteRecord(subject.root, 'demo', {
        roundId: earlierRoundId, sealedAuthored: 1, kind: 'audit',
        items: [{ findingId: 'earlier', kind: 'audit', owner: host, host, reason: 'task-slice', fallback: [] }],
        allocation: { [host]: { remTaskIds: ['rem-earlier-task', 'rem-earlier-task-2'], blockBodies: ['### Task rem-earlier-task\n', '### Task rem-earlier-task-2\n'] } },
        receipt: { ...emptyUnsettledReceipt(), laps: { prd_audit: 1 }, growth: 2 },
      }, { git: subject.git });
      if (created.kind !== 'created') throw new Error('cannot create earlier record');
      const earlierStored = await readRouteRecord(subject.root, 'demo', earlierRoundId, { git: subject.git });
      if (earlierStored.kind !== 'record') throw new Error('missing earlier route record');
      const settledReceipt: SettledRoundReceipt = {
        ...earlierStored.record.receipt,
        settlementId: 'r4-settled',
        acks: { [host]: true } as Record<typeof host, true>,
      };
      const settledEarlier: RouteRecord = { ...earlierStored.record, receipt: settledReceipt };
      if ((await writeRouteRecord(subject.root, earlierStored, settledEarlier, { git: subject.git })).kind !== 'updated') throw new Error('cannot seed earlier record');
      await writeKickbackLedger(subject.root, { version: 1, effectiveGrowthCap: 10, gates: {}, growth: { authored: 1, added: 6, byGate: {} } });

      await expect(settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId: subject.roundId, dispatchingChild: host, budgets: budgets(), routing, git: subject.git }))
        .resolves.toMatchObject({ kind: 'exhausted', round: { settledAdded: 8, growthCap: 10 } });

      const r8 = await settlementFixture();
      try {
        await writeKickbackLedger(r8.root, { version: 1, effectiveGrowthCap: 14, gates: {}, growth: { authored: 1, added: 13, byGate: {} } });
        await expect(settleRoundAtDispatch({ projectRoot: r8.root, slug: 'demo', roundId: r8.roundId, dispatchingChild: host, budgets: budgets(), routing, git: r8.git })).resolves.toMatchObject({ kind: 'exhausted' });
        await writeKickbackLedger(r8.root, { version: 1, effectiveGrowthCap: 15, gates: {}, growth: { authored: 1, added: 13, byGate: {} } });
        await expect(settleRoundAtDispatch({ projectRoot: r8.root, slug: 'demo', roundId: r8.roundId, dispatchingChild: host, budgets: budgets(), routing, git: r8.git })).resolves.toMatchObject({ kind: 'settled' });
        expect(await readKickbackLedger(r8.root)).toMatchObject({ growth: { added: 15 }, gates: { prd_audit: { laps: 1 } } });
      } finally { await rm(r8.root, { recursive: true, force: true }); }
    } finally { await rm(subject.root, { recursive: true, force: true }); }
  });

  it('refuses an oversized round without assigning a receipt settlement or mutating the ledger', async () => {
    const subject = await settlementFixture({ growth: 17 });
    try {
      await writeKickbackLedger(subject.root, { version: 1, effectiveGrowthCap: 16, gates: {}, growth: { authored: 1, added: 0, byGate: {} } });
      const ledgerPath = join(subject.root, '.pipeline', 'kickback-ledger.json');
      const before = await readFile(ledgerPath, 'utf8');
      await expect(settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId: subject.roundId, dispatchingChild: host, budgets: budgets(), routing, git: subject.git }))
        .resolves.toMatchObject({ kind: 'exhausted', round: { settledAdded: 0, growthCap: 16 } });
      expect(await readFile(ledgerPath, 'utf8')).toBe(before);
      const stored = await readRouteRecord(subject.root, 'demo', subject.roundId, { git: subject.git });
      expect(stored).toMatchObject({ kind: 'record' });
      if (stored.kind === 'record') expect(stored.record.receipt).not.toHaveProperty('settlementId');
    } finally { await rm(subject.root, { recursive: true, force: true }); }
  });

  it('acknowledges an operator dispatch without settling or charging its empty receipt', async () => {
    const subject = await operatorFixture();
    try {
      const before = await readKickbackLedger(subject.root);
      const result = await settleRoundAtDispatch({
        projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: subject.firstHost,
        budgets: budgets(), routing, git: subject.git,
      });

      expect(result).toEqual({ kind: 'acknowledged' });
      expect(result).not.toHaveProperty('settlementId');
      expect(await readKickbackLedger(subject.root)).toEqual(before);
      await expect(readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({
        kind: 'record', record: { receipt: { laps: {}, growth: 0, taskless: {}, acks: {} } },
      });
    } finally { await rm(subject.root, { recursive: true, force: true }); }
  });

  it('uses the parser current host for sparse host keys before settling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'round-receipt-sparse-hosts-'));
    const git = makeGitRunner(root);
    const first = parseChildId(2)!;
    const second = parseChildId(4)!;
    try {
      await git(['init', '-q', '-b', 'main']);
      await git(['config', 'user.email', 'receipt@example.test']);
      await git(['config', 'user.name', 'Receipt']);
      const created = await createRouteRecord(root, 'demo', {
        roundId,
        sealedAuthored: 1,
        kind: 'audit',
        items: [
          { findingId: 'first', kind: 'audit', owner: first, host: first, reason: 'task-slice', fallback: [] },
          { findingId: 'second', kind: 'audit', owner: second, host: second, reason: 'task-slice', fallback: [] },
        ],
        allocation: {
          [first]: { remTaskIds: ['rem-prd-audit-T2'], blockBodies: ['### Task rem-prd-audit-T2\n'] },
          [second]: { remTaskIds: ['rem-prd-audit-T4'], blockBodies: ['### Task rem-prd-audit-T4\n'] },
        },
      }, { git });
      if (created.kind !== 'created') throw new Error(created.kind);
      const admitted = await admitRound(root, 'demo', created.record, first, { git });
      if (admitted.kind !== 'admitted') throw new Error(admitted.kind);
      const stored = await readRouteRecord(root, 'demo', roundId, { git });
      if (stored.kind !== 'record') throw new Error(stored.kind);
      const parsed = parseRouteRecord(JSON.stringify(stored.record));

      expect(currentHostOf(parsed!)).toBe(first);
      await expect(settleRoundAtDispatch({ projectRoot: root, slug: 'demo', roundId, dispatchingChild: first, budgets: budgets(), routing, git }))
        .resolves.toMatchObject({ kind: 'settled' });
      await expect(settleRoundAtDispatch({ projectRoot: root, slug: 'demo', roundId, dispatchingChild: second, budgets: budgets(), routing, git }))
        .resolves.toMatchObject({ kind: 'refused', reason: 'not-current-host' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('CAS-settles host 1 before the provider dispatch, charging one prd_audit lap and two frozen tasks', async () => {
    const subject = await fixture();
    try {
      const order: string[] = [];
      const git: GitRunner = async (args, options) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes('refs/conductor/demo/routes/r1')) order.push('receipt-cas');
        return subject.git(args, options);
      };
      receiptTestSpies.order = order;
      const result = await settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: subject.firstHost, budgets: budgets(), routing, git });
      order.push('provider-dispatch');

      expect(result).toMatchObject({ kind: 'settled', settlementId: expect.stringMatching(/^r1-/) });
      const stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
      expect(stored).toMatchObject({ kind: 'record', record: { receipt: { laps: { prd_audit: 1 }, growth: 2, settlementId: expect.any(String) } } });
      const ledger = await readKickbackLedger(subject.root);
      expect(ledger).toMatchObject({ gates: { prd_audit: { laps: 1 } }, growth: { added: 2 } });
      expect(Object.values(ledger.settlementReceipts ?? {})).toEqual([{ gates: ['prd_audit'] }]);
      expect(order).toEqual(['receipt-cas', 'flat-ledger-write', 'provider-dispatch']);
    } finally {
      receiptTestSpies.order = undefined;
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('acknowledges a later current host without changing its settled prd_audit or growth charge', async () => {
    const subject = await fixture();
    try {
      const first = await settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: host, budgets: budgets(), routing, git: subject.git });
      expect(first.kind).toBe('settled');
      const before = await readKickbackLedger(subject.root);
      const stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
      if (stored.kind !== 'record') throw new Error('missing route record');
      // The round advances to its next host only after the first finished in place.
      expect((await writeRouteRecord(subject.root, stored, {
        ...stored.record, phase: 'open', hosts: { [host]: 'restacked', [leaf]: 'admitted' }, currentHostIndex: 1,
      }, { git: subject.git })).kind).toBe('updated');

      await expect(settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: leaf, budgets: budgets(), routing, git: subject.git })).resolves.toMatchObject({ kind: 'acknowledged' });
      const after = await readKickbackLedger(subject.root);
      expect(JSON.stringify({ laps: after.gates.prd_audit?.laps, added: after.growth?.added })).toBe(JSON.stringify({ laps: before.gates.prd_audit?.laps, added: before.growth?.added }));
      expect(await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).toMatchObject({ kind: 'record', record: { receipt: { acks: { 1: true, 2: true } } } });
    } finally { await rm(subject.root, { recursive: true, force: true }); }
  });

  it('charges joined prd_audit FIXABLE and as-built REMEDIABLE gates once under one settlement receipt', async () => {
    const subject = await fixture({ laps: { prd_audit: 1, architecture_review_as_built: 1 } });
    try {
      await expect(settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: host, budgets: budgets(['prd_audit', 'architecture_review_as_built']), routing, git: subject.git })).resolves.toMatchObject({ kind: 'settled' });
      const ledger = await readKickbackLedger(subject.root);
      expect(ledger).toMatchObject({ gates: { prd_audit: { laps: 1 }, architecture_review_as_built: { laps: 1 } }, growth: { added: 2 } });
      expect(Object.values(ledger.settlementReceipts ?? {})).toEqual([{ gates: ['prd_audit', 'architecture_review_as_built'] }]);
    } finally { await rm(subject.root, { recursive: true, force: true }); }
  });

  it('attributes a joined round\'s single growth charge to prd_audit whatever the receipt key order', async () => {
    const subject = await fixture({ laps: { architecture_review_as_built: 1, prd_audit: 1 } });
    try {
      await expect(settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: host, budgets: budgets(['prd_audit', 'architecture_review_as_built']), routing, git: subject.git })).resolves.toMatchObject({ kind: 'settled' });
      const ledger = await readKickbackLedger(subject.root);
      expect(ledger.growth?.byGate).toEqual({ prd_audit: 2 });
    } finally { await rm(subject.root, { recursive: true, force: true }); }
  });

  it('persists the receipt CAS before the flat-ledger write that makes provider dispatch eligible', async () => {
    const subject = await fixture();
    try {
      const log: string[] = [];
      const git: GitRunner = async (args, options) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes('refs/conductor/demo/routes/r1')) log.push('receipt-cas');
        return subject.git(args, options);
      };
      receiptTestSpies.order = log;
      await settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: host, budgets: budgets(), routing, git });
      log.push('provider-dispatch');
      expect(log).toEqual(['receipt-cas', 'flat-ledger-write', 'provider-dispatch']);
    } finally {
      receiptTestSpies.order = undefined;
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('settles host and leaf-only routed rounds through receipts without a legacy pending repair', async () => {
    const hostRound = await fixture();
    const leafRound = await fixture({ leafOnly: true });
    try {
      await expect(settleRoundAtDispatch({ projectRoot: hostRound.root, slug: 'demo', roundId, dispatchingChild: host, budgets: budgets(), routing, git: hostRound.git })).resolves.toMatchObject({ kind: 'settled' });
      await expect(settleRoundAtDispatch({ projectRoot: leafRound.root, slug: 'demo', roundId, dispatchingChild: leaf, budgets: budgets(), routing, git: leafRound.git })).resolves.toMatchObject({ kind: 'settled' });
      for (const root of [hostRound.root, leafRound.root]) {
        const ledger = await readKickbackLedger(root);
        expect(ledger).not.toHaveProperty('pendingRepair');
        expect(ledger.gates.prd_audit?.laps).toBe(1);
        expect(Object.keys(ledger.settlementReceipts ?? {})).toHaveLength(1);
      }
    } finally { await Promise.all([hostRound.root, leafRound.root].map((root) => rm(root, { recursive: true, force: true }))); }
  });
});
