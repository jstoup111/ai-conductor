# Implementation Plan: Verify-Only-Anchored Tautology Exception (#1579)

**Date:** 2026-08-15
**Design:** .docs/decisions/adr-2026-08-15-verify-only-anchored-tautology-exemption.md
**Stories:** .docs/stories/tautology-fails-are-unfixable-when-planned-behavio.md
**Conflict check:** Clean as of 2026-08-15

## Summary

Adds a fourth closed Tautology exception (verify-only maintenance) anchored to engine-parsed plan
markers, threads the evidence through both grader lanes (monolithic prompt and rubric fan-out
projections/skills), and lands the maker-side authoring boundaries. 11 tasks.

## Technical Approach

- **Evidence derivation (D1):** `assembleBuildReviewInputs` already reads `planBody`
  (`build-review-inputs.ts:227`). Derive `verifyOnlyContext` — `{ taskId, paths }[]` for every
  task where `parsePlanTaskVerifyOnly` (`autoheal.ts:638`, exported) returns `true`, paths from
  `parsePlanTaskPaths` — beside `removalContext` (`:253`). Freeze it into `BuildReviewInputs`,
  `BuildReviewSourceSnapshot`, and the snapshot digest, mirroring `removalContext` exactly.
- **Two grader lanes must both carry the evidence.** The monolithic lane renders prompts in
  `buildGraderPrompt` (`build-review-prompt.ts`); the fan-out lane serializes per-rubric
  projections (`build-review-projections.ts`) into a generic dispatch prompt
  (`step-runners.ts:1897-1903`) whose rubric rules live in `skills/build-review-tautology/SKILL.md`
  (exception list at line 51) and `skills/build-review-completeness/SKILL.md`. The
  `TautologyProjection` is deliberately content-free and excludes `planBody` (#1600), so the
  evidence must ride `CommonProjection` inline (compact, like `removalContext` at
  `build-review-projections.ts:71`) — never as embedded plan content.
- **Prompt/skill text (D2–D4):** fifth evidence block + fourth exception + one Completeness
  guidance line in `buildGraderPrompt`; parity edits in the two rubric skills. The closed-list
  sentence and all other rubric text stay verbatim. The count-sensitive existing test
  (`build-review-prompt.test.ts:399` region) updates in the same task as the list change.
- **Maker/authoring boundaries (D5):** `tdd` + `writing-system-tests` gain the "no legitimate
  RED" boundary (declared vs discovered; discovered closes via the #677 `Evidence: skipped`
  empty-commit form, never a plan amendment); `plan` gains the marker guidance with the
  over-marking prohibition. Prose-contract tasks: no RED cycle, validated by
  `test/test_harness_integrity.sh`.
- **Sequencing:** derivation → snapshot/digest → projections, then the two prompt lanes in
  parallel, then the three authoring skills (independent).
- The two prior-story amendment notes and the conflict report were authored in DECIDE and travel
  in the spec commit — they are not build tasks (sealed-artifact prohibition).
- **Conflict report canonical path (operator amendment, 2026-08-16):** the report lives at
  `.docs/conflicts/2026-08-15-tautology-fails-are-unfixable-when-planned-behavio.md` so the
  engine's normalized-stem artifact association binds it to this feature (#1617). The original
  topic-stem file (`2026-08-15-verify-only-tautology-exemption.md`) remains in place as a short
  relocation stub — deliberately, so the diff carries a content change plus an added file rather
  than a git rename, which the tautology preflight cannot materialize (#1624). Both files are
  operator-authorized, in-plan surface; neither may be deleted or re-merged into one path.

## Prerequisites

None — all parsers and seams exist on main.

## Tasks

### Task 1: Derive verifyOnlyContext in build_review input assembly
**Story:** Story 1 — happy path (marked task yields `{taskId, paths}`; Type union; fail-closed negatives)
**Type:** happy-path

**Steps:**
1. Write failing test: assembling inputs from a plan whose Task 3 carries `**Verify-only:** yes`
   with backticked paths yields `verifyOnlyContext` `[{ taskId: '3', paths: [...] }]`; a
   `**Type:** implementation+verification` task is included; `maybe`/absent markers and a
   headerless plan yield `[]` without throwing.
2. Verify test fails (RED)
3. Implement: new `BuildReviewVerifyOnlyContext` type; derive beside `removalContext` using
   `parsePlanTaskVerifyOnly` + `parsePlanTaskPaths` imported from `autoheal.js`; expose as
   `verifyOnlyContext` on `BuildReviewInputs`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build_review): derive verify-only task evidence from the plan body"

**Files likely touched:**
- src/conductor/src/engine/build-review-inputs.ts — type + derivation + return field
- src/conductor/test/engine/build-review-inputs.test.ts — assembly tests

**Dependencies:** none

