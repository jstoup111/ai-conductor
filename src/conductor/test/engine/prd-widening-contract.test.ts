import { describe, expect, it } from 'vitest';

import {
  PRD_WIDENING_RECONCILIATION_SCHEMA,
  PRD_WIDENING_RECONCILIATION_VERSION,
  parsePrdWideningReconciliation,
  validatePrdWideningReconciliation,
} from '../../src/engine/prd-widening-contract.js';

describe('PRD widening reconciliation contract', () => {
  const sources = [{ id: 'nc-1' }, { id: 'nc-2' }, { id: 'nc-3' }];
  const cases = [{ id: 'case-1' }, { id: 'case-2' }];

  it('accepts the three closed outcomes, exactly once for every current source', () => {
    expect(validatePrdWideningReconciliation({
      version: PRD_WIDENING_RECONCILIATION_VERSION,
      results: [
        { sourceId: 'nc-1', kind: 'same-case', caseId: 'case-1', reason: 'same behavior' },
        { sourceId: 'nc-2', kind: 'different', reason: 'new behavior' },
        { sourceId: 'nc-3', kind: 'uncertain', candidateCaseIds: ['case-1', 'case-2'], reason: 'evidence is incomplete' },
      ],
    }, sources, cases)).toMatchObject({ ok: true });
  });

  it('uses its engine-owned schema as the matching provider contract', () => {
    expect(PRD_WIDENING_RECONCILIATION_SCHEMA).toMatchObject({
      additionalProperties: false,
      required: ['version', 'results'],
      properties: { version: { const: PRD_WIDENING_RECONCILIATION_VERSION } },
    });
  });

  it.each([
    ['invalid-json', '{not JSON'],
    ['invalid-shape', undefined],
    ['unknown-field', { version: PRD_WIDENING_RECONCILIATION_VERSION, results: [], decision: 'accept' }],
    ['invalid-version', { version: 'v2', results: [] }],
  ] as const)('rejects %s before binding records', (reason, raw) => {
    expect(parsePrdWideningReconciliation(raw, [], [])).toMatchObject({ ok: false, reason });
  });

  it.each([
    ['invalid-source', { sourceId: 'missing', kind: 'different', reason: 'new behavior' }],
    ['duplicate-source', { sourceId: 'nc-1', kind: 'different', reason: 'duplicate' }],
    ['missing-source', undefined],
    ['unknown-case', { sourceId: 'nc-1', kind: 'same-case', caseId: 'invented', reason: 'same behavior' }],
    ['invalid-outcome', { sourceId: 'nc-1', kind: 'same-case', caseId: 'case-1', reason: '   ' }],
  ] as const)('rejects %s without publishing a relationship', (reason, result) => {
    const results = result === undefined
      ? []
      : result.kind === 'different' && result.reason === 'duplicate'
        ? [
            { sourceId: 'nc-1', kind: 'different', reason: 'first result' },
            result,
          ]
        : [result];
    expect(validatePrdWideningReconciliation({
      version: PRD_WIDENING_RECONCILIATION_VERSION,
      results,
    }, [{ id: 'nc-1' }], cases)).toMatchObject({ ok: false, reason });
  });

  it('rejects provider-authored decisions, new case ids, and contradictory candidate bindings', () => {
    const base = { sourceId: 'nc-1', kind: 'same-case' as const, caseId: 'case-1', reason: 'same behavior' };
    for (const result of [
      { ...base, decision: 'accept' },
      { sourceId: 'nc-1', kind: 'different', reason: 'new behavior', newCaseId: 'provider-created' },
      { sourceId: 'nc-1', kind: 'uncertain', candidateCaseIds: ['case-1', 'case-1'], reason: 'ambiguous evidence' },
    ]) {
      expect(validatePrdWideningReconciliation({
        version: PRD_WIDENING_RECONCILIATION_VERSION,
        results: [result],
      }, [{ id: 'nc-1' }], cases)).toMatchObject({ ok: false });
    }
  });

  it('measures identifiers and rationale limits as UTF-8 bytes, including exact limits', () => {
    const maxIdentifier = '界'.repeat(85) + 'a'; // 256 UTF-8 bytes
    const oversizedIdentifier = '界'.repeat(86); // 258 UTF-8 bytes
    expect(validatePrdWideningReconciliation({
      version: PRD_WIDENING_RECONCILIATION_VERSION,
      results: [{ sourceId: maxIdentifier, kind: 'different', reason: 'new behavior' }],
    }, [{ id: maxIdentifier }], [])).toMatchObject({ ok: true });
    expect(validatePrdWideningReconciliation({
      version: PRD_WIDENING_RECONCILIATION_VERSION,
      results: [{ sourceId: oversizedIdentifier, kind: 'different', reason: 'new behavior' }],
    }, [{ id: oversizedIdentifier }], [])).toMatchObject({ ok: false, reason: 'invalid-shape' });

    const maxReason = '界'.repeat(2_666) + 'aa'; // 8,000 UTF-8 bytes
    const oversizedReason = '界'.repeat(2_667); // 8,001 UTF-8 bytes
    expect(validatePrdWideningReconciliation({
      version: PRD_WIDENING_RECONCILIATION_VERSION,
      results: [{ sourceId: 'nc-1', kind: 'different', reason: maxReason }],
    }, [{ id: 'nc-1' }], [])).toMatchObject({ ok: true });
    expect(validatePrdWideningReconciliation({
      version: PRD_WIDENING_RECONCILIATION_VERSION,
      results: [{ sourceId: 'nc-1', kind: 'different', reason: oversizedReason }],
    }, [{ id: 'nc-1' }], [])).toMatchObject({ ok: false, reason: 'invalid-outcome' });
  });
});
