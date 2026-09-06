# Complexity: Record land-gate rejections on the event spine

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one member to an existing discriminated union, one row to a total sink record, one error subclass plus a pure classifier, a mechanical gate-identifier pass over the rejection sites of a single file, and a short emit block copied from an existing one-shot command. It introduces no service, no schema migration, no storage, no new reader, and no new telemetry channel — the event rides the existing emitter, the existing persister, and the existing ledger format. Gate behaviour is untouched: no rejection is added, removed, or reworded in a way that changes what lands. Backfill, reporting, and any change to gate strictness are excluded. Small-tier architecture, conflict-check, and coherence artifacts are not required.
