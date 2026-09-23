# Implementation Plan: One owner for accepted-story readability

**Date:** 2026-09-23
**Design:** .docs/decisions/architecture-review-2026-09-23-accepted-stories-are-never-checked-against-the-eng.md
**Stories:** .docs/stories/accepted-stories-are-never-checked-against-the-eng.md
**Conflict check:** Clean as of 2026-09-23

## Summary

Ten tasks that give accepted-story readability a single owner in `story-criteria.ts`, call it from both `landSpec` and the DECIDE `stories` gate, and route both criterion derivations through one bullet primitive so their ordinals align.

## Technical Approach

Three seams change, in dependency order.

- **Derivation (Task 1-2).** `extractAuthoritativeStoryCriteria` in `artifacts.ts` currently matches bullets line by line while its sibling `extractStoryCriterionIds` in `story-criteria.ts` uses `listItems`, which joins a bullet's indented continuation lines. Routing the first through `listItems` makes the criterion list and the id alphabet ordinal-aligned, which is what `criterionStorySection` in `conductor.ts` already assumes when it indexes one sequence with an ordinal derived from the other.
- **The predicate (Task 3).** One new export in `story-criteria.ts`, built from the primitives that module already owns, answering per story block whether its criteria are readable and naming the first story that is not. It is placed there rather than in either consumer so that neither consumer becomes the other's dependency.
- **The two consumers (Task 4-7).** `landSpec` gains a readability rung beside its existing approval and plan-reference rungs, with its own `landGateError` code. `GATE_ONLY_PREDICATES.stories` drops its private `hasPathSection` checks for the same predicate, keeping its DRAFT rung and its feature scoping. Task 7 pins their agreement over a corpus so a future private check fails a test rather than escaping to land.
- **The boundary (Task 8-10).** The new strictness is confined to land and the DECIDE gate. Tasks 8 and 9 pin that no BUILD or SHIP consumer reaches the predicate and that the `acceptance_specs` evidence derivation is unchanged in kind, which is the retroactivity bound the governing ADR inherits from `adr-2026-08-23-criterion-layer-is-structural-at-land`. Task 10 verifies the scope boundary on the diff itself.

Tasks 2, 7, 8, and 9 are expected to require no production change: they exist to pin invariants that the earlier tasks deliver, and each names in its Steps where the fix belongs if the invariant does not hold.

## Prerequisites

- None. Every primitive the predicate needs is already exported from `src/conductor/src/engine/story-criteria.ts`.

## Tasks

### Task 1: Authoritative criterion extraction uses the shared bullet primitive
**Story:** 3
**Type:** refactor

**Steps:**
1. Write failing test: in `src/conductor/test/engine/story-criteria.test.ts`, assert `extractAuthoritativeStoryCriteria` and `extractStoryCriterionIds` return equal entry counts for a story whose first Given/When/Then bullet is hard-wrapped across two lines with the continuation indented.
2. Verify test fails (RED) — the authoritative extractor drops the wrapped bullet, so the counts differ by one.
3. Implement: replace the per-line bullet match inside `extractAuthoritativeStoryCriteria` with a call to `listItems` from `story-criteria.ts`, keeping the existing `given`/`then` predicate and the `Story <id> happy|negative: ` prefix untouched.
4. Verify test passes (GREEN); re-run the existing extraction fixtures and update any that encoded the dropped-bullet behavior.
5. Commit with message: "fix(stories): derive authoritative criteria through the shared bullet primitive"

**Done when:**
- `extractAuthoritativeStoryCriteria` derives its bullets by calling `listItems` from `story-criteria.ts`, so a hard-wrapped bullet is joined before the given/then test rather than matched line by line
- a test asserts `extractAuthoritativeStoryCriteria` and `extractStoryCriterionIds` return equal entry counts for a story whose first Given/When/Then bullet is hard-wrapped across two lines with the continuation indented
- a test asserts a bullet carrying `given` on its first line and `then` on an indented continuation line appears as exactly one criterion in the authoritative list rather than being dropped
- a test asserts the two derivations return equal counts for every story in a fixture file in which every story contains at least one hard-wrapped bullet
- existing fixtures that asserted the dropped-wrapped-bullet behavior are updated to the joined expectation, and no fixture still asserts that a wrapped bullet is dropped

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — route `extractAuthoritativeStoryCriteria` through `listItems`
- src/conductor/test/engine/story-criteria.test.ts — parity and wrapped-bullet assertions

