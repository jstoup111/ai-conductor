# PRD: Daemon Halt-Reconciliation (Startup Dashboard + Main-Advance Re-Kick)

**Date:** 2026-06-28
**Status:** Approved

## Problem / Background

The daemon builds merged specs autonomously, parking features that halt (`.pipeline/HALT`)
for a human. PR #109 made the durable `.pipeline/HALT` marker authoritative at discovery, so a
restart no longer blindly re-dispatches and clobbers parked work. That fix is correct but
leaves two gaps the operator (James, driving the daemon remotely) feels in practice:

1. **No visibility on restart.** When the daemon starts, it begins dispatching with no summary
   of what state it inherited. Halted features, half-built worktrees, and the eligible backlog
   are invisible until something happens. The operator can't tell, at a glance, what is parked
   and why.

2. **Halted work only resumes on manual marker clearance.** A feature halted on a rebase
   conflict, or on a prd-audit gap, stays parked until a human deletes `.pipeline/HALT` — even
   after the base branch advances with commits that may unblock it (a merged fix, an amended
   spec, a moved base that now rebases cleanly). The operator must babysit clearance by hand.

This feature closes both gaps: a full inherited-state dashboard at startup, and automatic
re-kick of halted work whenever the base branch actually advances.

## Goals & Non-Goals

**Goals**
- On startup, before any dispatch, print a complete, grouped dashboard of inherited persisted
  state (halted, in-progress, eligible, processed) to both stdout and `daemon.log`.
- Automatically re-kick **every** halted feature when the base branch advances — whether the
  advance is observed live during a run, or happened while the daemon was down.
- Re-use PR #109's discovery-time park / un-park machinery rather than adding a parallel
  dispatch path.
- Bound re-kick to genuine base-SHA advances so it cannot loop on every poll, and so a single
  commit re-kicks a given feature at most once.

**Non-Goals**
- Classifying halts (rebase-retryable vs. human-DECIDE) and re-kicking selectively. The
  operator explicitly chose the aggressive "all halts clear + retry" policy and accepted that
  an unresolved human-DECIDE gap may immediately re-halt.
- Changing the conductor's finish-time rebase mechanism, gate logic, or HALT-writing behavior.
- External notification (push, email) of dashboard or re-kick events — log + stdout only.
- Persisting the in-progress/eligible breakdown anywhere; the dashboard is computed fresh and
  printed, not stored.
- A dedicated "play-forward" / reconciliation **skill**. Re-kick is a deterministic mechanism
  (rebase-first, then re-verify); the judgment of whether a halt is resolved and where a residual
  gap routes already lives in the gate loop and `/remediate`. Re-kick composes with those, it does
  not re-implement them. (ADR-013.)

## Users / Personas

- **The operator (daemon owner).** Restarts the daemon, watches `daemon.log`, merges specs and
  fixes to the base branch. Wants to (a) see what the daemon inherited the instant it starts,
  and (b) have parked work automatically retried when they land a commit that should unblock it,
  without hand-clearing markers.

## Functional Requirements

### Feature 1 — Startup persisted-state dashboard

- **FR-1:** On daemon startup, **before dispatching any feature**, the daemon scans every
  worktree under `.worktrees/*/` and the `.daemon/processed/` ledger and prints a single
  grouped dashboard. The dashboard is written to **both** stdout and `daemon.log` (via the
  existing `log()` sink).
- **FR-2:** The dashboard contains exactly four groups, each with a count and member lines:
  - **HALTED** — each worktree with a live `.pipeline/HALT` marker, shown as `slug` + the first
    line / summary of the HALT reason read from the marker.
  - **IN-PROGRESS** — each worktree that has a `conduct-state.json` but **no** `.pipeline/HALT`
    and is **not** in the processed ledger, shown as `slug` + the last meaningful step (the
    latest step whose value is `in_progress`, else the furthest `done`/`failed` step).
  - **ELIGIBLE** — slugs `discoverBacklog` returns as build-ready this scan that are neither
    halted nor processed, shown as a slug list.
  - **PROCESSED** — the count of entries in the `.daemon/processed/` ledger (count only).
- **FR-3 (edge):** With no worktrees and an empty ledger, the dashboard still prints with all
  four groups at count `0` and does not error. A worktree with a malformed/unreadable
  `conduct-state.json` or an empty `.pipeline/HALT` is tolerated (best-effort): it still appears
  in its group with the reason/step shown as `unknown`. A scan failure for one worktree never
  aborts the dashboard or startup.

### Feature 2 — Main-advance re-kick of halted work

