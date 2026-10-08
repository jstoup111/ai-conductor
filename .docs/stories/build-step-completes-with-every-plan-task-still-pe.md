**Status:** Accepted

# Stories: BUILD cannot complete on stale task evidence

Track: technical. Source: jstoup111/ai-conductor#2014, `adr-2026-09-06-reopened-task-resolution` D11 (APPROVED amendment), and `architecture-review-2026-10-02-build-step-completes-with-every-plan-task-still-pe`.

## Story 1: A plan task whose text changed must be done again

**Requirement:** TI-1 — a change to a plan task's own text reopens that task, so commits made before the change no longer complete it.

As an operator who amends a halted feature's plan and rewinds it to build, I want every rewritten task to count as unfinished until new work or fresh close evidence exists, so that the build cannot complete on commits that implemented the old task text.

### Acceptance Criteria

#### Happy Path

- Given a feature whose plan tasks 1 and 2 were completed by commits carrying their `Task:` trailers and whose recorded task digests match those tasks, when the operator rewrites the text of tasks 1 and 2 and BUILD seeding next runs, then tasks 1 and 2 are pending in task-status and the BUILD completion predicate reports them unresolved despite the old trailers.
- Given a task reopened by a plan text change, when a commit made after the reopen carries that task's `Task:` trailer, then the task resolves and the BUILD completion predicate no longer lists it as pending.
- Given a task reopened by a plan text change whose plan entry has a `**Done when:**` block, when the build agent closes the task through the engine's task-close command with passing evidence for every Done-when check and no new commit, then the task resolves.
- Given a task reopened by a plan text change, when the reopen is recorded, then the plan-change reopen charges no kickback lap to any gate, while a `coverage_binding` reopen of the same task still charges its own `gates.coverage_binding` lap as before.
- Given the same changed task text is seen by repeated BUILD seedings or a process restart, when seeding runs again, then exactly one open reopen record exists for that task and text, and its boundary commit is unchanged.
- Given a reopened task whose text is changed a second time before it is resolved, when seeding runs, then the newer reopen replaces the older one for that task, and a single passing task close or one fresh trailered commit resolves the task.
- Given a reopened task, when an engine restart occurs before BUILD dispatch, then the next BUILD prompt still carries the reopened task and the reason it was reopened.

#### Negative Paths

- Given a plan task whose text differs only in whitespace, line wrapping, or blank lines from its recorded digest, when seeding runs, then the task is not reopened and its existing completion evidence still resolves it.
- Given a plan whose last task is followed by a non-task section such as `## Risks`, when only that trailing section is edited, then the last task is not reopened.
- Given a task reopened by a plan text change, when the only commits carrying its `Task:` trailer predate the reopen boundary, then the task stays unresolved and the BUILD completion predicate does not report done.
- Given a reopened task whose plan entry has no `**Done when:**` block, when the build agent runs the task-close command without a new commit, then the task stays unresolved and is resolved only by a commit made after the reopen carrying its `Task:` trailer.
- Given recording a reopen fails because the engine-state write fails or the present repair state is malformed, when the BUILD completion predicate runs, then it reports not done with a reason naming the reopen failure and never falls back to resolving the task from old trailers.
- Given a task reopened by an existing gate's remediation, when that task's plan text later changes, then the gate's reopen stays open and still governs the task alongside the new plan-change reopen.
- Given a feature rebased onto a new main after a plan-change reopen, when the rebase translates commit ids, then the reopen boundary follows the rebased commit and pre-boundary trailers still do not resolve the task.

### Done When

- [ ] A fixture reproducing #2014 (old trailers for tasks 1 to 6, plan tasks 1 and 2 rewritten, one new commit for an appended remediation task) leaves the BUILD completion predicate not done with tasks 1 and 2 listed as pending.
- [ ] engine-state.json holds a versioned per-plan task digest section and one open repair obligation with authority `plan_amendment` per rewritten task.
- [ ] With `coverage_binding` disabled, the kickback ledger before and after the plan-change reopen is byte-identical.

---

## Story 2: An incomplete build does not succeed and names every pending task

**Requirement:** TI-2 — BUILD reports not done while any plan task is unresolved, and the reason names every pending task by id and title. In a stacked feature, "plan task" means the active child's slice tasks plus the remediation tasks recorded to that child.

As an operator reading daemon output, I want an incomplete build to say exactly which tasks are unfinished, so that I can see what was skipped without opening `task-status.json`.

### Acceptance Criteria

#### Happy Path

- Given a BUILD session that ends with six plan tasks unresolved, when the BUILD completion predicate runs, then the step is not completed and its reason lists all six tasks, each with its id and title, without any "+N more" truncation.
- Given that incomplete BUILD, when the engine schedules a retry, then the BUILD retry hint and the `step_retry` event reason each carry the full list of pending task ids and titles, and the daemon's retry log line names every pending task id before any title text.
- Given an incomplete BUILD that trips the no-progress stall, when the stall question and any resulting HALT are written, then each names every pending task by id and title and still carries the unchanged `build stalled: no task progress` reason text.

#### Negative Paths

- Given a BUILD session that commits only an appended remediation task while plan tasks 1 to 6 stay unresolved, when the BUILD completion predicate runs, then it reports not done and lists tasks 1 to 6 by id and title.
- Given a pending task with no title in the plan heading, when the reason is built, then the task appears by id with the task-status row name as its title, and the reason is still produced.
- Given the daemon's bounded single-line retry log, when an incomplete BUILD with many pending tasks is retried, then the retry still produces exactly one bounded log line, every pending task id appears in it before any title text, and the full ids and titles remain in the `step_retry` event reason.
- Given two consecutive incomplete BUILD attempts with the same pending tasks and titles, when the retry decision compares their reasons, then they are recognized as an identical repeat exactly as before this change.

### Done When

- [ ] The completion predicate's not-done reason for a six-pending-task fixture contains all six ids and titles and no "more" suffix.
- [ ] A daemon retry-line fixture for six pending tasks is one bounded line naming all six task ids.
- [ ] The stall question and HALT text fixtures each contain every pending id and title.

---

## Story 3: A build with nothing left to do still completes cleanly

**Requirement:** TI-3 — a build whose tasks are all genuinely complete completes as today, with no false reopen or stall.

As an operator, I want builds that have legitimately finished to keep completing without extra work, so that this fix does not create false stalls or redo finished tasks.

### Acceptance Criteria

#### Happy Path

- Given every plan task is resolved and no task text changed since its digest was recorded, when the BUILD completion predicate runs, then the step completes, no repair obligation is created, and no stall is raised.
- Given a feature rewound to build with no plan text change, when BUILD seeding and completion run, then previously completed tasks stay resolved from their existing evidence and the step completes without redoing them.
- Given an in-flight feature whose plan has no recorded task digests, when BUILD seeding first runs after this change, then digests are recorded as a baseline, no task is reopened, and a fully resolved build completes.

#### Negative Paths

- Given recorded digests of an unknown digest version, when seeding runs, then the digests are re-recorded as a baseline and no task is reopened.
- Given a worktree recreated from its branch so `.pipeline/` state including recorded digests is gone, when seeding reconstructs task-status, then completed tasks are restored from their trailers, a new baseline is recorded, and no task is reopened.

### Done When

- [ ] A fully resolved fixture with matching digests completes BUILD with no new repair obligation and no `build_stall` event.
- [ ] A fixture without a digest section completes BUILD and leaves a recorded digest baseline.
