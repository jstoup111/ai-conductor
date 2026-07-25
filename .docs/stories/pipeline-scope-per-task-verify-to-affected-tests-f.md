**Status:** Accepted

# Stories: pipeline — scope per-task VERIFY to affected tests

Technical track (no PRD). Source: intake jstoup111/ai-conductor#245. Approved approach:
`.memory/decisions/pipeline-scoped-per-task-verify-approach.md` (skill-level judgment
scoping with explicit full-suite fallback triggers; no engine code).

> **Amended 2026-07-25 by issue #940:** batch boundaries and joins now run the
> union of affected tests rather than the full suite. When any fallback trigger
> requires the aggregate operation, it must run through the shared full-suite
> verifier so the later `test_suite` gate can reuse the proof.

---

## Story: Per-task VERIFY runs the scoped affected-test set

As a harness operator, I want per-task VERIFY to run only the tests affected by the
task so that an M-tier build stops paying ~14 full-suite runs before the batch
boundary re-runs everything anyway.

### Acceptance Criteria

#### Happy Path
- Given a completed TDD subagent dispatch whose diff modifies production module(s)
  with identifiable covering tests, when the conductor reaches step 3 VERIFY, then it
  runs only the scoped set: the task's new/changed test files plus existing test files
  covering the modified modules (found by the project's test naming convention plus an
  import/reference grep for the changed modules), using the project's test runner with
  explicit file arguments.
- Given the scoped set was assembled, when VERIFY runs, then the conductor reports
  which files were in scope (in the task's PASS/FAIL report), so the audit trail shows
  the scoping decision.

#### Negative Paths
- Given a task whose scoped set comes back **empty** (no new/changed test files and no
  covering tests found), when the conductor reaches VERIFY, then it runs the aggregate
  operation through the shared full-suite verifier instead of skipping verification.
- Given a scoped VERIFY run fails, when step 4 FIX re-verifies before re-dispatch,
  then the failure-verification re-run uses the **same scoped set** (not the full
  suite, and not zero tests) so the failure signal is comparable.

### Done When
- [ ] `skills/pipeline/SKILL.md` step 3 no longer says "Run the full test suite" as the
      unconditional per-task action; it specifies the scoped-set procedure (new/changed
      test files + covering tests via naming convention + import/reference grep).
- [ ] The skill text requires the scoped file list to appear in the task's REPORT output.
- [ ] The skill text directs step 4 FIX's failure-verification to reuse the task's
      scoped set.
- [ ] `test/test_harness_integrity.sh` passes.

---

## Story: Fallback triggers force the full suite on unclear blast radius

As a harness operator, I want VERIFY to fall back to the full suite whenever scoping
confidence is low so that narrowing the per-task run never weakens the verification
gate.

### Acceptance Criteria

#### Happy Path
- Given a task whose diff touches a **shared/core module** (imported/required by 3 or
  more other production modules), when the conductor reaches VERIFY, then it runs the
  full test suite for that task.
- Given a task whose diff touches **config, migrations, dependency manifests, or test
  infrastructure** (test helpers, fixtures, global setup), when the conductor reaches
  VERIFY, then it runs the full test suite for that task.

#### Negative Paths
- Given the conductor **cannot confidently map** the modified modules to covering
  tests (ambiguous naming, dynamic dispatch, no grep hits), when it reaches VERIFY,
  then it runs the full test suite for that task — uncertainty never resolves toward
  the narrower run.
- Given a fallback trigger fired, when the task is reported, then the report names
  which trigger forced the full suite (auditable, so over-triggering is visible in
  retros rather than silently eroding the speed win).

### Done When
- [ ] The skill text enumerates all four fallback triggers verbatim: shared/core module
      (3+ importers), config/migrations/test-infrastructure change, empty scoped set,
      low-confidence module→test mapping.
- [ ] The skill text states the fallback direction explicitly: unclear ⇒ full suite.
- [ ] The skill text requires the fired trigger to be named in the task report.

---

## Story: Batch boundaries retain quality checks while test execution is scoped

As a harness operator, I want batch-boundary quality checks retained while their
test run uses the union of affected tests, so `/simplify`, linting, and review
remain strong without duplicating the aggregate gate.

### Acceptance Criteria

#### Happy Path
- Given a batch boundary is reached, when pre-batch verification runs, then it
  runs the union of tests affected by that batch plus the linter and
  `/simplify`, and the evaluator dispatch rules remain unchanged.
- Given a task is dispatched, when the TDD subagent runs, then its
  RED → DOMAIN → GREEN → DOMAIN → COMMIT cycle — including per-task domain reviews —
  is unchanged by this feature.

#### Negative Paths
- Given affected-test selection at a boundary is unsafe or empty, when a
  documented fallback trigger fires, then the aggregate operation runs through
  the shared verifier and the trigger is reported; the boundary never silently
  skips tests.

### Done When
- [ ] The batch-boundary section mandates the affected-test union + linter +
      `/simplify`, with aggregate fallback through the shared verifier.
- [ ] No diff hunk touches the TDD cycle description, domain-review requirements, or
      evaluator frequency/model table.
- [ ] `CHANGELOG.md` gains an `[Unreleased]` → Changed entry describing the scoped
      per-task VERIFY; README/skill docs reflect the new behavior in the same PR.
