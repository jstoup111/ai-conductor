// Covers: task:3, task:4, task:5, task:14, task:23, task:28, task:rem-as-built-8, task:rem-as-built-r15-1
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assembleBuildReviewAdjudicationContext,
  BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS,
  buildReviewAdjudicationSourceId,
  describeBuildReviewAdjudicationContextStop,
} from '../../src/engine/build-review-adjudication-context.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { readBuildReviewAdjudicationArtifactFacts } from '../../src/engine/build-review-adjudication-artifact-facts.js';
import { writeBuildReviewBranchArtifact } from '../../src/engine/build-review-artifacts.js';
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
    severity: 'minor',
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
      security: { kind: 'skipped', rubric: 'security', reason: 'disabled' },
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId, snapshotDigest, contractVersion: 'v4',
        findings, verdict: findings.length === 0 ? 'PASS' : 'FAIL',
      },
    },
  });
}

function securityAggregate() {
  return joinBuildReviewRubricOutcomes({
    lapId,
    snapshotDigest,
    results: {
      testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
      security: {
        kind: 'judged', rubric: 'security', lapId, snapshotDigest, contractVersion: 'v4', verdict: 'FAIL',
        findings: [{
          concernKind: 'injection',
          severity: 'minor',
          summary: 'The new request handler interpolates untrusted input into a query.',
          evidenceLocations: ['src/http/search.ts:42'],
          anchor: { rubric: 'security', locus: { path: 'src/http/search.ts', contentHash: HASH, display: 'new search handler' } },
        }],
      },
    },
  });
}

function implementationQualityAggregate() {
  return joinBuildReviewRubricOutcomes({
    lapId, snapshotDigest,
    results: {
      testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
      implementationQuality: {
        kind: 'judged', rubric: 'implementationQuality', lapId, snapshotDigest, contractVersion: 'v4', verdict: 'FAIL',
        findings: [{ concernKind: 'primitive-obsession', severity: 'minor', summary: 'Raw string state permits invalid values.', evidenceLocations: ['src/state.ts:8'], anchor: { rubric: 'implementationQuality', locus: { path: 'src/state.ts', contentHash: HASH, display: 'changed state model' } } }],
      },
    },
  });
}

