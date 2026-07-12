# Stories: reduce redundant full test-suite runs in build/ship pipeline (#588, S)

Scope boundary (binding — issue #588): the FULL conductor test suite must run
authoritatively at CI (the `conductor` job on the PR), and at most ONCE more in-pipeline
where a pre-push gate genuinely needs it (finish, before ship). Every intermediate build
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
- finish (`skills/finish/SKILL.md:45`) is the single in-pipeline full-suite checkpoint,
  complementing CI's authoritative run.

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

**Negative path (a diff-scoped regression is still caught)**
- Given a diff whose own new/changed test would fail without the diff, or that breaks a
  test in a file the diff touches,
- When the grader runs the scoped set,
- Then it observes the failure firsthand and the rubric still catches a dishonest diff
  (tautology/root-cause FAIL) exactly as before — scoping narrows WHICH tests run, not the
  gate's ability to fail a bad diff. Cross-file regressions outside the diff's scope are
  caught at finish's full run and at CI, so nothing ships red.

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

**Negative path (no free pass)**
- Given a grader that cannot run the diff's scoped tests, or produces no/malformed
  verdict,
- When the completion predicate evaluates,
- Then the step is unsatisfied exactly as today (missing/stale/malformed verdict ⇒ not
  passed) — scoping introduces no path that lets a build advance without a fresh PASS.

---

## Story 3: TDD per-cycle runs the scoped affected set; the full suite runs at finish + CI

As a build agent running the TDD cycle, I want each GREEN/COMMIT cycle to run only the
affected/scoped test set (the task's own tests plus the files it touches), so per-task
work stops re-running the whole suite — matching the policy the TDD Verification checklist
already states.

**Happy path**
- Given a TDD cycle for a task,
- When GREEN verifies the change and the COMMIT hard gate is evaluated,
- Then both run the SCOPED affected-test set (not the full suite), the cycle commits on a
  green scoped run, and the full suite is deferred to the feature's finish step and CI —
  and the SKILL.md is internally consistent (GREEN step 4 and the COMMIT gate agree with
  the Verification checklist at `:312-313`).

**Negative path (a regression the scope catches, and one it defers)**
- Given a cycle whose change breaks a test in a file it touches,
- Then the scoped run fails and the cycle does NOT commit (caught in-cycle) — and given a
  change that breaks an UNRELATED test outside the cycle's scope, that regression is
  caught by the full suite at finish and by CI before merge, so nothing ships red despite
  the per-cycle run being scoped.

---

## Story 4: finish is the single in-pipeline full-suite checkpoint before ship

As the ship tail, I want finish to remain the one place the full suite runs in-pipeline
(before push), complementing CI's authoritative run, so a ship cannot leave the machine on
a red full suite while intermediate steps stay scoped.

**Happy path**
- Given a feature reaching finish,
- When finish runs its fresh verification,
- Then it runs the FULL test suite once (unchanged), and the skill documents that this is
  the single in-pipeline full-suite checkpoint that complements — not duplicates — CI's
  authoritative `conductor` job.

**Negative path (red full suite still blocks the ship)**
- Given the fresh full suite at finish has real (non-flake) failures,
- When finish evaluates,
- Then finish still refuses (writes `.pipeline/test-failures.md`, no `finish-choice`, no
  push, no PR) exactly as today — the full-suite pre-push gate is retained, and CI remains
  the authoritative gate that blocks merge on red.

Status: Accepted
