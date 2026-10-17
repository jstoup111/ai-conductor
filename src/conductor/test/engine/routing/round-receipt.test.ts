import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { createRouteRecord, readRouteRecord, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { settleRoundAtDispatch } from '../../../src/engine/routing/round-receipt.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-'));
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'receipt@example.test']);
  await git(['config', 'user.name', 'Receipt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const made = await createRouteRecord(root, 'demo', {
    roundId, kind: 'audit',
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: { [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
    receipt: { laps: { prd_audit: 1 }, growth: 1, taskless: {}, echo: {}, acks: {} },
  });
  if (made.kind !== 'created') throw new Error(made.kind);
  return { root, git };
}

describe('round receipt settlement', () => {
  it('CAS-settles once and later dispatches only acknowledge it', async () => {
    const subject = await fixture();
    try {
      const budgets = [{ gate: 'prd_audit' as const, lapCap: 2, growthCap: 4, growth: { authored: 4, added: 0, byGate: {}, remaining: 4 }, authoredSource: 'plan' as const }];
      const routing = { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } } as const;
      const first = await settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: child, budgets, routing, git: subject.git });
      expect(first.kind).toBe('settled');
      const ledger = await readKickbackLedger(subject.root);
      expect(ledger.gates.prd_audit?.laps).toBe(1);
      expect(ledger.growth?.added).toBe(1);
      expect(Object.keys(ledger.settlementReceipts ?? {})).toHaveLength(1);

      expect((await settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: child, budgets, routing, git: subject.git })).kind).toBe('acknowledged');
      expect((await readKickbackLedger(subject.root)).growth?.added).toBe(1);
      expect(await readRouteRecord(subject.root, 'demo', roundId)).toMatchObject({
        kind: 'record', record: { receipt: { acks: { 1: true } } },
      });
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('charges every originating validation gate from the admission receipt', async () => {
    const subject = await fixture();
    try {
      const stored = await readRouteRecord(subject.root, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('missing route record');
      const receipt = { ...stored.record.receipt, laps: { prd_audit: 1, architecture_review_as_built: 1 } };
      expect((await writeRouteRecord(subject.root, stored, { ...stored.record, receipt })).kind).toBe('updated');
      const budgets = [
        { gate: 'prd_audit' as const, lapCap: 2, growthCap: 4, growth: { authored: 4, added: 0, byGate: {}, remaining: 4 }, authoredSource: 'plan' as const },
        { gate: 'architecture_review_as_built' as const, lapCap: 2, growthCap: 4, growth: { authored: 4, added: 0, byGate: {}, remaining: 4 }, authoredSource: 'plan' as const },
      ];
      const routing = { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } } as const;
      expect((await settleRoundAtDispatch({ projectRoot: subject.root, slug: 'demo', roundId, dispatchingChild: child, budgets, routing, git: subject.git })).kind).toBe('settled');
      const ledger = await readKickbackLedger(subject.root);
      expect(ledger.gates.prd_audit?.laps).toBe(1);
      expect(ledger.gates.architecture_review_as_built?.laps).toBe(1);
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });
});
