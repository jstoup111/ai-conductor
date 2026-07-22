# Complexity Assessment: Remove #773 dead evidence-gate residue

**Source:** jstoup111/ai-conductor#792
**Plan stem:** `remove-773-dead-evidence-gate-residue-filedirmatch` (matches `.docs/plans/`)

Tier: S

## Signals

| Signal | Value | Notes |
|---|---|---|
| New data models | 0 | Purely subtractive |
| New integrations | 0 | None |
| Auth / permissions | 0 | None |
| State machines | 0 | None |
| New product surface | 0 | Technical track; no user-facing change |
| Story count | ~4 | Small, cohesive |
| Net change | Deletion + 1 comment edit + doc/changelog | No new design |

## Rationale

This is a pure dead-code removal grounded entirely in grep evidence: three confirmed-dead
production symbols plus their now-orphaned knock-ons (`loadRewriteMap`, two orphaned types,
one file that becomes empty), one stale comment corrected, and the removal/trim of the tests
that asserted the deleted evidence gate. No new models, integrations, auth, state machines,
or product requirements are introduced — nothing new is designed. The only judgment call
(removing #535's Story 5/6 read-side acceptance coverage because its consumer is dead) is
fully resolved during discovery and captured explicitly in the stories/plan.

Execution spans several files (6 production, 4 test, 1 doc, CHANGELOG), but every edit is a
deletion of confirmed-dead code or a comment/doc correction. Blast radius is moderate but the
design surface is nil.

## Consequence for DECIDE steps (per /engineer)

Tier **Small** ⇒ SKIP `/architecture-diagram`, `/architecture-review`, and `/conflict-check`
(no new architecture; the one cross-feature interaction with #535 was fully settled in
`/explore`). Run `/explore` → complexity → `/stories` → `/plan`. No PRD (technical track).
