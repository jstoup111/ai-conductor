// Covers: task:60
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { createRouteRecord, readRouteRecord, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { settleRoundAtDispatch } from '../../../src/engine/routing/round-receipt.js';
import { emptyUnsettledReceipt, parseRoundId, type ReceiptLapCharges } from '../../../src/engine/routing/route-types.js';

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

describe('round receipt settlement', () => {
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
      expect((await writeRouteRecord(subject.root, stored, { ...stored.record, currentHostIndex: 1 }, { git: subject.git })).kind).toBe('updated');

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
