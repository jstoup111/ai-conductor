// Covers: task:3, task:6, task:7, task:8, task:9, task:10, task:67, task:rem-prd-audit-W7
import { access, mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routedExit: undefined as undefined | ((...args: readonly unknown[]) => Promise<unknown>),
  reconcileRounds: undefined as undefined | ((...args: readonly unknown[]) => Promise<unknown>),
  routedRoundOpen: undefined as undefined | ((...args: readonly unknown[]) => Promise<unknown>),
  consumeQueued: undefined as undefined | (() => Promise<unknown>),
  queueAdmission: undefined as undefined | ((...args: readonly unknown[]) => Promise<unknown>),
}));

vi.mock('../../../src/engine/routing/round-admission.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/round-admission.js')>();
  return {
    ...actual,
    exitRoutedHostAndReconcile: (...args: Parameters<typeof actual.exitRoutedHostAndReconcile>) =>
      mocks.routedExit === undefined ? actual.exitRoutedHostAndReconcile(...args) : mocks.routedExit(...args),
    reconcileRounds: (...args: Parameters<typeof actual.reconcileRounds>) =>
      mocks.reconcileRounds === undefined ? actual.reconcileRounds(...args) : mocks.reconcileRounds(...args),
    routedRoundOpen: (...args: Parameters<typeof actual.routedRoundOpen>) =>
      mocks.routedRoundOpen === undefined ? actual.routedRoundOpen(...args) : mocks.routedRoundOpen(...args),
  };
});
vi.mock('../../../src/engine/routing/revalidation-queue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/revalidation-queue.js')>();
  return {
    ...actual,
    consumeLowestQueued: (...args: Parameters<typeof actual.consumeLowestQueued>) =>
      mocks.consumeQueued === undefined ? actual.consumeLowestQueued(...args) : mocks.consumeQueued(),
  };
});
vi.mock('../../../src/engine/routing/queue-admission.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/queue-admission.js')>();
  return {
    ...actual,
    admitQueuedRevalidation: (...args: Parameters<typeof actual.admitQueuedRevalidation>) =>
      mocks.queueAdmission === undefined ? actual.admitQueuedRevalidation(...args) : mocks.queueAdmission(...args),
  };
});

import { CHILD_REGION_STEPS, parseChildId, pipelinePathFor, type ChildId } from '../../../src/engine/child-context.js';
import {
  AcceptedWideningDecisionStore,
  renderOverScopeDecisionBlock,
  type OverScopePersistedOffer,
} from '../../../src/engine/accepted-widenings.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { writeVerdict } from '../../../src/engine/gate-verdicts.js';
import { dispatchHaltClearCommand } from '../../../src/engine/halt-clear-cli.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { persistPrdAuditVerdict } from '../../../src/engine/prd-audit-verdict-store.js';
import { prdWideningSourceId } from '../../../src/engine/prd-widening-context.js';
import { persistPrdWideningOffers } from '../../../src/engine/prd-widening-offers.js';
import { pinHostEntry } from '../../../src/engine/routing/host-region-entry.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import {
  createRouteRecord,
  readRepairMarker,
  readRouteRecord,
  transitionHost,
  writeRoutingTransaction,
} from '../../../src/engine/routing/route-record-store.js';
import {
  closureRefFor,
  repairMarkerRefFor,
  revalidationQueueRefFor,
  routeRecordRefFor,
} from '../../../src/engine/routing/routing-refs.js';
import {
  emptyUnsettledReceipt,
  parseRoundId,
  type RoundId,
  type RouteRecord,
} from '../../../src/engine/routing/route-types.js';
import { advanceRound } from '../../../src/engine/routing/routed-exit.js';
import { readState, writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, persistedEvents, sealStack } from '../restack/restack-sweepG2-fixture.js';
import { PASSING_FULL_SUITE_VERIFIER } from '../../test-conductor.js';
import { persistFixtureProjectedRemediationPlan } from '../remediation-plan-fixtures.js';

const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  mocks.routedExit = undefined;
  mocks.reconcileRounds = undefined;
  mocks.routedRoundOpen = undefined;
  mocks.consumeQueued = undefined;
  mocks.queueAdmission = undefined;
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function doneThrough(stopAt: StepName): ConductState {
  const state: ConductState = { feature_desc: 'demo', complexity_tier: 'M' };
  for (const step of ALL_STEPS) {
    if (step.name === stopAt) break;
    state[step.name] = 'done';
  }
  return state;
}

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'conductor-routing-resume-'));
  repositories.push(repo);
  const git = makeGitRunner(repo);
  const commit = async (message: string, path: string, value: string) => {
    await writeFile(join(repo, path), value);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing-resume@example.test']);
  await git(['config', 'user.name', 'Routing resume']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed child', 'child.txt', 'child\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(
    join(repo, '.ai-conductor', 'config.yml'),
    'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n',
  );
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure stack routing']);
  await writeSliceTopologyFixture(
    repo,
    {
      version: 1,
      slug: 'demo',
      runId: 'routing-resume',
      status: 'done',
      entries: [],
      sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['child', 'leaf'] },
      storyOwnership: { S1: 1, S2: 2 },
    },
    envelopeFilesystem,
  );
  return { repo, git };
}

const nc4 = {
  first: parseChildId(1)!,
  second: parseChildId(2)!,
  r2: parseRoundId('r2')!,
  r3: parseRoundId('r3')!,
};
const ROUTING_CONFIG = { stacked_prs: { enabled: true, max_slices: 3, route_whole_feature_fixes: true } };
const WHOLE_FEATURE_GATES: readonly StepName[] = ['manual_test', 'prd_audit', 'architecture_review_as_built'];

async function blobOf(git: GitRunner, value: unknown): Promise<string> {
  return (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) })).stdout.trim();
}

/**
 * A real three-slice stack interrupted inside r2, checked out as the daemon's
 * `.worktrees/demo` feature worktree: host 1 has committed its repair and
 * holds satisfied region evidence, host 2 is still pending, and the
 * whole-feature gates are next in the root state.
 */
