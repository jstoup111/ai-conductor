// Covers: task:16, task:rem-as-built-rem-ab1-4
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { coordinateBuildReviewAdjudication } from '../../src/engine/build-review-adjudication-coordinator.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import type { RemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';
import type { RemediationCaseStoreState } from '../../src/engine/remediation-case-store.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import { markBuildReviewWorkOrderAttempted, publishBuildReviewWorkOrder } from '../../src/engine/build-review-work-order.js';
import { chargeBuildReviewEffectInLedger } from '../../src/engine/kickback-ledger.js';
import type { EffectMarkerTrackerClient } from '../../src/engine/tracker-client.js';
import type { ConductorEvent } from '../../src/types/events.js';

const temporaryDirectories: string[] = [];

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'build-review-adjudication-'));
  temporaryDirectories.push(root);
  return root;
}

/** Seeds durable prior state through `mutate`, the store's only write seam. */
async function seedCases(store: RemediationCaseStore, state: RemediationCaseStoreState): Promise<void> {
  const seeded = await store.mutate(async () => ({ value: null, nextState: state }));
  if (!seeded.ok) throw new Error(`case-store seed failed: ${seeded.reason}`);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const aggregate = joinBuildReviewRubricOutcomes({
  lapId: 'lap-1' as never,
  snapshotDigest: 'snapshot-1',
  results: {
    testQuality: {
      kind: 'judged', rubric: 'testQuality', lapId: 'lap-1' as never, snapshotDigest: 'snapshot-1', contractVersion: 'v3', verdict: 'FAIL',
      findings: [{
        concernKind: 'test-insensitive', summary: 'The changed test is insensitive.', evidenceLocations: ['test/example.test.ts:1'],
        anchor: { rubric: 'testQuality', locus: { path: 'test/example.test.ts', contentHash: 'sha256:fixture', display: 'example test' } },
      }],
    },
  },
});
// The judge receives namespaced ids from the context and returns them
// verbatim, so the fixture must use the same identity the coordinator
// validates against. Deriving the bare findingId here is what let the
// context/coordinator drift go unnoticed.
const rawSource = projectBuildReviewAggregateSources(aggregate)![0]!;
// Two distinct identities, deliberately named apart. `sourceId` is the
// namespaced id the judge is handed and returns; `findingId` is the bare id
// operator dispositions are keyed by. Conflating them is what let the
// context/coordinator drift go unnoticed.
const sourceId = buildReviewAdjudicationSourceId(rawSource);
const findingId = rawSource.findingId;
const feature = { version: 'v1' as const, repository: '/repo', feature: 'feature' };

// A mixed lap: one finding the operator has already accepted (or accepts
// mid-lap) alongside a live sibling. Late authority must suppress only its own
// source, never fail the whole lap closed.
const mixedAggregate = joinBuildReviewRubricOutcomes({
  lapId: 'lap-2' as never,
  snapshotDigest: 'snapshot-2',
  results: {
    testQuality: {
      kind: 'judged', rubric: 'testQuality', lapId: 'lap-2' as never, snapshotDigest: 'snapshot-2', contractVersion: 'v3', verdict: 'FAIL',
      findings: [
        {
          concernKind: 'test-insensitive', summary: 'The first changed test is insensitive.', evidenceLocations: ['test/first.test.ts:1'],
          anchor: { rubric: 'testQuality', locus: { path: 'test/first.test.ts', contentHash: 'sha256:first', display: 'first test' } },
        },
        {
          concernKind: 'test-insensitive', summary: 'The second changed test is insensitive.', evidenceLocations: ['test/second.test.ts:1'],
          anchor: { rubric: 'testQuality', locus: { path: 'test/second.test.ts', contentHash: 'sha256:second', display: 'second test' } },
        },
      ],
    },
  },
});
const mixedSources = projectBuildReviewAggregateSources(mixedAggregate)!;
const acceptedSource = mixedSources[0]!;
const liveSource = mixedSources[1]!;

/** One case per source, so suppression of one leaves the other intact. */
function mixedJudgement(): RemediationCaseJudgement {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [
      { sourceId: buildReviewAdjudicationSourceId(acceptedSource), outcome: 'acted', caseRef: 'case-accepted' },
      { sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'acted', caseRef: 'case-live' },
    ],
    cases: [
      {
        caseRef: 'case-accepted', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'The first test needs a focused assertion.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the first test' }] },
      },
      {
        caseRef: 'case-live', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'The second test needs a focused assertion.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the second test' }] },
      },
    ],
  };
}

