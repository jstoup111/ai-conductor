# Implementation Plan: land-time-validation-that-every-plan-task-carries-

**Date:** 2026-08-24
**Stories:** .docs/stories/land-time-validation-that-every-plan-task-carries-.md
**Conflict check:** Skipped — Tier S

## Summary

Port the `Done when:` shape validator from the retained branch and wire it into the engineer land
gate. 3 tasks.

## Technical Approach

A pure function `validatePlanDoneWhen(planText)` in a new `src/conductor/src/engine/plan-done-when.ts`
iterates `parsePlanTaskIds(planText)` and checks each id against `parsePlanTaskDoneWhen(planText)`
(both already on main in `src/conductor/src/engine/plan-task-parse.ts`, used by `task-progress.ts`
and `task-cli.ts`). Violation reasons: `missing` (no block), `blank` (zero criteria or any blank
criterion), `too-few` (<2), `too-many` (>5). The reference implementation exists on branch
`feat/daemon-plan-tasks-lack-falsifiable-done-criteria-so-revie` and ports without changes; the one
call site goes in `src/conductor/src/engine/engineer/land-spec.ts` immediately after the
`scanPlanProtectedTargets` rejection, throwing a `landSpec:`-prefixed error that enumerates every
`plan task <id> has <reason>` violation. No filesystem access in the validator; land already reads
the plan text. Test pattern: follow the existing unit tests around `plan-task-parse` and the
existing `land-spec` engineer tests (search `src/conductor/test` for `plan-task-parse` and
`land-spec`/`landSpec` fixtures that build a worktree with stories+plan content strings).

## Prerequisites

None — parsers and land-spec plumbing already exist on main.

## Tasks

### Task 1: Port validatePlanDoneWhen with zero-violation happy path
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing unit test: a plan text with two tasks, each carrying a `**Done when:**` block of 2 and 5 non-blank criteria respectively, returns `[]` from `validatePlanDoneWhen`
2. Verify test fails (RED — module does not exist)
3. Implement `src/conductor/src/engine/plan-done-when.ts` by porting the function from branch `feat/daemon-plan-tasks-lack-falsifiable-done-criteria-so-revie` (exports `PlanDoneWhenViolationReason`, `PlanDoneWhenViolation`, `validatePlanDoneWhen`), importing `parsePlanTaskDoneWhen` and `parsePlanTaskIds` from `./plan-task-parse.js`
4. Verify test passes (GREEN)
5. Commit with message: "feat(engine): add plan Done-when shape validator"

**Done when:**
- `src/conductor/src/engine/plan-done-when.ts` exports `validatePlanDoneWhen(planText: string)` returning `readonly PlanDoneWhenViolation[]` with reason union `'missing' | 'too-few' | 'too-many' | 'blank'`
- The new unit test file asserts the 2-criteria and 5-criteria tasks produce zero violations and passes in the default suite
- The validator performs no filesystem access (its module imports only from `./plan-task-parse.js`)

**Files likely touched:**
- src/conductor/src/engine/plan-done-when.ts — new validator module
- src/conductor/test/engine/plan-done-when.test.ts — new unit test file

**Dependencies:** none

### Task 2: Validator negative paths — missing, blank, too-few, too-many, multi-violation
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing unit tests in the Task 1 test file, one case per reason: task with no `Done when:` block → `{ taskId, reason: 'missing' }`; declared block with zero list items → `blank`; block with a whitespace-only criterion → `blank`; block with exactly 1 criterion → `too-few`; block with 6 criteria → `too-many`
2. Add a multi-violation case: one plan text with three tasks violating three different reasons returns all three violations with correct id/reason pairing
3. Verify the cases fail or pass appropriately (RED for any behavior the Task 1 port misses)
4. Adjust the ported implementation only if a case fails
5. Commit with message: "test(engine): cover Done-when validator violation reasons"

**Done when:**
- The unit test file contains passing assertions for each of the four reasons (`missing`, `blank` — both zero-item and whitespace-criterion forms, `too-few`, `too-many`)
- The multi-violation assertion passes: three violating tasks yield exactly three violations, each pairing the correct task id with its reason
- The full default unit suite passes with no other test file modified

**Files likely touched:**
- src/conductor/test/engine/plan-done-when.test.ts — negative-path cases
- src/conductor/src/engine/plan-done-when.ts — only if a case exposes a porting gap

**Dependencies:** 1

### Task 3: Wire validator into land-spec and reject violating plans
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing land-spec test following the existing landSpec test fixtures: a worktree whose plan has one task with no `Done when:` block and one task with a single criterion; assert land rejects with a `landSpec:`-prefixed error naming both task ids — the missing one as `no Done when: block` and the other as an invalid block with reason `too-few` — and that no spec commit is created
2. Add the happy-path assertion: an otherwise-identical fixture whose tasks each carry 2 well-formed criteria lands past the done-when check without error
3. Verify tests fail (RED — land-spec does not yet call the validator)
4. Implement: in `src/conductor/src/engine/engineer/land-spec.ts`, immediately after the `scanPlanProtectedTargets` violation throw, call `validatePlanDoneWhen(planContent)` and, on violations, throw one error enumerating every violation as `plan task <id> has no Done when: block` or `plan task <id> has an invalid Done when: block (<reason>)`, joined with `; `
5. Verify tests pass (GREEN), then commit with message: "feat(engineer): reject land when plan tasks lack falsifiable Done-when blocks"

**Done when:**
- `src/conductor/src/engine/engineer/land-spec.ts` calls `validatePlanDoneWhen` exactly once, positioned after the protected-targets rejection and before the stories-reference resolution
- The land-spec test asserts the two-violation fixture fails with an error naming both task ids and both reason phrasings, and that the worktree is left in place (keep-on-failure) with no spec commit created
- The land-spec test asserts the conforming fixture proceeds past the done-when check with no error
- The full default test suite passes

**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.ts — validator call + enumerated error
- src/conductor/test/engine/engineer/land-spec.test.ts — violation and conforming fixtures

**Dependencies:** 1, 2

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3
```

## Integration Points

- After Task 3: engineer land end-to-end rejects a malformed plan and accepts a conforming one.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
