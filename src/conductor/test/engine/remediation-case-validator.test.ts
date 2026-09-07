// Covers: task:4
import { describe, expect, it } from 'vitest';

import {
  validateRemediationCaseGraph,
  type RemediationCaseJudgement,
} from '../../src/engine/remediation-case-validator.js';

const CURRENT_SOURCE_IDS = [
  'testQuality:finding-1',
  'testQuality:finding-2',
  'testQuality:finding-3',
  'testQuality:finding-4',
] as const;

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

describe('remediation case graph validator', () => {
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
});
