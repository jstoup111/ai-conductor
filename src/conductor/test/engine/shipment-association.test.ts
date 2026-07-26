import { describe, expect, it } from 'vitest';

import { classifyShipmentAssociation } from '../../src/engine/shipment-association.js';

describe('classifyShipmentAssociation', () => {
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
