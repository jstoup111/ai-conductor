// Covers: task:1, task:2, task:3, task:30, task:rem-prd-audit-r18-1, task:rem-prd-audit-r18-3, task:rem-prd-audit-r18-4, task:rem-as-built-r18-5
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyIndexOnlyAdmission,
  validateRemediationCaseGraph,
  type RemediationCaseJudgement,
  type UnknownAdmissionTaskRejection,
} from '../../src/engine/remediation-case-validator.js';
import * as buildReviewAdjudication from '../../src/engine/build-review-adjudication.js';
import { joinBuildReviewRubricOutcomes, projectBuildReviewAggregateSources } from '../../src/engine/build-review-aggregate.js';
import type { BuildReviewSeverity } from '../../src/engine/build-review-domain.js';
import { bindableDispositions, reconcileRemediationCases } from '../../src/engine/remediation-case-reconciler.js';
import { RemediationCaseStore, type RemediationCaseRecord } from '../../src/engine/remediation-case-store.js';
import {
  assembleBuildReviewAdjudicationContext,
  buildReviewAdjudicationSourceId,
} from '../../src/engine/build-review-adjudication-context.js';

const CURRENT_SOURCE_IDS = [
  'testQuality:finding-1',
  'testQuality:finding-2',
  'testQuality:finding-3',
  'testQuality:finding-4',
] as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function expectUnknownAdmissionTaskRejection(
  result: ReturnType<typeof validateRemediationCaseGraph>,
): asserts result is UnknownAdmissionTaskRejection {
  if (result.ok || result.reason !== 'unknown-admission-task') {
    throw new Error('expected an unknown admission task rejection');
  }
}

const VALID_JUDGEMENT = {
  mode: 'case-v1',
  domain: 'build_review',
  sourceOutcomes: [
    { sourceId: 'testQuality:finding-1', outcome: 'acted', caseRef: 'case-a' },
    { sourceId: 'testQuality:finding-2', outcome: 'merged', caseRef: 'case-a' },
    { sourceId: 'testQuality:finding-3', outcome: 'deferred', caseRef: 'case-b' },
    { sourceId: 'testQuality:finding-4', outcome: 'rejected', caseRef: 'case-c' },
  ],
  cases: [
    {
      caseRef: 'case-a',
      disposition: 'act',
      priority: 'high',
      rationale: 'Both findings need the same focused test repair.',
      confidence: 'high',
      effect: { kind: 'action', route: 'build', tasks: [{ title: 'test/widget.test.ts — cover the changed branch' }] },
    },
    {
      caseRef: 'case-b',
      disposition: 'defer',
      priority: 'low',
      rationale: 'The work is outside the approved plan.',
      confidence: 'medium',
      effect: {
        kind: 'deferral',
        title: 'Cover the unrelated widget branch',
        body: 'The current feature has no approved task for this behavior.',
        exclusionRationale: 'No current plan task admits this follow-up behavior.',
      },
    },
    {
      caseRef: 'case-c',
      disposition: 'reject',
      priority: 'medium',
      rationale: 'The finding does not violate the governing rubric.',
      confidence: 'low',
      effect: { kind: 'none' },
    },
  ],
} as const satisfies RemediationCaseJudgement;

const VALID_REFUTATION = {
  claim: 'The earlier action did not cover this finding.',
  assertions: [{
    assertion: 'The repaired branch is still absent.', verdict: 'refuted',
    evidence: [{ path: 'test/widget.test.ts', excerpt: 'covers the changed branch' }],
  }],
} as const;

const VALID_REFUTE_JUDGEMENT = {
  ...VALID_JUDGEMENT,
  sourceOutcomes: [
    ...VALID_JUDGEMENT.sourceOutcomes.slice(0, 3),
    { ...VALID_JUDGEMENT.sourceOutcomes[3], outcome: 'refuted', caseRef: 'case-refuted' },
  ],
  cases: [
    ...VALID_JUDGEMENT.cases.slice(0, 2),
    {
      caseRef: 'case-refuted', existingCaseId: 'existing-case-1', disposition: 'refute', priority: 'medium',
      rationale: 'The earlier action did not address the asserted defect.', confidence: 'high', effect: { kind: 'none' },
      refutation: VALID_REFUTATION,
    },
  ],
} as const satisfies RemediationCaseJudgement;

const CASE_V2_ADMISSION = {
  existingCaseIds: ['existing-case-1'],
  admittedTaskIds: ['30'],
  planTaskIds: ['30'],
} as const;

function authorizedActionCaseRefs(
  judgement: RemediationCaseJudgement,
  validation: ReturnType<typeof validateRemediationCaseGraph>,
): readonly string[] | undefined {
  const authorize = (buildReviewAdjudication as unknown as {
    authorizeBuildReviewRemediationActionEffects?: (input: {
      readonly judgement: RemediationCaseJudgement;
      readonly validation: ReturnType<typeof validateRemediationCaseGraph>;
    }) => readonly string[];
  }).authorizeBuildReviewRemediationActionEffects;
  return authorize?.({ judgement, validation });
}

const VALID_CASE_V2_JUDGEMENT = {
  mode: 'case-v2',
  domain: 'build_review',
  sourceOutcomes: [
    { sourceId: 'testQuality:finding-1', outcome: 'acted', caseRef: 'case-a' },
    { sourceId: 'testQuality:finding-2', outcome: 'merged', caseRef: 'case-a' },
    { sourceId: 'testQuality:finding-3', outcome: 'rejected', caseRef: 'case-b' },
    { sourceId: 'testQuality:finding-4', outcome: 'rejected', caseRef: 'case-c' },
  ],
  cases: [
    {
      caseRef: 'case-a', disposition: 'act', priority: 'high',
      rationale: 'The two source rows are one consistent in-scope repair.', confidence: 'high',
      effect: {
        kind: 'action', route: 'build', tasks: [{
          title: 'test/widget.test.ts — cover the changed branch',
          admittedTaskIds: ['30'],
          admissionRationale: 'Task 30 owns validation of the remediation case graph.',
        }],
      },
    },
    {
      caseRef: 'case-b', disposition: 'reject', priority: 'medium',
      rationale: 'The finding does not violate the governing rubric.', confidence: 'high', effect: { kind: 'none' },
    },
    {
      caseRef: 'case-c', existingCaseId: 'existing-case-1', disposition: 'reject', priority: 'low',
      rationale: 'This exact prior case remains correctly rejected.', confidence: 'high', effect: { kind: 'none' },
    },
  ],
  consistency: {
    verdict: 'consistent',
    sourceIds: CURRENT_SOURCE_IDS,
    caseRefs: ['case-a', 'case-b', 'case-c'],
    rationale: 'Every current source has one canonical case row and the merge preserves its source.',
  },
} as const satisfies RemediationCaseJudgement;

