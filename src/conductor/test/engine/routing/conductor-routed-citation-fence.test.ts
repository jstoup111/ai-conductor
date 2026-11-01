// Covers: task:6
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound, checkRoundAdmissionFence } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRepairMarker, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { routeAdmittedRound } from '../../../src/engine/routing/round-router.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';

const c1 = parseChildId(1)!;
const c3 = parseChildId(3)!;
const r1 = parseRoundId('r1')!;
const r2 = parseRoundId('r2')!;

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'conductor-routed-citation-fence-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await mkdir(join(repo, 'src', 'engine'), { recursive: true });
  await writeFile(join(repo, 'src', 'engine', 'a.ts'), 'export const a = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', c1), closed]);
  await git(['checkout', '-qb', leafBranchFor('demo'), closed]);
  await writeFile(join(repo, 'src', 'engine', 'register-artifact-cli.ts'), 'export const register = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'leaf prerequisite']);
  await git(['checkout', '-q', 'feat/c1/demo']);
  return { repo, git };
}

async function routedCandidate(git: ReturnType<typeof makeGitRunner>) {
  return routeAdmittedRound({
    admitted: [{
      id: 'S3.5', gateSource: 'prd_audit', provenance: { kind: 'task-bound' }, ownerTaskIds: ['T1'],
      citedPaths: ['src/engine/a.ts'],
      gap: {
        id: 'S3.5', rationale: 'Repair the missing route.', criterion: 'The repair block cites a leaf-only file.',
        governingClause: 'Update src/engine/register-artifact-cli.ts.', tasks: [{ id: 'repair', title: 'Repair the route.' }],
      } as never,
    }],
    sliceMembership: { taskSlices: { T1: 1 }, titles: ['owner'] }, planText: '### Task T1: owner\n',
    appendedChildren: {}, declaredPositions: [c1, c3], leafTip: leafBranchFor('demo'), roundId: r2, git,
  });
}

async function ownerCandidate(git: ReturnType<typeof makeGitRunner>) {
  return routeAdmittedRound({
    admitted: [{
      id: 'S3.6', gateSource: 'prd_audit', provenance: { kind: 'task-bound' }, ownerTaskIds: ['T1'],
      citedPaths: ['src/engine/a.ts'],
      gap: {
        id: 'S3.6', rationale: 'Repair the owner route.', criterion: 'The repair block cites the owner file.',
        governingClause: 'Update src/engine/a.ts.', tasks: [{ id: 'repair', title: 'Repair the owner route.' }],
      } as never,
    }],
    sliceMembership: { taskSlices: { T1: 1 }, titles: ['owner'] }, planText: '### Task T1: owner\n',
    appendedChildren: {}, declaredPositions: [c1, c3], leafTip: leafBranchFor('demo'), roundId: r2, git,
  });
}

describe('conductor routed citation admission fence', () => {
  // Covers: task:6
  it('keeps an open audit round ahead of a successfully routed leaf-only repair block', async () => {
    const { repo, git } = await fixture();
    try {
      const open = await createRouteRecord(repo, 'demo', {
        roundId: r1, sealedAuthored: 1, kind: 'audit',
        items: [{ findingId: 'old', kind: 'audit', owner: c1, host: c1, reason: 'task-slice', fallback: [] }],
        allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
      });
      if (open.kind !== 'created') throw new Error(open.kind);
      await git(['update-ref', 'refs/conductor/demo/routes/r1', (await git(['hash-object', '-w', '--stdin'], {
        input: JSON.stringify({ ...open.record, phase: 'open', hosts: { [c1]: 'pending' } }),
      })).stdout.trim()]);

      const routed = await routedCandidate(git);
      expect(routed).toMatchObject({ kind: 'routed', items: expect.arrayContaining([
        expect.objectContaining({ host: c3, prerequisitePaths: expect.arrayContaining(['src/engine/register-artifact-cli.ts']) }),
      ]) });
      // This is the ordering used by Conductor: route selection completes, then
      // the admission fence rejects before it can create r2 or emit its event.
      await expect(checkRoundAdmissionFence(repo, 'demo', { roundId: r2, kind: 'audit' }, { git }))
        .resolves.toMatchObject({ fence: true, detail: expect.stringContaining('r1') });
      await expect(readRouteRecord(repo, 'demo', r2, { git })).resolves.toEqual({ kind: 'absent' });
      await mkdir(join(repo, '.pipeline'), { recursive: true });
      await writeFile(join(repo, '.pipeline', 'events.jsonl'), '');
      expect(await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8')).not.toContain('remediation_routed');
    } finally { await rm(repo, { recursive: true, force: true }); }
  });

  it('admits the resolved leaf host after the old round is closed', async () => {
    const { repo, git } = await fixture();
    try {
      const routed = await routedCandidate(git);
      if (routed.kind !== 'routed') throw new Error(routed.detail);
      const created = await createRouteRecord(repo, 'demo', {
        roundId: r2, sealedAuthored: 1, kind: 'audit', items: routed.items, allocation: routed.allocation,
      }, { git });
      if (created.kind !== 'created') throw new Error(created.kind);
      await expect(admitRound(repo, 'demo', created.record, c3, { git })).resolves.toMatchObject({ kind: 'admitted' });
      await expect(readRouteRecord(repo, 'demo', r2, { git })).resolves.toMatchObject({
        kind: 'record', record: { items: expect.arrayContaining([
          expect.objectContaining({ host: c3, prerequisitePaths: expect.arrayContaining(['src/engine/register-artifact-cli.ts']) }),
        ]) },
      });
      await expect(readRepairMarker(repo, 'demo', { git })).resolves.toMatchObject({ kind: 'marker', marker: { roundId: r2, host: c3 } });
    } finally { await rm(repo, { recursive: true, force: true }); }
  });

  // Covers: task:6
  it('keeps a child-1-owned finding on child 1 when its closed tree already contains every cited file', async () => {
    const { repo, git } = await fixture();
    try {
      const routed = await ownerCandidate(git);
      if (routed.kind !== 'routed') throw new Error(routed.detail);
      expect(routed.items).toEqual([expect.objectContaining({ owner: c1, host: c1 })]);

      const created = await createRouteRecord(repo, 'demo', {
        roundId: r2, sealedAuthored: 1, kind: 'audit', items: routed.items, allocation: routed.allocation,
      }, { git });
      if (created.kind !== 'created') throw new Error(created.kind);
      await expect(admitRound(repo, 'demo', created.record, c1, { git })).resolves.toMatchObject({ kind: 'admitted' });
      await expect(readRepairMarker(repo, 'demo', { git })).resolves.toMatchObject({
        kind: 'marker', marker: { roundId: r2, host: c1 },
      });
      await expect(readRouteRecord(repo, 'demo', r2, { git })).resolves.toMatchObject({
        kind: 'record', record: { hosts: { [c1]: 'admitted' } },
      });
    } finally { await rm(repo, { recursive: true, force: true }); }
  });
});
