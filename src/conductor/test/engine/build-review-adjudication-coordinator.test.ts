// Covers: task:1, task:3, task:4, task:5, task:6, task:7, task:8, task:12, task:14, task:16, task:34, task:rem-as-built-rem-ab1-4, task:rem-as-built-rem-asbuilt-b00b54a4-5-r1, task:rem-as-built-rem-asbuilt-0d789f28-1-r1, task:rem-prd-audit-refusal-d18cb085-2ffb-44bf-9999-75aa58a055de, task:rem-prd-audit-r18-2
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { coordinateBuildReviewAdjudication } from '../../src/engine/build-review-adjudication-coordinator.js';
import { persistBuildReviewSuppressions } from '../../src/engine/build-review-suppression-history.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import { buildReviewAdjudicationSourceId } from '../../src/engine/build-review-adjudication-context.js';
import { resolveEffectiveBuildReviewVerdict } from '../../src/engine/build-review-effective.js';
import { canonicalizeBuildReviewFindingIdentity, stampBuildReviewCustomJudgedResult } from '../../src/engine/build-review-finding-identity.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { RemediationCaseJudgement } from '../../src/engine/remediation-case-artifact.js';
import type { RemediationCaseStoreState } from '../../src/engine/remediation-case-store.js';
import { RemediationCaseStore, remediationCaseStorePath } from '../../src/engine/remediation-case-store.js';
import { BuildReviewDispositionStore } from '../../src/engine/build-review-dispositions.js';
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
    security: { kind: 'skipped', rubric: 'security', reason: 'disabled' },
    testQuality: {
      kind: 'judged', rubric: 'testQuality', lapId: 'lap-1' as never, snapshotDigest: 'snapshot-1', contractVersion: 'v3', verdict: 'FAIL',
      findings: [{
        concernKind: 'test-insensitive', summary: 'The changed test is insensitive.', severity: 'minor', evidenceLocations: ['test/example.test.ts:1'],
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
const CUSTOM_DIGEST = `sha256:${'c'.repeat(64)}`;

function customMixedAggregate(criteria?: readonly string[], regionHash = `sha256:${'a'.repeat(64)}`) {
  const declaration = {
    version: 'v1' as const, rubricId: 'security', semanticSkill: 'security-review',
    question: 'Does the changed code preserve the security boundary?',
    source: 'project' as const, resources: ['criteria/security.md'],
  };
  const descriptor = {
    version: 'v1' as const, semanticSkill: 'security-review', declaration,
    installation: { source: 'project' as const },
    effectivePolicy: { version: 'v1' as const, bundleDigest: CUSTOM_DIGEST },
    ...(criteria === undefined ? {} : { criteria }),
    reviewedInput: { version: 'v1' as const, contentDigest: CUSTOM_DIGEST },
    producer: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
  };
  const sourceRegion = {
    path: 'src/handler.ts', startLine: 12, endLine: 16,
    contentHash: regionHash, display: 'authorization handler',
  };
  const judged = stampBuildReviewCustomJudgedResult({
    kind: 'custom-findings', version: 'v2', findings: [{
      concernId: 'authorization-bypass', summary: 'The changed handler bypasses authorization.',
      evidenceLocations: ['src/handler.ts:12'], confidence: 92, severity: 'major', sourceRegions: [sourceRegion],
    }],
  }, {
    rubric: 'security', lapId: 'lap-custom-mixed', declaration,
    policy: descriptor.effectivePolicy, candidate: descriptor.producer,
    reviewedInput: descriptor.reviewedInput,
  }, { sourceRegions: [sourceRegion] })!;
  return joinBuildReviewRubricOutcomes({
    lapId: 'lap-custom-mixed' as never, snapshotDigest: 'snapshot-custom-mixed',
    results: {
      testQuality: {
        kind: 'judged', rubric: 'testQuality', lapId: 'lap-custom-mixed' as never,
        snapshotDigest: 'snapshot-custom-mixed', contractVersion: 'v3', findings: [], verdict: 'PASS',
      },
    },
    customResults: {
      security: { descriptor, result: judged },
      availability: {
        declaration: {
          version: 'v1', rubricId: 'availability', semanticSkill: 'availability-review',
          question: 'Is the installed policy available?', source: 'project', resources: ['criteria/availability.md'],
        },
        result: {
          kind: 'infrastructure-failure', rubric: 'availability', reason: 'policy-load-failed',
          detail: 'custom policy metadata is unavailable',
        },
      },
    },
    currentCustomRubrics: ['security', 'availability'],
  } as never);
}

const securityAggregate = joinBuildReviewRubricOutcomes({
  lapId: 'lap-security' as never,
  snapshotDigest: 'snapshot-security',
  results: {
    testQuality: { kind: 'skipped', rubric: 'testQuality', reason: 'disabled' },
    security: {
      kind: 'judged', rubric: 'security', lapId: 'lap-security' as never, snapshotDigest: 'snapshot-security', contractVersion: 'v3', verdict: 'FAIL',
      findings: [{
        concernKind: 'injection', summary: 'A new query interpolates untrusted input.', severity: 'minor', evidenceLocations: ['src/search.ts:42'],
        anchor: { rubric: 'security', locus: { path: 'src/search.ts', contentHash: `sha256:${'b'.repeat(64)}`, display: 'new search query' } },
      }],
    },
  },
});
const rawSecuritySource = projectBuildReviewAggregateSources(securityAggregate)![0]!;
const securitySourceId = buildReviewAdjudicationSourceId(rawSecuritySource);

// A mixed lap: one finding the operator has already accepted (or accepts
// mid-lap) alongside a live sibling. Late authority must suppress only its own
// source, never fail the whole lap closed.
const mixedAggregate = joinBuildReviewRubricOutcomes({
  lapId: 'lap-2' as never,
  snapshotDigest: 'snapshot-2',
  results: {
    security: { kind: 'skipped', rubric: 'security', reason: 'disabled' },
    testQuality: {
      kind: 'judged', rubric: 'testQuality', lapId: 'lap-2' as never, snapshotDigest: 'snapshot-2', contractVersion: 'v3', verdict: 'FAIL',
      findings: [
        {
          concernKind: 'test-insensitive', summary: 'The first changed test is insensitive.', severity: 'minor', evidenceLocations: ['test/first.test.ts:1'],
          anchor: { rubric: 'testQuality', locus: { path: 'test/first.test.ts', contentHash: 'sha256:first', display: 'first test' } },
        },
        {
          concernKind: 'test-insensitive', summary: 'The second changed test is insensitive.', severity: 'minor', evidenceLocations: ['test/second.test.ts:1'],
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

// Twelve sources, so the settlement bound must come from the source list
// rather than a literal round count: acceptances that trickle in one per
// authority read need more rounds than the retired hard-coded three, which
// exited on an exit set that predated the acceptances it had just read.
const staggeredAggregate = joinBuildReviewRubricOutcomes({
  lapId: 'lap-3' as never,
  snapshotDigest: 'snapshot-3',
  results: {
    security: { kind: 'skipped', rubric: 'security', reason: 'disabled' },
    testQuality: {
      kind: 'judged', rubric: 'testQuality', lapId: 'lap-3' as never, snapshotDigest: 'snapshot-3', contractVersion: 'v3', verdict: 'FAIL',
      findings: [
        'one', 'two', 'three', 'four', 'five', 'six',
        'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
      ].map((name) => ({
        concernKind: 'test-insensitive' as const,
        summary: `The ${name} changed test is insensitive.`,
        evidenceLocations: [`test/${name}.test.ts:1`],
        anchor: {
          rubric: 'testQuality' as const,
          locus: { path: `test/${name}.test.ts`, contentHash: `sha256:${name}`, display: `${name} test` },
        },
      })),
    },
  },
});
const staggeredSources = projectBuildReviewAggregateSources(staggeredAggregate)!;

/** One case per source, so each late acceptance retires exactly its own. */
function staggeredJudgement(): RemediationCaseJudgement {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: staggeredSources.map((source, index) => ({
      sourceId: buildReviewAdjudicationSourceId(source), outcome: 'acted' as const, caseRef: `case-${index + 1}`,
    })),
    cases: staggeredSources.map((_, index) => ({
      caseRef: `case-${index + 1}`, disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
      rationale: `Test ${index + 1} needs a focused assertion.`,
      effect: { kind: 'action' as const, route: 'build' as const, tasks: [{ title: `Repair test ${index + 1}` }] },
    })),
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

function securityActionJudgement(): RemediationCaseJudgement {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [{ sourceId: securitySourceId, outcome: 'acted', caseRef: 'security-case' }],
    cases: [{
      caseRef: 'security-case', disposition: 'act', priority: 'critical', confidence: 'high',
      rationale: 'The injected query must be parameterized before shipping.',
      effect: { kind: 'action', route: 'build', tasks: [{ title: 'Parameterize the search query' }] },
    }],
  };
}

function securityDeferralJudgement(): RemediationCaseJudgement {
  return {
    mode: 'case-v1', domain: 'build_review',
    sourceOutcomes: [{ sourceId: securitySourceId, outcome: 'deferred', caseRef: 'security-case' }],
    cases: [{
      caseRef: 'security-case', disposition: 'defer', priority: 'low', confidence: 'high',
      rationale: 'The risk is documented for a separately scheduled hardening change.',
      effect: { kind: 'deferral', title: 'Harden the search query', body: 'Untrusted input reaches the query builder.', exclusionRationale: 'The current feature does not own this handler.' },
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
    | 'remediation_effect_failed' | 'remediation_semantic_repeat_halt' | 'remediation_case_refuted';
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

function decisionStopScope() {
  const aggregate = customMixedAggregate();
  const sourceId = buildReviewAdjudicationSourceId(projectBuildReviewAggregateSources(aggregate)!.find((source) => source.rubric === 'security')!);
  return {
    aggregate, sourceId, mechanical: 'retry' as const,
    readPlanContract: async () => ({ path: '.docs/plans/example.md', pointers: [], admittedTaskContracts: [] }),
    readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [] }),
  };
}

function failOnlyDecisionStopMutation(reason: 'lock-timeout' | 'malformed-state') {
  const originalMutate = RemediationCaseStore.prototype.mutate;
  return vi.spyOn(RemediationCaseStore.prototype, 'mutate').mockImplementation(async function (this: RemediationCaseStore, callback) {
    // Probe the reducer without writing. Decision-stop persistence is the only
    // mutation here whose value has this terminal status shape.
    const probe = await callback({ version: 'v1', feature, cases: [] });
    const value = (probe as { value?: unknown }).value;
    if (typeof value === 'object' && value !== null && 'status' in value &&
      ['persisted', 'already-persisted', 'already-resolved'].includes((value as { status?: string }).status ?? '')) {
      return { ok: false, reason } as never;
    }
    return originalMutate.call(this, callback);
  });
}

describe('coordinateBuildReviewAdjudication', () => {
  const customAggregate = customMixedAggregate();
  const customSource = projectBuildReviewAggregateSources(customAggregate)!.find((source) => source.rubric === 'security')!;

  it('rejects an advisory judgement when its live source rubric lacks a declared threshold', async () => {
    const advisoryJudgement = (): RemediationCaseJudgement => ({
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'advisory', caseRef: 'advisory-case' }],
      cases: [{
        caseRef: 'advisory-case', disposition: 'advisory', priority: 'low', confidence: 'high',
        rationale: 'The reviewer finding is below the declared severity threshold.',
        effect: { kind: 'none' }, adjudicatedSeverity: 'minor',
      }],
    });

    const rejected = await coordinateBuildReviewAdjudication({
      ...input(await projectRoot(), async () => advisoryJudgement()),
      declaredSeverityThresholds: { security: 'major' },
    });

    expect(rejected).toMatchObject({
      ok: false,
      detail: 'invalid remediation judgement invalid-advisory-threshold',
    });
  });

  it('routes an explicitly bound accepted action re-raise through the carry lane', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const origin = 'testQuality:accepted-on-lap-1';
    await seedCases(store, {
      version: 'v3', feature, prdWideningCases: [], suppressions: [], outbox: [],
      cases: [{
        id: 'accepted-case', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The original finding was accepted.', resolution: 'resolved',
        sources: [{ sourceId: origin, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
        operatorAcceptance: { origins: [{ sourceId: origin, lapId: 'lap-old' }] },
        effect: { id: 'accepted-effect', kind: 'action', status: 'applied', workOrderId: 'accepted-order' },
      }],
    });
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'carry' }],
      cases: [{
        caseRef: 'carry', existingCaseId: 'accepted-case', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The later finding is explicitly bound to the accepted case.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Must not be published' }] },
      }],
    };
    const charge = vi.fn(chargeBuildReviewEffectInLedger);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement),
      resolveEffectiveAcceptedSourceIds: async () => new Set([origin]),
      chargeEffect: charge,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, route: 'pass' }));
    expect(charge).not.toHaveBeenCalled();
    await expect(store.read()).resolves.toMatchObject({ ok: true, state: { cases: [expect.objectContaining({
      id: 'accepted-case', resolution: 'resolved',
      sources: expect.arrayContaining([{ sourceId, outcome: 'carried', recordedAt: expect.any(String) }]),
    })] } });
  });

  // Covers: task:rem-prd-audit-R10c
  it('treats a blocked consistency verdict over only carried F2 as consistent', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const origin = 'testQuality:accepted-consistency';
    await seedCases(store, {
      version: 'v3', feature, prdWideningCases: [], suppressions: [], outbox: [],
      cases: [{
        id: 'case-carried-only', domain: 'build_review', disposition: 'escalate', priority: 'high', confidence: 'high',
        rationale: 'The earlier decision was accepted.', resolution: 'resolved',
        sources: [{ sourceId: origin, outcome: 'escalate', recordedAt: '2026-10-20T00:00:00.000Z' }],
        operatorAcceptance: { origins: [{ sourceId: origin, lapId: 'lap-old' }] },
        escalation: { owner: 'architecture' }, effect: { kind: 'none' },
      }],
    });
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'F2' }],
      cases: [{
        caseRef: 'F2', existingCaseId: 'case-carried-only', disposition: 'escalate', priority: 'high', confidence: 'high',
        rationale: 'The accepted decision remains bound.', escalation: { owner: 'architecture' }, effect: { kind: 'none' },
      }],
      consistency: { verdict: 'blocked', sourceIds: [sourceId], caseRefs: ['F2'], rationale: 'Only the carried decision is blocked.' },
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), resolveEffectiveAcceptedSourceIds: async () => new Set([origin]),
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    await expect(store.read()).resolves.toMatchObject({ ok: true, state: { cases: [expect.objectContaining({
      id: 'case-carried-only', resolution: 'resolved',
    })] } });
    await expect(access(join(root, '.pipeline', 'HALT'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Covers: task:10, task:rem-as-built-R10a, task:rem-prd-audit-R10c
  it('does not let a carried escalation suppress its independent action sibling', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const origin = 'testQuality:accepted-escalation';
    const carriedSourceId = buildReviewAdjudicationSourceId(acceptedSource);
    const actionSourceId = buildReviewAdjudicationSourceId(liveSource);
    await seedCases(store, {
      version: 'v3', feature, prdWideningCases: [], suppressions: [], outbox: [],
      cases: [{
        id: 'case-carried-escalation', domain: 'build_review', disposition: 'escalate', priority: 'high', confidence: 'high',
        rationale: 'The earlier owner decision was accepted.', resolution: 'resolved',
        sources: [{ sourceId: origin, outcome: 'escalate', recordedAt: '2026-10-20T00:00:00.000Z' }],
        operatorAcceptance: { origins: [{ sourceId: origin, lapId: 'lap-old' }] },
        escalation: { owner: 'architecture' }, effect: { kind: 'none' },
      }],
    });
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [
        { sourceId: carriedSourceId, outcome: 'escalate', caseRef: 'F2' },
        { sourceId: actionSourceId, outcome: 'acted', caseRef: 'A' },
      ],
      cases: [
        {
          caseRef: 'F2', existingCaseId: 'case-carried-escalation', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'The accepted owner decision remains explicitly bound.', escalation: { owner: 'architecture' }, effect: { kind: 'none' },
        },
        {
          caseRef: 'A', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The independent finding needs a repair.', effect: { kind: 'action', route: 'build', tasks: [{
            title: 'Repair the independent finding', admittedTaskIds: ['34'], admissionRationale: 'Task 34 owns the independent repair.',
          }] },
        },
      ],
      consistency: { verdict: 'blocked', sourceIds: [carriedSourceId], caseRefs: ['F2'], rationale: 'The carried decision does not cover the independent repair.' },
    };
    const events: RemediationCaseLifecycleEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), aggregate: mixedAggregate, generateId: sequentialIds('carried-escalation'),
      resolveEffectiveAcceptedSourceIds: async () => new Set([origin]), emit: async (event) => { events.push(event); },
      readPlanContract: async () => ({ path: '.docs/plans/example.md', pointers: [], admittedTaskContracts: [{ id: '34', contract: 'Independent repair.' }] }),
      readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '34', status: 'in_progress' }] }),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'remediation_effect_reserved' }));
    const settled = await store.read();
    expect(settled.ok && settled.state.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'case-carried-escalation', sources: expect.arrayContaining([{ sourceId: carriedSourceId, outcome: 'carried', recordedAt: expect.any(String) }]) }),
      expect.objectContaining({ disposition: 'act', effect: expect.objectContaining({ kind: 'action', status: 'applied' }) }),
    ]));
  });

  // Covers: task:rem-prd-audit-R10c
  it('persists a mixed carried/live consistency stop for G only and leaves A unreserved', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const origin = 'testQuality:accepted-escalation';
    const carriedSourceId = buildReviewAdjudicationSourceId(acceptedSource);
    const liveSourceId = buildReviewAdjudicationSourceId(liveSource);
    await seedCases(store, {
      version: 'v3', feature, prdWideningCases: [], suppressions: [], outbox: [],
      cases: [{
        id: 'case-carried-escalation', domain: 'build_review', disposition: 'escalate', priority: 'high', confidence: 'high',
        rationale: 'The earlier owner decision was accepted.', resolution: 'resolved',
        sources: [{ sourceId: origin, outcome: 'escalate', recordedAt: '2026-10-20T00:00:00.000Z' }],
        operatorAcceptance: { origins: [{ sourceId: origin, lapId: 'lap-old' }] },
        escalation: { owner: 'architecture' }, effect: { kind: 'none' },
      }],
    });
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [
        { sourceId: carriedSourceId, outcome: 'escalate', caseRef: 'F2' },
        { sourceId: liveSourceId, outcome: 'acted', caseRef: 'A' },
      ],
      cases: [
        {
          caseRef: 'F2', existingCaseId: 'case-carried-escalation', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'The accepted owner decision remains explicitly bound.', escalation: { owner: 'architecture' }, effect: { kind: 'none' },
        },
        {
          caseRef: 'A', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The independent finding needs a repair.', effect: { kind: 'action', route: 'build', tasks: [{
            title: 'Repair the independent finding', admittedTaskIds: ['34'], admissionRationale: 'Task 34 owns the independent repair.',
          }] },
        },
      ],
      consistency: {
        verdict: 'blocked', sourceIds: [carriedSourceId, liveSourceId], caseRefs: ['F2', 'A'],
        rationale: 'The live repair contradicts the approved baseline.',
      },
    };
    const charge = vi.fn(chargeBuildReviewEffectInLedger);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), aggregate: mixedAggregate, generateId: sequentialIds('mixed-consistency'),
      resolveEffectiveAcceptedSourceIds: async () => new Set([origin]), chargeEffect: charge,
      readPlanContract: async () => ({ path: '.docs/plans/example.md', pointers: [], admittedTaskContracts: [{ id: '34', contract: 'Independent repair.' }] }),
      readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '34', status: 'in_progress' }] }),
    });

    expect(result).toMatchObject({ ok: true, route: 'halt' });
    expect(charge).not.toHaveBeenCalled();
    const settled = await store.read();
    expect(settled).toMatchObject({ ok: true, state: { cases: expect.arrayContaining([
      expect.objectContaining({ consistencyStop: expect.objectContaining({ sourceIds: [liveSourceId] }) }),
    ]) } });
    if (!settled.ok) throw new Error(`unexpected case-store failure: ${settled.reason}`);
    expect(settled.state.cases.some((record) => record.disposition === 'act')).toBe(false);
  });

  // Covers: task:10, task:rem-as-built-R10b
  it('carries a refute binding without emitting a refutation occurrence', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const origin = 'testQuality:accepted-refutation';
    await seedCases(store, {
      version: 'v3', feature, prdWideningCases: [], suppressions: [], outbox: [],
      cases: [{
        id: 'case-carried-refutation', domain: 'build_review', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The earlier finding was refuted and accepted.', resolution: 'resolved',
        sources: [{ sourceId: origin, outcome: 'refuted', recordedAt: '2026-10-20T00:00:00.000Z' }],
        operatorAcceptance: { origins: [{ sourceId: origin, lapId: 'lap-old' }] }, effect: { kind: 'none' },
        refutation: { claim: 'The earlier finding is refuted.', assertions: [{ assertion: 'The proof exists.', verdict: 'refuted', evidence: [{ path: 'test/example.test.ts', excerpt: 'proof' }] }] },
      }],
    });
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'refuted', caseRef: 'F2' }],
      cases: [{
        caseRef: 'F2', existingCaseId: 'case-carried-refutation', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The accepted refutation remains explicitly bound.', effect: { kind: 'none' },
        refutation: { claim: 'The current finding is refuted.', assertions: [{ assertion: 'The proof exists.', verdict: 'refuted', evidence: [{ path: 'test/missing-proof.test.ts', excerpt: 'proof' }] }] },
      }],
    };
    const events: RemediationCaseLifecycleEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), resolveEffectiveAcceptedSourceIds: async () => new Set([origin]),
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(events.map((event) => event.type)).not.toContain('remediation_case_refuted');
    await expect(store.read()).resolves.toMatchObject({ ok: true, state: { cases: [expect.objectContaining({
      id: 'case-carried-refutation', sources: expect.arrayContaining([{ sourceId, outcome: 'carried', recordedAt: expect.any(String) }]),
    })] } });
  });

  it.each([
    ['built-in finding on an open case', aggregate, rawSource, 'open'],
    ['built-in finding on a resolved case', aggregate, rawSource, 'resolved'],
    ['custom-rubric finding on an open case', customAggregate, customSource, 'open'],
    ['custom-rubric finding on a resolved case', customAggregate, customSource, 'resolved'],
  ] as const)('records an acceptance origin while finalizing a %s', async (_kind, currentAggregate, currentSource, initialResolution) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const currentSourceId = buildReviewAdjudicationSourceId(currentSource);
    await seedCases(store, {
      version: 'v3', feature,
      cases: [{
        id: 'case-open', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The finding needs a focused repair.', resolution: initialResolution,
        sources: [{ sourceId: currentSourceId, outcome: 'acted', recordedAt: '2026-10-22T00:00:00.000Z' }],
        effect: { id: 'effect-open', kind: 'action', status: 'applied', workOrderId: 'order-open' },
      }],
      prdWideningCases: [], suppressions: [], outbox: [],
    });

    await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), aggregate: currentAggregate,
      operatorResolvedFindingIds: new Set([currentSource.findingId]),
    });

    const settled = await store.read();
    expect(settled.ok && settled.state.cases[0]).toMatchObject({
      resolution: 'resolved',
      operatorAcceptance: { origins: [{ sourceId: currentSourceId, lapId: currentAggregate.lapId }] },
    });
  });

  it('records only an exact unsuppressed acceptance once on a partially open case', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const acceptedSourceId = buildReviewAdjudicationSourceId(acceptedSource);
    const liveSourceId = buildReviewAdjudicationSourceId(liveSource);
    await seedCases(store, {
      version: 'v3', feature,
      cases: [{
        id: 'case-partial', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The second finding still needs a focused repair.', resolution: 'open',
        sources: [
          { sourceId: acceptedSourceId, outcome: 'acted', recordedAt: '2026-10-22T00:00:00.000Z' },
          { sourceId: liveSourceId, outcome: 'acted', recordedAt: '2026-10-22T00:00:00.000Z' },
        ],
        effect: { id: 'effect-partial', kind: 'action', status: 'applied', workOrderId: 'order-partial' },
      }],
      prdWideningCases: [], suppressions: [], outbox: [],
    });
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId: liveSourceId, outcome: 'acted', caseRef: 'case-partial' }],
      cases: [{
        caseRef: 'case-partial', existingCaseId: 'case-partial', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The second finding still needs a focused repair.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the second test' }] },
      }],
    };

    await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), aggregate: mixedAggregate,
      operatorResolvedFindingIds: new Set([acceptedSource.findingId]),
    });
    await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), aggregate: mixedAggregate,
      operatorResolvedFindingIds: new Set([acceptedSource.findingId]),
    });

    const settled = await store.read();
    expect(settled.ok && settled.state.cases[0]).toMatchObject({
      resolution: 'open',
      operatorAcceptance: { origins: [{ sourceId: acceptedSourceId, lapId: mixedAggregate.lapId }] },
    });
  });

  it('does not record an origin for a confidence-suppressed finding', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v3', feature,
      cases: [{
        id: 'case-suppressed', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The finding needs a focused repair.', resolution: 'open',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-22T00:00:00.000Z' }],
        effect: { id: 'effect-suppressed', kind: 'action', status: 'applied', workOrderId: 'order-suppressed' },
      }],
      prdWideningCases: [], suppressions: [], outbox: [],
    });

    await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), suppressedFindingIds: new Set([findingId]),
    });

    const settled = await store.read();
    expect(settled.ok && settled.state.cases[0]?.operatorAcceptance).toBeUndefined();
  });

  it('does not record an origin from a disposition stored for another feature', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v3', feature,
      cases: [{
        id: 'case-foreign-disposition', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The finding needs a focused repair.', resolution: 'open',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-22T00:00:00.000Z' }],
        effect: { id: 'effect-foreign-disposition', kind: 'action', status: 'applied', workOrderId: 'order-foreign-disposition' },
      }],
      prdWideningCases: [], suppressions: [], outbox: [],
    });
    const foreignDisposition = await new BuildReviewDispositionStore(root).append({
      feature: { ...feature, feature: 'another-feature' },
      finding: canonicalizeBuildReviewFindingIdentity({
        rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
        anchor: { rubric: 'testQuality', locus: { path: 'test/example.test.ts', contentHash: `sha256:${'f'.repeat(64)}`, display: 'example test' } },
      })!,
      sourceLapId: 'lap-1' as never, summary: 'Accepted only for another feature.',
      rationale: 'The other feature owns this accepted risk.', operator: 'operator',
    });
    if (!foreignDisposition.ok) throw new Error(foreignDisposition.message);

    await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()),
      resolveOperatorResolvedFindingIds: async () => {
        const effective = await resolveEffectiveBuildReviewVerdict(root, aggregate, {
          resolveMainRoot: async () => '/repo',
          realpath: async (path) => path === '/repo' ? '/repo' : '/repo/.worktrees/feature',
          child: undefined,
          adjudicationEnabled: true,
        });
        if (!effective.ok) throw new Error(effective.reason);
        return new Set(effective.effective.acceptedFindingIds);
      },
    });

    const settled = await store.read();
    expect(settled.ok && settled.state.cases[0]?.operatorAcceptance).toBeUndefined();
  });

  it('publishes only the open action as the durable BUILD repair for a shared resolved source', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-resolved-r', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The earlier repair was recorded but did not settle this source.', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { id: 'effect-resolved-r', kind: 'action', status: 'applied', workOrderId: 'order-resolved-r' },
      }],
    });

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), generateId: sequentialIds('open-n'),
    });

    expect(result).toMatchObject({ ok: true, route: 'build', durable: { repairCaseIds: ['open-n-1'] } });
  });

  async function expectRefusedDecisionStopTransition(blockedConsistency: boolean) {
    const root = await projectRoot();
    const mixed = customMixedAggregate();
    const currentSource = projectBuildReviewAggregateSources(mixed)!.find((source) => source.rubric === 'security')!;
    const currentSourceId = buildReviewAdjudicationSourceId(currentSource);
    await seedCases(new RemediationCaseStore(root, feature), {
      version: 'v1', feature,
      cases: [{
        id: 'case-owner', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The existing repair remains open.', resolution: 'open',
        sources: [{ sourceId: currentSourceId, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
        effect: { id: 'effect-owner', kind: 'action', status: 'applied', workOrderId: 'order-owner' },
      }],
    });
    const events: ConductorEvent[] = [];
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [{ sourceId: currentSourceId, outcome: 'escalate', caseRef: 'case-stop' }],
      cases: [{
        caseRef: 'case-stop', disposition: 'escalate', priority: 'high', confidence: 'high',
        rationale: 'The owner must decide.', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
      }],
      consistency: blockedConsistency
        ? { verdict: 'blocked', sourceIds: [currentSourceId], caseRefs: ['case-stop'], rationale: 'The proposals conflict.' }
        : { verdict: 'consistent', sourceIds: [currentSourceId], caseRefs: ['case-stop'], rationale: 'The owner stop is the only outcome.' },
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), aggregate: mixed, mechanical: 'retry',
      generateId: () => 'case-stop',
      readPlanContract: async () => ({ path: '.docs/plans/example.md', pointers: [], admittedTaskContracts: [] }),
      readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [] }),
      emit: async (event) => { events.push(event); },
    });
    const failed = events.find((event) => event.type === 'remediation_adjudication_failed');

    expect(result).toMatchObject({
      ok: false,
      detail: expect.stringContaining('case transition rejected: source-linked-by-multiple-cases'),
    });
    expect(result.detail).toContain('persisted case history is valid and unchanged');
    expect(failed).toMatchObject({
      type: 'remediation_adjudication_failed',
      rejectedTransition: { invariant: 'source-linked-by-multiple-cases', caseIds: expect.arrayContaining(['case-owner', 'case-stop']), sourceIds: [currentSourceId] },
    });
  }

  // Covers: task:7
  it('coordinateBuildReviewAdjudication emits a refused explicit-escalation transition with the owner, proposed stop, and source', async () => {
    await expectRefusedDecisionStopTransition(false);
  });

  // Covers: task:7
  it('coordinateBuildReviewAdjudication emits a refused blocked-consistency transition with the owner, stop, and source', async () => {
    await expectRefusedDecisionStopTransition(true);
  });

  it('persists a bound resolved action escalation with different sources as a fresh open decision stop', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const scope = decisionStopScope();
    const differentSourceId = scope.sourceId;
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-R', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The earlier repair was applied.', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { id: 'effect-R', kind: 'action', status: 'applied', workOrderId: 'order-R' },
      }],
    });
    const before = JSON.parse(await readFile(remediationCaseStorePath(root), 'utf8')).cases[0];
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => ({
        mode: 'case-v2', domain: 'build_review',
        sourceOutcomes: [{ sourceId: differentSourceId, outcome: 'escalate', caseRef: 'stop' }],
        cases: [{
          caseRef: 'stop', existingCaseId: 'case-R', disposition: 'escalate', priority: 'high', confidence: 'high',
          rationale: 'Architecture must decide the distinct source.', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        }], consistency: { verdict: 'blocked', sourceIds: [differentSourceId], caseRefs: ['stop'], rationale: 'Architecture must decide.' },
      })),
      ...scope, generateId: () => 'unused-proposed-id',
    });
    const after = await store.read();
    if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
    const stop = after.state.cases.find((record) => record.id !== 'case-R')!;

    expect(result).toMatchObject({ ok: true, route: 'halt', durable: { decisionStops: [{ caseId: stop.id, owner: 'architecture', sourceIds: [differentSourceId] }] } });
    expect(stop).toMatchObject({ disposition: 'escalate', resolution: 'open', sources: [{ sourceId: differentSourceId }] });
    expect(stop.id).not.toBe('case-R');
    expect(JSON.parse(await readFile(remediationCaseStorePath(root), 'utf8')).cases[0]).toEqual(before);
  });

  it('converges unbound and bound same-owner decision-stop replays with fresh timestamps without rewriting the store', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const scope = decisionStopScope();
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-D', domain: 'build_review', disposition: 'escalate', priority: 'high', confidence: 'high',
        rationale: 'Architecture must decide.', resolution: 'open',
        sources: [{ sourceId: scope.sourceId, outcome: 'escalate', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        consistencyStop: { sourceIds: [scope.sourceId], rationale: 'Architecture must decide.' },
      }],
    });
    const before = await readFile(remediationCaseStorePath(root), 'utf8');
    const judgement = (existingCaseId?: string): RemediationCaseJudgement => ({
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [{ sourceId: scope.sourceId, outcome: 'escalate', caseRef: 'stop' }],
      cases: [{
        caseRef: 'stop', ...(existingCaseId === undefined ? {} : { existingCaseId }), disposition: 'escalate', priority: 'high', confidence: 'high',
        rationale: 'Architecture must decide.', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
      }], consistency: { verdict: 'blocked', sourceIds: [scope.sourceId], caseRefs: ['stop'], rationale: 'Architecture must decide.' },
    });

    const unbound = await coordinateBuildReviewAdjudication({ ...input(root, async () => judgement()), ...scope, generateId: () => 'case-new' });
    const bound = await coordinateBuildReviewAdjudication({ ...input(root, async () => judgement('case-D')), ...scope, generateId: () => 'case-newer' });

    expect(unbound).toMatchObject({ ok: true, route: 'halt', durable: { decisionStops: [{ caseId: 'case-D' }] } });
    expect(bound).toMatchObject({ ok: true, route: 'halt', durable: { decisionStops: [{ caseId: 'case-D' }] } });
    await expect(readFile(remediationCaseStorePath(root), 'utf8')).resolves.toBe(before);
  });

  it('rejects an unbound different-owner decision stop over an open owner with named invariant and unchanged store', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const scope = decisionStopScope();
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-D', domain: 'build_review', disposition: 'escalate', priority: 'high', confidence: 'high', rationale: 'Architecture must decide.', resolution: 'open',
        sources: [{ sourceId: scope.sourceId, outcome: 'escalate', recordedAt: '2026-10-18T00:00:00.000Z' }], effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        consistencyStop: { sourceIds: [scope.sourceId], rationale: 'Plan must decide.' },
      }],
    });
    const before = await readFile(remediationCaseStorePath(root), 'utf8');
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => ({
        mode: 'case-v2', domain: 'build_review', sourceOutcomes: [{ sourceId: scope.sourceId, outcome: 'escalate', caseRef: 'stop' }],
        cases: [{ caseRef: 'stop', disposition: 'escalate', priority: 'high', confidence: 'high', rationale: 'Plan must decide.', effect: { kind: 'none' }, escalation: { owner: 'plan' } }],
        consistency: { verdict: 'blocked', sourceIds: [scope.sourceId], caseRefs: ['stop'], rationale: 'Plan must decide.' },
      })), ...scope, generateId: () => 'case-new',
    });

    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('case transition rejected: source-linked-by-multiple-cases') });
    expect(result.detail).toContain('case-D');
    expect(result.detail).toContain('case-new');
    expect(result.detail).toContain(scope.sourceId);
    await expect(readFile(remediationCaseStorePath(root), 'utf8')).resolves.toBe(before);
  });

  it.each(['lock-timeout', 'malformed-state'] as const)('reports a decision-stop %s without trusted-history recovery guidance', async (reason) => {
    const root = await projectRoot();
    const scope = decisionStopScope();
    const events: ConductorEvent[] = [];
    const mutation = failOnlyDecisionStopMutation(reason);
    try {
      const result = await coordinateBuildReviewAdjudication({
        ...input(root, async () => ({
          mode: 'case-v2', domain: 'build_review', sourceOutcomes: [{ sourceId: scope.sourceId, outcome: 'escalate', caseRef: 'stop' }],
          cases: [{ caseRef: 'stop', disposition: 'escalate', priority: 'high', confidence: 'high', rationale: 'An owner must decide.', effect: { kind: 'none' }, escalation: { owner: 'architecture' } }],
          consistency: { verdict: 'consistent', sourceIds: [scope.sourceId], caseRefs: ['stop'], rationale: 'One owner decision is needed.' },
        })), ...scope, generateId: () => 'case-stop', emit: async (event) => { events.push(event); },
      });

      expect(result).toEqual({ ok: false, detail: `decision stop case store ${reason}` });
      expect(events).toContainEqual(expect.objectContaining({
        type: 'remediation_adjudication_failed', reason: `decision stop case store ${reason}`,
      }));
      expect(events.find((event) => event.type === 'remediation_adjudication_failed')).not.toHaveProperty('rejectedTransition');
      expect(result.detail).not.toContain('persisted case history is valid');
    } finally {
      mutation.mockRestore();
    }
  });

  it('reports a conflicting bound decision stop without trusted-history recovery guidance', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const scope = decisionStopScope();
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-D', domain: 'build_review', disposition: 'escalate', priority: 'high', confidence: 'high', rationale: 'Architecture must decide.', resolution: 'open',
        sources: [{ sourceId: scope.sourceId, outcome: 'escalate', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { kind: 'none' }, escalation: { owner: 'architecture' },
      }],
    });
    const events: ConductorEvent[] = [];
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => ({
        mode: 'case-v2', domain: 'build_review', sourceOutcomes: [{ sourceId: scope.sourceId, outcome: 'escalate', caseRef: 'stop' }],
        cases: [{ caseRef: 'stop', existingCaseId: 'case-D', disposition: 'escalate', priority: 'high', confidence: 'high', rationale: 'Plan must decide.', effect: { kind: 'none' }, escalation: { owner: 'plan' } }],
        consistency: { verdict: 'consistent', sourceIds: [scope.sourceId], caseRefs: ['stop'], rationale: 'One owner decision is needed.' },
      })), ...scope, emit: async (event) => { events.push(event); },
    });

    expect(result).toEqual({ ok: false, detail: 'decision stop conflicting-case-id' });
    expect(events.find((event) => event.type === 'remediation_adjudication_failed')).not.toHaveProperty('rejectedTransition');
    expect(result.detail).not.toContain('persisted case history is valid');
  });

  it('rejects an unbound decision stop over an open action owner with named invariant and unchanged store', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const scope = decisionStopScope();
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-O', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'BUILD owns the repair.', resolution: 'open',
        sources: [{ sourceId: scope.sourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { id: 'effect-O', kind: 'action', status: 'applied', workOrderId: 'order-O' },
      }],
    });
    const before = await readFile(remediationCaseStorePath(root), 'utf8');
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => ({
        mode: 'case-v2', domain: 'build_review', sourceOutcomes: [{ sourceId: scope.sourceId, outcome: 'escalate', caseRef: 'stop' }],
        cases: [{ caseRef: 'stop', disposition: 'escalate', priority: 'high', confidence: 'high', rationale: 'Architecture must decide.', effect: { kind: 'none' }, escalation: { owner: 'architecture' } }],
        consistency: { verdict: 'blocked', sourceIds: [scope.sourceId], caseRefs: ['stop'], rationale: 'Architecture must decide.' },
      })), ...scope, generateId: () => 'case-new',
    });

    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('case transition rejected: source-linked-by-multiple-cases') });
    expect(result.detail).toContain('case-O');
    expect(result.detail).toContain('case-new');
    expect(result.detail).toContain(scope.sourceId);
    await expect(readFile(remediationCaseStorePath(root), 'utf8')).resolves.toBe(before);
  });

  it('emits the rejected case transition detail from reconciliation', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-O', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The earlier repair was applied.', resolution: 'open',
        sources: [
          { sourceId, outcome: 'acted', recordedAt: '2026-10-10T12:00:00.000Z' },
          { sourceId: 'testQuality:prior-finding', outcome: 'acted', recordedAt: '2026-10-10T12:00:00.000Z' },
        ],
        effect: { id: 'effect-O', kind: 'action', status: 'applied', workOrderId: 'work-order-O' },
      }],
    });
    const before = await readFile(remediationCaseStorePath(root), 'utf8');
    const events: ConductorEvent[] = [];
    const detail = `case transition rejected: source-linked-by-multiple-cases (cases case-O, case-N; sources ${sourceId})\n` +
      'persisted case history is valid and unchanged\n' +
      'Inspect with ai-conductor build-review findings --feature feature, then clear with ' +
      'ai-conductor halt clear --feature feature --rationale "<why>" once the proposed transition is admissible ' +
      '(an engine admits it or a judgement no longer proposes it).';

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()),
      generateId: (() => {
        const ids = ['case-N', 'effect-N'];
        return () => ids.shift()!;
      })(),
      emit: async (event) => { events.push(event); },
    });

    expect([result, events.filter((event) => event.type === 'remediation_adjudication_failed')]).toEqual([{
      ok: false,
      detail,
    }, [{
      type: 'remediation_adjudication_failed',
      domain: 'build_review',
      lapId: 'lap-1',
      reason: detail,
      rejectedTransition: {
        invariant: 'source-linked-by-multiple-cases',
        caseIds: ['case-O', 'case-N'],
        sourceIds: [sourceId],
      },
    }]]);
    await expect(readFile(remediationCaseStorePath(root), 'utf8')).resolves.toBe(before);
  });

  it('reports corrupt flat suppression history through the suppression-store event', async () => {
    const root = await projectRoot();
    const corruptCases = [{
      id: 'case-O', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
      rationale: 'The earlier repair was applied.', resolution: 'open',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-10T12:00:00.000Z' }],
      effect: { id: 'effect-O', kind: 'action', status: 'applied', workOrderId: 'work-order-O' },
    }, {
      id: 'case-N', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
      rationale: 'The conflicting persisted case is corrupt history.', resolution: 'open',
      sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-10T12:00:00.000Z' }],
      effect: { id: 'effect-N', kind: 'action', status: 'reserved' },
    }];
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(remediationCaseStorePath(root), JSON.stringify({ version: 'v1', feature, cases: corruptCases }), 'utf8');
    const events: ConductorEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()),
      emit: async (event) => { events.push(event); },
    });

    expect([result, events.filter((event) => event.type === 'remediation_adjudication_failed')]).toEqual([{
      ok: false,
      detail: 'suppression store malformed-state',
    }, [{
      type: 'remediation_adjudication_failed', domain: 'build_review', lapId: 'lap-1', reason: 'suppression store malformed-state',
    }]]);
  });

  it('keeps child cases local while writing suppression history to the flat store', async () => {
    const root = await projectRoot();
    const child = parseChildId(2)!;
    const suppression = {
      findingId: findingId,
      rubric: 'testQuality',
      summary: 'The changed test is insensitive.',
      confidence: 40,
      floor: 70,
      lastSeenLap: 'lap-1',
    };

    await expect(coordinateBuildReviewAdjudication({
      ...input(root, async () => securityActionJudgement()),
      aggregate: securityAggregate,
      child,
      suppressions: [suppression],
    })).resolves.toMatchObject({ ok: true, route: 'build' });

    await expect(new RemediationCaseStore(root, feature).read()).resolves.toMatchObject({
      ok: true,
      state: { cases: [], suppressions: [suppression] },
    });
    await expect(new RemediationCaseStore(root, feature, { child }).read()).resolves.toMatchObject({
      ok: true,
      state: { cases: [expect.any(Object)], suppressions: [] },
    });
  });

  it('routes a security act through BUILD with a bounded work order and leaves the plan unchanged', async () => {
    const root = await projectRoot();
    await mkdir(join(root, '.docs', 'plans'), { recursive: true });
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const plan = '### Task 1: unrelated UI work\n';
    await writeFile(planPath, plan);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => securityActionJudgement()), aggregate: securityAggregate,
      readPlanContract: async () => ({ path: '.docs/plans/feature.md', pointers: ['Task 1: unrelated UI work'] }),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    expect(JSON.parse(await readFile(join(root, '.pipeline/build-review-work-order.json'), 'utf8'))).toMatchObject({
      cases: [{ priority: 'critical', tasks: [{ title: 'Parameterize the search query' }] }],
    });
    await expect(readFile(planPath, 'utf8')).resolves.toBe(plan);
  });

  it('files a deferred security source with its justification rather than silently passing it', async () => {
    const root = await projectRoot();
    const fileIssue = vi.fn(async () => ({ issueUrl: 'https://example.test/issues/security' }));

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => securityDeferralJudgement()), aggregate: securityAggregate,
      tracker: { findIssueByEffectMarker: async () => undefined } as unknown as EffectMarkerTrackerClient,
      repo: 'acme/conductor', fileIssue,
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(fileIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Harden the search query', body: expect.stringContaining('separately scheduled hardening change'),
    }));
    await expect(new RemediationCaseStore(root, feature).read()).resolves.toMatchObject({
      ok: true, state: { cases: [expect.objectContaining({ disposition: 'defer', effect: expect.objectContaining({ status: 'applied' }) })] },
    });
  });

  it('settles a refuted security source without another kickback charge', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'security-case', domain: 'build_review', disposition: 'act', priority: 'critical', confidence: 'high',
        rationale: 'The query must be parameterized.', resolution: 'open',
        sources: [{ sourceId: securitySourceId, outcome: 'acted', recordedAt: '2026-09-15T00:00:00.000Z' }],
        effect: { id: 'security-effect', kind: 'action', status: 'applied', workOrderId: 'security-order' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'security-effect',
      cases: [{ caseId: 'security-case', priority: 'critical', tasks: [{ title: 'Parameterize the search query' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'test', 'security-refutation.test.ts'), 'the query uses parameters\n');
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    const refuted: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId: securitySourceId, outcome: 'refuted', caseRef: 'security-refutation' }],
      cases: [{
        caseRef: 'security-refutation', existingCaseId: 'security-case', disposition: 'refute', priority: 'critical', confidence: 'high',
        rationale: 'The reported query is already parameterized.', effect: { kind: 'none' },
        refutation: { claim: 'Untrusted input is interpolated into a query.', assertions: [{
          assertion: 'The query uses parameters.', verdict: 'refuted',
          evidence: [{ path: 'test/security-refutation.test.ts', excerpt: 'query uses parameters' }],
        }] },
      }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => refuted), aggregate: securityAggregate, chargeEffect: charge,
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(charge).not.toHaveBeenCalled();
    await expect(store.read()).resolves.toMatchObject({
      ok: true, state: { cases: [expect.objectContaining({
        id: 'security-case', disposition: 'refute', resolution: 'resolved', effect: { kind: 'none' },
      })] },
    });
  });

  it('adjudicates one eligible custom source in a mixed lap while retaining its sibling coverage blocker', async () => {
    const root = await projectRoot();
    const mixed = customMixedAggregate();
    const customSource = projectBuildReviewAggregateSources(mixed)!.find((source) => source.rubric === 'security')!;
    const sourceId = buildReviewAdjudicationSourceId(customSource);
    const judge = vi.fn(async (context: unknown): Promise<RemediationCaseJudgement> => {
      expect(context).toMatchObject({
        mode: 'case-v2',
        currentFindings: [expect.objectContaining({ sourceId, rubric: 'security' })],
      });
      return {
        mode: 'case-v2', domain: 'build_review',
        sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'case-security' }],
        cases: [{
          caseRef: 'case-security', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The admitted task owns the authorization repair.',
          effect: {
            kind: 'action', route: 'build', tasks: [{
              title: 'Repair the authorization boundary.', admittedTaskIds: ['34'],
              admissionRationale: 'Task 34 owns the mixed-lap coordinator integration.',
            }],
          },
        }],
        consistency: {
          verdict: 'consistent', sourceIds: [sourceId], caseRefs: ['case-security'],
          rationale: 'One admitted repair covers the sole eligible source.',
        },
      };
    });
    const charge = vi.fn(chargeBuildReviewEffectInLedger);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), aggregate: mixed, mechanical: 'retry', chargeEffect: charge,
      generateId: sequentialIds('custom-mixed'),
      readPlanContract: async () => ({
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: [{ id: '34', contract: 'Mixed-lap coordinator integration.' }],
      }),
      readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '34', status: 'in_progress' }] }),
    });

    expect(result).toMatchObject({ ok: true, route: 'build', remainingMechanical: true });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(mixed.customResults?.availability).toMatchObject({
      result: { kind: 'infrastructure-failure', reason: 'policy-load-failed' },
    });
  });

  it('hands a decision stop persisted before a restart to the judge once the approved baseline changes', async () => {
    const root = await projectRoot();
    const customSourceId = (mixed: ReturnType<typeof customMixedAggregate>) =>
      buildReviewAdjudicationSourceId(projectBuildReviewAggregateSources(mixed)!.find((source) => source.rubric === 'security')!);
    const scope = {
      mechanical: 'retry' as const,
      readPlanContract: async () => ({
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: [{ id: '34', contract: 'Mixed-lap coordinator integration.' }],
      }),
      readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '34', status: 'in_progress' }] }),
    };
    const escalate = (sourceId: string, existingCaseId?: string): RemediationCaseJudgement => ({
      mode: 'case-v2', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'escalate', caseRef: 'architecture-stop' }],
      cases: [{
        caseRef: 'architecture-stop', ...(existingCaseId === undefined ? {} : { existingCaseId }),
        disposition: 'escalate', priority: 'high', confidence: 'high',
        rationale: 'No admitted task owns this boundary; architecture must decide.',
        effect: { kind: 'none' }, escalation: { owner: 'architecture' },
      }],
      consistency: {
        verdict: 'blocked', sourceIds: [sourceId], caseRefs: ['architecture-stop'],
        rationale: 'The repair contradicts the approved baseline.',
      },
    });

    const lapOne = customMixedAggregate();
    const lapOneSourceId = customSourceId(lapOne);
    const stopped = await coordinateBuildReviewAdjudication({
      ...input(root, vi.fn(async () => escalate(lapOneSourceId))), ...scope, aggregate: lapOne,
      generateId: sequentialIds('stop'),
    });
    expect(stopped).toMatchObject({ route: 'halt' });
    const persisted = await new RemediationCaseStore(root, feature).read();
    if (!persisted.ok) throw new Error(persisted.reason);
    const stop = persisted.state.cases[0]!;
    expect(stop).toMatchObject({
      disposition: 'escalate', resolution: 'open', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
      consistencyStop: { sourceIds: [lapOneSourceId], rationale: 'The repair contradicts the approved baseline.' },
    });

    // Restart: nothing survives but the store file. The approved-baseline
    // change re-anchors the finding, so the lap raises a new exact source.
    const lapTwo = customMixedAggregate(undefined, `sha256:${'b'.repeat(64)}`);
    const lapTwoSourceId = customSourceId(lapTwo);
    expect(lapTwoSourceId).not.toBe(lapOneSourceId);
    const seen: unknown[] = [];
    const rejudge = vi.fn(async (context: unknown) => {
      seen.push(context);
      return escalate(lapTwoSourceId, stop.id);
    });
    const reevaluated = await coordinateBuildReviewAdjudication({
      ...input(root, rejudge), ...scope, aggregate: lapTwo, generateId: sequentialIds('restart'),
    });

    expect(rejudge).toHaveBeenCalledTimes(1);
    expect(seen[0]).toMatchObject({
      currentFindings: [expect.objectContaining({ sourceId: lapTwoSourceId })],
      priorCases: [{
        id: stop.id, disposition: 'escalate', effect: { kind: 'none' }, escalation: { owner: 'architecture' },
        sources: [{ sourceId: lapOneSourceId, outcome: 'escalate' }],
        consistencyStop: { sourceIds: [lapOneSourceId], rationale: 'The repair contradicts the approved baseline.' },
      }],
    });
    expect(JSON.stringify(reevaluated)).not.toContain('unrepresentable-prior-case');
  });

  it('refuses a case-v1 answer to a custom lap that required the case-v2 consistency and admission evidence', async () => {
    const root = await projectRoot();
    const mixed = customMixedAggregate();
    const customSource = projectBuildReviewAggregateSources(mixed)!.find((source) => source.rubric === 'security')!;
    const sourceId = buildReviewAdjudicationSourceId(customSource);
    const judge = vi.fn(async (): Promise<RemediationCaseJudgement> => ({
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'case-security' }],
      cases: [{
        caseRef: 'case-security', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'A downgraded answer carries no admission evidence.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the authorization boundary.' }] },
      }],
    } as never));
    const charge = vi.fn(chargeBuildReviewEffectInLedger);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), aggregate: mixed, mechanical: 'retry', chargeEffect: charge,
      generateId: sequentialIds('custom-downgrade'),
      readPlanContract: async () => ({
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: [{ id: '34', contract: 'Mixed-lap coordinator integration.' }],
      }),
      readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '34', status: 'in_progress' }] }),
    });

    expect(judge).toHaveBeenCalledTimes(1);
    expect(charge).not.toHaveBeenCalled();
    expect(result).not.toMatchObject({ route: 'build' });
    expect(JSON.stringify(result)).toContain('mode mismatch');
  });

  it('does not judge or charge infrastructure-only, exact-settled, or confidence-suppressed custom laps', async () => {
    const root = await projectRoot();
    const mixed = customMixedAggregate();
    const customSource = projectBuildReviewAggregateSources(mixed)!.find((source) => source.rubric === 'security')!;
    const judge = vi.fn(async (): Promise<RemediationCaseJudgement> => {
      throw new Error('no live custom source may reach the judge');
    });
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    const infrastructureOnly = joinBuildReviewRubricOutcomes({
      ...mixed,
      customResults: { availability: mixed.customResults!.availability! },
      currentCustomRubrics: ['availability'],
    } as never);

    const infrastructure = await coordinateBuildReviewAdjudication({
      ...input(root, judge), aggregate: infrastructureOnly, mechanical: 'retry', chargeEffect: charge,
      generateId: sequentialIds('infrastructure-only'),
    });
    const settled = await coordinateBuildReviewAdjudication({
      ...input(root, judge), aggregate: mixed, mechanical: 'retry', chargeEffect: charge,
      operatorResolvedFindingIds: new Set([customSource.findingId]), generateId: sequentialIds('exact-settled'),
    });
    const suppressed = await coordinateBuildReviewAdjudication({
      ...input(root, judge), aggregate: mixed, mechanical: 'retry', chargeEffect: charge,
      suppressedFindingIds: new Set([customSource.findingId]), generateId: sequentialIds('confidence-suppressed'),
    });

    expect(infrastructure).toMatchObject({ ok: true, route: 'mechanical-retry' });
    expect(settled).toMatchObject({ ok: true, route: 'mechanical-retry' });
    expect(suppressed).toMatchObject({ ok: true, route: 'mechanical-retry' });
    expect(judge).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

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

  it.each([
    ['operatorAcceptance', (judgement: RemediationCaseJudgement) => ({
      ...judgement,
      cases: [{ ...judgement.cases[0]!, operatorAcceptance: { origins: [{ sourceId, lapId: 'lap-1' }] } }],
    }), 'operator-owned-acceptance'],
    ['operatorResolution', (judgement: RemediationCaseJudgement) => ({
      ...judgement,
      cases: [{ ...judgement.cases[0]!, operatorResolution: { operator: 'operator', rationale: 'Accepted risk.', resolvedAt: '2026-10-21T00:00:00.000Z' } }],
    }), 'operator-owned-resolution'],
    ['carried source outcome', (judgement: RemediationCaseJudgement) => ({
      ...judgement,
      sourceOutcomes: [{ ...judgement.sourceOutcomes[0]!, outcome: 'carried' }],
    }), 'operator-owned-carried-source-outcome'],
  ] as const)('fails closed without mutating case state for provider-owned %s', async (_name, inject, rejection) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'unrelated-resolved-case', domain: 'build_review', disposition: 'reject', priority: 'low', confidence: 'low',
        rationale: 'An unrelated prior finding was rejected.', resolution: 'resolved',
        sources: [{ sourceId: 'testQuality:unrelated', outcome: 'rejected', recordedAt: '2026-10-20T00:00:00.000Z' }],
        effect: { kind: 'none' },
      }],
    });
    const before = await readFile(remediationCaseStorePath(root), 'utf8');
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => inject(actionJudgement()) as RemediationCaseJudgement),
    });

    expect(result).toEqual({ ok: false, detail: `invalid remediation judgement ${rejection}` });
    await expect(readFile(remediationCaseStorePath(root), 'utf8')).resolves.toBe(before);
  });

  it('bypasses the provider but still settles case state when every current source is operator-resolved', async () => {
    const root = await projectRoot();
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), operatorResolvedFindingIds: new Set([findingId]),
    });

    expect(result).toMatchObject({ ok: true, route: 'pass', dispatchSkipped: false });
    expect(judge).not.toHaveBeenCalled();
  });

  it('preserves applied effect ids when an acceptance-terminal path bypasses the provider', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-durable', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The repair was applied before operator acceptance.', resolution: 'open',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-09-06T00:00:00.000Z' }],
        effect: { id: 'effect-durable', kind: 'action', status: 'applied', workOrderId: 'order-durable' },
      }],
    });
    const events: RemediationCaseLifecycleEvent[] = [];

    await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()),
      operatorResolvedFindingIds: new Set([findingId]),
      emit: async (event) => { events.push(event); },
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'remediation_adjudication_completed', effectIds: ['effect-durable'],
    }));
  });

  it('refreshes one suppression through coordinator merge without pruning prior history or writing operator authority', async () => {
    const root = await projectRoot();
    const priorFindingId = 'finding-from-an-earlier-lap';
    const firstLap = {
      kind: 'confidence',
      findingId,
      rubric: 'testQuality',
      summary: 'Initial low-confidence finding.',
      confidence: 40,
      floor: 70,
      lastSeenLap: 'lap-suppression-first',
    } as const;
    const refreshed = {
      kind: 'confidence',
      findingId,
      rubric: 'testQuality',
      summary: 'Refreshed low-confidence finding.',
      confidence: 55,
      floor: 70,
      lastSeenLap: 'lap-suppression-second',
    } as const;
    const retained = {
      kind: 'confidence',
      findingId: priorFindingId,
      rubric: 'testQuality',
      summary: 'A prior suppression absent from this lap.',
      confidence: 35,
      floor: 70,
      lastSeenLap: 'lap-earlier',
    } as const;

    await expect(coordinateBuildReviewAdjudication({
      ...input(root, async () => { throw new Error('suppressed finding must not reach the judge'); }),
      suppressions: [firstLap, retained],
      suppressedFindingIds: new Set([findingId]),
    })).resolves.toMatchObject({ ok: true, route: 'pass' });

    const secondLapAggregate = joinBuildReviewRubricOutcomes({
      lapId: 'lap-suppression-second' as never,
      snapshotDigest: 'snapshot-suppression-second',
      results: {
        security: { kind: 'skipped', rubric: 'security', reason: 'disabled' },
        testQuality: {
          kind: 'judged', rubric: 'testQuality', lapId: 'lap-suppression-second' as never, snapshotDigest: 'snapshot-suppression-second', contractVersion: 'v3', verdict: 'FAIL',
          findings: [
            {
              concernKind: 'test-insensitive', summary: 'The changed test is insensitive.', severity: 'minor', evidenceLocations: ['test/example.test.ts:1'],
              anchor: { rubric: 'testQuality', locus: { path: 'test/example.test.ts', contentHash: 'sha256:fixture', display: 'example test' } },
            },
            {
              concernKind: 'test-insensitive', summary: 'An unrelated changed test is insensitive.', severity: 'minor', evidenceLocations: ['test/unrelated.test.ts:1'],
              anchor: { rubric: 'testQuality', locus: { path: 'test/unrelated.test.ts', contentHash: 'sha256:unrelated', display: 'unrelated test' } },
            },
          ],
        },
      },
    });
    const unrelatedSource = projectBuildReviewAggregateSources(secondLapAggregate)![1]!;
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => ({
        mode: 'case-v1', domain: 'build_review',
        sourceOutcomes: [{ sourceId: buildReviewAdjudicationSourceId(unrelatedSource), outcome: 'acted', caseRef: 'case-unrelated' }],
        cases: [{
          caseRef: 'case-unrelated', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'The unrelated test needs an assertion.',
          effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the unrelated test' }] },
        }],
      })),
      aggregate: secondLapAggregate,
      suppressions: [refreshed],
      suppressedFindingIds: new Set([findingId]),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    const persisted = await new RemediationCaseStore(root, feature).read();
    expect(persisted).toMatchObject({
      ok: true,
      state: { suppressions: expect.arrayContaining([refreshed, retained]) },
    });
    if (!persisted.ok) throw new Error(`unexpected case-store failure: ${persisted.reason}`);
    expect(persisted.state.suppressions?.filter((entry) => entry.findingId === findingId)).toEqual([refreshed]);
    await expect(access(join(root, '.pipeline/build-review-dispositions.json'))).rejects.toThrow();
  });

  it('leaves exactly one row when the coordinator re-runs the seam over a lap the effective-verdict path already persisted', async () => {
    const root = await projectRoot();
    const entry = {
      kind: 'confidence',
      findingId,
      rubric: 'testQuality',
      summary: 'A sub-floor finding on a mixed lap.',
      confidence: 45,
      floor: 70,
      lastSeenLap: 'lap-1',
    } as const;

    // The effective-verdict seam writes first, on every lap.
    await expect(persistBuildReviewSuppressions({ projectRoot: root, feature, suppressions: [entry] }))
      .resolves.toEqual({ ok: true });

    await expect(coordinateBuildReviewAdjudication({
      ...input(root, async () => { throw new Error('suppressed finding must not reach the judge'); }),
      suppressions: [entry],
      suppressedFindingIds: new Set([findingId]),
    })).resolves.toMatchObject({ ok: true, route: 'pass' });

    const persisted = await new RemediationCaseStore(root, feature).read();
    if (!persisted.ok) throw new Error(`unexpected case-store failure: ${persisted.reason}`);
    expect(persisted.state.suppressions).toEqual([entry]);
  });

  it('gives child 2 the flat suppression history and only its own prior cases', async () => {
    const root = await projectRoot();
    const child = parseChildId(2)!;
    const earlierLap = {
      kind: 'confidence',
      findingId: 'finding-suppressed-on-an-earlier-lap',
      rubric: 'testQuality',
      summary: 'A finding suppressed on a fully suppressed lap.',
      confidence: 30,
      floor: 70,
      lastSeenLap: 'lap-0',
    } as const;

    await expect(persistBuildReviewSuppressions({ projectRoot: root, feature, suppressions: [earlierLap] }))
      .resolves.toEqual({ ok: true });

    const resolvedRefutedCase = (id: string, priorSourceId: string): RemediationCaseStoreState['cases'][number] => ({
      id, domain: 'build_review', disposition: 'refute', priority: 'high', confidence: 'high',
      rationale: 'Child 2 resolved an earlier finding.', resolution: 'resolved',
      sources: [{ sourceId: priorSourceId, outcome: 'refuted', recordedAt: '2026-10-10T00:00:00.000Z' }],
      effect: { kind: 'none' },
      refutation: {
        claim: 'The earlier finding does not apply.',
        assertions: [{ assertion: 'Child 2 has the required behavior.', verdict: 'refuted', evidence: [{ path: 'test/child-2.test.ts', excerpt: 'fixture' }] }],
      },
    });
    await seedCases(new RemediationCaseStore(root, feature), {
      version: 'v1', feature, suppressions: [earlierLap],
      cases: [resolvedRefutedCase('case-flat', 'testQuality:sha256:flat-earlier')],
    });
    await seedCases(new RemediationCaseStore(root, feature, { child }), {
      version: 'v1', feature, suppressions: [],
      cases: [resolvedRefutedCase('case-child-2', 'testQuality:sha256:child-2-earlier')],
    });

    const judge = vi.fn(async (context: unknown) => {
      expect(context).toMatchObject({
        currentFindings: [expect.objectContaining({ findingId })],
      });
      const received = context as { readonly suppressionHistory: unknown; readonly priorCases: readonly { readonly id: string }[] };
      expect(received.suppressionHistory).toEqual([earlierLap]);
      expect(received.priorCases.map(({ id }) => id)).toEqual(['case-child-2']);
      return actionJudgement();
    });

    await expect(coordinateBuildReviewAdjudication({ ...input(root, judge), child })).resolves.toMatchObject({ ok: true, route: 'build' });
    expect(judge).toHaveBeenCalledTimes(1);
    await expect(new RemediationCaseStore(root, feature, { child }).read()).resolves.toMatchObject({
      ok: true, state: { suppressions: [] },
    });
  });

  it.each([
    ['at entry', 0],
    ['before dispatch', 1],
    ['after the judgement', 2],
  ] as const)('routes leftover work rather than passing when authority arrives %s', async (_when, reads) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    // An earlier lap reserved this effect and published its order, then was
    // interrupted before recording it applied. Every exit below used to answer
    // `pass` from `cases: []` — deciding without looking. (A reservation whose
    // order was never published is settled at lap start instead; see the
    // stranded-reservation tests.)
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-stranded', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'An earlier lap reserved this and was interrupted.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256-earlier', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-stranded', kind: 'action', status: 'reserved' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-stranded',
      cases: [{ caseId: 'case-stranded', priority: 'high', tasks: [{ title: 'The interrupted repair' }] }],
    });
    const unresolved = Array.from({ length: reads }, () => new Set<string>());
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge),
      resolveOperatorResolvedFindingIds: async () => unresolved.shift() ?? new Set([findingId]),
    });

    // A mechanically healthy lap proves the old source absent, so the shared
    // retirement predicate settles the reserved action instead of retaining a
    // stale blocker.
    expect(result).toMatchObject({ ok: true, route: 'pass' });
    await expect(store.read()).resolves.toMatchObject({
      ok: true, state: { cases: [{ id: 'case-stranded', resolution: 'resolved', effect: {
        status: 'failed', diagnostic: 'retired: every source operator-accepted or no longer raised',
      } }] },
    });
  });

  it.each([
    ['one byte over the reference bound', 257, false],
    ['exactly at the reference bound', 256, true],
  ])('dispatches custom policy criteria only when complete: %s', async (_label, bytes, dispatched) => {
    const root = await projectRoot();
    const criterion = 'c'.repeat(bytes);
    const events: string[] = [];
    const seen: unknown[] = [];
    const judge = vi.fn(async (context: unknown): Promise<RemediationCaseJudgement> => {
      seen.push(context);
      throw new Error('sentinel: stop after the dispatch observation');
    });

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), aggregate: customMixedAggregate([criterion]), mechanical: 'retry',
      emit: async (event) => { events.push(event.type); },
      readPlanContract: async () => ({
        path: '.docs/plans/example.md', pointers: [],
        admittedTaskContracts: [{ id: '34', contract: 'Mixed-lap coordinator integration.' }],
      }),
      readTaskStatus: async () => ({ path: '.pipeline/task-status.json', tasks: [{ id: '34', status: 'in_progress' }] }),
    });

    if (dispatched) {
      expect(judge).toHaveBeenCalledTimes(1);
      expect(seen[0]).toMatchObject({ policyContext: [{ rubric: 'security', criteria: [criterion] }] });
      return;
    }
    expect(judge).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, detail: 'adjudication context field-overflow (policy-context.criteria[]: 257 > 256)' });
    expect(events).toEqual(['remediation_adjudication_failed']);
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
    const resolveOperatorResolvedFindingIds = vi.fn(async () => resolutions.shift() ?? new Set([findingId]));
    const chargeEffect = vi.fn(chargeBuildReviewEffectInLedger);
    const events: RemediationCaseLifecycleEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), resolveOperatorResolvedFindingIds, chargeEffect,
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true });
    // Three pre-action reads, the acceptance read, then the exit re-reads that
    // follow the awaited settlement, its emissions, and the completion emission.
    expect(resolveOperatorResolvedFindingIds).toHaveBeenCalledTimes(7);
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
          effect: { status: 'failed', diagnostic: 'retired: every source operator-accepted or no longer raised' },
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
        reason: 'retired: every source operator-accepted or no longer raised',
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

    expect(result).toMatchObject({ ok: true, route: 'halt' });
    expect(fileIssue).toHaveBeenCalledTimes(1);
    expect(fileIssue).toHaveBeenCalledWith(expect.objectContaining({ title: 'Track the second finding' }));
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled).toMatchObject({
      ok: true,
      state: { cases: expect.arrayContaining([
        expect.objectContaining({
          resolution: 'open',
          sources: [expect.objectContaining({ sourceId: buildReviewAdjudicationSourceId(acceptedSource) })],
          effect: expect.objectContaining({ kind: 'deferral', status: 'reserved' }),
        }),
        expect.objectContaining({
          resolution: 'open',
          sources: [expect.objectContaining({ sourceId: buildReviewAdjudicationSourceId(liveSource) })],
          effect: expect.objectContaining({ kind: 'deferral', status: 'applied' }),
        }),
      ]) },
    });
  });

  it('suppresses the second deferred issue when its acceptance lands during the first intake', async () => {
    const root = await projectRoot();
    const acceptedFindingIds = new Set<string>();
    const events: RemediationCaseLifecycleEvent[] = [];
    // The first successful intake is the awaited external work the acceptance
    // races: filing the first issue lands the operator acceptance of the
    // SECOND source, so only a per-iteration authority re-read can see it.
    const fileIssue = vi.fn(async (issue: { title: string }) => {
      acceptedFindingIds.add(liveSource.findingId);
      return { issueUrl: `https://example.test/issues/${issue.title}` };
    });

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedDeferralJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => new Set(acceptedFindingIds),
      tracker: { findIssueByEffectMarker: async () => undefined } as unknown as EffectMarkerTrackerClient,
      repo: 'acme/conductor', fileIssue, generateId: sequentialIds('mid-intake'), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true });
    expect(fileIssue).toHaveBeenCalledTimes(1);
    expect(fileIssue).toHaveBeenCalledWith(expect.objectContaining({ title: 'Track the first finding' }));
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled).toMatchObject({
      ok: true,
      state: { cases: expect.arrayContaining([
        expect.objectContaining({
          resolution: 'open',
          sources: [expect.objectContaining({ sourceId: buildReviewAdjudicationSourceId(acceptedSource) })],
          effect: expect.objectContaining({ kind: 'deferral', status: 'applied' }),
        }),
        expect.objectContaining({
          resolution: 'open',
          sources: [expect.objectContaining({ sourceId: buildReviewAdjudicationSourceId(liveSource) })],
          effect: expect.objectContaining({ kind: 'deferral', status: 'reserved' }),
        }),
      ]) },
    });
    // Acceptance suppresses the second intake, but leaves its reserved
    // deferral as durable unfinished evidence rather than silently PASSing.
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'remediation_effect_failed', effectKind: 'deferral' }));
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

  it('re-reads authority before a semantic-repeat halt and leaves an unaccepted sibling fail-closed', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [
        {
          id: 'case-accepted', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The first test needs a focused assertion.', resolution: 'open',
          sources: [{ sourceId: buildReviewAdjudicationSourceId(acceptedSource), outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
          effect: { id: 'effect-accepted', kind: 'action', status: 'applied', workOrderId: 'order-1' },
        },
        {
          id: 'case-live', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The second test needs a focused assertion.', resolution: 'open',
          sources: [{ sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
          effect: { id: 'effect-live', kind: 'action', status: 'applied', workOrderId: 'order-1' },
        },
      ],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-accepted',
      cases: [
        { caseId: 'case-accepted', priority: 'high', tasks: [{ title: 'Repair the first test' }] },
        { caseId: 'case-live', priority: 'high', tasks: [{ title: 'Repair the second test' }] },
      ],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    const events: RemediationCaseLifecycleEvent[] = [];
    const resolutions = [new Set<string>(), new Set<string>(), new Set<string>(), new Set([acceptedSource.findingId])];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => resolutions.shift() ?? new Set([acceptedSource.findingId]),
      generateId: sequentialIds('semantic-window'), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: false, detail: 'semantic remediation case repeat case-live' });
    expect(events.filter((event) => event.type === 'remediation_semantic_repeat_halt')).toEqual([
      expect.objectContaining({ type: 'remediation_semantic_repeat_halt', caseId: 'case-live' }),
    ]);
    expect(events.some((event) => event.type === 'remediation_semantic_repeat_halt' && event.caseId === 'case-accepted')).toBe(false);
    expect(events.filter((event) => event.type === 'remediation_adjudication_started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'remediation_adjudication_completed' || event.type === 'remediation_adjudication_failed')).toHaveLength(1);
  });

  it('settles acceptances that arrive over more rounds than the retired three-round cap', async () => {
    const root = await projectRoot();
    const events: ConductorEvent[] = [];
    // The operator accepts one more finding per authority read once settlement
    // has begun. Four sources need more settle rounds than the hard-coded three
    // allowed, and the bound now comes from the source list, so every
    // acceptance is settled before the route is taken.
    let settling = false;
    let accepted = 0;
    const resolveOperatorResolvedFindingIds = async (): Promise<ReadonlySet<string>> => {
      if (settling && accepted < staggeredSources.length) accepted += 1;
      return new Set(staggeredSources.slice(0, accepted).map((source) => source.findingId));
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => staggeredJudgement()), aggregate: staggeredAggregate,
      resolveOperatorResolvedFindingIds, generateId: sequentialIds('staggered'),
      emit: async (event) => {
        events.push(event as ConductorEvent);
        if (event.type === 'remediation_effect_reserved') settling = true;
      },
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(`unexpected case-store failure: ${settled.reason}`);
    expect(settled.state.cases.map((record) => record.resolution))
      .toEqual(staggeredSources.map(() => 'resolved'));
    // One settled lap: the extra rounds must not republish a second completion.
    expect(events.filter((event) => event.type === 'remediation_adjudication_completed')).toHaveLength(1);
  });

  it('re-reads authority after the failure emission is delivered and drops the obsolete halt', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [
        {
          id: 'case-accepted', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The first test needs a focused assertion.', resolution: 'open',
          sources: [{ sourceId: buildReviewAdjudicationSourceId(acceptedSource), outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
          effect: { id: 'effect-accepted', kind: 'action', status: 'applied', workOrderId: 'order-1' },
        },
        {
          id: 'case-live', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The second test needs a focused assertion.', resolution: 'open',
          sources: [{ sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
          effect: { id: 'effect-live', kind: 'action', status: 'applied', workOrderId: 'order-1' },
        },
      ],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-accepted',
      cases: [
        { caseId: 'case-accepted', priority: 'high', tasks: [{ title: 'Repair the first test' }] },
        { caseId: 'case-live', priority: 'high', tasks: [{ title: 'Repair the second test' }] },
      ],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    const events: RemediationCaseLifecycleEvent[] = [];
    // Nothing is accepted while the failure is decided; the operator's
    // acceptance lands during the awaited delivery of the failure occurrence,
    // which is the last window before the caller writes its needs-human HALT.
    let failureDelivered = false;
    const acceptedAtDelivery = new Set([acceptedSource.findingId, liveSource.findingId]);

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => failureDelivered ? acceptedAtDelivery : new Set<string>(),
      generateId: sequentialIds('post-delivery'), emit: async (event) => {
        events.push(event);
        if (event.type === 'remediation_adjudication_failed') failureDelivered = true;
      },
    });

    expect(result).toMatchObject({ ok: true });
    // The content failure did occur, so its occurrence stands on the spine —
    // only the obsolete HALT it would have caused is dropped.
    expect(events.filter((event) => event.type === 'remediation_adjudication_failed')).toHaveLength(1);
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(`unexpected case-store failure: ${settled.reason}`);
    expect(settled.state.cases.map((record) => record.resolution)).toEqual(['resolved', 'resolved']);
  });

  it('settles an action-effect failure accepted during its terminal failure delivery', async () => {
    const root = await projectRoot();
    const events: RemediationCaseLifecycleEvent[] = [];
    const charge = vi.fn(async () => ({ status: 'unreadable' as const, reason: 'ledger unavailable' }));
    let failureDelivered = false;

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()),
      resolveOperatorResolvedFindingIds: async () => failureDelivered ? new Set([findingId]) : new Set<string>(),
      chargeEffect: charge, generateId: sequentialIds('action-delivery'), emit: async (event) => {
        events.push(event);
        if (event.type === 'remediation_adjudication_failed') failureDelivered = true;
      },
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(charge).toHaveBeenCalledTimes(1);
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled).toMatchObject({
      ok: true,
      state: { cases: [expect.objectContaining({ resolution: 'resolved', effect: expect.objectContaining({ status: 'failed' }) })] },
    });
    // The order remains durable recovery evidence, but its accepted case is no
    // longer build-eligible and no kickback route can consume it.
    await expect(access(join(root, '.pipeline', 'build-review-work-order.json'))).resolves.toBeUndefined();
    expect(events.filter((event) => event.type === 'remediation_adjudication_completed' || event.type === 'remediation_adjudication_failed')).toHaveLength(1);
  });

  it('keeps a deferral-effect failure accepted during terminal failure delivery open and blocking', async () => {
    const root = await projectRoot();
    const events: RemediationCaseLifecycleEvent[] = [];
    const fileIssue = vi.fn(async () => { throw new Error('tracker unavailable'); });
    let failureDelivered = false;

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => deferralJudgement()),
      resolveOperatorResolvedFindingIds: async () => failureDelivered ? new Set([findingId]) : new Set<string>(),
      tracker: { findIssueByEffectMarker: async () => undefined } as unknown as EffectMarkerTrackerClient,
      repo: 'acme/conductor', fileIssue, generateId: sequentialIds('deferral-delivery'), emit: async (event) => {
        events.push(event);
        if (event.type === 'remediation_adjudication_failed') failureDelivered = true;
      },
    });

    expect(result).toMatchObject({ ok: true, route: 'halt' });
    expect(fileIssue).toHaveBeenCalledTimes(1);
    await expect(new RemediationCaseStore(root, feature).read()).resolves.toMatchObject({
      ok: true,
      state: { cases: [expect.objectContaining({ resolution: 'open', effect: expect.objectContaining({ status: 'failed' }) })] },
    });
    await expect(access(join(root, '.pipeline', 'build-review-work-order.json'))).rejects.toThrow();
    expect(events.filter((event) => event.type === 'remediation_adjudication_completed' || event.type === 'remediation_adjudication_failed')).toHaveLength(1);
  });

  it('settles only a semantic-repeat case accepted during failure delivery and halts for its sibling', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-accepted', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The first test needs a focused assertion.', resolution: 'open',
        sources: [{ sourceId: buildReviewAdjudicationSourceId(acceptedSource), outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-accepted', kind: 'action', status: 'applied', workOrderId: 'order-accepted' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-accepted',
      cases: [{ caseId: 'case-accepted', priority: 'high', tasks: [{ title: 'Repair the first test' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    const mixed = mixedJudgement();
    const repeated: RemediationCaseJudgement = {
      ...mixed,
      cases: [{ ...mixed.cases[0]!, existingCaseId: 'case-accepted' }, mixed.cases[1]!],
    };
    const events: RemediationCaseLifecycleEvent[] = [];
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    let failureDelivered = false;

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => repeated), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => failureDelivered ? new Set([acceptedSource.findingId]) : new Set<string>(),
      chargeEffect: charge, generateId: sequentialIds('semantic-delivery'), emit: async (event) => {
        events.push(event);
        if (event.type === 'remediation_adjudication_failed') failureDelivered = true;
      },
    });

    expect(result).toMatchObject({ ok: true, route: 'halt' });
    expect(charge).not.toHaveBeenCalled();
    const settled = await store.read();
    expect(settled).toMatchObject({
      ok: true,
      // The repeat halts before reconciliation, so the sibling is left for the
      // next lap's judgement instead of a reservation no later lap can apply.
      state: { cases: [
        expect.objectContaining({ id: 'case-accepted', resolution: 'resolved' }),
      ] },
    });
    await expect(readFile(join(root, '.pipeline', 'build-review-work-order.json'), 'utf8')).resolves.toContain('case-accepted');
    expect(events.filter((event) => event.type === 'remediation_adjudication_completed' || event.type === 'remediation_adjudication_failed')).toHaveLength(1);
  });

  it('retires an accepted action-effect failure but halts for an unaccepted sibling', async () => {
    const root = await projectRoot();
    const events: RemediationCaseLifecycleEvent[] = [];
    const resolutions = [
      new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(),
      new Set([acceptedSource.findingId]),
    ];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => resolutions.shift() ?? new Set([acceptedSource.findingId]),
      chargeEffect: async () => ({ status: 'unreadable', reason: 'ledger unavailable' }),
      generateId: sequentialIds('action-window'), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true, route: 'halt' });
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(`unexpected case-store failure: ${settled.reason}`);
    const accepted = settled.state.cases.find((record) => record.id === 'action-window-1');
    const live = settled.state.cases.find((record) => record.id === 'action-window-3');
    expect(accepted).toMatchObject({ resolution: 'resolved', effect: { status: 'failed' } });
    expect(live).toMatchObject({ resolution: 'open', effect: { status: 'failed' } });
    // The executor durably settled BOTH reservations to failed; that
    // reserved->failed transition emits even for the operator-retired case.
    expect(events.filter((event) => event.type === 'remediation_effect_failed' && event.caseId === accepted?.id)).toEqual([
      expect.objectContaining({
        type: 'remediation_effect_failed', caseId: accepted?.id, effectKind: 'action', reason: 'ledger unavailable',
      }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'remediation_effect_failed', caseId: live?.id, effectKind: 'action' }));
    expect(events.filter((event) => event.type === 'remediation_adjudication_started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'remediation_adjudication_completed' || event.type === 'remediation_adjudication_failed')).toHaveLength(1);
  });

  it('retires an accepted deferral-effect failure but still files and halts for an unaccepted sibling', async () => {
    const root = await projectRoot();
    const events: RemediationCaseLifecycleEvent[] = [];
    const fileIssue = vi.fn(async () => { throw new Error('tracker unavailable'); });
    const resolutions = [
      new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>(),
      new Set<string>(), new Set([acceptedSource.findingId]), new Set([acceptedSource.findingId]),
    ];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => mixedDeferralJudgement()), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => resolutions.shift() ?? new Set([acceptedSource.findingId]),
      tracker: { findIssueByEffectMarker: async () => undefined } as unknown as EffectMarkerTrackerClient,
      repo: 'acme/conductor', fileIssue, generateId: sequentialIds('deferral-window'), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true, route: 'halt' });
    expect(fileIssue).toHaveBeenCalledTimes(2);
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled.ok).toBe(true);
    if (!settled.ok) throw new Error(`unexpected case-store failure: ${settled.reason}`);
    const accepted = settled.state.cases.find((record) => record.id === 'deferral-window-1');
    const live = settled.state.cases.find((record) => record.id === 'deferral-window-3');
    expect(accepted).toMatchObject({ resolution: 'open', effect: { status: 'failed', diagnostic: 'deferred intake failed: tracker unavailable' } });
    expect(live).toMatchObject({ resolution: 'open', effect: { status: 'failed', diagnostic: 'deferred intake failed: tracker unavailable' } });
    // The tracker failure is already durable when acceptance lands; acceptance
    // preserves that failed deferral rather than resolving it into PASS.
    expect(events.filter((event) => event.type === 'remediation_effect_failed' && event.caseId === accepted?.id)).toEqual([
      expect.objectContaining({
        type: 'remediation_effect_failed', caseId: accepted?.id, effectKind: 'deferral',
        reason: 'deferred intake failed: tracker unavailable',
      }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'remediation_effect_failed', caseId: live?.id, effectKind: 'deferral' }));
    expect(events.filter((event) => event.type === 'remediation_adjudication_started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'remediation_adjudication_completed' || event.type === 'remediation_adjudication_failed')).toHaveLength(1);
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
    // The halt precedes reconciliation, so nothing is reconciled or reserved.
    expect(events.map((event) => event.type)).toEqual([
      'remediation_adjudication_started',
      'remediation_semantic_repeat_halt', 'remediation_adjudication_failed',
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'remediation_semantic_repeat_halt', caseId: 'case-durable', effectId: 'effect-durable', reason: 'regressed',
    }));
  });

  // Covers: task:11, task:rem-prd-audit-R11a
  it('links only the repeated case before a reuse halt', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const sibling = {
      id: 'case-sibling', domain: 'build_review' as const, disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
      rationale: 'An unrelated attempted repair remains durable.', resolution: 'open' as const,
      sources: [{ sourceId: 'implementationQuality:sha256:sibling', outcome: 'acted' as const, recordedAt: '2026-10-20T00:00:00.000Z' }],
      effect: { id: 'effect-sibling', kind: 'action' as const, status: 'applied' as const, workOrderId: 'order-sibling' },
    };
    await seedCases(store, {
      version: 'v3', feature, prdWideningCases: [], suppressions: [], outbox: [],
      cases: [{
        id: 'case-repeat', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The current finding was already attempted.', resolution: 'open',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-20T00:00:00.000Z' }],
        effect: { id: 'effect-repeat', kind: 'action', status: 'applied', workOrderId: 'order-repeat' },
      }, sibling],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-repeat',
      cases: [
        { caseId: 'case-repeat', priority: 'high', tasks: [{ title: 'Repair the repeated finding' }] },
        { caseId: sibling.id, priority: 'high', tasks: [{ title: 'Repair the sibling finding' }] },
      ],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    const before = await store.read();
    if (!before.ok) throw new Error(`unexpected case-store failure: ${before.reason}`);
    const siblingBefore = before.state.cases.find((record) => record.id === sibling.id);
    const events: RemediationCaseLifecycleEvent[] = [];
    const repeated: RemediationCaseJudgement = {
      ...actionJudgement(),
      cases: [{ ...actionJudgement().cases[0]!, existingCaseId: 'case-repeat' }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => repeated), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: false, detail: 'semantic remediation case repeat case-repeat' });
    const after = await store.read();
    if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
    expect(after.state.cases.find((record) => record.id === sibling.id)).toEqual(siblingBefore);
    expect(after.state.version === 'v3' ? after.state.outbox : []).toEqual([]);
    expect(events.map((event) => event.type)).not.toContain('remediation_case_reconciled');
  });

  it('keeps the regression halt when the resolved case was sourced only by a prior lap', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-prior-lap', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The test needs a focused assertion.', resolution: 'resolved',
        sources: [{ sourceId: 'implementationQuality:sha256:prior-lap-finding', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-prior-lap', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    const events: RemediationCaseLifecycleEvent[] = [];
    const repeated: RemediationCaseJudgement = {
      ...actionJudgement(),
      cases: [{ ...actionJudgement().cases[0]!, existingCaseId: 'case-prior-lap' }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => repeated),
      emit: async (event) => { events.push(event); },
    });

    // The prior lap's source is never live now. Treating that as acceptance
    // finalized the halt as an unexplained source-coverage gap.
    expect(result).toMatchObject({ ok: false, detail: 'semantic remediation case regression case-prior-lap' });
    expect(events.map((event) => event.type)).toEqual([
      'remediation_adjudication_started',
      'remediation_semantic_repeat_halt', 'remediation_adjudication_failed',
    ]);
  });

  it('keeps the regression halt for an explicit rebind to a resolved failed action case', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-never-built', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The test needs a focused assertion.', resolution: 'resolved',
        sources: [{ sourceId: 'implementationQuality:sha256:earlier-lap', outcome: 'acted', recordedAt: '2026-10-17T13:51:43.000Z' }],
        effect: { id: 'effect-never-built', kind: 'action', status: 'failed', diagnostic: 'build-review kickback budget exhausted (cumulative)' },
      }],
    });
    const events: RemediationCaseLifecycleEvent[] = [];
    const rebound: RemediationCaseJudgement = {
      ...actionJudgement(),
      cases: [{ ...actionJudgement().cases[0]!, existingCaseId: 'case-never-built' }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => rebound), generateId: sequentialIds('rebound'),
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: false, detail: 'semantic remediation case regression case-never-built' });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'remediation_semantic_repeat_halt', caseId: 'case-never-built', effectId: 'effect-never-built', reason: 'regressed',
    }));
    const after = await store.read();
    if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
    expect(after.state.cases.find((record) => record.id === 'case-never-built')).toMatchObject({
      resolution: 'resolved', effect: { status: 'failed' },
    });
    expect(after.state.cases).toHaveLength(1);
  });

  it('admits an unbound re-raise over resolved history as a fresh action case', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const mergedSourceId = buildReviewAdjudicationSourceId(acceptedSource);
    const otherSourceId = buildReviewAdjudicationSourceId(liveSource);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-r', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The earlier repair exhausted its attempt.', resolution: 'resolved',
        sources: [{ sourceId: mergedSourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { id: 'effect-r', kind: 'action', status: 'failed', diagnostic: 'build-review kickback budget exhausted (cumulative)' },
      }],
    });
    const before = JSON.parse(await readFile(remediationCaseStorePath(root), 'utf8')).cases[0];
    const chargeEffect = vi.fn(chargeBuildReviewEffectInLedger);
    const events: RemediationCaseLifecycleEvent[] = [];
    const reRaised: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [
        { sourceId: mergedSourceId, outcome: 'merged', caseRef: 'case-n' },
        { sourceId: otherSourceId, outcome: 'acted', caseRef: 'case-n' },
      ],
      cases: [{
        caseRef: 'case-n', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The re-raised finding needs a fresh repair.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the re-raised finding' }] },
      }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => reRaised), aggregate: mixedAggregate, chargeEffect,
      generateId: sequentialIds('case-n'), emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true, route: 'build', durable: { repairCaseIds: ['case-n-1'] } });
    expect(chargeEffect).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).not.toContain('remediation_adjudication_failed');
    const after = await store.read();
    if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
    expect(after.state.cases).toHaveLength(2);
    expect(after.state.cases.find((record) => record.id === 'case-n-1')).toMatchObject({
      disposition: 'act', resolution: 'open',
      sources: [{ sourceId: mergedSourceId, outcome: 'merged' }, { sourceId: otherSourceId, outcome: 'acted' }],
      effect: { id: 'case-n-2', kind: 'action', status: 'applied' },
    });
    expect(JSON.parse(await readFile(remediationCaseStorePath(root), 'utf8')).cases[0]).toEqual(before);
  });

  it.each([
    ['defer', 'deferred'],
    ['reject', 'rejected'],
  ] as const)('admits an unbound %s over a resolved applied action case', async (disposition, outcome) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-r', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The earlier repair was applied.', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { id: 'effect-r', kind: 'action', status: 'applied', workOrderId: 'order-r' },
      }],
    });
    const before = JSON.parse(await readFile(remediationCaseStorePath(root), 'utf8')).cases[0];
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome, caseRef: 'case-n' }],
      cases: [disposition === 'defer'
        ? {
            caseRef: 'case-n', disposition, priority: 'low', confidence: 'high', rationale: 'The follow-up is outside this feature.',
            effect: { kind: 'deferral', title: 'Track the re-raised finding', body: 'The finding remains live.', exclusionRationale: 'It is outside this feature.' },
          }
        : {
            caseRef: 'case-n', disposition, priority: 'low', confidence: 'high', rationale: 'The finding is rejected.', effect: { kind: 'none' },
          }],
    };
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), generateId: sequentialIds(`${disposition}-n`),
      ...(disposition === 'defer'
        ? { repo: 'acme/conductor', tracker: { findIssueByEffectMarker: async () => undefined } as unknown as EffectMarkerTrackerClient,
          fileIssue: async () => ({ issueUrl: 'https://example.test/issues/1' }) }
        : {}),
    });

    expect(result.ok).toBe(true);
    const after = await store.read();
    if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
    expect(after.state.cases.find((record) => record.id === `${disposition}-n-1`)).toMatchObject({ disposition });
    expect(JSON.parse(await readFile(remediationCaseStorePath(root), 'utf8')).cases[0]).toEqual(before);
  });

  it('converges a repeated unbound re-raise without another case, effect, or charge', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-r', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The earlier repair exhausted its attempt.', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { id: 'effect-r', kind: 'action', status: 'failed', diagnostic: 'budget exhausted' },
      }],
    });
    const chargeEffect = vi.fn(chargeBuildReviewEffectInLedger);
    const judgement = actionJudgement();
    const first = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), chargeEffect, generateId: sequentialIds('repeat-n'),
    });
    const second = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), chargeEffect, generateId: sequentialIds('unexpected'),
    });

    expect(first).toMatchObject({ ok: true, route: 'build' });
    expect(second).toMatchObject({ ok: true, route: 'build' });
    expect(chargeEffect).toHaveBeenCalledTimes(1);
    const after = await store.read();
    if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
    expect(after.state.cases).toHaveLength(2);
    expect(after.state.cases.flatMap((record) => record.effect.kind === 'action' ? [record.effect.id] : [])).toEqual(['effect-r', 'repeat-n-2']);
  });

  it('rejects an unbound action that overlaps an open owner', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    const ownerSourceId = buildReviewAdjudicationSourceId(acceptedSource);
    const siblingSourceId = buildReviewAdjudicationSourceId(liveSource);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-o', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The existing repair remains open.', resolution: 'open',
        sources: [{ sourceId: ownerSourceId, outcome: 'acted', recordedAt: '2026-10-18T00:00:00.000Z' }],
        effect: { id: 'effect-o', kind: 'action', status: 'applied', workOrderId: 'order-o' },
      }],
    });
    const before = await readFile(remediationCaseStorePath(root), 'utf8');
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [
        { sourceId: ownerSourceId, outcome: 'acted', caseRef: 'case-n' },
        { sourceId: siblingSourceId, outcome: 'acted', caseRef: 'case-n' },
      ],
      cases: [{
        caseRef: 'case-n', disposition: 'act', priority: 'high', confidence: 'high', rationale: 'A new repair is requested.',
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the overlapping finding' }] },
      }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), aggregate: mixedAggregate, generateId: sequentialIds('case-n'),
    });

    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('case transition rejected: source-linked-by-multiple-cases') });
    expect(result).toMatchObject({ detail: expect.stringContaining('case-o') });
    expect(result).toMatchObject({ detail: expect.stringContaining('case-n-1') });
    expect(result).toMatchObject({ detail: expect.stringContaining(ownerSourceId) });
    await expect(readFile(remediationCaseStorePath(root), 'utf8')).resolves.toBe(before);
  });

  it('halts a regression before reserving a sibling action effect it could never apply', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-regressed', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The first test needed a focused assertion.', resolution: 'resolved',
        sources: [{ sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'acted', recordedAt: '2026-10-16T00:00:00.000Z' }],
        effect: { id: 'effect-regressed', kind: 'action', status: 'applied', workOrderId: 'order-regressed' },
      }],
    });
    const events: RemediationCaseLifecycleEvent[] = [];
    const judge = vi.fn(async () => ({
      mode: 'case-v1' as const, domain: 'build_review' as const,
      sourceOutcomes: [
        { sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'acted' as const, caseRef: 'case-again' },
        { sourceId: buildReviewAdjudicationSourceId(acceptedSource), outcome: 'acted' as const, caseRef: 'case-sibling' },
      ],
      cases: [{
        caseRef: 'case-again', existingCaseId: 'case-regressed', disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
        rationale: 'The first test still lacks the assertion.',
        effect: { kind: 'action' as const, route: 'build' as const, tasks: [{ title: 'Repair the first test' }] },
      }, {
        caseRef: 'case-sibling', disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
        rationale: 'An independent defect needs BUILD work.',
        effect: { kind: 'action' as const, route: 'build' as const, tasks: [{ title: 'Repair the sibling defect' }] },
      }],
    }));

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, judge), aggregate: mixedAggregate, generateId: sequentialIds('stranded'),
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: false, detail: 'semantic remediation case regression case-regressed' });
    const after = await store.read();
    if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
    // No reservation survives the halt, so the next lap is not blocked by an
    // effect whose tasks existed only in this discarded judgement.
    expect(after.state.cases.filter((record) => record.effect.kind !== 'none' && record.effect.status === 'reserved')).toEqual([]);
    expect(events.map((event) => event.type)).not.toContain('remediation_effect_reserved');
  });

  it.each([
    ['an applied deferral', 'defer', 'deferred', { id: 'effect-durable', kind: 'deferral', status: 'applied', issueUrl: 'https://example.test/issues/1' }],
    ['a rejection', 'reject', 'rejected', { kind: 'none' }],
    ['a merged source on an applied action case', 'act', 'merged', { id: 'effect-durable', kind: 'action', status: 'applied', workOrderId: 'order-durable' }],
  ] as const)('skips the judge when exact recurrence is settled by %s', async (_description, disposition, outcome, effect) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-finalized', domain: 'build_review', disposition, priority: 'low', confidence: 'high',
        rationale: 'This finding is already finalized.', resolution: 'resolved',
        sources: [{ sourceId, outcome, recordedAt: '2026-09-06T00:00:00.000Z' }], effect,
      }],
    });
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication(input(root, judge));

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(judge).not.toHaveBeenCalled();
  });

  it('settles only the merged source of a resolved action case and re-adjudicates its unmerged sibling', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    // One resolved action case carrying two sources: the first merged, the
    // second only acted. Settlement is per source, so the merged source is
    // retired while its unmerged sibling recurs live and must reach the judge.
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-mixed-outcomes', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'One source of this case merged; the other did not.', resolution: 'resolved',
        sources: [
          { sourceId: buildReviewAdjudicationSourceId(acceptedSource), outcome: 'merged', recordedAt: '2026-09-06T00:00:00.000Z' },
          { sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'acted', recordedAt: '2026-09-06T00:00:00.000Z' },
        ],
        effect: { id: 'effect-mixed', kind: 'action', status: 'applied', workOrderId: 'order-mixed' },
      }],
    });
    const contexts: unknown[] = [];
    const judge = vi.fn(async (context: unknown) => {
      contexts.push(context);
      // The unmerged sibling recurs against its own still-resolved case, which
      // is the semantic-repeat regression the coordinator must be able to see.
      return {
        mode: 'case-v1' as const, domain: 'build_review' as const,
        sourceOutcomes: [{ sourceId: buildReviewAdjudicationSourceId(liveSource), outcome: 'acted' as const, caseRef: 'case-live' }],
        cases: [{
          caseRef: 'case-live', existingCaseId: 'case-mixed-outcomes', disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
          rationale: 'The unmerged sibling still needs a focused assertion.',
          effect: { kind: 'action' as const, route: 'build' as const, tasks: [{ title: 'Repair the second test' }] },
        }],
      };
    });

    const result = await coordinateBuildReviewAdjudication({ ...input(root, judge), aggregate: mixedAggregate, generateId: sequentialIds('sibling') });

    expect(judge).toHaveBeenCalledTimes(1);
    expect(contexts[0]).toMatchObject({ currentFindings: [expect.objectContaining({ sourceId: buildReviewAdjudicationSourceId(liveSource) })] });
    expect(result).toMatchObject({ ok: false, detail: 'semantic remediation case regression case-mixed-outcomes' });
  });

  it('keeps a merged source live while its applied action case remains open', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-open-action', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The repair was applied but the case is not resolved.', resolution: 'open',
        sources: [{ sourceId, outcome: 'merged', recordedAt: '2026-09-06T00:00:00.000Z' }],
        effect: { id: 'effect-open-action', kind: 'action', status: 'applied', workOrderId: 'order-open-action' },
      }],
    });
    const judge = vi.fn(async () => actionJudgement());

    await coordinateBuildReviewAdjudication(input(root, judge));

    expect(judge).toHaveBeenCalledOnce();
  });

  it('dispatches only the new source when another exact recurrence is settled', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-finalized', domain: 'build_review', disposition: 'reject', priority: 'low', confidence: 'high',
        rationale: 'The first finding is already finalized.', resolution: 'resolved',
        sources: [{ sourceId: buildReviewAdjudicationSourceId(acceptedSource), outcome: 'rejected', recordedAt: '2026-09-06T00:00:00.000Z' }],
        effect: { kind: 'none' },
      }],
    });
    const judge = vi.fn(async (context: unknown) => {
      expect(context).toMatchObject({ currentFindings: [expect.objectContaining({ sourceId: buildReviewAdjudicationSourceId(liveSource) })] });
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

    const result = await coordinateBuildReviewAdjudication({ ...input(root, judge), aggregate: mixedAggregate });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('reports a skipped dispatch only when every live source was already settled (NC.3)', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-finalized', domain: 'build_review', disposition: 'reject', priority: 'low', confidence: 'high',
        rationale: 'The finding is already finalized.', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'rejected', recordedAt: '2026-09-06T00:00:00.000Z' }],
        effect: { kind: 'none' },
      }],
    });
    const judge = vi.fn(async () => actionJudgement());

    const result = await coordinateBuildReviewAdjudication({ ...input(root, judge) });

    expect(result).toMatchObject({ ok: true, route: 'pass', dispatchSkipped: true, trace: expect.stringContaining('case-finalized') });
    expect(judge).not.toHaveBeenCalled();
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

  it.each([
    ['healthy', 'resolved'],
    ['retry', 'open'],
  ] as const)('settles absent open non-action history on a mechanically %s content lap', async (mechanical, resolution) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    // An earlier lap deferred a finding this lap no longer reports. Its effect
    // is applied, so nothing about it is unfinished — only its `open` marker,
    // which a mechanically complete lap decides by absence. Left open, it feeds
    // a later adjudication as unresolved prior history.
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-absent', domain: 'build_review', disposition: 'defer', priority: 'low', confidence: 'high',
        rationale: 'An earlier lap deferred this finding.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256-earlier', outcome: 'deferred', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-absent', kind: 'deferral', status: 'applied', issueUrl: 'https://example.invalid/1' },
      }],
    });

    await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), mechanical, generateId: sequentialIds('absent'),
    });

    const settled = await store.read();
    expect(settled.ok && settled.state.cases.find((record) => record.id === 'case-absent')?.resolution).toBe(resolution);
  });

  it('drops a route made obsolete by acceptance landing during the completion emission', async () => {
    const root = await projectRoot();
    // The completion emission is awaited work like any other, so an exact
    // acceptance can land inside it — after the settle round's own read and
    // before the caller's terminal BUILD or HALT.
    let accepted = new Set<string>();
    const events: RemediationCaseLifecycleEvent[] = [];
    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()),
      resolveOperatorResolvedFindingIds: async () => accepted,
      emit: async (event) => {
        events.push(event);
        if (event.type === 'remediation_adjudication_completed') accepted = new Set([findingId]);
      },
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    // One settled lap, so exactly one completion occurrence on the spine.
    expect(events.filter((event) => event.type === 'remediation_adjudication_completed')).toHaveLength(1);
    const settled = await new RemediationCaseStore(root, feature).read();
    expect(settled).toMatchObject({ ok: true, state: { cases: [expect.objectContaining({ resolution: 'resolved' })] } });
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
    // Four unresolved reads, the acceptance read at the exit, then the re-reads
    // adjacent to the settled state that the route derives from — including the
    // one after the completion emission, the lap's last awaited work.
    expect(resolveOperatorResolvedFindingIds).toHaveBeenCalledTimes(8);
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
    expect(events.filter((event) =>
      event.type === 'remediation_case_reconciled' && event.caseId === accepted.id && event.resolution === 'resolved',
    )).toEqual([
      expect.objectContaining({ eventId: expect.any(String), resolution: 'resolved' }),
    ]);
    expect(events.filter((event) => event.type === 'remediation_effect_failed' && event.caseId === accepted.id)).toEqual([
      expect.objectContaining({
        type: 'remediation_effect_failed', caseId: accepted.id, effectId: accepted.effect.id, effectKind: 'action',
        reason: 'retired: every source operator-accepted or no longer raised',
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

  it('fails closed before reconciliation when refutation evidence cannot be resolved', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-durable', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The test needs a focused assertion.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256:prior-lap', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-durable', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-durable',
      cases: [{ caseId: 'case-durable', priority: 'high', tasks: [{ title: 'Add the missing assertion' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    const before = await readFile(join(root, '.pipeline', 'remediation-cases.json'), 'utf8');
    const events: RemediationCaseLifecycleEvent[] = [];
    const refuted: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'refuted', caseRef: 'case-refuted' }],
      cases: [{
        caseRef: 'case-refuted', existingCaseId: 'case-durable', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The claimed gap is covered by the repaired branch.', effect: { kind: 'none' },
        refutation: {
          claim: 'The repair did not cover the asserted branch.',
          assertions: [{
            assertion: 'The repaired branch remains absent.', verdict: 'refuted',
            evidence: [{ path: 'test/missing-refutation-evidence.test.ts', excerpt: 'covers the repaired branch' }],
          }],
        },
      }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => refuted), emit: async (event) => { events.push(event); },
    });

    expect({
      result,
      store: await readFile(join(root, '.pipeline', 'remediation-cases.json'), 'utf8'),
      events,
    }).toEqual({
      result: { ok: false, detail: 'unresolvable-refutation-evidence' },
      store: before,
      events: [
        { type: 'remediation_adjudication_started', domain: 'build_review', lapId: 'lap-1' },
        { type: 'remediation_adjudication_failed', domain: 'build_review', lapId: 'lap-1', reason: 'unresolvable-refutation-evidence' },
      ],
    });
  });

  it('settles an attempted re-raised action as a finalized refutation without another charge', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-durable', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The test needs a focused assertion.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256:prior-lap', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-durable', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-durable',
      cases: [{ caseId: 'case-durable', priority: 'high', tasks: [{ title: 'Add the missing assertion' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'test', 'refutation-evidence.test.ts'), 'covers the repaired branch\n');
    const events: RemediationCaseLifecycleEvent[] = [];
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    const refuted: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'refuted', caseRef: 'case-refuted' }],
      cases: [{
        caseRef: 'case-refuted', existingCaseId: 'case-durable', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The claimed gap is covered by the repaired branch.', effect: { kind: 'none' },
        refutation: {
          claim: 'The repair did not cover the asserted branch.',
          assertions: [{
            assertion: 'The repaired branch remains absent.', verdict: 'refuted',
            evidence: [{ path: 'test/refutation-evidence.test.ts', excerpt: 'covers the repaired branch' }],
          }],
        },
      }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => refuted), chargeEffect: charge, emit: async (event) => { events.push(event); },
    });
    const settled = await store.read();

    expect({
      result: { ok: result.ok, route: result.ok ? result.route : undefined, trace: result.ok ? result.trace : undefined },
      chargeCalls: charge.mock.calls.length,
      case: settled.ok ? settled.state.cases[0] : undefined,
      refutations: events.filter((event) => event.type === 'remediation_case_refuted'),
    }).toMatchObject({
      result: { ok: true, route: 'pass', trace: expect.stringContaining('case-durable [refute/resolved]') },
      chargeCalls: 0,
      case: {
        id: 'case-durable', disposition: 'refute', resolution: 'resolved', effect: { kind: 'none' },
        refutation: expect.objectContaining({
          claim: 'The repair did not cover the asserted branch.',
          assertions: [expect.objectContaining({ verdict: 'refuted' })],
        }),
      },
      refutations: [{ type: 'remediation_case_refuted', caseId: 'case-durable' }],
    });
  });

  it('settles an attempted re-raised action with its exact historical source id', async () => {
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
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-durable',
      cases: [{ caseId: 'case-durable', priority: 'high', tasks: [{ title: 'Add the missing assertion' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'test', 'refutation-evidence.test.ts'), 'covers the repaired branch\n');
    const events: RemediationCaseLifecycleEvent[] = [];
    const charge = vi.fn(chargeBuildReviewEffectInLedger);
    const judgement: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'refuted', caseRef: 'case-refuted' }],
      cases: [{
        caseRef: 'case-refuted', existingCaseId: 'case-durable', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The claimed gap is covered by the repaired branch.', effect: { kind: 'none' },
        refutation: { claim: 'The repair did not cover the asserted branch.', assertions: [{
          assertion: 'The repaired branch remains absent.', verdict: 'refuted',
          evidence: [{ path: 'test/refutation-evidence.test.ts', excerpt: 'covers the repaired branch' }],
        }] },
      }],
    };

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => judgement), chargeEffect: charge, emit: async (event) => { events.push(event); },
    });
    const settled = await store.read();

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(charge).not.toHaveBeenCalled();
    expect(settled).toMatchObject({ ok: true, state: { cases: [expect.objectContaining({
      id: 'case-durable', disposition: 'refute', resolution: 'resolved', effect: { kind: 'none' },
      sources: [expect.objectContaining({ sourceId, outcome: 'refuted' })],
    })] } });
    if (settled.ok) expect(settled.state.cases[0]?.sources).toHaveLength(1);
    expect(events.filter((event) => event.type === 'remediation_case_refuted')).toEqual([
      expect.objectContaining({ caseId: 'case-durable' }),
    ]);
    expect(events.map((event) => event.type)).not.toContain('remediation_effect_reserved');
    expect(events.map((event) => event.type)).not.toContain('remediation_adjudication_failed');
  });

  it('admits an open action refutation, settles its exact source on lap B, and re-dispatches drifted content', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-durable', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The earlier review requested coverage.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256:prior-action', outcome: 'acted', recordedAt: '2026-09-11T00:00:00.000Z' }],
        effect: { id: 'effect-durable', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-durable',
      cases: [{ caseId: 'case-durable', priority: 'high', tasks: [{ title: 'Cover the asserted branch' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'test', 'refutation-evidence.test.ts'), 'the asserted branch is covered\n');
    const refuted: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'refuted', caseRef: 'refuted-case' }],
      cases: [{
        caseRef: 'refuted-case', existingCaseId: 'case-durable', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The existing test covers the asserted branch.', effect: { kind: 'none' },
        refutation: { claim: 'The asserted branch lacks coverage.', assertions: [{
          assertion: 'The branch remains uncovered.', verdict: 'refuted',
          evidence: [{ path: 'test/refutation-evidence.test.ts', excerpt: 'asserted branch is covered' }],
        }] },
      }],
    };
    const events: RemediationCaseLifecycleEvent[] = [];
    const lapAJudge = vi.fn(async () => refuted);
    await expect(coordinateBuildReviewAdjudication({
      ...input(root, lapAJudge), emit: async (event) => { events.push(event); },
    })).resolves.toMatchObject({ ok: true, route: 'pass' });
    await expect(store.read()).resolves.toMatchObject({ ok: true, state: { cases: [expect.objectContaining({
      id: 'case-durable', disposition: 'refute', resolution: 'resolved', effect: { kind: 'none' },
    })] } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'remediation_case_refuted', caseId: 'case-durable' }));

    const lapBJudge = vi.fn(async () => actionJudgement());
    const lapB = await coordinateBuildReviewAdjudication({ ...input(root, lapBJudge), emit: async (event) => { events.push(event); } });
    expect(lapB).toMatchObject({ ok: true, route: 'pass', dispatchSkipped: true });
    expect(lapBJudge).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).not.toContain('remediation_semantic_repeat_halt');

    const judgedResult = aggregate.results.testQuality;
    if (judgedResult.kind !== 'judged') throw new Error('fixture must provide a judged test-quality result');
    const driftedAggregate = joinBuildReviewRubricOutcomes({
      ...aggregate, lapId: 'lap-drifted' as never,
      results: { security: aggregate.results.security, testQuality: { ...judgedResult, lapId: 'lap-drifted' as never, findings: [{
        ...judgedResult.findings[0]!, anchor: { ...judgedResult.findings[0]!.anchor, locus: { ...judgedResult.findings[0]!.anchor.locus, contentHash: 'sha256:drifted' } },
      }] } },
    });
    const driftedSourceId = buildReviewAdjudicationSourceId(projectBuildReviewAggregateSources(driftedAggregate)![0]!);
    const driftedJudge = vi.fn(async (context: unknown) => {
      expect(context).toMatchObject({ currentFindings: [expect.objectContaining({ sourceId: driftedSourceId })] });
      return {
        mode: 'case-v1' as const, domain: 'build_review' as const,
        sourceOutcomes: [{ sourceId: driftedSourceId, outcome: 'rejected' as const, caseRef: 'drifted-case' }],
        cases: [{ caseRef: 'drifted-case', disposition: 'reject' as const, priority: 'low' as const, confidence: 'high' as const, rationale: 'New content needs no action.', effect: { kind: 'none' as const } }],
      };
    });
    await coordinateBuildReviewAdjudication({ ...input(root, driftedJudge), aggregate: driftedAggregate });
    expect(driftedJudge).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['applied', { findIssueByEffectMarker: vi.fn().mockResolvedValue(null) } as unknown as EffectMarkerTrackerClient, vi.fn().mockResolvedValue({ issueUrl: 'https://github.test/acme/repo/issues/44' }), 'pass'],
    ['reserved', undefined, undefined, 'halt'],
    ['failed', { findIssueByEffectMarker: vi.fn().mockResolvedValue(null) } as unknown as EffectMarkerTrackerClient, vi.fn().mockRejectedValue(new Error('tracker unavailable')), 'halt'],
  ] as const)('keeps a refuted %s residual from regressing on lap B', async (_status, tracker, fileIssue, expectedRoute) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-durable', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'The earlier review requested coverage.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256:prior-action', outcome: 'acted', recordedAt: '2026-09-11T00:00:00.000Z' }],
        effect: { id: 'effect-durable', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-durable',
      cases: [{ caseId: 'case-durable', priority: 'high', tasks: [{ title: 'Cover the asserted branch' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'test', 'refutation-residual.test.ts'), 'the asserted branch is covered\n');
    const lapAJudge = vi.fn(async (): Promise<RemediationCaseJudgement> => ({
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'refuted', caseRef: 'refuted-case' }],
      cases: [{
        caseRef: 'refuted-case', existingCaseId: 'case-durable', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The existing test covers the asserted branch.',
        effect: { kind: 'deferral', title: 'Track the unrelated follow-up', body: 'This remains outside the feature.', exclusionRationale: 'The active plan excludes this follow-up.' },
        refutation: { claim: 'The asserted branch lacks coverage.', assertions: [{
          assertion: 'The branch remains uncovered.', verdict: 'refuted',
          evidence: [{ path: 'test/refutation-residual.test.ts', excerpt: 'asserted branch is covered' }],
        }] },
      }],
    }));
    const events: RemediationCaseLifecycleEvent[] = [];
    await coordinateBuildReviewAdjudication({
      ...input(root, lapAJudge), ...(tracker ? { tracker, repo: 'acme/repo', fileIssue } : {}),
      generateId: sequentialIds('residual'), emit: async (event) => { events.push(event); },
    });

    const lapBJudge = vi.fn(async () => actionJudgement());
    const lapB = await coordinateBuildReviewAdjudication({ ...input(root, lapBJudge), emit: async (event) => { events.push(event); } });
    expect(lapBJudge).not.toHaveBeenCalled();
    expect(lapB).toMatchObject({ ok: true, route: expectedRoute, trace: expect.stringContaining('residual-1') });
    expect(events.map((event) => event.type)).not.toContain('remediation_semantic_repeat_halt');
  });

  it('halts a second refutation without rewriting its original record or emitting another refutation occurrence', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'test', 'refutation-evidence.test.ts'), 'the evidence remains current\n');
    const original = {
      claim: 'The original claim is false.',
      assertions: [{ assertion: 'The original behavior exists.', verdict: 'refuted' as const, evidence: [{ path: 'test/refutation-evidence.test.ts', excerpt: 'evidence remains current' }] }],
    };
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-durable', domain: 'build_review', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The earlier claim was refuted.', resolution: 'resolved',
        sources: [{ sourceId: 'testQuality:sha256:earlier-source', outcome: 'refuted', recordedAt: '2026-09-11T00:00:00.000Z' }],
        effect: { kind: 'none' }, refutation: original,
      }],
    });
    const before = await readFile(join(root, '.pipeline', 'remediation-cases.json'), 'utf8');
    const events: RemediationCaseLifecycleEvent[] = [];
    const repeated: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'refuted', caseRef: 'again' }],
      cases: [{
        caseRef: 'again', existingCaseId: 'case-durable', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'A second refutation must not overwrite the first.', effect: { kind: 'none' }, refutation: original,
      }],
    };

    const result = await coordinateBuildReviewAdjudication({ ...input(root, async () => repeated), emit: async (event) => { events.push(event); } });

    expect(result).toEqual({ ok: false, detail: 'refutation repeat case-durable' });
    expect(await readFile(join(root, '.pipeline', 'remediation-cases.json'), 'utf8')).toBe(before);
    expect(events.map((event) => event.type)).not.toContain('remediation_case_refuted');
  });

  it('keeps an exact refuted source settled across laps but dispatches a drifted source id', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-refuted', domain: 'build_review', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The exact source is settled.', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'refuted', recordedAt: '2026-09-11T00:00:00.000Z' }], effect: { kind: 'none' },
        refutation: { claim: 'The finding is false.', assertions: [{ assertion: 'The behavior exists.', verdict: 'refuted', evidence: [{ path: 'test/example.test.ts', excerpt: 'fixture' }] }] },
      }],
    });
    const exactJudge = vi.fn(async () => actionJudgement());
    const exact = await coordinateBuildReviewAdjudication({ ...input(root, exactJudge) });
    expect(exact).toMatchObject({ ok: true, route: 'pass', dispatchSkipped: true });
    expect(exactJudge).not.toHaveBeenCalled();

    const judgedResult = aggregate.results.testQuality;
    if (judgedResult.kind !== 'judged') throw new Error('fixture must provide a judged test-quality result');
    const driftedAggregate = joinBuildReviewRubricOutcomes({
      ...aggregate, lapId: 'lap-drifted' as never,
      results: { security: aggregate.results.security, testQuality: { ...judgedResult, lapId: 'lap-drifted' as never, findings: [{
        ...judgedResult.findings[0]!, anchor: { ...judgedResult.findings[0]!.anchor, locus: { ...judgedResult.findings[0]!.anchor.locus, contentHash: 'sha256:drifted' } },
      }] } },
    });
    const driftedJudge = vi.fn(async () => ({ mode: 'case-v1' as const, domain: 'build_review' as const, sourceOutcomes: [], cases: [] }));
    await coordinateBuildReviewAdjudication({ ...input(root, driftedJudge), aggregate: driftedAggregate });
    expect(driftedJudge).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['reserved', { id: 'effect-refuted', kind: 'deferral', status: 'reserved' }],
    ['failed', { id: 'effect-refuted', kind: 'deferral', status: 'failed', diagnostic: 'tracker unavailable' }],
  ] as const)('does not re-judge an exact refuted source with a %s residual', async (_status, effect) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-refuted', domain: 'build_review', disposition: 'refute', priority: 'high', confidence: 'high',
        rationale: 'The exact source has unfinished follow-up.', resolution: 'resolved',
        sources: [{ sourceId, outcome: 'refuted', recordedAt: '2026-09-11T00:00:00.000Z' }], effect,
        refutation: { claim: 'The finding is false.', assertions: [{ assertion: 'The behavior exists.', verdict: 'refuted', evidence: [{ path: 'test/example.test.ts', excerpt: 'fixture' }] }] },
      }],
    });
    const judge = vi.fn(async () => actionJudgement());
    const result = await coordinateBuildReviewAdjudication({ ...input(root, judge) });

    expect(judge).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, route: 'halt', trace: expect.stringContaining('effect-refuted') });
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

  describe('absent failed cases', () => {
    // A lap charged this action past the cumulative kickback budget, so its
    // effect failed. After an operator reset, a later lap no longer reports its
    // finding, yet the open failed case halted every lap as unfinalized.
    const failedCase = (sourceIdValue: string) => ({
      id: 'case-failed', domain: 'build_review' as const, disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
      rationale: 'An action charged past the budget.', resolution: 'open' as const,
      sources: [{ sourceId: sourceIdValue, outcome: 'acted' as const, recordedAt: '2026-10-17T13:51:43.000Z' }],
      effect: { id: 'effect-failed', kind: 'action' as const, status: 'failed' as const, diagnostic: 'build-review kickback budget exhausted (cumulative)' },
    });

    it('resolves a failed case whose finding is gone so the lap routes instead of halting forever', async () => {
      const root = await projectRoot();
      const store = new RemediationCaseStore(root, feature);
      await seedCases(store, { version: 'v1', feature, cases: [failedCase('implementationQuality:sha256-failed-gone')] });
      const events: RemediationCaseLifecycleEvent[] = [];

      const result = await coordinateBuildReviewAdjudication({
        ...input(root, async () => actionJudgement()), generateId: sequentialIds('lap-two'),
        emit: async (event) => { events.push(event); },
      });

      expect(result).toMatchObject({ ok: true, route: 'build' });
      const after = await store.read();
      if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
      expect(after.state.cases.find((record) => record.id === 'case-failed')).toMatchObject({
        resolution: 'resolved',
        effect: { id: 'effect-failed', status: 'failed', diagnostic: 'build-review kickback budget exhausted (cumulative)' },
      });
      expect(events).toContainEqual(expect.objectContaining({
        type: 'remediation_case_reconciled', caseId: 'case-failed', resolution: 'resolved',
      }));
    });

    it('builds a still-reported finding bound to a case whose action effect failed', async () => {
      // daemon-reconciliation-delays-first-feature-dispatc: case 01dd292d was
      // charged past the budget, the budget was reset, and the next lap
      // re-raised the same source onto it. The failed effect can never apply,
      // so the rebound case needs a fresh effect or every lap halts on it.
      const root = await projectRoot();
      const store = new RemediationCaseStore(root, feature);
      await seedCases(store, { version: 'v1', feature, cases: [failedCase(sourceId)] });
      const rebound: RemediationCaseJudgement = {
        ...actionJudgement(),
        cases: [{ ...actionJudgement().cases[0]!, existingCaseId: 'case-failed' }],
      };

      const result = await coordinateBuildReviewAdjudication({
        ...input(root, async () => rebound), generateId: sequentialIds('rebound'),
      });

      expect(result).toMatchObject({ ok: true, route: 'build' });
      const after = await store.read();
      if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
      const retried = after.state.cases.find((record) => record.id === 'case-failed');
      expect(retried).toMatchObject({ resolution: 'open', effect: { kind: 'action', status: 'applied' } });
      expect(retried?.effect).not.toMatchObject({ id: 'effect-failed' });
    });
  });

  it('routes a published repair that BUILD never attempted to BUILD when this lap only rejects its own finding', async () => {
    // preserve-self-build-provider-transcripts-on-failed: a lap applied two
    // repairs, then halted before BUILD; the next lap rejected its only finding
    // and halted forever on "awaits its BUILD attempt".
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-pending', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'A repair published by an earlier lap.', resolution: 'open',
        sources: [{ sourceId: 'implementationQuality:sha256-earlier-lap', outcome: 'acted', recordedAt: '2026-10-17T14:08:25.000Z' }],
        effect: { id: 'effect-pending', kind: 'action', status: 'applied', workOrderId: 'order-pending' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-pending',
      cases: [{ caseId: 'case-pending', priority: 'high', tasks: [{ title: 'The unbuilt repair' }] }],
    });
    const rejected: RemediationCaseJudgement = {
      mode: 'case-v1', domain: 'build_review',
      sourceOutcomes: [{ sourceId, outcome: 'rejected', caseRef: 'case-rejected' }],
      cases: [{ caseRef: 'case-rejected', disposition: 'reject', priority: 'low', confidence: 'high', rationale: 'Not actionable.', effect: { kind: 'none' } }],
    };

    const result = await coordinateBuildReviewAdjudication(input(root, async () => rejected));

    expect(result).toMatchObject({ ok: true, route: 'build', durable: { repairCaseIds: ['case-pending'] } });
  });

  describe('stranded deferral reservations', () => {
    // An earlier lap reserved this deferral in a run with no filing capability,
    // so its issue was never filed and the effect stayed reserved. The reducer
    // then halted every later lap on "remediation effect is not finalized".
    const strandedDeferral = (sourceIdValue: string) => ({
      id: 'case-deferred', domain: 'build_review' as const, disposition: 'defer' as const, priority: 'low' as const, confidence: 'high' as const,
      rationale: 'Out-of-scope duplication.', resolution: 'open' as const,
      sources: [{ sourceId: sourceIdValue, outcome: 'deferred' as const, recordedAt: '2026-10-17T09:42:58.000Z' }],
      effect: { id: 'effect-deferred', kind: 'deferral' as const, status: 'reserved' as const },
    });

    it('settles a deferral whose finding is gone so the lap routes instead of halting forever', async () => {
      const root = await projectRoot();
      const store = new RemediationCaseStore(root, feature);
      await seedCases(store, { version: 'v1', feature, cases: [strandedDeferral('implementationQuality:sha256-deferred-gone')] });
      const events: RemediationCaseLifecycleEvent[] = [];

      const result = await coordinateBuildReviewAdjudication({
        ...input(root, async () => actionJudgement()), generateId: sequentialIds('lap-two'),
        emit: async (event) => { events.push(event); },
      });

      expect(result).toMatchObject({ ok: true, route: 'build' });
      const after = await store.read();
      if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
      expect(after.state.cases.find((record) => record.id === 'case-deferred')).toMatchObject({
        resolution: 'resolved',
        effect: { id: 'effect-deferred', kind: 'deferral', status: 'failed', diagnostic: 'stranded reservation: deferral never filed' },
      });
      expect(events).toContainEqual(expect.objectContaining({
        type: 'remediation_effect_failed', caseId: 'case-deferred', effectId: 'effect-deferred', effectKind: 'deferral',
        reason: 'stranded reservation: deferral never filed',
      }));
    });

    it('leaves a reserved deferral whose finding this lap still reports', async () => {
      const root = await projectRoot();
      const store = new RemediationCaseStore(root, feature);
      await seedCases(store, { version: 'v1', feature, cases: [strandedDeferral(sourceId)] });

      await coordinateBuildReviewAdjudication(input(root, async () => actionJudgement()));

      const after = await store.read();
      if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
      expect(after.state.cases.find((record) => record.id === 'case-deferred')?.effect)
        .not.toMatchObject({ diagnostic: 'stranded reservation: deferral never filed' });
    });
  });

  describe('stranded action reservations', () => {
    // An earlier lap reserved this action, then halted before its effect
    // boundary published the tasks (the pre-#3257 sibling-reservation defect).
    // Its tasks lived only in that discarded judgement, so no later lap can
    // apply it.
    const strandedCase = (sourceIdValue: string) => ({
      id: 'case-stranded', domain: 'build_review' as const, disposition: 'act' as const, priority: 'high' as const, confidence: 'high' as const,
      rationale: 'An action whose judgement was discarded.', resolution: 'open' as const,
      sources: [{ sourceId: sourceIdValue, outcome: 'acted' as const, recordedAt: '2026-10-16T05:10:00.000Z' }],
      effect: { id: 'effect-stranded', kind: 'action' as const, status: 'reserved' as const },
    });
    const absentSourceId = 'implementationQuality:sha256-stranded';

    it('settles a reservation whose tasks were never published so the lap routes instead of halting forever', async () => {
      const root = await projectRoot();
      const store = new RemediationCaseStore(root, feature);
      await seedCases(store, { version: 'v1', feature, cases: [strandedCase(absentSourceId)] });
      const events: RemediationCaseLifecycleEvent[] = [];

      const result = await coordinateBuildReviewAdjudication({
        ...input(root, async () => actionJudgement()), generateId: sequentialIds('lap-two'),
        emit: async (event) => { events.push(event); },
      });

      expect(result).toMatchObject({ ok: true, route: 'build' });
      const after = await store.read();
      if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
      expect(after.state.cases.find((record) => record.id === 'case-stranded')).toMatchObject({
        resolution: 'resolved',
        effect: { id: 'effect-stranded', kind: 'action', status: 'failed', diagnostic: 'retired: every source operator-accepted or no longer raised' },
      });
      expect(events).toContainEqual(expect.objectContaining({
        type: 'remediation_effect_failed', caseId: 'case-stranded', effectId: 'effect-stranded', effectKind: 'action',
        reason: 'stranded reservation: tasks never published',
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'remediation_case_reconciled', caseId: 'case-stranded', resolution: 'resolved',
      }));
      const order = JSON.parse(await readFile(join(root, '.pipeline', 'build-review-work-order.json'), 'utf8')) as { cases: { caseId: string }[] };
      expect(order.cases.map((row) => row.caseId)).not.toContain('case-stranded');
    });

    it('lets a lap with no live findings pass once the stranded reservation is settled', async () => {
      const root = await projectRoot();
      const store = new RemediationCaseStore(root, feature);
      await seedCases(store, { version: 'v1', feature, cases: [strandedCase(absentSourceId)] });
      const judge = vi.fn(async () => actionJudgement());

      const result = await coordinateBuildReviewAdjudication({
        ...input(root, judge), operatorResolvedFindingIds: new Set([findingId]),
      });

      // The settled failure is resolved history: neither the reducer's
      // unfinished-effect test nor the settlement obligation blocks PASS.
      expect(result).toMatchObject({ ok: true, route: 'pass' });
      expect(judge).not.toHaveBeenCalled();
    });

    it('leaves a reservation the current lap resumes untouched and applies it', async () => {
      const root = await projectRoot();
      const store = new RemediationCaseStore(root, feature);
      // Its source is live this lap, so the reservation is still current work:
      // the judge resumes it and the effect boundary applies it.
      await seedCases(store, { version: 'v1', feature, cases: [strandedCase(sourceId)] });
      const events: RemediationCaseLifecycleEvent[] = [];
      const judge = async (): Promise<RemediationCaseJudgement> => ({
        mode: 'case-v1', domain: 'build_review',
        sourceOutcomes: [{ sourceId, outcome: 'acted', caseRef: 'case-1' }],
        cases: [{
          caseRef: 'case-1', existingCaseId: 'case-stranded', disposition: 'act', priority: 'high', confidence: 'high',
          rationale: 'The finding still needs its repair.',
          effect: { kind: 'action', route: 'build', tasks: [{ title: 'Repair the resumed finding' }] },
        }],
      });

      const result = await coordinateBuildReviewAdjudication({
        ...input(root, judge), generateId: sequentialIds('lap-two'),
        emit: async (event) => { events.push(event); },
      });

      expect(result).toMatchObject({ ok: true, route: 'build' });
      const after = await store.read();
      if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
      expect(after.state.cases.find((record) => record.id === 'case-stranded')).toMatchObject({
        resolution: 'open', effect: { id: 'effect-stranded', status: 'applied' },
      });
      expect(events.map((event) => event.type)).not.toContain('remediation_effect_failed');
    });

    it.each([
      ['a mechanically incomplete lap, whose absence proves nothing', 'retry' as const, false],
      ['a reservation whose tasks the published order already carries', 'healthy' as const, true],
    ])('leaves the reservation untouched for %s', async (_label, mechanical, published) => {
      const root = await projectRoot();
      const store = new RemediationCaseStore(root, feature);
      await seedCases(store, { version: 'v1', feature, cases: [strandedCase(absentSourceId)] });
      if (published) {
        await publishBuildReviewWorkOrder(root, {
          version: 'v1', domain: 'build_review', feature, effectId: 'effect-stranded',
          cases: [{ caseId: 'case-stranded', priority: 'high', tasks: [{ title: 'Published repair' }] }],
        });
      }
      const events: RemediationCaseLifecycleEvent[] = [];

      await coordinateBuildReviewAdjudication({
        ...input(root, async () => actionJudgement()), mechanical, generateId: sequentialIds('lap-two'),
        emit: async (event) => { events.push(event); },
      });

      const after = await store.read();
      if (!after.ok) throw new Error(`unexpected case-store failure: ${after.reason}`);
      if (mechanical === 'retry') {
        expect(after.state.cases.find((record) => record.id === 'case-stranded')?.effect).toMatchObject({ status: 'reserved' });
        expect(events).not.toContainEqual(expect.objectContaining({ type: 'remediation_case_reconciled', caseId: 'case-stranded' }));
      } else {
        expect(after.state.cases.find((record) => record.id === 'case-stranded')?.effect).toMatchObject({
          status: 'failed', diagnostic: 'retired: every source operator-accepted or no longer raised',
        });
        expect(events).toContainEqual(expect.objectContaining({ type: 'remediation_case_reconciled', caseId: 'case-stranded' }));
      }
    });
  });

  it('carries an unattempted absent action case into the republished order instead of halting', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    // An earlier lap applied this action, then the feature halted before BUILD
    // ran the order: no attempt evidence, and the current lap no longer reports
    // its source. Its tasks exist only in the published order.
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-pending', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'An earlier finding BUILD has not yet repaired.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256-pending', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-pending', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-pending',
      cases: [{ caseId: 'case-pending', priority: 'high', tasks: [{ title: 'Repair the earlier finding' }] }],
    });

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), generateId: sequentialIds('lap-two'),
    });

    expect(result).toMatchObject({ ok: true, route: 'build' });
    const order = JSON.parse(await readFile(join(root, '.pipeline', 'build-review-work-order.json'), 'utf8')) as {
      cases: { caseId: string; tasks: { title: string }[] }[];
    };
    expect(order.cases.map((row) => [row.caseId, row.tasks.map((task) => task.title)])).toEqual(expect.arrayContaining([
      ['case-pending', ['Repair the earlier finding']],
      [expect.not.stringMatching(/^case-pending$/), ['Add the missing assertion']],
    ]));
    expect(order.cases).toHaveLength(2);
  });

  it('still halts when an absent applied action case has no tasks in this lap or the published order', async () => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-orphan', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'An earlier finding whose order was lost.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256-orphan', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-orphan', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-orphan',
      cases: [{ caseId: 'case-other', priority: 'high', tasks: [{ title: 'Unrelated work' }] }],
    });

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), generateId: sequentialIds('lap-two'),
    });

    expect(result).toMatchObject({ ok: false, detail: 'action case case-orphan has no work-order tasks' });
  });
  it.each([
    ['at entry', 0],
    ['before dispatch', 1],
    ['after the judgement', 2],
  ] as const)('settles an attempted absent action case on the all-resolved shortcut %s', async (_when, reads) => {
    const root = await projectRoot();
    const store = new RemediationCaseStore(root, feature);
    // An earlier lap applied this action and BUILD attempted it; the current
    // lap no longer reports its source. The shortcut used to skip the
    // reconciler, so the case stayed open with an applied effect: the reducer
    // answered PASS while BUILD recovery still replayed its work order.
    await seedCases(store, {
      version: 'v1', feature,
      cases: [{
        id: 'case-attempted', domain: 'build_review', disposition: 'act', priority: 'high', confidence: 'high',
        rationale: 'An earlier finding that BUILD repaired.', resolution: 'open',
        sources: [{ sourceId: 'testQuality:sha256-earlier', outcome: 'acted', recordedAt: '2026-08-30T18:00:00.000Z' }],
        effect: { id: 'effect-attempted', kind: 'action', status: 'applied', workOrderId: 'order-1' },
      }],
    });
    await publishBuildReviewWorkOrder(root, {
      version: 'v1', domain: 'build_review', feature, effectId: 'effect-attempted',
      cases: [{ caseId: 'case-attempted', priority: 'high', tasks: [{ title: 'Repair the earlier finding' }] }],
    });
    await markBuildReviewWorkOrderAttempted(root, feature);
    const unresolved = Array.from({ length: reads }, () => new Set<string>());
    const events: RemediationCaseLifecycleEvent[] = [];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()),
      resolveOperatorResolvedFindingIds: async () => unresolved.shift() ?? new Set([findingId]),
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    await expect(store.read()).resolves.toMatchObject({
      ok: true, state: { cases: [{ id: 'case-attempted', resolution: 'resolved' }] },
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'remediation_case_reconciled', caseId: 'case-attempted', resolution: 'resolved',
    }));
  });

  it('fails closed on the all-resolved shortcut when durable attempt evidence is invalid', async () => {
    const root = await projectRoot();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'build-review-work-order.json'), '{not json');

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => actionJudgement()), operatorResolvedFindingIds: new Set([findingId]),
    });

    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('build-review work order') });
  });

  it('takes the acceptance-terminal exit instead of an obsolete HALT when the judgement fails after acceptance', async () => {
    const root = await projectRoot();
    const events: string[] = [];
    // Unresolved at entry, before dispatch, and when the judge is handed the
    // context; the exact acceptance lands while the provider call is in flight.
    const resolutions = [new Set<string>(), new Set<string>()];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => { throw new Error('provider unavailable'); }),
      resolveOperatorResolvedFindingIds: async () => resolutions.shift() ?? new Set([findingId]),
      emit: async (event) => { events.push(event.type); },
    });

    expect(result).toMatchObject({ ok: true, route: 'pass' });
    expect(events).not.toContain('remediation_adjudication_failed');
  });

  it('keeps a content failure closed when only one of two sources is accepted during the judgement', async () => {
    const root = await projectRoot();
    const resolutions = [new Set<string>(), new Set<string>()];

    const result = await coordinateBuildReviewAdjudication({
      ...input(root, async () => { throw new Error('provider unavailable'); }), aggregate: mixedAggregate,
      resolveOperatorResolvedFindingIds: async () => resolutions.shift() ?? new Set([acceptedSource.findingId]),
    });

    expect(result).toEqual({ ok: false, detail: 'remediate judgement failed' });
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
