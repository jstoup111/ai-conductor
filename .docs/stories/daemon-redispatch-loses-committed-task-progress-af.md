**Status:** Accepted

# Stories: Task-status recovery after abrupt daemon death (#2673)

Track: technical

Tier: M

Scope boundary (operator-confirmed 2026-10-03, minimal): a plan task with no task-status row is restored from its branch-scoped `Task:` trailer on every seed; a stale `in_progress` row with no trailer is reset to `pending` only at the pre-BUILD dispatch seed; an `in_progress` row whose task has a trailer is left unchanged. Clearing `.pipeline/current-task`, upgrading `in_progress` rows to `completed`, and moving task progress out of the worktree are out of scope. Governed by `adr-2026-09-06-reopened-task-resolution` decision 12.

## Story 1: A single missing task row is restored from its Task trailer

As the daemon resuming a feature after abrupt death, I want a task whose row alone was lost to be restored from its committed `Task:` trailer so that finished, committed work is not redone.

### Acceptance Criteria

#### Happy Path

- Given a usable task-status.json with rows for every plan task except task 18, and a commit after the merge-base with origin carrying the trailer `Task: 18`, when the task seed runs, then task 18 has a row with status completed, that commit's sha, and restored_from task-trailer, and every other row keeps its prior status and commit.
- Given a usable task-status.json with rows for every plan task except task 18, and no commit after the merge-base carries a `Task: 18` trailer, when the task seed runs, then task 18 has a row with status pending.

#### Negative Paths

- Given task 18 has an existing pending row and a commit after the merge-base carries the trailer `Task: 18`, when the task seed runs, then task 18 stays pending.
- Given task 18 has no row, a commit after the merge-base carries the trailer `Task: 18`, and an open repair obligation exists for task 18, when the task seed runs, then task 18 has a row with status pending.
- Given task 18 has no row and the only commit carrying the trailer `Task: 18` is on origin's default branch at or before the merge-base, when the task seed runs, then task 18 has a row with status pending.
- Given task 18 has no row and the origin ref or merge-base cannot be resolved, when the task seed runs, then task 18 has a row with status pending and the seed completes without throwing.

### Done When

- [ ] `src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts` removes only task 18's row from an otherwise populated task-status.json, runs the real seed, and asserts task 18 is completed with its trailer commit and task 19 is the first non-completed row.
- [ ] Unit tests in the task-seed test suite cover each negative path above against a real temporary git repository.
- [ ] A unit test shows that a seed where every plan task already has a row does not run the trailer scan.

## Story 2: A stale in-progress task becomes pending at the dispatch boundary

As the daemon redispatching BUILD after abrupt death, I want an in-progress task with no committed work to become pending so that it is redispatched instead of being treated as live work.

### Acceptance Criteria

#### Happy Path

- Given task 19 has an in_progress row with no commit and no commit after the merge-base carries the trailer `Task: 19`, when the pre-BUILD dispatch seed runs, then task 19 has status pending.

#### Negative Paths

- Given task 19 has an in_progress row and a commit after the merge-base carries the trailer `Task: 19`, when the pre-BUILD dispatch seed runs, then task 19 stays in_progress.
- Given task 19 has an in_progress row with no trailer, when a seed other than the pre-BUILD dispatch seed runs (the build completion check, remediation append, or repair restage), then task 19 stays in_progress.
- Given task 19 has an in_progress row and the origin ref or merge-base cannot be resolved, when the pre-BUILD dispatch seed runs, then task 19 has status pending and the seed completes without throwing.

### Done When

- [ ] `src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts` seeds task 19 as in_progress with no trailer, runs the pre-BUILD dispatch seed entry point, and asserts task 19 is pending with no commit and no row became completed.
- [ ] Unit tests cover the trailer-present, non-dispatch-seed, and unresolvable-range negative paths.

## Story 3: Recovery preserves existing progress and dispatchability

As the operator, I want recovery after daemon death to leave completed work, the event log, and DECIDE state untouched, and the feature dispatchable, so that resuming needs no manual action.

### Acceptance Criteria

#### Happy Path

- Given tasks 1 through 18 have completed rows with commits, task 19 has a stale in_progress row, and `.pipeline/events.jsonl` and the DECIDE step statuses exist from before the death, when the pre-BUILD dispatch seed runs, then tasks 1 through 18 keep their completed status and commits, `.pipeline/events.jsonl` is byte-identical, and every DECIDE step status is unchanged.
- Given an unfinished feature whose worktree has no HALT marker after daemon death, when the daemon next polls its backlog, then the feature is dispatched without operator action.

#### Negative Paths

- Given task 5 has a completed row and no commit after the merge-base carries the trailer `Task: 5`, when any task seed runs, then task 5 stays completed with its recorded commit.
- Given an unfinished feature with no HALT marker whose task-status.json was left unparseable by the death, when the daemon next polls its backlog and the pre-BUILD dispatch seed runs, then the feature is dispatched and every trailer-proven task has a completed row.

### Done When

- [ ] `src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts` keeps its preserved-progress and no-HALT redispatch cases passing alongside the restored Story 1 and Story 2 cases.
- [ ] A unit test shows a completed row without a matching trailer survives both the ordinary seed and the pre-BUILD dispatch seed.
