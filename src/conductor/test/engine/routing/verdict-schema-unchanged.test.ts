// Covers: task:27
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import schemaDigests from '../../fixtures/routing/gate-verdict-schema-digests.json';
import {
  AS_BUILT_VERDICT_CONTRACT_VERSION,
  AS_BUILT_VERDICT_SCHEMA,
} from '../../../src/engine/as-built-contract.js';
import {
  PRD_AUDIT_JUDGMENT_CONTRACT_VERSION,
  PRD_AUDIT_JUDGMENT_SCHEMA,
} from '../../../src/engine/prd-audit-contract.js';
import {
  RESIDUE_ROUTING_CALL_CONTRACT_VERSION,
  runResidueRoutingCall,
} from '../../../src/engine/routing/residue-routing-call.js';

const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('gate verdict contracts around residue routing', () => {
  it('keeps the gate verdict schemas and versions unchanged after the routing call', async () => {
    const routing = await runResidueRoutingCall({
      items: [{ itemId: 'residue-1', summary: 'An already-admitted residue item.' }],
      declaredPositions: [1],
      judge: async () => ({
        success: true,
        output: JSON.stringify({
          version: RESIDUE_ROUTING_CALL_CONTRACT_VERSION,
          items: [{ itemId: 'residue-1', child: 1, candidates: [1], rationale: 'The only declared child can repair it.' }],
        }),
      }),
    });

    expect({
      routing,
      sourceCommit: schemaDigests.sourceCommit,
      prdAudit: {
        version: PRD_AUDIT_JUDGMENT_CONTRACT_VERSION,
        schemaSha256: sha256(PRD_AUDIT_JUDGMENT_SCHEMA),
      },
      asBuilt: {
        version: AS_BUILT_VERDICT_CONTRACT_VERSION,
        schemaSha256: sha256(AS_BUILT_VERDICT_SCHEMA),
      },
    }).toEqual({
      routing: {
        kind: 'routed',
        answers: [{
          kind: 'valid', itemId: 'residue-1', child: 1, candidates: [1], rationale: 'The only declared child can repair it.',
        }],
      },
      sourceCommit: '8aedc143fa',
      prdAudit: { version: 'v1', schemaSha256: schemaDigests.prdAudit.schemaSha256 },
      asBuilt: { version: 'v2', schemaSha256: schemaDigests.asBuilt.schemaSha256 },
    });
  });
});
