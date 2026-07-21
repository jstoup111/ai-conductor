# ADR: A no-diff task earns completion currency deterministically — stamp Evidence: skipped, recognize Type: verification

**Status:** APPROVED
**Date:** 2026-07-21
**Issue:** #733 · **Stem:** `no-diff-task-evidence-stamp`
**Relates to:** #463 (evidenceStamps is the sole completion currency),
#677 / `adr-2026-07-17-verify-only-judged-closure` (verify-only judged-closure lane),
#707 (bounded-dirname corroboration), #188 (retry escalation ladder).

## Context

Five of six builds in the 2026-07-21 spec batch auto-parked with
`no_task_progress (N→N)` after 3 attempts (#241, #721, #149, #148, #576); only #695
shipped. The engine already carried #707, #677, and #188, so this is a new class.

Forensics on the kept worktrees show the same shape every time: every credited task has
an `evidenceStamps` entry; the single uncredited task is a **no-diff** task — a "GREEN +
full-suite check" verification, or an already-satisfied contract closed as skipped — and
its `attribution-verdict.json` verdict is `satisfied` with passing tests, yet
`evidenceStamps` never receives an entry for it.

The invariant behind #463: the build gate (`artifacts.ts:1024-1036`) treats a task as
resolved **only** if `evidenceStamps.has(id)`; the on-disk `completed`/`skipped` row is
never trusted (that is what makes a wiped task-status.json non-terminal). This is
correct. The defect is that a no-diff task has **no deterministic way to earn that stamp**:

1. `deriveCompletionInternal` credits an `Evidence: skipped <reason>` commit by setting
   `status:'skipped'` but **never** calls `evidenceStamps.set` (`autoheal.ts:747-753`).
   `countResolvedTasks` (`task-progress.ts:32`) already counts `skipped` as resolved, so
   the stall circuit-breaker sees progress reach N and stop while the gate stays forever
   unsatisfiable — a deadlock. (#721 task 2; #576 task 5.)
2. The judged-closure lane arms only for tasks `parsePlanTaskVerifyOnly` marks true,
   which matches only the literal `**Verify-only:** yes` marker (`autoheal.ts:1446`,
   consumed at `conductor.ts:3289-3295`). The #718-batch session authored its no-diff
   final tasks as `**Type:** verification` instead, so the lane never armed and the
   verifier's `satisfied` verdict was written but never consumed. (#241 task 6; #149
   task 4; #148 task 5; #576 task 5.)

Per CLAUDE.md's Design Principle, the durable fix is machinery that stamps at the moment
of the (non-)mistake, not a stronger prompt telling authors to always write
`**Verify-only:** yes`.

## Decision

Make completion currency **obtainable deterministically for every legitimately no-diff
task**, via two edits confined to `autoheal.ts`:

**Decision 1 — `Evidence: skipped` mints a stamp.** In the skip branch of
`deriveCompletionInternal`, alongside setting `status:'skipped'`, write
`evidenceStamps.set(id, { sha: <the Evidence: skipped commit sha>, form: 'evidence:skipped' })`.
The task stays `skipped` (not promoted to `completed`), but the gate's `.has(id)` check
now passes — aligning the gate with `countResolvedTasks`. `reconcileStatusFromStamps`
skips `skipped` rows (`autoheal.ts:1600`), so no row is wrongly flipped to `completed`.

**Decision 2 — `**Type:** verification` is verify-only-eligible.** Broaden
`parsePlanTaskVerifyOnly` to return `true` for a task whose `**Type:**` line contains
the `verification` token, **in union** with the existing `**Verify-only:** yes` marker.
Because the arming (`conductor.ts:3289`) and the citation path-relaxation
(`attribution-lane.ts:511`) both already consume this one function, the single edit arms
the lane and relaxes path-overlap for verification tasks with **no change to either
consumer**.

## Consequences

**Preserved (fail-closed, no whitewash):**

- **Derive-from-git.** Decision 1 stamps only against a real `Evidence: skipped` commit
  on the branch. A self-reported `status:'skipped'` row with no such commit still earns
  nothing — the derive-from-git invariant (#463/#497) is intact.
- **Whitewash guard.** Decision 2 only *arms* the lane. The verifier's citations still
  pass existence + ancestry + non-empty + not-bookkeeping validation
  (`attribution-validate.ts`), and the whitewash guard still coerces a `satisfied` verdict
  lacking non-empty citations or passing testEvidence to `no-verdict`
  (`attribution-verdict.ts:209-224`). A no-diff task with no honest ancestor-reachable
  citation is still refused → still stalls loudly rather than shipping unverified.
- **Own-diff tasks.** They stamp via the trailer/path-overlap path *before* the lane runs
  (`conductor.ts:3265` derives before `3311` dispatches), so a code-bearing task
  mislabeled `Type: verification` is already out of residue and never reaches the lane.

**Changed:**

- A build whose only remaining residue is a no-diff verification/skip task now reaches
  the gate-pass instead of auto-parking. The 5 parked #733 features need **no plan edit
  and no re-dispatch** — their `Evidence: skipped` commits and verifier verdicts are
  already on their branches; a plain unpark re-runs the gate, which now stamps them.

**Rejected alternatives:**

- *Author-side lint requiring `**Verify-only:** yes` on every no-diff task.* Rejected:
  re-introduces the exact prompt-discipline dependence that failed here; the engine can
  recognize the convention deterministically instead.
- *Make the gate trust a `skipped` row from task-status.json.* Rejected: breaks #463's
  derive-from-git invariant (a forged/wiped row would resolve tasks). Stamping only
  against the real skip **commit** keeps git as the source of truth.
