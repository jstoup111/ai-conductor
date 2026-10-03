# Plan: BUILD cannot complete on stale task evidence

**Date:** 2026-10-02
**Source:** jstoup111/ai-conductor#2014
**Stories:** .docs/stories/build-step-completes-with-every-plan-task-still-pe.md
**Complexity:** M
**Conflict check:** Clean as of 2026-10-02

## Summary

Close #2014 in 14 tasks: a change to a plan task's own text reopens that task through the existing repair-obligation machinery (adr-2026-09-06-reopened-task-resolution D11), the BUILD not-done reason names every pending task by id and title, and finished builds keep completing cleanly.

## Technical Approach

- **Root cause.** The BUILD predicate resolves a task from a completed row OR any `Task:` trailer in `merge-base..HEAD` (`resolveTaskIds` in task-progress.ts). After an operator rewrites plan tasks and rewinds, trailers from commits that implemented the old text still resolve the rewritten tasks. Repair obligations already make pre-boundary trailers ineffective, but nothing admits one for a plan change.
- **Digest (Tasks 1, 2).** `planTaskDigests` in plan-task-parse.ts hashes each task's whitespace-normalized heading and body, ending at the next same-or-higher heading, prefixed `v1:`. Digests persist per plan identity in a new `taskDigests` engine-state section written only through the serialized `createEngineStateStore(...).update` seam.
- **Admission (Tasks 3, 4, 6, 14).** `seedTaskStatus` compares current and recorded digests before its existing open-obligation read. A changed digest admits a `plan_amendment` obligation directly through `RepairObligationStore.admitOrReplay` (never `admitAndRestageRepair`, which re-seeds and would recurse), marks it settled, charges no lap, then records the digest. The existing restage loop flips the row to pending. A missing or unknown-version digest records a baseline and reopens nothing. Admission failure fails the predicate closed with a `task reopen failed:` reason.
- **Reason (Tasks 10, 11, 12).** The BUILD predicate's not-done reason keeps its `N/M tasks pending/not completed:` prefix, lists every pending id first, then id/title pairs. Ids first means the bounded single daemon retry line (unchanged, per the retry-log stories) still names every id; full titles travel in the retry hint, `step_retry`, the stall question and the HALT. The `build stalled: no task progress` text stays byte-identical.
- **Unchanged paths (Tasks 7, 9, 13).** Resolution, task close, rebase translation and clean completion are existing mechanisms; verification tasks pin that they govern the new obligation source correctly.
- **Sequencing.** Tasks 1 → 2 → 3, then 4-9, 13 and 14 fan out from 3. Tasks 10 → 11, 12 are independent of the digest chain.

## Prerequisites

- None. No new package, service, config key, or CLI surface.

## Tasks

### Task 1: Digest each plan task's normalized text

**Story:** 1
**Type:** infrastructure
**Files:** `src/conductor/src/engine/plan-task-parse.ts`, `src/conductor/test/engine/plan-task-parse.test.ts`
**Dependencies:** none

**Steps:**
1. Write failing unit tests in plan-task-parse.test.ts for a new exported `planTaskDigests(planText)` that returns, per canonical task id, a versioned digest string `v1:sha256:<hex>`.
2. Implement it beside `parsePlanTaskBodies`, sharing `TASK_HEADER_PATTERN` and its fence skipping so ids agree with the BUILD predicate's id source. Digest the heading title plus body, normalized the way `claimDigest` in coverage-binding-envelope.ts normalizes (collapse every whitespace run to one space, trim). End a task's span at the next markdown heading of the same or higher level, not only at the next task heading, so a trailing non-task section such as `## Risks` is excluded. Multi-id headings share one digest per id.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- `planTaskDigests` returns identical digests for two plan texts whose task differs only in whitespace runs, line wrapping, or blank lines, as asserted by the whitespace-normalization unit test.
- `planTaskDigests` returns a different digest for a task whose heading title or a body word changed, and unchanged digests for every other task in that plan.
- For a plan whose last task is followed by a `## Risks` section, editing only that section leaves the last task's `planTaskDigests` value unchanged.
- Every digest value starts with the `v1:` version prefix and the returned ids equal the ids `parsePlanTaskPaths` returns for the same plan fixture.

### Task 2: Persist per-plan task digests in engine state

**Story:** 1
**Type:** infrastructure
**Files:** `src/conductor/src/engine/task-digests.ts`, `src/conductor/test/engine/task-digests.test.ts`
**Dependencies:** Task 1

**Steps:**
1. Write failing tests for a new task-digests.ts module exposing `readTaskDigests(projectRoot, planPath)` and `recordTaskDigests(projectRoot, planPath, digests)`.
2. Store an additive top-level `taskDigests` section `{ version: 1, byPlan: { [planIdentity]: { [taskId]: digest } } }` in engine-state.json. Key plans by `repairPlanIdentity`. Write only through `createEngineStateStore(path).update(...)`, spreading the existing state so unrelated sections (including `repairObligations` and `activePlanPath`) survive, following `recordAppendedRemediationTaskIds`. Parse the section like repair-obligations' `parseSection`: absent returns `{ kind: 'absent' }`, a present but malformed section returns `{ kind: 'incompatible', message }`.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- `recordTaskDigests` followed by `readTaskDigests` round-trips the digest map for one plan identity and leaves a pre-existing `repairObligations` section byte-identical, as asserted by the preservation test.
- `readTaskDigests` returns `absent` for engine state with no `taskDigests` section and `incompatible` with a message for a section whose `version` is not 1 or whose byPlan value is not a string map.
- All digest writes go through `createEngineStateStore(...).update`, and two concurrent `recordTaskDigests` calls for different plans both persist, as asserted by the concurrent-writer test.

