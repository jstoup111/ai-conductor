// Covers: task:20
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId, pipelinePathFor } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { consumeLowestQueued } from '../../../src/engine/routing/revalidation-queue.js';
import { createRouteRecord, readRevalidationQueue, readRouteRecord, transitionHost, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { requestRoutedExit } from '../../../src/engine/routing/routed-exit.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';
import { createSweepRepository, sealStack, type SweepRepository } from '../restack/restack-sweepG2-fixture.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const envelopeFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8')),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(options: { noOwnedCriteria?: boolean } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'operator-landing-'));
  roots.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string, contents: string) => {
    await writeFile(join(repo, path), contents);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'operator-landing@example.test']);
  await git(['config', 'user.name', 'Operator landing']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-qm', 'ignore pipeline']);
  await commit('base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closure = await commit('closed child', 'child.txt', 'child\n');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
  const landing = await commit('reviewer landing', 'review.txt', 'landing\n');
  await git(['checkout', '-qb', 'feat/daemon-demo', closure]);
  await commit('leaf', 'leaf.txt', 'leaf\n');
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure stack routing']);
  const leaf = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'operator-landing', status: 'done', entries: [],
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['child', 'leaf'] },
    storyOwnership: options.noOwnedCriteria ? { S1: 2 } : { S1: 1 },
  }, envelopeFilesystem);
  const created = await createRouteRecord(repo, 'demo', {
    roundId, sealedAuthored: 1, kind: 'operator', items: [],
    allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
    operator: {
      origin: 'land', reason: 'reviewer landing', operator: 'operator@example.test', entryStep: 'acceptance_specs',
      carried: [], otherTips: { 'feat/daemon-demo': leaf as never },
      priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
      declaration: { tip: landing as never, at: '2026-10-26T00:00:00.000Z' },
    },
  });
  if (created.kind !== 'created') throw new Error(created.kind);
  const admitted = await admitRound(repo, 'demo', created.record, c1);
  if (admitted.kind !== 'admitted') throw new Error(admitted.detail);
  const rootStatePath = join(repo, '.pipeline', 'conduct-state.json');
  await writeState(rootStatePath, {
    ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
    feature_desc: 'demo', complexity_tier: 'M',
  } as ConductState);
  await writeState(pipelinePathFor(repo, 'conduct-state.json', c1), {
    feature_desc: 'demo', acceptance_specs: 'pending', build: 'done', test_suite: 'pending', build_review: 'pending', last_step: 'build_review',
  });
  return { repo, rootStatePath, landing };
}

async function runLanding(subject: Awaited<ReturnType<typeof fixture>>, options: { routed?: boolean } = {}) {
  const dispatched: StepName[] = [];
  const started: StepName[] = [];
  const events = new ConductorEventEmitter();
  events.on('step_started', (event) => { started.push(event.step); });
  const ensure = vi.fn(async () => ({ status: 'REUSED' as const, evidence: {} as never }));
  const conductor = new Conductor({
    projectRoot: subject.repo, stateFilePath: subject.rootStatePath, featureSlug: 'demo', resume: true,
    mode: 'auto', daemon: true, verifyArtifacts: false, maxRetries: 1,
    config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
    events,
    fullSuiteVerifier: { ensure, inspect: async () => ({ status: 'CURRENT' as const, evidence: {} as never }) },
    stepRunner: {
      run: async (step) => {
        dispatched.push(step);
        return step === 'build_review' ? { success: false, operatorParkedBeforeDispatch: true } : { success: true };
      },
    },
    childRegionLifecycle: {
      resolveActiveChild: async () => ({
        kind: 'active', child: c1, position: c1, isLeaf: false, branch: 'feat/c1/demo',
        ...(options.routed === false ? {} : { routedRepair: { child: c1, roundId } }),
      }),
      enterHostRegion: async () => ({ kind: 'resume', pinnedBase: subject.landing as never }) as never,
      enterChildRegion: async () => ({ kind: 'completed' }),
    },
  });
  await conductor.run();
  return { dispatched, started, ensure };
}

