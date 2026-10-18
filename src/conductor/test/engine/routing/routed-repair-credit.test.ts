// Covers: task:74
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { createFilesystemConductStateStore } from '../../../src/engine/filesystem-conduct-state-store.js';
import { writeVerdict } from '../../../src/engine/gate-verdicts.js';
import { kickbackLedgerPathFor, readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { applyRebaseTransition } from '../../../src/engine/rebase-transition.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { enterHostRegion } from '../../../src/engine/routing/host-region-entry.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { consumeRoutedRepairCredit, grantRoutedRepairCredit } from '../../../src/engine/routing/round-receipt.js';
import { createRouteRecord, readRouteRecord, transitionHost, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { writeState } from '../../../src/engine/state.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import type { StepRunner } from '../../../src/engine/conductor.js';
import { joinBuildReviewRubricOutcomes } from '../../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../../src/engine/build-review-domain.js';
import { Conductor } from '../../test-conductor.js';

const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'routed-repair-credit-'));
  roots.push(root);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  return root;
}

function failingBuildReviewAggregate() {
  const lapId = parseBuildReviewLapId('routed-credit-lap')!;
  return joinBuildReviewRubricOutcomes({
    lapId,
    snapshotDigest: 'sha256:routed-credit',
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest: 'sha256:routed-credit',
        contractVersion: 'v3', verdict: 'FAIL',
        findings: [{
          concernKind: 'test-insensitive', summary: 'routed review failure', evidenceLocations: ['test/fixture.test.ts:1'],
          anchor: {
            rubric: 'testQuality',
            locus: {
              path: 'test/fixture.test.ts',
              contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              display: 'fixture test',
            },
          },
        }],
      },
    },
  });
}

async function cumulativeCapFixture(credit: 'available' | 'consumed') {
  const root = await fixture();
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  const route = await createRouteRecord(root, 'demo', {
    roundId,
    kind: 'audit',
    items: [],
    allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
  }, { git });
  if (route.kind !== 'created') throw new Error(`failed to create routed credit fixture: ${route.kind}`);
  const statePath = join(root, '.pipeline', 'conduct-state.json');
  const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
  Object.assign(state, { feature_desc: 'demo', complexity_tier: 'M', run_started_at: 1 });
  await writeState(statePath, state);
  await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'pending',
  }));
  await writeFile(kickbackLedgerPathFor(root, child), JSON.stringify({
    version: 1,
    gates: {
      build_review: {
        count: 1, cumulative: 5, treeHash: null, lastReason: 'prior failure', priorVerdict: true, resolvedBefore: 0,
      },
    },
    routedRepairCredit: credit === 'available' ? { roundId: 'r1' } : { roundId: 'r1', consumed: true },
  }));
  const dispatched: StepName[] = [];
  const runner: StepRunner = {
    run: vi.fn(async (step: StepName) => {
      dispatched.push(step);
      if (step === 'build_review') {
        await writeFile(
          join(root, '.pipeline', 'children', '1', 'build-review.json'),
          JSON.stringify(failingBuildReviewAggregate()),
        );
        return { success: true };
      }
      if (step === 'build') throw new Error('stop after routed credit consumption');
      return { success: true };
    }),
  };
  const cursor = {
    kind: 'active' as const,
    child,
    position: child,
    isLeaf: false,
    branch: 'feat/c1/demo',
    routedRepair: { child, roundId },
  };
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: statePath,
    featureSlug: 'demo',
    fromStep: 'build_review',
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    mode: 'auto',
    daemon: true,
    verifyArtifacts: true,
    maxRetries: 1,
    config: { stacked_prs: { enabled: true }, kickback_escalation: { enabled: false } },
    childRegionLifecycle: {
      resolveActiveChild: async () => cursor,
      enterHostRegion: async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never,
      enterChildRegion: async () => ({ kind: 'completed' }),
    },
  } as never);
  return { root, conductor, dispatched };
}