### Task 3: Reopen a rewritten task at BUILD seeding

**Story:** 1
**Type:** happy-path
**Files:** `src/conductor/src/engine/task-seed.ts`, `src/conductor/src/engine/repair-obligations.ts`, `src/conductor/test/engine/task-seed.test.ts`, `src/conductor/test/engine/artifacts.test.ts`
**Dependencies:** Task 2

**Steps:**
1. Write a failing BUILD-predicate test in artifacts.test.ts reproducing #2014: a git fixture where commits carrying `Task: 1` and `Task: 2` trailers exist, digests were recorded, then plan tasks 1 and 2 are rewritten and one new commit carries only an appended remediation task trailer.
2. In `seedTaskStatus`, after resolving the plan and BEFORE its existing open-obligation read, compute `planTaskDigests`, read recorded digests, and for each task whose recorded digest differs call `createRepairObligationStore(...).admitOrReplay` directly (never `admitAndRestageRepair`, which re-seeds) with authority `plan_amendment`, the new digest as finding id, an instruction naming the task and saying its plan text changed since it was implemented, and a baseline from `currentCommitSha`/`currentTreeHash` plus the currently resolved task ids. Then `markSettled` the obligation, and only after admission persists, record the new digests. The existing open-obligation loop then restages the row to pending with no new restage code.
3. Correct the stale comments in task-seed.ts and in the BUILD predicate that name a build_review completeness rubric as the backstop; that rubric was retired in #1824.
4. Run the scoped tests to GREEN and commit.

**Done when:**
- In the #2014 git fixture, `checkStepCompletion` for `build` returns `done: false` and its reason lists tasks 1 and 2 as pending, although commits carrying `Task: 1` and `Task: 2` trailers exist before the reopen.
- After that evaluation, task-status rows for tasks 1 and 2 are `pending`, and engine state holds one open repair obligation per rewritten task with source authority `plan_amendment`, its new digest as finding id, settlement `settled`, and a baseline head equal to HEAD at detection.
- A seed-level test asserts `seedTaskStatus` admits through `RepairObligationStore.admitOrReplay` and never invokes `admitAndRestageRepair`, and the recorded digest for a rewritten task is written only after its obligation is persisted, which in turn happens before the task-status row is restaged to pending.

### Task 4: Keep plan-change reopens idempotent, lap-free and separate from gate reopens

**Story:** 1
**Type:** negative-path
**Files:** `src/conductor/src/engine/task-seed.ts`, `src/conductor/src/engine/repair-obligations.ts`, `src/conductor/test/engine/task-seed.test.ts`, `src/conductor/test/engine/repair-obligations.test.ts`
**Dependencies:** Task 3

**Steps:**
1. Write failing tests in task-seed.test.ts and repair-obligations.test.ts for the four cases in Done when.
2. Key admission as `plan_amendment:<canonical task id>:<digest>` so a replay returns the same obligation. When admitting a newer `plan_amendment` obligation for a task, close each older open obligation for that task whose authority is `plan_amendment` through the store's `close` with evidence kind `superseded-by-plan-amendment`; never touch obligations of any other authority. Admission writes no kickback-ledger entry and records no pending repair.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- Running `seedTaskStatus` three times, and again after re-creating the store from disk to simulate a restart, with the same changed digest leaves exactly one open `plan_amendment` obligation for the task with an unchanged baseline head.
- With `coverage_binding` disabled, the kickback ledger file is byte-identical before and after a `plan_amendment` reopen, and no `pendingRepair` entry is recorded; in a fixture where a `coverage_binding` reopen of the same task is also admitted, `gates.coverage_binding` laps still increase by one.
- A second text change to an unresolved reopened task closes the older `plan_amendment` obligation with evidence kind `superseded-by-plan-amendment` and leaves one open obligation; a single fresh `Task:` trailer commit or one passing `completeTaskDoneWhen` then resolves the task in `resolveTaskIds`.
- When a task already has an open obligation admitted by `prd_audit` remediation and its plan text then changes, both obligations stay open after seeding, and the task resolves only once each is satisfied.

### Task 5: Do not reopen tasks for formatting or trailing-section edits

**Story:** 1
**Type:** negative-path
**Files:** `src/conductor/test/engine/task-seed.test.ts`
**Dependencies:** Task 3

**Steps:**
1. Write seed-level tests that change only whitespace inside a completed task, and only a trailing `## Risks` section after the last completed task, then seed and evaluate the BUILD predicate.
2. If either reopens a task, fix the span or normalization in `planTaskDigests` (Task 1) rather than special-casing seeding.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- After a whitespace-only, line-wrap or blank-line edit to a completed task, `seedTaskStatus` admits no repair obligation, the row stays `completed`, and `checkStepCompletion` for `build` still resolves it from its existing `Task:` trailer.
- After editing only a `## Risks` section that follows the last task, `seedTaskStatus` admits no repair obligation for the last task and its row stays `completed`.