function sequentialIds(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${(next += 1)}`;
}

function actionJudgement(): RemediationCaseJudgement {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'case-1' }],
    cases: [{
      caseRef: 'case-1', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'The test needs a focused assertion.',
      effect: { kind: 'action', route: 'build', tasks: [{ title: 'Add the missing assertion' }] },
    }],
  };
}

function deferralJudgement(): RemediationCaseJudgement {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [{ sourceId, outcome: 'deferred', caseRef: 'case-1' }],
    cases: [{
      caseRef: 'case-1', disposition: 'defer', priority: 'low', confidence: 'high', rationale: 'This needs a separately planned change.',
      effect: { kind: 'deferral', title: 'Track the build-review finding', body: 'The changed test is insensitive.', exclusionRationale: 'It belongs outside this feature.' },
    }],
  };
}

function mixedDeferralJudgement(): RemediationCaseJudgement {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [
      { sourceId: buildReviewAdjudicationSourceId(acceptedSource), outcome: 'deferred', caseRef: 'case-accepted' },
      { sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'deferred', caseRef: 'case-live' },
    ],
    cases: [
      {
        caseRef: 'case-accepted', disposition: 'defer', priority: 'low', confidence: 'high', rationale: 'The first finding belongs outside this feature.',
        effect: { kind: 'deferral', title: 'Track the first finding', body: 'The first changed test is insensitive.', exclusionRationale: 'It belongs outside this feature.' },
      },
      {
        caseRef: 'case-live', disposition: 'defer', priority: 'low', confidence: 'high', rationale: 'The second finding belongs outside this feature.',
        effect: { kind: 'deferral', title: 'Track the second finding', body: 'The second changed test is insensitive.', exclusionRationale: 'It belongs outside this feature.' },
      },
    ],
  };
}

type RemediationCaseLifecycleEvent = Extract<ConductorEvent, {
  type: 'remediation_adjudication_started' | 'remediation_adjudication_completed' | 'remediation_adjudication_failed'
    | 'remediation_case_reconciled' | 'remediation_effect_reserved' | 'remediation_effect_applied'
    | 'remediation_effect_failed' | 'remediation_semantic_repeat_halt';
}>;

function input(root: string, judge: (context: unknown) => Promise<RemediationCaseJudgement>) {
  return {
    projectRoot: root, feature, aggregate, operatorResolvedFindingIds: new Set<string>(), mechanical: 'healthy' as const, judge,
    chargeInput: { treeHash: 'tree-1', resolvedCount: 1, reason: 'fixture' }, generateId: (() => {
      const ids = ['case-durable', 'effect-durable'];
      return () => ids.shift()!;
    })(),
  };
}

describe('coordinateBuildReviewAdjudication', () => {
  it('dispatches one complete current-source/history judgement and returns its closed action route', async () => {
    const root = await projectRoot();
    const judge = vi.fn(async (context: unknown) => {
      expect(context).toMatchObject({ currentFindings: [expect.objectContaining({ findingId })], priorCases: [] });
      return actionJudgement();
    });
    const events: string[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge),
      emit: async (event) => { events.push(event.type); },
    });

    expect(result).toMatchObject({ ok: true, route: 'build', trace: expect.stringContaining('case-durable') });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'remediation_adjudication_started', 'remediation_case_reconciled', 'remediation_effect_reserved',
      'remediation_effect_applied', 'remediation_adjudication_completed',
    ]);
  });

  it('bypasses the provider but still settles case state when every current source is operator-resolved', async () => {
    const root = await projectRoot();
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), operatorResolvedFindingIds: new Set([findingId]),
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(judge).not.toHaveBeenCalled();
  });

  it.each([
    ['at entry', 0],
    ['before dispatch', 1],
    ['after the judgement', 2],
  ] as const)('routes leftover work rather than passing when authority arrives %s', async (_when, reads) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    // An earlier lap reserved this effect and never finished it. Every exit
    // below used to answer `pass` from `cases: []` — deciding without looking.
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-stranded', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'An earlier lap reserved this and was interrupted.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256-earlier', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-stranded', kind: 'action', status: 'reserved' },
      }],
    });
    const unresolved = Array.from({ length: reads }, () => new Set<string>());
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge),
      resolveOperatorResolvedFindingIds: async () => unresolved.shift() ?? new Set([findingId]),
    });

    // The stranded effect is neither applied nor retired by this acceptance —
    // its source is not one the operator accepted — so the lap surfaces it for
    // a human instead of reporting a healthy route past it.
    expect(result).toMatchObject({ ok: true, route: 'halt', detail: 'remediation effect is not finalized' });
    await expect(store.read()).resolves.toMatchObject({
      ok: true, state: { cases: [{ id: 'case-stranded', resolution: 'open' }] },
    });
  });

  it('emits a typed failure and never returns a partial route when the one judgement throws', async () => {
    const root = await projectRoot();
    const events: string[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => { throw new Error('provider unavailable'); }),
      emit: async (event) => { events.push(event.type); },
    });

    expect(result).toEqual({ ok: false, detail: 'remediate judgement failed' });
    expect(events).toEqual(['remediation_adjudication_started', 'remediation_adjudication_failed']);
  });

  it('fails closed before reconciliation when durable attempt evidence is invalid', async () => {
    const root = await projectRoot();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline/build-review-work-order.json'), '{not json', 'utf8');
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication(input(root, judge));

    expect(result).toEqual({ ok: false, detail: 'build-review work order malformed-json' });
    expect(judge).not.toHaveBeenCalled();
  });

  it('re-reads late exact operator authority before it can publish or charge an autonomous action', async () => {
    const root = await projectRoot();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const ledgerPath = join(root, '.pipeline/kickback-ledger.json');
    const ledgerBefore = JSON.stringify({ version: 1, gates: {} });
    await writeFile(ledgerPath, ledgerBefore, 'utf8');
    const resolutions = [new Set<string>(), new Set<string>(), new Set<string>(), new Set([findingId])];
    const resolveOperatorResolvedFindingIds = vi.fn(async () => resolutions.shift()!);
    const chargeEffect = vi.fn(chargeBuildReviewEffectInLedger);
    const events: RemediationCaseLifecycleEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), resolveOperatorResolvedFindingIds, chargeEffect,
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true });
    expect(resolveOperatorResolvedFindingIds).toHaveBeenCalledTimes(4);
    expect(chargeEffect).not.toHaveBeenCalled();
    await expect(readFile(ledgerPath, 'utf8')).resolves.toBe(ledgerBefore);
    await expect(access(join(root, '.pipeline/build-review-work-order.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    // Absence of a charge and of a published order is not enough: reconciliation
    // already persisted this case with a reserved effect, so the acceptance must
    // settle that durable row rather than return past it and leave autonomous
    // state a later BUILD entry can replay.
    await expect(new RemediationCaseStore(root, feature).read()).resolves.toMatchObject({
      ok: true,
      state: {
        cases: [{
          resolution: 'resolved',
          effect: { status: 'failed', diagnostic: 'retired by operator acceptance' },
        }],
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      'remediation_adjudication_started', 'remediation_case_reconciled', 'remediation_effect_reserved',
      'remediation_case_reconciled', 'remediation_effect_failed', 'remediation_adjudication_completed',
    ]);
    expect(events.slice(-3)).toEqual([
      expect.objectContaining({ type: 'remediation_case_reconciled', caseId: 'case-durable', resolution: 'resolved' }),
      expect.objectContaining({
        type: 'remediation_effect_failed', caseId: 'case-durable', effectId: 'effect-durable', effectKind: 'action',
        reason: 'retired by operator acceptance',
      }),
      expect.objectContaining({ type: 'remediation_adjudication_completed' }),
    ]);
  });

  it('effects and charges only the unaccepted sibling when authority changes before action reservation', async () => {
    const root = await projectRoot();
    const resolutions = [
      new Set<string>(), new Set<string>(), new Set<string>(),
      new Set([acceptedSource.findingId]), new Set([acceptedSource.findingId]), new Set([acceptedSource.findingId]),
    ];
    const chargeEffect = vi.fn(chargeBuildReviewEffectInLedger);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => resolutions.shift() ?? new Set([acceptedSource.findingId]),
      chargeEffect, generateId: sequentialIds('pre-action'),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    expect(chargeEffect).toHaveBeenCalledTimes(1);
    const order = JSON.parse(await readFile(join(root, '.pipeline/build-review-work-order.json'), 'utf8')) as {
      cases: Array<{ tasks: Array<{ title: string }> }>;
    };
    expect(order.cases).toMatchObject([{ tasks: [{ title: 'Repair the second test' }] }]);
  });

  it('does not file a deferred issue for a source accepted before intake reservation', async () => {
    const root = await projectRoot();
    const resolutions = [
      new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(),
      new Set([acceptedSource.findingId]), new Set([acceptedSource.findingId]),
    ];
    const fileIssue = vi.fn(async () => ({ issueUrl: 'https://example.test/issues/1' }));

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedDeferralJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => resolutions.shift() ?? new Set([acceptedSource.findingId]),
      tracker: { findIssueByEffectMarker: async () => undefined } as unknown as EffectMarkerTrackerClient,
      repo: 'acme/conductor', fileIssue, generateId: sequentialIds('pre-deferral'),
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(fileIssue).toHaveBeenCalledTimes(1);
    expect(fileIssue).toHaveBeenCalledWith(expect.objectContaining({ title: 'Track the second finding' }));
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled).toMatchObject({
      ok: true,
      state: { cases: expect.arrayContaining([
        expect.objectContaining({
          resolution: 'resolved',
          sources: [expect.objectContaining({ sourceId: buildReviewAdjudicationSourceId(acceptedSource) })],
          effect: expect.objectContaining({ kind: 'deferral', status: 'failed', diagnostic: 'retired by operator acceptance' }),
        }),
        expect.objectContaining({
          resolution: 'open',
          sources: [expect.objectContaining({ sourceId: buildReviewAdjudicationSourceId(liveSource) })],
          effect: expect.objectContaining({ kind: 'deferral', status: 'applied' }),
        }),
      ]) },
    });
  });

  it('emits a failed deferral effect through the same coordinator event port', async () => {
    const root = await projectRoot();
    const events: RemediationCaseLifecycleEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => deferralJudgement()),
      tracker: { findIssueByEffectMarker: async () => { throw new Error('tracker unavailable'); } } as unknown as EffectMarkerTrackerClient,
      repo: 'acme/conductor',
      fileIssue: async () => ({ issueUrl: 'https://example.test/issues/1' }),
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: false, detail: 'deferred intake failed: tracker unavailable' });
    expect(events.map((event) => event.type)).toEqual([
      'remediation_adjudication_started', 'remediation_case_reconciled', 'remediation_effect_reserved',
      'remediation_effect_failed', 'remediation_adjudication_failed',
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'remediation_effect_failed', caseId: 'case-durable', effectId: 'effect-durable', effectKind: 'deferral',
      reason: 'deferred intake failed: tracker unavailable',
    }));
  });

  it('emits a semantic-repeat halt when an already-resolved action case is bound again', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-durable', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The test needs a focused assertion.', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-durable', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    const events: RemediationCaseLifecycleEvent[] = [];
    const repeated: RemediationCaseJudgement = {
      ...actionJudgement(),
      cases: [{ ...actionJudgement().cases[0]!, existingCaseId: 'case-durable' }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => repeated),
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: false, detail: 'semantic remediation case regression case-durable' });
    expect(events.map((event) => event.type)).toEqual([
      'remediation_adjudication_started', 'remediation_case_reconciled',
      'remediation_semantic_repeat_halt', 'remediation_adjudication_failed',
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'remediation_semantic_repeat_halt', caseId: 'case-durable', effectId: 'effect-durable', reason: 'regressed',
    }));
  });
  it('adjudicates the unresolved remainder when the lap opens with a pre-existing acceptance', async () => {
    const root = await projectRoot();
    const judge = vi.fn(async () => {
      // Only the live sibling reaches the judge; the accepted one is excluded
      // before dispatch and must not fail the lap closed afterwards. A
      // judgement naming only the live source therefore validates cleanly.
      return {
        mode: 'case-v1' as const, domain: 'build_review' as const,
        sourceOutcomes: [{ sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'acted' as const, caseRef: 'case-live' }],
        cases: [{
          caseRef: 'case-live', disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
          rationale: 'The second test needs a focused assertion.',
          effect: { kind: 'action' as const, route: 'build' as const, tasks: [{ title: 'Repair the second test' }] },
        }],
      };
    });

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), aggregate: mixedAggregate,
      operatorResolvedFindingIds: new Set([acceptedSource.findingId]),
      generateId: sequentialIds('live'),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('suppresses only the source accepted during the lap and routes the live remainder', async () => {
    const root = await projectRoot();
    const resolutions = [
      new Set<string>(), new Set<string>(),
      new Set([acceptedSource.findingId]), new Set([acceptedSource.findingId]),
    ];
    const resolveOperatorResolvedFindingIds = vi.fn(async () => resolutions.shift() ?? new Set([acceptedSource.findingId]));

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds, generateId: sequentialIds('mixed'),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    // The accepted source's case never reserved or applied an effect.
    const store = new RemediationCaseStore(root, feature);
    const settled = await store.read();
    expect(settled.ok && settled.state.cases.map((record) => record.sources.map((source) => source.sourceId))).toEqual([
      [buildReviewAdjudicationSourceId(liveSource)],
    ]);
  });

  it('re-reads operator authority adjacent to the final exit and drops the obsolete route', async () => {
    const root = await projectRoot();
    // Unresolved through reservation and effects; accepted only at the exit.
    const resolutions = [new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set([findingId])];
    const resolveOperatorResolvedFindingIds = vi.fn(async () => resolutions.shift() ?? new Set([findingId]));

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), resolveOperatorResolvedFindingIds,
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(resolveOperatorResolvedFindingIds).toHaveBeenCalledTimes(5);
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled).toMatchObject({
      ok: true,
      state: { cases: [expect.objectContaining({ resolution: 'resolved' })] },
    });
    // The historical order remains durable evidence, but its only case is
    // resolved, so it is no longer BUILD-eligible.
  });

  it('resolves only sources accepted at the exit and republishes the surviving action order', async () => {
    const root = await projectRoot();
    // Both cases reach reservation; only the first source is accepted in the
    // final authority read immediately before the coordinator exits.
    const resolutions = [
      new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(),
      new Set([acceptedSource.findingId]),
    ];
    const resolveOperatorResolvedFindingIds = vi.fn(async () => resolutions.shift() ?? new Set([acceptedSource.findingId]));

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds, generateId: sequentialIds('exit-race'),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(`unexpected case-store failure: ${settled.reason}`);
    expect(settled.state.cases.map((record) => ({
      resolution: record.resolution,
      sources: record.sources.map((source) => source.sourceId),
    }))).toEqual([
      { resolution: 'resolved', sources: [buildReviewAdjudicationSourceId(acceptedSource)] },
      { resolution: 'open', sources: [buildReviewAdjudicationSourceId(liveSource)] },
    ]);
    const order = JSON.parse(await readFile(join(root, '.pipeline', 'build-review-work-order.json'), 'utf8')) as {
      effectId: string; cases: Array<{ caseId: string; priority: string; tasks: Array<{ title: string }> }>;
    };
    expect(order).toMatchObject({
      effectId: (settled.state.cases[1]!.effect as { id: string }).id,
      cases: [{ caseId: settled.state.cases[1]!.id, priority: 'high', tasks: [{ title: 'Repair the second test' }] }],
    });
  });

  it('emits retirement occurrences before completion when partial acceptance republishes the surviving action order', async () => {
    const root = await projectRoot();
    // The accepted case remains reserved at the action boundary; the live
    // sibling applies, then finalization retires the accepted transition and
    // republishes the live work order.
    const resolutions = [
      new Set<string>(), new Set<string>(), new Set<string>(),
      new Set([acceptedSource.findingId]), new Set([acceptedSource.findingId]),
    ];
    const events: RemediationCaseLifecycleEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => resolutions.shift() ?? new Set([acceptedSource.findingId]),
      generateId: sequentialIds('partial-retirement'), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(`unexpected case-store failure: ${settled.reason}`);
    const accepted = settled.state.cases.find((record) =>
      record.sources.some((source) => source.sourceId === buildReviewAdjudicationSourceId(acceptedSource)),
    );
    expect(accepted).toMatchObject({ resolution: 'resolved', effect: { status: 'failed' } });
    if (!accepted || accepted.effect.kind === 'none') throw new Error('accepted case was not retired with an effect');
    expect(events.filter((event) => event.type === 'remediation_case_reconciled' && event.caseId === accepted.id && event.resolution === 'resolved')).toEqual([
      expect.objectContaining({ type: 'remediation_case_reconciled', caseId: accepted.id, resolution: 'resolved' }),
    ]);
    expect(events.filter((event) => event.type === 'remediation_effect_failed' && event.caseId === accepted.id)).toEqual([
      expect.objectContaining({
        type: 'remediation_effect_failed', caseId: accepted.id, effectId: accepted.effect.id, effectKind: 'action',
        reason: 'retired by operator acceptance',
      }),
    ]);
    const completionIndex = events.findIndex((event) => event.type === 'remediation_adjudication_completed');
    expect(events.findIndex((event) => event.type === 'remediation_case_reconciled' && event.caseId === accepted.id && event.resolution === 'resolved')).toBeLessThan(completionIndex);
    expect(events.findIndex((event) => event.type === 'remediation_effect_failed' && event.caseId === accepted.id)).toBeLessThan(completionIndex);
    const order = JSON.parse(await readFile(join(root, '.pipeline', 'build-review-work-order.json'), 'utf8')) as {
      cases: Array<{ caseId: string }>;
    };
    expect(order.cases).toMatchObject([{ caseId: settled.state.cases.find((record) => record.id !== accepted.id)!.id }]);
  });
  it.each([
    ['explicit provider binding', true],
    ['unbound proposal converged by reconciliation', false],
  ] as const)('halts an attempted action case through %s instead of granting a second free route', async (_origin, explicitlyBound) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-durable', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The test needs a focused assertion.', resolution: 'open',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-durable', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    // BUILD already ran against this order: the durable attempt evidence is on
    // the artifact, not in this process's memory.
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-durable',
      cases: [{ caseId: 'case-durable', priority: 'high', tasks: [{ title: 'Add the missing assertion' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    const events: RemediationCaseLifecycleEvent[] = [];
    const repeated: RemediationCaseJudgement = {
      ...actionJudgement(),
      cases: [{
        ...actionJudgement().cases[0]!,
        ...(explicitlyBound ? { existingCaseId: 'case-durable' } : {}),
      }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => repeated), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: false, detail: 'semantic remediation case repeat case-durable' });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'remediation_semantic_repeat_halt', caseId: 'case-durable', effectId: 'effect-durable', reason: 'already-attempted',
    }));
    expect(events.map((event) => event.type)).not.toContain('remediation_effect_applied');
  });

  it('resolves an attempted open case that the current lap no longer reports', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-gone', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'An earlier finding that BUILD repaired.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256-gone', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-gone', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-gone',
      cases: [{ caseId: 'case-gone', priority: 'high', tasks: [{ title: 'Repair the earlier finding' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);

    const events: RemediationCaseLifecycleEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    const settled = await store.read();
    expect(settled.ok && settled.state.cases.map((record) => [record.id, record.resolution])).toEqual([
      ['case-gone', 'resolved'], ['case-durable', 'open'],
    ]);
    // The absent case is named by no caseRef, so emitting only from the ref map
    // changed durable state with nothing on the event spine.
    expect(events).toContainEqual(expect.objectContaining({
      type: 'remediation_case_reconciled', caseId: 'case-gone', resolution: 'resolved',
    }));
  });
  it('hands the judge the case-v1 contract, sourcing plan and task evidence from the worktree', async () => {
    const root = await projectRoot();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await mkdir(join(root, '.docs/plans'), { recursive: true });
    await writeFile(join(root, '.pipeline/engine-state.json'), JSON.stringify({ activePlanPath: '.docs/plans/example.md' }), 'utf8');
    await writeFile(join(root, '.docs/plans/example.md'), [
      '### Task 4: Cover the changed test',
      '**Files:**',
      '- `test/example.test.ts` — the insensitive assertion',
      '',
    ].join('\n'), 'utf8');
    await writeFile(join(root, '.pipeline/task-status.json'), JSON.stringify({ tasks: [{ id: '4', status: 'completed' }] }), 'utf8');

    let seen: unknown;
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async (context) => { seen = context; return actionJudgement(); }),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    expect(seen).toMatchObject({
      mode: 'case-v1', domain: 'build_review',
      planContract: { path: '.docs/plans/example.md', pointers: [expect.stringContaining('Task 4')] },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '4', status: 'completed' }] },
      effectPointers: [],
    });
  });
});
