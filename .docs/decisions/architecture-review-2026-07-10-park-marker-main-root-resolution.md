# Architecture Review: Park-Marker Main-Root Resolution (#486)
**Date:** 2026-07-10
**Mode:** Lightweight (tier M, technical track) — feasibility + alignment
**Input reviewed:** explore output + approved approach (stories/plan do not exist yet);
approved diagram `.docs/architecture/2026-07-10-park-marker-main-root-resolution.md`
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility** — pure Node + git subprocess; `git rev-parse --git-common-dir`
  is already used in this codebase (`memory-store.ts:81`, `install-freshness.ts:123`,
  `git-hook-assets.ts`) — verified, no new dependencies.
- **Prerequisites** — none. Marker layout/body unchanged; no schema, no config, no
  settings.json surface. The reconciliation sweep IS the data migration and runs
  mechanically in the daemon.
- **Integration surface** — single module seam (`park-marker.ts`) consumed by
  conductor auto-park, daemon-cli sweep gate/dashboard, park CLI. All call sites keep
  their signatures; only the primitive's internal anchoring changes. Verified all
  non-test call sites via grep (conductor.ts:1855, daemon-cli.ts:720/1051/1088/1164,
  daemon-park-cli.ts, daemon-rekick.ts:117 [injected dep]).
- **Performance** — one git subprocess per unique `startDir`, memoized per process.
  Sweeps/dashboards check per-slug against the same root → one resolution total. Negligible.
- **Worktree isolation** — this feature is *about* the worktree/main boundary; the fix
  centralizes it. Parallel worktrees share one `.daemon/parked/` (intended semantics —
  a park is a repo-level stop signal). `wx` create keeps concurrent writers safe.

## Alignment

- **Single-source pattern** — park-marker.ts already exists precisely to be the single
  source for this path ("spelled once instead of duplicated"); putting resolution inside
  it completes that intent. Matches halt-marker.ts precedent.
- **Deterministic-first (CLAUDE.md)** — machinery-level fix; no prompt/skill discipline
  involved; fails (falls back) at the point of resolution with a log.
- **Fail-open/fail-closed semantics preserved** — `isOperatorParked` keeps
  fail-toward-parked on read anomalies; resolution failure degrades to the given root
  (today's exact behavior), never a new failure mode.
- **No condemned-path conflict** — no APPROVED ADR anchors park markers to the worktree;
  the stranded location is a bug, not a decision (checked `.docs/decisions/` for park/halt
  ADRs).
- **CLI contract** — `daemon park/unpark` verbs keep argv shape; output gains the absolute
  marker path (additive). `validateSlug` moves to the resolved root — stricter, catches
  the typo'd-slug case in worktrees identically (plans + worktrees both exist at main).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Marker exists at BOTH roots post-deploy | Data | Medium | Medium | Reconciliation: main copy wins (wx first-writer semantics), worktree copy deleted; idempotent |
| Resolution fallback fires inside a real repo (git broken mid-run) | Technical | Low | Medium | Fallback = pre-#486 behavior + logged; never worse than today |
| Unpark counter reset targets a removed worktree | Technical | Low | Low | Fall back to resolved root's `.pipeline/` (pre-#486 location); log the skip |
| Memoized root goes stale (repo moved mid-process) | Technical | Very Low | Low | Roots don't move under a live daemon; cache is per-process only |

## ADRs Created

- `adr-2026-07-10-park-marker-main-root-resolution.md` (APPROVED by operator 2026-07-10)

## Conditions

None.