### Task 6: Fail the BUILD predicate closed when a reopen cannot be recorded

**Story:** 1
**Type:** negative-path
**Files:** `src/conductor/src/engine/task-seed.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/task-seed.test.ts`, `src/conductor/test/engine/artifacts.test.ts`
**Dependencies:** Task 3

**Steps:**
1. Write failing tests that inject a failing engine-state write, and a malformed present `repairObligations` section, during a digest-change admission.
2. Make `seedTaskStatus` surface the admission or digest-write failure as a typed seed failure that `checkStepCompletion` converts to `done: false` with a reason starting `task reopen failed:` and naming the task and cause. Do not record the new digest and do not fall back to trailer resolution for that task.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- With an injected engine-state write failure during a digest-change admission, `checkStepCompletion` for `build` returns `done: false` with a reason containing `task reopen failed:` and the task id, even though a `Task:` trailer for that task exists.
- With a malformed present `repairObligations` section, the same evaluation returns `done: false` naming the reopen failure, and the recorded digest for that task is unchanged so the next seeding retries the admission.

### Task 7: Close a plan-change reopen through fresh evidence only

**Story:** 1
**Type:** verification
**Files:** `src/conductor/test/engine/task-progress.test.ts`, `src/conductor/test/engine/task-cli.test.ts`
**Verify-only:** yes
**Dependencies:** Task 3

**Steps:**
1. Add tests proving the existing resolver and task-close path already govern a `plan_amendment` obligation exactly like a gate obligation (adr-2026-09-06 D4). If one fails, fix the cause in Task 3's admission data, not in the resolver.
2. Commit the tests.

**Done when:**
- For a `plan_amendment` reopen, a commit made after the reopen boundary carrying the task's `Task:` trailer makes `resolveTaskIds` resolve the task and the BUILD completion reason no longer lists it.
- For a `plan_amendment` reopen of a task with a `**Done when:**` block, `runTaskDone` with passing evidence for every check and no new commit closes the obligation with `current-done-when` evidence and the task resolves.
- For a `plan_amendment` reopen of a task with no `**Done when:**` block, `runTaskDone` without a new commit returns `legacy` and the task stays unresolved until a post-boundary trailered commit exists; a commit whose only `Task:` trailer predates the boundary never resolves it.

### Task 8: Carry the reopen reason into the BUILD prompt after a restart

**Story:** 1
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`
**Dependencies:** Task 3

**Steps:**
1. Write a failing conductor test: admit a `plan_amendment` reopen, construct a fresh Conductor on the same project root (restart), and capture the next BUILD dispatch prompt.
2. Ensure the restart hint restore that reads settled obligations renders `plan_amendment` obligations with the task id, task title and the instruction saying the plan text changed. Extend the restore only if the fixture shows it omits them.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- After a `plan_amendment` reopen and a Conductor restart on the same project root, the next BUILD dispatch prompt names the reopened task id and title and states that its plan text changed since it was implemented, as asserted by the restart-prompt test.
- Without a restart, the next BUILD dispatch prompt after a `plan_amendment` reopen also names the reopened task id and title and states that its plan text changed.

### Task 9: Keep the reopen boundary correct across a rebase

**Story:** 1
**Type:** verification
**Files:** `src/conductor/test/engine/rebase-translate.test.ts`
**Verify-only:** yes
**Dependencies:** Task 3

**Steps:**
1. Add a rebase-translate test with a `plan_amendment` obligation whose baseline head is rewritten by a rebase. If it fails, fix the cause in Task 3's admission data, not in rebase translation.
2. Commit the test.

**Done when:**
- After the rebase baseline translation in rebase-translate.ts runs over a `plan_amendment` obligation, its baseline head equals the rebased successor commit, and a `Task:` trailer commit from before the boundary still does not resolve the task in `resolveTaskIds`.
- When the rebase leaves the baseline head with no translated successor, the `plan_amendment` obligation stays open and `resolveTaskIds` keeps the task unresolved instead of falling back to older `Task:` trailers.

### Task 10: Name every pending task by id and title in the BUILD completion reason

**Story:** 2
**Type:** happy-path
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/artifacts.test.ts`
**Dependencies:** none

**Steps:**
1. Write failing BUILD-predicate tests: six unresolved tasks; an appended remediation task resolved while plan tasks 1 to 6 stay unresolved; a pending task whose plan heading has no title.
2. Replace the first-three truncation in the BUILD predicate's unresolved-task reason. Keep the existing `N/M tasks pending/not completed:` prefix, follow it with every pending id comma-separated, then ` — ` and each `id "title"` pair separated by `; `. Titles come from `parsePlanTasks`; when a plan heading has no title use the task-status row `name`, and when neither exists use the id alone. Leave the removed-remediation-heading list and its truncation unchanged.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- For six unresolved plan tasks, `checkStepCompletion` for `build` returns `done: false` with a reason containing all six ids, each id paired with its plan title, and no `more)` substring.
- When only an appended remediation task is resolved and plan tasks 1 to 6 are not, the reason lists tasks 1 to 6 with their titles and the step is not done.
- For a pending task whose plan heading has no title, the reason pairs its id with the task-status row name, and the reason is still produced.
- The pending ids all appear in the reason before the first title text, as asserted by an index comparison in the six-task test.

### Task 11: Carry the full pending list through retry hint, step_retry and the daemon retry line

