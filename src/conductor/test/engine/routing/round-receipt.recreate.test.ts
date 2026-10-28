// Covers: tasks:62,63,67
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { rebuildLedgerFromReceipts } from '../../../src/engine/routing/round-receipt.js';
import { routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId } from '../../../src/engine/routing/route-types.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const tasklessRoundId = parseRoundId('r2')!;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-recreate-'));
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
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: { [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
  });
  if (made.kind !== 'created') throw new Error(made.kind);
  return { root, git };
}

describe('round receipt ledger recreation', () => {
  it('rebuilds an admitted taskless record with its sealed denominator after worktree recreation', async () => {
    const subject = await fixture();
    try {
      const taskless = await createRouteRecord(subject.root, 'demo', {
        roundId: tasklessRoundId,
        sealedAuthored: 1,
        kind: 'audit',
        items: [{ findingId: 'manual-test-fail', kind: 'audit', owner: child, host: child, reason: 'manual-test', fallback: [] }],
        allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
        receipt: { ...emptyUnsettledReceipt(), taskless: { manual_test: 1 } },
      }, { git: subject.git });
      if (taskless.kind !== 'created') throw new Error(taskless.kind);
      const admitted = await admitRound(subject.root, 'demo', taskless.record, child, { git: subject.git, persist: async () => 'persisted' });
      if (admitted.kind !== 'admitted') throw new Error(admitted.detail);

      await expect(rebuildLedgerFromReceipts(subject.root, 'demo', {
        cursor: { kind: 'active' },
        config: { stacked_prs: { route_whole_feature_fixes: true } },
      }, subject.git)).resolves.toEqual({ kind: 'rebuilt' });
      await expect(readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).resolves.toMatchObject({ kind: 'record', record: { sealedAuthored: 1 } });
      await expect(readRouteRecord(subject.root, 'demo', tasklessRoundId, { git: subject.git })).resolves.toMatchObject({ kind: 'record', record: { sealedAuthored: 1 } });
      await expect(readFile(join(subject.root, '.pipeline', 'kickback-ledger.json'), 'utf8')).resolves.toContain('"manual_test"');
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });

  it('reports unreadable instead of writing an empty ledger when a route record cannot be read', async () => {
    const subject = await fixture();
    try {
      const malformed = await subject.git(['hash-object', '-w', '--stdin'], { input: '{not-json' });
      await subject.git(['update-ref', routeRecordRefFor('demo', roundId), malformed.stdout.trim()]);

      await expect(rebuildLedgerFromReceipts(subject.root, 'demo', {
        cursor: { kind: 'active' },
        config: { stacked_prs: { route_whole_feature_fixes: true } },
      }, subject.git)).resolves.toMatchObject({ kind: 'unreadable' });
      await expect(access(join(subject.root, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(subject.root, { recursive: true, force: true });
    }
  });
});
