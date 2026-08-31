import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { coordinateBuildReviewAdjudication } from '../../src/engine/build-review-adjudication-coordinator.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import type { RemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';
import { RemediationCaseStore } from '../../src/engine/remediation-case-store.js';
import type { EffectMarkerTrackerClient } from '../../src/engine/tracker-client.js';
import type { ConductorEvent } from '../../src/types/events.js';

const temporaryDirectories: string[] = [];

async function projectRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'build-review-adjudication-'));
  temporaryDirectories.push(root);
  return root;
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
      expect(context).toMatchObject({ currentSources: [expect.objectContaining({ findingId })], priorCases: [] });
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

  it('bypasses provider and case state when every current source is operator-resolved', async () => {
    const root = await projectRoot();
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), operatorResolvedFindingIds: new Set([findingId]),
    });

    expect(result).toMatchObject({ ok: true, route: 'pass', trace: expect.stringContaining('operator-resolved') });
    expect(judge).not.toHaveBeenCalled();
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

  it('re-reads late exact operator authority before it can reserve an autonomous effect', async () => {
    const root = await projectRoot();
    const resolutions = [new Set<string>(), new Set<string>(), new Set([findingId])];
    const resolveOperatorResolvedFindingIds = vi.fn(async () => resolutions.shift()!);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), resolveOperatorResolvedFindingIds,
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(resolveOperatorResolvedFindingIds).toHaveBeenCalledTimes(3);
    await expect(access(join(root, '.pipeline', 'build-review-work-order.json'))).rejects.toMatchObject({ code: 'ENOENT' });
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
    await store.replace({
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
});
