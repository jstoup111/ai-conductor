// Covers: task:3, task:rem-prd-audit-rem-prd-audit-rem-vg6-s6-1, task:rem-as-built-rem-prd-audit-rem-vg6-asbuilt-47c9-1
import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { checkStepCompletion } from '../../../src/engine/artifacts.js';
import { parseChildId, pipelinePathFor } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { readVerdict, writeVerdict } from '../../../src/engine/gate-verdicts.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { readRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor, repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { advanceRound, requestRoutedExit } from '../../../src/engine/routing/routed-exit.js';
import { checkRoundSupersession, supersedeRound } from '../../../src/engine/stack-rounds-cli.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { readState, writeState } from '../../../src/engine/state.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, HarnessConfig, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from '../restack/restack-sweepG2-fixture.js';

const cleanup: string[] = [];
const host = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => { await removeAll(cleanup); });

async function writeBlob(git: GitRunner, value: unknown): Promise<string> {
  return (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) })).stdout.trim();
}

async function fixture(): Promise<{ readonly subject: SweepRepository; readonly statePath: string; readonly config: HarnessConfig }> {
  const subject = await createSweepRepository('conductor-routed-leaf-return-', cleanup);
  await subject.write('.ai-conductor/config.yml', [
    'stacked_prs:',
    '  enabled: true',
    '  max_slices: 2',
    '  route_whole_feature_fixes: true',
    'steps:',
    '  post_region_check:',
    '    after: build_review',
    '    skill: custom/SKILL.md',
    '    enforcement: gating',
    '',
  ].join('\n'));
  await subject.write('custom/SKILL.md', '---\nname: custom\n---\n');
  await subject.write('.docs/plans/demo.md', '# Demo plan\n');
  await subject.git(['add', '.ai-conductor/config.yml', 'custom/SKILL.md', '.docs/plans/demo.md']);
  await subject.git(['commit', '-qm', 'configure routed test']);
  await subject.commit('base', 'base.txt', 'base\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await subject.commit('closed child', 'child.txt', 'child\n');
  await subject.git(['update-ref', closureRefFor('demo', host), closed]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('leaf', 'leaf.txt', 'leaf\n');
  await sealStack(subject.repo, [1, 2]);

  const git = makeGitRunner(subject.repo);
  const tree = (await git(['rev-parse', `${closed}^{tree}`])).stdout.trim();
  const record: RouteRecord = {
    roundId,
    kind: 'audit',
    phase: 'open',
    items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'repair', fallback: [] }],
    allocation: { [host]: { remTaskIds: [], blockBodies: [] } },
    hosts: { [host]: 'repairing' },
    currentHostIndex: 0,
    receipt: emptyUnsettledReceipt(),
    outbox: [],
    entry: { host, pinnedBase: closed, tree: tree as never },
  };
  await git(['update-ref', routeRecordRefFor('demo', roundId), await writeBlob(git, record)]);
  await git(['update-ref', repairMarkerRefFor('demo'), await writeBlob(git, { host, roundId })]);
  // Exercise the durable empty-queue path rather than treating a missing ref
  // as the queue-empty proof. `returnToLeaf` must accept this settled state.
  await git(['update-ref', revalidationQueueRefFor('demo'), await writeBlob(git, {
    generation: 1,
    entries: [],
    outbox: [],
  })]);

  const statePath = join(subject.repo, '.pipeline', 'conduct-state.json');
  const root = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
  for (const step of ['acceptance_specs', 'build'] as const) root[step] = 'pending';
  Object.assign(root, {
    feature_desc: 'demo',
    complexity_tier: 'M',
    prd_audit: 'done',
    architecture_review_as_built: 'done',
    manual_test: 'done',
    post_region_check: 'done',
  });
  await writeState(statePath, root);
  await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', host), {
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done', last_step: 'build_review',
  });
  for (const gate of ['prd_audit', 'architecture_review_as_built', 'manual_test', 'post_region_check'] as StepName[]) {
    await writeVerdict(subject.repo, gate, { satisfied: true, reason: 'stale passing verdict', checkedAt: 1 });
  }

  return {
    subject,
    statePath,
    config: {
      stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true },
      steps: { post_region_check: { after: 'build_review', skill: 'custom/SKILL.md', enforcement: 'gating' } },
    },
  };
}

