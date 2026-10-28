// Covers: task:1, task:2, task:3, task:4, task:5, task:6, task:7, task:10, task:12
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  bindableDispositions,
  classifyRemediationCaseReuse,
  isCarryEligibleRemediationCase,
  reconcileRemediationCases,
  retireOpenBuildReviewCase,
  retiresOpenBuildReviewCase,
} from '../../src/engine/remediation-case-reconciler.js';
import type {
  RemediationCasePrdWideningRecord,
  RemediationCaseRecord,
} from '../../src/engine/remediation-case-store.js';
import { RemediationCaseStore, remediationCaseStorePath } from '../../src/engine/remediation-case-store.js';
import type { RemediationCaseGraph } from '../../src/engine/remediation-case-validator.js';

const FEATURE = { version: 'v1', repository: 'acme/conductor', feature: 'case-reconciler' } as const;
const RECORDED_AT = '2026-08-30T12:00:00.000Z';
const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'remediation-case-reconciler-'));
  temporaryDirectories.push(directory);
  return directory;
}

function generatedIds(...ids: string[]): () => string {
  return () => ids.shift()!;
}

function graph(caseRow: RemediationCaseGraph['cases'][number]['case'], sources: readonly RemediationCaseGraph['sourceOutcomes'][number][] = []): RemediationCaseGraph {
  const sourceOutcomes = sources.length === 0
    ? [{ sourceId: 'testQuality:finding-1', outcome: caseRow.disposition === 'act' ? 'acted' : caseRow.disposition === 'defer' ? 'deferred' : 'rejected', caseRef: caseRow.caseRef }]
    : sources;
  return {
    sourceOutcomes,
    cases: [{ case: caseRow, sources: sourceOutcomes }],
  } as RemediationCaseGraph;
}

const ACTION_CASE = {
  caseRef: 'new-action',
  disposition: 'act',
  priority: 'high',
  rationale: 'The changed behavior needs the planned repair.',
  confidence: 'high',
  effect: { kind: 'action', route: 'build', tasks: [{ title: 'Cover the changed behavior' }] },
} as const;

const REFUTATION = {
  claim: 'The alleged coverage gap is already covered by the focused regression test.',
  assertions: [{
    assertion: 'The focused regression test exercises the changed production path.',
    verdict: 'refuted' as const,
    evidence: [{ path: 'test/regression.test.ts', excerpt: 'exercises the changed production path' }],
  }],
} as const;

const REFUTE_CASE = {
  caseRef: 'refute-case-1', existingCaseId: 'case-1', disposition: 'refute', priority: 'high',
  rationale: 'The original finding is contradicted by the focused regression test.', confidence: 'high',
  effect: { kind: 'none' }, refutation: REFUTATION,
} as const;

function refuteGraph(caseRow: RemediationCaseGraph['cases'][number]['case'] = REFUTE_CASE): RemediationCaseGraph {
  return graph(caseRow, [{ sourceId: 'testQuality:finding-2', outcome: 'refuted', caseRef: caseRow.caseRef }]);
}

const PRD_WIDENING_CASE: RemediationCasePrdWideningRecord = {
  id: 'prd-case-1',
  domain: 'prd_widening',
  originalSources: [{ sourceId: 'NC-1', snapshot: 'Original widening finding.' }],
  currentSources: [{ sourceId: 'NC-1', snapshot: 'Reworded widening finding.', recordedAt: RECORDED_AT }],
  relationships: [{
    currentSourceId: 'NC-1', kind: 'same-case', caseId: 'prd-case-1', reason: 'The finding concerns the same behavior.',
  }],
};

function durableAction(overrides: Partial<RemediationCaseRecord> = {}): RemediationCaseRecord {
  return {
    id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'Fix it.', confidence: 'high', resolution: 'open',
    sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT }],
    effect: { id: 'effect-1', kind: 'action', status: 'applied', workOrderId: 'order-1' },
    ...overrides,
  };
}

