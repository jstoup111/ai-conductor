import { describe, expect, it } from 'vitest';

import { classifyShipmentAssociation, recordedShipmentFindings } from '../../src/engine/shipment-association.js';

describe('classifyShipmentAssociation', () => {
  it('publishes recorded scope authority instead of inferring acceptance from reviewer intent', () => {
    const prdAudit = {
      attemptId: 'typed-authority', codeStamp: null, complete: true, diagnostics: [],
      judgment: {
        version: 'v1' as const,
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'OVER_SCOPE' as const,
          evidence: 'src/unplanned.ts:1', rationale: 'The operator refused this visible widening.',
          requirementAssociations: [], evidenceTaskIds: [], intentRelation: 'within' as const,
        }],
        noOwnerObservations: [],
      },
      recordedDispositions: [{
        criterionId: 'S1.1', grade: 'OVER_SCOPE' as const, decision: 'refuse' as const,
        rationale: 'Visible product behavior requires a plan decision.', authority: 'operator@example.test',
      }],
    };
    expect(recordedShipmentFindings({ prdAudit })).toEqual([{
      gate: 'prd_audit', grade: 'OVER_SCOPE', criterion: 'S1.1',
      summary: 'The operator refused this visible widening.', accepted: false,
      decision: 'refuse', rationale: 'Visible product behavior requires a plan decision.', authority: 'operator@example.test',
    }]);
  });

  it('proves an implementation association only with exact metadata and an implementation change', () => {
    expect(classifyShipmentAssociation({
      planStems: ['durable-shipped-records'],
      pr: {
        metadataPlanStems: ['durable-shipped-records'],
        changedPaths: ['src/conductor/src/engine/shipment-evidence.ts'],
      },
    })).toEqual({
      kind: 'implementation',
      slug: 'durable-shipped-records',
    });
  });

  it.each([
    ['spec-only', ['.docs/stories/durable-shipped-records.md'], ['durable-shipped-records']],
    ['plan-only', ['.docs/plans/durable-shipped-records.md'], ['durable-shipped-records']],
    ['docs-only', ['README.md'], []],
    ['record-only-repair', ['.docs/shipped/durable-shipped-records.md'], ['durable-shipped-records']],
    ['zero-match', ['src/conductor/src/engine/shipment-evidence.ts'], ['durable-shipped-record']],
    ['multi-match', ['src/conductor/src/engine/shipment-evidence.ts'], ['durable-shipped-records', 'other-plan']],
  ] as const)('returns a read-only not-applicable diagnostic for %s PRs', (classification, changedPaths, metadataPlanStems) => {
    const input = {
      planStems: ['durable-shipped-records', 'other-plan'],
      pr: { changedPaths, metadataPlanStems },
    };
    const original = structuredClone(input);

    expect({ result: classifyShipmentAssociation(input), input }).toEqual({
      result: {
        kind: 'not-applicable',
        classification,
        diagnostic: `shipment association is ${classification}`,
      },
      input: original,
    });
  });
});
