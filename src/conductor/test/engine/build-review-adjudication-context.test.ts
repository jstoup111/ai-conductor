// Covers: task:3
import { describe, expect, it } from 'vitest';

import {
  assembleBuildReviewAdjudicationContext,
  BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS,
} from '../../src/engine/build-review-adjudication-context.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId, type BuildReviewFinding } from '../../src/engine/build-review-domain.js';
import type { RemediationCaseRecord } from '../../src/engine/remediation-case-store.js';

const lapId = parseBuildReviewLapId('lap-current')!;
const snapshotDigest = 'sha256:snapshot';
const HASH = `sha256:${'a'.repeat(64)}`;

function finding(name: string): BuildReviewFinding {
  return {
    concernKind: 'test-insensitive',
    summary: `The ${name} assertion passes against reverted production.`,
    evidenceLocations: [`test/${name}.test.ts:8`],
    anchor: {
      rubric: 'testQuality',
      locus: { path: `test/${name}.test.ts`, contentHash: HASH, display: `${name} behavior` },
    },
  };
}

function aggregate(...findings: readonly BuildReviewFinding[]) {
  return joinBuildReviewRubricOutcomes({
    lapId,
    snapshotDigest,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest, contractVersion: 'v3',
        findings, verdict: findings.length === 0 ? 'PASS' : 'FAIL',
      },
    },
  });
}

function priorCase(id: string): RemediationCaseRecord {
  return {
    id,
    domain: 'build_review',
    disposition: 'act',
    priority: 'high',
    rationale: `Case ${id} remains open until its focused repair is verified.`,
    confidence: 'high',
    resolution: 'open',
    sources: [{ sourceId: `testQuality:${id}`, outcome: 'acted', recordedAt: '2026-08-30T12:00:00.000Z' }],
    effect: { id: `effect-${id}`, kind: 'action', status: 'applied', workOrderId: `work-order-${id}` },
  };
}