**Dependencies:** none

### Task 2: Criterion-id resolution lands on the authored section for wrapped bullets
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/conductor-story-id-derivation.test.ts`, build a three-criterion story whose first bullet is hard-wrapped and assert `criterionStorySection` returns the section the third criterion was authored under.
2. Verify test fails (RED) against the pre-Task-1 derivation, where the positional index overshoots the shortened authoritative list.
3. Implement: no production change is expected — Task 1 supplies the aligned derivation; if the test still fails, the residual defect is in `criterionStorySection`'s ordinal arithmetic and is fixed there.
4. Verify test passes (GREEN).
5. Commit with message: "test(prd-audit): pin criterion-id section resolution across wrapped bullets"

**Done when:**
- a test asserts `criterionStorySection` returns the section the bullet was authored under for the third criterion of a story whose first bullet is hard-wrapped
- a test asserts `criterionStorySection` returns a happy or negative section rather than no section for the last criterion of a story containing one hard-wrapped bullet
- the test fails when `extractAuthoritativeStoryCriteria` is reverted to line-by-line matching, proving it is bound to Task 1's derivation

**Files likely touched:**
- src/conductor/test/engine/conductor-story-id-derivation.test.ts — section-resolution assertions over wrapped bullets

**Dependencies:** 1

### Task 3: Export the accepted-story readability predicate
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: in `src/conductor/test/engine/story-criteria.test.ts`, assert a new exported predicate reports readable for a stories file whose criteria are single-line Given/When/Then bullets under headed Happy Path and Negative Paths sections.
2. Verify test fails (RED) — the export does not exist.
3. Implement: add the predicate to `story-criteria.ts`, built from `splitStoryBlocks`, `sectionBody`, and `listItems`, returning a per-story verdict plus the id of the first unreadable story.
4. Verify test passes (GREEN), including the zero-criteria and missing-Negative-Paths cases.
5. Commit with message: "feat(stories): export the accepted-story readability predicate"

**Done when:**
- `story-criteria.ts` exports one predicate taking a stories artifact's text and returning, per story block, whether its criteria are readable plus the id of any story that is not
- the predicate reports a story unreadable when it yields zero criteria through the module's own derivation, and when it carries a Happy Path section but no Negative Paths section
- a test asserts the predicate returns readable for a stories file whose criteria are single-line Given/When/Then bullets under headed Happy Path and Negative Paths sections

**Files likely touched:**
- src/conductor/src/engine/story-criteria.ts — new exported readability predicate
- src/conductor/test/engine/story-criteria.test.ts — predicate unit assertions

**Dependencies:** none

### Task 4: Land refuses an unreadable accepted stories artifact
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: in a new `src/conductor/test/engine/engineer/land-spec-story-readability.test.ts`, assert `landSpec` refuses a worktree whose Story 3 states its criteria as bold lines with one clause per bullet.
2. Verify test fails (RED) — land commits the spec today.
3. Implement: add a readability rung to the `landSpec` ladder beside the existing approval and plan-reference rungs, calling the Task 3 predicate and throwing a distinct `landGateError` code before any commit is created.
4. Verify test passes (GREEN); add the Small-tier zero-criteria and Given-only-bullet cases.
5. Commit with message: "feat(land): refuse a stories artifact the engine cannot read"

**Done when:**
- `landSpec` calls the readability predicate on the selected stories artifact and throws a distinct land-gate refusal code when any story is unreadable, before the spec is committed
- a test asserts land refuses a worktree whose Story 3 states its criteria as bold lines with one clause per bullet, and that the refusal message contains `Story 3`
- a test asserts land refuses a Small-tier worktree that authors no coherence artifact and whose only story yields zero readable criteria, and that no commit is created
- a test asserts land refuses a worktree whose Story 2 states four readable criteria plus one bullet carrying only a Given clause, and that the refusal message contains `Story 2`

**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.ts — readability rung and refusal code
- src/conductor/test/engine/engineer/land-spec-story-readability.test.ts — land refusal assertions

**Dependencies:** 3

### Task 5: The land refusal states the required shape, and readable specs land unchanged
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: assert the refusal message from Task 4 contains the required-shape sentence naming headed Happy Path or Negative Paths sections and one single-line Given/When/Then bullet per criterion.
2. Verify test fails (RED) — the refusal names the story but not the shape.
3. Implement: extend the refusal message with that sentence, matching the wording of the existing `stories-not-approved` refusal.
4. Verify test passes (GREEN); assert a fully readable worktree still commits and still reaches the approval and plan-reference rungs.
5. Commit with message: "feat(land): name the required story shape in the readability refusal"

**Done when:**
- the refusal message states that each criterion must be one single-line Given/When/Then bullet under a headed Happy Path or Negative Paths section, and a test asserts that sentence is present
- a test asserts a worktree whose stories file states every story's criteria as single-line Given/When/Then bullets under headed sections commits, and that no readability refusal is raised
- a test asserts that for a readable five-story worktree the existing approval and plan-reference rungs still run and still produce their own refusals when violated

**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.ts — refusal message wording
- src/conductor/test/engine/engineer/land-spec-story-readability.test.ts — message and happy-path assertions

**Dependencies:** 4

### Task 6: The DECIDE stories gate reads its verdict from the shared predicate
**Story:** 2
**Type:** refactor

**Steps:**
1. Write failing test: in `src/conductor/test/engine/gate-scope-441.test.ts`, assert land and `GATE_ONLY_PREDICATES.stories` both refuse a file whose Story 2 has a Happy Path section and no Negative Paths section, each naming `Story 2`.
2. Verify test fails (RED) — the gate names the file and the missing path in its own wording, produced by its own `hasPathSection` checks.
3. Implement: replace the gate's per-story `hasPathSection` checks with a call to the Task 3 predicate, leaving its DRAFT rung and its `resolveFeatureStoriesPath` scoping untouched.
4. Verify test passes (GREEN); assert stubbing the predicate changes both consumers' verdicts.
5. Commit with message: "refactor(gates): route the stories gate through the shared readability predicate"

**Done when:**
- `GATE_ONLY_PREDICATES.stories` obtains its per-story verdict by calling the readability predicate instead of its own `hasPathSection` checks, keeping its existing DRAFT and feature-scoping rungs
- a test asserts both land and the gate refuse a stories file in which Story 2 carries a Happy Path section and no Negative Paths section, each naming `Story 2` in its refusal
- a test asserts land and the gate reach their verdict through the same exported predicate — stubbing it changes both — and that they agree on that file

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — rewire `GATE_ONLY_PREDICATES.stories`
- src/conductor/test/engine/gate-scope-441.test.ts — gate and cross-consumer assertions

**Dependencies:** 3

### Task 7: Cross-consumer agreement over a stories-shape corpus
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/story-criteria.test.ts`, build a fixture corpus of readable, zero-criteria, and missing-Negative-Paths stories files and evaluate every fixture through both the land rung and the gate predicate.
2. Verify test fails (RED) if either consumer is still on its own check.
3. Implement: no production change is expected — Tasks 4 and 6 supply the shared verdict; a disagreement here means one consumer retained a private check and is fixed there.
4. Verify test passes (GREEN).
5. Commit with message: "test(stories): pin land and gate agreement across the shape corpus"

