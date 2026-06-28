# ADR 013: Daemon Main-Advance Re-Kick of Halted Work

**Date:** 2026-06-28
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

## Context

PR #109 made the durable `.pipeline/HALT` marker authoritative at discovery: a halted feature
stays parked across restarts until a human clears the marker. That is correct, but it means
parked work only resumes by manual marker clearance — even after the base branch advances with a
commit that should unblock it (a merged fix, an amended spec, or simply a moved base that now
rebases cleanly).

The operator wants halted work to be retried automatically whenever the base branch actually
advances, and chose the most aggressive policy: on a base advance, re-kick **every** halted
feature (accepting that an unresolved human-DECIDE gap may immediately re-halt).

Forces / constraints:
- Must not reintroduce the PR #109 bug (a plain restart with no advance must still honor markers).
- Must not add a parallel dispatch path that could diverge from the canonical dispatch discipline.
- Phase 9.0 (ADR-001) writes a rebase-conflict HALT that leaves the worktree with a **paused,
  in-progress rebase**; its documented resume protocol is resolve → `git rebase --continue` →
  clear HALT → re-queue. The harness has a documented history of real-repo rebase corruption
  (b08f534), and 9.0 asserts that clearing HALT without finishing the rebase re-parks the feature.
- The daemon's pure core is unit-tested via injected primitives (`DaemonDeps`/`FeatureRunnerDeps`),
  with no git/network/worktree in tests.

## Options Considered

### Option A: Re-kick by clearing the HALT marker, gated on a genuine base-SHA advance
- **Pros:** Clearing `.pipeline/HALT` makes `isHalted` false, so PR #109's existing un-park path
  re-dispatches the feature — **no new dispatch path**. Gating on an actual base-SHA change (not
  every poll) bounds the work and preserves the no-advance restart invariant.
- **Cons:** Aggressive all-halts retry can churn (re-build → re-halt) for genuinely unresolved
  gaps; needs a loop bound and careful handling of 9.0's paused rebase.

### Option B: Auto-clear all HALTs on every poll / on any fetch
- **Pros:** Simplest trigger.
- **Cons:** Reintroduces the PR #109 clobber class (re-dispatches parked work with no real
  trigger); unbounded churn. Rejected.

### Option C: Classify halts and re-kick only "retryable" ones
- **Pros:** Avoids re-running human-DECIDE halts.
- **Cons:** Operator explicitly rejected selective re-kick; classification is fragile. Rejected.

### Sub-decision (within Option A) — handling a 9.0 paused rebase
- **A1 (chosen): abort the paused rebase before clearing.** Detect an in-progress rebase
  (`.git/rebase-merge`/`rebase-apply`) and `git rebase --abort` (best-effort, logged, no-op when
  none) before removing the marker, returning the worktree to a clean tip so 9.0's rebase runs
  fresh on the advanced base.
- **A2: skip rebase-in-progress worktrees** — contradicts "all halts" and removes the most useful
  case. Rejected.
- **A3: full reset + re-materialize** — duplicates normal dispatch setup; heavier; `reset --hard`
  is its own footgun. Rejected.

## Decision

Adopt **Option A with sub-decision A1**:

1. **Trigger.** Track the base-branch tip SHA (`git rev-parse` of the ref `resolveDiscoveryRef`
   already returns) and persist the last-seen value to `.daemon/last-base-sha`. A re-kick sweep
   fires only when the current base SHA differs from the last-seen value — observed live during a
   run (idle refresh) **or** at startup versus the persisted value (an advance that happened while
   the daemon was down). First run (no/invalid persisted SHA) initializes without re-kicking. A
   restart with no advance honors all markers (PR #109 preserved).
2. **Mechanism.** The sweep clears the marker; it issues **no** direct dispatch. Re-dispatch
   happens through PR #109's discovery un-park path. For each halted worktree the sweep: logs the
   reason; if a rebase is in progress, `git rebase --abort` (A1); renames `.pipeline/HALT` →
   `.pipeline/HALT.cleared` (reason preserved); removes `.pipeline/HALT`; records the triggering
   SHA as that feature's last-rekick SHA. A failed abort leaves the marker intact (no half-clear).
3. **Loop bound.** A feature already re-kicked at SHA `X` is not re-kicked again at `X` (per-feature
   last-rekick SHA); only a further advance re-kicks it. Worst case is one wasted build per halted
   feature per base commit — bounded, not a tight loop.
4. **Resume rebase-first (play-forward).** A re-kicked feature must integrate the advanced base
   **before** re-running the gate it halted on — otherwise a gate-failure halt (e.g. prd-audit)
   re-runs against the stale base, never sees the unblocking commit (which 9.0 would otherwise only
   apply at the ship-tail rebase), and re-halts without playing forward. Therefore re-kick resumes
   the feature so that 9.0's rebase-onto-latest runs first; the pending gate then re-verifies on the
   new base. For a rebase-conflict halt this already holds (the aborted rebase is the first thing
   re-run); for a gate-failure halt, re-kick resets the resume point so the rebase precedes the
   pending gate. The re-kick mechanism does **not** itself reason about whether the halt is resolved
   or where a residual gap routes — that judgment stays with the normal gate loop and `/remediate`
   (the existing blocking-gap router). Re-kick is the deterministic mechanism that hands a
   rebased-forward worktree back to that existing intelligence; it does not duplicate it.

We chose this because clearing-the-marker is the single composition point that reuses the entire
existing dispatch discipline (PR #109) and the existing rebase step (9.0) without duplicating
either; the only safety-critical additions are aborting the paused rebase and resuming rebase-first,
which together convert re-kick from a corruption risk / no-op into the correct play-forward (a fresh
rebase on the advanced base, then re-verification on it). A dedicated "play-forward" skill was
explicitly rejected: the ordering is deterministic (always rebase-then-verify), and the only genuine
judgment — is the halt resolved, and where does a residual gap go — already lives in the gate loop
and `/remediate`. A new skill would duplicate `/remediate` and add non-determinism to the daemon's
dispatch hot path.

## Consequences

### Positive
- Parked work retries automatically on the event most likely to unblock it (a base advance),
  including advances during downtime.
- Zero new dispatch path; re-kick cannot diverge from canonical dispatch.
- Rebase-conflict halts — the most common auto-unblockable case — get a clean fresh rebase.
- Fully unit-testable via injected primitives (SHA read, rebase-in-progress probe, marker clear).

### Negative
- Aggressive policy can churn on genuinely unresolved gaps (operator-accepted; bounded by SHA).
- Aborting a paused rebase discards any *partial* manual resolution in that worktree (acceptable:
  daemon worktrees are not hand-edited; an advanced base requires re-resolving anyway).
- Adds three new on-disk write paths: `.daemon/last-base-sha`, per-worktree `.pipeline/HALT.cleared`,
  and the rebase abort side effect.

### Follow-up Actions
- [ ] Implement SHA tracking + persistence (`.daemon/last-base-sha`) with corrupt-file-as-absent.
- [ ] Implement the sweep (abort-if-rebasing → preserve reason → clear → record SHA) behind an
      injected primitive; wire both call sites (startup downtime-advance, live refresh-advance).
- [ ] Startup dashboard scan + render (separate FRs, same feature).
- [ ] Regression test pinning the PR #109 no-advance invariant under the new code path.

**Relationship to ADR-001 (rebase insertion mechanism):** complementary, not superseding. ADR-001
governs how/when the rebase runs and HALTs; ADR-013 governs when a parked feature (including a
rebase-HALTed one) is retried, and guarantees the worktree is rebase-clean before re-dispatch so
ADR-001's step runs fresh.
