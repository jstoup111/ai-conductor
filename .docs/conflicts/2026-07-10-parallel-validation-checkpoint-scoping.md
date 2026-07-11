# Conflict Check: Parallel Validation Phase (ai-conductor#469)

**Date:** 2026-07-10
**New stories:** .docs/stories/parallel-validation-phase-fan-out-manual-test-prd-.md
**Scanned against:** full .docs/stories/ corpus (75+ files), APPROVED ADRs, in-flight
conductor.ts specs
**Result:** 1 blocking conflict found and RESOLVED; 0 remaining. PASSED.

## Conflict: Concurrent fan-out vs manual_test's interactive checkpoint

**Stories involved:** "Validation group fans out concurrently after build_review" (new)
vs the interactive checkpoint contract on `manual_test` (`isCheckpoint: true`;
post-step pause fires only when mode ≠ auto — conductor.ts checkpoint handling,
verified 2026-07-10)
**Type:** sequencing
**Severity:** blocking (interactive mode only)

**Description:** In interactive mode the operator's checkpoint response follows
manual_test's completion; concurrent dispatch would start prd_audit/as-built before
that response. Both behaviors could not hold simultaneously in non-auto mode.

**Resolution (operator-selected, option 1 of 3):** the validation group engages ONLY
in daemon/auto mode. Interactive conduct keeps today's serial walk and checkpoint,
byte-for-byte. Recorded as: story 1 happy path now scoped to daemon/auto; a new
negative path pins interactive-mode serial behavior; addendum appended to
adr-2026-07-10-validation-group-join.

Rejected alternatives: moving the checkpoint to the join (changes interactive UX);
dropping the checkpoint flag (deletes a human gate).

## Verified-compatible pairs (reasoned, not assumed)

- **manual-test-fail-routing stories** — assert routing/classification (kickback
  event manual_test→build with FAIL rows, whitewash guard, budget); no timing clause.
  The join preserves classification; only the trigger point moves to the join.
  Confidence: high (story text read directly).
- **fresh-session-per-step stories** — invariant is per-step session isolation;
  per-branch fresh sessions preserve it; within-branch retry-resume preserved per
  branch. Compatible with wording note (the reset seam generalizes from "loop step
  boundary" to "branch dispatch").
- **prd-audit-kickback-preserves-task-status stories** — join reuses the same
  navigateBack/kickback machinery; task-status preservation semantics unchanged.
- **unify-build-completion-evidence-derivation stories (#456/#463)** — validators are
  evidence consumers; single-writer join avoids racing gate-verdict writes.
- **add-a-judgement-gate-at-the-build-manual-test-seam (build_review)** — group sits
  strictly after build_review; no overlap.
- **No legacy `parallel:` DSL stories exist** — only tests, already slated for rewrite
  under adr-2026-07-10-concurrent-group-core.

## Coordination notes (not story conflicts)

- In-flight specs touching conductor.ts (#477/#489 engine task stamping, #492, #486):
  potential code-merge churn, handled by the daemon's finish-time rebase; no
  behavioral contradiction with these stories.
