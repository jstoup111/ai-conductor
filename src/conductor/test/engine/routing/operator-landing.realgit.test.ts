// Covers: task:20
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId, pipelinePathFor } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from '../slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const c1 = parseChildId(1)!;
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
});
