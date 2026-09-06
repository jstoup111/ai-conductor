# Implementation Plan: Recoverable resolution worktree after a crashed attempt

**Date:** 2026-09-06
**Stories:** .docs/stories/reap-stale-resolution-worktree-registration-before.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing transient-worktree contract — same helper signature, same in-process serial guard, same active-claim refusal, same lifecycle queue for every git mutation, and the same path-scoped (never repository-wide) reap the feature-worktree cleanup path already uses.

## Summary

Four bounded tasks deliver #2157: one production edit adds a path-scoped, failure-tolerant registration reap to the transient resolution worktree helper, and three test tasks pin the recovery, the preserved tolerance, the scoping, and the active-claim refusal against a real local git repository. Repository-wide sweeps, the daemon's per-feature worktree lifecycle, the eligibility gate, and escalation labelling are outside this slice.

## Technical Approach

The helper currently clears a crashed prior attempt's leftover with a directory delete alone, then adds a fresh detached checkout. A crash between the add and the teardown leaves the path registered with git; the delete then produces a registered-but-missing worktree, and every later `git worktree add --detach` for that path fails with `missing but already registered worktree`. The teardown that would have reaped the registration lives in a `finally`, so a genuine crash never reaches it and the registration survives every retry.

The fix is one guarded step placed immediately before the existing directory delete, inside the same `try` and behind the same active-claim refusal that already gates every mutation in this helper: issue `git worktree remove --force` for this attempt's own transient path through the existing `mutateWorktree` lifecycle queue, and swallow its failure. Ordering matters and is deliberate. The reap succeeds and clears the registration for both crashed shapes — registered-and-missing and registered-and-present — and the subsequent delete then handles the one shape the reap cannot: a leftover directory git never knew about. In the ordinary case of no leftover at all, the reap exits non-zero because the path is not a working tree; that is the expected steady-state outcome and must be tolerated silently, not logged as a fault or propagated.

The reap names one path and never sweeps. A repository-wide `git worktree prune` would scan the shared git directory and reap a sibling slug that is racing through its own lifecycle, which is why the feature-worktree cleanup path already uses a targeted removal helper and records that reasoning in its own comment. This plan reuses that established shape rather than the filer's prune hypothesis; the git subcommand is identical to the one the helper's teardown already issues, so no new git surface enters the codebase.

Local test pattern context, from the repository's test-design rules: the integration file that owns this helper stands up a real local git repository per case with `mkdtemp`, a pinned initial branch, local identity, `commit.gpgsign` disabled, no remote, and a matching `rm` in teardown; it reads registration state through `git worktree list --porcelain` and drives the real helper with an injected `prepareWorktree` or the default one. That is the correct level here because git registration semantics are precisely the boundary under test, and it is the pattern every new case in this plan follows. No LLM, GitHub, network, or package-manager call is permitted; no `Conductor.run` fixture is involved. Search hints for comparable code: the existing leftover-directory case and the failure-teardown case in that same file. The allowed variation is fixture builders, slug names, and assertion grouping; what may not vary is the real-git boundary and the porcelain listing as the registration oracle. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the path-scoped reap over the prune hypothesis, and both stories on 2026-09-06 (delegated).
- Verified: the helper's leftover handling is a bare recursive directory delete at `src/conductor/src/engine/autoresolve.ts:343`, followed by the `.worktrees` mkdir and `git worktree add --detach` at lines 346 and 351.
- Verified: the teardown `git worktree remove --force` runs only in the helper's `finally` at line 368, so an out-of-process crash never reaches it.
- Verified: `mutateWorktree` at line 338 routes every git mutation through the optional `WorktreeLifecycleQueue`, whose `run` serializes work and cannot be poisoned by a rejected operation.
- Verified: `removeStaleWorktreeRegistration` in `src/conductor/src/engine/worktree.ts` performs exactly this targeted removal after a failed cleanup and states in a comment that a repository-wide prune is unsafe while another slug is racing.
- Verified: `git worktree remove --force` clears a registered-but-missing registration and exits 0, and exits 128 with `is not a working tree` when the path is unknown to git; observed directly against git 2.53.0 in a throwaway repository.
- Verified: the helper's two callers, the autoresolve dispatch path and the CI-fix path, pass the same arguments and are unaffected by an internal step.
- Verified: the owning integration test file already builds a real local git repository per case and covers only the unregistered-leftover shape.
- Scope check: consumer-facing engine behavior in a shipped daemon code path; no new skill; provider-agnostic. Event spine: no new event, metric, span, log line, or report is introduced, and no existing one changes shape.
- Verify-claims verdict: CLEAR. No load-bearing assumption remains unconfirmed; the one git behavior the design depends on was executed rather than inferred.

