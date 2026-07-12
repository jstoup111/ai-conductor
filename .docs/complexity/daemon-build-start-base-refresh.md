# Complexity: daemon-build-start-base-refresh

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — one new optional boolean config key, no new `StepName` |
| External integrations | None new — reuses existing `resolveBase` (git fetch origin) |
| Auth / permission surface | None — daemon already has the fetch creds it uses at ship-time rebase |
| State machines | None — no change to `ALL_STEPS`; a pre-BUILD guard runs the existing rebase primitives once per run |
| Story count | 5 (happy + 4 negative/edge: conflict HALT, no-origin degrade, default-off/non-daemon no-op, anchor-safety) |
| Files touched | `types/config.ts` (+1 key), `engine/config.ts` (validation), `engine/resolved-config.ts` (resolver), `engine/conductor.ts` (pre-BUILD hook), tests, CHANGELOG |
| New runtime code | Small — one config key + a guard that composes existing `resolveBase`/`performRebase`/`runGatedRebaseResolution`; no new git logic, no config-map churn |

## Rationale

**S, not M.** The config-driven design (operator-mandated) drops the new-`StepName`
approach entirely: no `ALL_STEPS` entry, no `Record<StepName, …>` entries across the
model/effort/retries/review/artifact-glob/rationale maps, no model-table regeneration.
The change is a single optional boolean config key (`build_start_base_refresh`) validated
and resolved exactly like the existing `auto_restart_on_stale_engine` boolean, plus a
small daemon-only guard at the BUILD boundary that reuses three already-shipped, tested
functions verbatim. No new external system, no schema migration, no product/UX surface.
The blast radius is a handful of localized edits behind an absent-by-default flag. → **S**.
