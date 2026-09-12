// Covers: Task: 32
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyBuildReviewOutcome } from '../../src/engine/build-review-outcome.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import type { RemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';

const roots: string[] = [];
const feature = { version: 'v1' as const, repository: '/repo', feature: 'outcome' };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(process.env.TMPDIR!, 'build-review-outcome-'));
  roots.push(value);
  return value;
}

const aggregate = joinBuildReviewRubricOutcomes({
  lapId: 'outcome-lap' as never,
  snapshotDigest: 'outcome-snapshot',
  results: {
    testQuality: {
      kind: 'judged', rubric: 'testQuality', lapId: 'outcome-lap' as never,
      snapshotDigest: 'outcome-snapshot', contractVersion: 'v3', verdict: 'FAIL',
      findings: [{
        concernKind: 'test-insensitive', summary: 'The changed test is insensitive.', evidenceLocations: ['test/outcome.test.ts:1'],
        anchor: { rubric: 'testQuality', locus: { path: 'test/outcome.test.ts', contentHash: 'sha256:outcome', display: 'outcome test' } },
      }],
    },
  },
});
const source = projectBuildReviewAggregateSources(aggregate)![0]!;

function actionJudgement(): RemediationCaseJudgement {
  const sourceId = buildReviewAdjudicationSourceId(source);
  return {
    mode: 'case-v2', domain: 'build_review',
    sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'repair-case' }],
    cases: [{
      caseRef: 'repair-case', disposition: 'act', priority: 'high', confidence: 'high',
      rationale: 'The admitted task repairs this verified finding.',
      effect: { kind: 'action', route: 'build', tasks: [{
        title: 'Repair the test sensitivity.', admittedTaskIds: ['32'], admissionRationale: 'Task 32 owns this outcome boundary.',
      }] },
    }],
    consistency: { verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['repair-case'], rationale: 'One admitted repair covers the complete source set.' },
  };
}

function escalationJudgement(): RemediationCaseJudgement {
  const sourceId = buildReviewAdjudicationSourceId(source);
  return {
    mode: 'case-v2', domain: 'build_review',
    sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'plan-stop' }],
    cases: [{
      caseRef: 'plan-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
      rationale: 'The approved plan needs an owner decision before repair.', effect: { kind: 'none' }, escalation: { owner: 'plan' },
    }],
    consistency: { verdict: 'blocked', sourceIds: [sourceId], caseRefs: ['plan-stop'], rationale: 'The source cannot be repaired under the current approved plan.' },
  };
}

function coordinatorInput(projectRoot: string, judge: (context: unknown) => Promise<RemediationCaseJudgement>) {
  return {
    projectRoot, feature, operatorResolvedFindingIds: new Set<string>(), mechanical: 'healthy' as const, judge,
    chargeInput: { treeHash: 'tree-outcome', resolvedCount: 1, reason: 'outcome fixture' },
    generateId: (() => { const ids = ['case-outcome', 'effect-outcome']; return () => ids.shift()!; })(),
    readPlanContract: async () => ({ path: '.docs/plans/example.md', pointers: [], admittedTaskContracts: [{ id: '32', contract: 'Shared outcome operation.' }] }),
    readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '32', status: 'in_progress' }] }),
  };
}

describe('applyBuildReviewOutcome', () => {
  it('waits for branch settlement, then admits one validated repair through exactly one adjudicator', async () => {
    const projectRoot = await root();
    const judge = vi.fn(async () => actionJudgement());
    const input = coordinatorInput(projectRoot, judge);

    await expect(applyBuildReviewOutcome({ settlement: 'pending', recordedAggregate: aggregate, adjudication: input }))
      .resolves.toEqual({ kind: 'awaiting-settlement', lapId: aggregate.lapId });
    expect(judge).not.toHaveBeenCalled();

    await expect(applyBuildReviewOutcome({ settlement: 'settled', recordedAggregate: aggregate, adjudication: input }))
      .resolves.toMatchObject({ kind: 'repair', lapId: aggregate.lapId, caseIds: ['case-outcome'], remainingInfrastructure: false });
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('refuses a partial/raw settled branch without judging or charging', async () => {
    const projectRoot = await root();
    const judge = vi.fn(async () => actionJudgement());
    const charge = vi.fn();

    await expect(applyBuildReviewOutcome({
      settlement: 'settled', recordedAggregate: { results: {} },
      adjudication: { ...coordinatorInput(projectRoot, judge), chargeEffect: charge },
    })).resolves.toMatchObject({ kind: 'infrastructure', status: 'halt', reason: 'build-review aggregate is not a complete settled lap' });
    expect(judge).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it('returns a durable owner stop without turning escalation into a deferral or charge', async () => {
    const projectRoot = await root();
    const judge = vi.fn(async () => escalationJudgement());
    const charge = vi.fn();

    const outcome = await applyBuildReviewOutcome({
      settlement: 'settled', recordedAggregate: aggregate,
      adjudication: { ...coordinatorInput(projectRoot, judge), chargeEffect: charge },
    });
    expect(outcome).toMatchObject({
      kind: 'decision-stop', lapId: aggregate.lapId,
      stops: [{ caseId: 'case-outcome', owner: 'plan' }],
      remainingInfrastructure: false,
    });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(charge).not.toHaveBeenCalled();
  });

  it('preserves the no-content infrastructure route and does not re-dispatch an exact settled aggregate', async () => {
    const projectRoot = await root();
    const judge = vi.fn(async () => actionJudgement());
    const charge = vi.fn();
    const infrastructureOnly = joinBuildReviewRubricOutcomes({
      lapId: 'infrastructure-lap' as never,
      snapshotDigest: 'infrastructure-snapshot',
      results: {
        testQuality: {
          kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'review runner was unavailable',
        },
      },
    });

    await expect(applyBuildReviewOutcome({
      settlement: 'settled', recordedAggregate: infrastructureOnly,
      adjudication: { ...coordinatorInput(projectRoot, judge), mechanical: 'retry', chargeEffect: charge },
    })).resolves.toMatchObject({ kind: 'infrastructure', lapId: infrastructureOnly.lapId, status: 'retry' });

    const settled = {
      settlement: 'settled' as const, recordedAggregate: aggregate,
      adjudication: {
        ...coordinatorInput(projectRoot, judge), chargeEffect: charge,
        operatorResolvedFindingIds: new Set([source.findingId]),
      },
    };
    await expect(applyBuildReviewOutcome(settled)).resolves.toMatchObject({ kind: 'settled', lapId: aggregate.lapId });
    await expect(applyBuildReviewOutcome(settled)).resolves.toMatchObject({ kind: 'settled', lapId: aggregate.lapId });
    expect(judge).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });
});
