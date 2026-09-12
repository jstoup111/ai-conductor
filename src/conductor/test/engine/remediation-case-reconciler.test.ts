// Covers: task:5
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classifyRemediationCaseReuse, reconcileRemediationCases } from '../../src/engine/remediation-case-reconciler.js';
import type { RemediationCaseRecord } from '../../src/engine/remediation-case-store.js';
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

function durableAction(overrides: Partial<RemediationCaseRecord> = {}): RemediationCaseRecord {
  return {
    id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high', rationale: 'Fix it.', confidence: 'high', resolution: 'open',
    sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT }],
    effect: { id: 'effect-1', kind: 'action', status: 'applied', workOrderId: 'order-1' },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('remediation case reconciler', () => {
  it.each([
    ['interrupted unattempted action resumes', durableAction(), new Set<string>(), 'resume'],
    ['attempted action halts regardless of changed-tree facts outside the durable identity', durableAction(), new Set(['case-1']), 'halt-repeat'],
    ['resolved action regression halts before a second route', durableAction({ resolution: 'resolved' }), new Set<string>(), 'halt-regression'],
    ['deferred and rejected bindings reuse without another action route', { ...durableAction(), disposition: 'defer', effect: { id: 'effect-1', kind: 'deferral', status: 'applied', issueUrl: 'https://example.test/issues/1' } }, new Set(['case-1']), 'reuse'],
    ['refuted bindings reuse without another action route', durableAction({ disposition: 'refute', resolution: 'resolved', sources: [{ sourceId: 'testQuality:finding-1', outcome: 'refuted', recordedAt: RECORDED_AT }], effect: { kind: 'none' }, refutation: REFUTATION }), new Set(['case-1']), 'reuse'],
  ] as const)('%s', (_label, record, attempted, expected) => {
    expect(classifyRemediationCaseReuse(record, attempted)).toBe(expected);
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
        version: 'v1',
        feature: FEATURE,
        suppressions: [],
        cases: [{
          id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high',
          rationale: ACTION_CASE.rationale, confidence: 'high', resolution: 'open',
          sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT }],
          effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
        }],
      },
    });
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
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [{ id: 'case-1', resolution: 'resolved' }] } });
  });

  it.each(['reserved', 'failed'] as const)('keeps an attempted absent action case with a %s effect open', async (status) => {
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

    // Same shared effect-status test as the non-action branch: attempt
    // membership alone never resolves unfinished durable evidence.
    const result = await reconcileRemediationCases(store, {
      graph: { sourceOutcomes: [], cases: [] },
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
      attemptedCaseIds: ['case-1'],
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [{ id: 'case-1', resolution: 'open' }] }, resolvedAbsentCaseIds: [] });
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