**Story:** 2
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/format-retry-line.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/engine/format-retry-line.test.ts`
**Dependencies:** Task 10

**Steps:**
1. Write failing tests at the conductor retry path and the daemon retry-line formatter for an incomplete BUILD with six pending tasks.
2. Confirm the BUILD retry hint and `step_retry` event reason pass the predicate reason through unshortened; keep `formatRetryReason`'s newline collapse, single line and length bound unchanged. Because Task 10 puts ids before titles, the bounded line still names every id for typical task counts.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- For an incomplete BUILD with six pending tasks, the retry hint passed to the next BUILD dispatch and the emitted `step_retry` event reason each contain all six ids and titles.
- With titles long enough that the line reaches its existing length bound, `formatRetryReason` on that reason returns exactly one line within that bound, the line contains all six task ids, and every id's index in the line is less than the index of the first title text; and a daemon retry test asserts the daemon's logged retry line for that incomplete BUILD equals that `formatRetryReason` output, so it names every pending task id before any title text.
- Two consecutive incomplete BUILD attempts with the same pending tasks and titles are classified as an identical repeat by `classifyRetryDecision`, as before this change.

### Task 12: Name every pending task in the stall question and HALT

**Story:** 2
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`
**Dependencies:** Task 10

**Steps:**
1. Write a failing conductor test that drives an incomplete BUILD into the `no_task_progress` stall and to retry exhaustion.
2. Keep the existing `build stalled: no task progress` reason text byte-identical and append the full pending list from the completion reason to the stall question and HALT body.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- The `no_task_progress` stall question written for an incomplete BUILD contains every pending task id and title and the unchanged `build stalled: no task progress` reason text.
- The HALT written at retry exhaustion for that BUILD contains every pending task id and title and the unchanged `build stalled: no task progress` reason text.

### Task 13: Complete a finished build with no reopen after a plain rewind

**Story:** 3
**Type:** verification
**Files:** `src/conductor/test/engine/artifacts.test.ts`, `src/conductor/test/engine/conductor.test.ts`
**Verify-only:** yes
**Dependencies:** Task 3

**Steps:**
1. Add BUILD-predicate and conductor tests for a fully resolved feature with matching digests, and for `rewind --to build` with no plan text change. If either reopens or stalls, fix the cause in Task 3.
2. Commit the tests.

**Done when:**
- With every plan task resolved and every recorded digest matching, `checkStepCompletion` for `build` returns `done: true`, no repair obligation is admitted, and no `build_stall` event is emitted.
- After `rewind --to build` with no plan text change, seeding admits no repair obligation, previously completed tasks stay resolved from their existing evidence, and `checkStepCompletion` for `build` returns `done: true` without a new commit.

### Task 14: Record a baseline instead of reopening when digests are missing or unknown

**Story:** 3
**Type:** negative-path
**Files:** `src/conductor/src/engine/task-seed.ts`, `src/conductor/src/engine/task-digests.ts`, `src/conductor/test/engine/task-seed.test.ts`
**Dependencies:** Task 3

**Steps:**
1. Write failing seed tests for: engine state with no `taskDigests` section; a section whose stored digests carry an unknown version prefix; and a recreated worktree where task-status.json and engine-state.json are both absent but trailered commits exist.
2. In seeding, treat an absent plan entry, and any stored digest not prefixed `v1:`, as no recorded digest for that task: record the current digest and admit nothing. Reconstruction keeps restoring completed rows from trailers before the baseline is recorded.
3. Run the scoped tests to GREEN and commit.

**Done when:**
- For a fully resolved plan with no `taskDigests` section, `seedTaskStatus` admits no repair obligation, records a digest for every task, and `checkStepCompletion` for `build` returns `done: true`.
- For stored digests with an unknown version prefix, seeding admits no repair obligation and re-records every task digest with the `v1:` prefix.
- For a recreated worktree with no task-status.json or engine-state.json, seeding restores completed rows from their `Task:` trailers, records a new digest baseline, and admits no repair obligation.

## Task Dependency Graph

Independent starts: 1, 10. Digest chain: 1 → 2 → 3. From 3: 4, 5, 6, 7, 8, 9, 13, 14. From 10: 11, 12. Overlapping Files sets serialize even when the graph admits concurrency.

## Integration Points

- After Task 3: the #2014 reproduction runs through the production BUILD completion predicate (`checkStepCompletion` for `build`), which is the integration owner for reopen behavior.
- After Task 11: the BUILD retry path and daemon retry formatter carry the full pending list; Task 11 owns that boundary.
- After Task 12: the stall and HALT paths carry the full pending list.

## Coverage Check

Every row is diff-local: fixtures supply their own plan text, commits, and engine state, so no commit outside this feature changes the result. There are no outside-diff waivers.