## Tasks

### Task 1: Reap the attempt's own leftover registration before recreating
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/autoresolve.ts, src/conductor/test/integration/autoresolve-worktree-lifecycle.test.ts
**Dependencies:** none

**Steps:**
1. Add two integration cases to the helper's existing real-git file, following the local pattern above: build the repository fixture, register the transient path with a detached add, then simulate the crash by deleting that directory in one case and leaving it populated with a leftover file in the other.
2. Run both and confirm RED — the first fails on the missing-but-already-registered add, the second on leftover content reaching the callback.
3. Implement the fix: immediately before the existing directory delete, issue a path-scoped `git worktree remove --force` for this attempt's own transient path through the existing lifecycle-queue wrapper, wrapped so its failure is swallowed. Keep the delete, the mkdir, and the detached add exactly as they are, and leave the active-claim refusal and serial guard untouched.
4. Confirm GREEN for the two new cases and the file's existing cases, then commit the focused change.

**Done when:**
1. The helper issues a path-scoped `git worktree remove --force` for its own transient path through the lifecycle-queue wrapper before the directory delete, and a failure of that command is swallowed rather than propagated.
2. The registered-but-missing integration case returns its callback's value instead of throwing the missing-but-already-registered error.
3. The registered-and-present integration case observes a fresh checkout containing the branch-tip file and none of the leftover files.

### Task 2: Preserve tolerance for the no-leftover and unregistered-leftover shapes
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/integration/autoresolve-worktree-lifecycle.test.ts
**Dependencies:** 1

**Steps:**
1. Add an integration case for the steady state where neither a registration nor a directory exists for the slug, asserting the attempt resolves with its callback's value and that nothing from the leftover handling rejects or is re-thrown.
2. Extend the file's existing unregistered-leftover case to also read the porcelain worktree listing from inside the callback and assert the transient path appears there exactly once, proving the new reap left registration coherent rather than doubled or absent.
3. Run both cases and confirm they pass against the Task 1 implementation, then temporarily make the reap propagate its failure to confirm the no-leftover case genuinely fails without the tolerance, and restore it.
4. Commit the focused test change.

**Done when:**
1. The no-leftover integration case resolves with its callback's value and surfaces no error originating in the leftover handling.
2. The unregistered-leftover case still observes a fresh checkout carrying none of the leftover files, and the porcelain listing names the transient path exactly once while the callback runs.

### Task 3: Keep the reap scoped to one path and prove registrations do not accumulate
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/integration/autoresolve-worktree-lifecycle.test.ts
**Dependencies:** 1

**Steps:**
1. Add an integration case that registers a second, unrelated slug's worktree alongside a stale registration for the attempt's slug, runs the attempt, and then asserts the unrelated worktree is still listed and its checked-out file still readable.
2. Add an integration case that performs the crash simulation twice in a row for the same slug — register, delete the directory, attempt, repeat — and asserts the porcelain listing contains no entry for the transient path after the final attempt returns.
3. Confirm both pass against the Task 1 implementation, and confirm by inspection that the implementation names only the attempt's own path so no repository-wide sweep can reach a sibling slug.
4. Commit the focused test change.

**Done when:**
1. The sibling-slug integration case asserts the unrelated worktree remains in the porcelain listing and its checked-out file remains readable after the attempt for the stale slug returns.
2. The repeated-crash integration case asserts the porcelain listing contains no entry for the transient path after the final attempt returns.
3. The implementation diff contains no repository-wide worktree sweep; every reap invocation names the attempt's own transient path.