const VALID_CASE_V2_REFUTATION = {
  ...VALID_CASE_V2_JUDGEMENT,
  sourceOutcomes: [
    ...VALID_CASE_V2_JUDGEMENT.sourceOutcomes.slice(0, 3),
    { sourceId: 'testQuality:finding-4', outcome: 'refuted', caseRef: 'case-c' },
  ],
  cases: [
    ...VALID_CASE_V2_JUDGEMENT.cases.slice(0, 2),
    {
      caseRef: 'case-c', existingCaseId: 'existing-case-1', disposition: 'refute', priority: 'low',
      rationale: 'The attempted action is refuted by the inherited evidence contract.', confidence: 'high',
      effect: { kind: 'none' }, refutation: VALID_REFUTATION,
    },
  ],
} as const satisfies RemediationCaseJudgement;

function advisoryJudgement(mode: 'case-v1' | 'case-v2'): RemediationCaseJudgement {
  const base = mode === 'case-v1' ? VALID_JUDGEMENT : VALID_CASE_V2_JUDGEMENT;
  return {
    ...base,
    sourceOutcomes: [
      { ...base.sourceOutcomes[0], outcome: 'advisory' },
      ...base.sourceOutcomes.slice(1),
    ],
    cases: [{
      ...base.cases[0],
      disposition: 'advisory',
      rationale: 'The finding is below the configured operator threshold.',
      effect: { kind: 'none' },
      adjudicatedSeverity: 'minor',
    }, ...base.cases.slice(1)],
  } as RemediationCaseJudgement;
}

const SOURCE_RUBRICS = Object.freeze(Object.fromEntries(
  CURRENT_SOURCE_IDS.map((sourceId) => [sourceId, 'testQuality']),
));
const SOURCE_REVIEWER_SEVERITIES: Readonly<Record<string, BuildReviewSeverity>> = Object.freeze(Object.fromEntries(
  CURRENT_SOURCE_IDS.map((sourceId) => [sourceId, 'major' as const]),
));

function advisoryReferences(
  mode: RemediationCaseJudgement['mode'],
  declaredSeverityThresholds: Readonly<Partial<Record<string, BuildReviewSeverity>>>,
) {
  return {
    ...(mode === 'case-v2' ? CASE_V2_ADMISSION : {}),
    sourceRubrics: SOURCE_RUBRICS,
    sourceReviewerSeverities: SOURCE_REVIEWER_SEVERITIES,
    declaredSeverityThresholds,
  };
}

const CASE_BINDING_SOURCE = 'testQuality:F2';
const CASE_BINDING_RECORDED_AT = '2026-10-28T00:00:00.000Z';
const CASE_BINDING_REFUTATION = {
  claim: 'The attempted action is absent from the current tree.',
  assertions: [{
    assertion: 'The current tree omits the attempted action.',
    verdict: 'refuted' as const,
    evidence: [{ path: 'test/current.test.ts', excerpt: 'omits the attempted action' }],
  }],
} as const;

function durableActionCase(id: string, effectStatus: 'applied' | 'reserved' = 'applied'): RemediationCaseRecord {
  return {
    id,
    domain: 'build_review',
    disposition: 'act',
    priority: 'high',
    rationale: 'The existing action remains recorded.',
    confidence: 'high',
    resolution: 'open',
    sources: [{ sourceId: `prior:${id}`, outcome: 'acted', recordedAt: CASE_BINDING_RECORDED_AT }],
    effect: effectStatus === 'applied'
      ? { id: `effect:${id}`, kind: 'action', status: 'applied', workOrderId: `order:${id}` }
      : { id: `effect:${id}`, kind: 'action', status: 'reserved' },
  };
}

function boundJudgement(
  caseId: string,
  disposition: 'act' | 'defer' | 'reject' | 'refute' | 'advisory',
): RemediationCaseJudgement {
  const outcome = disposition === 'act' ? 'acted'
    : disposition === 'defer' ? 'deferred'
      : disposition === 'reject' ? 'rejected'
        : disposition === 'refute' ? 'refuted'
          : 'advisory';
  const effect = disposition === 'act'
    ? { kind: 'action' as const, route: 'build' as const, tasks: [{ title: 'Repair the validated case binding.' }] }
    : disposition === 'defer'
      ? { kind: 'deferral' as const, title: 'Deferred binding', body: 'Deferred.', exclusionRationale: 'Outside the plan.' }
      : { kind: 'none' as const };
  return {
    mode: 'case-v1',
    domain: 'build_review',
    sourceOutcomes: [{ sourceId: CASE_BINDING_SOURCE, outcome, caseRef: `row:${caseId}:${disposition}` }],
    cases: [{
      caseRef: `row:${caseId}:${disposition}`,
      existingCaseId: caseId,
      disposition,
      priority: 'medium',
      rationale: 'The case disposition is admitted by the engine-provided transition set.',
      confidence: 'high',
      effect,
      ...(disposition === 'refute' ? { refutation: CASE_BINDING_REFUTATION } : {}),
      ...(disposition === 'advisory' ? { adjudicatedSeverity: 'minor' as const } : {}),
    }],
  } as RemediationCaseJudgement;
}

const RESIDUAL_RE_RAISE = { kind: 'residual-gap', reason: 'the repair left a narrower gap' } as const;
const REPEAT_RE_RAISE = { kind: 'repeat', reason: 'the same defect is back' } as const;

function judgementWithReRaise(
  caseId: string | undefined,
  disposition: 'act' | 'defer',
  reRaise?: typeof RESIDUAL_RE_RAISE | typeof REPEAT_RE_RAISE,
): RemediationCaseJudgement {
  const judgement = boundJudgement(caseId ?? 'case-R', disposition);
  const originalCase = judgement.cases[0]!;
  const { existingCaseId: _existingCaseId, ...unboundCase } = originalCase;
  return {
    ...judgement,
    cases: [{
      ...(caseId === undefined ? unboundCase : originalCase),
      ...(reRaise === undefined ? {} : { reRaise }),
    }],
  } as RemediationCaseJudgement;
}

