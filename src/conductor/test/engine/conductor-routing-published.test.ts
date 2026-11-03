// Covers: task:19
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { pushedTipRef } from '../../src/engine/push-lease.js';
import { readPublicationRecord, writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
import { sealSliceTopologyPositions, writeSliceTopologyFixture } from './slice-topology-fixture.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';
import { persistFixtureProjectedRemediationPlan } from './remediation-plan-fixtures.js';

const roots: string[] = [];
const child = parseChildId(1)!;
const leaf = parseChildId(2)!;

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function publishedStackFixture() {
  const root = await mkdtemp(join(tmpdir(), 'conductor-routing-published-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(root, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await writeSliceTopologyFixture(root, {
    slug: 'demo', materializeTopologyCommit: true,
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['host', 'leaf'] },
  });
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await sealSliceTopologyPositions(root, {
    slug: 'demo', sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['host', 'leaf'] },
  });
  const origin = join(root, 'origin.git');
  await git(['init', '--bare', '-q', '-b', 'main', origin]);
  await git(['remote', 'add', 'origin', origin]);
  const members = [
    { position: child, branch: 'feat/c1/demo', pr: 101 },
    { position: leaf, branch: 'feat/daemon-demo', pr: 500 },
  ];
  for (const member of members) {
    await git(['push', '-q', 'origin', `${member.branch}:refs/heads/${member.branch}`]);
    const tip = (await git(['rev-parse', member.branch])).stdout.trim();
    await git(['update-ref', pushedTipRef('demo', member.branch), tip]);
  }
  const publication: PublicationRecord = { version: 1, members };
  await writePublicationRecord(root, 'demo', undefined, publication);
  return { root };
}

function conductorFor(root: string, events: ConductorEventEmitter): Conductor {
  const runner: StepRunner = {
    run: vi.fn(async () => ({ success: true })),
    dispatchResidueRoutingJudgement: vi.fn(async (prompt) => {
      const itemId = JSON.parse(prompt.split('\n\n').at(-1)!).items[0].itemId;
      return { success: true, output: JSON.stringify({
        version: 'v1', items: [{ itemId, child: 1, candidates: [1], rationale: 'host owns the fix' }],
      }) };
    }),
  };
  return new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    featureSlug: 'demo', events, stepRunner: runner,
    config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({ kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo' }) as never,
    },
  });
}

function remediationConductorFor(root: string, events: ConductorEventEmitter): Conductor {
  const runner: StepRunner = {
    run: async (_step, _state, options) => {
      await persistFixtureProjectedRemediationPlan(root, options, [{
        id: 'stall:published-fix', disposition: 'build', category: null,
        rationale: 'The published host needs the admitted repair.',
        tasks: [],
      }]);
      return { success: true };
    },
    dispatchResidueRoutingJudgement: vi.fn(async (prompt) => {
      const itemId = JSON.parse(prompt.slice(prompt.indexOf('{'))).items[0].itemId;
      return { success: true, output: JSON.stringify({
        version: 'v1', items: [{ itemId, child: 1, candidates: [1], rationale: 'host owns the repair' }],
      }) };
    }),
  };
  return new Conductor({
    projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    featureSlug: 'demo', events, stepRunner: runner,
    config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({ kind: 'active', child, position: child, isLeaf: false, branch: 'feat/c1/demo' }) as never,
    },
    daemon: true, mode: 'auto', verifyArtifacts: false, maxRetries: 1,
  });
}

describe('Conductor published-stack routing admission', () => {
  it('refuses a closed published member before taskless admission allocates a route ref', async () => {
    const { root } = await publishedStackFixture();
    const previous = await readPublicationRecord(root, 'demo');
    if (previous.kind !== 'record') throw new Error(`publication record is ${previous.kind}`);
    const updated = await writePublicationRecord(root, 'demo', previous, {
      version: 1,
      members: [
        { position: child, branch: 'feat/c1/demo', pr: 101, lastSeen: 'closed' },
        { position: leaf, branch: 'feat/daemon-demo', pr: 500 },
      ],
    });
    if (updated.kind !== 'updated') throw new Error(updated.kind);
    const conductor = conductorFor(root, new ConductorEventEmitter());

    await expect((conductor as any).admitRoutedTasklessKickback(
      { feature_desc: 'demo' },
      { findingId: () => 'manual-test-fail', reason: 'manual-test', mutateReceipt: async () => ({ kind: 'charged' }) },
    )).resolves.toMatchObject({
      kind: 'halted', reason: 'routing admission refused: published stack member 1 changed or closed (#3268)',
    });
    const refs = await makeGitRunner(root)(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']);
    expect(refs.stdout.trim()).toBe('');
  });

  it('opens an admitted whole-feature remediation round on intact published tips without a published-stack refusal', async () => {
    const { root } = await publishedStackFixture();
    const events = new ConductorEventEmitter();
    const emitted: unknown[] = [];
    events.on('restack_refused', (event) => { emitted.push(event); });
    const conductor = remediationConductorFor(root, events);

    const outcome = await (conductor as any).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'demo' } as ConductState,
      ALL_STEPS,
      'whole feature audit admitted repair',
      { source: 'build_stall', evidence: [{ gate: 'build', evidenceFile: '.pipeline/build-stall-question.md' }] },
    );
    expect(outcome, JSON.stringify(outcome)).toMatchObject({ kind: 'route', target: 'build' });
    expect(emitted).not.toContainEqual(expect.objectContaining({ reason: 'published-stack' }));
    const refs = await makeGitRunner(root)(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']);
    expect(refs.stdout).toContain('refs/conductor/demo/routes/r1');
  });

  it('admits a taskless routed kickback on intact published tips without a published-stack refusal', async () => {
    const { root } = await publishedStackFixture();
    const events = new ConductorEventEmitter();
    const emitted: unknown[] = [];
    events.on('restack_refused', (event) => { emitted.push(event); });
    const conductor = conductorFor(root, events);

    await expect((conductor as any).admitRoutedTasklessKickback(
      { feature_desc: 'demo' },
      { findingId: () => 'manual-test-fail', reason: 'manual-test', mutateReceipt: async () => ({ kind: 'charged' }) },
    )).resolves.toEqual({ kind: 'admitted' });
    expect(emitted).not.toContainEqual(expect.objectContaining({ reason: 'published-stack' }));
    const refs = await makeGitRunner(root)(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']);
    expect(refs.stdout).toContain('refs/conductor/demo/routes/r1');
  });
});
