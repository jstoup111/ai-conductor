// Covers: tasks:57,58,59,206
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { completeRerouteSync, rerouteRound, verifyPrerequisiteClaim } from '../../../src/engine/routing/prerequisite-claim.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRepairMarker, readRouteRecord, transitionHost, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor, rejectedPinRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';

const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const roundId = parseRoundId('r1')!;

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'prerequisite-reroute-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(repo, 'src-a.ts'), 'export const parseA = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);

  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed1 = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', c1), closed1]);
  await writeFile(join(repo, 'source.ts'), 'export const source = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'builder work\n\nRound: r1']);
  const rejected = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  await git(['checkout', '-qb', 'feat/c2/demo', closed1]);
  await writeFile(join(repo, 'parse-b.ts'), 'export const parseB = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'child 2 prerequisite']);
  const closed2 = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', c2), closed2]);
  await git(['checkout', '-q', 'feat/c1/demo']);

  const created = await createRouteRecord(repo, 'demo', {
    roundId,
    kind: 'audit',
    items: [{ findingId: 'f1', kind: 'audit', owner: c1, host: c1, reason: 'task-slice', fallback: [], taskIds: ['rem-prd-audit-T1'] }],
    allocation: {
      [c1]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n**Child:** 1\n'] },
      [c2]: { remTaskIds: [], blockBodies: [] },
    },
  });
  if (created.kind !== 'created') throw new Error(created.kind);
  await admitRound(repo, 'demo', created.record, c1);
  const stored = await readRouteRecord(repo, 'demo', roundId);
  if (stored.kind !== 'record') throw new Error('missing admitted record');
  const repairing = transitionHost(stored, c1, 'repairing', { credit: false });
  if (repairing.kind !== 'updated') throw new Error('cannot enter repair');
  await writeRoutingTransaction(repo, 'demo', [{ kind: 'update-record', previous: stored, record: repairing.record }]);
  return { repo, git, closed1, closed2, rejected };
}

describe('verified prerequisite reroute (real local Git)', () => {
  it('verifies only an upward immutable destination before any ref move', async () => {
    const subject = await fixture();
    try {
      expect(await verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['parseB'] }, host: c1, slug: 'demo', git: subject.git,
      })).toEqual({ kind: 'verified', destination: c2, ref: closureRefFor('demo', c2) });
      expect(await verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c1, symbols: ['parseB'] }, host: c2, slug: 'demo', git: subject.git,
      })).toMatchObject({ kind: 'refused-not-above' });
      expect(await verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['missing'] }, host: c1, slug: 'demo', git: subject.git,
      })).toMatchObject({ kind: 'unverified' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('pins, resets and moves the marker atomically, then recovers the tree before destination admission', async () => {
    const subject = await fixture();
    try {
      const result = await rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: subject.git });
      expect(result.kind).toBe('rerouted');
      expect((await subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(subject.closed1);
      expect((await subject.git(['rev-parse', rejectedPinRefFor('demo', roundId, 1)])).stdout.trim()).toBe(subject.rejected);
      expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'marker', marker: { roundId, host: c2 } });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({
        kind: 'record', record: {
          hosts: { 1: 'reroute-moved', 2: 'pending' },
          allocation: { 2: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n**Child:** 2'] } },
        },
      });
      const afterReroute = await readRouteRecord(subject.repo, 'demo', roundId);
      if (afterReroute.kind !== 'record') throw new Error('missing rerouted record');
      expect(afterReroute.record.outbox).toContainEqual(expect.objectContaining({
        event: expect.objectContaining({ type: 'remediation_rerouted', from: c1, to: c2 }),
      }));

      const completed = await completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git });
      expect(completed).toMatchObject({ kind: 'completed', record: { hosts: { 1: 'rerouted', 2: 'admitted' } } });
      expect((await readFile(join(subject.repo, 'src-a.ts'), 'utf8')).trim()).toBe('export const parseA = 1;');
      expect(await readFile(join(subject.repo, 'source.ts'), 'utf8').catch(() => undefined)).toBeUndefined();
      expect(await completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git })).toMatchObject({ kind: 'completed' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

});
