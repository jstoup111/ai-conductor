# Complexity: Provider-free step completions are not dispatches

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is one decision rule inside the single shared dispatch-metering projection, plus the two existing readers' regression proofs. Exactly one production file changes: `src/conductor/src/engine/dispatch-metering.ts`. Both consumers — the shipped-record cost rollup and the OTel visualizer — already call that projection, so no wiring, no new seam, and no second code path is introduced. The event schema, the emitter, the `## Cost` block format, the OTel instrument set, and the KPI partial-feature policy are all unchanged.

No architecture, conflict-check, or coherence artifact is required at this tier. No ADR is added and none is amended: the governing per-feature cost-rollup decision records `dispatches` as a count without defining a provider-free completion as one, and the three-valued metering decision governs cost absence rather than dispatch selection, so neither decision is contradicted by narrowing selection to records that carry provider evidence.

No release migration block is required: no CLI surface, settings schema, hook wiring, or skill symlink target is touched.
