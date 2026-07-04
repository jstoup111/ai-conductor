# Implementation Plan: pipeline — scope per-task VERIFY to affected tests

**Date:** 2026-07-04
**Design:** technical track — no PRD; approach record in `.memory/decisions/pipeline-scoped-per-task-verify-approach.md`
**Stories:** `.docs/stories/pipeline-scope-per-task-verify-to-affected-tests-f.md`
**Conflict check:** Skipped — Tier S (see `.docs/complexity/pipeline-scope-per-task-verify-to-affected-tests-f.md`)
**Source:** intake jstoup111/ai-conductor#245

## Summary

Amend `skills/pipeline/SKILL.md` so step 3 VERIFY runs a scoped affected-test set per
task (with four fallback-to-full-suite triggers) and step 4 FIX reuses that set, leaving
batch-boundary gates and the TDD cycle untouched. 6 tasks, docs-only diff.

## Technical Approach

This is a pure Markdown instruction change — no `src/conductor` code. The pipeline skill
is executed by the conductor session reading SKILL.md, so the "implementation" is precise
skill text and the "tests" are (a) grep-level assertions that the required wording exists
and forbidden wording is gone, and (b) `test/test_harness_integrity.sh` for structural
validity. Edits are confined to the Per-Task Execution section (steps 3–4 and a new
scoping subsection placed alongside the existing step-annotation blocks like
"Failure verification (step 4)"); the Quality Gates / batch-boundary section is
deliberately not touched. Docs upkeep (README + CHANGELOG) lands in the same diff per
the repo's Docs-track-features rule.

## Prerequisites

- None (worktree already on `spec/pipeline-scope-per-task-verify-to-affected-tests-f`).

## Tasks

### Task 1: Rewrite step 3 VERIFY as the scoped-set procedure
**Story:** Story 1 — happy path (scoped set: new/changed test files + covering tests via
naming convention + import/reference grep; runner invoked with explicit file args)
**Type:** happy-path

**Steps:**
1. Assert current state (RED analogue): `grep -n "VERIFY       — Run the full test suite" skills/pipeline/SKILL.md` matches.
2. Replace the step-3 line in the Per-Task Execution block with the scoped wording:
   "VERIFY — Run the scoped affected-test set (see Scoped VERIFY below) to confirm the
   subagent's work".
