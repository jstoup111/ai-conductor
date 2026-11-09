// Covers: tasks:40,41,42,101,102, task:1, task:3, task:8, task:12, task:rem-as-built-W13
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { admitRound, reconcileRounds } from '../../../src/engine/routing/round-admission.js';
import { admitQueuedRevalidation } from '../../../src/engine/routing/queue-admission.js';
import { openOperatorRound } from '../../../src/engine/routing/operator-round.js';
import { createRouteRecord, readRepairMarker, readRouteRecord, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor, repairMarkerRefFor, revalidationQueueRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import { persistPrdAuditVerdict } from '../../../src/engine/prd-audit-verdict-store.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { persistFixtureProjectedRemediationPlan } from '../remediation-plan-fixtures.js';
import { writeKickbackLedger } from '../../kickback-ledger-test-support.js';

const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const c3 = parseChildId(3)!;
const roundId = parseRoundId('r1')!;

const input = {
  roundId,
  sealedAuthored: 1,
  kind: 'audit' as const,
  items: [{ findingId: 'finding', kind: 'audit' as const, owner: c1, host: c1, reason: 'task-slice', fallback: [] }],
  allocation: { [c1]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1\n'] } },
};

const revalidateInput = { ...input, sealedAuthored: undefined, kind: 'revalidate' as const };

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'round-admission-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await writeFile(join(repo, 'base.txt'), 'base\n');
  await git(['add', '.gitignore', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', 'feat/daemon-demo']);
  await writeSliceTopologyFixture(repo, {
    slug: 'demo',
    sliceMembership: { taskSlices: { T1: 1, T2: 2, T3: 3 }, titles: ['child one', 'child two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  });
  return { repo, git };
}

async function writeRecord(subject: Awaited<ReturnType<typeof fixture>>, record: RouteRecord): Promise<void> {
  const blob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(record) })).stdout.trim();
  await subject.git(['update-ref', routeRecordRefFor('demo', record.roundId), blob]);
}

async function writeQueue(subject: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const sha = parseCommitSha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim())!;
  const blob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({
    generation: 1,
    entries: [{ child: c1, position: c1, closureSha: sha, gates: ['test_suite'], replay: { oldParent: sha, newParent: sha }, state: 'queued' }],
    outbox: [],
  }) })).stdout.trim();
  await subject.git(['update-ref', revalidationQueueRefFor('demo'), blob]);
}

