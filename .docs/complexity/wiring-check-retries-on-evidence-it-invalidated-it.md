# Complexity: wiring-check-retries-on-evidence-it-invalidated-it

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — one optional additive field on an existing evidence schema |
| External integrations | None new (the probe's existing `gh` waiver path is unchanged) |
| Auth / permission surface | None |
| State machines | None — no step-topology, prerequisite, or ordering change |
| Story count | 3 (recompute-on-stale happy path; two negative paths) |
| Files touched | 1 engine file (`artifacts.ts`) + 1 stale comment (`step-runners.ts`) + tests + `README.md` + `CHANGELOG.md` |
| New runtime code | ~30 lines inside one existing completion predicate, reusing an already-injected seam |

## Rationale

The change is confined to the `wiring_check` branch of `CUSTOM_COMPLETION_PREDICATES` and to
`validateWiringEvidence`, both in `src/conductor/src/engine/artifacts.ts`. It reuses
`CompletionContext.wiringProbe` — an injection seam that already exists and is already wired
unconditionally by the real `Conductor` (`conductor.ts:1014`) — so no new dependency, no new git
call site, and no new configuration. Step topology, enforcement, prerequisites, gate ordering,
the `Wired-into:` contract grammar, and the probe's own analysis are all untouched.
→ **Small.** Architecture-diagram, architecture-review, and conflict-check are skipped for this
tier.

## Issue label corroboration

Issue #897 is filed `size: S`; this independent assessment agrees.
