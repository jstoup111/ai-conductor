import { describe, expect, it } from 'vitest';

import { classifyPrdWideningProjection } from '../../src/engine/prd-widening-classification.js';
import { prdWideningSourceId } from '../../src/engine/prd-widening-context.js';

const currentFinding = { criterion: 'NC.9', grade: 'OVER_SCOPE' as const, evidence: 'Replacement wording for the same visible behavior.' };
const currentSourceId = prdWideningSourceId(currentFinding);

const decision = {
  id: 'decision-accept', criterion: 'NC.1', authority: 'accept' as const,
  rationale: 'The original behavior is intentionally accepted.', operator: 'operator', revision: 1,
  originalSource: { id: 'prd-audit:NC.1', snapshot: 'Original reviewer wording.' },
  originalCaseId: 'case-1', offerEntryId: 'offer-1',
};

const caseRecord = {
  id: 'case-1', domain: 'prd_widening' as const,
  originalSources: [{ sourceId: 'prd-audit:NC.1', snapshot: 'Original reviewer wording.' }],
  currentSources: [{
    sourceId: currentSourceId,
    snapshot: 'Replacement wording for the same visible behavior.',
    recordedAt: '2026-09-09T00:00:00.000Z',
  }],
  relationships: [{
    currentSourceId: currentSourceId, kind: 'same-case' as const, caseId: 'case-1',
    reason: 'The replacement wording describes the original behavior.',
  }],
  reconciliationDigest: 'frozen-input-1',
};

describe('PRD widening evidence projection', () => {
  it('projects acceptance from the fresh relation, not the reviewer wording', () => {
    const classifications = classifyPrdWideningProjection({
      findings: [currentFinding],
      decisions: [decision], cases: [caseRecord],
    });

    expect(classifications.get('NC.9')).toEqual({ kind: 'accepted', decisionId: 'decision-accept' });
  });

  it.each([
    ['refused', [{ ...decision, authority: 'refuse' as const }], [caseRecord], { kind: 'refused', decisionId: 'decision-accept' }],
    ['unresolved', [decision], [{ ...caseRecord, currentSources: [{ ...caseRecord.currentSources[0]!, snapshot: 'stale replacement wording' }] }], { kind: 'unresolved', reason: 'stale-relation' }],
    ['not-blocking', [], [], { kind: 'not-blocking', reason: 'non-over-scope' }],
  ] as const)('keeps %s classification explicit and shared', (_name, decisions, cases, expected) => {
    const classifications = classifyPrdWideningProjection({
      findings: [{ ...currentFinding, grade: expected.kind === 'not-blocking' ? 'PASS' : 'OVER_SCOPE' }],
      decisions, cases,
    });

    expect(classifications.get('NC.9')).toEqual(expected);
  });

  it('names corrupt and unrenderable evidence instead of treating it as approval', () => {
    const corrupt = classifyPrdWideningProjection({
      findings: [currentFinding],
      decisions: [decision], cases: [], evidenceFault: 'corrupt-case-store',
    });
    const unrenderable = classifyPrdWideningProjection({
      findings: [currentFinding],
      decisions: [decision], cases: [caseRecord], evidenceFault: 'unrenderable-projection',
    });

    expect(corrupt.get('NC.9')).toEqual({ kind: 'unresolved', reason: 'corrupt-case-store' });
    expect(unrenderable.get('NC.9')).toEqual({ kind: 'unresolved', reason: 'unrenderable-projection' });
  });
});
