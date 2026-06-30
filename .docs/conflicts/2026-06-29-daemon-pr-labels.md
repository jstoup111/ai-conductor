# Conflict Report: Daemon PR Labeling

**Date:** 2026-06-29
**Stories checked:** `.docs/stories/daemon-pr-labels.md` (all 11), against existing daemon behavior
(halt-reconciliation, intake `needs-manual`/`engineer:handled`, `/remediate`, `/finish`).

## Clean interactions (confirmed, no conflict)

- **Label/state namespaces distinct.** `needs-remediation` (new GitHub PR label) ≠ `needs-manual`
  (intake ledger status) ≠ `engineer:handled` (intake GitHub label). No collision.
- **`/remediate` vs `needs-remediation`.** Different triggers (SHIP gate-block vs BUILD failure)
  and phases; complementary signals.
- **mergeable enrollment ordering.** `/finish` creates/【reuses】the PR before daemon-runner enrolls
  the `done` PR for the sweep — no ordering hazard.

## Conflict 1: A re-kicked-then-succeeded feature keeps a stale `needs-remediation` PR

**Stories involved:** "Open a draft needs-remediation PR when commits exist" (FR-2/FR-4) +
"Never label a needs-remediation PR as mergeable" (FR-12) vs. the existing **halt-reconciliation
re-kick** flow and "Apply mergeable when ready" (FR-10).
**Type:** state-conflict / sequencing
**Severity:** degrading

**Description:**
The needs-remediation path writes HALT, then opens a **draft** PR labeled `needs-remediation` on the
feature branch. Halt-reconciliation later **re-kicks** halted features on base advance (clears HALT,
drops REKICK, re-dispatches the build). If that re-dispatch now **succeeds**, the feature ships
`done` on the *same branch* — and `/finish` **reuses the existing PR** (it looks up the branch's PR
rather than creating a new one). The result:

- the PR is still a **draft** and still carries **`needs-remediation`**, even though the feature
  shipped successfully; and
- FR-12 ("needs-remediation PR is never `mergeable`") then **permanently blocks** that PR from ever
  getting the `mergeable` label.

So a feature that ultimately succeeded autonomously can never be surfaced as ready-to-merge, and its
PR lies (says "needs remediation" when it doesn't). The HALT marker gets cleared on re-kick; the
label and draft state do not.

**Resolution Options:**
1. **Success clears the failure signal (least surprising).** When a feature reaches `done` and is
   enrolled for the mergeable sweep, the daemon also (best-effort) **removes `needs-remediation`**
   from that PR and **marks it ready-for-review** (un-drafts). FR-12 then no longer blocks it and the
   sweep can label it `mergeable` normally. Adds a small "clear-on-success" step at enrollment.
2. **Leave it for the human.** Keep `needs-remediation` + draft; the engineer manually clears and
   un-drafts. Literal to "manual remediation required," but wrong for an *auto-success* — it forces
   manual work on a feature that needed none, and contradicts the `done` outcome.
3. **Sweep precedence flip.** Let `done`-enrollment override FR-12: the sweep strips
   `needs-remediation` whenever a tracked `done` PR is green. Changes FR-12's "exclusion always
   wins" semantics and risks stripping the label off a PR that legitimately still needs work.

**Recommendation:** **Option 1.** It keeps both labels truthful, requires no human action on an
auto-success, and preserves FR-12 intact (the exclusion still holds for any PR that genuinely still
carries `needs-remediation`). It adds one best-effort clear-on-success step, consistent with the
feature's non-blocking semantics.

---

## Resolution (operator-selected 2026-06-29): Option 1

**Status:** Resolved. The PRD and stories were amended:
- **FR-16** added — on a `done` outcome, the daemon clears `needs-remediation` and un-drafts the PR
  (best-effort) before mergeable enrollment.
- New story "Clear the failure signal when a re-kicked feature succeeds" covers FR-16 incl. negative
  paths (no-op when no label; swallowed failure keeps FR-12 protective; only `done` triggers it).
- FR-12 semantics unchanged.

No superseding ADR required — this is an additive behavior, not a reversal of a prior architectural
decision. (The as-built architecture review at SHIP will confirm the implementation honors it.)

Re-check after amendment: **zero blocking conflicts; this degrading conflict resolved.**
