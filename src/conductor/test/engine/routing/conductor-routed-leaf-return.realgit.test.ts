// Covers: task:3, task:rem-prd-audit-rem-prd-audit-rem-vg6-s6-1, task:rem-as-built-rem-prd-audit-rem-vg6-asbuilt-47c9-1
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { checkRoundSupersession, dispatchStackRoundsCommand, supersedeRound } from '../../../src/engine/stack-rounds-cli.js';
import { runStackPreflight } from '../../../src/engine/restack/stack-preflight.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { readState, writeState } from '../../../src/engine/state.js';
import { hasDurableChildState } from '../../../src/engine/slice-topology.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, HarnessConfig, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, removeAll, sealStack, type SweepRepository } from '../restack/restack-sweepG2-fixture.js';
import { withGitArgvShim } from '../n1-golden-shared.js';

const cleanup: string[] = [];
const host = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

afterEach(async () => { await removeAll(cleanup); });

async function writeBlob(git: GitRunner, value: unknown): Promise<string> {
  return (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) })).stdout.trim();
}

async function fixture(): Promise<{
  readonly subject: SweepRepository;
  readonly statePath: string;
  readonly config: HarnessConfig;
  readonly leafHead: string;
}> {
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
  const leafHead = await subject.commit('leaf', 'leaf.txt', 'leaf\n');
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
    leafHead,
  };
}