describe('build-review adjudication context', () => {
  it('projects every current unresolved source and every prior case deterministically', () => {
    const current = aggregate(finding('alpha'), finding('beta'));
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: current,
      priorCases: [priorCase('case-middle'), priorCase('case-oldest'), priorCase('case-first')],
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        version: 'v1', domain: 'build_review', lapId, snapshotDigest,
        currentFindings: expect.arrayContaining([
          expect.objectContaining({ rubric: 'testQuality', summary: finding('alpha').summary }),
          expect.objectContaining({ rubric: 'testQuality', summary: finding('beta').summary }),
        ]),
        priorCases: [
          expect.objectContaining({ id: 'case-first', resolution: 'open' }),
          expect.objectContaining({ id: 'case-middle', resolution: 'open' }),
          expect.objectContaining({ id: 'case-oldest', resolution: 'open' }),
        ],
      },
    });
    if (!result.ok) return;
    expect(result.context.currentFindings.map((source) => source.sourceId)).toEqual([...result.context.currentFindings.map((source) => source.sourceId)].sort());
    expect(result.context.priorCases.map((caseRecord) => caseRecord.id)).toEqual(['case-first', 'case-middle', 'case-oldest']);
  });

  it('omits only exact operator-resolved sources and emits no synthetic prior case for empty history', () => {
    const current = aggregate(finding('accepted'), finding('unresolved'));
    const all = assembleBuildReviewAdjudicationContext({ aggregate: current, priorCases: [] });
    expect(all).toMatchObject({ ok: true, context: { priorCases: [], currentFindings: [expect.anything(), expect.anything()] } });
    if (!all.ok) return;

    const resolved = assembleBuildReviewAdjudicationContext({
      aggregate: current,
      priorCases: [],
      operatorResolvedFindingIds: new Set([all.context.currentFindings[0]!.findingId]),
    });
    expect(resolved).toMatchObject({ ok: true, context: { priorCases: [], currentFindings: [expect.objectContaining({ summary: finding('unresolved').summary })] } });
  });

  it('bounds only operator-unresolved sources, not the complete raw aggregate', () => {
    const current = aggregate(...Array.from(
      { length: BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxCurrentSources + 1 },
      (_value, index) => finding(`resolved-${index}`),
    ));
    const rawSources = projectBuildReviewAggregateSources(current)!;

    expect(assembleBuildReviewAdjudicationContext({
      aggregate: current,
      priorCases: [],
      operatorResolvedFindingIds: new Set(rawSources.map((source) => source.findingId)),
    })).toMatchObject({ ok: true, context: { currentFindings: [], priorCases: [] } });
  });

  it('stops before dispatch when operator-unresolved sources exceed the current-source bound', () => {
    const current = aggregate(...Array.from(
      { length: BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxCurrentSources + 1 },
      (_value, index) => finding(`unresolved-${index}`),
    ));

    expect(assembleBuildReviewAdjudicationContext({ aggregate: current, priorCases: [] })).toEqual({
      ok: false,
      stop: {
        code: 'field-overflow',
        subject: 'current-source',
        field: 'currentFindings',
        limit: BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxCurrentSources,
        actual: BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxCurrentSources + 1,
      },
    });
  });

  it('excludes infrastructure results rather than treating them as remediation sources', () => {
    const mixed = joinBuildReviewRubricOutcomes({
      lapId,
      snapshotDigest,
      results: {
        testQuality: {
          kind: 'infrastructure-failure', rubric: 'testQuality', reason: 'provider-error', detail: 'offline',
        },
      },
    });

    expect(assembleBuildReviewAdjudicationContext({ aggregate: mixed, priorCases: [] })).toMatchObject({
      ok: true,
      context: { currentFindings: [], priorCases: [] },
    });
  });

  it.each([
    ['an over-limit prior field', {
      ...priorCase('case-too-long'),
      rationale: 'x'.repeat(BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxTextBytes + 1),
    }, 'field-overflow'],
    ['an unrepresentable prior effect state', {
      ...priorCase('case-bad-effect'),
      effect: { kind: 'none' },
    }, 'unrepresentable-prior-case'],
  ] as const)('stops before dispatch for %s', (_description, caseRecord, code) => {
    expect(assembleBuildReviewAdjudicationContext({ aggregate: aggregate(finding('current')), priorCases: [caseRecord] })).toMatchObject({
      ok: false,
      stop: { code },
    });
  });

  it('stops rather than truncating when the complete serialized projection exceeds its byte ceiling', () => {
    const current = aggregate(finding('current'));
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: current,
      priorCases: Array.from({ length: BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxPriorCases }, (_value, index) => ({
        ...priorCase(`case-${index.toString().padStart(3, '0')}`),
        rationale: 'x'.repeat(BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxTextBytes),
      })),
    });

    expect(result).toEqual({
      ok: false,
      stop: expect.objectContaining({
        code: 'serialized-byte-overflow',
        limit: BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxSerializedBytes,
      }),
    });
  });
  it('declares the case-v1 discriminator and every input field the skill is told to read', () => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('alpha')),
      priorCases: [priorCase('case-first')],
      attemptedCaseIds: ['case-first'],
      planContract: { path: '.docs/plans/example.md', pointers: ['plan contract: .docs/plans/example.md — Task 3 (anchor: test/alpha.test.ts)'] },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '3', status: 'completed' }] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // skills/remediate/SKILL.md selects case mode on `mode` + `domain`, then
    // names exactly these input fields. A context missing any of them routes a
    // real dispatch into the legacy gap-plan branch.
    expect(Object.keys(result.context).sort()).toEqual([
      'currentFindings', 'domain', 'effectPointers', 'lapId', 'mode', 'planContract',
      'priorCases', 'snapshotDigest', 'taskStatus', 'version',
    ]);
    expect(result.context).toMatchObject({
      mode: 'case-v1',
      domain: 'build_review',
      planContract: { path: '.docs/plans/example.md', pointers: [expect.stringContaining('Task 3')] },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '3', status: 'completed' }] },
    });
    // Effect pointers carry the prior effect state AND the durable BUILD
    // attempt evidence, so the judge can tell an interrupted case from a
    // repeatedly attempted one without re-auditing the tree.
    expect(result.context.effectPointers).toEqual([
      'case case-first: action effect effect-case-first applied (work order work-order-case-first); BUILD attempted',
    ]);
  });

  it('states absent plan and task evidence explicitly rather than omitting the field', () => {
    const result = assembleBuildReviewAdjudicationContext({ aggregate: aggregate(finding('alpha')), priorCases: [] });

    expect(result).toMatchObject({ ok: true, context: {
      planContract: { path: null, pointers: [] },
      taskStatus: { path: null, tasks: [] },
      effectPointers: [],
    } });
  });
});
