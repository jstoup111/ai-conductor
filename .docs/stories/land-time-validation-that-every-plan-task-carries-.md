**Status:** Accepted

# Stories: land-time-validation-that-every-plan-task-carries-

Technical track (no PRD). Source: jstoup111/ai-conductor#1763 (re-scoped, validator-only).
Scope boundary: land-time gate only; no BUILD-time/daemon validation, no legacy-plan grandfathering.

## Story 1: Done-when shape validator classifies every plan task

As the engineer land gate, I want a pure validator over plan text so that every task's `Done when:` block is mechanically checked for presence and shape.

### Acceptance Criteria

#### Happy Path
- Given a plan where every task carries a `**Done when:**` block of 2-5 non-blank criteria, when the validator runs, then it returns zero violations
- Given a plan task whose `Done when:` block has exactly 2 criteria and another with exactly 5, when the validator runs, then neither task is reported

#### Negative Paths
- Given a plan task with no `Done when:` block at all, when the validator runs, then it reports that task id with reason `missing`
- Given a plan task with a declared `Done when:` block containing zero list items or any blank criterion, when the validator runs, then it reports that task id with reason `blank`
- Given a plan task with exactly 1 criterion, when the validator runs, then it reports that task id with reason `too-few`
- Given a plan task with 6 criteria, when the validator runs, then it reports that task id with reason `too-many`
- Given a plan with three violating tasks of different reasons, when the validator runs, then all three violations are returned, each pairing the correct task id with its reason

### Done When
- [ ] `src/conductor/src/engine/plan-done-when.ts` exports `validatePlanDoneWhen(planText)` returning `{ taskId, reason }[]` with reasons `missing | blank | too-few | too-many`, reusing `parsePlanTaskIds`/`parsePlanTaskDoneWhen` from `plan-task-parse.ts`
- [ ] Unit tests cover zero-violation, missing, blank, too-few, too-many, and multi-violation cases and pass in the default suite

## Story 2: Engineer land rejects plans with malformed Done-when blocks

As an operator landing a spec, I want `land` to fail loudly on a plan whose tasks lack falsifiable done-criteria so that unfinishable tasks are rejected at DECIDE, not discovered at BUILD.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose plan's tasks all carry well-formed `Done when:` blocks, when `engineer land` runs, then the land proceeds past the done-when check with no error

#### Negative Paths
- Given a worktree whose plan has one task missing a `Done when:` block and one task with a single criterion, when `engineer land` runs, then land throws an error naming both task ids with their reasons (`no Done when: block` / `too-few`) and no spec commit is created
- Given a land rejected by the done-when check, when the operator inspects the worktree, then the worktree and its artifacts are left in place unmodified (keep-on-failure)

### Done When
- [ ] `land-spec.ts` calls `validatePlanDoneWhen` after the protected-targets check and throws a `landSpec:`-prefixed error enumerating every violation as `plan task <id> has <reason phrasing>`
- [ ] A land-spec test asserts a violating plan fails with the enumerated message and a conforming plan lands
