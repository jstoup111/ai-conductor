# Conflict Check: Full-suite verification gate (#940)

**Date:** 2026-07-25
**Stories checked:** all 235 files under `.docs/stories/`, all 36 specs under
`.docs/specs/`, and all 117 prior reports under `.docs/conflicts/`
**Result:** **PASS — zero blocking conflicts remain.** Four blocking
contradictions were found and resolved using the operator-approved #940 stories.

## Conflict: Finish cannot both always execute and normally reuse the aggregate suite

**Stories involved:** “Fresh Verification and Completion Options” and the
earlier finish-owned checkpoint story vs #940 Stories 4 and 7
**Files:** `.docs/stories/features/finish/ST-023-fresh-verification.md`,
`.docs/stories/reduce-redundant-full-test-suite-runs-in-build-shi.md`, and
`.docs/stories/full-suite-verification-gate-940.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — the older text explicitly required a fresh process run at
finish, while accepted FR-3/FR-13 require reuse of current gate evidence.

**Resolution Options:**

1. Amend the older finish stories so “fresh” means content-current evidence and
   finish runs only a missing/stale fallback.
2. Keep finish's unconditional run and accept violating the once-per-unchanged-
   inputs outcome.
3. Remove finish verification entirely, sacrificing standalone safety.

**Resolution:** Option 1. This is the least disruptive option and exactly
matches the approved PRD/ADR. Both older files were amended in place.

## Conflict: Batch boundaries cannot be both full-suite and scoped

**Stories involved:** the older unconditional boundary story vs #940 Story 6
**Files:**
`.docs/stories/pipeline-scope-per-task-verify-to-affected-tests-f.md` and
`.docs/stories/full-suite-verification-gate-940.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — one contract said every boundary unconditionally runs the
full suite; FR-5 says boundaries use impacted tests.

**Resolution Options:**

1. Preserve linter, `/simplify`, and evaluator behavior while changing the test
   portion to the batch's affected-test union; use the shared verifier only
   when an existing fallback trigger requires the aggregate operation.
2. Keep unconditional aggregate boundary runs and weaken FR-4/FR-5.
3. Remove boundary verification entirely.

**Resolution:** Option 1, selected by the approved #940 story. The old boundary
story now preserves all non-test quality gates and gives aggregate fallback
evidence to the explicit gate for reuse.

## Conflict: TDD COMMIT cannot require both scoped and full tests

**Stories involved:** “TDD RED-GREEN Cycle” vs #940 Story 6
**Files:** `.docs/stories/features/tdd/ST-019-red-green-cycle.md` and
`.docs/stories/full-suite-verification-gate-940.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — the canonical older Done-When required the full suite
before every commit; accepted FR-5 assigns ordinary cycles scoped tests.

**Resolution Options:**

1. Require the affected/scoped set before COMMIT and leave the aggregate suite
   to the explicit gate.
2. Keep a full run on every commit.
3. Permit commits without any test verification.

**Resolution:** Option 1. The canonical TDD story now matches the existing
scoped intent and approved #940 ownership.

## Conflict: Prior rebase report classified duplicate finish execution as benign

**Stories involved:** historical Phase 9.0 conflict conclusion vs #940 Story 4
**Files:** `.docs/conflicts/2026-06-25-phase-9.0-rebase-on-latest.md` and
`.docs/stories/full-suite-verification-gate-940.md`
**Type:** behavioral overlap
**Severity:** blocking if treated as current guidance
**Confidence:** 96% — the historical report explicitly called the second finish
run defense-in-depth; #940 intentionally replaces that policy with a reusable
proof.

**Resolution Options:**

1. Treat the dated report as a historical decision superseded by the approved
   #940 PRD/ADR and this current conflict report.
2. Preserve the old duplicate run.
3. Remove post-rebase invalidation.

**Resolution:** Option 1. The historical report remains append-only evidence of
the earlier policy; this current report records its supersession. Post-rebase
relevant mutations still invalidate the proof and re-enter the gate.

## Explicitly compatible overlaps

- **Autoresolve:** `auto-resolve-open-pr-conflicts.md` retains its own
  fail-closed post-mutation suite command and timeout. FR-17 explicitly
  preserves this behavior. Confidence 99%.
- **CI repair:** `ship-ci-feedback-loop.md` retains its post-fix suite gate.
  FR-17 explicitly preserves this behavior. Confidence 99%.
- **CI authority:** `ci-test-suite-workflow.md` and docs-only CI behavior remain
  independent of local evidence, matching FR-15. Confidence 98%.
- **Pipeline fallback triggers:** shared/core, config/migration/test-infra,
  empty-scope, and low-confidence fallbacks remain; only their execution path
  changes to record reusable evidence. Confidence 98%.
- **Finish failure handling:** stories about finish refusing on a failed suite
  remain applicable to its standalone missing/stale fallback. Confidence 97%.

## Re-check

After the amendments:

- the explicit `test_suite` gate owns the normal aggregate run;
- TDD, batch boundaries, joins, evaluators, and conduct checks are scoped;
- finish reuses current evidence and provides standalone fallback;
- autoresolve and CI repair retain independent post-mutation checks; and
- CI remains independently authoritative.

All five conflict classes were evaluated. No state, resource-contention, or
sequencing conflict remains. No degrading conflict is accepted.
