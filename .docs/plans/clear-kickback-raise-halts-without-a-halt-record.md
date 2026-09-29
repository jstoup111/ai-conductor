# Implementation Plan: Clear kickback raise halts without a halt record

**Date:** 2026-09-28
**Stories:** .docs/stories/clear-kickback-raise-halts-without-a-halt-record.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to adr-2026-08-23-committed-halt-record decision 7 (resume rewrites an existing record in place) and adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class (recordability unchanged).

## Summary

Three bounded tasks deliver #2752. An absent committed halt record becomes a `noop` for supersession, so a consumed kickback-budget raise clears the halt; an existing halted record is still resolved; and any other read or write failure still retains the halt, now with its reason in the daemon log. Authorization selection in `consumeResumeAuthorizations` (#2595), halt-record recordability, and the record format are out of scope.

## Technical Approach

In `supersedeHaltRecord` (`src/conductor/src/engine/halt-record.ts`), catch the `readFile` error for the record path only: when its `code` is `ENOENT`, return `{ kind: 'noop' }` before any write, stage, or commit. Every other read error, and every write, commit, or push error, keeps flowing to the existing outer catch and result arms unchanged. Reuse the existing `noop` kind; do not add a new `HaltRecordResult` member. Do not create the record directory or file on the absent path.

In `clearHaltForResume` (`src/conductor/src/engine/daemon-rekick.ts`), when the resolver returns `{ kind: 'failed', reason }`, include the reason in the existing retention log line, keeping the `kickback-budget <slug>: halt record not superseded` prefix and `halt retained` suffix. The throw branch already logs the error message and stays as is. Ordering (presentation repair, record, marker) and the `partial` result are unchanged.

The daemon entry point (`daemon-cli.ts`) already composes `clearHaltForResume` with `supersedeHaltRecord(worktreePath, feature, 'kickback-budget')`; it is not edited. Integration ownership sits in Task 3, which composes the real `clearHaltForResume` with the real `supersedeHaltRecord` exactly as that wiring does, over a real temporary Git repository, with an injected successful remote (the existing `successfulRemote` helper) and an injected marker-clear recorder. No real network, GitHub, or LLM is reached.

Other callers of `supersedeHaltRecord` (`daemon-deps.ts` `appendHaltClearedRecord` and the `conductor.ts` stall path) ignore its result and are unaffected.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, the ENOENT-as-noop approach, and both stories on 2026-09-28 (delegated).
- Verified: `halt-record.ts` `supersedeHaltRecord` reads the record with `readFile(path, 'utf8')` and its outer catch returns `{ kind: 'failed', reason }` for any error, including ENOENT; an unchanged (already resolved) text returns `{ kind: 'noop' }`.
- Verified: `isRecordableHaltClass` covers only `needs-human`, `plan-gap`, and `protected-artifact`; `halt-classification.ts` `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` maps `prd_audit` and `architecture_review_as_built` to `kickback-cap`, so those caps never write a record.
- Verified: `daemon-rekick.ts` `clearHaltForResume` returns `partial` and logs `halt record not superseded — halt retained` without a reason when the resolver returns kind `failed`, and logs the error message when it throws.
- Verified: `daemon-cli.ts` wires `resolveCommittedRecord` to `supersedeHaltRecord(worktreePath, feature, 'kickback-budget')`.
- Verified: `src/conductor/test/engine/halt-record.test.ts` has `makeFeatureRepository`, `commitCount`, and `successfulRemote` helpers, and a test named "returns a failure result when the record cannot be read" that currently asserts `failed` for an absent record; it must be re-pointed.
- Verified: `src/conductor/test/engine/daemon-rekick.test.ts` has a `clearHaltForResume` describe block with injected-dependency cases.
- Scope check: repository-only daemon behavior; no skill addition; provider-agnostic. Event-spine: no new channel; an existing log line gains its reason.
- Verify-claims verdict: CLEAR.

## Tasks

### Task 1: Treat an absent halt record as nothing to supersede
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/halt-record.ts, src/conductor/test/engine/halt-record.test.ts
**Dependencies:** none

**Steps:**
1. In `halt-record.test.ts`, replace the absent-record `failed` assertion with an absent-record case asserting `{ kind: 'noop' }`, no halt record file afterwards, and an unchanged `commitCount`. Add an unreadable case where the record path is a directory, asserting `kind: 'failed'` with a non-empty reason. Use the existing `makeFeatureRepository` helper; no remote is reached on either path.
2. Establish RED, then catch the `readFile` error in `supersedeHaltRecord` and return `noop` only when its `code` is `ENOENT`; rethrow every other error to the existing outer catch.
3. Keep the existing "commits a resolution once when superseded repeatedly" case passing unchanged.
4. Run the file through ai-conductor scoped-run and commit.

