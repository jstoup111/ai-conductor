// Covers: task:6
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRepairMarker, readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { routeAdmittedRound } from '../../../src/engine/routing/round-router.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { persistPrdAuditVerdict } from '../../../src/engine/prd-audit-verdict-store.js';
import { createProtectedArtifactSeal } from '../../../src/engine/protected-artifact-seal.js';
import { persistFixtureProjectedRemediationPlan } from '../remediation-plan-fixtures.js';
import { sealSliceTopologyPositions, writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

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
  await writeSliceTopologyFixture(repo, {
    slug: 'demo', materializeTopologyCommit: true,
    sliceMembership: { taskSlices: { T1: 1, T2: 3 }, titles: ['owner', 'leaf'] },
    storyOwnership: { S1: 1, S2: 3 },
  });
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);
  await sealSliceTopologyPositions(repo, {
    slug: 'demo', sliceMembership: { taskSlices: { T1: 1, T2: 3 }, titles: ['owner', 'leaf'] },
  });
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
  it('halts the routed audit before opening a second round while a prior round remains open', async () => {
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
      await createProtectedArtifactSeal({
        projectRoot: repo, baselineCommit: (await git(['rev-parse', 'HEAD'])).stdout.trim(),
      });

      const statePath = join(repo, '.pipeline', 'conduct-state.json');
      await writeState(statePath, {
        ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
        feature_desc: 'demo', complexity_tier: 'M', prd_audit: 'pending',
      });
      const events = new ConductorEventEmitter();
      const persister = new EventPersister(join(repo, '.pipeline', 'events.jsonl'), events);
      persister.start();
      const conductor = new Conductor({
        projectRoot: repo, stateFilePath: statePath, featureSlug: 'demo', fromStep: 'prd_audit',
        mode: 'auto', daemon: true, verifyArtifacts: false, events,
        config: {
          stacked_prs: { enabled: true, max_slices: 3, route_whole_feature_fixes: true },
          prd_audit: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 },
        } as never,
        stepRunner: {
          run: async (step, _state, options) => {
            if (step === 'prd_audit') {
              await persistPrdAuditVerdict(repo, {
                complete: true,
                judgment: {
                  version: 'v1',
                  criterionJudgments: [{
                    criterion: { storyId: '2', ordinal: 1 }, criterionId: 'S2.1', grade: 'FIXABLE',
                    evidence: 'The leaf-only implementation is absent.', rationale: 'Repair the routed leaf.',
                    requirementAssociations: [], evidenceTaskIds: ['T2'], ownerTaskId: 'T2',
                  }],
                  noOwnerObservations: [],
                }, diagnostics: [], recordedDispositions: [],
              }, { attemptId: options?.runId!, codeStamp: null });
            }
            if (step === 'remediate') {
              await persistFixtureProjectedRemediationPlan(repo, options, [{
                id: 'S2.1', disposition: 'existing-task', category: null,
                rationale: 'Task T2 already owns the leaf-only implementation.',
                tasks: [], boundTaskIds: ['T2'],
              }]);
            }
            return { success: true };
          },
        },
        childRegionLifecycle: {
          resolveActiveChild: async () => ({
            kind: 'active', child: c3, position: c3, isLeaf: true, branch: leafBranchFor('demo'),
          }) as never,
        },
      });

      await conductor.run();
      persister.stop();

      await expect(readFile(join(repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
      const firstHaltLine = (await readFile(join(repo, '.pipeline', 'HALT'), 'utf8')).split('\n', 1)[0]!;
      expect(firstHaltLine).toContain('r1');
      expect(firstHaltLine).not.toContain('needs-human');
      await expect(readRouteRecord(repo, 'demo', r2, { git })).resolves.toEqual({ kind: 'absent' });
      expect(await git(['show-ref', '--verify', '--quiet', 'refs/conductor/demo/routes/r2'])).toMatchObject({ exitCode: 1 });
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
