# Architecture Review: Parked-Feature Reconciliation Sweep (#1060)
**Date:** 2026-07-27
**Stories reviewed:** pre-stories full pass (technical track, Medium tier — lightweight mode)
**Verdict:** APPROVED
**Revised:** 2026-07-27 after conflict-check (see `.docs/conflicts/2026-07-27-parked-feature-reconciliation-1060.md`) and operator direction: full hybrid now — auto-cleanup default ON behind `reconcile_parked_auto_cleanup`; deletion preconditions expanded (record-on-main, in-flight guard, unpark-last); operator-park PRD/FR-7 amended in this same spec diff; record creation delegated to the ST-916 repair-PR seam.

## Feasibility

- **Stack:** No new dependencies. Reuses existing seams, all verified in-repo: sweep dep-injection (`daemon.ts` `sweepBestEffort`, optional `reconcileHaltPrs?` dep pattern), park markers (`park-marker.ts` — `listOperatorParkedSlugs`, `removeOperatorPark`, provenance readers), shipped records (`shipped-record.ts` idempotent `writeShippedRecord`; CLI accepts `--pr <url|local>`), ancestry checks (`merge-base --is-ancestor` idiom in `push-evidence.ts:70-85`), issue state (`TrackerClient` / `GetIssueState` shape in `engineer/intake/reconcile-closed-issues.ts:24`), CLI dispatch (`daemon-park-cli.ts` `detectDaemonParkCommand` pattern), dashboard parked overlay (`daemon-cli.ts` `renderStartupDashboard`, `daemon-dashboard.ts` `ParkedEntry`).
- **Prerequisites:** none — no migrations, no config schema change. `origin/main` fetch state is used as-is; unfetchable remote → per-slug no-op.
- **Integration surface:** daemon loop, park-marker, shipped-record, dashboard, CLI dispatch — 5 seams, all additive; no third-party surface beyond the existing `gh` capability.
- **Data implications:** the only destructive operation is worktree+branch removal, gated on an ancestry proof re-verified inside the cleanup helper at the moment of deletion. Worktree `.pipeline/` state is lost on removal, which is acceptable ONLY in the merged case (work already on main) — consistent with CLAUDE.md rule 3.
- **Performance:** one `merge-base` per parked slug per tick (cheap, local); issue-state lookups only for the non-ancestor subset, and outcome-cached to avoid re-querying `gh` every idle tick.

## Alignment

- **Deterministic-where-possible:** the whole feature is engine machinery; no LLM involvement. Directly implements the "merge→shipped-record reconciler" and "guarded delete wrapper" CLAUDE.md names as missing.
- **Pattern consistency:** sweep module mirrors `halt-pr-reconciliation.ts` (injected log, outcome cache, summary suppression, never-throw); CLI verb mirrors `daemon park|unpark` dispatch; dashboard change extends the existing `ParkedEntry` overlay rather than adding a new surface.
- **Domain boundaries:** slug→issue resolution uses only the committed intake marker (`parseIntakeSourceRef`); no slug-string parsing.
- **State management:** classification outcomes are an explicit closed set (merged / orphan / normal-parked / unclassifiable); no boolean flags.
- **Worktree isolation:** the sweep runs only in the daemon's main-root context and touches only `.daemon/parked/`, `.docs/shipped/`, and the single named worktree/branch being reconciled.
- **Prior art check:** `durable-shipped-record-enforcement-and-backfill-916-936` covers shipped-record enforcement at ship time; it does not reconcile parked features. `reconcile-closed-issues.ts` reconciles the intake ledger, not parks. No conflict.

## Domain Integrity

Handled per-cycle by TDD domain review (Medium tier). Pre-check note: the classification result should be a discriminated union, not stringly-typed.

## Wiring Surface

| New surface | Wired from (design-time commitment) |
|---|---|
| `reconcileParkedFeatures` module | injected as an optional dep in `daemon-cli.ts` daemon boot wiring (same slot style as `reconcileHaltPrs`, ~`daemon-cli.ts:1581`), invoked by `daemon.ts` `sweepBestEffort()` at startup and each idle tick |
| Guarded cleanup helper (`reconcileMergedPark`) | called by the sweep module and by the new CLI verb; lives beside `park-marker.ts` |
| `conduct daemon reconcile-parked <slug>` verb | detected pre-boot in `src/index.ts` alongside `detectDaemonParkCommand` (`daemon-park-cli.ts` pattern) |
| Orphan dashboard annotation | `daemon-cli.ts` `renderStartupDashboard` parked overlay → `daemon-dashboard.ts` `ParkedEntry` rendering |
| Sweep log lines `[parked-reconciliation] …` | emitted through the daemon's injected tee log (console + `daemon.log`) |
| `reconcile_parked_auto_cleanup` config key (boolean, default `true`) | validated in `config.ts` (hard error on non-boolean), read at daemon startup in `daemon-cli.ts` boot wiring, gates whether the sweep invokes the cleanup helper |
| `bin/conduct` subcommand registration for `daemon reconcile-parked` | added to the known-subcommand forwarding list per the unknown-subcommand guard stories |

Early overlap scan: run `conduct-ts overlap-scan` over `src/conductor/src/engine/daemon.ts`, `daemon-cli.ts`, `park-marker.ts`, `daemon-dashboard.ts`, `daemon-park-cli.ts`, `src/index.ts` before `/plan` (advisory).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Ancestry check miswired → wrongful branch delete | Data | Low | High | Helper re-verifies ancestry itself immediately before deletion; single-slug-only API; acceptance test proves a not-ancestor branch is never deleted |
| Stale `origin/main` (no fetch) → merged park not reconciled | Technical | Medium | Low | Acceptable: fail toward inaction; next pass after any fetch reconciles |
| `gh` rate limits from per-tick issue lookups | Integration | Medium | Medium | Outcome cache: only re-query slugs whose git classification changed; orphan verdicts sticky per run |
| Park marker without worktree/branch (already hand-cleaned) | Technical | Medium | Low | Helper treats missing worktree/branch as already-done steps (idempotent), still writes shipped record only if branch existed or record already present; else marks unclassifiable |
| Auto-parked (vs operator-parked) features reconciled unexpectedly | Technical | Low | Low | Ancestry proof makes provenance irrelevant for safety; provenance is preserved in the log line |

## ADRs Created

- `adr-2026-07-27-ancestry-proven-park-reconciliation` — APPROVED

## Conditions

None.