**Done when:**
1. `supersedeHaltRecord` on a feature repository with no halt record returns `{ kind: 'noop' }`, leaves no halt record file, and leaves `commitCount` unchanged, as asserted by the absent-record test.
2. `supersedeHaltRecord` on a repository whose halt record path is a directory returns `kind: 'failed'` with a non-empty reason, as asserted by the unreadable-record test.
3. The existing repeated-supersession test still observes `written` then `noop` with exactly one added commit.

### Task 2: Name the failure reason when the record step retains the halt
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/daemon-rekick.ts, src/conductor/test/engine/daemon-rekick.test.ts
**Dependencies:** none

**Steps:**
1. In the existing `clearHaltForResume` describe block, extend the typed-failure case so the resolver returns `{ kind: 'failed', reason: 'EISDIR: illegal operation' }` with an injected `log` collector; assert `partial`, no marker call, and one log line containing both `halt record not superseded` and the reason.
2. Establish RED, then include the typed failure's reason in the existing retention log line in `clearHaltForResume`; leave ordering, the throw branch, and the `partial` result unchanged.
3. Run the file through ai-conductor scoped-run and commit.

**Done when:**
1. `clearHaltForResume` given a resolver result of kind `failed` with a reason returns `partial`, never invokes `clearMarker`, and logs one line containing `halt record not superseded` and that reason, as asserted by the typed-failure test.
2. The existing throw, presentation-partial, and ordering tests in the `clearHaltForResume` block pass unchanged.

### Task 3: Prove the daemon clear composition over a real repository
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/engine/halt-record.test.ts
**Dependencies:** 1, 2

**Steps:**
1. Add a describe block in `halt-record.test.ts` that calls the real `clearHaltForResume` with `resolveCommittedRecord` set to the real `supersedeHaltRecord(worktreePath, slug, 'kickback-budget', successfulRemote())`, mirroring the daemon-cli wiring, plus a recording `clearMarker` and a `log` collector. Omit `resolvePrUrl` so no presentation repair runs.
2. Absent case: a feature repository with no halt record; assert the clear result `confirmed`, `clearMarker` invoked once, no halt record file, and `commitCount` unchanged.
3. Halted case: write a record with the existing `recordHalt(root, input, successfulRemote())`; assert `confirmed`, `clearMarker` invoked once, the record text contains `Status: resolved` and `Resolution cause: kickback-budget`, and `commitCount` grew by exactly one.
4. Unreadable case: create a directory at the halt record path; assert `partial`, `clearMarker` never invoked, and a log line containing `halt record not superseded` and the directory read error text.
5. Run the file through ai-conductor scoped-run and commit.

**Done when:**
1. The composed clear over a repository with no halt record returns `confirmed`, invokes `clearMarker` once, and leaves no halt record file and an unchanged `commitCount`.
2. The composed clear over a repository with a halted record returns `confirmed`, invokes `clearMarker` once, and leaves the record reading `Status: resolved` with `Resolution cause: kickback-budget` in exactly one new commit.
3. The composed clear over a repository whose halt record path is a directory returns `partial`, never invokes `clearMarker`, and logs a line containing `halt record not superseded` and the read error.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a halted feature worktree whose branch has no committed halt record, when a consumed kickback-budget raise clears its halt, then the clear reports confirmed and the halt marker is removed. | 1, 3 | "The composed clear over a repository with no halt record returns `confirmed`, invokes `clearMarker` once, and leaves no halt record file and an unchanged `commitCount`." | diff-local |
| Story 1 negative: Given a feature worktree whose branch has no committed halt record, when the committed-record step of the clear runs, then it reports noop, no halt record file is created, and no commit is added to the branch. | 1 | "`supersedeHaltRecord` on a feature repository with no halt record returns `{ kind: 'noop' }`, leaves no halt record file, and leaves `commitCount` unchanged, as asserted by the absent-record test." | diff-local |
| Story 2 happy: Given a feature worktree whose committed halt record is in halted state, when a consumed kickback-budget raise clears its halt, then the record is rewritten to resolved with resolution cause kickback-budget in exactly one new commit and the clear reports confirmed. | 3 | "The composed clear over a repository with a halted record returns `confirmed`, invokes `clearMarker` once, and leaves the record reading `Status: resolved` with `Resolution cause: kickback-budget` in exactly one new commit." | diff-local |
| Story 2 negative: Given the halt record path exists but cannot be read as a file, when a consumed kickback-budget raise clears its halt, then the committed-record step reports failed, the clear reports partial, the halt marker is not removed, and the logged retention line names the failure reason. | 1, 2, 3 | "The composed clear over a repository whose halt record path is a directory returns `partial`, never invokes `clearMarker`, and logs a line containing `halt record not superseded` and the read error." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the unit-level supersession results for absent and unreadable records against a real temporary Git repository (Git semantics are the subject: commit count and file presence). Task 2 owns the unit-level log and retention behavior of `clearHaltForResume` with injected dependencies. Task 3 owns the integration proof: the real `clearHaltForResume` composed with the real `supersedeHaltRecord` exactly as the daemon entry point wires them, with only the remote push and marker clear injected. No new aggregate or external-service test is required. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 3
Task 2 -> Task 3