- **FR-4:** The daemon resolves the base-branch tip SHA (`git rev-parse <discovery-ref>`, where
  `<discovery-ref>` is what `resolveDiscoveryRef` already returns — `origin/<default>` or the
  local base) and persists the last-seen value to `.daemon/last-base-sha`.
- **FR-5:** On startup, after printing the dashboard, the daemon compares the **persisted**
  last-seen SHA against the **current** resolved base SHA. If they differ (the base advanced
  while the daemon was down), this counts as a main update and triggers a re-kick sweep
  (FR-7). If `.daemon/last-base-sha` is absent (first ever run) the daemon initializes it to
  the current SHA and does **not** re-kick.
- **FR-6:** During a run, on each idle refresh that resolves the discovery ref, the daemon
  re-reads the base SHA; if it advanced versus the last-seen value, it triggers a re-kick sweep
  (FR-7).
- **FR-7 (re-kick sweep):** For **every** worktree with a live `.pipeline/HALT` marker, the
  daemon: (a) logs the slug and the HALT reason, (b) **if the worktree has an in-progress rebase**
  (a 9.0 rebase-conflict HALT leaves one — detected via the worktree's `.git/rebase-merge` or
  `.git/rebase-apply` state), runs `git rebase --abort` in the worktree (best-effort, logged;
  a no-op when no rebase is in progress) so the worktree returns to a clean checkout of its branch
  tip before re-dispatch, (c) preserves the reason by renaming the marker to `.pipeline/HALT.cleared`
  (overwriting any prior `.cleared`), (d) removes `.pipeline/HALT`, and (e) records the triggering
  SHA as that feature's last-rekick SHA. After the sweep it updates the last-seen SHA (in memory and
  in `.daemon/last-base-sha`) so the same advance triggers at most one sweep. Aborting the paused
  rebase is what makes re-kick safe and useful for rebase-conflict halts: re-dispatch then runs
  9.0's rebase step **fresh** against the advanced base (which may now apply cleanly) instead of
  re-entering a half-finished rebase.