async function enteredHostFixture() {
  const root = await fixture();
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routed-credit@example.invalid']);
  await git(['config', 'user.name', 'Routed credit']);
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await writeFile(join(root, '.docs', 'plans', 'demo.md'), '### Task T1: Existing work\n');
  await git(['add', '.gitignore', '.docs/plans/demo.md']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'child.txt'), 'closed child\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'closed child']);
  const closure = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', child), closure]);
  await git(['checkout', '-qb', leafBranchFor('demo')]);
  await writeFile(join(root, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: 'demo' }));
  await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  const created = await createRouteRecord(root, 'demo', {
    roundId,
    kind: 'audit',
    items: [],
    allocation: { [child]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1: Routed repair\n'] } },
  }, { git });
  if (created.kind !== 'created') throw new Error(`failed to create entered-host fixture: ${created.kind}`);
  const admitted = await admitRound(root, 'demo', created.record, child, { git });
  if (admitted.kind !== 'admitted') throw new Error(`failed to admit entered-host fixture: ${admitted.detail}`);
  const enter = () => enterHostRegion({
    worktree: root, slug: 'demo', roundId, host: child,
    emitter: new ConductorEventEmitter(), git, planPath: '.docs/plans/demo.md',
  });
  return { root, enter };
}

describe('routed repair credit', () => {
  it('grants and consumes exactly one per-child credit for its routing round', async () => {
    const root = await fixture();
    await writeFile(kickbackLedgerPathFor(root, child), JSON.stringify({
      version: 1,
      gates: {
        build_review: {
          count: 1, cumulative: 5, laps: 3, treeHash: null, lastReason: 'prior failure', priorVerdict: true, resolvedBefore: 0,
          effectiveLimit: 5, effectiveLapCap: 2,
        },
      },
      convergenceCreditReceipts: { 'base-refresh': { gate: 'build_review' } },
    }));
    const before = await readKickbackLedger(root, child);

    await expect(grantRoutedRepairCredit({ projectRoot: root, child, roundId })).resolves.toEqual({ kind: 'granted' });
    const granted = await readKickbackLedger(root, child);
    expect(granted).toMatchObject({
      routedRepairCredit: { roundId: 'r1' },
    });
    expect(granted.gates).toEqual(before.gates);
    expect(granted.convergenceCreditReceipts).toEqual(before.convergenceCreditReceipts);
    await expect(grantRoutedRepairCredit({ projectRoot: root, child, roundId })).resolves.toEqual({ kind: 'already-granted' });
    await expect(consumeRoutedRepairCredit({ projectRoot: root, child, roundId })).resolves.toBe(true);
    await expect(consumeRoutedRepairCredit({ projectRoot: root, child, roundId })).resolves.toBe(false);
    await expect(readKickbackLedger(root, child)).resolves.toMatchObject({
      routedRepairCredit: { roundId: 'r1', consumed: true },
    });
  });

  it('fails closed when the persisted routed repair credit is malformed', async () => {
    const root = await fixture();
    await writeFile(kickbackLedgerPathFor(root, child), JSON.stringify({
      version: 1,
      gates: {},
      routedRepairCredit: { roundId: 'not-a-round' },
    }));
    const before = await readFile(kickbackLedgerPathFor(root, child), 'utf8');

    await expect(grantRoutedRepairCredit({ projectRoot: root, child, roundId })).rejects.toThrow('unreadable');
    await expect(readFile(kickbackLedgerPathFor(root, child), 'utf8')).resolves.toBe(before);
  });

  it('persists the repairing phase event with credit true for the routed host', async () => {
    const root = await fixture();
    const git = makeGitRunner(root);
    await git(['init', '-q', '-b', 'main']);
    const created = await createRouteRecord(root, 'demo', {
      roundId, kind: 'audit', items: [], allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    }, { git });
    if (created.kind !== 'created') throw new Error(`failed to create routed event fixture: ${created.kind}`);
    const admitted = await admitRound(root, 'demo', created.record, child, { git });
    if (admitted.kind !== 'admitted') throw new Error(`failed to admit routed event fixture: ${admitted.detail}`);
    const stored = await readRouteRecord(root, 'demo', roundId, { git });
    if (stored.kind !== 'record') throw new Error('missing admitted routed event record');
    const repairing = transitionHost(stored, child, 'repairing', { credit: true });
    if (repairing.kind !== 'updated') throw new Error('could not transition routed host to repairing');
    await expect(writeRoutingTransaction(root, 'demo', [{ kind: 'update-record', previous: stored, record: repairing.record }], { git }))
      .resolves.toEqual({ kind: 'updated' });

    await expect(readRouteRecord(root, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record',
      record: { outbox: expect.arrayContaining([expect.objectContaining({ event: expect.objectContaining({
        type: 'routed_repair_phase', host: child, phase: 'repairing', credit: true,
      }) })]) },
    });
  });

  it('lets the first routed build-review failure beyond the cumulative cap re-enter BUILD', async () => {
    const subject = await cumulativeCapFixture('available');

    await subject.conductor.run();
    expect(subject.dispatched).toEqual(['build_review', 'build']);
    await expect(readFile(join(subject.root, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain(
      'build_review cumulative kickback cap exceeded',
    );
    await expect(readKickbackLedger(subject.root, child)).resolves.toMatchObject({
      gates: { build_review: { cumulative: 6 } },
      routedRepairCredit: { roundId: 'r1', consumed: true },
    });
  });

  it('halts needs-human and names the child after the routed credit is spent', async () => {
    const subject = await cumulativeCapFixture('consumed');

    await subject.conductor.run();
    expect(subject.dispatched).toEqual(['build_review']);
    await expect(readFile(join(subject.root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(subject.root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('for child 1');
  });

  it('keeps every child cap and convergence receipt byte-identical for a feature-repair restack with r1 open', async () => {
    const root = await fixture();
    const git = makeGitRunner(root);
    await git(['init', '-q', '-b', 'main']);
    const created = await createRouteRecord(root, 'demo', {
      roundId, kind: 'audit', items: [], allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    }, { git });
    if (created.kind !== 'created') throw new Error(`failed to create open routed round: ${created.kind}`);
    const admitted = await admitRound(root, 'demo', created.record, child, { git });
    if (admitted.kind !== 'admitted') throw new Error(`failed to open routed round: ${admitted.detail}`);
    await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ build_review: 'done' }));
    await writeFile(kickbackLedgerPathFor(root, child), JSON.stringify({
      version: 1,
      gates: { build_review: { count: 1, cumulative: 2, laps: 3, treeHash: null, lastReason: 'prior', priorVerdict: true, resolvedBefore: 0 } },
      convergenceCreditReceipts: { prior: { gate: 'build_review' } },
    }));
    await writeVerdict(root, 'build_review', { satisfied: false, checkedAt: 1, kickback: { from: 'rebase', evidence: 'changed replay' } }, child);
    const before = await readFile(kickbackLedgerPathFor(root, child), 'utf8');

    const result = await applyRebaseTransition({
      projectRoot: root,
      child,
      stateStore: createFilesystemConductStateStore(join(root, '.pipeline', 'conduct-state.json')),
      operationId: 'routed-feature-repair',
      replay: { preRebaseHead: 'a', mergeBase: 'b', target: 'c', completedHead: 'd', expectedTree: 'e' },
      invalidated: ['build_review'], preserved: [], preservedCandidates: [], cause: 'feature-repair',
    });

    expect(result.convergenceCredit).toBeUndefined();
    await expect(readFile(kickbackLedgerPathFor(root, child), 'utf8')).resolves.toBe(before);
  });

  it('writes the credit after entering repairing and restores the absent credit exactly once on resume', async () => {
    const subject = await enteredHostFixture();

    await expect(subject.enter()).resolves.toMatchObject({ kind: 'entered' });
    await expect(readKickbackLedger(subject.root, child)).resolves.toMatchObject({ routedRepairCredit: { roundId: 'r1' } });
    await rm(kickbackLedgerPathFor(subject.root, child));

    await expect(subject.enter()).resolves.toMatchObject({ kind: 'resume' });
    const restored = await readFile(kickbackLedgerPathFor(subject.root, child), 'utf8');
    await expect(subject.enter()).resolves.toMatchObject({ kind: 'resume' });
    await expect(readFile(kickbackLedgerPathFor(subject.root, child), 'utf8')).resolves.toBe(restored);
    await expect(readKickbackLedger(subject.root, child)).resolves.toMatchObject({ routedRepairCredit: { roundId: 'r1' } });
  });
});