function resolvedActionOwner(id: string, sourceId: string): RemediationCaseRecord {
  return durableAction({
    id,
    resolution: 'resolved',
    sources: [{ sourceId, outcome: 'acted', recordedAt: RECORDED_AT }],
    effect: { id: `effect-${id}`, kind: 'action', status: 'applied', workOrderId: `order-${id}` },
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('remediation case reconciler', () => {
  it('carries a rejected source-link transition and leaves the valid store bytes unchanged', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({
      value: null,
      nextState: {
        ...state,
        cases: [durableAction({
          id: 'case-O',
          sources: [
            { sourceId: 'source-S', outcome: 'acted', recordedAt: RECORDED_AT },
            { sourceId: 'source-T', outcome: 'acted', recordedAt: RECORDED_AT },
          ],
          effect: { id: 'effect-O', kind: 'action', status: 'applied', workOrderId: 'work-order-O' },
        })],
      },
    }));
    const before = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'new-case' }, [
        { sourceId: 'source-S', outcome: 'acted', caseRef: 'new-case' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: generatedIds('case-N', 'effect-N'),
    });

    expect([result, await readFile(remediationCaseStorePath(projectRoot), 'utf8')]).toEqual([{
      ok: false,
      reason: 'store-failure',
      storeReason: 'rejected-transition',
      violation: {
        invariant: 'source-linked-by-multiple-cases',
        caseIds: ['case-O', 'case-N'],
        sourceIds: ['source-S'],
      },
    }, before]);
  });

  it.each([
    ['interrupted unattempted action resumes', durableAction(), new Set<string>(), 'resume'],
    ['attempted action halts regardless of changed-tree facts outside the durable identity', durableAction(), new Set(['case-1']), 'halt-repeat'],
    ['resolved action regression halts before a second route', durableAction({ resolution: 'resolved' }), new Set<string>(), 'halt-regression'],
    ['deferred and rejected bindings reuse without another action route', { ...durableAction(), disposition: 'defer', effect: { id: 'effect-1', kind: 'deferral', status: 'applied', issueUrl: 'https://example.test/issues/1' } }, new Set(['case-1']), 'reuse'],
    ['refuted bindings reuse without another action route', durableAction({ disposition: 'refute', resolution: 'resolved', sources: [{ sourceId: 'testQuality:finding-1', outcome: 'refuted', recordedAt: RECORDED_AT }], effect: { kind: 'none' }, refutation: REFUTATION }), new Set(['case-1']), 'reuse'],
  ] as const)('%s', (_label, record, attempted, expected) => {
    expect(classifyRemediationCaseReuse(record, attempted)).toBe(expected);
  });

  const carryInput = { currentLapId: 'lap-2', effectiveAcceptedSourceIds: new Set(['testQuality:finding-1']) };
  const acceptedOnPriorLap = durableAction({
    resolution: 'resolved',
    operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-1' }] },
  });

  it.each([
    ['has an effective prior-lap acceptance origin', acceptedOnPriorLap, carryInput, true],
    ['was resolved by an operator', durableAction({ operatorResolution: { operator: 'operator', rationale: 'The case is resolved.', resolvedAt: RECORDED_AT } }), carryInput, true],
    ['has no acceptance origin', durableAction({ resolution: 'resolved' }), carryInput, false],
    ['has an origin from the current lap', { ...acceptedOnPriorLap, operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-2' }] } }, carryInput, false],
    ['has an origin no longer effectively accepted', acceptedOnPriorLap, { ...carryInput, effectiveAcceptedSourceIds: new Set<string>() }, false],
  ] as const)('is carry-eligible only when it %s', (_label, record, input, expected) => {
    expect(isCarryEligibleRemediationCase(record, input)).toBe(expected);
  });

  it.each([
    ['act', acceptedOnPriorLap, 'carry'],
    ['defer', { ...acceptedOnPriorLap, disposition: 'defer' as const, effect: { id: 'effect-1', kind: 'deferral' as const, status: 'applied' as const, issueUrl: 'https://example.test/issues/1' } }, 'carry'],
    ['reject', { ...acceptedOnPriorLap, disposition: 'reject' as const, effect: { kind: 'none' as const } }, 'carry'],
    ['refute', { ...acceptedOnPriorLap, disposition: 'refute' as const, effect: { kind: 'none' as const }, refutation: REFUTATION }, 'carry'],
    ['escalate', { ...acceptedOnPriorLap, disposition: 'escalate' as const, effect: { kind: 'none' as const }, escalation: { owner: 'plan' as const } }, 'carry'],
    ['a failed action without an acceptance origin', durableAction({ resolution: 'resolved', effect: { id: 'effect-1', kind: 'action', status: 'failed', diagnostic: 'failed' } }), 'halt-regression'],
    ['an open action with an acceptance origin', { ...acceptedOnPriorLap, resolution: 'open' as const }, 'resume'],
  ] as const)('classifies %s bindings before ordinary reuse', (_label, record, expected) => {
    expect(classifyRemediationCaseReuse(record, new Set<string>(), carryInput)).toBe(expected);
  });

  it.each([
    ['case-A', durableAction({ id: 'case-A' }), new Set(['case-A']), undefined, ['act', 'defer', 'refute']],
    ['case-U', durableAction({ id: 'case-U' }), new Set<string>(), undefined, ['act', 'defer']],
    ['case-R', durableAction({ id: 'case-R', effect: { id: 'effect-R', kind: 'action', status: 'reserved' } }), new Set<string>(), undefined, ['act']],
    ['case-J', durableAction({ id: 'case-J', disposition: 'reject', resolution: 'resolved', effect: { kind: 'none' } }), new Set<string>(), undefined, ['reject']],
    ['case-F', durableAction({ id: 'case-F', disposition: 'refute', resolution: 'resolved', effect: { kind: 'none' }, refutation: REFUTATION }), new Set<string>(), undefined, ['refute']],
    ['case-C', acceptedOnPriorLap, new Set<string>(), carryInput, ['act', 'advisory', 'defer', 'refute', 'reject']],
  ] as const)('lists only the dispositions bindable to %s', (_label, record, attemptedCaseIds, carry, expected) => {
    expect(bindableDispositions(record, attemptedCaseIds, carry)).toEqual(expected);
  });

  it('refuses a rejected binding to a reserved action without changing durable state', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: {
      ...state,
      cases: [durableAction({ id: 'case-R', effect: { id: 'effect-R', kind: 'action', status: 'reserved' } })],
    } }));
    const before = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    const result = await reconcileRemediationCases(store, {
      graph: graph({
        caseRef: 'rejected-reserved', existingCaseId: 'case-R', disposition: 'reject', priority: 'low',
        rationale: 'The reserved action cannot be rejected.', confidence: 'low', effect: { kind: 'none' },
      }, [{ sourceId: 'testQuality:F2', outcome: 'rejected', caseRef: 'rejected-reserved' }]),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: () => 'must-not-be-used',
    });

    expect([result, await readFile(remediationCaseStorePath(projectRoot), 'utf8')]).toEqual([
      { ok: false, reason: 'illegal-disposition-transition' }, before,
    ]);
  });

  // Covers: task:16, task:rem-prd-audit-R16c, task:rem-as-built-R16d
  it.each([
    ['a failed action with an effective origin', durableAction({
      effect: { id: 'effect-1', kind: 'action', status: 'failed', diagnostic: 'charge failed' },
      operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-old' }] },
    }), new Set(['testQuality:finding-1']), new Set(['testQuality:finding-1']), true, true],
    ['a reserved action with every source accepted this lap', durableAction({
      effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
    }), new Set(['testQuality:finding-1']), new Set(['testQuality:finding-1']), true, true],
    ['a failed action whose source is absent on a mechanically healthy lap', durableAction({
      effect: { id: 'effect-1', kind: 'action', status: 'failed', diagnostic: 'charge failed' },
    }), new Set<string>(), new Set<string>(), true, true],
    ['a failed action whose source is absent on a mechanically unhealthy lap', durableAction({
      effect: { id: 'effect-1', kind: 'action', status: 'failed', diagnostic: 'charge failed' },
    }), new Set<string>(), new Set<string>(), false, false],
    ['an open failed deferral whose sources are accepted', durableAction({
      disposition: 'defer', effect: { id: 'effect-1', kind: 'deferral', status: 'failed', diagnostic: 'intake failed' },
    }), new Set(['testQuality:finding-1']), new Set(['testQuality:finding-1']), true, false],
    ['an open reserved deferral whose sources are accepted', durableAction({
      disposition: 'defer', effect: { id: 'effect-1', kind: 'deferral', status: 'reserved' },
    }), new Set(['testQuality:finding-1']), new Set(['testQuality:finding-1']), true, false],
    ['an open decision stop whose sources are accepted', durableAction({
      disposition: 'escalate', effect: { kind: 'none' }, escalation: { owner: 'plan' },
    }), new Set(['testQuality:finding-1']), new Set(['testQuality:finding-1']), true, false],
    ['a failed action whose only origin was withdrawn while its source remains raised', durableAction({
      effect: { id: 'effect-1', kind: 'action', status: 'failed', diagnostic: 'charge failed' },
      operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-old' }] },
    }), new Set<string>(), new Set(['testQuality:finding-1']), true, false],
  ] as const)('retires open cases only when %s', (_label, record, effectiveAcceptedSourceIds, liveSourceIds, mechanicallyHealthy, expected) => {
    expect(retiresOpenBuildReviewCase(record, {
      liveSourceIds, effectiveAcceptedSourceIds, mechanicallyHealthy,
    })).toBe(expected);
  });

  // Covers: task:rem-as-built-R16e
  it.each([
    ['action', durableAction({ effect: { id: 'effect-1', kind: 'action', status: 'reserved' } })],
    ['deferral', durableAction({ disposition: 'defer', effect: { id: 'effect-1', kind: 'deferral', status: 'reserved' } })],
  ] as const)('never resolves a reserved %s effect without failing it', (_label, record) => {
    expect(retireOpenBuildReviewCase(record)).toMatchObject({
      resolution: 'resolved', effect: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('stamps engine-owned case and effect ids for a new proposed case', async () => {
    const projectRoot = await createProjectRoot();
    const result = await reconcileRemediationCases(new RemediationCaseStore(projectRoot, FEATURE), {
      graph: graph(ACTION_CASE),
      recordedAt: RECORDED_AT,
      generateId: generatedIds('case-1', 'effect-1'),
    });

    expect(result).toEqual({
      ok: true,
      caseIdsByRef: new Map([['new-action', 'case-1']]),
      // Nothing prior was absent, so no unreferenced case transitioned.
      resolvedAbsentCaseIds: [],
      state: {
        version: 'v3',
        feature: FEATURE,
        suppressions: [],
        outbox: [],
        prdWideningCases: [],
        cases: [{
          id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high',
          rationale: ACTION_CASE.rationale, confidence: 'high', resolution: 'open',
          sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT }],
          effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
        }],
      },
    });
  });

  // Covers: task:4
  it('stamps a resolved action owner as the recurrence of an unbound action case', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({
      value: null,
      nextState: {
        ...state,
        cases: [resolvedActionOwner('case-R', 'source-S')],
      },
    }));
    const before = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'case-N' }, [
        { sourceId: 'source-S', outcome: 'acted', caseRef: 'case-N' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: generatedIds('case-N', 'effect-N'),
    });
    const after = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    expect(result).toMatchObject({
      ok: true,
      state: {
        cases: [
          { id: 'case-R' },
          {
            id: 'case-N',
            resolution: 'open',
            recurrenceOf: ['case-R'],
            effect: { id: 'effect-N', kind: 'action', status: 'reserved' },
          },
        ],
      },
    });
    expect(JSON.stringify(JSON.parse(after).cases[0])).toBe(JSON.stringify(JSON.parse(before).cases[0]));

    const replay = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'case-N' }, [
        { sourceId: 'source-S', outcome: 'acted', caseRef: 'case-N' },
      ]),
      recordedAt: '2026-08-30T14:00:00.000Z',
      generateId: () => { throw new Error('a converged recurrence must not mint ids'); },
    });

    expect(replay).toMatchObject({
      ok: true,
      caseIdsByRef: new Map([['case-N', 'case-N']]),
      state: { cases: [{ id: 'case-R' }, { id: 'case-N', recurrenceOf: ['case-R'] }] },
    });
    expect(replay.ok && replay.state.cases).toHaveLength(2);
  });

  it('stamps every resolved action owner as a recurrence for an unbound multi-source action case', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({
      value: null,
      nextState: { ...state, cases: [
        resolvedActionOwner('case-R1', 'source-S1'),
        resolvedActionOwner('case-R2', 'source-S2'),
      ] },
    }));

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'case-N' }, [
        { sourceId: 'source-S1', outcome: 'acted', caseRef: 'case-N' },
        { sourceId: 'source-S2', outcome: 'acted', caseRef: 'case-N' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: generatedIds('case-N', 'effect-N'),
    });

    expect(result).toMatchObject({
      ok: true,
      state: { cases: [{ id: 'case-R1' }, { id: 'case-R2' }, { id: 'case-N', recurrenceOf: ['case-R1', 'case-R2'] }] },
    });
  });

  it('retains a declared distinction instead of stamping its resolved action owner as a recurrence', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({
      value: null,
      nextState: { ...state, cases: [resolvedActionOwner('case-R', 'source-S')] },
    }));
    const before = await readFile(remediationCaseStorePath(projectRoot), 'utf8');
    const reason = 'asserts daemon-liveness staleness, not in-flight age';

    const result = await reconcileRemediationCases(store, {
      graph: graph({
        ...ACTION_CASE,
        caseRef: 'case-N',
        distinctFrom: [{ caseId: 'case-R', reason }],
      }, [{ sourceId: 'source-S', outcome: 'acted', caseRef: 'case-N' }]),
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: generatedIds('case-N', 'effect-N'),
    });
    const after = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    expect(result).toMatchObject({
      ok: true,
      state: {
        cases: [
          { id: 'case-R' },
          { id: 'case-N', distinctFrom: [{ caseId: 'case-R', reason }] },
        ],
      },
    });
    expect(result.ok && result.state.cases[1]).not.toHaveProperty('recurrenceOf');
    expect(JSON.stringify(JSON.parse(after).cases[0])).toBe(JSON.stringify(JSON.parse(before).cases[0]));
  });

  it('retains a declared distinction while classifying the remaining resolved action owners as recurrences', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({
      value: null,
      nextState: { ...state, cases: [
        resolvedActionOwner('case-R1', 'source-S1'),
        resolvedActionOwner('case-R2', 'source-S2'),
      ] },
    }));
    const before = await readFile(remediationCaseStorePath(projectRoot), 'utf8');
    const reason = 'asserts daemon-liveness staleness, not in-flight age';

    const result = await reconcileRemediationCases(store, {
      graph: graph({
        ...ACTION_CASE,
        caseRef: 'case-N',
        distinctFrom: [{ caseId: 'case-R1', reason }],
      }, [
        { sourceId: 'source-S1', outcome: 'acted', caseRef: 'case-N' },
        { sourceId: 'source-S2', outcome: 'acted', caseRef: 'case-N' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: generatedIds('case-N', 'effect-N'),
    });
    const after = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    expect(result).toMatchObject({
      ok: true,
      state: {
        cases: [
          { id: 'case-R1' },
          { id: 'case-R2' },
          {
            id: 'case-N',
            distinctFrom: [{ caseId: 'case-R1', reason }],
            recurrenceOf: ['case-R2'],
          },
        ],
      },
    });
    expect(JSON.parse(after).cases.slice(0, 2)).toEqual(JSON.parse(before).cases);
  });

  it.each([
    ['unbound defer', {
      caseRef: 'new-defer', disposition: 'defer', priority: 'medium',
      rationale: 'The remaining work belongs outside the current feature.', confidence: 'medium',
      effect: { kind: 'deferral', title: 'Follow up', body: 'This is not owned here.', exclusionRationale: 'Outside the approved scope.' },
    }, [{ sourceId: 'source-S', outcome: 'deferred', caseRef: 'new-defer' }], ['case-N', 'effect-N']],
    ['unbound reject', {
      caseRef: 'new-reject', disposition: 'reject', priority: 'low',
      rationale: 'The concern does not require a change.', confidence: 'high', effect: { kind: 'none' },
    }, [{ sourceId: 'source-S', outcome: 'rejected', caseRef: 'new-reject' }], ['case-N']],
    ['existingCaseId-bound action', {
      caseRef: 'bound-action', existingCaseId: 'case-B', disposition: 'act', priority: 'high',
      rationale: ACTION_CASE.rationale, confidence: 'high', effect: ACTION_CASE.effect,
    }, [{ sourceId: 'source-T', outcome: 'acted', caseRef: 'bound-action' }], []],
  ] as const)('ignores a distinctFrom declaration on an %s row', async (_label, row, sources, ids) => {
    const declaredRoot = await createProjectRoot();
    const undeclaredRoot = await createProjectRoot();
    const declaredStore = new RemediationCaseStore(declaredRoot, FEATURE);
    const undeclaredStore = new RemediationCaseStore(undeclaredRoot, FEATURE);
    const existingCaseId = 'existingCaseId' in row ? row.existingCaseId : undefined;
    const priorCases = existingCaseId
      ? [durableAction({ id: 'case-B', sources: [{ sourceId: 'source-S', outcome: 'acted', recordedAt: RECORDED_AT }] })]
      : [resolvedActionOwner('case-R', 'source-S')];
    for (const store of [declaredStore, undeclaredStore]) {
      await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: priorCases } }));
    }
    const declaration = [{ caseId: existingCaseId ?? 'case-R', reason: 'The declaration must not govern this row.' }];

    const [declared, undeclared] = await Promise.all([
      reconcileRemediationCases(declaredStore, {
        graph: graph({ ...row, distinctFrom: declaration }, sources),
        recordedAt: '2026-08-30T13:00:00.000Z', generateId: generatedIds(...ids),
      }),
      reconcileRemediationCases(undeclaredStore, {
        graph: graph(row, sources),
        recordedAt: '2026-08-30T13:00:00.000Z', generateId: generatedIds(...ids),
      }),
    ]);

    expect(declared).toMatchObject({ ok: true });
    expect(declared).toEqual(undeclared);
    if (!declared.ok) throw new Error(`expected reconciliation to succeed, got ${declared.reason}`);
    expect(declared.state.cases.at(-1)).not.toHaveProperty('recurrenceOf');
    expect(declared.state.cases.at(-1)).not.toHaveProperty('distinctFrom');
  });

  it.each([
    ['an open action case', [durableAction({ id: 'case-O' })], 'case-O'],
    ['no case', [], 'case-N'],
  ] as const)('leaves an unbound act row unstamped when its source has %s as its owner', async (_label, cases, expectedCaseId) => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases } }));

    const result = await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: expectedCaseId === 'case-O' ? () => { throw new Error('an open case must converge'); } : generatedIds('case-N', 'effect-N'),
    });

    expect(result).toMatchObject({ ok: true, caseIdsByRef: new Map([['new-action', expectedCaseId]]) });
    if (!result.ok) throw new Error(`expected reconciliation to succeed, got ${result.reason}`);
    const record = result.state.cases.find((caseRecord) => caseRecord.id === expectedCaseId);
    expect(record).not.toHaveProperty('recurrenceOf');
    expect(record).not.toHaveProperty('distinctFrom');
  });

  it('drops an unknown distinctFrom declaration while retaining the resolved owner as a recurrence', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [resolvedActionOwner('case-R', 'source-S')] } }));

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'case-N', distinctFrom: [{ caseId: 'case-unknown', reason: 'This declaration names no owner.' }] }, [
        { sourceId: 'source-S', outcome: 'acted', caseRef: 'case-N' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: generatedIds('case-N', 'effect-N'),
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [
      { id: 'case-R' }, { id: 'case-N', recurrenceOf: ['case-R'] },
    ] } });
    if (!result.ok) throw new Error(`expected reconciliation to succeed, got ${result.reason}`);
    const record = result.state.cases.find((caseRecord) => caseRecord.id === 'case-N');
    expect(record).not.toHaveProperty('distinctFrom');
    expect(JSON.stringify(record)).not.toContain('case-unknown');
  });

  it('does not infer distinction from two unbound act rows whose rationale only says they are distinct', async () => {
    const roots = await Promise.all([createProjectRoot(), createProjectRoot()]);
    const stores = roots.map((root) => new RemediationCaseStore(root, FEATURE));
    await Promise.all(stores.map((store) => store.mutate(async (state) => ({
      value: null, nextState: { ...state, cases: [resolvedActionOwner('case-R', 'source-S')] },
    }))));
    const rationales = [
      'This concern is distinct from case-R despite sharing its source.',
      'This separately raised concern is distinct from case-R despite sharing its source.',
    ];

    const results = await Promise.all(stores.map((store, index) => reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: `case-N${index + 1}`, rationale: rationales[index]! }, [
        { sourceId: 'source-S', outcome: 'acted', caseRef: `case-N${index + 1}` },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: generatedIds(`case-N${index + 1}`, `effect-N${index + 1}`),
    })));

    for (const [index, result] of results.entries()) {
      const caseId = `case-N${index + 1}`;
      expect(result).toMatchObject({ ok: true, state: { cases: [{ id: 'case-R' }, { id: caseId, recurrenceOf: ['case-R'] }] } });
      if (!result.ok) throw new Error(`expected reconciliation to succeed, got ${result.reason}`);
      expect(result.state.cases.find((record) => record.id === caseId)).not.toHaveProperty('distinctFrom');
    }
  });

  it('reuses an exact settled custom non-action case without a new identity, but retains history after its policy identity changes', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    const exactSource = 'portablePolicy:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await store.mutate(async (state) => ({
      value: null,
      nextState: {
        ...state,
        cases: [{
          id: 'settled-custom', domain: 'build_review', disposition: 'reject', priority: 'low', confidence: 'high',
          rationale: 'The exact custom finding was rejected.', resolution: 'resolved',
          sources: [{ sourceId: exactSource, outcome: 'rejected', recordedAt: RECORDED_AT }], effect: { kind: 'none' },
        }],
      },
    }));

    const exact = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'exact-custom', disposition: 'reject', effect: { kind: 'none' } }, [
        { sourceId: exactSource, outcome: 'rejected', caseRef: 'exact-custom' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: () => { throw new Error('exact non-action recurrence must not charge'); },
    });
    expect(exact).toMatchObject({ ok: true, caseIdsByRef: new Map([['exact-custom', 'settled-custom']]) });

    const changedPolicy = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'changed-custom', disposition: 'reject', effect: { kind: 'none' } }, [
        { sourceId: 'portablePolicy:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', outcome: 'rejected', caseRef: 'changed-custom' },
      ]),
      recordedAt: '2026-08-30T14:00:00.000Z', generateId: generatedIds('changed-custom'),
    });
    expect(changedPolicy).toMatchObject({ ok: true, caseIdsByRef: new Map([['changed-custom', 'changed-custom']]) });
    expect(changedPolicy.ok && changedPolicy.state.cases.map((entry) => entry.id)).toEqual(['settled-custom', 'changed-custom']);
  });

  it('appends a later source link to its explicitly bound durable case', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'known-action', existingCaseId: 'case-1' }, [
        { sourceId: 'testQuality:finding-2', outcome: 'acted', caseRef: 'known-action' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
    });

    expect(result).toMatchObject({
      ok: true,
      state: {
        cases: [{
          id: 'case-1',
          sources: [
            { sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT },
            { sourceId: 'testQuality:finding-2', outcome: 'acted', recordedAt: '2026-08-30T13:00:00.000Z' },
          ],
        }],
      },
    });
  });

  it('carries a newly bound source and atomically queues its acceptance occurrence', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    const acceptedCase = durableAction({
      id: 'case-C',
      resolution: 'resolved',
      operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-1' }] },
    });
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [acceptedCase] } }));

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'carry-case', existingCaseId: 'case-C' }, [
        { sourceId: 'testQuality:finding-2', outcome: 'acted', caseRef: 'carry-case' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: generatedIds('carry-event-1'),
      carry: { caseRefs: ['carry-case'], lapId: 'lap-2' },
    });

    expect(result).toMatchObject({
      ok: true,
      state: {
        cases: [{
          id: 'case-C', disposition: 'act', resolution: 'resolved',
          effect: { id: 'effect-1', kind: 'action', status: 'applied', workOrderId: 'order-1' },
          operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-1' }] },
          sources: [
            { sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT },
            { sourceId: 'testQuality:finding-2', outcome: 'carried', recordedAt: '2026-08-30T13:00:00.000Z' },
          ],
        }],
        outbox: [{
          eventId: 'carry-event-1', occurredAt: '2026-08-30T13:00:00.000Z',
          event: {
            type: 'build_review_acceptance_carried', eventId: 'carry-event-1', feature: 'case-reconciler',
            lapId: 'lap-2', sourceId: 'testQuality:finding-2', caseId: 'case-C',
            originSourceIds: ['testQuality:finding-1'], originLapIds: ['lap-1'],
          },
        }],
      },
    });
  });

  it('does not duplicate a carried link or its outbox occurrence on replay', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: {
      ...state,
      cases: [durableAction({
        id: 'case-C', resolution: 'resolved',
        operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-1' }] },
      })],
    } }));
    const input = {
      graph: graph({ ...ACTION_CASE, caseRef: 'carry-case', existingCaseId: 'case-C' }, [
        { sourceId: 'testQuality:finding-2', outcome: 'acted', caseRef: 'carry-case' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z', carry: { caseRefs: ['carry-case'], lapId: 'lap-2' },
    };

    await reconcileRemediationCases(store, { ...input, generateId: generatedIds('carry-event-1') });
    const replay = await reconcileRemediationCases(store, { ...input, generateId: () => 'must-not-be-used' });

    expect(replay).toMatchObject({
      ok: true,
      state: {
        cases: [{ sources: [
          { sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT },
          { sourceId: 'testQuality:finding-2', outcome: 'carried', recordedAt: '2026-08-30T13:00:00.000Z' },
        ] }],
        outbox: [{ eventId: 'carry-event-1' }],
      },
    });
  });

  it.each([
    ['defer', { kind: 'deferral', title: 'Follow up', body: 'Deferred outside this feature.', exclusionRationale: 'Not owned here.' }, 'deferred'],
    ['refute', { kind: 'none' }, 'refuted'],
  ] as const)('routes a carried %s before its deferral or refutation transition', async (disposition, effect, outcome) => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    const accepted: RemediationCaseRecord = disposition === 'refute'
      ? { ...durableAction({ id: 'case-C', resolution: 'resolved' }), disposition: 'refute', effect: { kind: 'none' }, refutation: REFUTATION,
        operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-1' }] } }
      : durableAction({ id: 'case-C', resolution: 'resolved', operatorAcceptance: { origins: [{ sourceId: 'testQuality:finding-1', lapId: 'lap-1' }] } });
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [accepted] } }));
    const caseRow = disposition === 'refute'
      ? { ...REFUTE_CASE, caseRef: 'carried-non-action', existingCaseId: 'case-C' }
      : { caseRef: 'carried-non-action', existingCaseId: 'case-C', disposition, priority: 'high' as const, rationale: 'Carry accepted risk.', confidence: 'high' as const, effect };
    const result = await reconcileRemediationCases(store, {
      graph: graph(caseRow as RemediationCaseGraph['cases'][number]['case'], [{ sourceId: 'testQuality:finding-2', outcome, caseRef: 'carried-non-action' }]),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: generatedIds('carry-event'),
      carry: { caseRefs: ['carried-non-action'], lapId: 'lap-2' },
    });
    expect(result).toMatchObject({ ok: true, state: { cases: [expect.objectContaining({
      id: 'case-C', disposition: accepted.disposition, resolution: 'resolved', effect: accepted.effect,
      sources: expect.arrayContaining([expect.objectContaining({ sourceId: 'testQuality:finding-2', outcome: 'carried' })]),
    })] } });
  });

  it('admits one attempted applied action case as a resolved refutation', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [durableAction()] } }));

    const result = await reconcileRemediationCases(store, {
      graph: refuteGraph(),
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
      attemptedCaseIds: ['case-1'],
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [{
      id: 'case-1', disposition: 'refute', resolution: 'resolved', effect: { kind: 'none' }, refutation: REFUTATION,
      sources: [
        { sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT },
        { sourceId: 'testQuality:finding-2', outcome: 'refuted', recordedAt: '2026-08-30T13:00:00.000Z' },
      ],
    }] } });
  });

  describe('deferral after an applied action', () => {
    const DEFER_AFTER_ACT = {
      caseRef: 'defer-case-1', existingCaseId: 'case-1', disposition: 'defer', priority: 'medium',
      rationale: 'The repair was applied and the finding is back; the remaining fix contradicts the approved plan.',
      confidence: 'medium',
      effect: { kind: 'deferral', title: 'Follow up outside this plan', body: 'The real fix exceeds the Done-when.', exclusionRationale: 'The approved task prescribes the flagged design.' },
    } as const;
    const deferGraph = graph(DEFER_AFTER_ACT, [{ sourceId: 'testQuality:finding-1', outcome: 'deferred', caseRef: 'defer-case-1' }]);

    it.each([
      ['an open applied action', durableAction()],
      ['a resolved applied action whose finding regressed', durableAction({ resolution: 'resolved' })],
    ])('admits %s as a reserved deferral on the same case', async (_label, existing) => {
      const projectRoot = await createProjectRoot();
      const store = new RemediationCaseStore(projectRoot, FEATURE);
      await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [existing] } }));

      const result = await reconcileRemediationCases(store, {
        graph: deferGraph,
        recordedAt: '2026-08-30T13:00:00.000Z',
        generateId: generatedIds('deferral-effect-1'),
        attemptedCaseIds: [],
      });

      expect(result).toMatchObject({ ok: true, state: { cases: [{
        id: 'case-1', disposition: 'defer', resolution: 'open', priority: 'medium', confidence: 'medium',
        effect: { id: 'deferral-effect-1', kind: 'deferral', status: 'reserved' },
        sources: [{ sourceId: 'testQuality:finding-1', outcome: 'deferred', recordedAt: '2026-08-30T13:00:00.000Z' }],
      }] } });
      expect(result.ok && result.state.cases[0]).not.toHaveProperty('refutation');
      expect(result.ok && classifyRemediationCaseReuse(result.state.cases[0]!, new Set(['case-1']))).toBe('reuse');
    });

    it('still refuses a deferral when the action was never applied', async () => {
      const projectRoot = await createProjectRoot();
      const store = new RemediationCaseStore(projectRoot, FEATURE);
      await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [
        durableAction({ effect: { id: 'effect-1', kind: 'action', status: 'reserved' } }),
      ] } }));

      const result = await reconcileRemediationCases(store, {
        graph: deferGraph,
        recordedAt: '2026-08-30T13:00:00.000Z',
        generateId: () => 'must-not-be-used',
        attemptedCaseIds: [],
      });

      expect(result).toEqual({ ok: false, reason: 'illegal-disposition-transition' });
    });
  });

  it('rewrites an attempted action source in place when its exact id is refuted', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [durableAction()] } }));

    const result = await reconcileRemediationCases(store, {
      graph: graph(REFUTE_CASE, [{ sourceId: 'testQuality:finding-1', outcome: 'refuted', caseRef: 'refute-case-1' }]),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: () => 'must-not-be-used', attemptedCaseIds: ['case-1'],
    });
    const reparsed = await store.read();

    expect(result).toMatchObject({ ok: true, state: { cases: [{
      id: 'case-1', disposition: 'refute', resolution: 'resolved',
      sources: [{ sourceId: 'testQuality:finding-1', outcome: 'refuted', recordedAt: '2026-08-30T13:00:00.000Z' }],
    }] } });
    expect(reparsed.ok && reparsed.state.cases[0]?.sources).toEqual([
      { sourceId: 'testQuality:finding-1', outcome: 'refuted', recordedAt: '2026-08-30T13:00:00.000Z' },
    ]);
  });

  it('rejects a non-refutation exact-id outcome mismatch without changing durable state', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [durableAction()] } }));
    const before = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'same-action', existingCaseId: 'case-1' }, [
        { sourceId: 'testQuality:finding-1', outcome: 'refuted', caseRef: 'same-action' },
      ]),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: () => 'must-not-be-used',
    });

    expect([result, await readFile(remediationCaseStorePath(projectRoot), 'utf8')]).toEqual([
      { ok: false, reason: 'illegal-source-link' }, before,
    ]);
  });

  it('reserves a supplied refutation deferral effect under a new engine-owned identity', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [durableAction()] } }));

    const result = await reconcileRemediationCases(store, {
      graph: refuteGraph({ ...REFUTE_CASE, effect: {
        kind: 'deferral', title: 'Follow up elsewhere', body: 'Track the narrowly excluded concern.', exclusionRationale: 'Out of scope for this repair.',
      } }),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: generatedIds('effect-refute'), attemptedCaseIds: ['case-1'],
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [{
      id: 'case-1', disposition: 'refute', resolution: 'resolved',
      effect: { id: 'effect-refute', kind: 'deferral', status: 'reserved' }, refutation: REFUTATION,
    }] } });
  });

  it.each([
    ['an unattempted action case', durableAction(), [], 'illegal-disposition-transition'],
    ['a reserved action effect', durableAction({ effect: { id: 'effect-1', kind: 'action', status: 'reserved' } }), ['case-1'], 'illegal-disposition-transition'],
    ['a failed action effect', durableAction({ effect: { id: 'effect-1', kind: 'action', status: 'failed', diagnostic: 'work order failed' } }), ['case-1'], 'illegal-disposition-transition'],
    ['a deferred case', durableAction({ disposition: 'defer', sources: [{ sourceId: 'testQuality:finding-1', outcome: 'deferred', recordedAt: RECORDED_AT }], effect: { id: 'effect-1', kind: 'deferral', status: 'applied', issueUrl: 'https://example.test/issues/1' } }), [], 'illegal-disposition-transition'],
    ['a rejected case', durableAction({ disposition: 'reject', sources: [{ sourceId: 'testQuality:finding-1', outcome: 'rejected', recordedAt: RECORDED_AT }], effect: { kind: 'none' } }), [], 'illegal-disposition-transition'],
    ['an already refuted case', durableAction({ disposition: 'refute', resolution: 'resolved', sources: [{ sourceId: 'testQuality:finding-1', outcome: 'refuted', recordedAt: RECORDED_AT }], effect: { kind: 'none' }, refutation: REFUTATION }), [], 'refutation-repeat'],
  ] as const)('rejects a refutation bound to %s without changing durable state', async (_description, record, attemptedCaseIds, reason) => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({ value: null, nextState: { ...state, cases: [record] } }));
    const before = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    const result = await reconcileRemediationCases(store, {
      graph: refuteGraph(), recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used', attemptedCaseIds,
    });

    expect([result, await readFile(remediationCaseStorePath(projectRoot), 'utf8')]).toEqual([
      { ok: false, reason }, before,
    ]);
  });

  it('retains PRD widening history while reconciling a build-review case', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await store.mutate(async (state) => ({
      value: undefined,
      nextState: {
        version: 'v2', feature: state.feature, cases: state.cases,
        prdWideningCases: [PRD_WIDENING_CASE], suppressions: state.suppressions ?? [],
      },
    }));

    const result = await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });

    expect(result).toMatchObject({ ok: true, state: { prdWideningCases: [PRD_WIDENING_CASE] } });
    await expect(store.read()).resolves.toMatchObject({
      ok: true,
      state: { prdWideningCases: [PRD_WIDENING_CASE] },
    });
  });

  it('resolves an absent open action case only after recorded BUILD attempt evidence', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });
    // Attempt evidence exists only once the action effect applied and its work
    // order was published; mirror that durable shape before attempting.
    await store.mutate(async (state) => ({
      value: null,
      nextState: {
        ...state,
        cases: state.cases.map((record) => record.id === 'case-1' && record.effect.kind === 'action'
          ? { ...record, effect: { id: record.effect.id, kind: 'action' as const, status: 'applied' as const, workOrderId: 'order-1' } }
          : record),
      },
    }));

    const result = await reconcileRemediationCases(store, {
      graph: { sourceOutcomes: [], cases: [] },
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
      attemptedCaseIds: ['case-1'],
      mechanicallyHealthy: true,
      allowAppliedByAbsence: true,
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [{ id: 'case-1', resolution: 'resolved' }] } });
  });

  // Covers: task:16, task:rem-as-built-R16a
  it.each(['reserved', 'failed'] as const)('retires an attempted absent action case with a %s effect on a healthy lap', async (status) => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });
    await store.mutate(async (state) => ({
      value: null,
      nextState: {
        ...state,
        cases: state.cases.map((record) => record.id === 'case-1' && record.effect.kind === 'action'
          ? {
            ...record,
            effect: status === 'reserved'
              ? { id: record.effect.id, kind: 'action' as const, status: 'reserved' as const }
              : { id: record.effect.id, kind: 'action' as const, status: 'failed' as const, diagnostic: 'charge failed' },
          }
          : record),
      },
    }));

    const result = await reconcileRemediationCases(store, {
      graph: { sourceOutcomes: [], cases: [] },
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
      attemptedCaseIds: ['case-1'],
      mechanicallyHealthy: true,
      lapId: 'lap-settlement',
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [{
      id: 'case-1', resolution: 'resolved', effect: {
        status: 'failed', diagnostic: status === 'reserved'
          ? 'retired: every source operator-accepted or no longer raised'
          : 'charge failed',
      },
    }] }, resolvedAbsentCaseIds: ['case-1'] });
    expect(result).toMatchObject({ state: { outbox: [expect.objectContaining({
      eventId: expect.any(String), event: expect.objectContaining({
        type: 'remediation_case_reconciled', caseId: 'case-1', resolution: 'resolved',
      }),
    })] } });
  });

  it('keeps an absent open action case open without recorded BUILD attempt evidence', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });

    const result = await reconcileRemediationCases(store, {
      graph: { sourceOutcomes: [], cases: [] },
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [{ id: 'case-1', resolution: 'open' }] } });
  });

  it.each(['reserved', 'failed'] as const)('keeps an absent open non-action case with a %s effect open on a clean settlement', async (status) => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    const seeded = await store.mutate(async (state) => ({
      value: null,
      nextState: {
        ...state,
        cases: [{
          id: 'case-deferred', domain: 'build_review', disposition: 'defer', priority: 'low', confidence: 'high',
          rationale: 'Belongs outside this feature.', resolution: 'open',
          sources: [{ sourceId: 'testQuality:finding-1', outcome: 'deferred', recordedAt: RECORDED_AT }],
          effect: status === 'reserved'
            ? { id: 'effect-deferred', kind: 'deferral', status }
            : { id: 'effect-deferred', kind: 'deferral', status, diagnostic: 'tracker unavailable' },
        }],
      },
    }));
    expect(seeded.ok).toBe(true);

    const result = await reconcileRemediationCases(store, {
      graph: { sourceOutcomes: [], cases: [] },
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
      mechanicallyHealthy: true,
      resolveAbsentOpenNonActionCases: true,
    });

    // Shared effect-status test: a reserved/failed effect is durable
    // unfinished evidence and must never resolve by benign absence into PASS.
    expect(result).toMatchObject({
      ok: true,
      state: { cases: [{ id: 'case-deferred', resolution: 'open' }] },
      resolvedAbsentCaseIds: [],
    });
  });

  it('still settles an absent open non-action case whose deferral effect applied', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    const seeded = await store.mutate(async (state) => ({
      value: null,
      nextState: {
        ...state,
        cases: [{
          id: 'case-deferred', domain: 'build_review', disposition: 'defer', priority: 'low', confidence: 'high',
          rationale: 'Belongs outside this feature.', resolution: 'open',
          sources: [{ sourceId: 'testQuality:finding-1', outcome: 'deferred', recordedAt: RECORDED_AT }],
          effect: { id: 'effect-deferred', kind: 'deferral', status: 'applied', issueUrl: 'https://example.test/issues/1' },
        }],
      },
    }));
    expect(seeded.ok).toBe(true);

    const result = await reconcileRemediationCases(store, {
      graph: { sourceOutcomes: [], cases: [] },
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
      mechanicallyHealthy: true,
      resolveAbsentOpenNonActionCases: true,
    });

    expect(result).toMatchObject({
      ok: true,
      state: { cases: [{ id: 'case-deferred', resolution: 'resolved' }] },
      resolvedAbsentCaseIds: ['case-deferred'],
    });
  });

  it.each([
    ['unknown', 'missing-case', undefined, 'unknown-case-binding'],
    ['foreign', 'foreign-case', ['foreign-case'], 'foreign-case-binding'],
  ] as const)('rejects a %s existing case binding without mutating the store', async (_name, existingCaseId, foreignCaseIds, reason) => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    const before = await readFile(remediationCaseStorePath(projectRoot)).catch(() => 'missing');

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, existingCaseId }),
      recordedAt: RECORDED_AT,
      generateId: () => 'must-not-be-used',
      foreignCaseIds,
    });

    expect([result, await readFile(remediationCaseStorePath(projectRoot)).catch(() => 'missing')]).toEqual([
      { ok: false, reason }, before,
    ]);
  });

  it('rejects an illegal disposition transition without deleting historical source traces', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });
    const before = await readFile(remediationCaseStorePath(projectRoot), 'utf8');

    const result = await reconcileRemediationCases(store, {
      graph: graph({
        caseRef: 'wrong-transition', existingCaseId: 'case-1', disposition: 'reject', priority: 'low',
        rationale: 'This should not replace the durable disposition.', confidence: 'low', effect: { kind: 'none' },
      }),
      recordedAt: '2026-08-30T13:00:00.000Z', generateId: () => 'must-not-be-used',
    });

    expect([result, await readFile(remediationCaseStorePath(projectRoot), 'utf8')]).toEqual([
      { ok: false, reason: 'illegal-disposition-transition' }, before,
    ]);
  });
  it.each([
    ['an unbound equivalent proposal', ACTION_CASE],
    ['an explicitly bound proposal', { ...ACTION_CASE, existingCaseId: 'case-1' }],
  ] as const)('keeps %s on the first stamped identity instead of a second one', async (_origin, replayedCase) => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    const first = await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });
    // A crash between the store write and the coordinator's next step replays
    // the identical judgement under the same lease.
    const second = await reconcileRemediationCases(store, {
      graph: graph(replayedCase), recordedAt: '2026-08-30T12:05:00.000Z', generateId: generatedIds('case-2', 'effect-2'),
    });

    expect(first.ok && first.state.cases).toHaveLength(1);
    expect(second.ok && second.state.cases).toEqual([{
      id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high',
      rationale: ACTION_CASE.rationale, confidence: 'high', resolution: 'open',
      sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT }],
      effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
    }]);
    expect(second.ok && second.caseIdsByRef.get('new-action')).toBe('case-1');
  });

  it('reports the durable identity for every proposed reference, stamped or bound', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    // `mutate` is the store's only write seam; seeding goes through it too.
    const seeded = await store.mutate(async () => ({
      value: null, nextState: { version: 'v1' as const, feature: FEATURE, cases: [durableAction()] },
    }));
    if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);

    const result = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'bound', existingCaseId: 'case-1' } as never),
      recordedAt: RECORDED_AT, generateId: generatedIds('unused'),
    });

    expect(result.ok && [...result.caseIdsByRef]).toEqual([['bound', 'case-1']]);
  });

  it('stamps a materially distinct later case rather than converging it', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });

    const distinct = await reconcileRemediationCases(store, {
      graph: graph({ ...ACTION_CASE, caseRef: 'later-action' } as never, [
        { sourceId: 'testQuality:finding-2', outcome: 'acted', caseRef: 'later-action' },
      ] as never),
      recordedAt: '2026-08-30T12:05:00.000Z', generateId: generatedIds('case-2', 'effect-2'),
    });

    expect(distinct.ok && distinct.state.cases.map((record) => record.id)).toEqual(['case-1', 'case-2']);
    expect(distinct.ok && distinct.caseIdsByRef.get('later-action')).toBe('case-2');
  });
});