**Done when:**
- a fixture corpus covering readable, zero-criteria, and missing-Negative-Paths stories files is evaluated through both the land rung and the gate predicate in one test
- the test asserts that for every fixture the two consumers agree — no fixture is accepted by one consumer and refused by the other
- the test asserts a fixture the gate accepts is also accepted by land and a fixture the gate refuses is also refused by land, and fails if either consumer is rewired to its own check

**Files likely touched:**
- src/conductor/test/engine/story-criteria.test.ts — cross-consumer corpus assertions

**Dependencies:** 4, 6

### Task 8: Readability strictness stays out of BUILD and SHIP
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: in a new `src/conductor/test/engine/story-readability-consumer-scope.test.ts`, assert daemon discovery admits a merged spec whose stories artifact the predicate refuses.
2. Verify test fails (RED) if any discovery or BUILD path consults the predicate.
3. Implement: no production change is expected — the predicate is called only from the land rung and the DECIDE gate; a failure here means a consumer was wired beyond that boundary and is unwired.
4. Verify test passes (GREEN); add the import-boundary assertion over the BUILD and SHIP step modules.
5. Commit with message: "test(daemon): pin that readability strictness never reaches BUILD or SHIP"

**Done when:**
- a test asserts the only production callers of the readability predicate are the land rung and `GATE_ONLY_PREDICATES.stories`, and fails if any BUILD or SHIP step module imports it
- a test asserts daemon discovery admits a merged spec whose stories artifact the predicate refuses, so the spec is dispatched rather than skipped and the build proceeds
- a test asserts a merged spec whose stories artifact yields zero readable criteria runs through the BUILD and SHIP step gates without any step refusing it on readability grounds

