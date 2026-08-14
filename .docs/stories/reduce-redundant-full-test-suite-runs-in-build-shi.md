**Status:** Accepted

# Stories: reduce redundant full test-suite runs in build/ship pipeline (#588, S)

> **Amended 2026-07-25 by issue #940 and
> `.docs/stories/full-suite-verification-gate-940.md`:** the single local
> full-suite checkpoint moved from finish to the explicit `test_suite` gate
> after BUILD quality checks and before SHIP. Finish now reuses current gate
> evidence and runs only a missing/stale fallback. Scoped-test intent is
> unchanged.

Scope boundary (binding — issue #588): the FULL conductor test suite must run
authoritatively at CI (the `conductor` job on the PR), and at most ONCE more in-pipeline
where the pre-SHIP `test_suite` gate needs it. Every intermediate build
step that today re-runs the whole suite is scoped down to the affected/mapped tests (the
task's / diff's own test files). No gate semantics change; nothing may ship on a red CI.

Design anchors:
- build_review gate = the verdict JSON predicate (`CUSTOM_COMPLETION_PREDICATES.build_review`,
  ADR-2026-07-07-build-review-judgement-gate §4/§52); its rubric is diff-honesty judged
  statically from the diff (§54-56). Scoping the grader's own test run does NOT touch the
  verdict.
- The TDD Verification checklist ALREADY states the target policy
  (`skills/tdd/SKILL.md:312-313`): "Scoped affected-test set passes before commit (the
  full suite runs at the feature's final verification task, not per-task)". Two earlier
  lines in the same file contradict it; this work reconciles them.
- `test_suite` is the single in-pipeline full-suite checkpoint; finish reuses
  its current proof or supplies a missing/stale fallback.

Binding non-goal: manual_test (`skills/manual-test/SKILL.md`) exercises endpoints/UI and
does NOT run the unit suite — it is untouched. CI (`.github/workflows/ci.yml`) is
untouched and remains the authoritative full-suite gate.

---

## Story 1: build_review grades on the diff's scoped tests, not the whole suite

As the build/ship pipeline, I want the build_review grader to run only the tests
exercised by the diff under review (its own/changed test files) rather than the entire
conductor suite, so an intermediate gate stops duplicating CI's full-suite run while still
observing that the diff's tests pass firsthand.

**Happy path**
- Given a build_review grader session assembled with the full feature diff and the
  approved plan (`buildGraderPrompt`),
- When the grader prompt instructs it what to run before judging,
- Then it is told to run the SCOPED tests the diff touches/adds (the diff's own test
  files), observe their output firsthand, and NOT to run the full project suite,
- And the verdict schema and the three-item rubric (tautology / scope / root-cause) are
  unchanged — the grader still writes `.pipeline/build-review.json` and still FAILs if any
  rubric item fails.

> **Amended 2026-08-13 by #1542:** later approved work first extended the rubric to five items, and
> #1542 now dispatches eligible rubric judgements independently before a single backward-compatible
> aggregate write. Because the immediately preceding `test_suite` gate already proves current HEAD,
> no rubric branch repeats the green-side scoped or full-suite run. The only test execution owned by
> `build_review` is Tautology's isolated counterfactual preflight: changed tests against merge-base
> production code. This supersedes the grader-run-HEAD wording above without restoring a full-suite
> run inside `build_review`.

**Negative path (a diff-scoped regression is still caught)**
- Given a diff whose own new/changed test would fail without the diff, or that breaks a
  test in a file the diff touches,
- When the grader runs the scoped set,
- Then it observes the failure firsthand and the rubric still catches a dishonest diff
  (tautology/root-cause FAIL) exactly as before — scoping narrows WHICH tests run, not the
  gate's ability to fail a bad diff. Cross-file regressions outside the diff's scope are
  caught at the explicit gate and at CI, so nothing ships red.

---

## Story 2: The build_review gate is not weakened by scoping

As a maintainer, I want scoping the grader's test run to leave the completion gate and its
approved rubric intact, so removing a redundant full-suite run costs no verification
signal.

**Happy path**
- Given the scoped-test instruction is in the grader prompt,
- When build_review completes,
- Then completion is still derived from the verdict JSON predicate
  (`CUSTOM_COMPLETION_PREDICATES.build_review`) — a PASS still requires all three rubric
  items — and a FAIL still kicks back to build under the existing bounded self-heal.

> **Amended 2026-08-13 by #1542:** effective PASS now requires at least one valid judgement and no
> unresolved finding or infrastructure failure among non-skipped outcomes. The public completion
> predicate and bounded kickback route remain authoritative. Cache hits reuse only validated
> semantic rubric results and always materialize fresh current-lap branch and aggregate evidence, so
> they do not relax the verdict-freshness floor.

**Negative path (no free pass)**
- Given a grader that cannot run the diff's scoped tests, or produces no/malformed
  verdict,
- When the completion predicate evaluates,
- Then the step is unsatisfied exactly as today (missing/stale/malformed verdict ⇒ not
  passed) — scoping introduces no path that lets a build advance without a fresh PASS.

---

## Story 3: TDD per-cycle runs the scoped affected set; the full suite runs at the gate + CI

As a build agent running the TDD cycle, I want each GREEN/COMMIT cycle to run only the
affected/scoped test set (the task's own tests plus the files it touches), so per-task
work stops re-running the whole suite — matching the policy the TDD Verification checklist
already states.

**Happy path**
- Given a TDD cycle for a task,
- When GREEN verifies the change and the COMMIT hard gate is evaluated,
- Then both run the SCOPED affected-test set (not the full suite), the cycle commits on a
  green scoped run, and the full suite is deferred to the feature's explicit pre-SHIP gate and CI —
  and the SKILL.md is internally consistent (GREEN step 4 and the COMMIT gate agree with
  the Verification checklist at `:312-313`).

**Negative path (a regression the scope catches, and one it defers)**
- Given a cycle whose change breaks a test in a file it touches,
- Then the scoped run fails and the cycle does NOT commit (caught in-cycle) — and given a
  change that breaks an UNRELATED test outside the cycle's scope, that regression is
  caught by the full suite at the explicit gate and by CI before merge, so nothing ships red despite
  the per-cycle run being scoped.

---

## Story 4: the explicit pre-SHIP gate owns the single in-pipeline full-suite checkpoint

As the delivery flow, I want the explicit `test_suite` step to be the one place
the full suite normally runs in-pipeline, with finish as a reuse-aware fallback,
so failures return to BUILD before SHIP while intermediate steps stay scoped.

**Happy path**
- Given a feature passes BUILD quality checks,
- When the explicit `test_suite` gate runs,
- Then it runs the FULL test suite once and records reusable evidence; finish
  accepts that current proof without launching the suite again.

**Negative path (red full suite still blocks the ship)**
- Given the full suite has real failures,
- When the explicit gate evaluates,
- Then SHIP is blocked and work returns to BUILD; if standalone finish supplies
  a missing/stale fallback and it fails, finish records no choice, push, or PR.
  CI remains the independent authoritative merge gate.