| Criterion | Task id(s) | Done when quote | Disposition |
|---|---|---|---|
| Story 1 happy: Given a feature whose plan tasks 1 and 2 were completed by commits carrying their `Task:` trailers and whose recorded task digests match those tasks, when the operator rewrites the text of tasks 1 and 2 and BUILD seeding next runs, then tasks 1 and 2 are pending in task-status and the BUILD completion predicate reports them unresolved despite the old trailers. | 3 | "In the #2014 git fixture, `checkStepCompletion` for `build` returns `done: false` and its reason lists tasks 1 and 2 as pending, although commits carrying `Task: 1` and `Task: 2` trailers exist before the reopen." | diff-local |
| Story 1 happy: Given a task reopened by a plan text change, when a commit made after the reopen carries that task's `Task:` trailer, then the task resolves and the BUILD completion predicate no longer lists it as pending. | 7 | "For a `plan_amendment` reopen, a commit made after the reopen boundary carrying the task's `Task:` trailer makes `resolveTaskIds` resolve the task and the BUILD completion reason no longer lists it." | diff-local |
| Story 1 happy: Given a task reopened by a plan text change whose plan entry has a `**Done when:**` block, when the build agent closes the task through the engine's task-close command with passing evidence for every Done-when check and no new commit, then the task resolves. | 7 | "For a `plan_amendment` reopen of a task with a `**Done when:**` block, `runTaskDone` with passing evidence for every check and no new commit closes the obligation with `current-done-when` evidence and the task resolves." | diff-local |
| Story 1 happy: Given a task reopened by a plan text change, when the reopen is recorded, then the plan-change reopen charges no kickback lap to any gate, while a `coverage_binding` reopen of the same task still charges its own `gates.coverage_binding` lap as before. | 4 | "With `coverage_binding` disabled, the kickback ledger file is byte-identical before and after a `plan_amendment` reopen, and no `pendingRepair` entry is recorded; in a fixture where a `coverage_binding` reopen of the same task is also admitted, `gates.coverage_binding` laps still increase by one." | diff-local |
| Story 1 happy: Given the same changed task text is seen by repeated BUILD seedings or a process restart, when seeding runs again, then exactly one open reopen record exists for that task and text, and its boundary commit is unchanged. | 4 | "Running `seedTaskStatus` three times, and again after re-creating the store from disk to simulate a restart, with the same changed digest leaves exactly one open `plan_amendment` obligation for the task with an unchanged baseline head." | diff-local |
| Story 1 happy: Given a reopened task whose text is changed a second time before it is resolved, when seeding runs, then the newer reopen replaces the older one for that task, and a single passing task close or one fresh trailered commit resolves the task. | 4 | "A second text change to an unresolved reopened task closes the older `plan_amendment` obligation with evidence kind `superseded-by-plan-amendment` and leaves one open obligation; a single fresh `Task:` trailer commit or one passing `completeTaskDoneWhen` then resolves the task in `resolveTaskIds`." | diff-local |
| Story 1 happy: Given a reopened task, when an engine restart occurs before BUILD dispatch, then the next BUILD prompt still carries the reopened task and the reason it was reopened. | 8 | "After a `plan_amendment` reopen and a Conductor restart on the same project root, the next BUILD dispatch prompt names the reopened task id and title and states that its plan text changed since it was implemented, as asserted by the restart-prompt test." | diff-local |
| Story 1 negative: Given a plan task whose text differs only in whitespace, line wrapping, or blank lines from its recorded digest, when seeding runs, then the task is not reopened and its existing completion evidence still resolves it. | 5 | "After a whitespace-only, line-wrap or blank-line edit to a completed task, `seedTaskStatus` admits no repair obligation, the row stays `completed`, and `checkStepCompletion` for `build` still resolves it from its existing `Task:` trailer." | diff-local |
| Story 1 negative: Given a plan whose last task is followed by a non-task section such as `## Risks`, when only that trailing section is edited, then the last task is not reopened. | 5 | "After editing only a `## Risks` section that follows the last task, `seedTaskStatus` admits no repair obligation for the last task and its row stays `completed`." | diff-local |
| Story 1 negative: Given a task reopened by a plan text change, when the only commits carrying its `Task:` trailer predate the reopen boundary, then the task stays unresolved and the BUILD completion predicate does not report done. | 3 | "In the #2014 git fixture, `checkStepCompletion` for `build` returns `done: false` and its reason lists tasks 1 and 2 as pending, although commits carrying `Task: 1` and `Task: 2` trailers exist before the reopen." | diff-local |
| Story 1 negative: Given a reopened task whose plan entry has no `**Done when:**` block, when the build agent runs the task-close command without a new commit, then the task stays unresolved and is resolved only by a commit made after the reopen carrying its `Task:` trailer. | 7 | "For a `plan_amendment` reopen of a task with no `**Done when:**` block, `runTaskDone` without a new commit returns `legacy` and the task stays unresolved until a post-boundary trailered commit exists; a commit whose only `Task:` trailer predates the boundary never resolves it." | diff-local |
| Story 1 negative: Given recording a reopen fails because the engine-state write fails or the present repair state is malformed, when the BUILD completion predicate runs, then it reports not done with a reason naming the reopen failure and never falls back to resolving the task from old trailers. | 6 | "With an injected engine-state write failure during a digest-change admission, `checkStepCompletion` for `build` returns `done: false` with a reason containing `task reopen failed:` and the task id, even though a `Task:` trailer for that task exists." | diff-local |
| Story 1 negative: Given a task reopened by an existing gate's remediation, when that task's plan text later changes, then the gate's reopen stays open and still governs the task alongside the new plan-change reopen. | 4 | "When a task already has an open obligation admitted by `prd_audit` remediation and its plan text then changes, both obligations stay open after seeding, and the task resolves only once each is satisfied." | diff-local |
| Story 1 negative: Given a feature rebased onto a new main after a plan-change reopen, when the rebase translates commit ids, then the reopen boundary follows the rebased commit and pre-boundary trailers still do not resolve the task. | 9 | "After the rebase baseline translation in rebase-translate.ts runs over a `plan_amendment` obligation, its baseline head equals the rebased successor commit, and a `Task:` trailer commit from before the boundary still does not resolve the task in `resolveTaskIds`." | diff-local |
| Story 2 happy: Given a BUILD session that ends with six plan tasks unresolved, when the BUILD completion predicate runs, then the step is not completed and its reason lists all six tasks, each with its id and title, without any "+N more" truncation. | 10 | "For six unresolved plan tasks, `checkStepCompletion` for `build` returns `done: false` with a reason containing all six ids, each id paired with its plan title, and no `more)` substring." | diff-local |
| Story 2 happy: Given that incomplete BUILD, when the engine schedules a retry, then the BUILD retry hint and the `step_retry` event reason each carry the full list of pending task ids and titles, and the daemon's retry log line names every pending task id before any title text. | 11, 10 | "For an incomplete BUILD with six pending tasks, the retry hint passed to the next BUILD dispatch and the emitted `step_retry` event reason each contain all six ids and titles." | diff-local |
| Story 2 happy: Given an incomplete BUILD that trips the no-progress stall, when the stall question and any resulting HALT are written, then each names every pending task by id and title and still carries the unchanged `build stalled: no task progress` reason text. | 12 | "The `no_task_progress` stall question written for an incomplete BUILD contains every pending task id and title and the unchanged `build stalled: no task progress` reason text." | diff-local |
| Story 2 negative: Given a BUILD session that commits only an appended remediation task while plan tasks 1 to 6 stay unresolved, when the BUILD completion predicate runs, then it reports not done and lists tasks 1 to 6 by id and title. | 10 | "When only an appended remediation task is resolved and plan tasks 1 to 6 are not, the reason lists tasks 1 to 6 with their titles and the step is not done." | diff-local |
| Story 2 negative: Given a pending task with no title in the plan heading, when the reason is built, then the task appears by id with the task-status row name as its title, and the reason is still produced. | 10 | "For a pending task whose plan heading has no title, the reason pairs its id with the task-status row name, and the reason is still produced." | diff-local |
| Story 2 negative: Given the daemon's bounded single-line retry log, when an incomplete BUILD with many pending tasks is retried, then the retry still produces exactly one bounded log line, every pending task id appears in it before any title text, and the full ids and titles remain in the `step_retry` event reason. | 11, 10 | "With titles long enough that the line reaches its existing length bound, `formatRetryReason` on that reason returns exactly one line within that bound, the line contains all six task ids, and every id's index in the line is less than the index of the first title text." | diff-local |
| Story 2 negative: Given two consecutive incomplete BUILD attempts with the same pending tasks and titles, when the retry decision compares their reasons, then they are recognized as an identical repeat exactly as before this change. | 11 | "Two consecutive incomplete BUILD attempts with the same pending tasks and titles are classified as an identical repeat by `classifyRetryDecision`, as before this change." | diff-local |
| Story 3 happy: Given every plan task is resolved and no task text changed since its digest was recorded, when the BUILD completion predicate runs, then the step completes, no repair obligation is created, and no stall is raised. | 13 | "With every plan task resolved and every recorded digest matching, `checkStepCompletion` for `build` returns `done: true`, no repair obligation is admitted, and no `build_stall` event is emitted." | diff-local |
| Story 3 happy: Given a feature rewound to build with no plan text change, when BUILD seeding and completion run, then previously completed tasks stay resolved from their existing evidence and the step completes without redoing them. | 13 | "After `rewind --to build` with no plan text change, seeding admits no repair obligation, previously completed tasks stay resolved from their existing evidence, and `checkStepCompletion` for `build` returns `done: true` without a new commit." | diff-local |
| Story 3 happy: Given an in-flight feature whose plan has no recorded task digests, when BUILD seeding first runs after this change, then digests are recorded as a baseline, no task is reopened, and a fully resolved build completes. | 14 | "For a fully resolved plan with no `taskDigests` section, `seedTaskStatus` admits no repair obligation, records a digest for every task, and `checkStepCompletion` for `build` returns `done: true`." | diff-local |
| Story 3 negative: Given recorded digests of an unknown digest version, when seeding runs, then the digests are re-recorded as a baseline and no task is reopened. | 14 | "For stored digests with an unknown version prefix, seeding admits no repair obligation and re-records every task digest with the `v1:` prefix." | diff-local |
| Story 3 negative: Given a worktree recreated from its branch so `.pipeline/` state including recorded digests is gone, when seeding reconstructs task-status, then completed tasks are restored from their trailers, a new baseline is recorded, and no task is reopened. | 14 | "For a recreated worktree with no task-status.json or engine-state.json, seeding restores completed rows from their `Task:` trailers, records a new digest baseline, and admits no repair obligation." | diff-local |