async function sealedExitFixture(): Promise<SweepRepository & { readonly closure: string; readonly landing: string }> {
  const subject = await createSweepRepository('operator-landing-exit-', roots);
  await subject.write('.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  max_slices: 2\n  route_whole_feature_fixes: true\n');
  await subject.git(['add', '.gitignore', '.ai-conductor/config.yml']);
  await subject.git(['commit', '-qm', 'configure routing']);
  await subject.commit('base', 'base.txt', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const closure = await subject.commit('closed child one', 'one.txt', 'one\n');
  await subject.git(['update-ref', closureRefFor('demo', c1), closure]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo', closure]);
  const closedTwo = await subject.commit('closed child two', 'two.txt', 'two\n');
  await subject.git(['update-ref', closureRefFor('demo', c2), closedTwo]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('leaf', 'leaf.txt', 'leaf\n');
  await subject.git(['checkout', '-q', 'feat/c1/demo']);
  const landing = await subject.commit('reviewer landing', 'review.txt', 'landing\n');
  await sealStack(subject.repo, [1, 2]);
  const git = makeGitRunner(subject.repo);
  const tree = (await git(['rev-parse', `${closure}^{tree}`])).stdout.trim() as never;
  const leaf = (await git(['rev-parse', 'feat/daemon-demo'])).stdout.trim() as never;
  const record: RouteRecord = {
    roundId, kind: 'operator', phase: 'open', items: [], allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
    hosts: { [c1]: 'repairing' }, currentHostIndex: 0, receipt: emptyUnsettledReceipt(), outbox: [],
    entry: { host: c1, pinnedBase: closure, tree },
    operator: {
      origin: 'land', reason: 'reviewer landing', operator: 'operator@example.test', entryStep: 'acceptance_specs',
      carried: [], otherTips: { 'feat/c2/demo': closedTwo, 'feat/daemon-demo': leaf },
      priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
      declaration: { tip: landing, at: '2026-10-26T00:00:00.000Z' },
    },
  };
  const created = await createRouteRecord(subject.repo, 'demo', {
    roundId, kind: 'operator', items: [], allocation: record.allocation, operator: record.operator!,
  }, { git });
  if (created.kind !== 'created') throw new Error(created.kind);
  const admitted = await admitRound(subject.repo, 'demo', created.record, c1, { git });
  if (admitted.kind !== 'admitted') throw new Error(admitted.detail);
  const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git });
  if (stored.kind !== 'record') throw new Error('missing route');
  const repairing = transitionHost(stored, c1, 'repairing', { credit: true });
  if (repairing.kind !== 'updated') throw new Error('cannot repair operator host');
  const wrote = await writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: { ...repairing.record, entry: record.entry } }], { git });
  if (wrote.kind !== 'updated') throw new Error('cannot stage route');
  return { ...subject, closure, landing };
}

describe('operator landing host entry (real local Git)', () => {
  it('runs the landed host from acceptance verification through test_suite and build_review without dispatching build', async () => {
    const result = await runLanding(await fixture());
    expect(result.dispatched.slice(0, 2)).toEqual(['acceptance_specs', 'build_review']);
    expect(result.ensure).toHaveBeenCalledTimes(1);
    expect(result.started.filter((step) => ['acceptance_specs', 'build', 'test_suite', 'build_review'].includes(step)))
      .toEqual(['acceptance_specs', 'test_suite', 'build_review']);
    expect(result.dispatched).not.toContain('build');
  });

  it('settles an unowned acceptance scope vacuously before running test_suite', async () => {
    const result = await runLanding(await fixture({ noOwnedCriteria: true }), { routed: false });
    expect(result.dispatched).not.toContain('acceptance_specs');
    expect(result.started).toContain('test_suite');
    expect(result.ensure).toHaveBeenCalledTimes(1);
  });

  it('restacks the landed host and admits child 2 from the revalidation queue', async () => {
    const subject = await sealedExitFixture();
    const git = makeGitRunner(subject.repo);
    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host: c1, git }))
      .resolves.toEqual({ kind: 'restacked' });
    await expect(readRevalidationQueue(subject.repo, 'demo', { git })).resolves.toMatchObject({
      kind: 'queue', queue: { entries: [expect.objectContaining({ child: c2 })] },
    });
    await expect(consumeLowestQueued(subject.repo, 'demo', { git })).resolves.toMatchObject({ kind: 'admitted', host: c2 });
    await expect(readRouteRecord(subject.repo, 'demo', parseRoundId('r2')!, { git })).resolves.toMatchObject({
      kind: 'record', record: { kind: 'revalidate', hosts: { 2: 'admitted' } },
    });
  });
});