function customAggregate(criteria?: readonly string[]) {
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
    ...(criteria === undefined ? {} : { criteria: Object.freeze([...criteria]) }),
  };
  const sourceRegion = { path: 'src/handler.ts', startLine: 12, endLine: 16, contentHash: HASH, display: 'changed handler' };
  const result = stampBuildReviewCustomJudgedResult({
    kind: 'custom-findings', version: 'v2',
    findings: [{
      concernId: 'authorization-bypass', summary: 'The changed handler bypasses authorization.',
      evidenceLocations: ['src/handler.ts:12'], confidence: 92, severity: 'major', sourceRegions: [sourceRegion],
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

function priorDecisionStop(id: string): RemediationCaseRecord {
  return {
    ...priorCase(id),
    disposition: 'escalate',
    rationale: `Case ${id} needs an architecture decision before any repair.`,
    sources: [{ sourceId: `security:${id}`, outcome: 'escalate', recordedAt: '2026-08-30T12:00:00.000Z' }],
    effect: { kind: 'none' },
    escalation: { owner: 'architecture' },
    consistencyStop: { sourceIds: [`security:${id}`], rationale: 'The proposed cases contradict the approved baseline.' },
  };
}

function priorAdvisoryCase(id: string): RemediationCaseRecord {
  return {
    ...priorCase(id),
    disposition: 'advisory',
    priority: 'low',
    rationale: `Case ${id} is a minor concern below the declared severity threshold.`,
    resolution: 'resolved',
    sources: [{ sourceId: `testQuality:${id}`, outcome: 'advisory', recordedAt: '2026-10-23T12:00:00.000Z' }],
    effect: { kind: 'none' },
    adjudicatedSeverity: 'minor',
  };
}

describe('build-review adjudication context', () => {
  it('reads bounded finding digests from only a prior case’s four most recent source-lap branch artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-prior-digests-'));
    try {
      const filesystem = {
        mkdir: (path: string) => mkdir(path, { recursive: true }),
        writeFile,
        rename,
      };
      const evidenceLocations = Array.from({ length: 10 }, (_value, index) => `src/prior.ts:${index + 1}`);
      const historical = Array.from({ length: 5 }, (_value, index) => {
        const number = index + 1;
        const sourceLapId = parseBuildReviewLapId(`lap-prior-${number}`)!;
        const sourceFinding: BuildReviewFinding = {
          concernKind: 'test-insensitive', severity: 'minor',
          summary: `artifact-${number}:${'s'.repeat(1_000)}`,
          evidenceLocations,
          anchor: {
            rubric: 'testQuality',
            locus: { path: `test/prior-${number}.test.ts`, contentHash: `sha256:${number.toString().repeat(64)}`, display: `prior ${number}` },
          },
        };
        const sourceAggregate = joinBuildReviewRubricOutcomes({
          lapId: sourceLapId, snapshotDigest: `sha256:prior-${number}`,
          results: {
            security: { kind: 'skipped', rubric: 'security', reason: 'disabled' },
            testQuality: {
              kind: 'judged', rubric: 'testQuality', lapId: sourceLapId, snapshotDigest: `sha256:prior-${number}`,
              contractVersion: 'v4', findings: [sourceFinding], verdict: 'FAIL',
            },
          },
        });
        const [source] = projectBuildReviewAggregateSources(sourceAggregate)!;
        return { number, sourceLapId, sourceFinding, source };
      });
      for (const { sourceLapId, sourceFinding, number } of historical) {
        await writeBuildReviewBranchArtifact(root, {
          rubric: 'testQuality', lapId: sourceLapId, snapshotDigest: `sha256:prior-${number}`,
          result: {
            kind: 'judged', rubric: 'testQuality', lapId: sourceLapId, snapshotDigest: `sha256:prior-${number}`,
            contractVersion: 'v4', findings: [sourceFinding], verdict: 'FAIL',
          },
          provenance: { kind: 'fresh' },
        }, filesystem);
      }
      const sources = historical.map(({ number, source }) => ({
        sourceId: buildReviewAdjudicationSourceId(source!),
        outcome: 'acted' as const,
        recordedAt: `2026-10-2${number - 1}T12:00:00.000Z`,
      }));
      const facts = await readBuildReviewAdjudicationArtifactFacts(root, aggregate(finding('current')));
      const result = assembleBuildReviewAdjudicationContext({
        aggregate: aggregate(finding('current')), priorCases: [{ ...priorCase('case-digests'), sources }],
        priorFindingDigests: facts.priorFindingDigests,
      });

      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.context.priorDigestsOmitted).toBe(0);
      expect(result.context.priorCases[0]!.sources).toEqual([
        sources[0],
        expect.objectContaining({
          ...sources[1],
          finding: {
            rubric: 'testQuality', concernKind: 'test-insensitive',
            summary: `artifact-2:${'s'.repeat(989)}`,
            evidenceLocations: evidenceLocations.slice(0, 8), lapId: 'lap-prior-2',
          },
        }),
        expect.objectContaining({ finding: expect.objectContaining({ summary: `artifact-3:${'s'.repeat(989)}`, lapId: 'lap-prior-3' }) }),
        expect.objectContaining({ finding: expect.objectContaining({ summary: `artifact-4:${'s'.repeat(989)}`, lapId: 'lap-prior-4' }) }),
        expect.objectContaining({ finding: expect.objectContaining({ summary: `artifact-5:${'s'.repeat(989)}`, lapId: 'lap-prior-5' }) }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('drops oldest digest candidates first within the base-context headroom and recomputes for added plan bodies', () => {
    const priorCases = Array.from({ length: 30 }, (_value, caseIndex) => ({
      ...priorCase(`case-${caseIndex.toString().padStart(3, '0')}`),
      sources: Array.from({ length: 4 }, (_source, sourceIndex) => ({
        sourceId: `testQuality:case-${caseIndex.toString().padStart(3, '0')}-${sourceIndex}`,
        outcome: 'acted' as const,
        recordedAt: `2026-10-24T12:00:0${sourceIndex}.000Z`,
      })),
    }));
    const priorFindingDigests = new Map(priorCases.flatMap((prior) => prior.sources.map((source) => [source.sourceId, {
      rubric: 'testQuality', concernKind: 'test-insensitive', summary: 'd'.repeat(1_000),
      evidenceLocations: ['src/prior.ts:1'], lapId: 'lap-prior',
    }] as const)));
    const input = { aggregate: aggregate(finding('current')), priorCases, priorFindingDigests };
    const ordinary = assembleBuildReviewAdjudicationContext(input);
    const expanded = assembleBuildReviewAdjudicationContext({
      ...input,
      planContract: {
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: Array.from({ length: 128 }, (_value, index) => ({ id: String(index), contract: 'p'.repeat(1_500) })),
      },
    });

    expect(ordinary).toMatchObject({ ok: true });
    expect(expanded).toMatchObject({ ok: true });
    if (!ordinary.ok || !expanded.ok) return;
    const countDigests = (context: typeof ordinary.context) => context.priorCases
      .flatMap((prior) => prior.sources).filter((source) => source.finding !== undefined).length;
    expect(ordinary.context.priorDigestsOmitted).toBe(120 - countDigests(ordinary.context));
    expect(expanded.context.priorDigestsOmitted).toBe(120 - countDigests(expanded.context));
    expect(expanded.context.priorDigestsOmitted).toBeGreaterThan(ordinary.context.priorDigestsOmitted);
    expect(expanded.context.priorCases[0]!.sources[0]).not.toHaveProperty('finding');
    expect(Buffer.byteLength(JSON.stringify(expanded.context))).toBeLessThanOrEqual(BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxSerializedBytes);
  });

  it('keeps a prior source without a readable artifact digest and does not count it as budget-omitted', () => {
    const prior = priorCase('case-missing-artifact');
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')), priorCases: [prior], priorFindingDigests: new Map(),
    });

    expect(result).toMatchObject({ ok: true, context: {
      priorDigestsOmitted: 0,
      priorCases: [expect.objectContaining({ sources: [prior.sources[0]] })],
    } });
  });

  it('admits a prior advisory case with no effect as non-blocking history', () => {
    const advisory = priorAdvisoryCase('case-advisory');

    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')),
      priorCases: [advisory],
      suppressions: [{
        kind: 'severity', findingId: 'threshold-advisory', rubric: 'testQuality',
        summary: 'A separate finding is below the severity threshold.', severity: 'minor', threshold: 'major', lastSeenLap: 'lap-prior',
      }],
    });

    expect(result).toEqual({
      ok: true,
      context: expect.objectContaining({
        priorCases: [expect.objectContaining({
          id: 'case-advisory', disposition: 'advisory', effect: { kind: 'none' }, adjudicatedSeverity: 'minor',
        })],
        suppressionHistory: [expect.objectContaining({
          kind: 'severity', findingId: 'threshold-advisory', severity: 'minor', threshold: 'major',
        })],
      }),
    });
  });

  it('marks only carry-eligible prior cases with their acceptance origins', () => {
    const accepted = {
      ...priorCase('case-accepted'),
      resolution: 'resolved' as const,
      operatorAcceptance: {
        origins: [
          { sourceId: 'testQuality:accepted-first', lapId: 'lap-first' },
          { sourceId: 'security:accepted-second', lapId: 'lap-second' },
        ],
      },
    };
    const withdrawn = {
      ...priorCase('case-withdrawn'),
      resolution: 'resolved' as const,
      operatorAcceptance: { origins: [{ sourceId: 'testQuality:withdrawn', lapId: 'lap-prior' }] },
    };
    const noLongerMatches = {
      ...priorCase('case-no-longer-matches'),
      resolution: 'resolved' as const,
      operatorAcceptance: { origins: [{ sourceId: 'testQuality:invalidated', lapId: 'lap-prior' }] },
    };
    const currentLap = {
      ...priorCase('case-current-lap'),
      resolution: 'resolved' as const,
      operatorAcceptance: { origins: [{ sourceId: 'testQuality:current', lapId: 'lap-current' }] },
    };

    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')),
      priorCases: [accepted, withdrawn, noLongerMatches, currentLap],
      carryInput: {
        currentLapId: lapId,
        effectiveAcceptedSourceIds: new Set(['testQuality:accepted-first', 'security:accepted-second', 'testQuality:current']),
      },
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.context.priorCases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'case-accepted',
        operatorAccepted: {
          originSourceIds: ['testQuality:accepted-first', 'security:accepted-second'],
          originLapIds: ['lap-first', 'lap-second'],
        },
      }),
      expect.not.objectContaining({ id: 'case-withdrawn', operatorAccepted: expect.anything() }),
      expect.not.objectContaining({ id: 'case-no-longer-matches', operatorAccepted: expect.anything() }),
      expect.not.objectContaining({ id: 'case-current-lap', operatorAccepted: expect.anything() }),
    ]));
  });

  it('does not expose operator details and preserves the prior-case overflow rule for marked cases', () => {
    const resolvedByOperator = {
      ...priorCase('case-operator-resolved'),
      resolution: 'resolved' as const,
      operatorResolution: {
        operator: 'operator@example.test',
        rationale: 'The operator accepted this bounded risk.',
        resolvedAt: '2026-10-22T12:00:00.000Z',
      },
    };
    const marked = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')),
      priorCases: [resolvedByOperator],
      carryInput: { currentLapId: lapId, effectiveAcceptedSourceIds: new Set() },
    });

    expect(marked).toMatchObject({ ok: true });
    if (!marked.ok) return;
    expect(marked.context.priorCases[0]).toMatchObject({
      operatorAccepted: { originSourceIds: [], originLapIds: [] },
    });
    expect(JSON.stringify(marked.context)).not.toContain('operator@example.test');
    expect(JSON.stringify(marked.context)).not.toContain('The operator accepted this bounded risk.');

    const atCeiling = Array.from({ length: BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxPriorCases }, (_value, index) => ({
      ...priorCase(`case-${index.toString().padStart(3, '0')}`),
      resolution: 'resolved' as const,
      operatorAcceptance: { origins: [{ sourceId: `testQuality:case-${index}`, lapId: 'lap-prior' }] },
      rationale: 'x'.repeat(BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS.maxTextBytes),
    }));
    const unmarked = assembleBuildReviewAdjudicationContext({ aggregate: aggregate(finding('current')), priorCases: atCeiling });
    const overflowingMarked = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')),
      priorCases: atCeiling,
      carryInput: {
        currentLapId: lapId,
        effectiveAcceptedSourceIds: new Set(atCeiling.flatMap((record) => record.operatorAcceptance!.origins.map((origin) => origin.sourceId))),
      },
    });

    expect(unmarked).toMatchObject({ ok: false, stop: { code: 'serialized-byte-overflow' } });
    expect(overflowingMarked).toMatchObject({ ok: false, stop: { code: 'serialized-byte-overflow' } });
  });

  it('requires case-v2 admission for implementation-quality and exposes its raw source question', () => {
    const missing = assembleBuildReviewAdjudicationContext({ aggregate: implementationQualityAggregate(), priorCases: [] });
    expect(missing).toEqual({ ok: false, stop: { code: 'missing-scope-evidence', subject: 'admitted-task-contracts' } });
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: implementationQualityAggregate(), priorCases: [],
      planContract: { path: '.docs/plans/example.md', pointers: [], admittedTaskContracts: [{ id: '28', contract: 'Model the changed state.' }] },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '28', status: 'in_progress' }] },
    });
    expect(result).toMatchObject({ ok: true, context: { mode: 'case-v2', currentFindings: [expect.objectContaining({ rubric: 'implementationQuality' })], policyContext: [expect.objectContaining({ rubric: 'implementationQuality', question: 'Does the changed code introduce a concrete code-quality or domain-modelling defect?' })] } });
  });
  it('projects a persisted decision stop with its owner and consistency evidence intact', () => {
    const stop = priorDecisionStop('stop-a');
    const result = assembleBuildReviewAdjudicationContext({ aggregate: aggregate(finding('alpha')), priorCases: [stop] });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.context.priorCases).toEqual([{
      id: 'stop-a', disposition: 'escalate', priority: 'high', rationale: stop.rationale, confidence: 'high',
      resolution: 'open', sources: stop.sources, effect: { kind: 'none' },
      escalation: { owner: 'architecture' }, consistencyStop: stop.consistencyStop,
    }]);
    expect(result.context.effectPointers).toEqual([]);
    expect(Object.isFrozen(result.context.priorCases[0]!.consistencyStop!.sourceIds)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.context)).priorCases[0]).toMatchObject({
      escalation: { owner: 'architecture' }, consistencyStop: stop.consistencyStop,
    });
  });

  it('projects frozen recurrence lineage and omits it when absent', () => {
    const recurring = {
      ...priorCase('case-recurring'),
      recurrenceOf: ['case-resolved'],
      distinctFrom: [{ caseId: 'case-distinct', reason: 'The changed source is independently owned.' }],
    };
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('alpha')),
      priorCases: [recurring, priorCase('case-without-lineage')],
    });

    expect(result).toMatchObject({
      ok: true,
      context: {
        priorCases: expect.arrayContaining([expect.objectContaining({
          id: 'case-recurring',
          recurrenceOf: ['case-resolved'],
          distinctFrom: [{ caseId: 'case-distinct', reason: 'The changed source is independently owned.' }],
        })]),
      },
    });
    if (!result.ok) return;
    expect(Object.isFrozen(result.context.priorCases[0]!.recurrenceOf)).toBe(true);
    expect(Object.isFrozen(result.context.priorCases[0]!.distinctFrom)).toBe(true);
    expect(result.context.priorCases[1]).not.toHaveProperty('recurrenceOf');
    expect(result.context.priorCases[1]).not.toHaveProperty('distinctFrom');
  });

  it('projects an owner-only and a consistency-only decision stop without inventing the absent evidence', () => {
    const { consistencyStop: _c, ...ownerOnly } = priorDecisionStop('stop-owner');
    const { escalation: _e, ...consistencyOnly } = priorDecisionStop('stop-consistency');
    const result = assembleBuildReviewAdjudicationContext({ aggregate: aggregate(finding('alpha')), priorCases: [ownerOnly, consistencyOnly] });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.context.priorCases.map((record) => Object.keys(record).filter((key) => key === 'escalation' || key === 'consistencyStop')))
      .toEqual([['consistencyStop'], ['escalation']]);
  });

  it.each([
    ['an escalate case with no stop evidence', (stop: RemediationCaseRecord) => { const { escalation: _e, consistencyStop: _c, ...bare } = stop; return bare; }, 'decision-stop'],
    ['an owner outside the store vocabulary', (stop: RemediationCaseRecord) => ({ ...stop, escalation: { owner: 'operator' as never } }), 'escalation.owner'],
    ['an escalate case carrying an effect', (stop: RemediationCaseRecord) => ({ ...stop, effect: { id: 'effect-x', kind: 'deferral' as const, status: 'reserved' as const } }), 'effect'],
    ['an empty consistency source set', (stop: RemediationCaseRecord) => ({ ...stop, consistencyStop: { ...stop.consistencyStop!, sourceIds: [] } }), 'consistencyStop.sourceIds'],
    ['an empty consistency rationale', (stop: RemediationCaseRecord) => ({ ...stop, consistencyStop: { ...stop.consistencyStop!, rationale: '' } }), 'consistencyStop.rationale'],
    ['stop evidence on an ordinary case', () => ({ ...priorCase('stop-a'), escalation: { owner: 'plan' as const } }), 'decision-stop'],
  ])('stops as unrepresentable on %s', (_name, malform, field) => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('alpha')), priorCases: [malform(priorDecisionStop('stop-a'))],
    });

    expect(result).toEqual({ ok: false, stop: { code: 'unrepresentable-prior-case', caseId: 'stop-a', field } });
  });

  it('stops on oversized decision-stop evidence rather than truncating it', () => {
    const limits = BUILD_REVIEW_ADJUDICATION_CONTEXT_LIMITS;
    const stop = priorDecisionStop('stop-a');
    const assemble = (consistencyStop: NonNullable<RemediationCaseRecord['consistencyStop']>) =>
      assembleBuildReviewAdjudicationContext({ aggregate: aggregate(finding('alpha')), priorCases: [{ ...stop, consistencyStop }] });

    expect(assemble({ ...stop.consistencyStop!, rationale: 'r'.repeat(limits.maxTextBytes + 1) })).toEqual({
      ok: false, stop: { code: 'field-overflow', subject: 'prior-case', field: 'consistencyStop.rationale', limit: limits.maxTextBytes, actual: limits.maxTextBytes + 1, caseId: 'stop-a' },
    });
    expect(assemble({ ...stop.consistencyStop!, sourceIds: ['s'.repeat(limits.maxReferenceBytes + 1)] })).toEqual({
      ok: false, stop: { code: 'field-overflow', subject: 'prior-case', field: 'consistencyStop.sourceIds[]', limit: limits.maxReferenceBytes, actual: limits.maxReferenceBytes + 1, caseId: 'stop-a' },
    });
    expect(assemble({ ...stop.consistencyStop!, sourceIds: Array.from({ length: limits.maxSourcesPerCase + 1 }, (_, index) => `s-${index}`) })).toEqual({
      ok: false, stop: { code: 'field-overflow', subject: 'prior-case', field: 'consistencyStop.sourceIds', limit: limits.maxSourcesPerCase, actual: limits.maxSourcesPerCase + 1, caseId: 'stop-a' },
    });
  });

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

  it('keeps an off-plan security finding as a current source without a plan-binding bucket', () => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: securityAggregate(),
      priorCases: [],
      planContract: { path: '.docs/plans/unrelated.md', pointers: ['Task 1: add a UI label'] },
    });

    expect(result).toMatchObject({ ok: true, context: {
      currentFindings: [expect.objectContaining({
        rubric: 'security', concernKind: 'injection', summary: expect.stringContaining('untrusted input'),
        sourceId: expect.stringMatching(/^security:/),
      })],
    } });
    if (!result.ok) return;
    expect(JSON.stringify(result.context)).not.toMatch(/\b(?:beyond|boundTo)\b/);
  });

  it('carries suppression history separately from current findings', () => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')), priorCases: [],
      suppressions: [{ kind: 'confidence', findingId: 'suppressed-id', rubric: 'testQuality', summary: 'Historical low-confidence finding.', confidence: 40, floor: 70, lastSeenLap: 'lap-prior' }],
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
        security: { kind: 'skipped', rubric: 'security', reason: 'disabled' },
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

  it('admits the full task contracts of a ninety-one task plan without a byte-overflow stop', () => {
    // A landed 40-task plan grown by remediation to 91 tasks serialized to
    // 143,451 bytes and halted under the former 128 KiB ceiling.
    const admittedTaskContracts = Array.from({ length: 91 }, (_value, index) => ({
      id: String(index + 1),
      contract: `### Task ${index + 1}: restack step\n${'c'.repeat(1_550)}`,
    }));
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')),
      priorCases: [],
      planContract: { path: '.docs/plans/large.md', pointers: [], admittedTaskContracts },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && Buffer.byteLength(JSON.stringify(result.context))).toBeGreaterThan(128 * 1024);
  });

  it('serializes the complete bounded task index independently of supplied bodies', () => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')),
      priorCases: [],
      planContract: {
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: [{ id: '3', contract: 'Repair the current finding.' }],
        index: [{ id: '3', title: 'Repair finding', dependencies: ['2'] }, { id: '4', title: 'Independent check', dependencies: [] }],
      },
    });

    expect(result).toMatchObject({ ok: true, context: {
      planContract: {
        admittedTaskContracts: [{ id: '3', contract: 'Repair the current finding.' }],
        index: [{ id: '3', title: 'Repair finding', dependencies: ['2'] }, { id: '4', title: 'Independent check', dependencies: [] }],
      },
    } });
    expect(result.ok && JSON.parse(JSON.stringify(result.context)).planContract.index).toEqual([
      { id: '3', title: 'Repair finding', dependencies: ['2'] },
      { id: '4', title: 'Independent check', dependencies: [] },
    ]);
  });

  it('stops when the plan index exceeds its bounded entry count', () => {
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: aggregate(finding('current')),
      priorCases: [],
      planContract: {
        path: '.docs/plans/example.md', pointers: [],
        index: Array.from({ length: 1_025 }, (_value, index) => ({ id: String(index), title: `Task ${index}`, dependencies: [] })),
      },
    });

    expect(result).toEqual({ ok: false, stop: {
      code: 'field-overflow', subject: 'plan-index', field: 'index', limit: 1_024, actual: 1_025,
    } });
  });

  it('keeps both plan task projections empty when no plan is bound', () => {
    const result = assembleBuildReviewAdjudicationContext({ aggregate: aggregate(finding('current')), priorCases: [] });

    expect(result).toMatchObject({ ok: true, context: {
      planContract: { path: null, admittedTaskContracts: [], index: [] },
    } });
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
      'admittedDispositions', 'currentFindings', 'declaredSeverityThresholds', 'domain', 'effectPointers', 'lapId', 'lifecycleOwners', 'mode',
      'planContract', 'policyContext', 'priorCases', 'priorDigestsOmitted', 'snapshotDigest', 'suppressionHistory', 'taskStatus', 'version',
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

  it('prefers explicit short criteria over the declared resource references', () => {
    const explicit = ['authorization-boundary', 'authorized-route-regression'];
    const result = assembleBuildReviewAdjudicationContext({
      aggregate: customAggregate(explicit),
      priorCases: [],
      planContract: {
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: [{ id: '28', contract: 'Preserve the authorization boundary.' }],
      },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '28', status: 'in_progress' }] },
    });

    expect(result).toMatchObject({ ok: true, context: {
      policyContext: [{ rubric: 'security', effectivePolicyIdentity: POLICY_DIGEST, criteria: explicit }],
    } });
  });

  it('delivers a criterion at the reference bound whole and stops, untruncated, on one byte more', () => {
    const atBound = 'é'.repeat(128);
    const evidence = {
      priorCases: [],
      planContract: {
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: [{ id: '28', contract: 'Preserve the authorization boundary.' }],
      },
      taskStatus: { path: '.pipeline/task-status.json', tasks: [{ id: '28', status: 'in_progress' }] },
    };

    const complete = assembleBuildReviewAdjudicationContext({ aggregate: customAggregate([atBound]), ...evidence });
    expect(complete.ok, JSON.stringify(complete)).toBe(true);
    if (!complete.ok) return;
    expect(complete.context.policyContext[0]!.criteria).toEqual([atBound]);

    expect(assembleBuildReviewAdjudicationContext({ aggregate: customAggregate([`${atBound}x`]), ...evidence })).toEqual({
      ok: false,
      stop: { code: 'field-overflow', subject: 'policy-context', field: 'criteria[]', limit: 256, actual: 257 },
    });
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

describe('describeBuildReviewAdjudicationContextStop', () => {
  it('names the subject, field, and bound of every stop shape', () => {
    expect([
      describeBuildReviewAdjudicationContextStop({ code: 'invalid-aggregate' }),
      describeBuildReviewAdjudicationContextStop({ code: 'missing-scope-evidence', subject: 'task-status' }),
      describeBuildReviewAdjudicationContextStop({ code: 'field-overflow', subject: 'admitted-task-contract', field: 'contract', limit: 8000, actual: 13038 }),
      describeBuildReviewAdjudicationContextStop({ code: 'field-overflow', subject: 'prior-case', field: 'summary', limit: 8000, actual: 9000, caseId: 'case-1' }),
      describeBuildReviewAdjudicationContextStop({ code: 'unrepresentable-prior-case', caseId: 'case-2', field: 'effect' }),
      describeBuildReviewAdjudicationContextStop({ code: 'serialized-byte-overflow', limit: 131072, actual: 140000 }),
    ]).toEqual([
      'invalid-aggregate',
      'missing-scope-evidence (task-status)',
      'field-overflow (admitted-task-contract.contract: 13038 > 8000)',
      'field-overflow (prior-case case-1.summary: 9000 > 8000)',
      'unrepresentable-prior-case (case-2.effect)',
      'serialized-byte-overflow (140000 > 131072 bytes)',
    ]);
  });
});
