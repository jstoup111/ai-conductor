import type { ShipmentAssociationResult } from './shipment-association.js';
import type { ShipmentEvidenceRefusal, ShipmentEvidenceResult } from './shipment-evidence.js';
import { renderShippedRecord } from './shipped-record.js';

const repairableRecordRefusalCodes = new Set<ShipmentEvidenceRefusal['code']>([
  'shipped-record-missing',
  'shipped-record-malformed',
  'shipped-record-incomplete',
  'shipped-record-slug-mismatch',
  'shipped-record-pr-mismatch',
  'shipped-record-hash-mismatch',
]);

export interface ShipmentReconciliationInput {
  implementationPr: {
    number: number;
    url: string;
  };
  association: ShipmentAssociationResult;
  evidence: ShipmentEvidenceResult;
  expectedRecord: {
    specHash: string;
    shipped: string;
  };
}

export type ShipmentReconciliationPlan =
  | { kind: 'aligned'; writes: [] }
  | { kind: 'repair'; identity: string; writes: [ShipmentRecordWrite] }
  | { kind: 'unresolved'; reason: string; writes: [] };

export interface ShipmentRecordWrite {
  path: string;
  content: string;
}

/**
 * Plans reconciliation only. Publishing the deterministic repair identity is
 * deliberately left to the workflow adapter so this pure decision cannot
 * mutate main, branches, or pull requests.
 */
export function planShipmentReconciliation(
  input: ShipmentReconciliationInput,
): ShipmentReconciliationPlan {
  if (input.association.kind !== 'implementation') {
    return { kind: 'unresolved', reason: input.association.classification, writes: [] };
  }

  const { slug } = input.association;
  if (input.evidence.kind === 'valid') {
    if (
      input.evidence.slug !== slug
      || input.evidence.pr !== input.implementationPr.url
      || input.evidence.recordPath !== `.docs/shipped/${slug}.md`
      || input.evidence.hash !== input.expectedRecord.specHash
    ) {
      return { kind: 'unresolved', reason: 'evidence-identity-mismatch', writes: [] };
    }
    return { kind: 'aligned', writes: [] };
  }

  if (
    input.evidence.kind === 'refusal'
    && repairableRecordRefusalCodes.has(input.evidence.code)
  ) {
    return {
      kind: 'repair',
      identity: `${input.implementationPr.number}/${slug}`,
      writes: [{
        path: `.docs/shipped/${slug}.md`,
        content: renderShippedRecord({
          slug,
          specHash: input.expectedRecord.specHash,
          pr: input.implementationPr.url,
          shipped: input.expectedRecord.shipped,
        }),
      }],
    };
  }

  return {
    kind: 'unresolved',
    reason: input.evidence.kind === 'refusal' ? input.evidence.code : input.evidence.kind,
    writes: [],
  };
}
