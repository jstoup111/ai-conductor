# Implementation Plan: A superseded repair obligation keeps its task reading as open (#2598)

**Date:** 2026-10-09
**Design:** none (technical track, Tier S; see `.docs/track/a-superseded-repair-obligation-keeps-its-task-read.md`)
**Stories:** .docs/stories/a-superseded-repair-obligation-keeps-its-task-read.md
**Conflict check:** Not required at Tier S

## Summary

Adds one shared classifier, `taskObligationStanding`, to `repair-obligations.ts`. For a task in a
plan it says which repair obligations still bind the task (live), which are superseded, and whether
the task is current-less. `RepairObligationStore.close`, the completion resolver,
`openRepairForTask`, the Done-when task close and task seeding all use it, so they can no longer
disagree. Five tasks. No repair-state schema change.

## Technical Approach

- **The rule already exists in one place.** `RepairObligationStore.close`
  (`src/conductor/src/engine/repair-obligations.ts:310-320`) refuses to close obligation O for task
  T as `stale` when T's current obligation (`currentByPlan[plan][T]`) is a different record with
  the same source authority, or is missing. `repair-obligations.test.ts` ("rejects a stale closure
  after a later repair") pins that behaviour. The readers never adopted it:
  - `resolveTaskIdsWithDiagnostics` (`task-progress.ts:133-163`) folds every obligation with
    `obligation.tasks[canonicalId] !== undefined`.
  - `openRepairForTask` (`task-progress.ts:225`) returns the first `open` one.
  - `completeTaskDoneWhen` (`task-progress.ts:363-367`, `:535-545`) tries to close every open one
    and refuses the whole close when `close` reports the superseded one `stale`.
  - `seedTaskStatus` (`task-seed.ts:345-350`, `:506-508`) restages every task with any open
    obligation to `pending`.

  A superseded record is therefore open forever, and its task can never complete. This is #2598.
- **Supersession is same-authority only.** Different-authority obligations on one task stay live
  and each needs its own closure, as before. That keeps `repair-obligations.test.ts`'s prd_audit
  plus plan_amendment coexistence case and `completeTaskDoneWhen`'s close-every-open-obligation
  intent (`task-progress.ts:358-362`) for live obligations. The reverted commit `a2809fbd9` read
  `currentByTask` alone, which would have hidden a live different-authority repair. This plan does
  not adopt it.
- **Read-time, not write-time.** The rule is applied when the state is read. Admission is
  unchanged: the `plan_amendment` write-time supersession at `repair-obligations.ts:200-212`
  (`adr-2026-09-06-reopened-task-resolution` D11) stays as is. The alternative was to close older
  same-authority records at admission. It was rejected because it cannot fix superseded records
  already persisted in in-flight feature worktrees, and it would add a second place where
  supersession is decided. The read-time classifier has no persisted output, so it needs no
  migration.
- **Lineage independence.** Standing is computed only from record ids, `currentByPlan` and
  `source.authority`, never from commits. `rewriteBaselines` (the rebase translation) changes only
  `baseline.head`, so squash or rebase cannot change which obligation is current. A superseded
  obligation's baseline is never handed to the strict commit range, so a missing boundary on it no
  longer makes its task unavailable.
- **Current-less fails closed.** An open obligation binding T, with no current entry for T or a
  current entry naming a missing record, is malformed control state. It is reported as
  `repair state is unavailable: task <id> has an open repair obligation but no current obligation is recorded for it`.
  `<id>` is the task id the caller passed. The `repair state is unavailable:` prefix matches the
  existing readers' reasons (`task-progress.ts:184,187,204`). This follows
  `adr-2026-09-06-reopened-task-resolution` D3: malformed repair state blocks affected completion
  with a named reason. A task whose binding obligations are all resolved is not current-less,
  because nothing open can be hidden.
- **Classifier shape.** In `repair-obligations.ts`, export
  `taskObligationStanding(section: Pick<RepairObligationSection, 'records' | 'currentByPlan'>, planIdentity: string, taskId: string)`.
  It returns:
  - `{ kind: 'none' }` when no record of that plan binds the canonical task id;
  - `{ kind: 'current-less'; reason }`;
  - `{ kind: 'live'; current?: RepairObligation; live: RepairObligation[]; superseded: RepairObligation[] }`.

  Export the `RepairObligationSection` type. Canonicalise with `canonicalTaskId`, as the store
  already does.
- **Tests.** Follow `.agents/skills/write-tests/SKILL.md`. Use unit tests at the narrowest seam
  (classifier and store in `src/conductor/test/engine/repair-obligations.test.ts`, resolver in
  `task-progress.test.ts`, seeding in `task-seed.test.ts`). Use entry-point tests through
  `runTaskDone` (`task-cli.test.ts`) and `checkStepCompletion(dir, 'build', …)`
  (`artifacts.test.ts`). Build fixtures with `createRepairObligationStore(...).admitOrReplay` the
  way the existing "rejects a stale closure after a later repair" and reverted
  `a2809fbd9` fixtures do. Use `mkdtemp` directories and no real git unless a post-boundary
  `Task:` trailer is the subject.

## Prerequisites

- None.

## Tasks

### Task 1: Shared obligation-standing classifier, adopted by close
**Story:** 2, 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/repair-obligations.test.ts` for `taskObligationStanding`:
   - an older open `build_review` record plus a newer current `build_review` record gives `live` with the newer one as `current` and in `live`, and the older one in `superseded`;
   - an open `prd_audit` record plus a newer current `build_review` record gives both in `live` and none in `superseded`;
   - deleting task 2's `currentByPlan` entry, or pointing it at a nonexistent id, while an open record binds task 2 gives `current-less` with the exact reason text from Technical Approach;
   - all binding records resolved with no current entry gives `live`, not `current-less`;
   - a task no record binds gives `none`;
   - after `rewriteBaselines` translates both records' heads, the classification is identical.
2. Add failing store tests: `close` on the superseded record still returns `{ ok: false, kind: 'stale', message: 'Repair obligation has been superseded for this task' }` and leaves it open; `close` on the older different-authority record returns ok; `close` on an open obligation of a current-less task returns `{ ok: false, kind: 'incompatible' }` whose message is the current-less reason and leaves the record open.
3. Verify they fail (RED).
4. Implement `taskObligationStanding` and export `RepairObligationSection` as described in Technical Approach. Replace `close`'s inline `currentId` and authority check (`repair-obligations.ts:310-320`) with a call to the classifier: refuse `stale` with the same message when the obligation is in `superseded`, and refuse `incompatible` with the classifier's current-less reason (never the superseded message) when the standing is `current-less`. Keep the plan-identity check before it unchanged.
5. Verify they pass (GREEN), along with the existing repair-obligations tests.
6. Commit: "refactor(repair): share obligation supersession through taskObligationStanding".

**Done when:**
- [test] repair-obligations.test.ts asserts `taskObligationStanding` puts an older same-authority (`build_review`) obligation in `superseded` and the current one in `live`, while an older different-authority (`prd_audit`) obligation stays in `live`.
- [test] The same file asserts `taskObligationStanding` returns `current-less` with reason `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it` both for a missing `currentByPlan` entry and for one naming a nonexistent record, and returns `live` (not `current-less`) when every binding obligation is resolved.
- [test] The same file asserts `taskObligationStanding` returns an identical classification before and after `rewriteBaselines` translates both obligations' baseline heads.
- [test] The same file asserts `RepairObligationStore.close` on a superseded obligation returns `kind: 'stale'` with message "Repair obligation has been superseded for this task" and leaves its task `open`, while `close` on a live different-authority obligation succeeds.
- [test] The same file asserts `RepairObligationStore.close` on an open obligation of a current-less task 2 returns `kind: 'incompatible'` with message `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it` (not the superseded message) and leaves the record `open`.

**Files likely touched:**
- `src/conductor/src/engine/repair-obligations.ts` — classifier, exported section type, `close` uses classifier
- `src/conductor/test/engine/repair-obligations.test.ts` — classifier and close tests

**Dependencies:** none

### Task 2: Completion resolver folds only live obligations
**Story:** 1, 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/task-progress.test.ts` against `resolveTaskIdsWithDiagnostics` (Story 1 and Story 4 resolver criteria):
   - an older open superseded and a newer resolved current `build_review` obligation on task 2 with a `completed` row: resolved, no unavailable reason. The older baseline head is `orphaned-boundary`, which is not a commit, so this also covers the missing-boundary case.
   - the same after `rewriteBaselines` translates both heads: resolved;
   - an open current `build_review` obligation with no post-boundary trailer plus an older superseded one: unresolved;
   - an open `prd_audit` obligation plus a newer resolved current `build_review` obligation: unresolved;
   - an open obligation with `currentByPlan` entry removed, and separately pointing at a nonexistent id: unresolved, with the exact current-less reason;
   - task 3 with no obligation and a `completed` row, and task 4 whose obligations are all resolved with no current entry: both resolved, no unavailable reason.
2. Verify they fail (RED).
3. Implement:
   - make `readOpenRepairState` return the parsed section and bound plan identity alongside the plan's obligations;
   - in `resolveTaskIdsWithDiagnostics`, call `taskObligationStanding` per plan id;
   - for `none`, keep the legacy union;
   - for `current-less`, delete the id from `resolved` and set the reason in `unavailableReasons`;
   - for `live`, run the existing all-resolved check and strict post-boundary trailer fold over `live` only.
4. Verify they pass (GREEN).
5. Commit: "fix(task-progress): resolve tasks past superseded repair obligations".

**Done when:**
- [test] task-progress.test.ts asserts `resolveTaskIdsWithDiagnostics` resolves task 2 with no unavailable reason when its older open `build_review` obligation (baseline head `orphaned-boundary`, no rebase successor) is superseded by a newer current resolved `build_review` obligation.
- [test] The same file asserts that after `rewriteBaselines` translates both obligations' heads, `resolveTaskIdsWithDiagnostics` still treats the newer obligation as current, the older as superseded, and still resolves task 2.
- [test] The same file asserts `resolveTaskIdsWithDiagnostics` leaves task 2 unresolved when its current `build_review` obligation is open with no post-boundary `Task:` trailer, and leaves it unresolved when an older open `prd_audit` obligation has no closure evidence beside a newer resolved current `build_review` obligation.
- [test] The same file asserts `resolveTaskIdsWithDiagnostics` leaves a current-less task 2 (entry missing, and entry naming a nonexistent record) unresolved with unavailable reason `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it`.
- [test] The same file asserts `resolveTaskIdsWithDiagnostics` resolves task 3 (no obligation, `completed` row) and task 4 (all obligations resolved, no current entry) with no unavailable reason for either.

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — `readOpenRepairState`, `resolveTaskIdsWithDiagnostics`
- `src/conductor/test/engine/task-progress.test.ts` — resolver tests

**Dependencies:** Task 1

### Task 3: Task close and open-repair lookup skip superseded obligations
**Story:** 2, 4
**Type:** negative-path

**Steps:**
1. Write failing tests:
   - In `src/conductor/test/engine/task-progress.test.ts`, test `openRepairForTask`. Only a superseded obligation open gives `{ kind: 'none' }`. An open current obligation beside an open superseded one returns the current one's id. A current-less task 2 (entry missing, and entry naming a nonexistent id) gives `{ kind: 'unavailable', reason }` with the exact current-less reason.
   - In `src/conductor/test/engine/task-cli.test.ts`, test `runTaskDone`, following the existing "closes the current repair only after current Done when evidence is accepted" fixture. With an older open superseded and a newer open current `build_review` obligation, and valid Done-when evidence, it exits 0. The current obligation is then `resolved` with evidence kind `current-done-when`, the superseded record is byte-identical to before, and the row is `completed`.
   - In the same file: with an open `prd_audit` obligation and a newer open current `build_review` obligation, both end `resolved`.
   - In the same file, for a current-less task 2, both with the `current-task` stamp present and with it absent: exit 1, stderr contains the current-less reason, and `engine-state.json` and `task-status.json` are byte-identical to before.
2. Verify they fail (RED).
3. Implement in `src/conductor/src/engine/task-progress.ts`:
   - `openRepairForTask`: map `current-less` to `unavailable` with its reason. For `live`, return the current obligation when it is open, otherwise the first open `live` obligation.
   - `completeTaskDoneWhen`: compute the standing from the already-read repair section before any validation side effect. Refuse `current-less` with `[task-cli] cannot close task <id>: <reason>`. Build `openObligationIds` from the open `live` obligations only.
4. Verify they pass (GREEN), along with the existing task-cli repair-close tests.
5. Commit: "fix(task-cli): close only live repair obligations".

**Done when:**
- [test] task-progress.test.ts asserts `openRepairForTask` returns `{ kind: 'none' }` when task 2's only open obligation is superseded, and returns the current obligation's id (not the superseded one's) when the current obligation is open.
- [test] task-cli.test.ts asserts `runTaskDone` with valid Done-when evidence exits 0 beside an open superseded `build_review` obligation, resolves the current obligation with `current-done-when` evidence, leaves the superseded record byte-identical, and writes the row `completed`.
- [test] task-cli.test.ts asserts `runTaskDone` with valid Done-when evidence resolves both an open `prd_audit` obligation and a newer open current `build_review` obligation on task 2.
- [test] task-cli.test.ts asserts `runTaskDone` for a current-less task 2, with the `current-task` stamp present and absent, exits 1, prints `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it`, and leaves `engine-state.json` and `task-status.json` byte-identical.
- [test] task-progress.test.ts asserts `openRepairForTask` returns `kind: 'unavailable'` with that same reason for a current-less task 2, both when its `currentByPlan` entry is missing and when it names a nonexistent record.

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — `openRepairForTask`, `completeTaskDoneWhen`
- `src/conductor/test/engine/task-progress.test.ts` — `openRepairForTask` tests
- `src/conductor/test/engine/task-cli.test.ts` — `runTaskDone` tests

**Dependencies:** Task 2

### Task 4: Task seeding restages only tasks with an open live obligation
**Story:** 3, 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/task-seed.test.ts`, following "keeps an open repair pending while preserving an untouched completed sibling":
   - a `completed` task 2 row with an older open superseded and a newer resolved current `build_review` obligation stays `completed` after `seedTaskStatus`;
   - a `completed` task 2 row with an open current obligation becomes `pending`;
   - a `completed` task 2 row that is current-less (entry missing, and entry naming a nonexistent id) becomes `pending`, and seeding does not throw.
2. Verify they fail (RED).
3. Implement in `src/conductor/src/engine/task-seed.ts`. Build `openRepairTaskIds` by calling `taskObligationStanding` for each canonical task id that any open record of the plan binds. Include the id when the standing is `current-less` or any `live` obligation is open. Keep the restage loop at `:506-508` unchanged.
4. Verify they pass (GREEN), along with the existing task-seed repair tests.
5. Commit: "fix(task-seed): do not reopen tasks for superseded repair obligations".

**Done when:**
- [test] task-seed.test.ts asserts `seedTaskStatus` leaves task 2's `completed` row `completed` when its only open obligation is a superseded `build_review` obligation and its current obligation is resolved.
- [test] task-seed.test.ts asserts `seedTaskStatus` restages task 2's `completed` row to `pending` when its current obligation is open.
- [test] task-seed.test.ts asserts `seedTaskStatus` restages a current-less task 2 (entry missing, and entry naming a nonexistent record) to `pending` without throwing.

**Files likely touched:**
- `src/conductor/src/engine/task-seed.ts` — open-repair restage set
- `src/conductor/test/engine/task-seed.test.ts` — seeding tests

**Dependencies:** Task 1

### Task 5: Build completion check reflects the shared rule end to end
**Story:** 1, 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/artifacts.test.ts` beside "names every unresolved task id before pairing each with its plan title". Use `checkStepCompletion(dir, 'build', { projectRoot: dir, planPath })` with a two-task plan and `completed` rows. The engine state is written through `createRepairObligationStore`.
   - Task 2 has an older open superseded and a newer resolved current `build_review` obligation. The result's reason, if any, does not contain `tasks pending/not completed`.
   - Task 2 is current-less. The result is `done: false`, and its reason contains `2 "` and the exact current-less reason.
2. Verify they fail (RED). Before Task 4 the seed restaged task 2; before Task 2 the resolver kept it open.
3. Implement: no production change is expected beyond Tasks 2 and 4. If the test exposes a gap, fix it in `artifacts.ts`'s `build` completion only.
4. Update the `engine-state.json` row of `docs/reference/artifacts.md`. Say that an obligation superseded by a newer same-authority obligation on its task no longer holds the task open. Say that an open obligation with no current entry fails closed with the named reason.
5. Verify they pass (GREEN).
6. Commit: "test(build): pin superseded and current-less repair completion".

**Done when:**
- [test] artifacts.test.ts asserts `checkStepCompletion(dir, 'build', …)` does not report task 2 in a `tasks pending/not completed` reason when its only open repair obligation is a superseded `build_review` obligation and its current obligation is resolved.
- [test] artifacts.test.ts asserts `checkStepCompletion(dir, 'build', …)` returns `done: false` for a current-less task 2 with a reason containing `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it`.
- `docs/reference/artifacts.md`'s `engine-state.json` row states both the same-authority supersession rule and the current-less fail-closed reason.

**Files likely touched:**
- `src/conductor/test/engine/artifacts.test.ts` — build completion entry-point tests
- `docs/reference/artifacts.md` — engine-state.json row

**Dependencies:** Task 2, Task 4

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
   │          │
   └─▶ Task 4 ┴──▶ Task 5
```

Tasks 2 and 3 both edit `task-progress.ts` and its test file, so Task 3 follows Task 2. Task 4
needs only Task 1's classifier. Task 5's entry-point test passes only once both the resolver
(Task 2) and the seed (Task 4) apply the rule.

## Integration Points

- After Task 3: `task done` on a task with a superseded obligation succeeds. A current-less task is
  refused with the named reason.
- After Task 5: the BUILD completion check completes a feature whose only open obligations are
  superseded. It names current-less tasks in its pending reason.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given task 2 with an older open `build_review` obligation and a newer `build_review` obligation that is current and resolved, when the completion resolver evaluates task 2, then task 2 is resolved and no unavailable reason is recorded for it. | 2, 5 | "`resolveTaskIdsWithDiagnostics` resolves task 2 with no unavailable reason when its older open `build_review` obligation (baseline head `orphaned-boundary`, no rebase successor) is superseded by a newer current resolved `build_review` obligation" | diff-local |
| Story 1 happy: Given the same two obligations with their baseline heads translated by a rebase rewrite, when the completion resolver evaluates task 2, then the newer obligation is still current, the older one is still superseded, and task 2 is still resolved. | 2 | "still treats the newer obligation as current, the older as superseded, and still resolves task 2" | diff-local |
| Story 1 negative: Given task 2 whose current `build_review` obligation is open with no `Task:` trailer after its baseline, and an older superseded `build_review` obligation, when the completion resolver evaluates task 2, then task 2 is unresolved. | 2 | "leaves task 2 unresolved when its current `build_review` obligation is open with no post-boundary `Task:` trailer" | diff-local |
| Story 1 negative: Given task 2 with an open `prd_audit` obligation and a newer resolved `build_review` obligation that is current, when the completion resolver evaluates task 2, then task 2 is unresolved because the `prd_audit` obligation is live and has no closure evidence. | 2 | "leaves it unresolved when an older open `prd_audit` obligation has no closure evidence beside a newer resolved current `build_review` obligation" | diff-local |
| Story 1 negative: Given task 2 whose older superseded obligation has a baseline head that no longer exists and no rebase successor, and whose current obligation is resolved, when the completion resolver evaluates task 2, then task 2 is resolved and no unavailable reason names the missing boundary. | 2 | "`resolveTaskIdsWithDiagnostics` resolves task 2 with no unavailable reason when its older open `build_review` obligation (baseline head `orphaned-boundary`, no rebase successor) is superseded by a newer current resolved `build_review` obligation" | diff-local |
| Story 2 happy: Given task 2 with an older open superseded `build_review` obligation and a newer open current `build_review` obligation, when `task done 2` closes the task with valid Done-when evidence, then it exits 0, the current obligation is resolved with `current-done-when` evidence, the superseded record is left unchanged, and the task-status row is `completed`. | 3 | "`runTaskDone` with valid Done-when evidence exits 0 beside an open superseded `build_review` obligation, resolves the current obligation with `current-done-when` evidence, leaves the superseded record byte-identical, and writes the row `completed`" | diff-local |
| Story 2 happy: Given task 2 whose only open obligation is superseded, when `openRepairForTask` is asked about task 2, then it reports no open repair. Given task 2 whose current obligation is open, it reports that current obligation's id, not the superseded one's. | 3 | "`openRepairForTask` returns `{ kind: 'none' }` when task 2's only open obligation is superseded, and returns the current obligation's id (not the superseded one's) when the current obligation is open" | diff-local |
| Story 2 negative: Given task 2 with an open `prd_audit` obligation and a newer open current `build_review` obligation, when `task done 2` closes the task with valid Done-when evidence, then both obligations are resolved, because a different-authority obligation is live and is not skipped. | 3 | "`runTaskDone` with valid Done-when evidence resolves both an open `prd_audit` obligation and a newer open current `build_review` obligation on task 2" | diff-local |
| Story 2 negative: Given a superseded obligation, when `RepairObligationStore.close` is called for it directly, then it is still refused as `stale` with the message "Repair obligation has been superseded for this task", and the record stays open. | 1 | "`RepairObligationStore.close` on a superseded obligation returns `kind: 'stale'` with message "Repair obligation has been superseded for this task" and leaves its task `open`" | diff-local |
| Story 3 happy: Given task 2 with a `completed` task-status row, an older open superseded `build_review` obligation and a newer resolved current `build_review` obligation, when task status is seeded, then task 2's row stays `completed`. | 4 | "`seedTaskStatus` leaves task 2's `completed` row `completed` when its only open obligation is a superseded `build_review` obligation and its current obligation is resolved" | diff-local |
| Story 3 negative: Given task 2 with a `completed` task-status row and an open current obligation, when task status is seeded, then task 2's row is restaged to `pending`. | 4 | "`seedTaskStatus` restages task 2's `completed` row to `pending` when its current obligation is open" | diff-local |
| Story 4 happy: Given task 2 with an open obligation and no `currentByPlan` entry for task 2, when the completion resolver evaluates task 2, then task 2 is unresolved and its unavailable reason is `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it`, and the build completion check's pending reason contains that text. | 2, 5 | "`checkStepCompletion(dir, 'build', …)` returns `done: false` for a current-less task 2 with a reason containing `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it`" | diff-local |
| Story 4 happy: Given the same state, when `task done 2` runs, then it exits 1 and prints that same reason, and no obligation or task-status row changes. | 3 | "`runTaskDone` for a current-less task 2, with the `current-task` stamp present and absent, exits 1, prints `repair state is unavailable: task 2 has an open repair obligation but no current obligation is recorded for it`, and leaves `engine-state.json` and `task-status.json` byte-identical" | diff-local |
| Story 4 negative: Given task 2 whose `currentByPlan` entry names an obligation id that has no record, when the completion resolver, `openRepairForTask` and task seeding evaluate task 2, then each treats it as current-less: unresolved with the named reason, `unavailable` with the named reason, and a `pending` row respectively. | 2, 3, 4 | "`openRepairForTask` returns `kind: 'unavailable'` with that same reason for a current-less task 2, both when its `currentByPlan` entry is missing and when it names a nonexistent record" | diff-local |
| Story 4 negative: Given task 3 in the same plan with no repair obligation and a `completed` row, and task 4 whose obligations are all resolved but which has no current entry, when the completion resolver evaluates tasks 3 and 4, then both are resolved and neither records an unavailable reason. | 2 | "`resolveTaskIdsWithDiagnostics` resolves task 3 (no obligation, `completed` row) and task 4 (all obligations resolved, no current entry) with no unavailable reason for either" | diff-local |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [x] Dependencies are explicit and acyclic
