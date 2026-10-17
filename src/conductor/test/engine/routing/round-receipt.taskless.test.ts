// Covers: tasks:33,65,200
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { chargeTasklessAtAdmission } from '../../../src/engine/routing/round-receipt.js';
import { createRouteRecord, readRouteRecord, writeRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { emptyUnsettledReceipt, parseRoundId } from '../../../src/engine/routing/route-types.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const routing = { cursor: { kind: 'active' }, config: { stacked_prs: { route_whole_feature_fixes: true } } } as const;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'round-receipt-taskless-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'receipt@example.test']);
  await git(['config', 'user.name', 'Receipt']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  const made = await createRouteRecord(root, 'demo', {
    roundId, kind: 'audit',
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'taskless', fallback: [] }],
    allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
  }, { git });
  if (made.kind !== 'created') throw new Error(`record creation failed: ${made.kind}`);
  return { root, git };
}

async function admit(root: string, git: ReturnType<typeof makeGitRunner>) {
  const stored = await readRouteRecord(root, 'demo', roundId, { git });
  if (stored.kind !== 'record') throw new Error(`record reread failed: ${stored.kind}`);
  expect((await admitRound(root, 'demo', stored.record, child, { git, persist: async () => 'persisted' })).kind).toBe('admitted');
}

describe('taskless routed admission receipts', () => {
  it('persists a complete unsettled manual_test charge before admitting the routed FAIL', async () => {
    const subject = await fixture();
    expect(await chargeTasklessAtAdmission({ projectRoot: subject.root, slug: 'demo', roundId, gate: 'manual_test', routing, git: subject.git })).toEqual({ kind: 'charged', count: 1 });
    expect(await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).toMatchObject({
      kind: 'record', record: { receipt: { ...emptyUnsettledReceipt(), taskless: { manual_test: 1 } } },
    });
    await admit(subject.root, subject.git);
  });

  it('persists a complete unsettled lint-docs echo before admitting the routed custom-step FAIL', async () => {
    const subject = await fixture();
    const stored = await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git });
    if (stored.kind !== 'record') throw new Error(`record reread failed: ${stored.kind}`);
    const receipt = { ...emptyUnsettledReceipt(), ...stored.record.receipt, echo: { ...stored.record.receipt.echo, 'lint-docs': 2 } };
    expect((await writeRouteRecord(subject.root, stored, { ...stored.record, receipt }, { git: subject.git })).kind).toBe('updated');
    expect(await readRouteRecord(subject.root, 'demo', roundId, { git: subject.git })).toMatchObject({
      kind: 'record', record: { receipt: { ...emptyUnsettledReceipt(), echo: { 'lint-docs': 2 } } },
    });
    await admit(subject.root, subject.git);
  });
});
