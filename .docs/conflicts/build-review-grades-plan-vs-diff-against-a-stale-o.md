# Conflict Check: build-review-grades-plan-vs-diff-against-a-stale-o

**Date:** 2026-07-23
**Verdict: CLEAN — no blocking conflicts.** Two adjacencies noted for the plan.

## Checked against

- **In-flight spec `trailer-union-build-completion` (#859, being specced in a
  parallel session):** changes the *build step's* completion predicate
  (`artifacts.ts` build predicate / `task-progress.ts` resolution). This spec
  changes the *build_review step's* input assembly (`build-review-inputs.ts`) and
  FAIL routing (conductor build_review branch). No shared invariants; both may edit
  `conductor.ts` in different regions → merge-order risk is textual, not semantic.
  Plan notes the seam.
- **#569 build-stall remediation (shipped):** routes build stalls to /remediate;
  operates on the *build* step's stall breaker, not build_review FAILs. The new
  disposition layer must run BEFORE any remediation routing for build_review — plan
  task pins ordering with a test.
- **#817 gate-code-validity (shipped):** preserves fresh verdicts when code is
  unchanged; a discarded (stale-mirage) verdict must not be resurrected by the
  code-stamp preserve path. Plan includes a pinning test that an invalidated
  verdict's artifact is removed, not preserved.
- **#828 per-task commit floor (shipped):** advisory grader-input lines; unaffected —
  floor reads the plan and trailers, not the merge-base.
- **Re-kick rebase path (`rebase.ts#resolveBase`):** mechanism A refactors its
  fetch/derivation into a shared seam; behavior of the rebase path itself must stay
  byte-identical (pinned test).

## State/resource contention

- Concurrent `git fetch` from grading vs daemon sweeps: git ref locking serializes;
  fetch failure degrades to advisory (Story 2). No new lock files introduced.
- New `.pipeline/` regrade counter: name-spaced file, no collision with existing
  sidecars (task-status, task-evidence, build-review.json).