### Task 2: Freeze verifyOnlyContext into the source snapshot and its digest
**Story:** Story 1 — happy path (snapshot/digest inclusion)
**Type:** happy-path

**Steps:**
1. Write failing test: two assemblies identical except one plan task's `**Verify-only:** yes`
   marker produce different `sourceSnapshot.digest` values; the snapshot carries the frozen
   `verifyOnlyContext`.
2. Verify test fails (RED)
3. Implement: add `verifyOnlyContext` to `BuildReviewSourceSnapshot` and the
   `snapshotWithoutDigest` literal (frozen arrays, mirroring `removalContext`).
4. Verify test passes (GREEN)
5. Commit with message: "feat(build_review): include verify-only evidence in the frozen source snapshot"

**Files likely touched:**
- src/conductor/src/engine/build-review-inputs.ts — snapshot interface + literal
- src/conductor/test/engine/build-review-inputs.test.ts — digest divergence test

**Dependencies:** 1

### Task 3: Thread verifyOnlyContext through the rubric projections
**Story:** Story 1 — happy path (evidence reaches the fan-out lane); Story 2 negative (tautology projection stays content-free — evidence is compact ids+paths, never plan content)
**Type:** happy-path

**Steps:**
1. Write failing test: `deriveBuildReviewRubricProjections` output carries `verifyOnlyContext` on
   every rubric projection (CommonProjection), equal to the snapshot's value, and the projection
   digests change when it changes; the tautology projection still contains no `planBody` key.
2. Verify test fails (RED)
3. Implement: add `verifyOnlyContext: BuildReviewSourceSnapshot['verifyOnlyContext']` to
   `CommonProjection` beside `removalContext` (`build-review-projections.ts:71`), sourced from
   the snapshot in `common(...)`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build_review): carry verify-only evidence in rubric projections"

**Files likely touched:**
- src/conductor/src/engine/build-review-projections.ts — CommonProjection + common()
- src/conductor/test/engine/build-review-projections.test.ts — projection content/digest tests

**Dependencies:** 2

### Task 4: Render the verify-only evidence block in the monolithic grader prompt
**Story:** Story 2 — happy path (evidence section, evidence-not-exemption framing); negatives ((none) when empty; backtick escaping)
**Type:** happy-path

**Steps:**
1. Write failing test: prompt from inputs with a populated `verifyOnlyContext` contains an
   "Engine-parsed verify-only tasks" section listing task id + declared paths with the
   evidence-not-exemption sentence; empty context renders `(none)`; a path containing a backtick
   is escaped via `escapeEvidence`.
2. Verify test fails (RED)
3. Implement: render the block in `buildGraderPrompt` after the removal-evidence block, reusing
   `escapeEvidence`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build_review): render the verify-only evidence block in the grader prompt"

**Files likely touched:**
- src/conductor/src/engine/build-review-prompt.ts — evidence block rendering
- src/conductor/test/engine/build-review-prompt.test.ts — block/escaping/(none) tests

**Dependencies:** 1

### Task 5: Add the fourth closed exception to the monolithic prompt
**Story:** Story 2 — happy path (four exceptions, 3-condition per-test predicate); negative (closed-list "measured normally" sentence survives; schema line unchanged)
**Type:** happy-path

**Steps:**
1. Write failing test: the closed-list section enumerates four exceptions; the fourth states the
   three-condition verify-only-maintenance per-test predicate; the "qualifying under none of
   these exceptions is measured normally" sentence and the reviewer-output JSON schema line are
   unchanged. Update the existing count-sensitive assertions
   (`build-review-prompt.test.ts:399` region regex) in the same change.
2. Verify test fails (RED)
3. Implement: extend the exception list in `buildGraderPrompt` with exception 4 per ADR D3.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build_review): add the verify-only-maintenance Tautology exception"

**Files likely touched:**
- src/conductor/src/engine/build-review-prompt.ts — exception list
- src/conductor/test/engine/build-review-prompt.test.ts — four-entry list + preserved-sentence tests

**Dependencies:** 4

### Task 6: Add the Completeness verify-only guidance line to the monolithic prompt
**Story:** Story 3 — happy path (verify-only tasks contribute no required diff); negatives (holistic + no-per-task-chasing language preserved; scoped to engine-block-listed tasks only)
**Type:** happy-path

**Steps:**
1. Write failing test: the Completeness section states that a task listed in the engine-parsed
   verify-only block legitimately contributes no implementation diff; the holistic-judgement and
   forbidden-per-task-chasing sentences remain verbatim; the new line names only
   engine-block-listed tasks.
2. Verify test fails (RED)
3. Implement: add the one guidance line to the Completeness paragraph in `buildGraderPrompt`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(build_review): completeness reads the verify-only evidence block"

