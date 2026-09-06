# Complexity: Report the PRD-input gate surface accurately in rebase events

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to two engine modules that already collaborate: the pure gate-surface classifier and the pure payload projection inside the rebase event emitter. It adds no module, no event variant, no field, no configuration key, no storage, and no telemetry channel; it reuses the existing delta partition, the existing document-input prefix list, and the existing emitter call sites. Gate decisions are unchanged by construction. The only other edits are the two existing test expectations that encode the current fall-through. Small-tier architecture, conflict-check, and coherence artifacts are not required.
