// Covers: task:3, task:6, task:7, task:8, task:9, task:10, task:67, task:rem-prd-audit-W7
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routedExit: undefined as undefined | ((...args: readonly unknown[]) => Promise<unknown>),
  consumeQueued: undefined as undefined | (() => Promise<unknown>),
  queueAdmission: undefined as undefined | ((...args: readonly unknown[]) => Promise<unknown>),
}));

vi.mock('../../../src/engine/routing/round-admission.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/round-admission.js')>();
  return {
    ...actual,
    exitRoutedHostAndReconcile: (...args: Parameters<typeof actual.exitRoutedHostAndReconcile>) =>
      mocks.routedExit === undefined ? actual.exitRoutedHostAndReconcile(...args) : mocks.routedExit(...args),
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

import { parseChildId, pipelinePathFor } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRepairMarker, readRouteRecord, transitionHost, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { advanceRound } from '../../../src/engine/routing/routed-exit.js';
import { readState, writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  mocks.routedExit = undefined;
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
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
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
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure stack routing']);
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'routing-resume', status: 'done', entries: [],
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['child', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  return { repo, git };
}

describe('routed round conductor resume', () => {
  it('keeps the reconciliation refusal detail when a routed exit cannot reconcile', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const state: ConductState = {
      feature_desc: 'demo', complexity_tier: 'M',
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const, child: parseChildId(2)!, position: parseChildId(2)!, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [host], routedRepair: { child: host, roundId },
    };
    mocks.routedExit = async () => ({ kind: 'exited', next: { kind: 'unavailable', detail: 'r1 route record is unreadable' } });
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', resume: true, verifyArtifacts: false,
      events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    });
    const resumed = conductor as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (candidate: ConductState, indexOf: (step: StepName) => number, requireSatisfiedRegion?: boolean) => Promise<unknown>;
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
      feature_desc: 'demo', complexity_tier: 'M',
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const, child: parseChildId(2)!, position: parseChildId(2)!, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [host], routedRepair: { child: host, roundId },
    };
    mocks.routedExit = async () => ({ kind: 'exited', next: { kind: 'none' } });
    mocks.queueAdmission = async () => ({ kind: 'unavailable', detail: 'cannot consume routed revalidation queue' });
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', resume: true, verifyArtifacts: false,
      events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    });
    const resumed = conductor as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (candidate: ConductState, indexOf: (step: StepName) => number, requireSatisfiedRegion?: boolean) => Promise<unknown>;
    };
    resumed.activeRegionChild = host;

    await expect(resumed.continueRoutedHostExit(state, () => 0, true)).resolves.toBe('halt');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8'))
      .resolves.toContain('child BUILD region refused: cannot consume routed revalidation queue');
  });

  it('consumes queued revalidation before selecting the next region after a resumed routed exit', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const queued = parseChildId(2)!;
    const roundId = parseRoundId('r1')!;
    const state: ConductState = {
      feature_desc: 'demo', complexity_tier: 'M',
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    };
    const order: string[] = [];
    const routed = {
      kind: 'repair-pending' as const, child: queued, position: queued, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [host], routedRepair: { child: host, roundId },
    };
    const revalidating = {
      kind: 'repair-pending' as const, child: queued, position: queued, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [host], revalidating: { child: queued, generation: 1 },
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
      featureSlug: 'demo', resume: true, verifyArtifacts: false,
      events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() },
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
      continueRoutedHostExit: (candidate: ConductState, indexOf: (step: StepName) => number, requireSatisfiedRegion?: boolean) => Promise<unknown>;
    };
    resumed.activeRegionChild = host;

    const result = await resumed.continueRoutedHostExit(state, (step) => ALL_STEPS.findIndex((candidate) => candidate.name === step), true);

    expect(order).toEqual(['resolve-host', 'exit', 'consume', 'resolve-next']);
    expect(result).toMatchObject({ index: ALL_STEPS.findIndex((step) => step.name === 'acceptance_specs'), activeChild: { child: queued } });
  });

  // Covers: task:3
  it('restores whole-feature state and resumes manual test after a leaf return with no queued admission', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    const wholeFeatureState: ConductState = {
      feature_desc: 'demo', complexity_tier: 'M',
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', manual_test: 'pending',
    };
    await writeState(statePath, wholeFeatureState);
    const childState: ConductState = {
      ...wholeFeatureState,
      manual_test: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const, child: host, position: host, isLeaf: true,
      branch: 'feat/c1/demo', repairChildren: [host], routedRepair: { child: host, roundId },
    };
    const admission = vi.fn(async () => ({ kind: 'none' as const }));
    mocks.routedExit = async () => ({ kind: 'exited', next: { kind: 'leaf-returned' as const, roundId } });
    mocks.queueAdmission = admission;
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo', resume: true, verifyArtifacts: false,
      events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    }) as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (candidate: ConductState, indexOf: (step: StepName) => number, requireSatisfiedRegion?: boolean) => Promise<unknown>;
    };
    conductor.activeRegionChild = host;

    await expect(conductor.continueRoutedHostExit(childState, (step) => ALL_STEPS.findIndex((candidate) => candidate.name === step), true))
      .resolves.toEqual({ index: ALL_STEPS.findIndex((step) => step.name === 'manual_test') });

    expect(admission).toHaveBeenCalledOnce();
    expect(admission).toHaveBeenCalledWith(expect.objectContaining({ reconciled: { kind: 'leaf-returned', roundId } }));
    expect(childState).toEqual(wholeFeatureState);
  });

  it('surfaces a remediation PR when a resumed routed exit halts', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r1')!;
    const state: ConductState = {
      feature_desc: 'demo', complexity_tier: 'M',
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    };
    const routed = {
      kind: 'repair-pending' as const, child: parseChildId(2)!, position: parseChildId(2)!, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [host], routedRepair: { child: host, roundId },
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
      featureSlug: 'demo', resume: true, daemon: true, verifyArtifacts: false,
      events, stepRunner: { run: vi.fn() },
      escalateBuildFailure: async () => ({ prUrl: 'https://example.test/remediation/123' }),
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    });
    const resumed = conductor as unknown as {
      activeRegionChild: typeof host;
      continueRoutedHostExit: (candidate: ConductState, indexOf: (step: StepName) => number, requireSatisfiedRegion?: boolean) => Promise<unknown>;
    };
    resumed.activeRegionChild = host;

    await expect(resumed.continueRoutedHostExit(state, () => 0, true)).resolves.toBe('halt');
    expect(loopHalts).toEqual([{ reason: 'routed exit needs remediation', prUrl: 'https://example.test/remediation/123' }]);
  });

  // Covers: task:8
  it('keeps a restack-reported routed-exit halt and does not admit the queue', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r4')!;
    const state: ConductState = { feature_desc: 'demo', complexity_tier: 'M', acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' };
    const routed = { kind: 'repair-pending' as const, child: host, position: host, isLeaf: true, branch: 'feat/c1/demo', repairChildren: [host], routedRepair: { child: host, roundId } };
    mocks.routedExit = async () => ({ kind: 'exit-halted', detail: 'routed exit host 1: base-refresh restack halted' });
    const admission = vi.fn(async () => ({ kind: 'none' as const }));
    mocks.queueAdmission = admission;
    const conductor = new Conductor({
      projectRoot: subject.repo, stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'), featureSlug: 'demo', resume: true, verifyArtifacts: false,
      events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() }, childRegionLifecycle: { resolveActiveChild: async () => routed },
    }) as unknown as { activeRegionChild: typeof host; continueRoutedHostExit: (candidate: ConductState, indexOf: (step: StepName) => number, requireSatisfiedRegion?: boolean) => Promise<unknown> };
    conductor.activeRegionChild = host;

    await expect(conductor.continueRoutedHostExit(state, () => 0, true)).resolves.toBe('halt');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('routed exit host 1: base-refresh restack halted');
    expect(admission).not.toHaveBeenCalled();
  });

  it('does not halt or fabricate receipt accounting when a routing-eligible resume has no route records', async () => {
    const subject = await fixture();
    await expect(subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']))
      .resolves.toMatchObject({ stdout: '' });
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
    await expect(subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']))
      .resolves.toMatchObject({ stdout: '' });
    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(subject.repo, '.pipeline', 'HALT.class'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(subject.repo, '.pipeline', 'kickback-ledger.json'))).rejects.toMatchObject({ code: 'ENOENT' });
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
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
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
    await expect(readState(pipelinePathFor(subject.repo, 'conduct-state.json', parseChildId(2)!)))
      .resolves.toMatchObject({ ok: true, value: { build: 'pending' } });
    const refs = (await subject.git(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/'])).stdout.split('\n').filter(Boolean);
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
      items: [{ findingId: 'rem-1', kind: 'audit', owner: host, host, reason: 'task-bound', existingTask: true, taskIds: ['rem-1'], restage: false, fallback: [] }],
      allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, host)).resolves.toMatchObject({ kind: 'admitted' });
    const routed = {
      kind: 'repair-pending' as const, child: host, position: host, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [host], routedRepair: { child: host, roundId },
    };
    const runner = vi.fn(async () => ({ success: true }));
    const conductor = new Conductor({
      projectRoot: subject.repo, stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', verifyArtifacts: false, events: new ConductorEventEmitter(), stepRunner: { run: runner },
      childRegionLifecycle: {
        resolveActiveChild: async () => routed,
        enterHostRegion: async () => ({ kind: 'derived-already-complete', detail: 'every routed task is already evidence-complete' }) as never,
      },
    }) as unknown as {
      enterRoutedHostRegion: (execution: unknown, slug: string, state: ConductState, cursor: unknown) => Promise<unknown>;
    };

    await expect(conductor.enterRoutedHostRegion(
      { source: 'routed-host', target: { child: host, isLeaf: true }, roundId }, 'demo', { feature_desc: 'demo' }, routed,
    )).resolves.toBe(false);
    expect(runner).not.toHaveBeenCalled();
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/Outcome: derived-already-complete\n$/);
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
    await expect(writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: admitted, record: repairing.record }]))
      .resolves.toMatchObject({ kind: 'updated' });

    const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
    await writeState(statePath, doneThrough('prd_audit'));
    await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', host), {
      feature_desc: 'demo', complexity_tier: 'M', acceptance_specs: 'done', build: 'pending',
    });
    const dispatched: Array<{ step: StepName; retryReason: string | undefined }> = [];
    const routed = {
      kind: 'repair-pending' as const, child: host, position: host, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [host], routedRepair: { child: host, roundId },
    };
    const conductor = new Conductor({
      projectRoot: subject.repo, stateFilePath: statePath, featureSlug: 'demo', resume: true, verifyArtifacts: false,
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
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.not.toContain('derived-already-complete');
  });

  // Covers: task:6, task:rem-prd-audit-S1.4
  it('heals the #3455 markerless needs-human halt without editing stale verdicts, preserving region dispatch order', async () => {
    const subject = await fixture();
    const host = parseChildId(1)!;
    const roundId = parseRoundId('r5')!;
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId, sealedAuthored: 0, kind: 'audit', items: [],
      allocation: { [host]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(created.kind);
    await expect(admitRound(subject.repo, 'demo', created.record, host)).resolves.toMatchObject({ kind: 'admitted' });
    const admitted = await readRouteRecord(subject.repo, 'demo', roundId);
    if (admitted.kind !== 'record') throw new Error('missing r5 record');
    const repairing = transitionHost(admitted, host, 'repairing', { credit: true });
    if (repairing.kind !== 'updated') throw new Error('could not enter repairing');
    await expect(writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: admitted, record: repairing.record }]))
      .resolves.toMatchObject({ kind: 'updated' });

    const childStatePath = pipelinePathFor(subject.repo, 'conduct-state.json', host);
    await writeState(childStatePath, {
      acceptance_specs: 'pending', build: 'in_progress', test_suite: 'pending', build_review: 'in_progress',
    });
    const gates = join(subject.repo, '.pipeline', 'children', '1', 'gates');
    await mkdir(gates, { recursive: true });
    await Promise.all(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
      writeFile(join(gates, `${step}.json`), JSON.stringify({ satisfied: true, checkedAt: 1 }))));
    const before = await Promise.all(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) => readFile(join(gates, `${step}.json`), 'utf8')));
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'needs human\n');
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human');
    await rm(join(subject.repo, '.pipeline', 'HALT'));
    await rm(join(subject.repo, '.pipeline', 'HALT.class'));

    const state = (await readState(childStatePath));
    if (!state.ok) throw state.error;
    const conductor = new Conductor({
      projectRoot: subject.repo, stateFilePath: childStatePath, featureSlug: 'demo', resume: true, verifyArtifacts: false,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      events: new ConductorEventEmitter(), stepRunner: { run: vi.fn() },
    }) as unknown as { activeRegionChild: typeof host; readGateVerdictOverlay: () => Promise<Record<string, unknown>> };
    conductor.activeRegionChild = host;
    const overlay = await conductor.readGateVerdictOverlay();
    expect(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) => overlay[step])).toEqual([undefined, undefined, undefined, undefined]);
    expect(['acceptance_specs', 'build', 'test_suite', 'build_review'].filter((step) => ['pending', 'in_progress'].includes((state.value as Record<string, unknown>)[step] as string)))
      .toEqual(['acceptance_specs', 'build', 'test_suite', 'build_review']);
    const after = await Promise.all(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) => readFile(join(gates, `${step}.json`), 'utf8')));
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
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
      feature_desc: 'demo', complexity_tier: 'M',
    };
    await writeState(statePath, state);
    const gates = join(subject.repo, '.pipeline', 'children', '1', 'gates');
    await mkdir(gates, { recursive: true });
    await Promise.all(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
      writeFile(join(gates, `${step}.json`), JSON.stringify({ satisfied: true, routedRound: 'r5', checkedAt: 1 }))));
    const routed = {
      kind: 'repair-pending' as const, child: host, position: host, isLeaf: false,
      branch: 'feat/c1/demo', repairChildren: [host], routedRepair: { child: host, roundId },
    };
    const exits: string[] = [];
    mocks.routedExit = async () => {
      exits.push('r5');
      return { kind: 'continued', next: { kind: 'none' } };
    };
    const conductor = new Conductor({
      projectRoot: subject.repo, stateFilePath: statePath, featureSlug: 'demo', resume: true, verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    }) as unknown as { activeRegionChild: typeof host; continueRoutedHostExit: (state: ConductState, indexOf: (step: StepName) => number, requireSatisfiedRegion: boolean) => Promise<unknown> };
    conductor.activeRegionChild = host;
    await expect(conductor.continueRoutedHostExit(state, (step) => ALL_STEPS.findIndex((candidate) => candidate.name === step), true)).resolves.toBeDefined();
    expect(exits).toEqual(['r5']);
    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:9, task:rem-prd-audit-S5.2
  it('takes the same parked resume exit for a revalidate host after only its re-pended gates complete', async () => {
    const subject = await fixture();
    const host = parseChildId(2)!;
    const statePath = pipelinePathFor(subject.repo, 'conduct-state.json', host);
    const state: ConductState = {
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
      feature_desc: 'demo', complexity_tier: 'M',
    };
    await writeState(statePath, state);
    const gates = join(subject.repo, '.pipeline', 'children', '2', 'gates');
    await mkdir(gates, { recursive: true });
    await Promise.all(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
      writeFile(join(gates, `${step}.json`), JSON.stringify({ satisfied: true, routedRound: 'r6', checkedAt: 1 }))));
    // At this boundary the route resolver promotes the revalidate cursor to
    // routed-host; otherwise the parked arm must not attempt an exit.
    const routed = {
      kind: 'repair-pending' as const, child: host, position: host, isLeaf: true,
      branch: 'feat/daemon-demo', repairChildren: [host], routedRepair: { child: host, roundId: parseRoundId('r6')! },
    };
    mocks.routedExit = async () => ({ kind: 'continued', next: { kind: 'none' } });
    const conductor = new Conductor({
      projectRoot: subject.repo, stateFilePath: statePath, featureSlug: 'demo', resume: true, verifyArtifacts: false,
      events: new ConductorEventEmitter(),
      stepRunner: { run: vi.fn() },
      childRegionLifecycle: { resolveActiveChild: async () => routed },
    }) as unknown as { activeRegionChild: typeof host; continueRoutedHostExit: (state: ConductState, indexOf: (step: StepName) => number, requireSatisfiedRegion: boolean) => Promise<unknown> };
    conductor.activeRegionChild = host;
    await expect(conductor.continueRoutedHostExit(state, (step) => ALL_STEPS.findIndex((candidate) => candidate.name === step), true)).resolves.toBeDefined();
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
      feature_desc: 'demo', complexity_tier: 'M',
      acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
    });
    await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', second), {
      feature_desc: 'demo', complexity_tier: 'M', acceptance_specs: 'pending', build: 'pending', test_suite: 'pending', build_review: 'pending',
    });
    await mkdir(join(subject.repo, '.pipeline', 'children', '1', 'gates'), { recursive: true });
    await Promise.all(['acceptance_specs', 'build', 'test_suite', 'build_review'].map((step) =>
      writeFile(join(subject.repo, '.pipeline', 'children', '1', 'gates', `${step}.json`), JSON.stringify({
        satisfied: true, routedRound: 'r2', checkedAt: 1,
      }), 'utf8')));
    const created = await createRouteRecord(subject.repo, 'demo', {
      roundId, sealedAuthored: 1, kind: 'audit', items: [],
      allocation: { [first]: { remTaskIds: [], blockBodies: [] }, [second]: { remTaskIds: [], blockBodies: [] } },
    });
    if (created.kind !== 'created') throw new Error(`could not create r2: ${created.kind}`);
    await expect(admitRound(subject.repo, 'demo', created.record, first)).resolves.toMatchObject({ kind: 'admitted' });
    const admitted = await readRouteRecord(subject.repo, 'demo', roundId);
    if (admitted.kind !== 'record') throw new Error('r2 was not admitted');
    const repairing = transitionHost(admitted, first, 'repairing', { credit: true });
    if (repairing.kind !== 'updated') throw new Error('could not stage r2 host 1');
    await expect(writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: admitted, record: repairing.record }]))
      .resolves.toMatchObject({ kind: 'updated' });

    // This is deliberately not a restack test.  The exit seam advances only
    // the durable route record and marker, leaving run() bounded at child 2.
    mocks.routedExit = async (...args) => {
      const input = args[0] as { readonly worktree: string; readonly slug: string; readonly roundId: typeof roundId; readonly host: typeof first };
      const beforeExit = await readRouteRecord(input.worktree, input.slug, input.roundId);
      if (beforeExit.kind !== 'record') throw new Error('r2 missing before mocked exit');
      const built = transitionHost(beforeExit, input.host, 'built', { credit: false });
      if (built.kind !== 'updated') throw new Error('could not mark r2 host built');
      await writeRoutingTransaction(input.worktree, input.slug, [{ kind: 'update-record', previous: beforeExit, record: built.record }]);
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
      projectRoot: subject.repo, stateFilePath: statePath, featureSlug: 'demo', fromStep: 'manual_test', resume: true, verifyArtifacts: false, events,
      config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
      stepRunner: { run: async (step) => { throw new Error(`stop at child 2: ${step}`); } },
      childRegionLifecycle: {
        resolveActiveChild: async () => {
          const current = await readRepairMarker(subject.repo, 'demo');
          const child = current.kind === 'marker' ? current.marker.host : second;
          return child === first
            ? { kind: 'repair-pending' as const, child: first, position: first, isLeaf: false, branch: 'feat/c1/demo', repairChildren: [first], routedRepair: { child: first, roundId } }
            : { kind: 'repair-pending' as const, child: second, position: second, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [second], routedRepair: { child: second, roundId } };
        },
        enterHostRegion: async () => ({ kind: 'entered', pinnedBase: 'a'.repeat(40) }) as never,
        enterChildRegion: async () => ({ kind: 'completed' as const }),
      },
    });
    await conductor.run().catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.startsWith('stop at child 2:')) throw error;
    });

    expect(starts.map(({ step }) => step)).not.toEqual(expect.arrayContaining(['manual_test', 'prd_audit', 'architecture_review_as_built']));
    const record = await readRouteRecord(subject.repo, 'demo', roundId);
    const marker = await readRepairMarker(subject.repo, 'demo');
    expect(record).toMatchObject({ kind: 'record', record: { hosts: { 1: 'restacked', 2: 'admitted' } } });
    expect(marker).toMatchObject({ kind: 'marker', marker: { host: 2, roundId } });
    expect(starts).toContainEqual(expect.objectContaining({ child: 2 }));
  });
});
