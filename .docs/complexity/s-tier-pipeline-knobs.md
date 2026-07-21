# Complexity: Small features are cheap through the existing pipeline's own knobs (#668)

**Issue:** #668 — "S-tier bug fixes bypass DECIDE, so gate-satisfying artifacts are hand-stamped after the fact"
**Plan stem:** `s-tier-pipeline-knobs`
**Relates to:** #670 (closed — rejected separate flow, superseded by this), #188
(`adr-2026-07-05-retry-as-escalation-ladder` — the retry/escalation ladder this design leans on),
#715 (`per-dispatch engine rebuild cache` — orthogonal build-perf work, no shared file).

Tier: M

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | None. Reuses the existing `TierOverride` shape and the `DEFAULT_STEP_TIER_OVERRIDES` table (`resolved-config.ts:144-158`); adds table **rows**, no new field or type. |
| Integrations | The change lands in the resolver's existing precedence chain (`resolved-config.ts:234-266`), the metadata table (`model-table-metadata.ts`), the generated `HARNESS.md`, and — for the optional D5 seed — the DECIDE `complexity` step's tier source (`complexity.ts` / `artifacts.ts:1902`). Multi-site but all existing seams. |
| Auth / secrets | None. |
| State machines | None new. Reuses `state.complexity_tier` threading (`conductor.ts:1905`, `:1975-1977`) and the escalation ladder (`escalation.ts:76`) unchanged. |
| Story count | 8 (incl. negative paths). Above the S ceiling of 5. |

## Rationale

**Medium.** A coordinated multi-site change — the tier-override table, the rationale metadata + a
HARNESS.md regen, and an optional label-authoritative tier seed on the complexity step — that must be
reconciled explicitly against two live specs (#188's escalation floor, #715's cache work) and against
the rejected #670 shape. It introduces **no** new mechanism, model, subsystem, or gate reader (which
keeps it out of Large), but the invariant it must protect (no evidence gate is tier-weakened) is
correctness-critical and demands negative-path stories and a pinned tier-invariant gate set — more
than an S one-file tuning tweak. Architecture + conflict-check artifacts are required at M and are
included; the ADR records the "knobs not flows" decision the operator mandated.

Not Large: bounded, additive table edits reusing existing primitives; no schema or CLI-contract break.
