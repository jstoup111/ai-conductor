// Covers: task:5
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { reconcileRemediationCases } from '../../src/engine/remediation-case-reconciler.js';
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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('remediation case reconciler', () => {
  it('stamps engine-owned case and effect ids for a new proposed case', async () => {
    const projectRoot = await createProjectRoot();
    const result = await reconcileRemediationCases(new RemediationCaseStore(projectRoot, FEATURE), {
      graph: graph(ACTION_CASE),
      recordedAt: RECORDED_AT,
      generateId: generatedIds('case-1', 'effect-1'),
    });

    expect(result).toEqual({
      ok: true,
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
});
