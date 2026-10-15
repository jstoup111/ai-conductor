// Covers: S5.10
// Covers: tasks:40,41,42,101,102
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { admitRound, reconcileRounds } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRepairMarker, readRouteRecord, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';

const c1 = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

const input = {
  roundId,
  kind: 'audit' as const,
  items: [{ findingId: 'finding', kind: 'audit' as const, owner: c1, host: c1, reason: 'task-slice', fallback: [] }],
  allocation: { [c1]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
};

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'round-admission-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  return { repo, git };
}

describe('routed-round admission (real local Git)', () => {
  it('writes a prepared record then atomically opens its first marker and phase events', async () => {
    const subject = await fixture();
    try {
      const calls: { args: readonly string[]; input?: string }[] = [];
      const git: GitRunner = async (args, options) => {
        calls.push({ args, input: options?.input });
        return subject.git(args, options);
      };
      const created = await createRouteRecord(subject.repo, 'demo', input, { git });
      if (created.kind !== 'created') throw new Error(created.kind);
      expect(created.record).toMatchObject({ phase: 'prepared', hosts: { 1: 'pending' }, outbox: [] });
      const admitted = await admitRound(subject.repo, 'demo', created.record, c1, { git });
      expect(admitted).toMatchObject({ kind: 'admitted', record: { phase: 'open', hosts: { 1: 'admitted' } } });
      expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'marker', marker: { roundId, host: c1 } });
      const writes = calls.filter((call) => call.args[0] === 'update-ref');
      expect(writes).toHaveLength(2);
      expect(writes[1]?.input).toContain(`update ${repairMarkerRefFor('demo')}`);
      expect(writes[1]?.input).toContain('verify refs/conductor/demo/restack/journal ');
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('refuses a concurrent marker without mutating the prepared record', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      const markerBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ host: 1, roundId: 'r9' }) })).stdout.trim();
      await subject.git(['update-ref', repairMarkerRefFor('demo'), markerBlob]);
      expect(await admitRound(subject.repo, 'demo', created.record, c1)).toEqual({
        kind: 'refused',
        detail: 'routing round r9 is already open; cannot admit r1',
      });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({ kind: 'record', record: { phase: 'prepared', hosts: { 1: 'pending' } } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('aborts an orphaned prepared round and sends an admitted one back to build', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      expect(await reconcileRounds(subject.repo, 'demo')).toEqual({ kind: 'aborted', roundId: 'r1' });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toEqual({ kind: 'absent' });

      const opened = await createRouteRecord(subject.repo, 'demo', input);
      if (opened.kind !== 'created') throw new Error(opened.kind);
      await admitRound(subject.repo, 'demo', opened.record, c1);
      expect(await reconcileRounds(subject.repo, 'demo')).toEqual({ kind: 'navigate-leaf-to-build', roundId: 'r1', host: c1 });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('refuses a fenced transaction when a restack journal appears before commit', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('record unavailable');
      const raced: GitRunner = async (args, options) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin') {
          const journal = parseCommitSha((await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({}) })).stdout.trim())!;
          await subject.git(['update-ref', 'refs/conductor/demo/restack/journal', journal]);
        }
        return subject.git(args, options);
      };
      const next: RouteRecord = { ...stored.record, phase: 'closed' };
      expect(await writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: next }], { git: raced }))
        .toEqual({ kind: 'cas-failed' });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toEqual(stored);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });
});