**Files likely touched:**
- src/conductor/test/engine/story-readability-consumer-scope.test.ts — consumer-boundary and discovery assertions

**Dependencies:** 6

### Task 9: acceptance_specs gains no requirement from the predicate
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/story-readability-consumer-scope.test.ts`, assert the `acceptance_specs` required-criterion set is produced solely by `extractAuthoritativeStoryCriteria`.
2. Verify test fails (RED) if the readability predicate has leaked into the evidence derivation.
3. Implement: no production change is expected — the derivation is unchanged by design; a failure means the rung was added in the wrong place and is moved to land.
4. Verify test passes (GREEN); add the merged-spec satisfiability case.
5. Commit with message: "test(acceptance-specs): pin the unchanged required-evidence derivation"

**Done when:**
- a test asserts the `acceptance_specs` required-evidence derivation calls no readability predicate and its required criterion set is produced solely by `extractAuthoritativeStoryCriteria`
- a test asserts a merged spec whose stories artifact the predicate would refuse still produces a satisfiable `acceptance_specs` requirement set, unchanged in kind from before the predicate existed

**Files likely touched:**
- src/conductor/test/engine/story-readability-consumer-scope.test.ts — evidence-derivation assertions

**Dependencies:** 1

### Task 10: Scope boundary holds: no other feature stories artifact is touched
**Story:** 4
**Type:** verification

**Steps:**
1. Inspect the feature's `base...HEAD` diff restricted to the repository's stories artifact directory and list every path it reports.
2. Confirm the list contains exactly this feature's own stories artifact and nothing else, added, modified, or deleted.
3. Record the result on an empty commit carrying the task trailer and an `Evidence: skipped` trailer naming the inspected diff range.

**Done when:**
- the feature's `base...HEAD` diff lists exactly one path in the repository's stories artifact directory, this feature's own artifact, and no other stories file appears as added, modified, or deleted
- the verification is recorded on an empty commit carrying the task trailer and an `Evidence: skipped` trailer naming the inspected diff range

**Files:** none

**Verify-only:** yes

**Dependencies:** none

## Task Dependency Graph

```text
Task 1 ──┬── Task 2
         └── Task 9
Task 3 ──┬── Task 4 ── Task 5
         └── Task 6 ──┬── Task 8
                      │
