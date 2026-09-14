// Covers: task:3, task:4, task:28
import { describe, expect, it } from 'vitest';

import {
  assembleBuildReviewAdjudicationContext,
  BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS,
} from '../../src/engine/build-review-adjudication-context.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId, type BuildReviewFinding } from '../../src/engine/build-review-domain.js';
import { stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import type { RemediationCaseRecord } from '../../src/engine/remediation-case-store.js';

const lapId = parseBuildReviewLapId('lap-current')!;
const snapshotDigest = 'sha256:snapshot';
const HASH = `sha256:${'a'.repeat(64)}`;
const POLICY_DIGEST = `sha256:${'c'.repeat(64)}`;

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

function customAggregate() {
  const declaration = {
    version: 'v1' as const, rubricId: 'security', semanticSkill: 'security-review',
    question: 'Does the changed code preserve the security boundary?',
    source: 'plugin' as const, resources: ['references/security-criteria.md'],
  };
  const descriptor = {
    version: 'v1' as const, semanticSkill: 'security-review', declaration,
    installation: { source: 'plugin' as const, plugin: { id: 'security-suite', version: '2.1.0' } },
    effectivePolicy: { version: 'v1' as const, bundleDigest: POLICY_DIGEST },
    reviewedInput: { version: 'v1' as const, contentDigest: POLICY_DIGEST },
    producer: { provider: 'codex', model: 'gpt-5.6', effort: 'high' },
  };
  const sourceRegion = { path: 'src/handler.ts', startLine: 12, endLine: 16, contentHash: HASH, display: 'changed handler' };
  const result = stampBuildReviewCustomJudgedResult({
    kind: 'custom-findings', version: 'v1',
    findings: [{
      concernId: 'authorization-bypass', summary: 'The changed handler bypasses authorization.',
      evidenceLocations: ['src/handler.ts:12'], confidence: 92, sourceRegions: [sourceRegion],
    }],
  }, {
    rubric: 'security', lapId, declaration, policy: descriptor.effectivePolicy,
    candidate: descriptor.producer, reviewedInput: descriptor.reviewedInput,
  }, { sourceRegions: [sourceRegion] })!;
  return joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest,
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest, contractVersion: 'v3',
        findings: [], verdict: 'PASS',
      },
    },
    customResults: {
      security: {
        descriptor,
        result,
      },
    },
    currentCustomRubrics: ['security'],
  } as never);
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

function priorRefutedCase(id: string): RemediationCaseRecord {
  return {
    ...priorCase(id),
    disposition: 'refute',
    rationale: `Case ${id} was refuted by the focused regression test.`,
    resolution: 'resolved',
    sources: [{ sourceId: `testQuality:${id}`, outcome: 'refuted', recordedAt: '2026-08-30T12:00:00.000Z' }],
    effect: { kind: 'none' },
    refutation: {
      claim: 'The alleged coverage gap does not exist.',
      assertions: [{
        assertion: 'The regression test covers the changed path.',
        verdict: 'refuted',
        evidence: [{ path: 'test/regression.test.ts', excerpt: 'covers the changed path' }],
      }],
    },
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

  it('carries suppression history separately from current findings', () => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')), priorCases: [],
      suppressions: [{ findingId: 'suppressed-id', rubric: 'testQuality', summary: 'Historical low-confidence finding.', confidence: 40, floor: 70, lastSeenLap: 'lap-prior' }],
    });
    expect(result).toMatchObject({ ok: true, context: {
      currentFindings: [expect.objectContaining({ summary: finding('current').summary })],
      suppressionHistory: [expect.objectContaining({ findingId: 'suppressed-id', lastSeenLap: 'lap-prior' })],
    } });
  });

  it('projects the complete refutation for a prior refuted case', () => {
    const refuted = priorRefutedCase('case-refuted');
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')),
      priorCases: [refuted],
    });

    expect(result).toMatchObject({ ok: true, context: {
      priorCases: [expect.objectContaining({
        id: 'case-refuted', disposition: 'refute', resolution: 'resolved', refutation: refuted.refutation,
      })],
    } });
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
      'currentFindings', 'domain', 'effectPointers', 'lapId', 'lifecycleOwners', 'mode',
      'planContract', 'policyContext', 'priorCases', 'snapshotDigest', 'suppressionHistory', 'taskStatus', 'version',
    ]);
    expect(result.context).toMatchObject({
      mode: 'case-v1',
      domain: 'build_review',
      planContract: { path: '.docs/plans/example.md', pointers: [expect.stringContaining('Task 3')] },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '3', status: 'completed' }] },
      suppressionHistory: [],
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

  it('delivers every custom policy boundary, reserved owner, and full admitted task contract', () => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: customAggregate(),
      priorCases: [priorCase('case-security')],
      planContract: {
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: [{
          id: '28',
          contract: '**Steps:**\n1. Preserve the authorization boundary.\n\n**Done when:**\n- The authorized route is covered.',
        }],
      },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '28', status: 'in_progress' }] },
    });

    expect(result).toMatchObject({ ok: true, context: {
      mode: 'case-v2',
      currentFindings: [expect.objectContaining({ rubric: 'security', concernKind: 'authorization-bypass' })],
      policyContext: [{
        rubric: 'security',
        question: 'Does the changed code preserve the security boundary?',
        effectivePolicyIdentity: POLICY_DIGEST,
        criteria: ['references/security-criteria.md'],
      }],
      lifecycleOwners: expect.objectContaining({
        productCompletion: 'prd_audit', architectureChoice: 'architecture_review', planGrowth: 'prd_audit',
      }),
      planContract: expect.objectContaining({
        admittedTaskContracts: [{ id: '28', contract: expect.stringContaining('authorization boundary') }],
      }),
      priorCases: [expect.objectContaining({ id: 'case-security' })],
    } });
  });

  it('stops rather than dispatching a custom policy without complete scope evidence', () => {
    expect(assembleBuildReviewAdjudicationContext({
      aggregate: customAggregate(), priorCases: [],
      planContract: { path: '.docs/plans/example.md', pointers: [] },
      taskStatus: { path: null, tasks: [] },
    })).toEqual({
      ok: false,
      stop: { code: 'missing-scope-evidence', subject: 'admitted-task-contracts' },
    });
  });
});