- **FR-8:** Re-kick performs **no direct dispatch**. Clearing `.pipeline/HALT` makes
  `isHalted(slug)` return false; the existing discovery + un-park path (PR #109) re-dispatches
  the feature on the next poll through the normal machinery. A feature parked only in memory
  (halted earlier this run) and one parked solely by a prior run's on-disk marker are both
  re-dispatched identically once their marker is gone.
- **FR-9 (loop bound):** A feature that re-halts at the **same** base SHA is **not** re-kicked
  again at that SHA — guarded by its recorded last-rekick SHA. Only a further base-SHA advance
  re-kicks it. This holds across the startup sweep and live-refresh sweeps within one run.
- **FR-10 (edge):** Base-SHA resolution degrades gracefully. When `resolveDiscoveryRef` falls
  back to the local base (offline, no origin, unset HEAD) the daemon uses that SHA; a base SHA
  that cannot be resolved at all is treated as "no advance" (no sweep) and never crashes the
  poll loop. A failure clearing one worktree's marker is logged and skipped; the sweep
  continues with the rest.
- **FR-11 (idempotent persistence):** Writing `.daemon/last-base-sha` is atomic-enough that a
  crash mid-write cannot wedge detection: an unreadable/empty file is treated as "absent"
  (FR-5 first-run path), never as a spurious advance.
- **FR-12 (resume rebase-first / play-forward):** A re-kicked feature must integrate the advanced
  base **before** re-running the gate it halted on. Re-kick resets the feature's resume point so
  9.0's rebase-onto-latest step runs first; the pending gate then re-verifies on the new base. A
  gate-failure halt (e.g. prd-audit) therefore does **not** re-run against the stale base and
  re-halt without the unblocking commit; a rebase-conflict halt already satisfies this (the aborted
  rebase re-runs first). The re-kick mechanism does not reason about whether the halt is resolved or
  where a residual gap routes — that stays with the normal gate loop and `/remediate`. (Negative:
  if 9.0's rebase-onto-latest re-conflicts on the new base, the feature re-halts via 9.0's existing
  path and is bounded by FR-9, not re-kicked again at the same SHA.)

## Non-Functional Requirements

- **Non-destructive:** Re-kick never discards a HALT reason — it is preserved to
  `.pipeline/HALT.cleared` before the marker is removed (supports post-mortem and FR-2's
  reason display on the next run).
- **Best-effort / crash-safe:** Neither the dashboard scan nor the re-kick sweep may throw out
  of the poll loop. All filesystem and git reads are guarded; partial failure degrades to
  `unknown`/skip, never abort.
- **Observable:** Every dashboard render and every re-kick (slug + reason + triggering SHA) is
  logged to `daemon.log`.
- **Unit-testable:** SHA resolution, marker scanning, and clearing are injected primitives
  (mirroring the existing `FeatureRunnerDeps`/`DaemonDeps` seams) so the state machine is
  testable without git, a real worktree, or the network — consistent with the existing
  `daemon.test.ts` pure-core style.

## Acceptance Criteria / Success Metrics

- All FRs covered by passing tests in the existing `vitest` suite; harness integrity suite
  green; `npm run build` clean.
- Startup prints the four-group dashboard (verified against a fixture with a halted, an
  in-progress, an eligible, and processed entries) to both sinks.
- A simulated base-SHA advance (live and across-restart-via-persisted-SHA) clears all HALT
  markers, and the cleared features re-dispatch through the PR #109 path; the same SHA does not
  re-kick a feature that re-halts (FR-9).
- A restart with **no** base advance prints the dashboard and leaves all markers intact (PR #109
  behavior preserved).
- Offline / no-origin startup prints the dashboard and performs no spurious re-kick (FR-10).

## Scope

### In Scope
- Startup dashboard scan + render (Feature 1).
- Base-SHA tracking with persistence to `.daemon/last-base-sha` (startup + live).
- Re-kick sweep via HALT-marker clearance, reason preservation, per-feature last-rekick SHA.
- New injected primitives + wiring in `daemon.ts` / `daemon-deps.ts` / `daemon-cli.ts`.
- Tests + CHANGELOG + any README/`src/conductor/README.md` updates for the new daemon behavior.

### Out of Scope
- Halt classification / selective re-kick (rejected per operator decision).
- Changes to gate logic, the conductor loop, finish-time rebase, or HALT-writing.
- External notifications.
- A persisted/queryable dashboard API (the dashboard is printed, not stored).

## Key Decisions & Rationale

- **Clear-the-marker as the re-kick mechanism.** Removing `.pipeline/HALT` is sufficient to
  re-dispatch through PR #109's discovery park / un-park path, so Feature 2 needs no parallel
  dispatch logic and cannot diverge from the canonical dispatch discipline. This is the
  load-bearing composition choice.
- **Persist last-base-sha to catch downtime advances.** The operator chose that a base advance
  during downtime counts as "an update to main" and should re-kick on restart. This does NOT
  reintroduce the PR #109 bug: a restart with no advance still honors all markers; re-kick fires
  only on a *detected, triggered* advance, never as a blind re-dispatch.
- **Aggressive all-halts policy, bounded by SHA.** The operator accepted that an unresolved
  human-DECIDE gap may re-halt. The loop is bounded because re-kick fires only on a genuine
  base-SHA advance and a per-feature last-rekick SHA prevents re-clearing at the same SHA — so
  the worst case is one wasted build per halted feature per base commit, not a tight loop.
- **Trigger on base-SHA advance, not every poll.** `resolveDiscoveryRef` already fetches origin
  only on idle refresh; reading the ref's SHA there is the natural, low-cost detection point.
- **Abort a paused rebase before clearing a rebase-conflict HALT (FR-7b).** A Phase 9.0
  rebase-conflict HALT leaves the worktree mid-rebase. Re-dispatching over a paused rebase risks
  `fatal: rebase already in progress` and the recurring real-repo rebase corruption (b08f534), so
  the sweep aborts the paused rebase first, returning the worktree to a clean tip. Re-dispatch then
  runs 9.0's rebase fresh against the advanced base — the retry the operator actually wants.
  (Conflict-check 2026-06-28, Option 1.) Trade-off accepted: aborting discards any *partial* manual
  resolution in that worktree, which is acceptable because daemon worktrees are not hand-edited and
  an advanced base requires re-resolving anyway.

## Dependencies

- **PR #109 (merged)** — discovery-time HALT park / un-park; the re-kick mechanism depends on it.
- **Phase 9.0 (rebase-on-latest)** — its rebase-conflict HALT leaves a paused rebase that FR-7b
  must abort before clearing; re-dispatch relies on 9.0's rebase step running fresh on the new base.
- `resolveDiscoveryRef` (daemon-backlog.ts) — already resolves the discovery ref and detects
  origin advances via fetch; provides the ref whose SHA is tracked.
- Existing `parked` / `started` / `inFlight` sets and `isHalted` (daemon.ts, daemon-deps.ts).

## Open Questions

- None blocking. (Reason-preservation filename `.pipeline/HALT.cleared` and dashboard exact
  column layout are implementation details for `/plan`.)