async function operatorFixture() {
  const subject = await fixture();
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(subject.repo, 'child.txt'), 'closed child\n');
  await subject.git(['add', 'child.txt']);
  await subject.git(['commit', '-qm', 'closed child']);
  const closure = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
  await subject.git(['update-ref', closureRefFor('demo', c1), closure]);
  await writeFile(join(subject.repo, 'reviewer.txt'), 'reviewer edit\n');
  await subject.git(['add', 'reviewer.txt']);
  await subject.git(['commit', '-qm', 'reviewer edit']);
  await subject.git(['checkout', '-q', leafBranchFor('demo')]);
  await mkdir(join(subject.repo, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  return subject;
}

async function admitFixablePrdAudit(foldRoutedFixes: boolean | undefined) {
  const subject = await fixture();
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  await subject.git(['update-ref', closureRefFor('demo', c1), 'HEAD']);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  await subject.git(['update-ref', closureRefFor('demo', c2), 'HEAD']);
  await subject.git(['checkout', '-q', leafBranchFor('demo')]);
  await writeFile(join(subject.repo, '.pipeline', 'task-status.json'), JSON.stringify({ tasks: [
    { id: 'T1', status: 'completed' }, { id: 'T2', status: 'completed' }, { id: 'T3', status: 'completed' },
  ] }));
  await persistPrdAuditVerdict(subject.repo, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'FIXABLE',
        evidence: 'Fixture identifies child one work.', rationale: 'Repair the child one task.',
        requirementAssociations: [], evidenceTaskIds: ['T1'], ownerTaskId: 'T1',
      }],
      noOwnerObservations: [],
    },
    diagnostics: [], recordedDispositions: [],
  }, { attemptId: 'fixture-prd-audit', codeStamp: null });
  await writeKickbackLedger(subject.repo, { version: 1, gates: {}, growth: { authored: 3, added: 0, byGate: {} } });
  const conductor = new Conductor({
    projectRoot: subject.repo,
    stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
    featureSlug: 'demo',
    events: new ConductorEventEmitter(),
    config: {
      stacked_prs: { enabled: true, max_slices: 3, route_whole_feature_fixes: true, ...(foldRoutedFixes === undefined ? {} : { fold_routed_fixes: foldRoutedFixes }) },
      prd_audit: { max_remediation_laps: 1, max_appended_tasks: 5, max_appended_ratio: 1 },
    } as never,
    stepRunner: {
      run: async (step, _state, options) => {
        if (step === 'remediate') {
          await persistFixtureProjectedRemediationPlan(subject.repo, options, [{
            id: 'S1.1', disposition: 'existing-task', category: null, rationale: 'Repair the child one task.',
            tasks: [], boundTaskIds: ['T1'],
          }]);
        }
        return { success: true };
      },
    },
    childRegionLifecycle: {
      resolveActiveChild: async () => ({
        kind: 'active', child: c3, position: c3, isLeaf: true, branch: leafBranchFor('demo'),
      }) as never,
    },
  });
  await expect((conductor as unknown as { planRemediation: Function }).planRemediation(
    { feature_desc: 'demo', session_started_at: Date.now() - 1_000 },
    ALL_STEPS,
    'route child one PRD finding',
    { source: 'prd_audit', evidence: [{ gate: 'prd_audit', evidenceFile: '.pipeline/prd-audit.md' }] },
  )).resolves.toMatchObject({ kind: 'route', target: 'build' });
  return subject;
}

