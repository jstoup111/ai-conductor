// Covers: task:4, task:16, task:50, task:56
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { resolveActiveChild, type ActiveChildResolution } from '../../../src/engine/child-cursor.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { resolveExecutionChild, type ExecutionChildResolution } from '../../../src/engine/routing/execution-child.js';
import { enterHostRegion } from '../../../src/engine/routing/host-region-entry.js';
import { admitRound } from '../../../src/engine/routing/round-admission.js';
import { settleDerivedNoOpHost } from '../../../src/engine/routing/routed-exit.js';
import { createRouteRecord, drainOutbox, readRepairMarker, readRouteRecord, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor } from '../../../src/engine/routing/routing-refs.js';
import { dispatchStackRoundsCommand } from '../../../src/engine/stack-rounds-cli.js';
import { resolveHaltRetention } from '../../../src/engine/daemon-rekick.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { type RouteRecord, parseRoundId } from '../../../src/engine/routing/route-types.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { sealStack } from '../restack/restack-sweepG2-fixture.js';

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
  await sealStack(root, [1, 2]);
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

/** A sealed three-child stack with an audit round admitted at child one. */
async function threeHostRoundFixture() {
  const root = await mkdtemp(join(tmpdir(), 'no-op-guard-three-host-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'no-op-guard@example.test']);
  await git(['config', 'user.name', 'No-op guard']);
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'demo.md'), '### Task rem-task-1: Repair\n');
  await git(['add', '.gitignore', '.ai-conductor/config.yml', '.docs/plans/demo.md']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'child-1.txt'), 'closed child one\n');
  await git(['add', 'child-1.txt']);
  await git(['commit', '-qm', 'closed child one']);
  const closedOne = parseCommitSha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  if (!closedOne) throw new Error('invalid child one closure');
  await git(['update-ref', closureRefFor('demo', child), closedOne]);
  await git(['checkout', '-qb', 'feat/c2/demo']);
  await writeFile(join(root, 'child-2.txt'), 'closed child two\n');
  await git(['add', 'child-2.txt']);
  await git(['commit', '-qm', 'closed child two']);
  const closedTwo = parseCommitSha((await git(['rev-parse', 'HEAD'])).stdout.trim());
  if (!closedTwo) throw new Error('invalid child two closure');
  await git(['update-ref', closureRefFor('demo', parseChildId(2)!), closedTwo]);
  await git(['checkout', '-qb', leafBranchFor('demo')]);
  await writeFile(join(root, 'leaf.txt'), 'leaf\n');
  await git(['add', 'leaf.txt']);
  await git(['commit', '-qm', 'leaf']);
  await sealStack(root, [1, 2, 3]);
  await mkdir(join(root, '.pipeline', 'children', String(child)), { recursive: true });
  const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done']));
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({ ...parentState, feature_desc: 'demo' }));
  await writeFile(join(root, '.pipeline', 'children', String(child), 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'pending', test_suite: 'skipped', build_review: 'skipped',
  }));
  const created = await createRouteRecord(root, 'demo', {
    roundId, sealedAuthored: 1, kind: 'audit',
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: {
      [child]: { remTaskIds: ['rem-task-1'], blockBodies: ['### Task rem-task-1: Repair\n'] },
      [parseChildId(2)!]: { remTaskIds: [], blockBodies: [] },
      [parseChildId(3)!]: { remTaskIds: [], blockBodies: [] },
    },
  });
  if (created.kind !== 'created') throw new Error(`create route record: ${created.kind}`);
  const admitted = await admitRound(root, 'demo', created.record, child, { git });
  if (admitted.kind !== 'admitted') throw new Error(`admit route record: ${admitted.detail}`);
  const stored = await readRouteRecord(root, 'demo', roundId, { git });
  if (stored.kind !== 'record') throw new Error('missing admitted route record');
  const entryTree = (await git(['rev-parse', `${closedOne}^{tree}`])).stdout.trim();
  await expect(writeRoutingTransaction(root, 'demo', [{
    kind: 'update-record', previous: stored, record: {
      ...stored.record,
      entry: { host: child, pinnedBase: closedOne, tree: entryTree as never },
    },
  }], { git })).resolves.toEqual({ kind: 'updated' });
  await git(['checkout', '-q', 'feat/c1/demo']);
  return { root, git, closedOne, closedTwo };
}

