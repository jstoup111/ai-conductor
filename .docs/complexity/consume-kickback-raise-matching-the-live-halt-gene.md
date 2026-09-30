# Complexity: Consume the kickback raise that matches the live halt

Tier: S

Operator scope: small, approved by the operator on 2026-09-28 (delegated); the issue is labeled `size: S`.

The change is bounded to the gate-selection step of one existing sweep function, one additional line and JSON field in the existing inspect view, and passing the live halt generation from the existing inspect command to that view. It reuses the existing ledger schema, halt-generation reader, log dependency, and consumption primitive. It introduces no ledger field, service, event variant, CLI flag, or configuration. Three production files change. Small-tier architecture, conflict, and coherence artifacts are not required.
