# Complexity: FINISH validates shipped-record slug instead of file existence

Tier: S

Rationale: one production observer (`finish-publication-production.ts` shippedRecord) changes to reuse the existing `resolveShipmentIdentity` resolver and parse one frontmatter field; the coordinator's `malformed → invalid → invalid_shipped_record` path already exists. No new modules, schemas, ADRs, or cross-component contracts.