function routedConductor(
  root: string,
  enterHostRegion: NonNullable<ConstructorParameters<typeof Conductor>[0]['childRegionLifecycle']>['enterHostRegion'],
  childEntry: NonNullable<ConstructorParameters<typeof Conductor>[0]['childRegionLifecycle']>['enterChildRegion'] =
    async () => ({ kind: 'completed' as const }),
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
  // Covers: task:4
  it('settles host 1, admits host 2, and dispatches no provider step for host 1', async () => {
    const root = await operatorRoundFixture(true);
    const git = makeGitRunner(root);
    const stored = await readRouteRecord(root, 'demo', roundId, { git });
    if (stored.kind !== 'record') throw new Error('missing route record');
    const closure = (await git(['rev-parse', `refs/conductor/demo/closed/c${child}`])).stdout.trim();
    const tree = (await git(['rev-parse', `${closure}^{tree}`])).stdout.trim();
    await expect(writeRoutingTransaction(root, 'demo', [{
      kind: 'update-record', previous: stored, record: {
        ...stored.record, kind: 'audit', operator: undefined,
        hosts: { [child]: 'admitted', [leaf]: 'pending' }, currentHostIndex: 0,
        entry: { host: child, pinnedBase: closure as never, tree: tree as never },
      },
    }], { git })).resolves.toEqual({ kind: 'updated' });
    await git(['checkout', '-q', 'feat/c1/demo']);

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const runner = { run: vi.fn(async () => ({ success: true })) };
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', fromStep: 'build', verifyArtifacts: false, events, stepRunner: runner,
      config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
      childRegionLifecycle: {
        enterHostRegion: async ({ host }) => host === child
          ? { kind: 'derived-already-complete', detail: 'every routed task is already evidence-complete' } as never
          : { kind: 'entered' } as never,
      },
    });
    const cursor = await resolveActiveChild(root, 'demo');
    const execution = resolveExecutionChild(cursor, 'demo');
    const entered = await (conductor as unknown as {
      enterRoutedHostRegion(
        current: ExecutionChildResolution, slug: string, state: Record<string, unknown>, cursor: ActiveChildResolution,
      ): Promise<{ readonly target: { readonly child: number } } | false>;
    }).enterRoutedHostRegion(execution, 'demo', { feature_desc: 'demo' }, cursor);
    persister.stop();

    expect(entered).toMatchObject({ target: { child: leaf } });
    expect(runner.run).not.toHaveBeenCalled();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readRouteRecord(root, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'done', 2: 'admitted' } },
    });
    const routedPhases = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as { type: string; host?: number; phase?: string; reason?: string })
      .filter((event) => event.type === 'routed_repair_phase' && event.host === 1);
    expect(routedPhases).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'repairing', reason: 'derived-already-complete' }),
      expect.objectContaining({ phase: 'done' }),
    ]));
    expect(routedPhases.findIndex((event) => event.phase === 'repairing')).toBeLessThan(
      routedPhases.findIndex((event) => event.phase === 'done'),
    );
  });

  // Covers: task:4
  it('restacks an entry-created frozen block through child 2 and the leaf', async () => {
    const { root, git } = await threeHostRoundFixture();
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const runner = { run: vi.fn(async () => ({ success: true })) };
    let frozenBlock: string | undefined;
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', fromStep: 'build', verifyArtifacts: false, events, stepRunner: runner,
      config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
      childRegionLifecycle: {
        enterHostRegion: async ({ host }) => {
          if (host !== child) return { kind: 'entered' } as never;
          await writeFile(join(root, 'frozen-block.txt'), 'frozen block\n');
          await git(['add', 'frozen-block.txt']);
          await git(['commit', '-qm', 'append frozen routed block']);
          frozenBlock = (await git(['rev-parse', 'HEAD'])).stdout.trim();
          return { kind: 'derived-already-complete', detail: 'frozen block is already complete' } as never;
        },
      },
    });
    const cursor = await resolveActiveChild(root, 'demo');
    const execution = resolveExecutionChild(cursor, 'demo');
    const entered = await (conductor as unknown as {
      enterRoutedHostRegion(current: ExecutionChildResolution, slug: string, state: Record<string, unknown>, cursor: ActiveChildResolution): Promise<unknown>;
    }).enterRoutedHostRegion(execution, 'demo', { feature_desc: 'demo' }, cursor);
    persister.stop();

    expect(entered).toBeTruthy();
    expect(runner.run).not.toHaveBeenCalled();
    const carriedBlock = (await git(['rev-list', 'feat/c2/demo', '--', 'frozen-block.txt'])).stdout.trim();
    expect(carriedBlock).not.toBe('');
    await expect(readRouteRecord(root, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'restacked', 2: 'admitted', 3: 'pending' } },
    });
    expect(frozenBlock).toBeTruthy();
    await expect(git(['merge-base', '--is-ancestor', carriedBlock, 'feat/c2/demo'])).resolves.toMatchObject({ exitCode: 0 });
    await expect(git(['merge-base', '--is-ancestor', carriedBlock, 'feat/daemon-demo'])).resolves.toMatchObject({ exitCode: 0 });
    const phases = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as { type: string; host?: number; phase?: string })
      .filter((event) => event.type === 'routed_repair_phase' && event.host === 1)
      .map((event) => event.phase);
    expect(phases).toContain('built');
    expect(phases).toContain('restacked');
    expect(phases.indexOf('built')).toBeLessThan(phases.indexOf('restacked'));
  }, 10_000);

  // Covers: task:4
  it('closes a final no-op leaf round, returns to the leaf, and re-pends its gates', async () => {
    const { root, git } = await threeHostRoundFixture();
    const stored = await readRouteRecord(root, 'demo', roundId, { git });
    const marker = await readRepairMarker(root, 'demo', { git });
    if (stored.kind !== 'record' || marker.kind !== 'marker') throw new Error('missing admitted route fixture');
    const leafHost = parseChildId(3)!;
    await expect(writeRoutingTransaction(root, 'demo', [
      {
        kind: 'update-record', previous: stored, record: {
          ...stored.record,
          hosts: { [child]: 'restacked', [parseChildId(2)!]: 'done', [leafHost]: 'admitted' },
          currentHostIndex: 2,
          entry: undefined,
        },
      },
      { kind: 'replace-marker', previous: marker, marker: { host: leafHost, roundId } },
    ], { git })).resolves.toEqual({ kind: 'updated' });
    await git(['checkout', '-q', leafBranchFor('demo')]);
    const runner = { run: vi.fn(async () => ({ success: true })) };
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo', fromStep: 'build', verifyArtifacts: false, events, stepRunner: runner,
      config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
      childRegionLifecycle: {
        enterHostRegion: async () => ({ kind: 'derived-already-complete', detail: 'leaf work is already complete' }) as never,
      },
    });
    const cursor = await resolveActiveChild(root, 'demo');
    const execution = resolveExecutionChild(cursor, 'demo');
    const leafResult = await (conductor as unknown as {
      enterRoutedHostRegion(current: ExecutionChildResolution, slug: string, state: Record<string, unknown>, cursor: ActiveChildResolution): Promise<unknown>;
    }).enterRoutedHostRegion(execution, 'demo', { feature_desc: 'demo' }, cursor);
    persister.stop();

    expect(leafResult).not.toBe(false);
    expect(runner.run).not.toHaveBeenCalled();
    await expect(readRouteRecord(root, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record', record: { phase: 'closed', hosts: { 1: 'restacked', 2: 'done', 3: 'done' } },
    });
    await expect(git(['symbolic-ref', '--short', 'HEAD'])).resolves.toMatchObject({ stdout: 'feat/daemon-demo' });
    const state = JSON.parse(await readFile(join(root, '.pipeline', 'conduct-state.json'), 'utf8')) as Record<string, string>;
    expect(state).toMatchObject({ manual_test: 'pending', prd_audit: 'pending', architecture_review_as_built: 'pending' });
  });

  // Covers: task:4
  it('halts needs-human with the derived-already-complete outcome when no other host can advance', async () => {
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

  // Covers: task:5
  it('retains an uncleared no-op halt without changing routing refs', async () => {
    const { root, git } = await threeHostRoundFixture();
    await writeFile(join(root, '.pipeline', 'HALT'), 'Outcome: derived-already-complete\n');
    await writeFile(join(root, '.pipeline', 'HALT.class'), 'needs-human');
    const before = (await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout;

    await expect(resolveHaltRetention(async () => readFile(join(root, '.pipeline', 'HALT.class'), 'utf8'))).resolves.toEqual({
      haltClass: 'needs-human', retained: true,
    });
    await expect(git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).resolves.toMatchObject({ stdout: before });
  });

  // Covers: task:5
  it('recovers a cleared no-op HALT from an admitted host and reports its next-host marker', async () => {
    const { root, git } = await threeHostRoundFixture();
    await writeFile(join(root, '.pipeline', 'HALT'), 'Outcome: derived-already-complete\n');
    await writeFile(join(root, '.pipeline', 'HALT.class'), 'needs-human');
    await rm(join(root, '.pipeline', 'HALT'));
    await rm(join(root, '.pipeline', 'HALT.class'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'build', verifyArtifacts: false, events, stepRunner: { run: vi.fn(async () => ({ success: true })) },
      config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
      childRegionLifecycle: { enterHostRegion: async ({ host }) => host === child
        ? { kind: 'derived-already-complete', detail: 'every routed task is already evidence-complete' } as never
        : { kind: 'entered', pinnedBase: (await git(['rev-parse', 'HEAD'])).stdout.trim() as never } },
    });
    const cursor = await resolveActiveChild(root, 'demo');
    const entered = await (conductor as unknown as {
      enterRoutedHostRegion(current: unknown, slug: string, state: Record<string, unknown>, cursor: ActiveChildResolution): Promise<unknown>;
    }).enterRoutedHostRegion(resolveExecutionChild(cursor, 'demo'), 'demo', { feature_desc: 'demo' }, cursor);
    persister.stop();

    expect(entered).not.toBe(false);
    await expect(readRouteRecord(root, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'done', 2: 'admitted', 3: 'pending' } },
    });
    const printed: string[] = [];
    await expect(dispatchStackRoundsCommand({ kind: 'stack-rounds-inspect', slug: 'demo' }, {
      cwd: root, resolveMainRoot: async () => root, resolveWorktree: async () => root, print: (line: string) => printed.push(line), git,
    } as never)).resolves.toBe(0);
    expect(printed.join('\n')).toContain('hosts 1:done execution=owner placement=none, 2:admitted execution=owner placement=none, 3:pending execution=owner placement=none');
    expect(printed.join('\n')).toContain('repair marker: host 2 round r1');
  }, 10_000);

  // Covers: task:5
  it.each(['revalidate', 'operator'] as const)('does not apply the audit no-op halt to an entering %s host', async (kind) => {
    const operatorRoot = kind === 'operator' ? await operatorRoundFixture(true) : undefined;
    const fixture = kind === 'operator'
      ? { root: operatorRoot!, git: makeGitRunner(operatorRoot!) }
      : await threeHostRoundFixture();
    const { root, git } = fixture;
    if (kind === 'revalidate') {
      const stored = await readRouteRecord(root, 'demo', roundId, { git });
      if (stored.kind !== 'record') throw new Error('missing route record');
      await expect(writeRoutingTransaction(root, 'demo', [{
        kind: 'update-record', previous: stored, record: { ...stored.record, kind },
      }], { git })).resolves.toEqual({ kind: 'updated' });
    }
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'build', verifyArtifacts: false, events: new ConductorEventEmitter(), stepRunner: { run: vi.fn(async () => ({ success: true })) },
      config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
      childRegionLifecycle: { enterHostRegion: async () => ({ kind: 'entered', pinnedBase: (await git(['rev-parse', 'HEAD'])).stdout.trim() as never }) },
    });
    const cursor = await resolveActiveChild(root, 'demo');
    await expect((conductor as unknown as {
      enterRoutedHostRegion(current: unknown, slug: string, state: Record<string, unknown>, cursor: ActiveChildResolution): Promise<unknown>;
    }).enterRoutedHostRegion(resolveExecutionChild(cursor, 'demo'), 'demo', { feature_desc: 'demo' }, cursor)).resolves.not.toBe(false);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:5
  it('keeps a single-host audit admission and re-halts derived completion', async () => {
    const { root, git } = await threeHostRoundFixture();
    const stored = await readRouteRecord(root, 'demo', roundId, { git });
    if (stored.kind !== 'record') throw new Error('missing route record');
    await expect(writeRoutingTransaction(root, 'demo', [{
      kind: 'update-record', previous: stored, record: { ...stored.record, hosts: { [child]: 'admitted' }, currentHostIndex: 0 },
    }], { git })).resolves.toEqual({ kind: 'updated' });
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'build', verifyArtifacts: false, events: new ConductorEventEmitter(), stepRunner: { run: vi.fn(async () => ({ success: true })) },
      config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
      childRegionLifecycle: { enterHostRegion: async () => ({ kind: 'derived-already-complete', detail: 'no dispatchable work' } as never) },
    });
    const cursor = await resolveActiveChild(root, 'demo');
    await expect((conductor as unknown as {
      enterRoutedHostRegion(current: unknown, slug: string, state: Record<string, unknown>, cursor: ActiveChildResolution): Promise<unknown>;
    }).enterRoutedHostRegion(resolveExecutionChild(cursor, 'demo'), 'demo', { feature_desc: 'demo' }, cursor)).resolves.toBe(false);
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toMatch(/Outcome: derived-already-complete\n$/);
    await expect(readRouteRecord(root, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'admitted' } },
    });
  });

  // Covers: task:5
  it('resumes a drained-outbox no-op settle through its exit without entering or crediting host 1', async () => {
    const { root, git } = await threeHostRoundFixture();
    await expect(settleDerivedNoOpHost({ worktree: root, slug: 'demo', roundId, host: child, git })).resolves.toEqual({ kind: 'settled' });
    const settled = await readRouteRecord(root, 'demo', roundId, { git });
    if (settled.kind !== 'record') throw new Error('missing settled route record');
    await expect(drainOutbox(root, settled, async () => 'persisted' as const, { git })).resolves.toMatchObject({ kind: 'drained' });
    const entries = vi.fn(async ({ host }: { host: number }) => ({
      kind: host === child ? 'resume' : 'entered',
      pinnedBase: (await git(['rev-parse', 'HEAD'])).stdout.trim(),
    } as never));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const conductor = new Conductor({
      projectRoot: root, stateFilePath: join(root, '.pipeline', 'conduct-state.json'), featureSlug: 'demo',
      fromStep: 'build', verifyArtifacts: false, events, stepRunner: { run: vi.fn(async () => ({ success: true })) },
      config: { stacked_prs: { enabled: true, route_whole_feature_fixes: true } } as never,
      childRegionLifecycle: { enterHostRegion: entries },
    });
    const cursor = await resolveActiveChild(root, 'demo');
    await expect((conductor as unknown as {
      enterRoutedHostRegion(current: unknown, slug: string, state: Record<string, unknown>, cursor: ActiveChildResolution): Promise<unknown>;
    }).enterRoutedHostRegion(resolveExecutionChild(cursor, 'demo'), 'demo', { feature_desc: 'demo' }, cursor)).resolves.not.toBe(false);
    persister.stop();
    expect(entries).not.toHaveBeenCalledWith(expect.objectContaining({ host: 1 }));
    expect(entries).toHaveBeenCalledWith(expect.objectContaining({ host: 2 }));
    await expect(readRouteRecord(root, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 1: 'done', 2: 'admitted' } },
    });
  }, 10_000);

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
    const refusal = await enterHostRegion({
      worktree: root, slug: 'demo', roundId, host: child,
      emitter: new ConductorEventEmitter(), planPath: '.docs/plans/demo.md',
    });

    expect(refusal).toEqual({
      kind: 'refused',
      detail: 'operator-round-undeclared: landing r1 on child 1 is awaiting ai-conductor stack land --done or ai-conductor stack land --abandon',
    });

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