## Architecture Obligation Coverage

`adr-2026-09-06-reopened-task-resolution` is amended by this spec (D11). Every citable decision D1-D12 is dispositioned; task evidence quotes are exact Done-when fragments.

| Decision | Disposition | Task(s) | Evidence |
|---|---|---|---|
| adr-2026-09-06-reopened-task-resolution#D1 | existing | none | repair-obligations.ts `createRepairObligationStore` already persists obligations as the versioned `repairObligations` section of engine-state.json; this feature adds a sibling `taskDigests` section only. |
| adr-2026-09-06-reopened-task-resolution#D2 | task | task-3 | the recorded digest for a rewritten task is written only after its obligation is persisted |
| adr-2026-09-06-reopened-task-resolution#D3 | task | task-2 | All digest writes go through `createEngineStateStore(...).update` |
| adr-2026-09-06-reopened-task-resolution#D4 | task | task-7 | a commit whose only `Task:` trailer predates the boundary never resolves it |
| adr-2026-09-06-reopened-task-resolution#D5 | existing | none | task-progress.ts resolves open obligations against a strict post-boundary range read through `readOpenRepairState`; a `plan_amendment` obligation uses that same range unchanged. |
| adr-2026-09-06-reopened-task-resolution#D6 | existing | none | task-seed.ts already restages every open obligation row to pending through the shared obligation reader; the new admission runs before that read, so seeding, resolution and task close keep one reader. |
| adr-2026-09-06-reopened-task-resolution#D7 | no-change | none | A `plan_amendment` obligation comes from plan text, not a review finding, so the OVER_SCOPE acceptance reducer is neither consulted nor changed. |
| adr-2026-09-06-reopened-task-resolution#D8 | no-change | none | D11 states a `plan_amendment` obligation has no governing review of its own; gate-admitted obligations keep D8 unchanged and no review routing changes. |
| adr-2026-09-06-reopened-task-resolution#D9 | task | task-4 | the kickback ledger file is byte-identical before and after a `plan_amendment` reopen |
| adr-2026-09-06-reopened-task-resolution#D10 | task | task-4 | `gates.coverage_binding` laps still increase by one |
| adr-2026-09-06-reopened-task-resolution#D11 | task | task-3 | engine state holds one open repair obligation per rewritten task with source authority `plan_amendment` |
| adr-2026-09-06-reopened-task-resolution#D12 | no-change | none | D12's per-row trailer restore ships in main via #2673; the new digest recording runs after reconstruction, so the per-row restore ordering is unchanged and task-14's recreated-worktree test pins the interaction. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic

### Task rem-prd-audit-rem-prd-audit-t3-predicate: src/conductor/test/engine/artifacts.test.ts — add the #2014 git fixture through checkStepCompletion('build'): two completed tasks with pre-boundary Task: 1 / Task: 2 trailered commits, then rewrite both task texts and seed; assert done:false naming tasks 1 and 2, both rows pending, one settled plan_amendment obligation each with baseline head equal to HEAD, and that the pre-boundary trailers alone never resolve them (S1.1, S1.10); commit with a Task: trailer for this id
**Gate:** prd-audit
**Rationale:** prd-audit grades S1.1 FIXABLE against plan Task 3: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 3 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S1.1
**Parent task:** 3
**Done when:**
- S1.1 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t3-predicate is complete.

### Task rem-prd-audit-rem-prd-audit-t7-close-paths: src/conductor/test/engine/task-progress.test.ts and task-cli.test.ts — add plan_amendment-authority fixtures (existing fixtures use build_review only): a post-boundary Task: trailer resolves the reopened task via resolveTaskIds (S1.2); runTaskDone with passing current Done-when evidence closes it with current-done-when (S1.3); a task with no Done-when returns legacy and stays unresolved until a post-boundary trailered commit, a pre-boundary trailer never resolving it (S1.11)
**Gate:** prd-audit
**Rationale:** prd-audit grades S1.2 FIXABLE against plan Task 7: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 7 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S1.2
**Parent task:** 7
**Done when:**
- S1.2 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t7-close-paths is complete.

### Task rem-prd-audit-rem-prd-audit-t4-idempotence: src/conductor/test/engine/task-seed.test.ts and repair-obligations.test.ts — add: triple seed plus store re-creation leaves exactly one open plan_amendment obligation with an unchanged baseline (S1.5); kickback-ledger bytes identical and no pendingRepair after a reopen, while a coexisting coverage_binding reopen still bumps its gate count by one (S1.4); a second rewrite closes the first record with superseded-by-plan-amendment and one fresh trailer or completeTaskDoneWhen resolves the task, plus the A→B→A text case (S1.6); a prd_audit and a plan_amendment obligation on one task both stay open until each is satisfied (S1.13)
**Gate:** prd-audit
**Rationale:** prd-audit grades S1.4 FIXABLE against plan Task 4: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 4 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S1.4
**Parent task:** 4
**Done when:**
- S1.4 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t4-idempotence is complete.

### Task rem-prd-audit-rem-prd-audit-t8-restart-prompt: src/conductor/test/engine/conductor.test.ts — add a restart test: a settled open plan_amendment obligation plus a coexisting gate obligation on the same plan survive a new Conductor instance, and the first BUILD prompt carries every 'Task N (title) plan text changed since it was implemented; reopen it in BUILD.' line restored by conductor.ts:7351-7384 (S1.7); add the no-restart case where the pre-dispatch seed admits a reopen in a running process and that first BUILD prompt also carries the reason, fixing conductor.ts pendingRetryHints population if the test fails
**Gate:** prd-audit
**Rationale:** prd-audit grades S1.7 FIXABLE against plan Task 8: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 8 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S1.7
**Parent task:** 8
**Done when:**
- S1.7 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t8-restart-prompt is complete.