3. Add a **"Scoped VERIFY (step 3)"** annotation block (sibling to "Failure verification
   (step 4)") specifying: collect the task's diff; scoped set = task's new/changed test
   files + existing test files covering modified production modules (project naming
   convention + grep for imports/references of changed modules); run via the project's
   test runner with explicit file arguments.
4. Verify (GREEN analogue): grep confirms the old unconditional full-suite step-3 line is
   gone and the new block exists.
5. Commit: "feat(pipeline): scope per-task VERIFY to affected tests"

**Files likely touched:**
- `skills/pipeline/SKILL.md` — step 3 line + new Scoped VERIFY annotation block

**Dependencies:** none

### Task 2: Require the scoped file list in the task REPORT
**Story:** Story 1 — happy path (audit trail shows the scoping decision)
**Type:** happy-path

**Steps:**
1. In the Scoped VERIFY block, add: the task's step 6 REPORT must list the files in the
   scoped set (or state that the full suite ran and why — see Task 3's triggers).
2. Verify: grep for the REPORT requirement in the new block.
3. Commit (squash with Task 1's commit if same editing session): "feat(pipeline): report scoped VERIFY file list per task"

**Files likely touched:**
- `skills/pipeline/SKILL.md` — Scoped VERIFY block

**Dependencies:** Task 1

### Task 3: Enumerate the four fallback-to-full-suite triggers
**Story:** Story 2 — happy paths (shared/core module 3+ importers; config/migrations/
test-infrastructure) and negative paths (low-confidence mapping; trigger named in report)
**Type:** negative-path

**Steps:**
1. In the Scoped VERIFY block, add a "Fallback to full suite" list with exactly four
   triggers: (a) diff touches a shared/core module imported/required by 3+ other
   production modules; (b) diff touches config, migrations, dependency manifests, or
   test infrastructure (helpers, fixtures, global setup); (c) the scoped set is empty;
   (d) the module→test mapping cannot be made confidently.
2. Add the direction sentence: "Uncertainty always resolves toward the FULL suite —
   scoping is an optimization, never a gate change."
3. Add: when a trigger fires, the task REPORT names it.
4. Verify: grep for all four triggers + the direction sentence.
5. Commit: "feat(pipeline): fallback triggers for scoped VERIFY"

**Files likely touched:**
- `skills/pipeline/SKILL.md` — Scoped VERIFY block

**Dependencies:** Task 1

### Task 4: Point step 4 FIX's failure-verification at the scoped set
**Story:** Story 1 — negative path (FIX re-verifies with the same scoped set)
**Type:** negative-path

**Steps:**
1. Amend the existing "Failure verification (step 4)" block: the confirm-the-failure
   re-run uses the task's scoped set (or the full suite if a fallback trigger fired for
   this task) — the same scope VERIFY used, so the signal is comparable.
2. Verify: grep the amended block references the scoped set.
3. Commit: "feat(pipeline): FIX failure-verification reuses the task's VERIFY scope"

**Files likely touched:**
- `skills/pipeline/SKILL.md` — Failure verification (step 4) block

**Dependencies:** Task 1, Task 3

### Task 5: Assert batch-boundary and TDD-cycle invariance
**Story:** Story 3 — happy paths + negative path (no wording permits a scoped/skipped
boundary run; TDD cycle and evaluator table untouched)
**Type:** negative-path

**Steps:**
1. Grep-assert the Quality Gates section still contains the unconditional boundary
   sentence ("Pre-batch verification (full test suite, linter, `/simplify`) still runs
   at EVERY boundary regardless of tier") — unmodified.
2. `git diff` the branch: confirm no hunk touches the TDD cycle line (step 2 DISPATCH /
   RED → DOMAIN → GREEN → DOMAIN → COMMIT), domain-review requirements, or the
   evaluator frequency/model table.
3. If either assertion fails, revert the offending hunk before proceeding.
4. Commit: none (verification-only task; fixes fold into the offending task's commit)

**Files likely touched:**
- none (read-only assertions)

**Dependencies:** Tasks 1–4

### Task 6: Docs upkeep + harness validation
**Story:** Story 3 — Done When (CHANGELOG entry; README/skill docs reflect behavior)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` → **Changed**: "pipeline: per-task VERIFY now runs
   the scoped affected-test set with fallback-to-full-suite triggers; batch-boundary
   full suite unchanged (#245)".
2. Update the pipeline description in `README.md` if it states the per-task full-suite
   behavior (grep "full test suite" in README; amend only where it describes per-task
   VERIFY).
3. Run `test/test_harness_integrity.sh` — must pass.
4. Commit: "docs: changelog + README for scoped per-task VERIFY"

**Files likely touched:**
- `CHANGELOG.md` — Unreleased/Changed entry
- `README.md` — pipeline behavior description (if present)

**Dependencies:** Tasks 1–5

## Task Dependency Graph

```
Task 1 ──► Task 2
   │
   ├─────► Task 3 ──► Task 4
   │                    │
   └────────────────────┴──► Task 5 ──► Task 6
```

## Integration Points

- After Task 4: the full amended Per-Task Execution section reads end-to-end (scoped
  VERIFY → fallback triggers → FIX reuse) — reviewable as one coherent procedure.
- After Task 6: harness integrity suite green; diff is PR-ready.

## Verification

- [ ] All happy path criteria covered by at least one task (Story 1 → T1/T2, Story 2 → T3, Story 3 → T5/T6)
- [ ] All negative path criteria covered by at least one task (Story 1 → T1 empty-set trigger in T3 + T4; Story 2 → T3; Story 3 → T5)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
