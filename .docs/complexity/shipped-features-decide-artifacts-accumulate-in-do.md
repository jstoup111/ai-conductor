# Complexity: Operator CLI prunes shipped features' DECIDE artifacts

Tier: M

Rationale: Operator-confirmed 2026-10-15. One new operator-run CLI subcommand (`ai-conductor docs-prune`) plus one exported retention-policy constant. Publication reuses the existing guarded repair-publication pattern (`shipment-reconciliation.ts`, `makeProductionRepairPublisher`) and the guarded tracker read for open-PR file lists. Reporting is one additive `ConductorEvent` variant. Record-only repair (`shipment-evidence-cli.ts` `expectedReconciledRecord`) and the shipment audit gain one shared last-carrier plan lookup for pruned stems. No change to `spec_hash`, shipment evidence, the protected-artifact seal, or the finish path: pruning only touches stems whose shipped record is already on main, and in-flight features already tolerate base-inherited deletions (#1752). Two existing ADRs (committed halt record D7, retro removal D5) receive amendment notes.
