// Covers: task:16, task:50, task:56
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { enterHostRegion } from '../../../src/engine/routing/host-region-entry.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, readRouteRecord, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { type RouteRecord, parseRoundId } from '../../../src/engine/routing/route-types.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const child = parseChildId(1)!;
const leaf = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'no-op-guard-placement-'));
  roots.push(root);
  const childDir = join(root, '.pipeline', 'children', String(child));
  await mkdir(childDir, { recursive: true });
  const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ ...parentState, feature_desc: 'demo' }));
  await writeFile(join(childDir, 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'pending', test_suite: 'skipped', build_review: 'skipped',
  }));
  return root;
}

async function operatorRoundFixture(declared: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'operator-round-entry-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'operator-round@example.test']);
  await git(['config', 'user.name', 'Operator round']);
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'demo.md'), '### Task T1: Existing work\n');
  await git(['add', '.gitignore', '.docs/plans/demo.md']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'child.txt'), 'closed child\n');
  await git(['add', 'child.txt']);
  await git(['commit', '-qm', 'closed child']);
  const closure = parseCommitSha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  if (!closure) throw new Error('invalid child closure');
  await git(['update-ref', closureRefFor('demo', child), closure]);
  await git(['checkout', '-qb', leafBranchFor('demo')]);
  await writeFile(join(root, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await mkdir(join(root, '.pipeline', 'children', String(child)), { recursive: true });
  const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ ...parentState, feature_desc: 'demo' }));
  await writeFile(join(root, '.pipeline', 'children', String(child), 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'pending', test_suite: 'skipped', build_review: 'skipped',
  }));
  const created = await createRouteRecord(root, 'demo', {
    roundId, sealedAuthored: 1, kind: 'audit',
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: { [child]: { remTaskIds: ['rem-task-1'], blockBodies: ['### Task rem-task-1: Repair\n'] } },
  });
  if (created.kind !== 'created') throw new Error(`create route record: ${created.kind}`);
  const admitted = await admitRound(root, 'demo', created.record, child, { git });
  if (admitted.kind !== 'admitted') throw new Error(`admit route record: ${admitted.detail}`);
  const stored = await readRouteRecord(root, 'demo', roundId, { git });
  if (stored.kind !== 'record') throw new Error('missing admitted route record');
  const leafTip = parseCommitSha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  if (!leafTip) throw new Error('invalid leaf tip');
  const operator: RouteRecord = {
    ...stored.record,
    kind: 'operator',
    operator: {
      origin: 'land', reason: 'reviewer request', operator: 'operator@example.test', entryStep: 'build',
      carried: [], otherTips: { 'feat/daemon-demo': leafTip },
      priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
      ...(declared ? { declaration: { tip: leafTip, at: '2026-10-25T00:00:00.000Z' } } : {}),
    },
  };
  await expect(writeRoutingTransaction(root, 'demo', [{ kind: 'update-record', previous: stored, record: operator }]))
    .resolves.toEqual({ kind: 'updated' });
  return root;
}

function routedConductor(
  root: string,
  enterHostRegion: NonNullable<ConstructorParameters<typeof Conductor>[0]['childRegionLifecycle']>['enterHostRegion'],
  childEntry: () => Promise<unknown> = async () => ({ kind: 'completed' as const }),
) {
  const runner = { run: vi.fn(async () => ({ success: true })) };
  const enterChildRegion = vi.fn(childEntry as () => Promise<never>);
  const conductor = new Conductor({
    projectRoot: root,
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    featureSlug: 'demo',
    fromStep: 'build',
    verifyArtifacts: false,
    events: new ConductorEventEmitter(),
    stepRunner: runner,
    config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
    childRegionLifecycle: {
      resolveActiveChild: async () => ({
        kind: 'repair-pending' as const, child: leaf, position: leaf, isLeaf: true,
        branch: 'feat/daemon-demo', repairChildren: [child], routedRepair: { child, roundId },
      }),
      enterHostRegion,
      enterChildRegion,
    },
  });
  return { conductor, runner, enterChildRegion };
}

describe('routed host no-op guard placement', () => {
  it('writes the derived-already-complete outcome through the halt marker without treating it as a child refusal', async () => {
    const root = await fixture();
    const { conductor, runner, enterChildRegion } = routedConductor(
      root,
      async () => ({ kind: 'derived-already-complete', detail: 'every routed task is already evidence-complete' }) as never,
    );

    await conductor.run();

    expect(runner.run).not.toHaveBeenCalled();
    expect(enterChildRegion).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      'routed host 1 entry derived already complete: every routed task is already evidence-complete\n' +
      'Outcome: derived-already-complete\n',
    );
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('keeps ordinary host-entry halts on the child-refusal path', async () => {
    const root = await fixture();
    const { conductor, runner, enterChildRegion } = routedConductor(
      root,
      async () => ({ kind: 'halted', detail: 'frozen block rem-prd-audit-T1 conflicts' }) as never,
    );

    await conductor.run();

    expect(runner.run).not.toHaveBeenCalled();
    expect(enterChildRegion).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      'child BUILD region refused: routed host 1 entry halted: frozen block rem-prd-audit-T1 conflicts\n',
    );
  });

  // Covers: task:16
  it('halts needs-human without a provider dispatch when real operator round entry is undeclared', async () => {
    const root = await operatorRoundFixture(false);
    const { conductor, runner, enterChildRegion } = routedConductor(
      root,
      (input) => enterHostRegion({ ...input, planPath: '.docs/plans/demo.md' }),
      // If the real task-16 check regresses, fail at the immediate child
      // lifecycle boundary rather than letting this bounded fixture advance.
      async () => ({ kind: 'refused', reason: 'stop after host entry' }),
    );

    await conductor.run();

    expect(runner.run).not.toHaveBeenCalled();
    expect(enterChildRegion).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
      'child BUILD region refused: routed host 1 entry refused: ' +
      'operator-round-undeclared: landing r1 on child 1 is awaiting ai-conductor stack land --done or ai-conductor stack land --abandon\n',
    );
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('enters a declared operator round through the real host-region check', async () => {
    const root = await operatorRoundFixture(true);
    const entered = await enterHostRegion({
      worktree: root, slug: 'demo', roundId, host: child,
      emitter: new ConductorEventEmitter(), planPath: '.docs/plans/demo.md',
    });

    expect(entered).toMatchObject({ kind: 'entered' });
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