**Files likely touched:**
- src/conductor/src/engine/build-review-prompt.ts — completeness guidance
- src/conductor/test/engine/build-review-prompt.test.ts — guidance + preserved-language tests

**Dependencies:** 4

### Task 7: Add the fourth exception to the fan-out tautology rubric skill
**Story:** Story 2 — happy path (fan-out parity for the predicate); negative (unanchored pre-diff-passing tests still measured normally)
**Type:** infrastructure

**Steps:**
1. Edit `skills/build-review-tautology/SKILL.md`: extend "The only exceptions are rebase repair,
   removal maintenance, and fixture relocation" (line 51) to include verify-only maintenance;
   state the three-condition per-test predicate anchored to the projection's
   `verifyOnlyContext`; keep the closed-list framing and the measured-normally rule.
2. Run `test/test_harness_integrity.sh` — must pass.
3. Commit with message: "feat(build_review): verify-only exception in the tautology rubric skill"

**Files likely touched:**
- skills/build-review-tautology/SKILL.md — exception list + predicate

**Verify-only:** no
**Dependencies:** 3

### Task 8: Add the verify-only line to the fan-out completeness rubric skill
**Story:** Story 3 — happy path (fan-out parity)
**Type:** infrastructure

**Steps:**
1. Edit `skills/build-review-completeness/SKILL.md`: a task listed in the projection's
   `verifyOnlyContext` legitimately contributes no implementation diff; scope the line to
   projection-listed tasks only.
2. Run `test/test_harness_integrity.sh` — must pass.
3. Commit with message: "feat(build_review): completeness rubric skill reads verify-only evidence"

**Files likely touched:**
- skills/build-review-completeness/SKILL.md — guidance line

**Dependencies:** 3

### Task 9: Add the "no legitimate RED" boundary to the tdd skill
**Story:** Story 4 — happy path (declared + discovered cases); negatives (not applicable to behavioral change; no plan amendment; no invented assertions)
**Type:** infrastructure

**Steps:**
1. Edit `skills/tdd/SKILL.md`: add the boundary section — declared case (plan-marked
   verify-only/verification task: author at most the documenting test the plan asks for) and
   discovered case (behavior already exists, plan unmarked: do not author a test that cannot
   fail; delete any redundant test authored this lap; close the task via the existing
   `Evidence: skipped <reason>` empty-commit form from the "Commit-less Completions" section);
   name inventing unrelated assertions and amending the sealed plan as forbidden; state the
   boundary never applies to tasks that add, change, or fix behavior.
2. Run `test/test_harness_integrity.sh` — must pass.
3. Commit with message: "feat(tdd): no-legitimate-RED boundary for already-existing behavior"

**Files likely touched:**
- skills/tdd/SKILL.md — boundary section

**Dependencies:** none

### Task 10: Add the same boundary to the writing-system-tests skill
**Story:** Story 4 — happy path (acceptance-spec generation governed by the same rule)
**Type:** infrastructure

**Steps:**
1. Edit `skills/writing-system-tests/SKILL.md`: no acceptance spec is invented for
   already-existing behavior outside a plan-marked verify-only/verification task; reference the
   tdd boundary for the discovered-case exit.
2. Run `test/test_harness_integrity.sh` — must pass.
3. Commit with message: "feat(writing-system-tests): no-legitimate-RED boundary"

**Files likely touched:**
- skills/writing-system-tests/SKILL.md — boundary section

**Dependencies:** 9

### Task 11: Strengthen the plan skill's verify-only marker guidance
**Story:** Story 5 — happy path (mark verification-shaped tasks, review-load-bearing); negative (over-marking prohibition)
**Type:** infrastructure

**Steps:**
1. Edit `skills/plan/SKILL.md` (the `Verify-only:` marker section): a task that verifies or
   documents possibly-pre-existing behavior is marked `**Verify-only:** yes` (or
   `**Type:** verification`); note the marker is now review-load-bearing (Tautology/Completeness
   evidence); a task delivering new or changed behavior is NOT marked — over-marking widens the
   exemption and is forbidden.
2. Run `test/test_harness_integrity.sh` — must pass.
3. Commit with message: "feat(plan): verify-only marker is review-load-bearing"

**Files likely touched:**
- skills/plan/SKILL.md — marker guidance

**Dependencies:** 9

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─▶ Task 7
   │                     └───▶ Task 8
   ├─▶ Task 4 ─▶ Task 5
   │        └──▶ Task 6
Task 9 ─▶ Task 10
   └───▶ Task 11
```

## Integration Points

- After Task 3: both lanes' inputs carry the evidence end-to-end (assembly → snapshot →
  projections) and can be exercised in unit tests.
- After Task 6: the monolithic lane is complete — a marked plan + documenting test scenario can
  be walked through `buildGraderPrompt` output.
- After Task 8: the fan-out lane is complete.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
