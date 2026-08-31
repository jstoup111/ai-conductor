# Complexity: custom-steps-crash-the-conductor-with-step-artifac

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None (one gate condition in `Conductor.run` changes its predicate) |
| Story count | 3 (guarded contract reads, gate realignment, regression coverage through the crashing path) |
| Files touched | 2 production files (`src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/conductor.ts`) plus tests |
| New runtime code | One accessor for step artifact contracts; one predicate for "declares reviewable artifacts" |

## Rationale

Single-cause engine defect with a verified mechanism: three raw indexes into a built-in-only
map (`artifacts.ts:358`, `:377`, `:592`) and one over-wide gate (`conductor.ts:1716`/`:10836`)
that routes config-declared custom steps into the crashing read in non-auto mode. No new
integrations, models, or schema; no ADR amendment (adr-2026-07-25 custom completion artifacts
is preserved). → **Small.** Architecture-diagram, architecture-review, conflict-check, and
coherence-check are skipped for this tier.