async function interruptedR2Fixture(): Promise<{
  readonly main: string;
  readonly worktree: string;
  readonly git: GitRunner;
  readonly statePath: string;
}> {
  const subject = await createSweepRepository('conductor-routing-resume-r2-', repositories);
  await subject.write('.gitignore', '.pipeline/\n.worktrees/\n');
  await subject.write(
    '.ai-conductor/config.yml',
    'stacked_prs:\n  enabled: true\n  max_slices: 3\n  route_whole_feature_fixes: true\n',
  );
  await subject.git(['add', '.gitignore', '.ai-conductor/config.yml']);
  await subject.git(['commit', '-qm', 'configure stack routing']);
  await subject.commit('base', 'base.txt', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const closedOne = await subject.commit('closed one', 'one.txt', 'one\n');
  await subject.git(['update-ref', closureRefFor('demo', nc4.first), closedOne]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  const closedTwo = await subject.commit('closed two', 'two.txt', 'two\n');
  await subject.git(['update-ref', closureRefFor('demo', nc4.second), closedTwo]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('leaf', 'leaf.txt', 'leaf\n');
  await sealStack(subject.repo, [1, 2, 3]);
  await subject.git(['checkout', '-q', 'feat/c1/demo']);
  await subject.commit('r2 host 1 repair', 'one-fix.txt', 'fixed\n');
  await subject.git(['checkout', '-q', 'main']);
  const worktree = join(subject.repo, '.worktrees', 'demo');
  await subject.git(['worktree', 'add', '-q', worktree, 'feat/c1/demo']);

  const git = makeGitRunner(worktree);
  const r2: RouteRecord = {
    roundId: nc4.r2,
    kind: 'audit',
    phase: 'open',
    sealedAuthored: 3,
    items: [
      { findingId: 'S1.1', kind: 'audit', owner: nc4.first, host: nc4.first, reason: 'task-slice', fallback: [] },
      { findingId: 'S2.1', kind: 'audit', owner: nc4.second, host: nc4.second, reason: 'task-slice', fallback: [] },
    ],
    allocation: {
      [nc4.first]: { remTaskIds: [], blockBodies: [] },
      [nc4.second]: { remTaskIds: [], blockBodies: [] },
    },
    hosts: { [nc4.first]: 'repairing', [nc4.second]: 'pending' },
    currentHostIndex: 0,
    receipt: emptyUnsettledReceipt(),
    outbox: [],
    entry: { host: nc4.first, pinnedBase: closedOne, tree: (await subject.rev(`${closedOne}^{tree}`)) as never },
  };
  await git(['update-ref', routeRecordRefFor('demo', nc4.r2), await blobOf(git, r2)]);
  await git(['update-ref', repairMarkerRefFor('demo'), await blobOf(git, { host: nc4.first, roundId: nc4.r2 })]);
  await git([
    'update-ref',
    revalidationQueueRefFor('demo'),
    await blobOf(git, { generation: 1, entries: [], outbox: [] }),
  ]);

  const statePath = join(worktree, '.pipeline', 'conduct-state.json');
  await writeState(statePath, doneThrough('manual_test'));
  const region = { feature_desc: 'demo', complexity_tier: 'M' } as const;
  await writeState(pipelinePathFor(worktree, 'conduct-state.json', nc4.first), {
    ...region,
    acceptance_specs: 'done',
    build: 'done',
    test_suite: 'done',
    build_review: 'done',
    last_step: 'build_review',
  });
  await writeState(pipelinePathFor(worktree, 'conduct-state.json', nc4.second), {
    ...region,
    acceptance_specs: 'pending',
    build: 'pending',
    test_suite: 'pending',
    build_review: 'pending',
  });
  for (const step of CHILD_REGION_STEPS) {
    await writeVerdict(
      worktree,
      step,
      { satisfied: true, reason: 'r2 host 1 region passed', checkedAt: 1 },
      nc4.first,
      { routedRound: 'r2' },
    );
  }
  return { main: subject.repo, worktree, git, statePath };
}

const NC4_SUMMARY = 'The diff adds a visible export command outside the approved plan.';

/** Persist the NC.4 offer and its operator refusal exactly as halt clear records them. */
async function recordNc4Refusal(
  main: string,
  worktree: string,
): Promise<{ readonly decisionId: string; readonly sourceId: string; readonly offer: OverScopePersistedOffer }> {
  const repository = await realpath(main);
  const sourceId = prdWideningSourceId({ criterion: 'NC.4', grade: 'OVER_SCOPE', evidence: NC4_SUMMARY, prdIds: [] });
  const offers = await persistPrdWideningOffers(worktree, { version: 'v1', repository, feature: 'demo' }, [
    {
      criterion: 'NC.4',
      sourceId,
      evidence: NC4_SUMMARY,
      reportSnapshot: NC4_SUMMARY,
      relation: 'outside-visible',
    },
  ]);
  if (!offers.ok || offers.offers.length !== 1)
    throw new Error(`could not persist NC.4 offer: ${offers.ok ? 'no offer' : offers.reason}`);
  const offer = offers.offers[0]!;
  const recorded = await new AcceptedWideningDecisionStore(worktree, {
    version: 1,
    repository,
    feature: 'demo',
  }).append({
    criterion: 'NC.4',
    authority: 'refuse',
    rationale: 'Remove the refused export command.',
    operator: 'operator@example.test',
    originalSource: offer.originalSource,
    originalCaseId: offer.originalCaseId,
    offerEntryId: offer.offerEntryId,
  });
  if (!recorded.ok) throw new Error(`could not record NC.4 refusal: ${recorded.reason}`);
  return { decisionId: recorded.decision.id, sourceId, offer };
}

/**
 * Routed host entry runs host-local plan restaging and acceptance probes that
 * are outside this resume boundary.  The adapter keeps its durable effects:
 * pin the entry baseline, check out the host and mark it repairing.
 */
async function enterRoutedHostForTest(input: {
  readonly worktree: string;
  readonly slug: string;
  readonly roundId: RoundId;
  readonly host: ChildId;
}) {
  const git = makeGitRunner(input.worktree);
  const stored = await readRouteRecord(input.worktree, input.slug, input.roundId);
  if (stored.kind !== 'record') return { kind: 'refused' as const, detail: `${input.roundId} is unreadable` };
  const pinned = await pinHostEntry(input.worktree, input.slug, stored, input.host, git);
  if (pinned.kind !== 'pinned') return { kind: 'refused' as const, detail: pinned.detail };
  await git(['checkout', '-q', pinned.target.branch]);
  if (pinned.stored.record.hosts[input.host] === 'admitted') {
    const repairing = transitionHost(pinned.stored, input.host, 'repairing', { credit: true });
    if (repairing.kind !== 'updated')
      return { kind: 'refused' as const, detail: `cannot enter ${input.roundId} host ${input.host}` };
    const wrote = await writeRoutingTransaction(input.worktree, input.slug, [
      { kind: 'update-record', previous: pinned.stored, record: repairing.record },
    ]);
    if (wrote.kind !== 'updated')
      return { kind: 'refused' as const, detail: `cannot write ${input.roundId} host ${input.host}` };
  }
  return { kind: 'entered' as const, pinnedBase: pinned.pinnedBase };
}

async function runResumedConductor(
  repo: string,
  statePath: string,
  run: NonNullable<ConstructorParameters<typeof Conductor>[0]['stepRunner']>['run'],
): Promise<void> {
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(repo, '.pipeline', 'events.jsonl'), events);
  persister.start();
  try {
    await new Conductor({
      projectRoot: repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'manual_test',
      resume: true,
      verifyArtifacts: false,
      events,
      config: ROUTING_CONFIG,
      stepRunner: { run },
      sleepFn: async () => {},
      fullSuiteVerifier: PASSING_FULL_SUITE_VERIFIER,
      childRegionLifecycle: { enterHostRegion: (input) => enterRoutedHostForTest(input) as never },
    }).run();
  } finally {
    persister.stop();
  }
}

describe('routed round conductor resume', () => {
  it('keeps the reconciliation refusal detail when a routed exit cannot reconcile', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const state: ConductState = {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const,
      child: parseChildId(2)!,
      position: parseChildId(2)!,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    mocks.routedExit = async () => ({
      kind: 'exited',
      next: { kind: 'unavailable', detail: 'r1 route record is unreadable' },
    });
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    });
    const resumed = conductor as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (
        candidate: ConductState,
        indexOf: (step: StepName) => number,
        requireSatisfiedRegion?: boolean,
      ) => Promise<unknown>;
    };
    resumed.activeRegionChild = host;

    await expect(resumed.continueRoutedHostExit(state, () => 0, true)).resolves.toBe('halt');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'child BUILD region refused: child 1 routed round reconciliation refused: r1 route record is unreadable',
    );
  });

  it('halts when routed-exit queue admission is unavailable', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const state: ConductState = {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const,
      child: parseChildId(2)!,
      position: parseChildId(2)!,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    mocks.routedExit = async () => ({ kind: 'exited', next: { kind: 'none' } });
    mocks.queueAdmission = async () => ({ kind: 'unavailable', detail: 'cannot consume routed revalidation queue' });
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    });
    const resumed = conductor as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (
        candidate: ConductState,
        indexOf: (step: StepName) => number,
        requireSatisfiedRegion?: boolean,
      ) => Promise<unknown>;
    };
    resumed.activeRegionChild = host;

    await expect(resumed.continueRoutedHostExit(state, () => 0, true)).resolves.toBe('halt');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'child BUILD region refused: cannot consume routed revalidation queue',
    );
  });

  it('consumes queued revalidation before selecting the next region after a resumed routed exit', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const queued = parseChildId(2)!;
    const roundId = parseRoundId('r1')!;
    const state: ConductState = {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
    };
    const order: string[] = [];
    const routed = {
      kind: 'repair-pending' as const,
      child: queued,
      position: queued,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    const revalidating = {
      kind: 'repair-pending' as const,
      child: queued,
      position: queued,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [host],
      revalidating: { child: queued, generation: 1 },
    };
    let resolveCount = 0;
    mocks.routedExit = async () => {
      order.push('exit');
      return { kind: 'exited', next: { kind: 'none' } };
    };
    mocks.consumeQueued = async () => {
      order.push('consume');
      return { kind: 'admitted', roundId, host: queued };
    };
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: {
        resolveActiveChild: async () => {
          resolveCount += 1;
          order.push(resolveCount === 1 ? 'resolve-host' : 'resolve-next');
          return resolveCount === 1 ? routed : revalidating;
        },
      },
    });
    const resumed = conductor as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (
        candidate: ConductState,
        indexOf: (step: StepName) => number,
        requireSatisfiedRegion?: boolean,
      ) => Promise<unknown>;
    };
    resumed.activeRegionChild = host;

    const result = await resumed.continueRoutedHostExit(
      state,
      (step) => ALL_STEPS.findIndex((candidate) => candidate.name === step),
      true,
    );

    expect(order).toEqual(['resolve-host', 'exit', 'consume', 'resolve-next']);
    expect(result).toMatchObject({
      index: ALL_STEPS.findIndex((step) => step.name === 'acceptance_specs'),
      activeChild: { child: queued },
    });
  });

  // Covers: task:3
  it('restores whole-feature state and resumes manual test after a leaf return with no queued admission', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    const wholeFeatureState: ConductState = {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
      manual_test: 'pending',
    };
    await writeState(statePath, wholeFeatureState);
    const childState: ConductState = {
      ...wholeFeatureState,
      manual_test: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const,
      child: host,
      position: host,
      isLeaf: true,
      branch: 'feat/c1/demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    const admission = vi.fn(async () => ({ kind: 'none' as const }));
    mocks.routedExit = async () => ({ kind: 'exited', next: { kind: 'leaf-returned' as const, roundId } });
    mocks.queueAdmission = admission;
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    }) as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (
        candidate: ConductState,
        indexOf: (step: StepName) => number,
        requireSatisfiedRegion?: boolean,
      ) => Promise<unknown>;
    };
    conductor.activeRegionChild = host;

    await expect(
      conductor.continueRoutedHostExit(
        childState,
        (step) => ALL_STEPS.findIndex((candidate) => candidate.name === step),
        true,
      ),
    ).resolves.toEqual({ index: ALL_STEPS.findIndex((step) => step.name === 'manual_test') });

    expect(admission).toHaveBeenCalledOnce();
    expect(admission).toHaveBeenCalledWith(expect.objectContaining({ reconciled: { kind: 'leaf-returned', roundId } }));
    expect(childState).toEqual(wholeFeatureState);
  });

  it('surfaces a remediation PR when a resumed routed exit halts', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const state: ConductState = {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const,
      child: parseChildId(2)!,
      position: parseChildId(2)!,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    await mkdir(join(subject.repo, '.pipeline'), { recursive: true });
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'routed exit needs remediation\n');
    mocks.routedExit = async () => ({ kind: 'exit-halted', detail: 'routed exit needs remediation' });
    const events = new ConductorEventEmitter();
    const loopHalts: Array<{ reason: string; prUrl?: string }> = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') loopHalts.push({ reason: event.reason, prUrl: event.prUrl });
    });
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      resume: true,
      daemon: true,
      verifyArtifacts: false,
      events,
      stepRunner: { run: vi.fn() },
      escalateBuildFailure: async () => ({ prUrl: 'https://example.test/remediation/123' }),
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    });
    const resumed = conductor as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (
        candidate: ConductState,
        indexOf: (step: StepName) => number,
        requireSatisfiedRegion?: boolean,
      ) => Promise<unknown>;
    };
    resumed.activeRegionChild = host;

    await expect(resumed.continueRoutedHostExit(state, () => 0, true)).resolves.toBe('halt');
    expect(loopHalts).toEqual([
      { reason: 'routed exit needs remediation', prUrl: 'https://example.test/remediation/123' },
    ]);
  });

  // Covers: task:8
  it('keeps a restack-reported routed-exit halt and does not admit the queue', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r4')!;
    const state: ConductState = {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const,
      child: host,
      position: host,
      isLeaf: true,
      branch: 'feat/c1/demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    mocks.routedExit = async () => ({ kind: 'exit-halted', detail: 'routed exit host 1: base-refresh restack halted' });
    const admission = vi.fn(async () => ({ kind: 'none' as const }));
    mocks.queueAdmission = admission;
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    }) as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (
        candidate: ConductState,
        indexOf: (step: StepName) => number,
        requireSatisfiedRegion?: boolean,
      ) => Promise<unknown>;
    };
    conductor.activeRegionChild = host;

    await expect(conductor.continueRoutedHostExit(state, () => 0, true)).resolves.toBe('halt');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'routed exit host 1: base-refresh restack halted',
    );
    expect(admission).not.toHaveBeenCalled();
  });

  it('does not halt or fabricate receipt accounting when a routing-eligible resume has no route records', async () => {
    const subject = await fixture();
    await expect(
      subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']),
    ).resolves.toMatchObject({ stdout: '' });
    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    await writeState(statePath, doneThrough('prd_audit'));
    const dispatched: StepName[] = [];
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          return { success: false, operatorParkedBeforeDispatch: true };
        },
      },
    });

    await conductor.run();

    expect(dispatched).not.toHaveLength(0);
    await expect(
      subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']),
    ).resolves.toMatchObject({ stdout: '' });
    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(subject.repo, '.pipeline', 'HALT.class'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(subject.repo, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  // Covers: task:4, task:5
  it('reconciles a settled markerless round before resuming the next whole-feature gate', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const leaf = parseChildId(2)!;
    const roundId = parseRoundId('r7')!;
    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    await writeState(statePath, doneThrough('manual_test'));
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [],
      allocation: {
        [child]: { remTaskIds: [], blockBodies: [] },
        [leaf]: { remTaskIds: [], blockBodies: [] },
      },
    });
    if (created.kind !== 'created') throw new Error(`could not create r7: ${created.kind}`);
    const settledRecord = {
      ...created.record,
      phase: 'open' as const,
      hosts: { [child]: 'restacked' as const, [leaf]: 'restacked' as const },
      currentHostIndex: 1,
    };
    const blob = (
      await subject.git(['hash-object', '-w', '--stdin'], {
        input: JSON.stringify(settledRecord),
      })
    ).stdout.trim();
    await subject.git(['update-ref', routeRecordRefFor('demo', roundId), blob]);

    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
    }) as unknown as {
      guardOutstandingRoutedWork: (state: ConductState, indexOf: (step: StepName) => number) => Promise<unknown>;
    };

    const state = await readState(statePath);
    if (!state.ok) throw state.error;
    mocks.reconcileRounds = async () => {
      const open = await readRouteRecord(subject.repo, 'demo', roundId);
      if (open.kind !== 'record') throw new Error('missing r7 record');
      await writeRoutingTransaction(subject.repo, 'demo', [
        {
          kind: 'update-record',
          previous: open,
          record: { ...open.record, phase: 'closed' },
        },
      ]);
      return { kind: 'leaf-returned', roundId };
    };
    mocks.routedRoundOpen = async () => false;
    await expect(
      conductor.guardOutstandingRoutedWork(state.value, (step) =>
        ALL_STEPS.findIndex((candidate) => candidate.name === step),
      ),
    ).resolves.toEqual({ index: ALL_STEPS.findIndex((step) => step.name === 'manual_test') });

    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
      kind: 'record',
      record: { phase: 'closed' },
    });
  });

  it('re-navigates a post-marker crash to build without re-admitting the round', async () => {
    const subject = await fixture();
    const child = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
      allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, child)).resolves.toMatchObject({ kind: 'admitted' });

    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    await writeState(statePath, doneThrough('prd_audit'));
    await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', parseChildId(2)!), {
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
      last_step: 'build_review',
    });
    const dispatched: StepName[] = [];
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          throw new Error('stop after resumed build dispatch');
        },
      },
      childRegionLifecycle: {
        enterHostRegion: async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never,
        enterChildRegion: async () => ({ kind: 'completed' }),
      },
    });

    await conductor.run();
    expect(dispatched).toEqual(['build']);
    await expect(
      readState(pipelinePathFor(subject.repo, 'conduct-state.json', parseChildId(2)!)),
    ).resolves.toMatchObject({ ok: true, value: { build: 'pending' } });
    const refs = (await subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/'])).stdout
      .split('\n')
      .filter(Boolean);
    expect(refs.filter((ref) => ref.includes('/routes/'))).toHaveLength(1);
    expect(refs.filter((ref) => ref.endsWith('/repairing'))).toHaveLength(1);
  });

  // Covers: task:4
  it('keeps the derived-already-complete halt for a sole task-bound host', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r3')!;
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [
        {
          findingId: 'rem-1',
          kind: 'audit',
          owner: host,
          host,
          reason: 'task-bound',
          existingTask: true,
          taskIds: ['rem-1'],
          restage: false,
          fallback: [],
        },
      ],
      allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, host)).resolves.toMatchObject({ kind: 'admitted' });
    const routed = {
      kind: 'repair-pending' as const,
      child: host,
      position: host,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    const runner = vi.fn(async () => ({ success: true }));
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: runner },
      childRegionLifecycle: {
        resolveActiveChild: async () => routed,
        enterHostRegion: async () =>
          ({ kind: 'derived-already-complete', detail: 'every routed task is already evidence-complete' }) as never,
      },
    }) as unknown as {
      enterRoutedHostRegion: (
        execution: unknown,
        slug: string,
        state: ConductState,
        cursor: unknown,
      ) => Promise<unknown>;
    };

    await expect(
      conductor.enterRoutedHostRegion(
        { source: 'routed-host', target: { child: host, isLeaf: true }, roundId },
        'demo',
        { feature_desc: 'demo' },
        routed,
      ),
    ).resolves.toBe(false);
    expect(runner).not.toHaveBeenCalled();
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(
      /Outcome: derived-already-complete\n$/,
    );
  });

  // Covers: task:4
  it('resumes an interrupted taskless routed BUILD with its durable retry hint', async () => {
    const subject = await fixture();
    const host = parseChildId(4)!;
    const roundId = parseRoundId('r4')!;
    const retryHint = 'manual_test: FAIL touch controls overlap';
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [{ findingId: 'manual-test-fail', kind: 'audit', owner: host, host, reason: 'manual-test', fallback: [] }],
      allocation: { [host]: { remTaskIds: [], blockBodies: [], retryHint } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, host)).resolves.toMatchObject({ kind: 'admitted' });
    const admitted = await readRouteRecord(subject.repo, 'demo', roundId);
    if (admitted.kind !== 'record') throw new Error('missing r4 record');
    const repairing = transitionHost(admitted, host, 'repairing', { credit: true });
    if (repairing.kind !== 'updated') throw new Error('could not enter repairing');
    await expect(
      writeRoutingTransaction(subject.repo, 'demo', [
        { kind: 'update-record', previous: admitted, record: repairing.record },
      ]),
    ).resolves.toMatchObject({ kind: 'updated' });

    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    await writeState(statePath, doneThrough('prd_audit'));
    await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', host), {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'done',
      build: 'pending',
    });
    const dispatched: Array<{ step: StepName; retryReason: string | undefined }> = [];
    const routed = {
      kind: 'repair-pending' as const,
      child: host,
      position: host,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async (step, _state, options) => {
          dispatched.push({ step, retryReason: options?.retryReason });
          throw new Error('stop after resumed taskless build dispatch');
        },
      },
      childRegionLifecycle: {
        resolveActiveChild: async () => routed,
        enterHostRegion: async () => ({ kind: 'resume', pinnedBase: 'a'.repeat(40) }) as never,
        enterChildRegion: async () => ({ kind: 'completed' }),
      },
    });

    await conductor.run();

    expect(dispatched).toEqual(expect.arrayContaining([{ step: 'build', retryReason: retryHint }]));
    expect((conductor as unknown as { activeRegionChild: typeof host }).activeRegionChild).toBe(host);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain(
      'derived-already-complete',
    );
  });

  // Covers: task:6, task:rem-prd-audit-S1.4
  it('heals the #3455 markerless needs-human halt without editing stale verdicts, preserving region dispatch order', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r5')!;
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 0,
      kind: 'audit',
      items: [],
      allocation: { [host]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, host)).resolves.toMatchObject({ kind: 'admitted' });
    const admitted = await readRouteRecord(subject.repo, 'demo', roundId);
    if (admitted.kind !== 'record') throw new Error('missing r5 record');
    const repairing = transitionHost(admitted, host, 'repairing', { credit: true });
    if (repairing.kind !== 'updated') throw new Error('could not enter repairing');
    await expect(
      writeRoutingTransaction(subject.repo, 'demo', [
        { kind: 'update-record', previous: admitted, record: repairing.record },
      ]),
    ).resolves.toMatchObject({ kind: 'updated' });

    const childStatePath = pipelinePathFor(subject.repo, 'conduct-state.json', host);
    await writeState(childStatePath, {
      acceptance_specs: 'pending',
      build: 'in_progress',
      test_suite: 'pending',
      build_review: 'in_progress',
    });
    const gates = join(subject.repo, '.pipeline', 'children', '1', 'gates');
    await mkdir(gates, { recursive: true });
    await Promise.all(
      ['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
        writeFile(join(gates, `${step}.json`), JSON.stringify({ satisfied: true, checkedAt: 1 })),
      ),
    );
    const before = await Promise.all(
      ['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
        readFile(join(gates, `${step}.json`), 'utf8'),
      ),
    );
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'needs human\n');
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human');
    await rm(join(subject.repo, '.pipeline', 'HALT'));
    await rm(join(subject.repo, '.pipeline', 'HALT.class'));

    const state = await readState(childStatePath);
    if (!state.ok) throw state.error;
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: childStatePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
    }) as unknown as { activeRegionChild: typeof host; readGateVerdictOverlay: () => Promise<Record<string, unknown>> };
    conductor.activeRegionChild = host;
    const overlay = await conductor.readGateVerdictOverlay();
    expect(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) => overlay[step])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      ['acceptance_specs', 'build', 'test_suite', 'build_review'].filter((step) =>
        ['pending', 'in_progress'].includes((state.value as Record<string, unknown>)[step] as string),
      ),
    ).toEqual(['acceptance_specs', 'build', 'test_suite', 'build_review']);
    const after = await Promise.all(
      ['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
        readFile(join(gates, `${step}.json`), 'utf8'),
      ),
    );
    expect(after).toEqual(before);
    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:9, task:rem-prd-audit-S5.1
  it('takes the parked resume exit for an r5-complete routed host without re-dispatching its region', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r5')!;
    const statePath = pipelinePathFor(subject.repo, 'conduct-state.json', host);
    const state: ConductState = {
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
      feature_desc: 'demo',
      complexity_tier: 'M',
    };
    await writeState(statePath, state);
    const gates = join(subject.repo, '.pipeline', 'children', '1', 'gates');
    await mkdir(gates, { recursive: true });
    await Promise.all(
      ['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
        writeFile(join(gates, `${step}.json`), JSON.stringify({ satisfied: true, routedRound: 'r5', checkedAt: 1 })),
      ),
    );
    const routed = {
      kind: 'repair-pending' as const,
      child: host,
      position: host,
      isLeaf: false,
      branch: 'feat/c1/demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId },
    };
    const exits: string[] = [];
    mocks.routedExit = async () => {
      exits.push('r5');
      return { kind: 'continued', next: { kind: 'none' } };
    };
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    }) as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (
        state: ConductState,
        indexOf: (step: StepName) => number,
        requireSatisfiedRegion: boolean,
      ) => Promise<unknown>;
    };
    conductor.activeRegionChild = host;
    await expect(
      conductor.continueRoutedHostExit(
        state,
        (step) => ALL_STEPS.findIndex((candidate) => candidate.name === step),
        true,
      ),
    ).resolves.toBeDefined();
    expect(exits).toEqual(['r5']);
    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:9, task:rem-prd-audit-S5.2
  it('takes the same parked resume exit for a revalidate host after only its re-pended gates complete', async () => {
    const subject = await fixture();
    const host = parseChildId(2)!;
    const statePath = pipelinePathFor(subject.repo, 'conduct-state.json', host);
    const state: ConductState = {
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
      feature_desc: 'demo',
      complexity_tier: 'M',
    };
    await writeState(statePath, state);
    const gates = join(subject.repo, '.pipeline', 'children', '2', 'gates');
    await mkdir(gates, { recursive: true });
    await Promise.all(
      ['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
        writeFile(join(gates, `${step}.json`), JSON.stringify({ satisfied: true, routedRound: 'r6', checkedAt: 1 })),
      ),
    );
    // At this boundary the route resolver promotes the revalidate cursor to
    // routed-host; otherwise the parked arm must not attempt an exit.
    const routed = {
      kind: 'repair-pending' as const,
      child: host,
      position: host,
      isLeaf: true,
      branch: 'feat/daemon-demo',
      repairChildren: [host],
      routedRepair: { child: host, roundId: parseRoundId('r6')! },
    };
    mocks.routedExit = async () => ({ kind: 'continued', next: { kind: 'none' } });
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    }) as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (
        state: ConductState,
        indexOf: (step: StepName) => number,
        requireSatisfiedRegion: boolean,
      ) => Promise<unknown>;
    };
    conductor.activeRegionChild = host;
    await expect(
      conductor.continueRoutedHostExit(
        state,
        (step) => ALL_STEPS.findIndex((candidate) => candidate.name === step),
        true,
      ),
    ).resolves.toBeDefined();
    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:4
  it('resumes a satisfied r2 host through its exit before any whole-feature gate', async () => {
    const subject = await fixture();
    const first = parseChildId(1)!;
    const second = parseChildId(2)!;
    const roundId = parseRoundId('r2')!;
    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    const rootState = doneThrough('manual_test');
    await writeState(statePath, rootState);
    await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', first), {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'done',
      build: 'done',
      test_suite: 'done',
      build_review: 'done',
    });
    await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', second), {
      feature_desc: 'demo',
      complexity_tier: 'M',
      acceptance_specs: 'pending',
      build: 'pending',
      test_suite: 'pending',
      build_review: 'pending',
    });
    await mkdir(join(subject.repo, '.pipeline', 'children', '1', 'gates'), { recursive: true });
    await Promise.all(
      ['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
        writeFile(
          join(subject.repo, '.pipeline', 'children', '1', 'gates', `${step}.json`),
          JSON.stringify({
            satisfied: true,
            routedRound: 'r2',
            checkedAt: 1,
          }),
          'utf8',
        ),
      ),
    );
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId,
      sealedAuthored: 1,
      kind: 'audit',
      items: [],
      allocation: { [first]: { remTaskIds: [], blockBodies: [] }, [second]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(`could not create r2: ${created.kind}`);
    await expect(admitRound(subject.repo, 'demo', created.record, first)).resolves.toMatchObject({ kind: 'admitted' });
    const admitted = await readRouteRecord(subject.repo, 'demo', roundId);
    if (admitted.kind !== 'record') throw new Error('r2 was not admitted');
    const repairing = transitionHost(admitted, first, 'repairing', { credit: true });
    if (repairing.kind !== 'updated') throw new Error('could not stage r2 host 1');
    await expect(
      writeRoutingTransaction(subject.repo, 'demo', [
        { kind: 'update-record', previous: admitted, record: repairing.record },
      ]),
    ).resolves.toMatchObject({ kind: 'updated' });

    // This is deliberately not a restack test.  The exit seam advances only
    // the durable route record and marker, leaving run() bounded at child 2.
    mocks.routedExit = async (...args) => {
      const input = args[0] as {
        readonly worktree: string;
        readonly slug: string;
        readonly roundId: typeof roundId;
        readonly host: typeof first;
      };
      const beforeExit = await readRouteRecord(input.worktree, input.slug, input.roundId);
      if (beforeExit.kind !== 'record') throw new Error('r2 missing before mocked exit');
      const built = transitionHost(beforeExit, input.host, 'built', { credit: false });
      if (built.kind !== 'updated') throw new Error('could not mark r2 host built');
      await writeRoutingTransaction(input.worktree, input.slug, [
        { kind: 'update-record', previous: beforeExit, record: built.record },
      ]);
      const builtRecord = await readRouteRecord(input.worktree, input.slug, input.roundId);
      if (builtRecord.kind !== 'record') throw new Error('r2 missing after built');
      const restacked = transitionHost(builtRecord, input.host, 'restacked', { credit: false });
      const marker = await readRepairMarker(input.worktree, input.slug);
      if (restacked.kind !== 'updated' || marker.kind !== 'marker') throw new Error('could not apply mocked exit');
      await writeRoutingTransaction(input.worktree, input.slug, [
        { kind: 'update-record', previous: builtRecord, record: restacked.record },
        { kind: 'delete-marker', old: marker.blob },
      ]);
      const exited = await readRouteRecord(input.worktree, input.slug, input.roundId);
      if (exited.kind !== 'record') throw new Error('r2 missing after mocked restack');
      const advanced = await advanceRound(input.worktree, input.slug, exited);
      if (advanced.kind !== 'admitted') throw new Error(`could not admit r2 host 2: ${advanced.kind}`);
      return { kind: 'continued', next: { kind: 'navigate-host', roundId: input.roundId, host: second } };
    };
    const starts: Array<{ step: StepName; child?: number }> = [];
    const events = new ConductorEventEmitter();
    events.on('step_started', (event) => {
      if (event.type === 'step_started') starts.push({ step: event.step, child: event.child });
    });
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'manual_test',
      resume: true,
      verifyArtifacts: false,
      events,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: {
        run: async (step) => {
          throw new Error(`stop at child 2: ${step}`);
        },
      },
      childRegionLifecycle: {
        resolveActiveChild: async () => {
          const current = await readRepairMarker(subject.repo, 'demo');
          const child = current.kind === 'marker' ? current.marker.host : second;
          return child === first
            ? {
                kind: 'repair-pending' as const,
                child: first,
                position: first,
                isLeaf: false,
                branch: 'feat/c1/demo',
                repairChildren: [first],
                routedRepair: { child: first, roundId },
              }
            : {
                kind: 'repair-pending' as const,
                child: second,
                position: second,
                isLeaf: true,
                branch: 'feat/daemon-demo',
                repairChildren: [second],
                routedRepair: { child: second, roundId },
              };
        },
        enterHostRegion: async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never,
        enterChildRegion: async () => ({ kind: 'completed' as const }),
      },
    });
    await conductor.run().catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.startsWith('stop at child 2:')) throw error;
    });

    expect(starts.map(({ step }) => step)).not.toEqual(
      expect.arrayContaining(['manual_test', 'prd_audit', 'architecture_review_as_built']),
    );
    const record = await readRouteRecord(subject.repo, 'demo', roundId);
    const marker = await readRepairMarker(subject.repo, 'demo');
    expect(record).toMatchObject({ kind: 'record', record: { hosts: { 1: 'restacked', 2: 'admitted' } } });
    expect(marker).toMatchObject({ kind: 'marker', marker: { host: 2, roundId } });
    expect(starts).toContainEqual(expect.objectContaining({ child: 2 }));
  });

  // Covers: task:8, S3.3
  it('resumes a cleared NC-4 over-scope halt into routing progress without re-requesting a decision', async () => {
    const { main, worktree, statePath } = await interruptedR2Fixture();
    // The operator refused NC.4 in the over-scope block; the refusal is
    // recorded and `halt clear` preserves the answered block.
    const refusal = await recordNc4Refusal(main, worktree);
    await writeFile(
      join(worktree, '.pipeline', 'HALT'),
      `${renderOverScopeDecisionBlock([refusal.offer]).replace(
        '"decision": "pending"',
        '"decision": "refuse",\n    "rationale": "Remove the refused export command."',
      )}\n`,
    );
    await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'over-scope');
    await expect(
      dispatchHaltClearCommand(
        { kind: 'halt-clear', feature: 'demo', rationale: 'NC.4 refusal recorded' },
        {
          cwd: main,
          resolveOperator: () => 'operator@example.test',
          isInteractive: () => true,
          print: () => {},
          supersedeRecord: async () => ({ kind: 'noop' }),
        },
      ),
    ).resolves.toBe(0);
    await expect(access(join(worktree, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(worktree, '.pipeline', 'HALT.cleared'), 'utf8')).resolves.toContain(
      '"decision": "refuse"',
    );

    await runResumedConductor(worktree, statePath, async () =>
      // End the resumed run at its first provider dispatch: the routing
      // progress under test is durable before any provider can run.
      ({ success: false, operatorParkedBeforeDispatch: true }),
    );

    const events = await persistedEvents(worktree);
    const progress = events.findIndex((event) => event.type === 'routed_repair_phase' && event.roundId === 'r2');
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(events[progress]).toMatchObject({ host: 1, phase: 'built' });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'routed_repair_phase', roundId: 'r2', host: 1, phase: 'restacked' }),
    );
    expect(
      events
        .slice(0, progress)
        .filter((event) => event.type === 'step_started' && WHOLE_FEATURE_GATES.includes(event.step as StepName)),
    ).toEqual([]);
    await expect(readRouteRecord(worktree, 'demo', nc4.r2)).resolves.toMatchObject({
      kind: 'record',
      record: { phase: 'open', hosts: { 1: 'restacked', 2: 'repairing' } },
    });
    const halt = await readFile(join(worktree, '.pipeline', 'HALT'), 'utf8').catch(() => '');
    expect(halt).not.toContain('revise-decision');
    expect(halt).not.toContain('over-scope-decisions');
  });

  // Covers: task:8, S3.1
  it('closes r2 through host 2 before prd_audit, then admits NC-4 refusal rework as audit round r3', async () => {
    const { main, worktree, git, statePath } = await interruptedR2Fixture();
    const refusal = await recordNc4Refusal(main, worktree);
    let r2AtFirstPrdAudit: Awaited<ReturnType<typeof readRouteRecord>> | undefined;
    // Resume r2 to its first prd_audit dispatch. Host 2 commits its repair so
    // its exit is a real restack.
    await runResumedConductor(worktree, statePath, async (step) => {
      if (step === 'build') {
        await writeFile(join(worktree, 'two-fix.txt'), 'fixed\n');
        await git(['add', 'two-fix.txt']);
        await git(['commit', '-qm', 'r2 host 2 repair']);
      }
      if (step === 'prd_audit') {
        r2AtFirstPrdAudit ??= await readRouteRecord(worktree, 'demo', nc4.r2);
        return { success: false, operatorParkedBeforeDispatch: true };
      }
      return { success: true };
    });

    // The audited gate run: prd_audit reports NC.4 again, and the recorded
    // refusal is routed as rework. The run stops at the first BUILD dispatch.
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await new Conductor({
        projectRoot: worktree,
        stateFilePath: statePath,
        featureSlug: 'demo',
        fromStep: 'prd_audit',
        mode: 'default',
        daemon: true,
        verifyArtifacts: true,
        maxRetries: 1,
        events,
        // Three authored tasks leave no default 25% growth room for one rework task.
        config: { ...ROUTING_CONFIG, prd_audit: { max_appended_ratio: 1 } } as never,
        fullSuiteVerifier: PASSING_FULL_SUITE_VERIFIER,
        childRegionLifecycle: { enterHostRegion: (input) => enterRoutedHostForTest(input) as never },
        stepRunner: {
          // The NC.4 refusal has no owning plan task; the residue judge
          // places its rework on child 1.
          dispatchResidueRoutingJudgement: async (prompt) => {
            const itemId = (JSON.parse(prompt.split('\n\n').at(-1)!) as { items: Array<{ itemId: string }> }).items[0]!
              .itemId;
            return {
              success: true,
              output: JSON.stringify({
                version: 'v2',
                items: [{ itemId, child: 1, candidates: [1], rationale: 'The refused command lives in child 1.' }],
              }),
            };
          },
          run: async (step, _state, options) => {
            if (step === 'prd_audit') {
              await persistPrdAuditVerdict(
                worktree,
                {
                  complete: true,
                  judgment: {
                    version: 'v1',
                    criterionJudgments: [],
                    noOwnerObservations: [
                      {
                        presentationOrdinal: 'NC.4',
                        grade: 'OVER_SCOPE',
                        evidence: NC4_SUMMARY,
                        rationale: 'The diff adds visible behavior outside the approved plan.',
                        intentRelation: 'outside-visible',
                      },
                    ],
                  },
                  diagnostics: [],
                  recordedDispositions: [],
                },
                { attemptId: options?.runId ?? 'nc4-audit', codeStamp: null },
              );
              return { success: true };
            } else if (step === 'remediate' && options?.remediationRequest?.mode === 'gap-plan') {
              await persistFixtureProjectedRemediationPlan(worktree, options, [
                {
                  id: `refusal-${refusal.decisionId}`,
                  disposition: 'build',
                  category: null,
                  rationale: 'Remove the refused NC.4 behavior.',
                  tasks: [{ id: 'remove-refused-nc4', title: 'Remove the refused NC.4 behavior' }],
                },
              ]);
              return { success: true };
            } else if (step === 'remediate') {
              // PRD-widening reconciliation: today's NC.4 is the refused case.
              return {
                success: true,
                finalStructuredResult: {
                  version: 'v1',
                  results: [
                    {
                      sourceId: refusal.sourceId,
                      kind: 'same-case',
                      caseId: refusal.offer.originalCaseId,
                      reason: 'The current report names the refused NC.4 behavior.',
                    },
                  ],
                },
              };
            } else if (step === 'build') {
              return { success: false, error: 'sentinel: stop at the r3 BUILD dispatch' };
            }
            return { success: true };
          },
        },
        sleepFn: async () => {},
      }).run();
    } finally {
      persister.stop();
    }

    const spine = await persistedEvents(worktree);
    const indexOf = (predicate: (event: (typeof spine)[number]) => boolean) => spine.findIndex(predicate);
    const firstPrdAudit = indexOf((event) => event.type === 'step_started' && event.step === 'prd_audit');
    const hostTwoBuild = indexOf(
      (event) => event.type === 'step_started' && event.step === 'build' && event.child === 2,
    );
    const restacked = (host: number) =>
      indexOf(
        (event) =>
          event.type === 'routed_repair_phase' &&
          event.roundId === 'r2' &&
          event.host === host &&
          event.phase === 'restacked',
      );
    expect(hostTwoBuild).toBeGreaterThanOrEqual(0);
    expect(restacked(1)).toBeGreaterThanOrEqual(0);
    expect(restacked(2)).toBeGreaterThan(hostTwoBuild);
    expect(firstPrdAudit).toBeGreaterThan(restacked(2));
    expect(
      spine.slice(0, firstPrdAudit).filter((event) => event.type === 'step_started' && event.step === 'prd_audit'),
    ).toEqual([]);
    expect(r2AtFirstPrdAudit).toMatchObject({
      kind: 'record',
      record: { phase: 'closed', hosts: { 1: 'restacked', 2: 'restacked' } },
    });

    const r3 = await readRouteRecord(worktree, 'demo', nc4.r3);
    if (r3.kind !== 'record') throw new Error(`r3 was not admitted: ${r3.kind}`);
    expect(r3.record.kind).toBe('audit');
    const reworkTask = `rem-prd-audit-refusal-${refusal.decisionId}`;
    expect(r3.record.items.map((item) => item.findingId)).toEqual([`refusal-${refusal.decisionId}`]);
    expect(Object.values(r3.record.allocation).flatMap((allocation) => allocation.remTaskIds)).toEqual([reworkTask]);
    const firstHost = Math.min(...Object.keys(r3.record.hosts).map(Number));
    const admitted = indexOf(
      (event) => event.type === 'routed_repair_phase' && event.roundId === 'r3' && event.phase === 'admitted',
    );
    expect(admitted).toBeGreaterThan(firstPrdAudit);
    expect(spine.slice(admitted + 1).find((event) => event.type === 'step_started')).toMatchObject({
      step: 'build',
      child: firstHost,
    });

    const halts = [
      await readFile(join(worktree, '.pipeline', 'HALT'), 'utf8').catch(() => ''),
      ...spine.filter((event) => event.type === 'loop_halt').map((event) => String(event.reason)),
    ];
    for (const halt of halts) {
      expect(halt).not.toContain('cannot admit');
      expect(halt).not.toContain('Remediation planner fault');
    }
  }, 60_000);
});
