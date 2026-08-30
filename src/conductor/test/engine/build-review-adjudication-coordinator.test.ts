import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { coordinateBuildReviewAdjudication } from '../../src/engine/build-review-adjudication-coordinator.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import type { RemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';

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
const sourceId = projectBuildReviewAggregateSources(aggregate)![0]!.findingId;
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
      expect(context).toMatchObject({ currentSources: [expect.objectContaining({ findingId: sourceId })], priorCases: [] });
      return actionJudgement();
    });
    const events: string[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge),
      emit: async (event) => { events.push(event.type); },
    });

    expect(result).toMatchObject({ ok: true, route: 'build', trace: expect.stringContaining('case-durable') });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['remediation_adjudication_started', 'remediation_adjudication_completed']);
  });

  it('bypasses provider and case state when every current source is operator-resolved', async () => {
    const root = await projectRoot();
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), operatorResolvedFindingIds: new Set([sourceId]),
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
    const resolutions = [new Set<string>(), new Set<string>(), new Set([sourceId])];
    const resolveOperatorResolvedFindingIds = vi.fn(async () => resolutions.shift()!);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), resolveOperatorResolvedFindingIds,
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(resolveOperatorResolvedFindingIds).toHaveBeenCalledTimes(3);
    await expect(access(join(root, '.pipeline', 'build-review-work-order.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
