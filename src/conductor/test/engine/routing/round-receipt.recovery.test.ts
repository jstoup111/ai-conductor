// Covers: task:62, task:63, task:67
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const recoverySpies = vi.hoisted(() => ({ failNextLedgerWrite: false }));

vi.mock('../../../src/engine/kickback-ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/kickback-ledger.js')>();
  return {
    ...actual,
    writeKickbackLedgerUnlocked: async (...args: Parameters<typeof actual.writeKickbackLedgerUnlocked>) => {
      if (recoverySpies.failNextLedgerWrite) {
        recoverySpies.failNextLedgerWrite = false;
        throw new Error('injected crash after receipt CAS');
      }
      await actual.writeKickbackLedgerUnlocked(...args);
    },
  };
});

import { parseChildId } from '../../../src/engine/child-context.js';
import { readKickbackLedger, type PendingRepairSettlementBudget } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { createRouteRecord, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { reconcileReceiptLedger, settleRoundAtDispatch } from '../../../src/engine/routing/round-receipt.js';
import { routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId } from '../../../src/engine/routing/route-types.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const routing = { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } } as const;
const budgets: readonly PendingRepairSettlementBudget[] = [{
  gate: 'prd_audit', lapCap: 2, growthCap: 4,
  growth: { authored: 4, added: 0, byGate: {}, remaining: 4 },
  authoredSource: 'plan' as const,
}];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-recovery-'));
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'receipt@example.test']);
  await git(['config', 'user.name', 'Receipt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const made = await createRouteRecord(root, 'demo', {
    roundId,
    kind: 'audit',
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: { [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
    receipt: { ...emptyUnsettledReceipt(), laps: { prd_audit: 1 }, growth: 1 },
  });
  if (made.kind !== 'created') throw new Error(made.kind);
  return { root, git };
}

describe('round receipt recovery', () => {
  it('reconciles the settled receipt exactly once after a crash between its CAS and flat-ledger write', async () => {
    const subject = await fixture();
    try {
      recoverySpies.failNextLedgerWrite = true;
      await expect(settleRoundAtDispatch({
        projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: child, budgets, routing, git: subject.git,
      })).rejects.toThrow('injected crash after receipt CAS');

      const crashed = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
      if (crashed.kind !== 'record') throw new Error('missing route receipt after injected crash');
      expect(crashed.record.receipt).toMatchObject({ settlementId: expect.stringMatching(/^r1-/), acks: { 1: true } });
      expect((await readKickbackLedger(subject.root)).settlementReceipts).toBeUndefined();

      await expect(settleRoundAtDispatch({
        projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: child, budgets, routing, git: subject.git,
      })).resolves.toMatchObject({ kind: 'acknowledged', settlementId: crashed.record.receipt.settlementId });

      const recovered = await readKickbackLedger(subject.root);
      expect(recovered).toMatchObject({
        gates: { prd_audit: { laps: 1 } }, growth: { added: 1 },
        settlementReceipts: { [crashed.record.receipt.settlementId!]: { gates: ['prd_audit'] } },
      });
    } finally {
      recoverySpies.failNextLedgerWrite = false;
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('is byte-idempotent when reconciling the same settled receipt twice', async () => {
    const subject = await fixture();
    try {
      await expect(settleRoundAtDispatch({
        projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: child, budgets, routing, git: subject.git,
      })).resolves.toMatchObject({ kind: 'settled' });

      await reconcileReceiptLedger(subject.root, 'demo', routing, subject.git);
      const first = await readFile(join(subject.root, '.pipeline', 'kickback-ledger.json'), 'utf8');
      await reconcileReceiptLedger(subject.root, 'demo', routing, subject.git);
      await expect(readFile(join(subject.root, '.pipeline', 'kickback-ledger.json'), 'utf8')).resolves.toBe(first);
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('leaves a receipt unsettled when its CAS crashes, then charges its next host dispatch once', async () => {
    const subject = await fixture();
    try {
      let crashesBeforeCas = 3;
      const git = async (...args: Parameters<typeof subject.git>) => {
        const [argv, options] = args;
        if (crashesBeforeCas > 0 && argv[0] === 'update-ref' && argv[1] === '--stdin' && options?.input?.includes('refs/conductor/demo/routes/r1')) {
          crashesBeforeCas -= 1;
          throw new Error('injected crash before receipt CAS');
        }
        return subject.git(...args);
      };
      await expect(settleRoundAtDispatch({
        projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: child, budgets, routing, git,
      })).resolves.toMatchObject({ kind: 'halted' });

      const beforeRetry = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
      if (beforeRetry.kind !== 'record') throw new Error('missing route receipt after pre-CAS crash');
      expect(beforeRetry.record.receipt).not.toHaveProperty('settlementId');

      await expect(settleRoundAtDispatch({
        projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: child, budgets, routing, git: subject.git,
      })).resolves.toMatchObject({ kind: 'settled' });

      const stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
      expect(stored).toMatchObject({ kind: 'record', record: { receipt: { settlementId: expect.any(String) } } });
      const ledger = await readKickbackLedger(subject.root);
      expect(ledger).toMatchObject({ gates: { prd_audit: { laps: 1 } }, growth: { added: 1 } });
      expect(Object.keys(ledger.settlementReceipts ?? {})).toHaveLength(1);
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('returns exhausted when reconciliation encounters a malformed stored route record', async () => {
    const subject = await fixture();
    try {
      const malformed = await subject.git(['hash-object', '-w', '--stdin'], { input: '{not-json' });
      await subject.git(['update-ref', routeRecordRefFor('demo', parseRoundId('r2')!), malformed.stdout.trim()]);

      await expect(settleRoundAtDispatch({
        projectRoot: subject.root,
        slug: 'demo',
        roundId,
        dispatchingChild: child,
        budgets: [{ gate: 'prd_audit', lapCap: 2, growthCap: 4, growth: { authored: 4, added: 0, byGate: {}, remaining: 4 }, authoredSource: 'plan' }],
        routing: { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } },
        git: subject.git,
      })).resolves.toMatchObject({ kind: 'exhausted' });
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });
});