### Task 4: Refuse to reap anything while an active work claim holds the slug
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/integration/autoresolve-worktree-lifecycle.test.ts
**Dependencies:** 1

**Steps:**
1. Add an integration case that registers the transient path for the slug and leaves a recognizable file inside it, then requests an attempt with an injected liveness predicate that reports the feature as in flight.
2. Assert the call rejects with the existing active work claim error and that the callback never ran.
3. Assert the pre-existing registration is still present in the porcelain listing and the recognizable file is still readable, proving the new reap sits behind the refusal rather than before it.
4. Confirm the case passes against the Task 1 implementation and commit the focused test change.

**Done when:**
1. The active-claim integration case rejects with the existing active work claim error and its callback is never invoked.
2. The same case asserts the pre-existing transient registration is still present in the porcelain listing and its leftover file is still readable after the rejection.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the transient resolution path for a slug is still registered with git but its directory is gone after a crashed prior attempt, when a new attempt runs for that slug, then the attempt creates a fresh detached checkout at the branch tip and returns its result without operator intervention. | 1 | "The registered-but-missing integration case returns its callback's value instead of throwing the missing-but-already-registered error." | diff-local |
| Story 1 happy: Given the transient resolution path for a slug is still registered with git and its directory is still present after a crashed prior attempt, when a new attempt runs for that slug, then the attempt creates a fresh detached checkout at the branch tip carrying none of the leftover files. | 1 | "The registered-and-present integration case observes a fresh checkout containing the branch-tip file and none of the leftover files." | diff-local |
| Story 1 negative: Given no leftover registration and no leftover directory exist for a slug, when an attempt runs for that slug, then the attempt succeeds and no failure from the leftover handling is surfaced to the caller. | 2 | "The no-leftover integration case resolves with its callback's value and surfaces no error originating in the leftover handling." | diff-local |
| Story 1 negative: Given a leftover directory exists for a slug but is not registered with git, when an attempt runs for that slug, then the leftover directory is removed and the fresh checkout carries none of its files. | 2 | "The unregistered-leftover case still observes a fresh checkout carrying none of the leftover files, and the porcelain listing names the transient path exactly once while the callback runs." | diff-local |
| Story 2 happy: Given a stale registration exists for the attempt's slug and a separate registered worktree exists for a different slug, when the attempt runs, then the attempt completes and the other slug's worktree stays registered and present on disk. | 3 | "The sibling-slug integration case asserts the unrelated worktree remains in the porcelain listing and its checked-out file remains readable after the attempt for the stale slug returns." | diff-local |
| Story 2 happy: Given a slug's transient path has been left registered by two successive crashed attempts, when a third attempt runs and completes, then git reports no registration for that transient path afterwards. | 3 | "The repeated-crash integration case asserts the porcelain listing contains no entry for the transient path after the final attempt returns." | diff-local |
| Story 2 negative: Given the daemon holds an active work claim for the slug, when an attempt is requested, then it is refused with the active-claim error and the slug's existing registration and directory are left exactly as they were. | 4 | "The same case asserts the pre-existing transient registration is still present in the porcelain listing and its leftover file is still readable after the rejection." | diff-local |

## Test dispositions and integration ownership

All seven criteria are diff-local: each is decided entirely by the helper's own behavior against a fixture repository the test builds and tears down, so no commit outside this feature's diff can change whether one holds. Every criterion is proved at the integration level against a real local git repository, because git's registration semantics are the boundary under test and a mocked git runner would assert the fix's shape rather than its effect; the repository's test rules allow real local git exactly when git semantics are the subject. Task 1 owns the production change and the two recovery criteria. Task 2 owns the preserved-tolerance criteria. Task 3 owns the scoping and non-accumulation criteria. Task 4 owns the active-claim refusal criterion.

Task 1 also owns cross-boundary integration for this change: the observable behavior it pins is the exported helper's own contract — the entry point both the autoresolve dispatch path and the CI-fix path reach it through — driven end to end against real git rather than through a private caller or a line reference. No caller signature, configuration key, or event changes, so no further entry point is in scope, and no new external-service or aggregate test is required. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 1 -> Task 4
