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

async function seedClosedRound(repo: string, git: ReturnType<typeof makeGitRunner>) {
  const created = await createRouteRecord(repo, 'demo', {
    roundId: r1, sealedAuthored: 1, kind: 'audit',
    items: [{ findingId: 'old', kind: 'audit', owner: c1, host: c1, reason: 'task-slice', fallback: [] }],
    allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
  });
  if (created.kind !== 'created') throw new Error(created.kind);
  const closed = { ...created.record, phase: 'closed' as const, hosts: { [c1]: 'done' as const } };
  await git(['update-ref', 'refs/conductor/demo/routes/r1', (await git(['hash-object', '-w', '--stdin'], {
    input: JSON.stringify(closed),
  })).stdout.trim()]);
}

async function runRoutedAudit(
  repo: string,
  ownerTaskId: 'T1' | 'T2',
  criterionId: 'S1.1' | 'S2.1',
  citedPath: string,
) {
  await createProtectedArtifactSeal({
    projectRoot: repo, baselineCommit: (await makeGitRunner(repo)(['rev-parse', 'HEAD'])).stdout.trim(),
  });
  const statePath = join(repo, '.pipeline', 'conduct-state.json');
  const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'skipped']));
  for (const step of ALL_STEPS) {
    if (step.name === 'prd_audit') break;
    state[step.name] = 'done';
  }
  await writeState(statePath, { ...state, feature_desc: 'demo', complexity_tier: 'M', prd_audit: 'pending' });
  await writeFile(join(repo, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
    { id: 'T1', status: 'completed' }, { id: 'T2', status: 'completed' },
  ] }));
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(repo, '.pipeline', 'events.jsonl'), events);
  persister.start();
  try {
    const conductor = new Conductor({
      projectRoot: repo, stateFilePath: statePath, featureSlug: 'demo', fromStep: 'prd_audit',
      mode: 'auto', daemon: true, verifyArtifacts: true, events,
      config: {
        stacked_prs: { enabled: true, max_slices: 3, route_whole_feature_fixes: true },
        prd_audit: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 },
        gate_code_validity: { enabled: false },
      } as never,
      stepRunner: {
        run: async (step, _state, options) => {
          if (step === 'prd_audit') {
            await persistPrdAuditVerdict(repo, {
              complete: true,
              judgment: {
                version: 'v1',
                criterionJudgments: [{
                  criterion: { storyId: ownerTaskId === 'T1' ? '1' : '2', ordinal: 1 }, criterionId, grade: 'FIXABLE',
                  evidence: `The ${citedPath} implementation is absent.`,
                  rationale: `Repair ${citedPath} through the routed host.`,
                  requirementAssociations: [], evidenceTaskIds: [ownerTaskId], ownerTaskId,
                }],
                noOwnerObservations: [],
              }, diagnostics: [], recordedDispositions: [],
            }, { attemptId: options?.runId!, codeStamp: null });
          }
          if (step === 'remediate') {
            await persistFixtureProjectedRemediationPlan(repo, options, [{
              id: criterionId, disposition: 'existing-task', category: null,
              rationale: `Repair ${citedPath} through the routed host.`,
              tasks: [], boundTaskIds: [ownerTaskId],
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
  } finally {
    persister.stop();
  }
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
      await expect(admitRound(repo, 'demo', open.record, c1, { git })).resolves.toMatchObject({ kind: 'admitted' });
      await runRoutedAudit(repo, 'T2', 'S2.1', 'src/engine/register-artifact-cli.ts');

      await expect(readFile(join(repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('mechanical');
      const firstHaltLine = (await readFile(join(repo, '.pipeline', 'HALT'), 'utf8')).split('\n', 1)[0]!;
      expect(firstHaltLine).toContain('r1');
      expect(firstHaltLine).not.toContain('needs-human');
      await expect(readRouteRecord(repo, 'demo', r2, { git })).resolves.toEqual({ kind: 'absent' });
      expect(await git(['show-ref', '--verify', '--quiet', 'refs/conductor/demo/routes/r2'])).toMatchObject({ exitCode: 1 });
      expect(await readFile(join(repo, '.pipeline', 'events.jsonl'), 'utf8')).not.toContain('remediation_routed');
    } finally { await rm(repo, { recursive: true, force: true }); }
  });

  it('creates and admits the resolved leaf host after the old round is closed', async () => {
    const { repo, git } = await fixture();
    try {
      await seedClosedRound(repo, git);
      await runRoutedAudit(repo, 'T2', 'S2.1', 'src/engine/register-artifact-cli.ts');
      await expect(readRouteRecord(repo, 'demo', r2, { git })).resolves.toMatchObject({
        kind: 'record', record: { items: expect.arrayContaining([
          expect.objectContaining({ host: c3, prerequisitePaths: expect.arrayContaining(['src/engine/register-artifact-cli.ts']) }),
        ]) },
      });
      await expect(readRepairMarker(repo, 'demo', { git })).resolves.toMatchObject({ kind: 'marker', marker: { roundId: r2, host: c3 } });
    } finally { await rm(repo, { recursive: true, force: true }); }
  });

  // Covers: task:6
  it('creates and admits child 1 when its closed tree already contains every cited file', async () => {
    const { repo, git } = await fixture();
    try {
      await seedClosedRound(repo, git);
      await runRoutedAudit(repo, 'T1', 'S1.1', 'src/engine/a.ts');
      await expect(readRepairMarker(repo, 'demo', { git })).resolves.toMatchObject({
        kind: 'marker', marker: { roundId: r2, host: c1 },
      });
      await expect(readRouteRecord(repo, 'demo', r2, { git })).resolves.toMatchObject({
        kind: 'record', record: {
          items: [expect.objectContaining({ owner: c1, host: c1 })], hosts: { [c1]: 'admitted' },
        },
      });
    } finally { await rm(repo, { recursive: true, force: true }); }
  });
});
