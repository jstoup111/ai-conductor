// Covers: task:61
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { journalRefFor, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { createRouteRecord, readRouteRecord, transitionHost, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { settleRoundAtDispatch } from '../../../src/engine/routing/round-receipt.js';
import { emptyUnsettledReceipt, parseRoundId } from '../../../src/engine/routing/route-types.js';
import type { RestackOpId } from '../../../src/engine/restack/restack-types.js';

const host = parseChildId(1)!;
const otherChild = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const routing = { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } } as const;
const settlementBudgets = [{
  gate: 'prd_audit' as const,
  lapCap: 2,
  growthCap: 4,
  growth: { authored: 4, added: 0, byGate: {}, remaining: 4 },
  authoredSource: 'plan' as const,
}];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-race-'));
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'receipt@example.test']);
  await git(['config', 'user.name', 'Receipt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const made = await createRouteRecord(root, 'demo', {
    roundId,
    sealedAuthored: 1,
    kind: 'audit',
    items: [{ findingId: 'prd-fixable', kind: 'audit', owner: host, host, reason: 'task-slice', fallback: [] }],
    allocation: { [host]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
    receipt: { ...emptyUnsettledReceipt(), laps: { prd_audit: 1 }, growth: 1 },
  });
  if (made.kind !== 'created') throw new Error(`route record setup failed: ${made.kind}`);
  return { root, git };
}

function settle(subject: Awaited<ReturnType<typeof fixture>>, dispatchingChild = host, git: GitRunner = subject.git) {
  return settleRoundAtDispatch({
    projectRoot: subject.root,
    slug: 'demo',
    roundId,
    dispatchingChild,
    budgets: settlementBudgets,
    routing,
    git,
  });
}

async function addOutboxEntries(subject: Awaited<ReturnType<typeof fixture>>, count: number) {
  const states = ['admitted', 'repairing', 'built'] as const;
  let stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
  if (stored.kind !== 'record') throw new Error('missing route record');
  // Admission opens the round and admits its host in one write.
  const admitted = transitionHost(stored, host, 'admitted', { credit: false });
  if (admitted.kind !== 'updated') throw new Error('could not admit host');
  const opened = await writeRouteRecord(subject.root, stored, { ...admitted.record, phase: 'open' }, { git: subject.git });
  if (opened.kind !== 'updated') throw new Error(`could not open route: ${opened.kind}`);
  stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
  if (stored.kind !== 'record') throw new Error('route record missing after open');
  for (const state of states.slice(1, count)) {
    const moved = transitionHost(stored, host, state, { credit: false });
    if (moved.kind !== 'updated') throw new Error(`could not move host to ${state}`);
    if ((await writeRouteRecord(subject.root, stored, moved.record, { git: subject.git })).kind !== 'updated') throw new Error(`could not write ${state}`);
    stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
    if (stored.kind !== 'record') throw new Error(`route record missing after ${state}`);
  }
}

/** Model one concurrent outbox worker persisting and removing its next event. */
async function drainOneOutboxEntry(subject: Awaited<ReturnType<typeof fixture>>) {
  const current = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
  if (current.kind !== 'record' || current.record.outbox.length === 0) throw new Error('missing outbox entry to drain');
  const wrote = await writeRouteRecord(subject.root, current, {
    ...current.record,
    outbox: current.record.outbox.slice(1),
  }, { git: subject.git });
  if (wrote.kind !== 'updated') throw new Error(`outbox drain write failed: ${wrote.kind}`);
}

function isSettlementCas(args: string[], options: { readonly input?: string } | undefined): boolean {
  return args[0] === 'update-ref' && args[1] === '--stdin' && options?.input?.includes('refs/conductor/demo/routes/r1') === true;
}

describe('round receipt settlement races', () => {
  it('refuses an off-host settlement without changing the receipt blob or writing the ledger', async () => {
    const subject = await fixture();
    try {
      const before = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
      if (before.kind !== 'record') throw new Error('missing route record');

      await expect(settle(subject, otherChild)).resolves.toEqual({ kind: 'refused', reason: 'not-current-host' });

      await expect(readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({ kind: 'record', blob: before.blob });
      await expect(access(join(subject.root, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('settles one of two racing attempts once and leaves the other acknowledged', async () => {
    const subject = await fixture();
    try {
      const results = await Promise.all([settle(subject), settle(subject)]);

      expect(results.filter((result) => result.kind === 'settled')).toHaveLength(1);
      expect(results.filter((result) => result.kind === 'acknowledged')).toHaveLength(1);
      const ledger = await readKickbackLedger(subject.root);
      expect(ledger.gates.prd_audit?.laps).toBe(1);
      expect(Object.keys(ledger.settlementReceipts ?? {})).toHaveLength(1);
      await expect(readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({
        kind: 'record', record: { receipt: { settlementId: expect.any(String), acks: { 1: true } } },
      });
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('retries a settlement CAS lost to an outbox drain instead of treating an unsettled receipt as acknowledged', async () => {
    const subject = await fixture();
    try {
      await addOutboxEntries(subject, 1);
      let injected = false;
      let settlementWrites = 0;
      const git: GitRunner = async (args, options) => {
        if (isSettlementCas(args, options)) {
          settlementWrites += 1;
          if (!injected) {
            injected = true;
            await drainOneOutboxEntry(subject);
          }
        }
        return subject.git(args, options);
      };

      await expect(settle(subject, host, git)).resolves.toMatchObject({ kind: 'settled' });
      expect(settlementWrites).toBe(2);
      expect((await readKickbackLedger(subject.root)).gates.prd_audit?.laps).toBe(1);
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('halts naming r1 after three CAS losses caused by outbox drains, without charging the unsettled receipt', async () => {
    const subject = await fixture();
    try {
      await addOutboxEntries(subject, 3);
      let drains = 0;
      const git: GitRunner = async (args, options) => {
        if (isSettlementCas(args, options)) {
          await drainOneOutboxEntry(subject);
          drains += 1;
        }
        return subject.git(args, options);
      };

      await expect(settle(subject, host, git)).resolves.toMatchObject({ kind: 'halted', reason: expect.stringContaining('r1') });
      expect(drains).toBe(3);
      const after = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
      if (after.kind !== 'record') throw new Error(`route record became ${after.kind}`);
      expect(after.record.receipt).not.toHaveProperty('settlementId');
      await expect(access(join(subject.root, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('halts without changing the receipt or ledger when a restack journal opens between the read and CAS', async () => {
    const subject = await fixture();
    try {
      const before = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
      if (before.kind !== 'record') throw new Error('missing route record');
      let opened = false;
      const git: GitRunner = async (args, options) => {
        if (!opened && isSettlementCas(args, options)) {
          opened = true;
          const journal: RestackJournal = {
            opId: 'receipt-race-journal' as RestackOpId,
            cause: 'feature-repair',
            committer: { name: 'Receipt', email: 'receipt@example.test', date: '2030-01-01T00:00:00Z' },
            dirtyPaths: [], refs: [], ranges: [], children: [], state: 'moved',
            owner: { host: 'test-host', pid: 1, processStartTime: '1' },
          };
          const blob = await writeRestackJournalBlob(subject.root, journal, { git: subject.git });
          await subject.git(['update-ref', journalRefFor('demo'), blob]);
        }
        return subject.git(args, options);
      };

      await expect(settle(subject, host, git)).resolves.toMatchObject({ kind: 'halted', reason: expect.stringContaining('open restack journal') });
      await expect(readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({ kind: 'record', blob: before.blob });
      await expect(access(join(subject.root, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });
});
