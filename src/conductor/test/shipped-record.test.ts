import { describe, expect, it } from 'vitest';

import { recordedShipmentFindings } from '../src/engine/shipment-association.js';
import type { PersistedAsBuiltVerdict } from '../src/engine/as-built-verdict-store.js';

const policy = {
  reachability: { enabled: true, reason: 'all tiers' }, planGap: { enabled: true, reason: 'all tiers' },
  adrCompliance: { enabled: true, reason: 'approved ADRs present' }, diagramDrift: { enabled: true, reason: 'diagrams present' },
} as const;

function envelope(verdict: PersistedAsBuiltVerdict['verdict'], recordedFindings: PersistedAsBuiltVerdict['recordedFindings'] = []): PersistedAsBuiltVerdict {
  return { attemptId: 'attempt', codeStamp: 'head', policy, verdict, recordedFindings };
}

describe('shipped-record recorded review findings', () => {
  it('reads a delivered plan gap from the typed verdict, never a report', () => {
    expect(recordedShipmentFindings({ asBuilt: envelope({ version: 'v1', verdict: 'PLAN_GAP', outcomeDelivered: true, affectedOutcome: 'The release remains observable.', reachability: [], driftNotes: [] }) })).toEqual([
      { gate: 'architecture_review_as_built', grade: 'PLAN_GAP', outcome: 'The release remains observable.', summary: 'The release remains observable.' },
    ]);
  });

  it('keeps remediated findings additive with a delivered plan gap', () => {
    expect(recordedShipmentFindings({ asBuilt: envelope({ version: 'v1', verdict: 'PLAN_GAP', outcomeDelivered: true, affectedOutcome: 'Outcome', reachability: [], driftNotes: [] }, [{ id: 'AB-5', class: 'REMEDIABLE', reference: { kind: 'adr-decision', stem: 'adr-boundary', decision: 5 }, summary: 'Use the typed reader.', outcome: 'remediated' }]) })).toEqual(expect.arrayContaining([
      { gate: 'architecture_review_as_built', finding: 'AB-5', class: 'REMEDIABLE', governingClause: 'adr-boundary decision 5', summary: 'Use the typed reader.', outcome: 'remediated' },
      { gate: 'architecture_review_as_built', grade: 'PLAN_GAP', outcome: 'Outcome', summary: 'Outcome' },
    ]));
  });

  it('does not admit a reviewer-written report without a typed verdict', () => {
    expect(recordedShipmentFindings({ asBuilt: undefined, prdAudit: '## Recorded Findings\n\n```json\n{"findings": []}\n```' })).toEqual([]);
  });
});