### Task rem-prd-audit-rem-prd-audit-t5-no-reopen: src/conductor/test/engine/task-seed.test.ts — add seed-level tests (Task 5's reported evidence names tests that do not exist): a whitespace/line-wrap-only edit to a completed task (S1.8) and an edit only to a trailing ## Risks section after the last task (S1.9) each admit no obligation, keep the row completed, and checkStepCompletion('build') still resolves it from its existing trailer
**Gate:** prd-audit
**Rationale:** prd-audit grades S1.8 FIXABLE against plan Task 5: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 5 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S1.8
**Parent task:** 5
**Done when:**
- S1.8 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t5-no-reopen is complete.

### Task rem-prd-audit-rem-prd-audit-t6-fail-closed: src/conductor/test/engine/build-seed-failure-reason.test.ts (or artifacts.test.ts) — drive the real seedTaskStatus, not a mock: inject an engine-state write failure during reopen admission and, separately, a malformed present repairObligations section; with a Task: trailer present, assert checkStepCompletion('build') returns done:false with a 'task reopen failed:' reason, the recorded digest is unchanged, and the next seed retries the reopen (S1.12)
**Gate:** prd-audit
**Rationale:** prd-audit grades S1.12 FIXABLE against plan Task 6: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 6 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S1.12
**Parent task:** 6
**Done when:**
- S1.12 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t6-fail-closed is complete.

### Task rem-prd-audit-rem-prd-audit-t9-rebase: src/conductor/test/engine/rebase-translate.test.ts — add a plan_amendment-authority fixture: an open plan_amendment obligation's baseline head is translated to its rebased successor commit, and the no-successor case behaves as the existing build_review fixtures require (S1.14)
**Gate:** prd-audit
**Rationale:** prd-audit grades S1.14 FIXABLE against plan Task 9: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 9 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S1.14
**Parent task:** 9
**Done when:**
- S1.14 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t9-rebase is complete.

### Task rem-prd-audit-rem-prd-audit-t13-clean-finish: src/conductor/test/engine/artifacts.test.ts (or task-seed.test.ts) — add a fully resolved fixture with matching recorded digests: seeding admits no obligation and checkStepCompletion('build') returns done:true with no build_stall (S3.1); repeat after a plain rewind-to-build re-seed and assert no task is reopened or restaged (S3.2)
**Gate:** prd-audit
**Rationale:** prd-audit grades S3.1 FIXABLE against plan Task 13: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 13 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S3.1
**Parent task:** 13
**Done when:**
- S3.1 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t13-clean-finish is complete.

### Task rem-prd-audit-rem-prd-audit-t14-baseline: src/conductor/test/engine/task-seed.test.ts — add seed tests: an absent taskDigests section (S3.3), a digest lacking the v1: prefix (S3.4) and a recreated worktree with lost engine-state but restored trailers (S3.5) each record a fresh baseline without admitting any obligation; also pin that a taskDigests section whose version field is not 1 fails closed with the neutral seed reason (task-seed.ts:251)
**Gate:** prd-audit
**Rationale:** prd-audit grades S3.3 FIXABLE against plan Task 14: production code reads correct but the required test proof is absent (audit names the missing fixture); last lap's existing-task re-stage of Task 14 cycled — it re-closed on 'reported' evidence with no test committed — so this lap appends an explicit file-scoped test task that only a post-boundary trailered commit can resolve. Adds tests only; removes no code, test or assertion.
**Criterion:** S3.3
**Parent task:** 14
**Done when:**
- S3.3 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-prd-audit-t14-baseline is complete.

### Task rem-as-built-rem-adr-d3-close-plan-identity: src/conductor/src/engine/repair-obligations.ts:290-324 — in RepairObligationStore.close, return { ok: false, kind: 'stale' } when obligation.planIdentity !== planIdentity, checked right after the missing-obligation check and before the currentByPlan different-authority exception (matching markSettled at :276); add a repair-obligations.test.ts case: plans A and B both reuse task id 1, A has an open obligation, B's current obligation for task 1 has a different authority, and close via B's planPath with A's obligation id is refused and leaves A's task open. Keep the existing same-plan different-authority coexistence (Task 4 / S1.13) and plan_amendment supersession (S1.6) tests green; commit with a Task: trailer for this id
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift under adr-2026-09-06-reopened-task-resolution D3 (95% verified from source): RepairObligationStore.close (repair-obligations.ts:290-324) derives planIdentity but never checks obligation.planIdentity, so the different-authority exception at :306-317 lets a plan-B path close a plan-A obligation that shares a task id. The approved architecture stands, so the fix is a code change admitted by plan Task 4, which owns repair-obligations.ts and the different-authority separation. A new explicit task is emitted rather than an existing-task re-stage, because last lap's existing-task re-stages re-closed on reported evidence without a commit. Sibling sweep: markSettled (:276) and admit's supersession loop (:202) already compare planIdentity, so close is the only site with this shape. The change only adds a guard and keeps Task 4's different-authority coexistence tests (S1.13) and its supersession tests (S1.6) intact.
**Governing clause:** adr-2026-09-06-reopened-task-resolution decision 3
**Done when:**
- adr-2026-09-06-reopened-task-resolution decision 3 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-d3-close-plan-identity is complete.
