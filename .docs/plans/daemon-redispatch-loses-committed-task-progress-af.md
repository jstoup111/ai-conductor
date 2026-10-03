# Implementation Plan: Task-status recovery after abrupt daemon death

**Date:** 2026-10-03
**Stories:** .docs/stories/daemon-redispatch-loses-committed-task-progress-af.md
**Conflict check:** Clean as of 2026-10-03

## Summary

Make `seedTaskStatus` restore a single missing task row from its branch-scoped `Task:` trailer on every seed, and reset a stale trailerless `in_progress` row to `pending` only at the pre-BUILD dispatch seed (#2673). Five tasks.

## Technical Approach

- **One function, two additive rules** in `src/conductor/src/engine/task-seed.ts` `seedTaskStatus`, governed by `adr-2026-09-06-reopened-task-resolution` decision 12. The existing `reconstructing` path (whole file missing, empty, or corrupt) is unchanged.
- **Missing-row restore (every seed).** The trailer map from the existing `trailerProvenCompletions` (merge-base of origin and HEAD, newest-first, no provable range means an empty map) is now computed whenever at least one plan task has no row, and used in the existing new-row branch with `restored_from: 'task-trailer'`. A task that already has a row of any status is never consulted against trailers, so restaged or reopened `pending` rows stay pending. The open-repair override after the upsert loop stays last.
- **Dispatch-boundary reset.** `seedTaskStatus` gains an optional trailing options argument with a dispatch-boundary flag, default off. With the flag, an `in_progress` row whose canonical id has no trailer is set to `pending`; with a trailer it stays `in_progress` (operator decision: no upgrade to `completed`). Only `seedBuildTaskTelemetry` in `src/conductor/src/engine/conductor.ts`, which runs before every BUILD dispatch including kickback re-entry, passes the flag. The build completion predicate (`artifacts.ts`), remediation append (`conductor.ts`), and `repair-restage.ts` keep their current calls.
- **Git cost** stays zero on the common path: the scan runs only when a plan task lacks a row, or at the dispatch boundary when an `in_progress` row exists.
- **Tests** use a real temporary git repository with `refs/remotes/origin/main` at the base commit and `Task: <id>` trailered commits, the fixture style already used by `src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts` and `src/conductor/test/engine/pipeline-run-state-repair.test.ts`. Unit tests live in `src/conductor/test/engine/task-seed.test.ts`. The acceptance file's two weakened cases are restored to #2673's original assertions.
- **Out of scope** (track scope boundary): clearing `.pipeline/current-task`, upgrading `in_progress` rows to `completed`, moving task progress out of the worktree, and #2261's completion-authority consolidation.
- **Companion:** jstoup111/ai-conductor#2956 reconciles two older stories with the dispatch reset; merge it with this spec.

## Prerequisites

- None.

## Tasks

### Task 1: Restore a single missing task row from its Task trailer on every seed
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/task-seed.test.ts` against a real temporary git repository (follow the real-git fixture style in `src/conductor/test/engine/pipeline-run-state-repair.test.ts` and `daemon-death-resume.acceptance.test.ts`: `git init`, set `refs/remotes/origin/main` to the base commit, then commit tasks carrying `Task: <id>` trailers). Fixture: a usable task-status.json with rows for every plan task except task 18.
2. In `src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts`, change the 'restores a missing completed row from its Task trailer' case so it writes a populated task-status.json and removes only task 18's row (not the whole file), per #2673.
3. Verify RED: today the trailer scan runs only when `reconstructing` is true.
4. Implement in `seedTaskStatus` (`src/conductor/src/engine/task-seed.ts`): after loading existing rows, compute whether any plan task lacks a row; only then call `trailerProvenCompletions` (unchanged: branch-scoped merge-base range, fail-closed). Use the proven map in the existing new-row branch (`restored_from: 'task-trailer'`) for every seed, not only when `reconstructing`. Never consult trailers for a task that already has a row. Keep the open-repair override after the upsert loop exactly as it is (adr-2026-09-06-reopened-task-resolution decisions 6 and 12).
5. Verify GREEN, then commit.

**Done when:**
- A task-seed unit test runs `seedTaskStatus` on a task-status.json missing only task 18's row, in a real git repository whose commit after the merge-base with origin carries `Task: 18`, and asserts task 18 is written with status completed, that commit's sha, and restored_from task-trailer.
- The same unit test asserts every other row keeps its fixture status and commit after the seed.
- A task-seed unit test with task 18's row missing and no `Task: 18` trailer after the merge-base asserts `seedTaskStatus` writes task 18 with status pending.
- A task-seed unit test where every plan task already has a row mocks the trailer listing and asserts `seedTaskStatus` never calls `listCommitsWithTrailers`.
- `daemon-death-resume.acceptance.test.ts` removes only task 18's row from a populated task-status.json, runs `seedTaskStatus`, and asserts task 18 is completed with its trailer commit and task 19 is the first non-completed row.

**Files likely touched:**
- src/conductor/src/engine/task-seed.ts
- src/conductor/test/engine/task-seed.test.ts
- src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts

**Dependencies:** none

### Task 2: Missing-row restore negative paths
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/task-seed.test.ts` using the Task 1 real-git fixture for each negative path below. For the open-repair case, seed engine state with an open repair obligation for task 18 the way the existing 'keeps an open repair pending while preserving an untouched completed sibling' test does.
2. Verify each test against the Task 1 implementation; fix `seedTaskStatus` if any fails (existing rows are never upgraded; open-repair override runs after restore; no provable range yields no restored completions).
3. Commit.

**Done when:**
- A task-seed unit test with an existing pending row for task 18 and a `Task: 18` trailer after the merge-base asserts `seedTaskStatus` leaves task 18 pending.
- A task-seed unit test with task 18's row missing, a `Task: 18` trailer after the merge-base, and an open repair obligation for task 18 asserts `seedTaskStatus` writes task 18 with status pending.
- A task-seed unit test whose only `Task: 18` commit is on origin's default branch at or before the merge-base asserts `seedTaskStatus` writes task 18 with status pending.
- A task-seed unit test with task 18's row missing in a repository with no origin ref asserts `seedTaskStatus` resolves without throwing and writes task 18 with status pending.

**Files likely touched:**
- src/conductor/test/engine/task-seed.test.ts

**Dependencies:** Task 1

### Task 3: Reset a stale in-progress task to pending at the pre-BUILD dispatch seed
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: a task-seed unit test with task 19 in_progress, no commit, and no `Task: 19` trailer after the merge-base, seeded with a new dispatch-boundary option; and a test that calls the exported `seedBuildTaskTelemetry(projectRoot, featureDesc)` from `src/conductor/src/engine/conductor.ts` on a fixture whose plan resolves for that feature.
2. In `src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts`, change the 'keeps an uncommitted in-flight task in_progress' case to call `seedBuildTaskTelemetry(root, FEATURE)` and expect task 19 pending (#2673), and change the resume case to seed through `seedBuildTaskTelemetry` instead of `seedTaskStatus`.
3. Verify RED.
4. Implement: add an optional trailing options argument to `seedTaskStatus` carrying a dispatch-boundary flag (default off). When on, an existing `in_progress` row whose canonical id has no entry in the branch-scoped trailer map is set to `pending`; one with a trailer is left `in_progress`. Run the trailer scan when the flag is on and any `in_progress` row exists (in addition to Task 1's missing-row condition). `seedBuildTaskTelemetry` is the only caller that passes the flag; the build completion predicate in `artifacts.ts`, remediation append in `conductor.ts`, and `repair-restage.ts` keep calling without it.
5. Verify GREEN, then commit.

**Done when:**
- A task-seed unit test with task 19 in_progress, no commit, and no `Task: 19` trailer after the merge-base asserts `seedTaskStatus` with the dispatch-boundary option writes task 19 with status pending.
- A test calls `seedBuildTaskTelemetry(root, featureDesc)` on a fixture with a trailerless in_progress task 19 and reads task 19 back with status pending, proving `seedBuildTaskTelemetry` passes the dispatch-boundary option.
- `daemon-death-resume.acceptance.test.ts` seeds task 19 as in_progress with no trailer, calls `seedBuildTaskTelemetry`, and asserts task 19 is pending with no commit and that no row has status completed.
- `daemon-death-resume.acceptance.test.ts`'s resume case calls `seedBuildTaskTelemetry` and asserts rows 1 through 18 serialize identically to their pre-seed JSON, `.pipeline/events.jsonl` is byte-identical, and `.pipeline/conduct-state.json`, which records every DECIDE step status, is byte-identical so each DECIDE step status is unchanged.

**Files likely touched:**
- src/conductor/src/engine/task-seed.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/task-seed.test.ts
- src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts

**Dependencies:** Task 1

### Task 4: Stale in-progress reset negative paths and completed-row preservation
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/task-seed.test.ts` using the real-git fixture for each case below.
2. Verify each against the Task 3 implementation; fix `seedTaskStatus` if any fails.
3. Commit.

**Done when:**
- A task-seed unit test with task 19 in_progress and a `Task: 19` trailer after the merge-base asserts `seedTaskStatus` with the dispatch-boundary option leaves task 19 in_progress.
- A task-seed unit test with a trailerless task 19 in_progress asserts `seedTaskStatus` without the dispatch-boundary option leaves task 19 in_progress.
- In the diff, `seedBuildTaskTelemetry` is the only caller passing the dispatch-boundary option; the `seedTaskStatus` calls in the build completion predicate in `artifacts.ts`, the remediation append in `conductor.ts`, and `repair-restage.ts` pass no options argument.
- A task-seed unit test with task 19 in_progress in a repository with no origin ref asserts `seedTaskStatus` with the dispatch-boundary option resolves without throwing and writes task 19 with status pending.
- A task-seed unit test with task 5 completed and no `Task: 5` trailer after the merge-base asserts task 5 keeps status completed and its recorded commit after both a default seed and a dispatch-boundary seed.

**Files likely touched:**
- src/conductor/test/engine/task-seed.test.ts

**Dependencies:** Task 3

### Task 5: An unparseable task-status file after daemon death still dispatches and restores trailer-proven rows
**Story:** 3
**Type:** negative-path

**Steps:**
1. Add a case to `src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts` modeled on its existing 'dispatches the unfinished feature on the next poll when daemon death left no HALT' case: commit tasks 1-18 with trailers, write an unparseable `.pipeline/task-status.json` in the feature worktree, no HALT marker; run `runDaemon` once with the mocked `runFeature`, then call `seedBuildTaskTelemetry` on the feature root.
2. Keep the existing no-HALT case unchanged and passing.
3. Verify the new case passes (whole-file reconstruction already exists; fix `seedTaskStatus` if it does not), then commit.

**Done when:**
- `daemon-death-resume.acceptance.test.ts`'s existing no-HALT case still asserts `runDaemon` invokes `runFeature` once for the feature and no HALT marker exists afterwards.
- A new `daemon-death-resume.acceptance.test.ts` case with an unparseable task-status.json and no HALT marker asserts `runDaemon` invokes `runFeature` once for the feature.
- The same case calls `seedBuildTaskTelemetry` and asserts every task 1 through 18, each carrying a `Task:` trailer after the merge-base, has a row with status completed.

**Files likely touched:**
- src/conductor/test/acceptance/daemon-death-resume.acceptance.test.ts

**Dependencies:** Task 3

## Task Dependency Graph

```text
Task 1 ──┬── Task 2
         └── Task 3 ──┬── Task 4
                      └── Task 5
```

## Integration Points

- After Task 1: any seed caller restores a lost single row; the restored acceptance case passes.
- After Task 3: the pre-BUILD dispatch path (`seedBuildTaskTelemetry`) resets stale in-progress rows.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a usable task-status.json with rows for every plan task except task 18, and a commit after the merge-base with origin carrying the trailer `Task: 18`, when the task seed runs, then task 18 has a row with status completed, that commit's sha, and restored_from task-trailer, and every other row keeps its prior status and commit. | 1 | "A task-seed unit test runs `seedTaskStatus` on a task-status.json missing only task 18's row, in a real git repository whose commit after the merge-base with origin carries `Task: 18`, and asserts task 18 is written with status completed, that commit's sha, and restored_from task-trailer" | diff-local |
| Story 1 happy: Given a usable task-status.json with rows for every plan task except task 18, and no commit after the merge-base carries a `Task: 18` trailer, when the task seed runs, then task 18 has a row with status pending. | 1 | "A task-seed unit test with task 18's row missing and no `Task: 18` trailer after the merge-base asserts `seedTaskStatus` writes task 18 with status pending" | diff-local |
| Story 1 negative: Given task 18 has an existing pending row and a commit after the merge-base carries the trailer `Task: 18`, when the task seed runs, then task 18 stays pending. | 2 | "A task-seed unit test with an existing pending row for task 18 and a `Task: 18` trailer after the merge-base asserts `seedTaskStatus` leaves task 18 pending" | diff-local |
| Story 1 negative: Given task 18 has no row, a commit after the merge-base carries the trailer `Task: 18`, and an open repair obligation exists for task 18, when the task seed runs, then task 18 has a row with status pending. | 2 | "A task-seed unit test with task 18's row missing, a `Task: 18` trailer after the merge-base, and an open repair obligation for task 18 asserts `seedTaskStatus` writes task 18 with status pending" | diff-local |
| Story 1 negative: Given task 18 has no row and the only commit carrying the trailer `Task: 18` is on origin's default branch at or before the merge-base, when the task seed runs, then task 18 has a row with status pending. | 2 | "A task-seed unit test whose only `Task: 18` commit is on origin's default branch at or before the merge-base asserts `seedTaskStatus` writes task 18 with status pending" | diff-local |
| Story 1 negative: Given task 18 has no row and the origin ref or merge-base cannot be resolved, when the task seed runs, then task 18 has a row with status pending and the seed completes without throwing. | 2 | "A task-seed unit test with task 18's row missing in a repository with no origin ref asserts `seedTaskStatus` resolves without throwing and writes task 18 with status pending" | diff-local |
| Story 2 happy: Given task 19 has an in_progress row with no commit and no commit after the merge-base carries the trailer `Task: 19`, when the pre-BUILD dispatch seed runs, then task 19 has status pending. | 3 | "A task-seed unit test with task 19 in_progress, no commit, and no `Task: 19` trailer after the merge-base asserts `seedTaskStatus` with the dispatch-boundary option writes task 19 with status pending" | diff-local |
| Story 2 negative: Given task 19 has an in_progress row and a commit after the merge-base carries the trailer `Task: 19`, when the pre-BUILD dispatch seed runs, then task 19 stays in_progress. | 4 | "A task-seed unit test with task 19 in_progress and a `Task: 19` trailer after the merge-base asserts `seedTaskStatus` with the dispatch-boundary option leaves task 19 in_progress" | diff-local |
| Story 2 negative: Given task 19 has an in_progress row with no trailer, when a seed other than the pre-BUILD dispatch seed runs (the build completion check, remediation append, or repair restage), then task 19 stays in_progress. | 4 | "A task-seed unit test with a trailerless task 19 in_progress asserts `seedTaskStatus` without the dispatch-boundary option leaves task 19 in_progress" | diff-local |
| Story 2 negative: Given task 19 has an in_progress row and the origin ref or merge-base cannot be resolved, when the pre-BUILD dispatch seed runs, then task 19 has status pending and the seed completes without throwing. | 4 | "A task-seed unit test with task 19 in_progress in a repository with no origin ref asserts `seedTaskStatus` with the dispatch-boundary option resolves without throwing and writes task 19 with status pending" | diff-local |
| Story 3 happy: Given tasks 1 through 18 have completed rows with commits, task 19 has a stale in_progress row, and `.pipeline/events.jsonl` and the DECIDE step statuses exist from before the death, when the pre-BUILD dispatch seed runs, then tasks 1 through 18 keep their completed status and commits, `.pipeline/events.jsonl` is byte-identical, and every DECIDE step status is unchanged. | 3 | "`daemon-death-resume.acceptance.test.ts`'s resume case calls `seedBuildTaskTelemetry` and asserts rows 1 through 18 serialize identically to their pre-seed JSON, `.pipeline/events.jsonl` is byte-identical, and `.pipeline/conduct-state.json`, which records every DECIDE step status, is byte-identical so each DECIDE step status is unchanged" | diff-local |
| Story 3 happy: Given an unfinished feature whose worktree has no HALT marker after daemon death, when the daemon next polls its backlog, then the feature is dispatched without operator action. | 5 | "`daemon-death-resume.acceptance.test.ts`'s existing no-HALT case still asserts `runDaemon` invokes `runFeature` once for the feature and no HALT marker exists afterwards" | diff-local |
| Story 3 negative: Given task 5 has a completed row and no commit after the merge-base carries the trailer `Task: 5`, when any task seed runs, then task 5 stays completed with its recorded commit. | 4 | "A task-seed unit test with task 5 completed and no `Task: 5` trailer after the merge-base asserts task 5 keeps status completed and its recorded commit after both a default seed and a dispatch-boundary seed" | diff-local |
| Story 3 negative: Given an unfinished feature with no HALT marker whose task-status.json was left unparseable by the death, when the daemon next polls its backlog and the pre-BUILD dispatch seed runs, then the feature is dispatched and every trailer-proven task has a completed row. | 5 | "A new `daemon-death-resume.acceptance.test.ts` case with an unparseable task-status.json and no HALT marker asserts `runDaemon` invokes `runFeature` once for the feature" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-06-reopened-task-resolution#D1 | no-change | none | This feature adds no repair-obligation field or store; it only reads open obligations through the existing `createRepairObligationStore` reader in `seedTaskStatus`. |
| adr-2026-09-06-reopened-task-resolution#D2 | no-change | none | Obligation admission, persistence ordering, and replay are untouched; no seed path in this feature admits or persists an obligation. |
| adr-2026-09-06-reopened-task-resolution#D3 | no-change | none | This feature writes no engine-state.json field; `seedTaskStatus` writes only `.pipeline/task-status.json`. |
| adr-2026-09-06-reopened-task-resolution#D4 | no-change | none | Resolution freshness in `resolveTaskIds` is unchanged; the restored row is a seed-time row restore, and open obligations are forced pending by the existing override. |
| adr-2026-09-06-reopened-task-resolution#D5 | no-change | none | The post-reopen strict range is not used; restore uses only the existing branch-scoped `trailerProvenCompletions` merge-base range, which yields nothing when unprovable. |
| adr-2026-09-06-reopened-task-resolution#D6 | task | task-2 | asserts `seedTaskStatus` writes task 18 with status pending |
| adr-2026-09-06-reopened-task-resolution#D7 | no-change | none | Scope acceptance and OVER_SCOPE handling are not touched by task seeding. |
| adr-2026-09-06-reopened-task-resolution#D8 | no-change | none | Review return, no-progress escalation, and lap bounds are not touched by task seeding. |
| adr-2026-09-06-reopened-task-resolution#D9 | no-change | none | Remediation eligibility, manual_test consolidation, gate ownership, budgets, and plan-growth accounting are not touched. |
| adr-2026-09-06-reopened-task-resolution#D10 | no-change | none | coverage_binding reopen admission and charging are not touched; its obligations still reach the seed through the existing open-repair override. |
| adr-2026-09-06-reopened-task-resolution#D11 | no-change | none | Plan-task digest admission of `plan_amendment` obligations is not touched; those obligations still reach the seed through the existing open-repair override. |
| adr-2026-09-06-reopened-task-resolution#D12 | task | task-1, task-2, task-3, task-4 | with status completed, that commit's sha, and restored_from task-trailer |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