async function routingRefSnapshot(subject: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  return (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout;
}

function openAudit(record: RouteRecord, hosts: RouteRecord['hosts'], currentHostIndex = 0): RouteRecord {
  return { ...record, phase: 'open', hosts, currentHostIndex, outbox: [] };
}

describe('routed-round admission (real local Git)', () => {
  // Covers: task:3
  it('persists leaf execution on an audit record and its repair marker', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', { ...input, execution: 'leaf' });
      if (created.kind !== 'created') throw new Error(created.kind);

      await expect(admitRound(subject.repo, 'demo', created.record, c1)).resolves.toMatchObject({
        kind: 'admitted', record: { execution: 'leaf' },
      });
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
        kind: 'record', record: { execution: 'leaf' },
      });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({
        kind: 'marker', marker: { host: c1, roundId, execution: 'leaf' },
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:3
  it('keeps an audit record and marker on owner execution when folding is disabled', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);

      await expect(admitRound(subject.repo, 'demo', created.record, c1)).resolves.toMatchObject({ kind: 'admitted' });
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      const marker = await readRepairMarker(subject.repo, 'demo');
      if (stored.kind !== 'record' || marker.kind !== 'marker') throw new Error('admission was not durable');
      expect(stored.record).not.toHaveProperty('execution');
      expect(marker.marker).not.toHaveProperty('execution');
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:3
  it.each([
    ['unset', undefined, 'leaf'],
    ['false', false, undefined],
  ] as const)('freezes %s fold mode through a child-owned FIXABLE PRD audit', async (_setting, foldRoutedFixes, execution) => {
    const subject = await admitFixablePrdAudit(foldRoutedFixes);
    try {
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      const marker = await readRepairMarker(subject.repo, 'demo');
      if (stored.kind !== 'record' || marker.kind !== 'marker') throw new Error('audit admission was not durable');
      expect(stored.record.items).toEqual([expect.objectContaining({ owner: c1, host: c1 })]);
      expect(await subject.git(['symbolic-ref', '--short', 'HEAD']).then((result) => result.stdout.trim())).toBe(leafBranchFor('demo'));
      if (execution === undefined) {
        expect(stored.record).not.toHaveProperty('execution');
        expect(marker.marker).not.toHaveProperty('execution');
      } else {
        expect(stored.record.execution).toBe(execution);
        expect(marker.marker.execution).toBe(execution);
      }
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:3
  it('keeps operator and revalidate rounds on owner execution', async () => {
    const operator = await operatorFixture();
    try {
      await expect(openOperatorRound({
        worktree: operator.repo,
        slug: 'demo',
        roundId,
        host: c1,
        reason: 'land reviewer edits',
        operator: 'operator@example.test',
        carried: [],
        emitter: new ConductorEventEmitter(),
        git: operator.git,
      })).resolves.toMatchObject({ kind: 'opened' });
      const operatorRecord = await readRouteRecord(operator.repo, 'demo', roundId);
      const operatorMarker = await readRepairMarker(operator.repo, 'demo');
      if (operatorRecord.kind !== 'record' || operatorMarker.kind !== 'marker') throw new Error('operator admission was not durable');
      expect(operatorRecord.record.kind).toBe('operator');
      expect(operatorRecord.record).not.toHaveProperty('execution');
      expect(operatorMarker.marker).not.toHaveProperty('execution');
    } finally { await rm(operator.repo, { recursive: true, force: true }); }

    const revalidate = await fixture();
    try {
      await writeQueue(revalidate);
      await expect(admitQueuedRevalidation({
        worktree: revalidate.repo,
        slug: 'demo',
        reconciled: { kind: 'quiescent' },
        git: revalidate.git,
      })).resolves.toMatchObject({ kind: 'admitted', host: c1 });
      const revalidateRecord = await readRouteRecord(revalidate.repo, 'demo', roundId);
      const revalidateMarker = await readRepairMarker(revalidate.repo, 'demo');
      if (revalidateRecord.kind !== 'record' || revalidateMarker.kind !== 'marker') throw new Error('revalidate admission was not durable');
      expect(revalidateRecord.record.kind).toBe('revalidate');
      expect(revalidateRecord.record).not.toHaveProperty('execution');
      expect(revalidateMarker.marker).not.toHaveProperty('execution');
    } finally { await rm(revalidate.repo, { recursive: true, force: true }); }
  });

  // Covers: task:rem-prd-audit-rem-prd-audit-rem-vg6-s6-1
  it('reports quiescent when closed route history has neither a marker nor queued work', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      const closed: RouteRecord = {
        ...created.record,
        phase: 'closed',
        hosts: { [c1]: 'done' },
      };
      const blob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(closed) })).stdout.trim();
      await subject.git(['update-ref', routeRecordRefFor('demo', roundId), blob]);

      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toEqual({ kind: 'quiescent' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('writes a prepared record then atomically opens its first marker and phase events', async () => {
    const subject = await fixture();
    try {
      const calls: { args: readonly string[]; input?: string }[] = [];
      const git: GitRunner = async (args, options) => {
        calls.push({ args, input: options?.input });
        return subject.git(args, options);
      };
      const created = await createRouteRecord(subject.repo, 'demo', input, { git });
      if (created.kind !== 'created') throw new Error(created.kind);
      expect(created.record).toMatchObject({ phase: 'prepared', hosts: { 1: 'pending' }, outbox: [] });
      const eventsPath = join(subject.repo, '.pipeline', 'events.jsonl');
      const persister = new EventPersister(eventsPath, new ConductorEventEmitter());
      const admitted = await admitRound(subject.repo, 'demo', created.record, c1, {
        git,
        persist: (event) => persister.persistDurably(event),
      });
      expect(admitted).toMatchObject({ kind: 'admitted', record: { phase: 'open', hosts: { 1: 'admitted' } } });
      expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'marker', marker: { roundId, host: c1 } });
      // `admitRound` does not return the route that its caller passes to
      // navigateBack until both admission occurrences are in the spine.
      expect((await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({ type: 'routed_repair_phase', roundId, host: c1, phase: 'admitted', credit: false }),
        expect.objectContaining({ type: 'remediation_routed', roundId }),
      ]);
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({
        kind: 'record',
        record: { outbox: [] },
      });
      const writes = calls.filter((call) => call.args[0] === 'update-ref');
      expect(writes).toHaveLength(4);
      expect(writes[1]?.input).toContain(`update ${repairMarkerRefFor('demo')}`);
      expect(writes[1]?.input).toContain('verify refs/conductor/demo/restack/journal ');
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:rem-prd-audit-W8, S5.10
  it('refuses a concurrent marker without mutating the prepared record', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      const markerBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ host: 1, roundId: 'r9' }) })).stdout.trim();
      await subject.git(['update-ref', repairMarkerRefFor('demo'), markerBlob]);
      expect(await admitRound(subject.repo, 'demo', created.record, c1)).toEqual({
        kind: 'refused',
        detail: 'routing round r9 is already open; cannot admit r1',
      });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({ kind: 'record', record: { phase: 'prepared', hosts: { 1: 'pending' } } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it('admits a revalidate round when the open audit round can only yield the queue', async () => {
    const subject = await fixture();
    try {
      const audit = await createRouteRecord(subject.repo, 'demo', { ...input, allocation: { [c1]: { remTaskIds: [], blockBodies: [] }, [c3]: { remTaskIds: [], blockBodies: [] } } });
      const revalidate = await createRouteRecord(subject.repo, 'demo', { ...revalidateInput, roundId: parseRoundId('r2')!, allocation: { [c1]: { remTaskIds: [], blockBodies: [] } } });
      if (audit.kind !== 'created' || revalidate.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(audit.record, { [c1]: 'restacked', [c3]: 'pending' }));
      await writeQueue(subject);

      await expect(admitRound(subject.repo, 'demo', revalidate.record, c1)).resolves.toMatchObject({ kind: 'admitted' });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { roundId: 'r2', host: c1 } });
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({ kind: 'record', record: { phase: 'open' } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('continues past a deferred queue round to a later open round with a pending host', async () => {
    const subject = await fixture();
    try {
      const first = await createRouteRecord(subject.repo, 'demo', {
        ...input,
        allocation: {
          [c1]: { remTaskIds: [], blockBodies: [] },
          [c3]: { remTaskIds: [], blockBodies: [] },
        },
      });
      const secondId = parseRoundId('r2')!;
      const second = await createRouteRecord(subject.repo, 'demo', {
        ...input,
        roundId: secondId,
        allocation: {
          [c1]: { remTaskIds: [], blockBodies: [] },
          [c2]: { remTaskIds: [], blockBodies: [] },
        },
      });
      if (first.kind !== 'created' || second.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(first.record, { [c1]: 'restacked', [c3]: 'pending' }));
      await writeRecord(subject, openAudit(second.record, { [c1]: 'restacked', [c2]: 'pending' }));
      await writeQueue(subject);

      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toEqual({
        kind: 'navigate-host', roundId: secondId, host: c2,
      });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({
        kind: 'marker', marker: { roundId: secondId, host: c2 },
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it('refuses a second audit round while another open round has pending work', async () => {
    const subject = await fixture();
    try {
      const first = await createRouteRecord(subject.repo, 'demo', input);
      const second = await createRouteRecord(subject.repo, 'demo', { ...input, roundId: parseRoundId('r2')! });
      if (first.kind !== 'created' || second.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(first.record, { [c1]: 'pending' }));

      await expect(admitRound(subject.repo, 'demo', second.record, c1)).resolves.toMatchObject({ kind: 'refused', fence: true, detail: expect.stringContaining('r1') });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toEqual({ kind: 'absent' });
      await expect(readRouteRecord(subject.repo, 'demo', parseRoundId('r2')!)).resolves.toMatchObject({ kind: 'record', record: { phase: 'prepared' } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it.each(['admitted', 'repairing', 'built'] as const)('refuses revalidation while an open audit host is %s', async (state) => {
    const subject = await fixture();
    try {
      const audit = await createRouteRecord(subject.repo, 'demo', input);
      const revalidate = await createRouteRecord(subject.repo, 'demo', { ...revalidateInput, roundId: parseRoundId('r2')! });
      if (audit.kind !== 'created' || revalidate.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(audit.record, { [c1]: state }));
      await expect(admitRound(subject.repo, 'demo', revalidate.record, c1)).resolves.toMatchObject({ kind: 'refused', fence: true });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toEqual({ kind: 'absent' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it('refuses revalidation when an open round would select a pending child host', async () => {
    const subject = await fixture();
    try {
      const audit = await createRouteRecord(subject.repo, 'demo', { ...input, allocation: { [c1]: { remTaskIds: [], blockBodies: [] }, [c2]: { remTaskIds: [], blockBodies: [] }, [c3]: { remTaskIds: [], blockBodies: [] } } });
      const revalidate = await createRouteRecord(subject.repo, 'demo', { ...revalidateInput, roundId: parseRoundId('r2')! });
      if (audit.kind !== 'created' || revalidate.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(audit.record, { [c1]: 'restacked', [c2]: 'pending', [c3]: 'pending' }));
      await expect(admitRound(subject.repo, 'demo', revalidate.record, c1)).resolves.toMatchObject({ kind: 'refused', fence: true });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toEqual({ kind: 'absent' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:1
  it('refuses an unreadable open record at the fence', async () => {
    const subject = await fixture();
    try {
      const candidate = await createRouteRecord(subject.repo, 'demo', input);
      if (candidate.kind !== 'created') throw new Error(candidate.kind);
      const badBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: '{bad json' })).stdout.trim();
      await subject.git(['update-ref', routeRecordRefFor('demo', parseRoundId('r9')!), badBlob]);
      await expect(admitRound(subject.repo, 'demo', candidate.record, c1)).resolves.toMatchObject({ kind: 'refused', fence: true, detail: expect.stringContaining('r9') });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:rem-as-built-W11
  it('refuses an illegal host or round phase lifecycle update without writing a route ref', async () => {
    for (const preState of [
      { name: 'host state', apply: (record: RouteRecord): RouteRecord => ({ ...record, hosts: { ...record.hosts, [c1]: 'built' } }) },
      { name: 'round phase', apply: (record: RouteRecord): RouteRecord => ({ ...record, phase: 'closed' }) },
    ]) {
      const subject = await fixture();
      try {
        const created = await createRouteRecord(subject.repo, 'demo', input);
        if (created.kind !== 'created') throw new Error(created.kind);
        const stored = await readRouteRecord(subject.repo, 'demo', roundId);
        if (stored.kind !== 'record') throw new Error('record unavailable');
        const calls: { args: readonly string[]; input?: string }[] = [];
        const git: GitRunner = async (args, options) => {
          calls.push({ args, input: options?.input });
          return subject.git(args, options);
        };
        const illegal = preState.apply(stored.record);
        expect(await writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: illegal }], { git }))
          .toEqual({ kind: 'unavailable' });
        expect(calls.filter((call) => call.args[0] === 'update-ref')).toHaveLength(0);
        expect(await readRepairMarker(subject.repo, 'demo')).toEqual({ kind: 'absent' });
        expect(await readRouteRecord(subject.repo, 'demo', roundId)).toEqual(stored);
      } finally { await rm(subject.repo, { recursive: true, force: true }); }
    }
  });

  it('aborts an orphaned prepared round and sends an admitted one back to build', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      expect(await reconcileRounds(subject.repo, 'demo')).toEqual({ kind: 'aborted', roundId: 'r1' });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toEqual({ kind: 'absent' });

      const opened = await createRouteRecord(subject.repo, 'demo', input);
      if (opened.kind !== 'created') throw new Error(opened.kind);
      await admitRound(subject.repo, 'demo', opened.record, c1);
      expect(await reconcileRounds(subject.repo, 'demo')).toEqual({ kind: 'navigate-leaf-to-build', roundId: 'r1', host: c1 });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:3
  it('reconciles the marker round before an earlier open round', async () => {
    const subject = await fixture();
    try {
      const r3 = await createRouteRecord(subject.repo, 'demo', {
        ...input,
        roundId: parseRoundId('r3')!,
        allocation: { [c1]: { remTaskIds: [], blockBodies: [] }, [c2]: { remTaskIds: [], blockBodies: [] } },
      });
      const r4 = await createRouteRecord(subject.repo, 'demo', {
        ...input,
        roundId: parseRoundId('r4')!,
        allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
      });
      if (r3.kind !== 'created' || r4.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(r3.record, { [c1]: 'restacked', [c2]: 'pending' }));
      await writeRecord(subject, openAudit(r4.record, { [c1]: 'built' }));
      const markerBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ host: c1, roundId: 'r4' }) })).stdout.trim();
      await subject.git(['update-ref', repairMarkerRefFor('demo'), markerBlob]);
      const beforeR3 = await readRouteRecord(subject.repo, 'demo', parseRoundId('r3')!);

      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toEqual({ kind: 'resume-exit', roundId: 'r4', host: c1 });
      await expect(readRouteRecord(subject.repo, 'demo', parseRoundId('r3')!)).resolves.toEqual(beforeR3);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:3
  it('continues after closing a round and admits the next open round host', async () => {
    const subject = await fixture();
    try {
      const r3 = await createRouteRecord(subject.repo, 'demo', { ...input, roundId: parseRoundId('r3')!, allocation: { [c1]: { remTaskIds: [], blockBodies: [] } } });
      const r4 = await createRouteRecord(subject.repo, 'demo', { ...input, roundId: parseRoundId('r4')!, allocation: { [c1]: { remTaskIds: [], blockBodies: [] }, [c2]: { remTaskIds: [], blockBodies: [] } } });
      if (r3.kind !== 'created' || r4.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(r3.record, { [c1]: 'restacked' }));
      await writeRecord(subject, openAudit(r4.record, { [c1]: 'restacked', [c2]: 'pending' }));

      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toEqual({ kind: 'navigate-host', roundId: 'r4', host: c2 });
      await expect(readRouteRecord(subject.repo, 'demo', parseRoundId('r3')!)).resolves.toMatchObject({ kind: 'record', record: { phase: 'closed' } });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { roundId: 'r4', host: c2 } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:3
  it('continues from a closed revalidate round to the pending audit leaf', async () => {
    const subject = await fixture();
    try {
      const revalidate = await createRouteRecord(subject.repo, 'demo', {
        ...revalidateInput,
        roundId: parseRoundId('r3')!,
        allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
      });
      const audit = await createRouteRecord(subject.repo, 'demo', {
        ...input,
        roundId: parseRoundId('r4')!,
        allocation: { [c1]: { remTaskIds: [], blockBodies: [] }, [c3]: { remTaskIds: [], blockBodies: [] } },
      });
      if (revalidate.kind !== 'created' || audit.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(revalidate.record, { [c1]: 'restacked' }));
      await writeRecord(subject, openAudit(audit.record, { [c1]: 'restacked', [c3]: 'pending' }));

      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toEqual({ kind: 'navigate-host', roundId: 'r4', host: c3 });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { roundId: 'r4', host: c3 } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:3
  it('reports a stalled reconciliation when the marker names an unreadable round', async () => {
    const subject = await fixture();
    try {
      const r3 = await createRouteRecord(subject.repo, 'demo', { ...input, roundId: parseRoundId('r3')! });
      if (r3.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(r3.record, { [c1]: 'pending' }));
      const unreadable = (await subject.git(['hash-object', '-w', '--stdin'], { input: '{not-json' })).stdout.trim();
      await subject.git(['update-ref', routeRecordRefFor('demo', parseRoundId('r4')!), unreadable]);
      const markerBlob = (await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ host: c1, roundId: 'r4' }) })).stdout.trim();
      await subject.git(['update-ref', repairMarkerRefFor('demo'), markerBlob]);
      const before = await routingRefSnapshot(subject);

      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toMatchObject({
        kind: 'stalled',
        detail: expect.stringContaining('r4'),
        rounds: expect.arrayContaining([
          expect.objectContaining({ roundId: 'r4', readable: false }),
        ]),
      });
      expect(await routingRefSnapshot(subject)).toBe(before);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:3
  it('reports a stalled reconciliation when the next-host admission CAS is contested', async () => {
    const subject = await fixture();
    try {
      const r3 = await createRouteRecord(subject.repo, 'demo', {
        ...input,
        roundId: parseRoundId('r3')!,
        allocation: { [c1]: { remTaskIds: [], blockBodies: [] }, [c2]: { remTaskIds: [], blockBodies: [] } },
      });
      if (r3.kind !== 'created') throw new Error('route creation failed');
      await writeRecord(subject, openAudit(r3.record, { [c1]: 'restacked', [c2]: 'pending' }));
      const contested: GitRunner = async (args, options) => args[0] === 'update-ref' && args[1] === '--stdin'
        ? { exitCode: 1, stdout: '', stderr: 'injected CAS refusal' }
        : subject.git(args, options);

      await expect(reconcileRounds(subject.repo, 'demo', { git: contested })).resolves.toMatchObject({
        kind: 'stalled', detail: expect.stringContaining('r3'), rounds: [expect.objectContaining({ roundId: 'r3', readable: true, unsettledHosts: { 2: 'pending' } })],
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:20
  it('carries an operator host entry step through reconciliation', async () => {
    const subject = await fixture();
    try {
      const tip = (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
      const created = await createRouteRecord(subject.repo, 'demo', {
        ...input,
        kind: 'operator',
        operator: {
          origin: 'rewind', reason: 'recheck the suite', operator: 'operator@example.test', entryStep: 'test_suite',
          carried: [], otherTips: { 'feat/daemon-demo': tip as never },
          priorRegion: { statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' }, verdicts: {} },
        },
      });
      if (created.kind !== 'created') throw new Error(created.kind);
      await expect(admitRound(subject.repo, 'demo', created.record, c1)).resolves.toMatchObject({ kind: 'admitted' });
      await expect(reconcileRounds(subject.repo, 'demo')).resolves.toEqual({
        kind: 'navigate-leaf-to-build', roundId: 'r1', host: c1, entryStep: 'test_suite',
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('refuses a fenced transaction when a restack journal appears before commit', async () => {
    const subject = await fixture();
    try {
      const created = await createRouteRecord(subject.repo, 'demo', input);
      if (created.kind !== 'created') throw new Error(created.kind);
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('record unavailable');
      const raced: GitRunner = async (args, options) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin') {
          const journal = parseCommitSha((await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({}) })).stdout.trim())!;
          await subject.git(['update-ref', 'refs/conductor/demo/restack/journal', journal]);
        }
        return subject.git(args, options);
      };
      const next: RouteRecord = { ...stored.record, phase: 'open', hosts: { [c1]: 'admitted' } };
      expect(await writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: next }], { git: raced }))
        .toEqual({ kind: 'cas-failed' });
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toEqual(stored);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });
});
