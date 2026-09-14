import { describe, expect, it } from 'vitest';

import { classifyPrdWidening } from '../../src/engine/prd-widening-classification.js';
import { classifyPrdWideningFindings } from '../../src/engine/artifacts.js';

const decision = { id: 'd1', criterion: 'NC.1', authority: 'accept' as const, rationale: 'approved', operator: 'operator', revision: 1, originalCaseId: 'case-1', originalSource: { id: 'source-1', snapshot: 'original' } };

describe('classifyPrdWidening', () => {
  it('requires a fresh same-case relation and explicit authority', () => {
    expect(classifyPrdWidening({ grade: 'OVER_SCOPE', criterion: 'NC.2', relation: { kind: 'same-case', caseId: 'case-1', fresh: true }, decisions: [decision] })).toEqual({ kind: 'accepted', decisionId: 'd1' });
    expect(classifyPrdWidening({ grade: 'OVER_SCOPE', criterion: 'NC.2', relation: { kind: 'same-case', caseId: 'case-1', fresh: false }, decisions: [decision] })).toEqual({ kind: 'unresolved', reason: 'stale-relation' });
    expect(classifyPrdWidening({ grade: 'OVER_SCOPE', criterion: 'NC.2', relation: { kind: 'different', fresh: true }, decisions: [decision] })).toEqual({ kind: 'unresolved', reason: 'uncertain-relation' });
  });

  it('keeps refusals blocking and non-NC rows outside semantic matching', () => {
    expect(classifyPrdWidening({ grade: 'OVER_SCOPE', criterion: 'NC.2', relation: { kind: 'same-case', caseId: 'case-1', fresh: true }, decisions: [{ ...decision, authority: 'refuse' }] })).toEqual({ kind: 'refused', decisionId: 'd1' });
    expect(classifyPrdWidening({ grade: 'OVER_SCOPE', criterion: 'S1.1', decisions: [] })).toEqual({ kind: 'not-blocking', reason: 'non-nc' });
  });

  it('projects the same classification for artifact readers without summary matching', () => {
    const result = classifyPrdWideningFindings(
      [{ criterion: 'NC.99', grade: 'OVER_SCOPE', prdIds: [], evidence: 'A completely reworded reviewer finding.' }],
      [decision],
      new Map([['NC.99', { kind: 'same-case' as const, caseId: 'case-1', fresh: true }]]),
    );
    expect(result.get('NC.99')).toEqual({ kind: 'accepted', decisionId: 'd1' });
  });
});