async function tasklessExitFixture(withCommit: boolean): Promise<{
  readonly subject: SweepRepository;
  readonly git: GitRunner;
  readonly host: NonNullable<ReturnType<typeof parseChildId>>;
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
  it.each([
    ['the cursor has no durable children', true, { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } }],
    ['whole-feature routing is off', false, { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: false } }],
  ] as const)('does not read routing refs on resume when %s', async (_caseName, removeChildState, config) => {
    const { subject, statePath } = await fixture();
    if (removeChildState) {
      await rm(join(subject.repo, '.pipeline', 'children'), { recursive: true, force: true });
      const git = makeGitRunner(subject.repo);
      for (const ref of [
        'refs/heads/feat/c1/demo',
        'refs/heads/feat/c2/demo',
        closureRefFor('demo', host),
        'refs/conductor/demo/positions',
      ]) await git(['update-ref', '-d', ref]);
      expect(await hasDurableChildState(subject.repo, 'demo')).toBe(false);
    }
    await writeState(statePath, {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      feature_desc: 'demo', complexity_tier: 'M', build: 'pending',
    } as ConductState);
    let parkAfterDispatch = false;
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      config,
      events: new ConductorEventEmitter(),
      stackPreflight: async () => ({ kind: 'clear' }),
      operatorParkBoundary: async () => parkAfterDispatch,
      childRegionLifecycle: { resolveActiveChild: async () => ({ kind: 'no-child' }) },
      // Stop at the first ordinary dispatch so completion's independent
      // routing fence cannot obscure this resume-boundary assertion.
      stepRunner: { run: async () => { parkAfterDispatch = true; return { success: true }; } },
    });
    // Stop immediately after the history guard: later whole-feature fences
    // legitimately inspect routing state for their own decisions.
    (conductor as unknown as { activateChildRegionStateForResume: () => Promise<boolean> }).activateChildRegionStateForResume = async () => false;
    const gitArgv = await withGitArgvShim(subject.repo, async () => { await conductor.run(); });
    const routingArgs = gitArgv.filter((args) => args.some((argument) => argument.includes('refs/conductor/demo/routes/') || argument.includes('refs/conductor/demo/revalidate')));
    expect(routingArgs).toEqual([]);
  });

  // Covers: task:13
  it('resumes an ordinary active child into its pending BUILD overlay when no routing round was opened', async () => {
    const { subject, statePath, config } = await fixture();
    const git = makeGitRunner(subject.repo);
    const leaf = parseChildId(2)!;
    await git(['update-ref', '-d', routeRecordRefFor('demo', roundId)]);
    await git(['update-ref', '-d', repairMarkerRefFor('demo')]);
    await git(['update-ref', '-d', revalidationQueueRefFor('demo')]);
    await writeState(statePath, {
      ...Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])),
      feature_desc: 'demo',
      complexity_tier: 'M',
    } as ConductState);
    await writeState(pipelinePathFor(subject.repo, 'conduct-state.json', leaf), {
      acceptance_specs: 'done', build: 'pending', test_suite: 'pending', build_review: 'pending', last_step: 'acceptance_specs',
    });

    const dispatched: StepName[] = [];
    let parkAfterBuild = false;
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      config,
      events: new ConductorEventEmitter(),
      operatorParkBoundary: async () => parkAfterBuild,
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          parkAfterBuild = step === 'build';
          return { success: true };
        },
      },
    });
    const originalActivate = (conductor as unknown as {
      activateChildRegionStateForResume(state: ConductState): Promise<boolean>;
    }).activateChildRegionStateForResume.bind(conductor);
    const activateSpy = vi.fn((state: ConductState) => originalActivate(state));
    (conductor as unknown as { activateChildRegionStateForResume: typeof activateSpy }).activateChildRegionStateForResume = activateSpy;

    await conductor.run();

    expect(activateSpy).toHaveBeenCalledTimes(1);
    expect(dispatched[0]).toBe('build');
    expect((conductor as unknown as { activeRegionChild?: number }).activeRegionChild).toBe(leaf);
  });

  // Covers: task:13
  it('drains a sole-round leaf-return close once and leaves the leaf gates pending', async () => {
    const { subject, statePath, config } = await fixture();
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

    // The event outbox has already drained. Recovery must use the closed
    // record's durable leaf-return identity, not the disposable event log.
    await rm(join(subject.repo, '.pipeline', 'events.jsonl'));
    const dispatched: StepName[] = [];
    let parkAfterWholeFeatureDispatch = false;
    const resumed = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      resume: true,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      config,
      events: new ConductorEventEmitter(),
      operatorParkBoundary: async () => parkAfterWholeFeatureDispatch,
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          expect((resumed as unknown as { activeRegionChild?: number }).activeRegionChild).toBeUndefined();
          parkAfterWholeFeatureDispatch = true;
          return { success: true };
        },
      },
    });
    await resumed.run();
    expect(dispatched).toContain('acceptance_specs');
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

  // Covers: task:13
  it('dispatches whole-feature validation after closing a leaf-return round, an operator leaf commit, and HALT clear', async () => {
    const { subject, statePath, config } = await fixture();
    const git = makeGitRunner(subject.repo);
    const stored = await readRouteRecord(subject.repo, 'demo', roundId, { git });
    if (stored.kind !== 'record') throw new Error('sole routed round is unavailable');
    await git(['update-ref', routeRecordRefFor('demo', roundId), await writeBlob(git, {
      ...stored.record, hosts: { [host]: 'admitted' },
    })]);
    const kickbackState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
    Object.assign(kickbackState, {
      feature_desc: 'demo',
      complexity_tier: 'M',
      prd_audit: 'pending',
      architecture_review_as_built: 'pending',
      manual_test: 'pending',
      post_region_check: 'pending',
    });
    await writeState(statePath, kickbackState);
    for (const gate of ['prd_audit', 'architecture_review_as_built', 'manual_test', 'post_region_check'] as StepName[]) {
      await writeVerdict(subject.repo, gate, {
        satisfied: false,
        reason: 'routed leaf return requires fresh whole-feature validation',
        checkedAt: Date.now(),
      });
    }
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'manual-test failure\n');

    await expect(dispatchStackRoundsCommand({
      kind: 'stack-rounds-close', slug: 'demo', roundId, reason: 'manual test repair lands on leaf',
    }, {
      cwd: subject.repo,
      resolveMainRoot: async () => subject.repo,
      resolveWorktree: async () => subject.repo,
      loadConfig: async () => ({ ok: true, config, warnings: [] }),
      hasDurableChildState: async () => true,
      resolveOperator: async () => 'operator@example.test',
      print: () => undefined,
      git,
    } as never)).resolves.toBe(0);
    await subject.git(['checkout', '-q', 'feat/daemon-demo']);
    const operatorCommit = await subject.commit('operator leaf repair', 'operator-leaf.txt', 'fixed\n');
    await rm(join(subject.repo, '.pipeline', 'HALT'));

    const dispatched: StepName[] = [];
    const dispatchContexts: Array<{ readonly step: StepName; readonly activeChild: number | undefined }> = [];
    const routedRepairPhases: unknown[] = [];
    let manualTestDispatch: { readonly worktree: string; readonly head: string } | undefined;
    let leafState: ConductState | undefined;
    let leafSnapshot: ConductState | undefined;
    let persistedRootState: ConductState | undefined;
    let leafVerdicts: Record<string, boolean | undefined> | undefined;
    let parkAfterValidationGroup = false;
    let preflightCalls = 0;
    const events = new ConductorEventEmitter();
    events.on('routed_repair_phase', (event) => { routedRepairPhases.push(event); });
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    const conductor = new Conductor({
      projectRoot: subject.repo,
      stateFilePath: statePath,
      featureSlug: 'demo',
      // Resume owns the dispatch boundary: it runs stack preflight, which
      // drains the close's durable outbox before selecting leaf validation.
      resume: true,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      config,
      events,
      stackPreflight: async (options) => {
        preflightCalls += 1;
        return runStackPreflight(options);
      },
      operatorParkBoundary: async () => parkAfterValidationGroup,
      stepRunner: {
        run: async (step, state) => {
          dispatched.push(step);
          dispatchContexts.push({
            step,
            activeChild: (conductor as unknown as { activeRegionChild?: number }).activeRegionChild,
          });
          if (step === 'manual_test') {
            const worktree = (conductor as unknown as { projectRoot: string }).projectRoot;
            manualTestDispatch = {
              worktree,
              head: (await makeGitRunner(worktree)(['rev-parse', 'HEAD'])).stdout.trim(),
            };
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
            // The observation boundary is the resumed leaf dispatch. Stop
            // before mocked-success validation can reach unrelated FINISH.
            parkAfterValidationGroup = true;
            return { success: true };
          }
          return { success: true };
        },
      },
    });
    const originalLeafReturnCheck = (conductor as unknown as {
      hasSettledRoutedLeafReturn(slug: string): Promise<boolean>;
    }).hasSettledRoutedLeafReturn.bind(conductor);
    const leafReturnCheckSpy = vi.fn((slug: string) => originalLeafReturnCheck(slug));
    (conductor as unknown as { hasSettledRoutedLeafReturn: typeof leafReturnCheckSpy }).hasSettledRoutedLeafReturn = leafReturnCheckSpy;

    let gitArgv: string[][];
    try {
      gitArgv = await withGitArgvShim(subject.repo, async () => { await conductor.run(); });
    } finally {
      persister.stop();
    }

    const onDisk = await readState(statePath);
    if (!onDisk.ok) throw new Error('leaf conduct state is unreadable');
    expect(preflightCalls).toBe(1);
    expect(leafReturnCheckSpy).toHaveBeenCalledWith('demo');
    expect(gitArgv!).toContainEqual(['for-each-ref', '--format=%(refname)', 'refs/conductor/demo/routes/']);
    expect(gitArgv!).toContainEqual(['rev-parse', 'HEAD']);
    expect(dispatched).toContain('manual_test');
    const persisted = await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8');
    const closes = persisted.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.type === 'routing_round_superseded' && event.roundId === roundId);
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({
      disposition: 'leaf-return', reason: 'manual test repair lands on leaf', operator: 'operator@example.test',
    });
    expect(closes[0]).not.toHaveProperty('supersededBy');
    expect(dispatched).toContain('manual_test');
    const wholeFeatureValidationDispatches = dispatchContexts.filter(({ step }) => [
      'manual_test', 'prd_audit', 'architecture_review_as_built', 'post_region_check',
    ].includes(step));
    expect(wholeFeatureValidationDispatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'manual_test', activeChild: undefined }),
    ]));
    expect(dispatchContexts.every(({ activeChild }) => activeChild === undefined)).toBe(true);
    expect(routedRepairPhases).toEqual([]);
    expect(manualTestDispatch).toEqual({ worktree: subject.repo, head: operatorCommit });
    expect(leafState).toEqual(persistedRootState);
    expect(leafSnapshot).toEqual(persistedRootState);
    const stores = conductor as unknown as {
      stateStore: { read(): Promise<{ ok: true; value: ConductState }> };
      rootStateStore: unknown;
      commitStateChanges(state: ConductState, name: string, changes: Record<string, unknown>): Promise<void>;
    };
    expect(stores.stateStore).toBe(stores.rootStateStore);

    expect(leafState?.manual_test).toBe('pending');
    expect(persistedRootState?.manual_test).toBe('pending');
    expect(leafVerdicts?.manual_test).toBe(false);
    expect(leafState?.acceptance_specs).toBe('done');
    expect((onDisk.value as Record<string, unknown>).routed_return_probe).toBe('recorded');
  });
});
