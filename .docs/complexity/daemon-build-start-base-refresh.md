# Complexity: daemon-build-start-base-refresh

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | New engine-native pipeline step `base_refresh` (StepName union member) |
| External integrations | None new — reuses existing `resolveBase` (git fetch origin) |
| Auth / permission surface | None — daemon already has the fetch token/creds it uses at ship-time rebase |
| State machines | Adds one ordered BUILD-phase step + its verdict/event; `acceptance_specs`/`build` prereqs re-pointed |
| Story count | 5 (happy + 4 negative/edge: conflict HALT, no-origin degrade, non-daemon no-op, anchor-safety) |
| Files touched | `types/steps.ts`, `engine/steps.ts`, `engine/conductor.ts` (new handler), 4 `DEFAULT_STEP_*`/`STEP_*` Records, tests, CHANGELOG |
| New runtime code | Small — a new handler that composes existing `resolveBase`/`performRebase`/`runGatedRebaseResolution`; no new git logic |

## Rationale

Not S: adding a `StepName` ripples deterministically into every `Record<StepName, …>`
(models, effort, retries, review, artifact globs, rationale) plus the ordered `ALL_STEPS`
sequence, the selector/loopGate wiring, and a new engine handler — TypeScript makes each
omission a compile error, so the surface is bounded but real. Not L: no new git
primitive, no new external system, no product/UX surface, no schema migration; the core
mechanic is a thin composition of three already-shipped, already-tested functions
(`resolveBase`, `performRebase`, `runGatedRebaseResolution`) reused verbatim. → **M**.

## Downscope option (S)

If the reviewer prefers minimal surface, an inline variant runs the same fetch+rebase
once at build entry inside the existing build handler (no new `StepName`, no config-map
entries) at the cost of a discrete verdict/event and selector/loopGate auditability. The
plan commits to the discrete step; this is the explicit fallback if surface is a concern.