async function tasklessExitFixture(withCommit: boolean): Promise<{
  readonly subject: SweepRepository;
  readonly git: GitRunner;
  readonly host: ReturnType<typeof parseChildId>;
  readonly leafHead: string;
  readonly repair?: string;
}> {
  const subject = await createSweepRepository('conductor-routed-taskless-exit-', cleanup);
  await subject.write('.ai-conductor/config.yml', 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
  await subject.git(['add', '.ai-conductor/config.yml']);
  await subject.git(['commit', '-qm', 'configure routed taskless exit']);
  await subject.commit('base', 'base.txt', 'base\n');

  let closure = '';
  for (const position of [1, 2, 3, 4]) {
    await subject.git(['checkout', '-qb', `feat/c${position}/demo`]);
    closure = await subject.commit(`closed child ${position}`, `child-${position}.txt`, `${position}\n`);
    await subject.git(['update-ref', closureRefFor('demo', parseChildId(position)!), closure]);
  }
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  const leafHead = await subject.commit('leaf', 'leaf.txt', 'leaf\n');
  await sealStack(subject.repo, [1, 2, 3, 4, 5]);
  await subject.git(['checkout', '-q', 'feat/c4/demo']);
  const repair = withCommit ? await subject.commit('taskless fix', 'taskless-fix.txt', 'fixed\n') : undefined;

  const git = makeGitRunner(subject.repo);
  const host = parseChildId(4)!;
  const entryTree = (await git(['rev-parse', `${closure}^{tree}`])).stdout.trim();
  const record: RouteRecord = {
    roundId,
    kind: 'audit',
    phase: 'open',
    items: [{ findingId: 'manual-test-fail', kind: 'audit', owner: host, host, reason: 'manual-test', fallback: [] }],
    allocation: { [host]: { remTaskIds: [], blockBodies: [], retryHint: '| Story 1 | FAIL | taskless repair |' } },
    hosts: { [host]: 'repairing' },
    currentHostIndex: 0,
    receipt: { ...emptyUnsettledReceipt(), taskless: { manual_test: 1 } },
    outbox: [],
    entry: { host, pinnedBase: closure as never, tree: entryTree as never },
  };
  await git(['update-ref', routeRecordRefFor('demo', roundId), await writeBlob(git, record)]);
  await git(['update-ref', repairMarkerRefFor('demo'), await writeBlob(git, { host, roundId })]);
  await git(['update-ref', revalidationQueueRefFor('demo'), await writeBlob(git, { generation: 1, entries: [], outbox: [] })]);
  await writeState(join(subject.repo, '.pipeline', 'conduct-state.json'), Object.fromEntries(
    ALL_STEPS.map((step) => [step.name, 'done']),
  ) as ConductState);
  return { subject, git, host, leafHead, ...(repair === undefined ? {} : { repair }) };
}

describe('Conductor routed final leaf return (real local Git)', () => {
  // Covers: task:13
  it('drains a sole-round leaf-return close once and leaves the leaf gates pending', async () => {
    const { subject, statePath } = await fixture();
    const git = makeGitRunner(subject.repo);
    const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git });
    if (stored.kind !== 'record') throw new Error('sole routed round is unavailable');
    const admitted: RouteRecord = { ...stored.record, hosts: { [host]: 'admitted' } };
    await git(['update-ref', routeRecordRefFor('demo', roundId), await writeBlob(git, admitted)]);

    const checked = await checkRoundSupersession(subject.repo, 'demo', roundId, { git });
    if (checked.kind !== 'leaf-return') throw new Error('sole routed round was not eligible for a leaf return');
    await expect(supersedeRound({
      worktree: subject.repo, slug: 'demo', checked, reason: 'manual test repair lands on leaf', operator: 'operator@example.test', git,
    })).resolves.toMatchObject({ kind: 'superseded', event: { disposition: 'leaf-return' } });

    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'manual-test failure\n');
    await rm(join(subject.repo, '.pipeline', 'HALT'));
    const state = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
    Object.assign(state, {
      feature_desc: 'demo', complexity_tier: 'M', acceptance_specs: 'pending', build: 'pending', build_review: 'pending', manual_test: 'pending',
    });
    await writeState(statePath, state);
    const events = new ConductorEventEmitter();
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', events })).resolves.toEqual({ kind: 'clear' });
    await expect(runStackPreflight({ worktree: subject.repo, slug: 'demo', events })).resolves.toEqual({ kind: 'clear' });

    const persisted = await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8');
    const closes = persisted.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.type === 'routing_round_superseded' && event.roundId === roundId);
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({
      disposition: 'leaf-return', reason: 'manual test repair lands on leaf', operator: 'operator@example.test',
    });
    expect(closes[0]).not.toHaveProperty('supersededBy');
    await expect(readState(statePath)).resolves.toMatchObject({ ok: true, value: { manual_test: 'pending' } });
    expect(persisted).not.toContain('"type":"routed_repair_phase"');
  });

  it('restacks a committed taskless host and returns the settled round to the leaf', async () => {
    const { subject, git, host: tasklessHost, repair } = await tasklessExitFixture(true);
    if (repair === undefined) throw new Error('fixture did not create the routed repair commit');

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host: tasklessHost, git }))
      .resolves.toEqual({ kind: 'restacked' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 4: 'restacked' } },
    });
    await expect(git(['merge-base', '--is-ancestor', repair, 'feat/daemon-demo'])).resolves.toMatchObject({ exitCode: 0 });

    const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git });
    if (stored.kind !== 'record') throw new Error('taskless route record is unavailable');
    await expect(advanceRound(subject.repo, 'demo', stored, { git })).resolves.toEqual({ kind: 'leaf-returned' });
  });

  it('takes the taskless no-commit exit without moving the leaf, then refuses a same-HEAD manual-test PASS', async () => {
    const { subject, git, host: tasklessHost, leafHead } = await tasklessExitFixture(false);

    await expect(requestRoutedExit({ worktree: subject.repo, slug: 'demo', roundId, host: tasklessHost, git }))
      .resolves.toEqual({ kind: 'no-commit-done' });
    await expect(readRouteRecord(subject.repo, 'demo', roundId, { git })).resolves.toMatchObject({
      kind: 'record', record: { hosts: { 4: 'done' } },
    });
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toMatchObject({ stdout: leafHead });

    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const sessionStartedAt = Date.now() - 1_000;
    const context = { getHeadSha: async () => leafHead, sessionStartedAt };
    const resultPath = join(subject.repo, '.pipeline', 'manual-test-results.md');
    await writeFile(resultPath, '| Story | Result |\n|---|---|\n| Story 1 | FAIL |\n');
    await expect(checkStepCompletion(subject.repo, 'manual_test', context)).resolves.toMatchObject({
      done: false, reason: expect.stringContaining('contains FAIL rows'),
    });
    await writeFile(resultPath, '| Story | Result |\n|---|---|\n| Story 1 | PASS |\n');
    await expect(checkStepCompletion(subject.repo, 'manual_test', context)).resolves.toMatchObject({
      done: false, reason: expect.stringContaining('whitewash guard'),
    });
  });

  it('returns to whole-feature validation with the root state store and baseline reloaded', async () => {
    const { subject, statePath, config } = await fixture();
    const dispatched: StepName[] = [];
    let leafState: ConductState | undefined;
    let leafSnapshot: ConductState | undefined;
    let persistedRootState: ConductState | undefined;
    let leafVerdicts: Record<string, boolean | undefined> | undefined;
    let parkAfterValidationGroup = false;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'build_review',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      config,
      events,
      operatorParkBoundary: async () => parkAfterValidationGroup,
      stepRunner: {
        run: async (step, state) => {
          dispatched.push(step);
          if (step === 'manual_test') {
            leafState = { ...state };
            leafSnapshot = {
              ...(conductor as unknown as { persistedStateSnapshot: ConductState }).persistedStateSnapshot,
            };
            const stores = conductor as unknown as {
              stateStore: { read(): Promise<{ ok: true; value: ConductState }> };
              rootStateStore: unknown;
              commitStateChanges(state: ConductState, name: string, changes: Record<string, unknown>): Promise<void>;
            };
            expect((conductor as unknown as { activeRegionChild?: number }).activeRegionChild).toBeUndefined();
            expect(stores.stateStore).toBe(stores.rootStateStore);
            persistedRootState = (await stores.stateStore.read()).value;
            leafVerdicts = Object.fromEntries(await Promise.all(
              (['prd_audit', 'architecture_review_as_built', 'manual_test', 'post_region_check'] as StepName[])
                .map(async (gate) => [gate, (await readVerdict(subject.repo, gate))?.satisfied] as const),
            ));
            await stores.commitStateChanges(state, 'record first post-return state change', { routed_return_probe: 'recorded' });
            return { success: true };
          }
          if (step === 'architecture_review_as_built') parkAfterValidationGroup = true;
          return { success: true };
        },
      },
    });

    try {
      await conductor.run();
    } finally {
      persister.stop();
    }

    const onDisk = await readState(statePath);
    if (!onDisk.ok) throw new Error('leaf conduct state is unreadable');
    expect(dispatched[0]).toBe('build_review');
    expect(dispatched).toContain('manual_test');
    expect(dispatched).toContain('prd_audit');
    expect(dispatched).toContain('architecture_review_as_built');
    expect(leafState).toEqual(persistedRootState);
    expect(leafSnapshot).toEqual(persistedRootState);
    const stores = conductor as unknown as {
      stateStore: { read(): Promise<{ ok: true; value: ConductState }> };
      rootStateStore: unknown;
      commitStateChanges(state: ConductState, name: string, changes: Record<string, unknown>): Promise<void>;
    };
    expect(stores.stateStore).toBe(stores.rootStateStore);

    for (const gate of ['prd_audit', 'architecture_review_as_built', 'manual_test', 'post_region_check'] as StepName[]) {
      expect(leafState?.[gate]).toBe('pending');
      expect(persistedRootState?.[gate]).toBe('pending');
      expect(leafVerdicts?.[gate]).toBe(false);
    }
    expect(leafState?.acceptance_specs).toBe('pending');
    expect((onDisk.value as Record<string, unknown>).routed_return_probe).toBe('recorded');
  });
});
