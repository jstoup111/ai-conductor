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
      state: {
        version: 'v1',
        feature: FEATURE,
        cases: [{
          id: 'case-1', domain: 'build_review', disposition: 'act', priority: 'high',
          rationale: ACTION_CASE.rationale, confidence: 'high', resolution: 'open',
          sources: [{ sourceId: 'testQuality:finding-1', outcome: 'acted', recordedAt: RECORDED_AT }],
          effect: { id: 'effect-1', kind: 'action', status: 'reserved' },
        }],
      },
    });
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

  it('resolves an absent open action case only after recorded BUILD attempt evidence', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });

    const result = await reconcileRemediationCases(store, {
      graph: { sourceOutcomes: [], cases: [] },
      recordedAt: '2026-08-30T13:00:00.000Z',
      generateId: () => 'must-not-be-used',
      attemptedCaseIds: ['case-1'],
    });

    expect(result).toMatchObject({ ok: true, state: { cases: [{ id: 'case-1', resolution: 'resolved' }] } });
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
  it('converges a re-applied judgement on the first stamped identity instead of a second one', async () => {
    const projectRoot = await createProjectRoot();
    const store = new RemediationCaseStore(projectRoot, FEATURE);
    const first = await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: RECORDED_AT, generateId: generatedIds('case-1', 'effect-1'),
    });
    // A crash between the store write and the coordinator's next step replays
    // the identical judgement under the same lease.
    const second = await reconcileRemediationCases(store, {
      graph: graph(ACTION_CASE), recordedAt: '2026-08-30T12:05:00.000Z', generateId: generatedIds('case-2', 'effect-2'),
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
    await store.replace({ version: 'v1', feature: FEATURE, cases: [durableAction()] });

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
