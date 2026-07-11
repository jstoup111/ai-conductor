# Complexity: Finish-step completion becomes engine machinery

Tier: M

## Rationale

- Touches the engine core: finish-step dispatch path in `conductor.ts` gains a pre-gate
  engine-performed repair action; `artifacts.ts` finish predicate gains a draft check and an
  injectable `GhRunner` seam (replacing hardcoded `makeProductionGh()`).
- Relocates existing machinery (`rehabilitateHaltPr` from the daemon post-run tail into the
  finish step) and extends it with a deterministic retitle-floor — an ADR responsibility-split
  amendment (adr-2026-07-03), warranting architecture review.
- Rewrites two SKILLs (`finish`, `pr`) from instruction to documentation-of-engine-behavior,
  resolving a live contradiction between them (draft-flip ownership).
- Requires a real test seam against gh for the rehab + gate branches (#368 gap).
- No new external integration, auth surface, data model, or state machine; single repo,
  moderate story count (~4–6). Not Small (cross-cutting gate + engine + skill change), not
  Large (no new subsystem).