Task 4 + Task 6 ──────┴── Task 7
Task 10 (independent)
```

## Integration Points

- After Task 4: land refuses an unreadable stories artifact end to end, through the real `landSpec` ladder.
- After Task 6: both production consumers of the readability question reach it through one predicate.
- After Task 8: the confinement of that strictness to land and the DECIDE gate is pinned by test.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a spec worktree whose stories file states every story's criteria as single-line Given/When/Then bullets under headed Happy Path and Negative Paths sections, when land runs, then the spec commits and no readability refusal is raised | 5 | "a test asserts a worktree whose stories file states every story's criteria as single-line Given/When/Then bullets under headed sections commits, and that no readability refusal is raised" | diff-local |
| Story 1 happy: Given a spec worktree whose stories file has five stories all stating readable criteria, when land runs, then land reaches its existing approval and plan-reference checks unchanged | 5 | "a test asserts that for a readable five-story worktree the existing approval and plan-reference rungs still run and still produce their own refusals when violated" | diff-local |
| Story 1 negative: Given a spec worktree whose Story 3 states its criteria as bold lines followed by one clause per bullet, when land runs, then land refuses and the refusal names Story 3 | 4 | "a test asserts land refuses a worktree whose Story 3 states its criteria as bold lines with one clause per bullet, and that the refusal message contains `Story 3`" | diff-local |
| Story 1 negative: Given the refusal raised for Story 3, when the operator reads the message, then it states that each criterion must be one single-line Given/When/Then bullet under a headed Happy Path or Negative Paths section | 5 | "the refusal message states that each criterion must be one single-line Given/When/Then bullet under a headed Happy Path or Negative Paths section, and a test asserts that sentence is present" | diff-local |
| Story 1 negative: Given a Small-tier spec worktree that authors no coherence artifact and whose only story yields zero readable criteria, when land runs, then land refuses rather than committing the spec | 4 | "a test asserts land refuses a Small-tier worktree that authors no coherence artifact and whose only story yields zero readable criteria, and that no commit is created" | diff-local |
| Story 1 negative: Given a spec worktree whose Story 2 states four readable criteria and one bullet carrying only a Given clause, when land runs, then land refuses and the refusal names Story 2 | 4 | "a test asserts land refuses a worktree whose Story 2 states four readable criteria plus one bullet carrying only a Given clause, and that the refusal message contains `Story 2`" | diff-local |
| Story 2 happy: Given any stories file, when land and the `stories` step gate each evaluate it, then both obtain their verdict from the single predicate exported by `story-criteria.ts` | 6 | "a test asserts land and the gate reach their verdict through the same exported predicate — stubbing it changes both — and that they agree on that file" | diff-local |
| Story 2 happy: Given a stories file the `stories` step gate accepts, when land evaluates that same file, then land accepts it | 7 | "the test asserts a fixture the gate accepts is also accepted by land and a fixture the gate refuses is also refused by land, and fails if either consumer is rewired to its own check" | diff-local |
| Story 2 negative: Given a stories file in which Story 2 carries a Happy Path section and no Negative Paths section, when land evaluates it, then land refuses naming Story 2, matching the `stories` step gate's refusal on the same file | 6 | "a test asserts both land and the gate refuse a stories file in which Story 2 carries a Happy Path section and no Negative Paths section, each naming `Story 2` in its refusal" | diff-local |
| Story 2 negative: Given a stories file the `stories` step gate refuses, when land evaluates that same file, then land refuses it as well | 7 | "the test asserts a fixture the gate accepts is also accepted by land and a fixture the gate refuses is also refused by land, and fails if either consumer is rewired to its own check" | diff-local |
| Story 2 negative: Given a corpus of stories files spanning readable, zero-criteria, and missing-section shapes, when both consumers evaluate every file, then no file is accepted by one consumer and refused by the other | 7 | "the test asserts that for every fixture the two consumers agree — no fixture is accepted by one consumer and refused by the other" | diff-local |
| Story 3 happy: Given a story whose Given/When/Then bullet is hard-wrapped across two lines with the continuation indented, when the authoritative criterion list and the criterion id list are derived from it, then both contain the same number of entries | 1 | "a test asserts `extractAuthoritativeStoryCriteria` and `extractStoryCriterionIds` return equal entry counts for a story whose first Given/When/Then bullet is hard-wrapped across two lines with the continuation indented" | diff-local |
| Story 3 happy: Given a story stating three criteria of which the first is hard-wrapped, when the id for the third criterion is resolved to its happy or negative section, then the section returned is the one that bullet was authored under | 2 | "a test asserts `criterionStorySection` returns the section the bullet was authored under for the third criterion of a story whose first bullet is hard-wrapped" | diff-local |
| Story 3 negative: Given a bullet carrying its Given clause on the first line and its Then clause on an indented continuation line, when the authoritative criterion list is derived, then that bullet appears as one criterion rather than being dropped | 1 | "a test asserts a bullet carrying `given` on its first line and `then` on an indented continuation line appears as exactly one criterion in the authoritative list rather than being dropped" | diff-local |
| Story 3 negative: Given a story containing one hard-wrapped bullet, when the id for its last criterion is resolved, then a happy or negative section is returned rather than no section | 2 | "a test asserts `criterionStorySection` returns a happy or negative section rather than no section for the last criterion of a story containing one hard-wrapped bullet" | diff-local |
| Story 3 negative: Given a stories file in which every story contains at least one hard-wrapped bullet, when the authoritative criterion list and the criterion id list are derived, then their entry counts are equal for every story in the file | 1 | "a test asserts the two derivations return equal counts for every story in a fixture file in which every story contains at least one hard-wrapped bullet" | diff-local |
| Story 4 happy: Given a merged spec whose stories file the readability predicate would refuse, when the daemon discovers and dispatches it, then discovery admits it and the build proceeds | 8 | "a test asserts daemon discovery admits a merged spec whose stories artifact the predicate refuses, so the spec is dispatched rather than skipped and the build proceeds" | diff-local |
| Story 4 happy: Given that merged spec reaching `acceptance_specs`, when the step derives its required evidence, then the readability predicate adds no requirement the step did not already impose | 9 | "a test asserts the `acceptance_specs` required-evidence derivation calls no readability predicate and its required criterion set is produced solely by `extractAuthoritativeStoryCriteria`" | diff-local |
| Story 4 negative: Given a merged spec whose stories file yields zero readable criteria, when the feature runs through BUILD and SHIP, then no BUILD or SHIP step refuses it on readability grounds | 8 | "a test asserts a merged spec whose stories artifact yields zero readable criteria runs through the BUILD and SHIP step gates without any step refusing it on readability grounds" | diff-local |
| Story 4 negative: Given a merged spec whose stories file is missing a Negative Paths section, when the daemon evaluates it for dispatch, then it is dispatched rather than skipped | 8 | "a test asserts daemon discovery admits a merged spec whose stories artifact the predicate refuses, so the spec is dispatched rather than skipped and the build proceeds" | diff-local |
| Story 4 negative: Given this feature's own change set, when the diff is inspected, then no other feature's stories artifact is added, modified, or deleted | 10 | "the feature's `base...HEAD` diff lists exactly one path in the repository's stories artifact directory, this feature's own artifact, and no other stories file appears as added, modified, or deleted" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-23-one-owner-for-accepted-story-readability#D1 | task | task-3, task-4, task-6 | a test asserts land and the gate reach their verdict through the same exported predicate — stubbing it changes both — and that they agree on that file |
| adr-2026-09-23-one-owner-for-accepted-story-readability#D2 | task | task-1, task-2 | `extractAuthoritativeStoryCriteria` derives its bullets by calling `listItems` from `story-criteria.ts`, so a hard-wrapped bullet is joined before the given/then test rather than matched line by line |
| adr-2026-09-23-one-owner-for-accepted-story-readability#D3 | task | task-8, task-9 | a test asserts the only production callers of the readability predicate are the land rung and `GATE_ONLY_PREDICATES.stories`, and fails if any BUILD or SHIP step module imports it |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
