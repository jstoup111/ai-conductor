# Conflict Check: Daemon Halt-Reconciliation

**Date:** 2026-06-28
**Stories checked:** `.docs/stories/daemon-halt-reconciliation.md` (11 FRs) against existing
daemon stories — primarily `phase-9.0-rebase-on-latest.md` (the daemon's rebase + HALT
mechanism), plus 9.1/9.2/9.3/9.3b (no overlap with dispatch/HALT semantics).

## Result: 1 BLOCKING conflict (see below). Three scrutinized areas clean.

### Clean areas
- **Re-kick (FR-7) vs PR #109 restart invariant (no-advance preserves markers):** complementary,
  not contradictory. Re-kick fires only on a detected base-SHA advance; a plain restart with no
  advance leaves every marker intact. Gated on disjoint triggers.
- **Dashboard group precedence (FR-1/FR-2):** halted > processed > in-progress > eligible is
  internally consistent; overlapping slugs are explicitly excluded from the lower groups (no
  double-count).
- **FR-9 loop bound vs FR-7 all-halts clear:** FR-9 (per-feature last-rekick SHA) is a guard
  *inside* FR-7's policy, not a contradiction. No story implies a parallel dispatch path —
  FR-8 re-dispatches solely by clearing the marker and letting PR #109's un-park path run.

---

## Conflict: Re-kick auto-clears a 9.0 rebase-conflict HALT over a physically paused rebase

**Stories involved:** "Re-kick sweep clears every halted marker and preserves its reason"
(daemon-halt-reconciliation FR-7) vs Phase 9.0 "HALT (worktree kept, rebase paused) on any
non-CHANGELOG conflict" + "A parked feature resumes to a clean PR after the human resolves".
**Files:** `.docs/stories/daemon-halt-reconciliation.md` vs `.docs/stories/phase-9.0-rebase-on-latest.md`
**Type:** state-conflict / resource-contention
**Severity:** blocking

**Description:**
A 9.0 rebase-conflict HALT does not just write `.pipeline/HALT` — it leaves the worktree with an
**in-progress, paused git rebase** (conflicted/unstaged files; `.git/rebase-merge` or
`rebase-apply` present). 9.0's resume protocol is: resolve conflicts → `git rebase --continue` →
clear `.pipeline/HALT` → re-queue. 9.0 explicitly asserts that **clearing HALT without finishing
the rebase makes the daemon re-park** (phase-9.0 lines 282–284, 289–290), precisely so a
half-rebased branch is never shipped.

FR-7 as written auto-clears **every** HALT on a base advance, including a rebase-conflict HALT,
then re-dispatches. Re-dispatching over a worktree with a paused rebase risks: (a) `materializeSpecs`
committing `.docs` onto a mid-rebase index, (b) the 9.0 rebase step running `git rebase` against
an already-in-progress rebase (`fatal: rebase already in progress`), and (c) the recurring
real-repo rebase corruption the harness has hit before (b08f534; see also the
`runRebaseStep no-ops when !daemon` guard). At best, 9.0's "detect in-progress state and re-park"
net catches it and the feature simply re-HALTs (churn, bounded by FR-9). At worst, the paused
rebase is corrupted.

This is the highest-value case for re-kick (a base advance is exactly what can make a previously
conflicting rebase apply cleanly), so excluding rebase halts wholesale would gut the feature.

**Resolution Options:**
1. **Abort the paused rebase before clearing (recommended).** In the re-kick sweep, before
   removing `.pipeline/HALT`, detect an in-progress rebase in the worktree and run
   `git rebase --abort` (best-effort, logged) to return the worktree to a clean checkout of its
   branch tip. Then clear HALT and let re-dispatch run 9.0's rebase step **fresh** against the
   advanced base — which is exactly the retry the operator wants. Safe for non-rebase halts too
   (no paused rebase → abort is a no-op).
2. **Exclude rebase-in-progress worktrees from the sweep.** Clear only HALTs with no paused
   rebase; leave rebase-conflict HALTs for a human. Contradicts the operator's explicit
   "all halts clear + retry" choice and removes re-kick's most useful case.
3. **Full reset + re-materialize.** Re-kick does `git rebase --abort` + hard reset to base +
   re-materialize specs. Heaviest; duplicates work the normal dispatch already does.

**Recommendation:** Option 1. It honors the "all halts" policy, makes re-kick genuinely useful
for rebase conflicts (fresh rebase on the advanced base), and eliminates the corruption risk by
never re-entering a paused rebase. Requires adding one behavior to FR-7 (abort-paused-rebase
before clear) and a story scenario for it.

**RESOLUTION (operator-selected): Option 1 — applied 2026-06-28.**
- PRD FR-7 amended to add step (b): detect an in-progress rebase (`.git/rebase-merge` /
  `.git/rebase-apply`) and `git rebase --abort` (best-effort, logged, no-op when none) before
  removing the marker. Key Decisions + Dependencies updated; Phase 9.0 added as a dependency.
- Stories ("Re-kick sweep clears every halted marker…") gained a happy-path scenario for the
  rebase-conflict abort and two negative paths: no-rebase abort is a no-op; a **failed**
  `git rebase --abort` leaves the marker intact (no half-clear) and is isolated.
- Re-check: zero remaining blocking conflicts. The amended FR-7 is consistent with 9.0 (re-dispatch
  runs 9.0's rebase fresh on a clean tip) and with FR-9 (one re-kick per SHA bounds any churn).