describe('remediation case graph validator', () => {
  // Covers: S1.1, task:2
  it('keeps residual-gap reRaise exactly on an eligible bound act row', () => {
    const judgement = judgementWithReRaise('case-R', 'act', RESIDUAL_RE_RAISE);

    expect(validateRemediationCaseGraph([CASE_BINDING_SOURCE], judgement, {
      reRaiseEligibleCaseIds: ['case-R'],
    })).toEqual(expect.objectContaining({
      ok: true,
      graph: expect.objectContaining({
        cases: [expect.objectContaining({ case: expect.objectContaining({ reRaise: RESIDUAL_RE_RAISE }) })],
      }),
    }));
  });

  // Covers: S1.1, task:2
  it('keeps repeat reRaise exactly on an eligible bound act row', () => {
    const judgement = judgementWithReRaise('case-R', 'act', REPEAT_RE_RAISE);

    expect(validateRemediationCaseGraph([CASE_BINDING_SOURCE], judgement, {
      reRaiseEligibleCaseIds: ['case-R'],
    })).toEqual(expect.objectContaining({
      ok: true,
      graph: expect.objectContaining({
        cases: [expect.objectContaining({ case: expect.objectContaining({ reRaise: REPEAT_RE_RAISE }) })],
      }),
    }));
  });

  // Covers: S1.1, task:2
  it('drops reRaise without rejection on an unbound act row', () => {
    const withReRaise = judgementWithReRaise(undefined, 'act', RESIDUAL_RE_RAISE);
    const withoutReRaise = judgementWithReRaise(undefined, 'act');

    expect(validateRemediationCaseGraph([CASE_BINDING_SOURCE], withReRaise, {
      reRaiseEligibleCaseIds: ['case-R'],
    })).toEqual(validateRemediationCaseGraph([CASE_BINDING_SOURCE], withoutReRaise, {
      reRaiseEligibleCaseIds: ['case-R'],
    }));
  });

  // Covers: S1.1, task:2
  it('drops reRaise without rejection on an act row bound to case-A', () => {
    const withReRaise = judgementWithReRaise('case-A', 'act', RESIDUAL_RE_RAISE);
    const withoutReRaise = judgementWithReRaise('case-A', 'act');

    expect(validateRemediationCaseGraph([CASE_BINDING_SOURCE], withReRaise, {
      reRaiseEligibleCaseIds: ['case-R'],
    })).toEqual(validateRemediationCaseGraph([CASE_BINDING_SOURCE], withoutReRaise, {
      reRaiseEligibleCaseIds: ['case-R'],
    }));
  });

  // Covers: S1.1, task:2
  it('drops reRaise without rejection on an act row bound to case-X', () => {
    const withReRaise = judgementWithReRaise('case-X', 'act', RESIDUAL_RE_RAISE);
    const withoutReRaise = judgementWithReRaise('case-X', 'act');

    expect(validateRemediationCaseGraph([CASE_BINDING_SOURCE], withReRaise, {
      reRaiseEligibleCaseIds: ['case-R'],
    })).toEqual(validateRemediationCaseGraph([CASE_BINDING_SOURCE], withoutReRaise, {
      reRaiseEligibleCaseIds: ['case-R'],
    }));
  });

  // Covers: S1.1, task:2
  it('drops reRaise without rejection on a defer row bound to case-R', () => {
    const withReRaise = judgementWithReRaise('case-R', 'defer', RESIDUAL_RE_RAISE);
    const withoutReRaise = judgementWithReRaise('case-R', 'defer');

    expect(validateRemediationCaseGraph([CASE_BINDING_SOURCE], withReRaise, {
      reRaiseEligibleCaseIds: ['case-R'],
    })).toEqual(validateRemediationCaseGraph([CASE_BINDING_SOURCE], withoutReRaise, {
      reRaiseEligibleCaseIds: ['case-R'],
    }));
  });

  // Covers: S1.1, task:2
  it('rejects a malformed reRaise shape before returning a graph', () => {
    const judgement = judgementWithReRaise('case-R', 'act', RESIDUAL_RE_RAISE);
    const malformed = {
      ...judgement,
      cases: [{ ...judgement.cases[0]!, reRaise: { kind: 'residual-gap', reason: '', note: 'extra' } }],
    } as unknown as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph([CASE_BINDING_SOURCE], malformed, {
      reRaiseEligibleCaseIds: ['case-R'],
    })).toEqual({ ok: false, reason: 'invalid-case-keys' });
  });

  // Covers: S3.2, task:3
  it('rejects an existing-case binding outside the engine-provided disposition set', () => {
    const judgement = {
      ...VALID_JUDGEMENT,
      cases: [...VALID_JUDGEMENT.cases.slice(0, 2), {
        ...VALID_JUDGEMENT.cases[2],
        existingCaseId: 'case-A',
      }],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement, {
      bindableDispositionsByCaseId: { 'case-A': ['act', 'defer', 'refute'] },
    })).toEqual({
      ok: false,
      reason: 'inadmissible-case-binding',
      bindings: [{
        caseRef: 'case-c',
        existingCaseId: 'case-A',
        disposition: 'reject',
        bindableDispositions: ['act', 'defer', 'refute'],
      }],
    });
  });

  // Covers: S3.2, task:3
  it('keeps missing source rejection ahead of inadmissible existing-case bindings', () => {
    const judgement = {
      ...VALID_JUDGEMENT,
      sourceOutcomes: VALID_JUDGEMENT.sourceOutcomes.slice(0, 3),
      cases: [...VALID_JUDGEMENT.cases.slice(0, 2), {
        ...VALID_JUDGEMENT.cases[2],
        existingCaseId: 'case-A',
      }],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement, {
      bindableDispositionsByCaseId: { 'case-A': ['act', 'defer', 'refute'] },
    })).toEqual({ ok: false, reason: 'missing-source' });
  });

  // Covers: S3.2, task:3
  it('does not apply existing-case binding admission to an escalation row', () => {
    const judgement = {
      ...VALID_CASE_V2_JUDGEMENT,
      sourceOutcomes: [...VALID_CASE_V2_JUDGEMENT.sourceOutcomes.slice(0, 3), {
        ...VALID_CASE_V2_JUDGEMENT.sourceOutcomes[3],
        outcome: 'escalate',
      }],
      cases: [...VALID_CASE_V2_JUDGEMENT.cases.slice(0, 2), {
        ...VALID_CASE_V2_JUDGEMENT.cases[2],
        existingCaseId: 'case-A',
        disposition: 'escalate',
        escalation: { owner: 'architecture' },
        effect: { kind: 'none' },
      }],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement, {
      ...CASE_V2_ADMISSION,
      existingCaseIds: ['existing-case-1', 'case-A'],
      bindableDispositionsByCaseId: { 'case-A': ['act'] },
    })).not.toMatchObject({ ok: false, reason: 'inadmissible-case-binding' });
  });

  // Covers: S3.2, task:3
  it('does not apply existing-case binding admission to an unmapped existing id', () => {
    const judgement = {
      ...VALID_JUDGEMENT,
      cases: [...VALID_JUDGEMENT.cases.slice(0, 2), {
        ...VALID_JUDGEMENT.cases[2],
        existingCaseId: 'case-unmapped',
      }],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement, {
      bindableDispositionsByCaseId: { 'case-A': ['act'] },
    })).not.toMatchObject({ ok: false, reason: 'inadmissible-case-binding' });
  });

  // Covers: S3.2, task:3
  it('admits every bindable disposition that reconciliation can apply without an illegal transition', async () => {
    const attemptedCaseIds = new Set(['case-A']);
    const carryInput = {
      currentLapId: 'lap-current',
      effectiveAcceptedSourceIds: new Set(['prior:case-C']),
    };
    const cases: readonly RemediationCaseRecord[] = [
      durableActionCase('case-A'),
      durableActionCase('case-U'),
      durableActionCase('case-R', 'reserved'),
      {
        id: 'case-J', domain: 'build_review', disposition: 'reject', priority: 'medium',
        rationale: 'The finding remains rejected.', confidence: 'high', resolution: 'resolved',
        sources: [{ sourceId: 'prior:case-J', outcome: 'rejected', recordedAt: CASE_BINDING_RECORDED_AT }],
        effect: { kind: 'none' },
      },
      {
        id: 'case-F', domain: 'build_review', disposition: 'refute', priority: 'medium',
        rationale: 'The finding remains refuted.', confidence: 'high', resolution: 'resolved',
        sources: [{ sourceId: 'prior:case-F', outcome: 'refuted', recordedAt: CASE_BINDING_RECORDED_AT }],
        effect: { kind: 'none' }, refutation: CASE_BINDING_REFUTATION,
      },
      {
        ...durableActionCase('case-C'),
        resolution: 'resolved',
        operatorAcceptance: { origins: [{ sourceId: 'prior:case-C', lapId: 'lap-prior' }] },
      },
    ];
    const bindableDispositionsByCaseId = Object.fromEntries(cases.map((record) => [
      record.id,
      bindableDispositions(record, attemptedCaseIds, record.id === 'case-C' ? carryInput : undefined),
    ]));

    for (const record of cases) {
      for (const disposition of bindableDispositionsByCaseId[record.id]!) {
        const judgement = boundJudgement(record.id, disposition);
        const validation = validateRemediationCaseGraph([CASE_BINDING_SOURCE], judgement, {
          bindableDispositionsByCaseId,
          sourceRubrics: { [CASE_BINDING_SOURCE]: 'testQuality' },
          sourceReviewerSeverities: { [CASE_BINDING_SOURCE]: 'major' },
          declaredSeverityThresholds: { testQuality: 'major' },
        });
        expect(validation.ok).toBe(true);
        if (!validation.ok) continue;

        const projectRoot = await mkdtemp(join(tmpdir(), 'remediation-case-validator-'));
        temporaryDirectories.push(projectRoot);
        const store = new RemediationCaseStore(projectRoot, {
          version: 'v1', repository: 'acme/conductor', feature: 'validator-binding-compatibility',
        });
        await store.mutate(async (state) => ({ value: undefined, nextState: { ...state, cases: [record] } }));
        const caseRef = judgement.cases[0]!.caseRef;
        const result = await reconcileRemediationCases(store, {
          graph: validation.graph,
          recordedAt: CASE_BINDING_RECORDED_AT,
          generateId: () => 'unused-id',
          attemptedCaseIds: [...attemptedCaseIds],
          ...(record.id === 'case-C' ? { carry: { caseRefs: [caseRef], lapId: carryInput.currentLapId } } : {}),
        });

        expect(result).not.toMatchObject({ ok: false, reason: 'illegal-disposition-transition' });
      }
    }
  });

  it.each([
    ['case-v1', advisoryJudgement('case-v1')],
    ['case-v2', advisoryJudgement('case-v2')],
  ] as const)('rejects an advisory %s judgement when no rubric threshold is declared', (_mode, judgement) => {
    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement,
      advisoryReferences(judgement.mode, {}),
    )).toEqual({ ok: false, reason: 'invalid-advisory-threshold' });
  });

  it.each([
    ['case-v1', advisoryJudgement('case-v1')],
    ['case-v2', advisoryJudgement('case-v2')],
  ] as const)('rejects an advisory %s judgement when its source rubric lacks a threshold', (_mode, judgement) => {
    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement,
      advisoryReferences(judgement.mode, { security: 'major' }),
    )).toEqual({ ok: false, reason: 'invalid-advisory-threshold' });
  });

  it.each([
    ['case-v1', advisoryJudgement('case-v1')],
    ['case-v2', advisoryJudgement('case-v2')],
  ] as const)('rejects an advisory %s judgement whose adjudicated severity reaches its source threshold', (_mode, judgement) => {
    const invalid = {
      ...judgement,
      cases: [{ ...judgement.cases[0], adjudicatedSeverity: 'major' }, ...judgement.cases.slice(1)],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, invalid,
      advisoryReferences(invalid.mode, { testQuality: 'major' }),
    )).toEqual({ ok: false, reason: 'invalid-advisory-threshold' });
  });

  it.each([
    ['case-v1', advisoryJudgement('case-v1')],
    ['case-v2', advisoryJudgement('case-v2')],
  ] as const)('rejects an advisory %s judgement whose adjudicated severity exceeds any linked reviewer severity', (_mode, judgement) => {
    const sources = judgement.sourceOutcomes.slice(0, 2).map((source, index) => index === 1
      ? { ...source, outcome: 'merged' as const }
      : source);
    const invalid = { ...judgement, sourceOutcomes: sources } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, invalid, {
      ...advisoryReferences(invalid.mode, { testQuality: 'critical' }),
      sourceReviewerSeverities: {
        ...SOURCE_REVIEWER_SEVERITIES,
        [CURRENT_SOURCE_IDS[1]]: 'nit',
      },
    })).toEqual({ ok: false, reason: 'invalid-advisory-threshold' });
  });

  it.each([
    ['case-v1', advisoryJudgement('case-v1')],
    ['case-v2', advisoryJudgement('case-v2')],
  ] as const)('rejects an advisory %s judgement when a merged source lacks its own threshold', (_mode, judgement) => {
    const invalid = {
      ...judgement,
      sourceOutcomes: judgement.sourceOutcomes.map((source, index) => index < 2
        ? { ...source, outcome: 'merged' as const }
        : source),
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, invalid, {
      ...advisoryReferences(invalid.mode, { testQuality: 'major' }),
      sourceRubrics: {
        ...SOURCE_RUBRICS,
        [CURRENT_SOURCE_IDS[1]]: 'security',
      },
    })).toEqual({ ok: false, reason: 'invalid-advisory-threshold' });
  });

  it.each([
    ['case-v1', advisoryJudgement('case-v1')],
    ['case-v2', advisoryJudgement('case-v2')],
  ] as const)('rejects an advisory %s judgement with no adjudicated severity', (_mode, judgement) => {
    const invalid = {
      ...judgement,
      cases: [{ ...judgement.cases[0], adjudicatedSeverity: undefined }, ...judgement.cases.slice(1)],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, invalid,
      advisoryReferences(invalid.mode, { testQuality: 'major' }),
    )).toEqual({ ok: false, reason: 'invalid-advisory-threshold' });
  });

  it.each([
    ['case-v1', advisoryJudgement('case-v1')],
    ['case-v2', advisoryJudgement('case-v2')],
  ] as const)('rejects an advisory %s judgement with an empty rationale', (_mode, judgement) => {
    const invalid = {
      ...judgement,
      cases: [{ ...judgement.cases[0], rationale: '' }, ...judgement.cases.slice(1)],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, invalid,
      advisoryReferences(invalid.mode, { testQuality: 'major' }),
    )).toEqual({ ok: false, reason: 'invalid-advisory-threshold' });
  });

  it.each([
    ['case-v1', advisoryJudgement('case-v1')],
    ['case-v2', advisoryJudgement('case-v2')],
  ] as const)('rejects an advisory %s judgement with an action effect', (_mode, judgement) => {
    const invalid = {
      ...judgement,
      cases: [{
        ...judgement.cases[0],
        effect: { kind: 'action', route: 'build', tasks: [{ title: 'Do not route advisory work.' }] },
      }, ...judgement.cases.slice(1)],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, invalid,
      advisoryReferences(invalid.mode, { testQuality: 'major' }),
    )).toEqual({ ok: false, reason: 'invalid-reject-effect' });
  });

  it('reconstructs every current source through exactly one canonical case', () => {
    const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, VALID_JUDGEMENT);

    expect(result).toEqual({
      ok: true,
      graph: {
        sourceOutcomes: VALID_JUDGEMENT.sourceOutcomes,
        cases: [
          { case: VALID_JUDGEMENT.cases[0], sources: VALID_JUDGEMENT.sourceOutcomes.slice(0, 2) },
          { case: VALID_JUDGEMENT.cases[1], sources: [VALID_JUDGEMENT.sourceOutcomes[2]] },
          { case: VALID_JUDGEMENT.cases[2], sources: [VALID_JUDGEMENT.sourceOutcomes[3]] },
        ],
      },
    });
  });

  it('does not require an outcome for a suppressed finding excluded by adjudication context assembly', () => {
    const aggregate = joinBuildReviewRubricOutcomes({
      lapId: 'lap-suppressed-source' as never,
      snapshotDigest: 'snapshot-suppressed-source',
      results: {
        testQuality: {
          kind: 'judged', rubric: 'testQuality', lapId: 'lap-suppressed-source' as never,
          snapshotDigest: 'snapshot-suppressed-source', contractVersion: 'v3', verdict: 'FAIL',
          findings: [
            { concernKind: 'test-insensitive', summary: 'Live finding.', evidenceLocations: ['test/live.test.ts:1'], anchor: { rubric: 'testQuality', locus: { path: 'test/live.test.ts', contentHash: 'sha256:live', display: 'live' } } },
            { concernKind: 'test-insensitive', summary: 'Suppressed finding.', evidenceLocations: ['test/suppressed.test.ts:1'], anchor: { rubric: 'testQuality', locus: { path: 'test/suppressed.test.ts', contentHash: 'sha256:suppressed', display: 'suppressed' } } },
          ],
        },
      },
    });
    const sources = projectBuildReviewAggregateSources(aggregate)!;
    const [liveSource, suppressedSource] = sources;
    const context = assembleBuildReviewAdjudicationContext({
      aggregate,
      priorCases: [],
      excludedSourceIds: new Set([buildReviewAdjudicationSourceId(suppressedSource!)]),
      suppressions: [{
        kind: 'confidence', findingId: suppressedSource!.findingId, rubric: 'testQuality', summary: 'Suppressed finding.',
        confidence: 40, floor: 70, lastSeenLap: 'lap-suppressed-source',
      }],
    });
    expect(context).toMatchObject({ ok: true });
    if (!context.ok) throw new Error('expected suppression context to assemble');
    const liveSourceIds = context.context.currentFindings.map((source) => source.sourceId);
    const suppressedSourceId = buildReviewAdjudicationSourceId(suppressedSource!);
    const judgement = {
      mode: 'case-v1',
      domain: 'build_review',
      sourceOutcomes: [{ sourceId: buildReviewAdjudicationSourceId(liveSource!), outcome: 'rejected', caseRef: 'case-live' }],
      cases: [{
        caseRef: 'case-live', disposition: 'reject', priority: 'low',
        rationale: 'The live finding is not actionable.', confidence: 'high', effect: { kind: 'none' },
      }],
    } as const satisfies RemediationCaseJudgement;

    expect(liveSourceIds).toEqual([buildReviewAdjudicationSourceId(liveSource!)]);
    expect(liveSourceIds).not.toContain(suppressedSourceId);
    expect(context.context.suppressionHistory).toHaveLength(1);
    expect(validateRemediationCaseGraph(liveSourceIds, judgement)).toMatchObject({ ok: true });
  });

  it.each([
    ['omitted source', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: VALID_JUDGEMENT.sourceOutcomes.slice(0, 3),
    }, 'missing-source'],
    ['duplicate source', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [...VALID_JUDGEMENT.sourceOutcomes, VALID_JUDGEMENT.sourceOutcomes[0]],
    }, 'duplicate-source'],
    ['unknown source', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [{ ...VALID_JUDGEMENT.sourceOutcomes[0], sourceId: 'testQuality:unknown' }, ...VALID_JUDGEMENT.sourceOutcomes.slice(1)],
    }, 'unknown-source'],
    ['dangling case reference', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [{ ...VALID_JUDGEMENT.sourceOutcomes[0], caseRef: 'case-missing' }, ...VALID_JUDGEMENT.sourceOutcomes.slice(1)],
    }, 'unknown-case-reference'],
    ['contradictory source outcome', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [{ ...VALID_JUDGEMENT.sourceOutcomes[0], outcome: 'deferred' }, ...VALID_JUDGEMENT.sourceOutcomes.slice(1)],
    }, 'contradictory-source-outcome'],
    ['contradictory case route', {
      ...VALID_JUDGEMENT,
      cases: [...VALID_JUDGEMENT.cases, { ...VALID_JUDGEMENT.cases[0], disposition: 'defer', effect: VALID_JUDGEMENT.cases[1].effect }],
    }, 'contradictory-case-disposition'],
    ['taskless action', {
      ...VALID_JUDGEMENT,
      cases: [{ ...VALID_JUDGEMENT.cases[0], effect: { kind: 'action', route: 'build', tasks: [] } }, ...VALID_JUDGEMENT.cases.slice(1)],
    }, 'invalid-action-effect'],
    ['deferral without exclusion rationale', {
      ...VALID_JUDGEMENT,
      cases: [VALID_JUDGEMENT.cases[0], {
        ...VALID_JUDGEMENT.cases[1],
        effect: { ...VALID_JUDGEMENT.cases[1].effect, exclusionRationale: '' },
      }, VALID_JUDGEMENT.cases[2]],
    }, 'invalid-deferral-effect'],
    ['provider durable case id', {
      ...VALID_JUDGEMENT,
      cases: [{ ...VALID_JUDGEMENT.cases[0], caseId: 'provider-case-id' }, ...VALID_JUDGEMENT.cases.slice(1)],
    }, 'provider-durable-id'],
    ['provider durable effect id', {
      ...VALID_JUDGEMENT,
      cases: [{ ...VALID_JUDGEMENT.cases[0], effect: { ...VALID_JUDGEMENT.cases[0].effect, effectId: 'provider-effect-id' } }, ...VALID_JUDGEMENT.cases.slice(1)],
    }, 'provider-durable-id'],
  ] as const)('rejects %s atomically', (_name, judgement, reason) => {
    const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement as RemediationCaseJudgement);

    expect(result).toEqual({ ok: false, reason });
  });

  it.each([
    ['a refute row without an existing case binding', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), { ...VALID_REFUTE_JUDGEMENT.cases[2], existingCaseId: undefined }],
    }, 'refute-without-binding'],
    ['a refutation with no refuted assertion', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), {
        ...VALID_REFUTE_JUDGEMENT.cases[2],
        refutation: { ...VALID_REFUTATION, assertions: [{ ...VALID_REFUTATION.assertions[0], verdict: 'upheld' }] },
      }],
    }, 'refutation-without-refuted-assertion'],
    ['a refutation below high confidence', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), { ...VALID_REFUTE_JUDGEMENT.cases[2], confidence: 'medium' }],
    }, 'refutation-confidence-not-high'],
    ['an action effect on a refute row', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), { ...VALID_REFUTE_JUDGEMENT.cases[2], effect: VALID_JUDGEMENT.cases[0].effect }],
    }, 'invalid-refute-effect'],
    ['a refute deferral without an exclusion rationale', {
      ...VALID_REFUTE_JUDGEMENT,
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), {
        ...VALID_REFUTE_JUDGEMENT.cases[2],
        effect: { kind: 'deferral', title: 'Follow up', body: 'The plan excludes this work.', exclusionRationale: '' },
      }],
    }, 'invalid-deferral-effect'],
    ['a refuted source outcome on a reject row', {
      ...VALID_JUDGEMENT,
      sourceOutcomes: [...VALID_JUDGEMENT.sourceOutcomes.slice(0, 3), { ...VALID_JUDGEMENT.sourceOutcomes[3], outcome: 'refuted' }],
    }, 'contradictory-source-outcome'],
  ] as const)('rejects %s', (_name, judgement, reason) => {
    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement as RemediationCaseJudgement)).toEqual({ ok: false, reason });
  });

  it('accepts a valid refute graph', () => {
    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, VALID_REFUTE_JUDGEMENT)).toMatchObject({ ok: true });
  });

  it.each([
    ['refuted', 'refute', true],
    ['refuted', 'reject', false],
    ['merged', 'act', true],
    ['merged', 'defer', true],
    ['merged', 'reject', true],
    ['merged', 'refute', true],
  ] as const)('accepts %s only for an allowed %s disposition', (outcome, disposition, expected) => {
    const caseRow = disposition === 'refute'
      ? VALID_REFUTE_JUDGEMENT.cases[2]
      : {
        caseRef: 'case-target', disposition, priority: 'medium', rationale: 'A test case.', confidence: 'high',
        effect: disposition === 'act'
          ? VALID_JUDGEMENT.cases[0].effect
          : disposition === 'defer'
            ? VALID_JUDGEMENT.cases[1].effect
            : { kind: 'none' },
      };
    const judgement = {
      ...VALID_REFUTE_JUDGEMENT,
      sourceOutcomes: [...VALID_REFUTE_JUDGEMENT.sourceOutcomes.slice(0, 3), { ...VALID_REFUTE_JUDGEMENT.sourceOutcomes[3], outcome, caseRef: 'case-target' }],
      cases: [...VALID_REFUTE_JUDGEMENT.cases.slice(0, 2), { ...caseRow, caseRef: 'case-target' }],
    } as RemediationCaseJudgement;

    expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement).ok).toBe(expected);
  });

  describe('case-v2 graph and effect admission', () => {
    it('accepts complete canonical merge and active-task admission evidence without judging the rationale text', () => {
      const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, VALID_CASE_V2_JUDGEMENT, CASE_V2_ADMISSION);

      expect(result).toMatchObject({ ok: true });
      expect(authorizedActionCaseRefs(VALID_CASE_V2_JUDGEMENT, result)).toEqual(['case-a']);
    });

    it('names supplied, index-only, and absent task admissions without changing case-v1 validation', () => {
      const withAdmissions = (admittedTaskIds: readonly string[]) => ({
        ...VALID_CASE_V2_JUDGEMENT,
        cases: [{
          ...VALID_CASE_V2_JUDGEMENT.cases[0],
          effect: {
            ...VALID_CASE_V2_JUDGEMENT.cases[0].effect,
            tasks: [{ ...VALID_CASE_V2_JUDGEMENT.cases[0].effect.tasks[0], admittedTaskIds }],
          },
        }, ...VALID_CASE_V2_JUDGEMENT.cases.slice(1)],
      } as RemediationCaseJudgement);
      const supplied = withAdmissions(['3']);
      const references = {
        admittedTaskIds: ['3'], planTaskIds: ['3', '9'], existingCaseIds: ['existing-case-1'],
      } as const;

      expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, supplied, references)).toMatchObject({ ok: true });
      const indexOnlyRejection = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, withAdmissions(['3', '9']), references);
      expect(indexOnlyRejection).toEqual({
        ok: false,
        reason: 'unknown-admission-task',
        indexOnlyTaskIds: ['9'],
        absentTaskIds: [],
      });
      expectUnknownAdmissionTaskRejection(indexOnlyRejection);
      expect(classifyIndexOnlyAdmission(CURRENT_SOURCE_IDS, withAdmissions(['3', '9']), references, indexOnlyRejection))
        .toEqual({ kind: 'index-only', taskIds: ['9'] });

      const absentRejection = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, withAdmissions(['T-99']), references);
      expect(absentRejection).toEqual({
        ok: false,
        reason: 'unknown-admission-task',
        indexOnlyTaskIds: [],
        absentTaskIds: ['T-99'],
      });
      expectUnknownAdmissionTaskRejection(absentRejection);
      expect(classifyIndexOnlyAdmission(CURRENT_SOURCE_IDS, withAdmissions(['T-99']), references, absentRejection))
        .toEqual({ kind: 'other', reason: 'unknown-admission-task' });

      expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, VALID_JUDGEMENT, { planTaskIds: ['3', '9'] }))
        .toEqual(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, VALID_JUDGEMENT));
    });

    it('classifies an index-only admission with a separate graph defect by the re-validation failure', () => {
      const judgement = {
        ...VALID_CASE_V2_JUDGEMENT,
        sourceOutcomes: VALID_CASE_V2_JUDGEMENT.sourceOutcomes.slice(0, 3),
        cases: [{
          ...VALID_CASE_V2_JUDGEMENT.cases[0],
          effect: {
            ...VALID_CASE_V2_JUDGEMENT.cases[0].effect,
            tasks: [{ ...VALID_CASE_V2_JUDGEMENT.cases[0].effect.tasks[0], admittedTaskIds: ['3', '9'] }],
          },
        }, ...VALID_CASE_V2_JUDGEMENT.cases.slice(1)],
      } as RemediationCaseJudgement;
      const references = { admittedTaskIds: ['3'], planTaskIds: ['3', '9'], existingCaseIds: ['existing-case-1'] } as const;
      const rejection = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement, references);

      expect(rejection).toEqual({
        ok: false,
        reason: 'unknown-admission-task',
        indexOnlyTaskIds: ['9'],
        absentTaskIds: [],
      });
      expectUnknownAdmissionTaskRejection(rejection);
      expect(classifyIndexOnlyAdmission(CURRENT_SOURCE_IDS, judgement, references, rejection))
        .toEqual({ kind: 'other', reason: 'missing-source' });
    });

    it.each([
      ['an empty consistency source list', {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: { ...VALID_CASE_V2_JUDGEMENT.consistency, sourceIds: [] },
      }, 'missing-consistency-source'],
      ['a duplicate consistency source', {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: { ...VALID_CASE_V2_JUDGEMENT.consistency, sourceIds: [...VALID_CASE_V2_JUDGEMENT.consistency.sourceIds, CURRENT_SOURCE_IDS[0]] },
      }, 'duplicate-consistency-source'],
      ['an invented consistency source', {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: { ...VALID_CASE_V2_JUDGEMENT.consistency, sourceIds: [...VALID_CASE_V2_JUDGEMENT.consistency.sourceIds.slice(0, 3), 'testQuality:invented'] },
      }, 'unknown-consistency-source'],
      ['an unresolved merge target', {
        ...VALID_CASE_V2_JUDGEMENT,
        sourceOutcomes: [{ ...VALID_CASE_V2_JUDGEMENT.sourceOutcomes[1], caseRef: 'case-missing' }, ...VALID_CASE_V2_JUDGEMENT.sourceOutcomes.slice(1)],
      }, 'unknown-case-reference'],
      ['an invented consistency case reference', {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: { ...VALID_CASE_V2_JUDGEMENT.consistency, caseRefs: ['case-a', 'case-b', 'case-missing'] },
      }, 'unknown-consistency-case-reference'],
      ['an empty consistency case reference list', {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: { ...VALID_CASE_V2_JUDGEMENT.consistency, caseRefs: [] },
      }, 'missing-consistency-case-reference'],
      ['a duplicate consistency case reference', {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: { ...VALID_CASE_V2_JUDGEMENT.consistency, caseRefs: ['case-a', 'case-b', 'case-b'] },
      }, 'duplicate-consistency-case-reference'],
      ['a missing consistency rationale', {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: { ...VALID_CASE_V2_JUDGEMENT.consistency, rationale: '' },
      }, 'missing-consistency-rationale'],
      ['an unknown existing case binding', {
        ...VALID_CASE_V2_JUDGEMENT,
        cases: [...VALID_CASE_V2_JUDGEMENT.cases.slice(0, 2), { ...VALID_CASE_V2_JUDGEMENT.cases[2], existingCaseId: 'missing-case' }],
      }, 'unknown-existing-case'],
      ['a task admission outside the active plan', {
        ...VALID_CASE_V2_JUDGEMENT,
        cases: [{
          ...VALID_CASE_V2_JUDGEMENT.cases[0],
          effect: { ...VALID_CASE_V2_JUDGEMENT.cases[0].effect, tasks: [{ ...VALID_CASE_V2_JUDGEMENT.cases[0].effect.tasks[0], admittedTaskIds: ['99'] }] },
        }, ...VALID_CASE_V2_JUDGEMENT.cases.slice(1)],
      }, 'unknown-admission-task'],
      ['a task action with no admission task', {
        ...VALID_CASE_V2_JUDGEMENT,
        cases: [{
          ...VALID_CASE_V2_JUDGEMENT.cases[0],
          effect: { ...VALID_CASE_V2_JUDGEMENT.cases[0].effect, tasks: [{ ...VALID_CASE_V2_JUDGEMENT.cases[0].effect.tasks[0], admittedTaskIds: [] }] },
        }, ...VALID_CASE_V2_JUDGEMENT.cases.slice(1)],
      }, 'missing-admission-task'],
      ['a task action with an empty admission task id', {
        ...VALID_CASE_V2_JUDGEMENT,
        cases: [{
          ...VALID_CASE_V2_JUDGEMENT.cases[0],
          effect: { ...VALID_CASE_V2_JUDGEMENT.cases[0].effect, tasks: [{ ...VALID_CASE_V2_JUDGEMENT.cases[0].effect.tasks[0], admittedTaskIds: [''] }] },
        }, ...VALID_CASE_V2_JUDGEMENT.cases.slice(1)],
      }, 'invalid-action-effect'],
      ['a task action with no admission rationale', {
        ...VALID_CASE_V2_JUDGEMENT,
        cases: [{
          ...VALID_CASE_V2_JUDGEMENT.cases[0],
          effect: { ...VALID_CASE_V2_JUDGEMENT.cases[0].effect, tasks: [{ ...VALID_CASE_V2_JUDGEMENT.cases[0].effect.tasks[0], admissionRationale: '' }] },
        }, ...VALID_CASE_V2_JUDGEMENT.cases.slice(1)],
      }, 'missing-admission-rationale'],
    ] as const)('rejects %s before any action is authorized', (_name, judgement, reason) => {
      const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement as RemediationCaseJudgement, CASE_V2_ADMISSION);

      expect(result).toMatchObject({ ok: false, reason });
      expect(authorizedActionCaseRefs(judgement as RemediationCaseJudgement, result)).toEqual([]);
    });

    it('accepts a blocked consistency record that names only the implicated source and case', () => {
      const judgement = {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: {
          verdict: 'blocked',
          sourceIds: [VALID_CASE_V2_JUDGEMENT.consistency.sourceIds[0]],
          caseRefs: [VALID_CASE_V2_JUDGEMENT.consistency.caseRefs[0]],
          rationale: 'Only this source contradicts the approved plan; the others are independent.',
        },
      } as RemediationCaseJudgement;

      expect(validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement, CASE_V2_ADMISSION)).toMatchObject({ ok: true });
    });

    it.each([
      ['blocked consistency', {
        ...VALID_CASE_V2_JUDGEMENT,
        consistency: { ...VALID_CASE_V2_JUDGEMENT.consistency, verdict: 'blocked', rationale: 'The two proposed repairs contradict each other.' },
      }],
      ['an escalation sibling', {
        ...VALID_CASE_V2_JUDGEMENT,
        sourceOutcomes: [...VALID_CASE_V2_JUDGEMENT.sourceOutcomes.slice(0, 3), { ...VALID_CASE_V2_JUDGEMENT.sourceOutcomes[3], outcome: 'escalate', caseRef: 'case-c' }],
        cases: [...VALID_CASE_V2_JUDGEMENT.cases.slice(0, 2), {
          ...VALID_CASE_V2_JUDGEMENT.cases[2], disposition: 'escalate', escalation: { owner: 'architecture' }, effect: { kind: 'none' },
        }],
      }],
    ] as const)('authorizes zero sibling action effects for %s', (_name, judgement) => {
      const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement as RemediationCaseJudgement, CASE_V2_ADMISSION);

      expect(result).toMatchObject({ ok: true });
      expect(authorizedActionCaseRefs(judgement as RemediationCaseJudgement, result)).toEqual([]);
    });

    it.each([
      ['without a known existing case', {
        ...VALID_CASE_V2_REFUTATION,
        cases: [...VALID_CASE_V2_REFUTATION.cases.slice(0, 2), { ...VALID_CASE_V2_REFUTATION.cases[2], existingCaseId: 'missing-case' }],
      }, 'unknown-existing-case'],
      ['without high confidence', {
        ...VALID_CASE_V2_REFUTATION,
        cases: [...VALID_CASE_V2_REFUTATION.cases.slice(0, 2), { ...VALID_CASE_V2_REFUTATION.cases[2], confidence: 'medium' }],
      }, 'refutation-confidence-not-high'],
    ] as const)('retains the inherited refutation validator for case-v2 %s', (_name, judgement, reason) => {
      const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, judgement as RemediationCaseJudgement, CASE_V2_ADMISSION);

      expect(result).toEqual({ ok: false, reason });
      expect(authorizedActionCaseRefs(judgement as RemediationCaseJudgement, result)).toEqual([]);
    });

    it('does not text-judge a valid case-v2 refutation before the inherited evidence resolver applies it', () => {
      const result = validateRemediationCaseGraph(CURRENT_SOURCE_IDS, VALID_CASE_V2_REFUTATION, CASE_V2_ADMISSION);

      expect(result).toMatchObject({ ok: true });
      expect(authorizedActionCaseRefs(VALID_CASE_V2_REFUTATION, result)).toEqual(['case-a']);
    });
  });
});
