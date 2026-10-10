# Implementation Plan: Multi-branch restack for stacked child plans (#2943)

**Date:** 2026-10-10
**Design:** .docs/decisions/adr-2026-10-10-stacked-restack-journaled-replay.md
**Stories:** .docs/stories/a-change-to-one-stacked-child-cannot-be-carried-in.md
**Conflict check:** Clean as of 2026-10-10 (.docs/conflicts/a-change-to-one-stacked-child-cannot-be-carried-in.md)

## Summary

Carry a change to one stacked child into every existing child above it, and refresh the whole stack
from the default branch wherever a rebase happens today. The design is
`adr-2026-10-10-stacked-restack-journaled-replay`: a journaled off-worktree plumbing replay,
path-ownership acceptance, one atomic compare-and-swap ref move, a worktree sync that never loses
local work, a narrow resolver hand-off, ref-only crash recovery run by one stack preflight,
cause-scoped refunds, a per-child cascade cap, a commit fence for engine commits, and expected-SHA
leases for every engine force push. Features without children keep today's `performRebase`. There
are 40 tasks.

## Technical Approach

- **New modules live under `src/conductor/src/engine/restack/`**, never at the top level of
  `conductor.ts` (the conductor decomposition shape guard, #1481, forbids new top-level helpers):
  - `restack-types.ts`: branded `CommitSha`, `RefName`, `RestackOpId`, the `ChildRange` record, the
    `RestackCause` and `JournalState` closed unions with `isLegalJournalTransition`, and the
    `RestackRefusalReason` closed union (architecture-review condition 2: no bare strings across
    the planner, journal, transaction and recovery boundaries).
  - `restack-journal.ts`: the ref-backed journal (`refs/conductor/<slug>/restack/journal`) and
    staging refs (`restack/staging/c<j>`).
  - `restack-plan.ts`: existing-children-only ranges, old parents, the unentered-leaf rule and the
    pre-planning refusals.
  - `restack-replay.ts`: per-commit `merge-tree --write-tree --merge-base c^1 <acc> c` plus
    `commit-tree`, authorship copy, journaled committer stamp, signing, empty and
    patch-equivalence rules, merge classes (through the classification helper exported from
    `rebase.ts`).
  - `restack-ownership.ts`: path-ownership acceptance and `parentOverlapPaths`.
  - `restack-move.ts`: pre-move checks, the single `update-ref --stdin` transaction, bounded lock
    retry, post-move verification and reverse-CAS rollback, plus `haltRestack`, the one place the
    executor emits `restack_refused` and writes its needs-human HALT.
  - `restack-sync.ts`: `read-tree -m -u` sync, untracked quarantine reuse, seal check and rotation,
    and half-applied-sync recovery.
  - `restack-resolver.ts`: the narrow resolver primitive in a temporary detached worktree under
    `.pipeline/restack/resolve/`.
  - `restack-executor.ts`: `runRestack`, the orchestrator (cap check, journal, replay, accept, move,
    sync, transition, `applied`, cleanup, events).
  - `restack-transition.ts`: verdict re-judgement (active-child tuple, whole-stack tuple, closed
    children's `wouldInvalidate`) and translation into the flat rewrite map.
  - `restack-recovery.ts`: the decision-7 recovery table.
  - `stack-preflight.ts`: `runStackPreflight` (journal recovery, then the automatic repair, then
    any chained base refresh).
  - `cascade-cap.ts`: the `refs/conductor/<slug>/cascades` blob, the cap check and cap evidence.
  - `restack-refs-cleanup.ts`: explicit-name deletion of every ref this ADR adds.
- **Three more new engine modules** sit outside `restack/` because N=1 uses them too:
  `src/conductor/src/engine/git-pinned-config.ts` (`withPinnedGitConfig`),
  `src/conductor/src/engine/guarded-engine-commit.ts` (`commitEngineChange`) and
  `src/conductor/src/engine/push-lease.ts` (pushed-tip recording and the lease decision table).
- **Local pattern basis** (from the architecture review; repeat the relevant traits in each task):
  - *Ref-backed durable state* (`startChild` and `refs/conductor/<slug>/positions` in
    `child-lifecycle.ts`): `hash-object -w` plus a compare-and-swap `update-ref`; the ref sits
    outside `refs/heads` and is never pushed. Allowed variation: a multi-ref `update-ref --stdin`
    transaction. Search hint: `grep -n "positionsRef" src/conductor/src/engine/child-lifecycle.ts`.
  - *Compare-and-swap ref moves* (`moveLeaf` in `child-lifecycle.ts`): an expected old value on
    every ref. No variation.
  - *Untracked-collision quarantine* (`moveRebaseUntrackedPathsToQuarantine`,
    `REBASE_UNTRACKED_QUARANTINE_DIR` in `rebase.ts`): move colliding untracked files aside, never
    delete them. Reused as-is.
  - Verified no-fit: no guarded-commit helper exists, so Task 26 introduces one.
- **The replay never touches the worktree or a real ref** until `ready`; the only worktree mutation
  is the sync after the move. No restack path uses `stash`, `--autostash`, `git replay` or
  `rebase --update-refs`.
- **Wiring by symbol, not line.** The preflight is called from the daemon dispatch in
  `src/conductor/src/daemon-cli.ts` (after `isOperatorParked`, before `consumeResumeAuthorizations`
  and `resumeRebaseFirst`) and from conductor resume in `conductor.ts` (before the halt-record
  supersede, `resolveActiveChild` and `classifyRebaseOperation`). The FINISH `runRebaseStep` and
  `resumeRebaseFirst` branch on `hasDurableChildState`.
- **Test pattern.** Every git hazard in ADR decision 13 is proven by a real-git test in a temporary
  repository, inside the task that implements the behaviour. A mocked git or remote runner is used
  only where a test must prove an argument is never issued (`stash`, `--autostash`, `rebase`,
  bare `--force-with-lease`, `fetch`, `push`), following the repository's process-isolation rule:
  assert that refused calls never reach the boundary. The two-process race uses a separate `node`
  child process against the same temp repository.
- **N=1 golden gate.** #3019's N=1 golden suite (`n1-golden-state.test.ts`,
  `n1-golden-renderings.test.ts`) is a Done-when gate on every task that touches `performRebase`
  (Task 3), `rebase-transition.ts` (Task 21) or `remote-git-operations.ts` (Task 35), and its
  fixtures are never re-recorded by this feature.
- **Sequencing.** Typed values (Task 1) and events (Task 2) land first; the journal, planner, replay
  and move (Tasks 4–7) before the executor (Task 8); behaviour tasks that need a full restack depend
  on Task 8; the preflight (Tasks 29–31) before the entry-point rewires (Tasks 32–33); the lease
  helper (Tasks 35–36) before its callers (Task 37).
- **Release.** The `kickback-budget --gate restack` change carries a `## Migration` block in the PR
  body (architecture-review condition 6); that is PR text, not a plan task.

## Prerequisites

- #3019 (child identity and storage), #3039 (slices and ownership) and #3053 (#2942, the per-child
  BUILD region with `resolveActiveChild`, `closeChild`, `moveLeaf` and per-child stores) are on main.
- The ADR amendments listed in `adr-2026-10-10-stacked-restack-journaled-replay` are committed
  (architecture-review condition 1). The #2944 hand-off comment (condition 7) is posted before
  handoff; it is not a BUILD task.

## Tasks

### Task 1: Typed restack values and the bare-string boundary guard
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-types.test.ts` for `parseCommitSha`, `parseRefName` and `isLegalJournalTransition`.
2. Write a structural test `src/conductor/test/structural/restack-typed-boundary.test.ts` that parses every `src/conductor/src/engine/restack/*.ts` module with the TypeScript compiler API and fails when an exported function parameter or exported interface field named `*Sha`, `*Tip`, `*Ref`, `cause` or `state` is typed `string`; prove it with an in-memory source fixture.
3. Implement `src/conductor/src/engine/restack/restack-types.ts`: branded `CommitSha`, `RefName`, `RestackOpId`; `ChildRange { child: ChildId; oldParent: CommitSha; oldTip: CommitSha; kind: 'closed' | 'active' | 'leaf-active' | 'leaf-unentered' }`; `RestackCause = 'feature-repair' | 'base-refresh'`; `JournalState`; `ChildStatus = 'pending' | 'replayed' | 'resolved'` with `isLegalChildStatusTransition`; `RestackRefusalReason` (the 14 reasons of ADR decision 12).
4. Verify GREEN, commit.

**Done when:**
- [test] `parseCommitSha` returns a branded `CommitSha` only for a full lowercase hexadecimal object name, and returns `undefined` for an abbreviated SHA, a ref name or an empty string; `parseRefName` rejects any name outside `refs/`.
- [test] `isLegalJournalTransition` accepts exactly `planned→ready`, `ready→moved`, `moved→synced`, `synced→applied`, `planned→aborted`, `ready→aborted`, `moved→rolling-back` and `rolling-back→aborted`, and rejects every other pair of `JournalState` values.
- [test] `restack-typed-boundary.test.ts` fails on an in-memory fixture exporting `function f(oldSha: string)` and passes on the real `engine/restack/` modules.
- [test] `isLegalChildStatusTransition` accepts exactly `pending→replayed`, `pending→resolved` and `replayed→resolved`, and rejects every other pair of `ChildStatus` values.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-types.ts` — new typed values
- `src/conductor/test/engine/restack/restack-types.test.ts` — unit tests
- `src/conductor/test/structural/restack-typed-boundary.test.ts` — boundary guard

**Dependencies:** none

### Task 2: Restack and lease event variants on the spine
**Story:** 15
**Type:** infrastructure

**Steps:**
1. Write failing tests: the `ConductorEvent` union accepts `restack_planned`, `restack_applied`, `restack_conflict`, `restack_refused`, `restack_recovered` and `push_lease_refused`; `EVENT_SINKS` declares each with `persist: true` (the exhaustive `satisfies Record` must fail to compile without them); a type test rejects a `restack_refused` reason outside `RestackRefusalReason`.
2. Implement `emitRestackRefused({ reason, child?, detail? })` in `src/conductor/src/engine/restack/restack-events.ts`, the only constructor of `restack_refused`, plus a structural test `src/conductor/test/structural/restack-refused-emitter.test.ts`. Implement the variants in `src/conductor/src/types/events.ts` (`haltRestack`'s child tagging is proven in Task 7; reusing `RestackRefusalReason`, `RestackCause` and `JournalState` from Task 1 and the existing optional `child`) and the rows in `event-sinks.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] an emitter round-trip through `EventPersister` writes `restack_planned` {opId, cause, children}, `restack_applied` {opId, cause, child, oldTip, newTip, wouldInvalidate, parentOverlapPaths}, `restack_conflict` {opId, child, commit, paths}, `restack_recovered` {opId, fromState} and `push_lease_refused` {ref, expected, actual} to `events.jsonl` with every declared field.
- [test] `EVENT_SINKS` declares `restack_planned`, `restack_applied`, `restack_conflict`, `restack_refused`, `restack_recovered` and `push_lease_refused` with `persist: true`.
- [test] `restack_refused` carries one of exactly the 14 reasons `cascade-cap`, `dirty-overlap`, `sync-collision`, `checked-out-elsewhere`, `stack-ref-changed`, `lock-unavailable`, `verification-failed`, `replay-mismatch`, `range-not-ancestor`, `closed-child-rewritten`, `flatten_refused`, `restack-outstanding`, `published-stack` or `deferred-base-refresh` (a type test rejects any other string), and a `restack_refused` event carrying `child` and the optional `detail` (what the refusal names beyond the child: a ref, lock, path or issue) round-trips through `EventPersister` with both fields.
- [test] `emitRestackRefused` in `engine/restack/restack-events.ts` sets `child` whenever its caller names a child, and `restack-refused-emitter.test.ts` fails on an in-memory fixture that constructs a `restack_refused` event anywhere else in `src/conductor/src`.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — six variants
- `src/conductor/src/engine/event-sinks.ts` — six rows
- `src/conductor/src/engine/restack/restack-events.ts` — `emitRestackRefused`
- `src/conductor/test/structural/restack-refused-emitter.test.ts` — single-emitter guard
- `src/conductor/test/engine/event-sinks.test.ts` — round-trip and declaration tests

**Dependencies:** Task 1

### Task 3: Pinned git config for engine rebases, merges and replays
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: `withPinnedGitConfig` composes `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`; a real-git N=1 `performRebase` with the operator keys set; a mocked-runner argv comparison.
2. Implement `src/conductor/src/engine/git-pinned-config.ts`: `PINNED_ENGINE_GIT_CONFIG` (`rebase.updateRefs=false`, `rebase.rebaseMerges=false`, `rebase.autoSquash=false`, `merge.renames=true`, `merge.directoryRenames=conflict`, `diff.renameLimit` pinned to a named constant) and `withPinnedGitConfig(env)`, which appends after any existing `GIT_CONFIG_*` entries (the write-credential helper entries `makeGitRunner` sets) without renumbering them.
3. Apply it in `makeGitRunner` for `rebase`, `merge`, `merge-tree`, `cherry-pick` and `commit-tree` subcommands, so `performRebase` and `startFeatureReplay` pick it up without argv changes.
4. Verify GREEN, run the N=1 golden suite, commit.

**Done when:**
- [test] `withPinnedGitConfig` sets `rebase.updateRefs=false`, `rebase.rebaseMerges=false`, `rebase.autoSquash=false`, `merge.renames=true`, `merge.directoryRenames=conflict` and `diff.renameLimit` through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>`, appending after existing credential-helper entries without renumbering them.
- [test] with the operator's git config setting `rebase.updateRefs=true`, `rebase.autoSquash=true` and `merge.renames=false`, a real-git N=1 `performRebase` produces the same rebased tip tree as with the keys unset and leaves a `feat/c1/demo` branch pointing into the rebased range unmoved.
- [test] the argv the mocked git runner records for `performRebase` and `startFeatureReplay` is unchanged from today; the pin travels only in the environment.
- [test] the #3019 N=1 golden suite (`n1-golden-state.test.ts`, `n1-golden-renderings.test.ts`) passes byte-identical with no fixture change.
- [test] every engine-started rebase or merge runner, including `performRebase`, `startFeatureReplay`, autoresolve's `resolveConflictingPr` replay and ci-fix's worktree runner (all built on `makeGitRunner`), passes the pinned `GIT_CONFIG_*` environment on every `rebase`, `merge` and `merge-tree` call (mocked runner).

**Files likely touched:**
- `src/conductor/src/engine/git-pinned-config.ts` — new pinned config
- `src/conductor/src/engine/rebase.ts` — `makeGitRunner` applies the pin
- `src/conductor/test/engine/git-pinned-config.test.ts` — composition tests
- `src/conductor/test/engine/rebase-pinned-config.realgit.test.ts` — real-git N=1 test

**Dependencies:** none

### Task 4: Ref-backed restack journal and staging refs
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-journal.test.ts`.
2. Implement `src/conductor/src/engine/restack/restack-journal.ts` following the ref-backed durable state pattern (`startChild`/`positions` in `child-lifecycle.ts`: `hash-object -w` plus a compare-and-swap `update-ref`, a ref outside `refs/heads`, never pushed): `createRestackJournal` (create-only, empty expected old value), `readRestackJournal` (typed result or `unreadable`), `journalStateUpdateLines` (the `update-ref --stdin` lines that move the journal ref from its previous blob; callers add them to their own transaction), `pinStagingRef`, `updateRestackChildStatus` (rewrites one child's status inside `planned` by compare-and-swap from the exact previous journal blob, in the same `update-ref --stdin` transaction that pins that child's staging ref; the journal state does not change), and `replaceAppliedJournalWithFollowOn` (the one CAS-from-`applied` exception). Journal fields: owner (host, pid, process start time), opId, cause, optional follow-on cause, committer stamp, dirty-path set, every ref with its old SHA, every range, per-child status (`pending`, `replayed`, `resolved`).
3. Verify GREEN, commit.

**Done when:**
- [test] `createRestackJournal` writes the blob behind `refs/conductor/demo/restack/journal` with an empty expected old value, and a second create while one exists returns `restack-outstanding`, emits `restack_refused` with that reason, creates no journal and moves no ref, while the first journal blob is byte-identical afterwards; the journal records its owner (host, pid, process start time), and `isJournalOwnerAlive` reports a live owner only on the same host when that pid is running with the recorded start time.
- [test] `replaceAppliedJournalWithFollowOn` succeeds only when the live journal blob equals the exact `applied` blob naming the follow-on, and a create by any other planner against that `applied` journal is refused `restack-outstanding`; the replace deletes the repair's staging refs in the same transaction.
- [test] `journalStateUpdateLines` returns `update-ref --stdin` lines that move the journal ref with its previous blob as expected old value, and throws for any transition `isLegalJournalTransition` rejects.
- [test] `readRestackJournal` returns `unreadable` for a non-JSON or schema-invalid blob, and commits pinned by `refs/conductor/demo/restack/staging/c2` stay reachable after `git gc --prune=now` in a real temp repository.
- [test] `updateRestackChildStatus` moves child 2's status from `pending` to `replayed` (or `resolved`) while the journal stays `planned`, writing the new blob and the child's staging ref in one transaction with the previous blob as expected old value, and when the live journal blob changed it fails without writing either ref.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-journal.ts` — new journal store
- `src/conductor/test/engine/restack/restack-journal.test.ts` — real-git tests

**Dependencies:** Task 1, Task 2

### Task 5: Range planner over existing children
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-plan.realgit.test.ts` with the three-child and one-closed-one-active fixtures from the stories.
2. Implement `planRestackRanges` in `src/conductor/src/engine/restack/restack-plan.ts`: children are the closed children plus the active child when its branch exists; child 1's old parent is `merge-base(c1, old default tip)`, child j>1's is the closure tip of j-1; a closed child's own range is `oldParent..closure(j)`, the active child's is `oldParent..tip(j)`; the leaf joins only when it is the active child, or when it is unentered and its tip lies inside a moved child's own range; commits appended past the originating child's closure (repair) become part of its new closure, while past any other moved child's closure only halt-record-only commits are excluded; any other commit there makes the planner return a typed `repair-pending` refusal (an internal planner result, not a `restack_refused` reason) with no journal and no ref move, so the stack preflight repairs that child first.
3. Implement the two pre-planning refusals, returned as typed results before any journal exists: `range-not-ancestor` and `closed-child-rewritten`.
4. Verify GREEN, commit.

**Done when:**
- [test] for the one-closed-one-active stack, `planRestackRanges` returns ranges for child 1 (`merge-base(c1, old default)..closed/c1`) and child 2 (`closed/c1..feat/c2/demo`) only, with no range and no ref update for `feat/daemon-demo` or any position-3 child branch.
- [test] when the journaled old `closed/c1` is not an ancestor of `feat/c2/demo`'s tip, `planRestackRanges` returns a needs-human refusal `range-not-ancestor` naming child 2, creates no journal and moves no ref.
- [test] a closed child whose branch tip no longer contains its closure tip (an amended or reset-back child) yields `closed-child-rewritten` naming that child before any journal exists.
- [test] in a repair, every closed child with appended commits is an originating child of the one operation, and commits appended past each originating child's closure, halt-record commits included, are planned into that child's new closure tip, while halt-record-only commits past any other moved child's closure appear in no replay range; any non-halt-record commit past a non-originating moved child's closure makes `planRestackRanges` return the `repair-pending` refusal, creating no journal and moving no ref.
- [test] an unentered leaf whose tip `H` lies inside child 1's own range is planned to move to `H`'s rewrite, and an unentered leaf with any commit outside every moved range is left out of the plan.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-plan.ts` — new planner
- `src/conductor/test/engine/restack/restack-plan.realgit.test.ts` — real-git tests

**Dependencies:** Task 1

### Task 6: Off-worktree plumbing replay of ordinary commits
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-replay.realgit.test.ts`, including a started-empty `tdd` evidence commit and a test SSH signing key (`gpg.format=ssh`, an allowed-signers file) in the temp repository.
2. Implement `replayChildRange(range, newParent, stamp, git)` in `src/conductor/src/engine/restack/restack-replay.ts`: for each first-parent commit c, `merge-tree --write-tree --merge-base c^1 <acc> c`, then `commit-tree` with `GIT_AUTHOR_NAME`/`EMAIL`/`DATE` and the raw message copied from c, committer identity and date from the journal stamp, and `-S` when `commit.gpgSign` is set; all under `withPinnedGitConfig`. A commit that becomes empty (new tree equals `<acc>` while its original tree differed from its first parent's) is dropped; a commit that started empty is always kept. Return the exact old-to-new map.
3. Verify GREEN, commit.

**Done when:**
- [test] every commit `replayChildRange` writes has author name, email, date and message byte-identical to its original, and committer name, email and date equal to the journal's committer stamp.
- [test] a started-empty `Evidence:` commit `E` (made with `git commit --allow-empty`) is replayed as a commit with `E`'s message and trailer, and the returned rewrite map maps `E` to it; a commit `C2` whose change the new parent already carries produces no commit.
- [test] with `commit.gpgSign=true` and a test signing key configured in the temp repository, `git verify-commit` succeeds for every replayed commit.
- [test] with the operator's git config setting the pinned keys `rebase.updateRefs=true`, `rebase.autoSquash=true` and `merge.renames=false`, `replayChildRange` returns the same commit SHAs as with the keys unset.
- [test] replaying the same range onto the same parent twice with the same journaled stamp returns identical SHAs.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-replay.ts` — new replay
- `src/conductor/test/engine/restack/restack-replay.realgit.test.ts` — real-git tests

**Dependencies:** Task 1, Task 3

### Task 7: Atomic ref move, post-move verification and rollback
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-move.realgit.test.ts`: an injected per-ref failure (a pre-existing `.lock` file on one ref), a concurrent `update-ref` from another process, a lock held past and within the retry budget, and a corrupted staging tree for verification.
2. Implement `applyRestackMove` in `src/conductor/src/engine/restack/restack-move.ts` following the compare-and-swap pattern of `moveLeaf` (an expected old value on every ref): one `update-ref --stdin` transaction (`start`, `update <ref> <new> <old>` for every journaled branch and closure ref and the HEAD branch, the journal state lines from Task 4, `prepare`, `commit`); classify stderr into old-value mismatch versus lock failure; retry lock failures a bounded number of times; on exhaustion move the journal to `aborted`.
3. Implement `verifyRestackMove` (tips equal the journal, ancestry chain from child 1 to the top, trees equal their staging refs) and `rollbackRestackMove` (a reverse CAS transaction `moved → rolling-back → aborted`), and `haltRestack(reason, child?, detail)` which emits `restack_refused` {child?, reason, detail?} and writes the needs-human HALT through `writeHaltMarker`.
4. Verify GREEN, commit.

**Done when:**
- [test] `applyRestackMove` moves every journaled branch, every closure ref and the journal state (`ready` to `moved`) in one `update-ref --stdin` transaction, and an injected failure on any single ref's update leaves every ref at its old SHA and the journal not `moved`.
- [test] when another process moves `feat/c2/demo` after the journal was written, no ref moves, the journal becomes `aborted`, and `haltRestack` halts with `restack_refused` reason `stack-ref-changed` and `detail` naming `refs/heads/feat/c2/demo`.
- [test] when a lock file is held on a journaled ref beyond the bounded retry budget, no ref moves, the journal becomes `aborted` and the run halts with `restack_refused` reason `lock-unavailable` and `detail` naming the lock; when the lock is released within the budget, the move applies.
- [test] when `verifyRestackMove` finds a tree that differs from its staging ref, `rollbackRestackMove` returns every ref to its journaled old SHA, the journal ends `aborted`, and the run halts with reason `verification-failed` and `detail` naming the failed check.
- [test] `haltRestack` persists `child` on every refusal that names a child, and omits the field only when no child is named.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-move.ts` — new move, verify, rollback, `haltRestack`
- `src/conductor/test/engine/restack/restack-move.realgit.test.ts` — real-git tests

**Dependencies:** Task 2, Task 4

### Task 8: Restack executor orchestration
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-executor.realgit.test.ts` with the stories' three-child, one-closed-one-active and halt-record-past-closure fixtures.
2. Implement `runRestack({ worktree, slug, cause, originatingChildren?: ChildId[], newDefault?, events, git })` (Task 31.1 later adds the leftover-`aborted`-journal re-check at its entry) in `src/conductor/src/engine/restack/restack-executor.ts`: plan (Task 5), create the journal (Task 4) and emit `restack_planned`; replay each child in order onto the actual new tip of the child below (Task 6), pinning each result with its staging ref and marking it `replayed` through `updateRestackChildStatus` (one CAS transaction); on a planner refusal (`range-not-ancestor`, `closed-child-rewritten`) halt through `haltRestack` with no journal; set `ready`; move (Task 7); sync the checked-out branch from its old tip to its new one with `read-tree -m -u` and set `synced`; call the transition hook (filled by Task 18); write `applied` and delete the journal and staging refs (unless a follow-on is named); emit one `restack_applied` per moved child. A `finally` drives the journal to `aborted` on any in-process failure (rolling back first when it is `moved`). A branch whose halt-record-only commits sit past its closure moves to its new closure tip.
3. Verify GREEN, commit.

**Done when:**
- [test] given the three-child stack and a default advance, after a `base-refresh` `runRestack` completes, `git rev-list B'..feat/c1/demo` lists exactly the rewrites of `A1` and `A2`, `git rev-list closed/c1..feat/c2/demo` exactly the rewrites of `C1` and `C2`, and `git rev-list closed/c2..feat/daemon-demo` exactly the rewrite of `L1`.
- [test] after that restack applies, `feat/c1/demo`, `feat/c2/demo`, the leaf, `closed/c1` and `closed/c2` all hold their new SHAs, every tip equals the journal, ancestry holds from `feat/c1/demo` to the leaf, the journal and every `restack/staging/*` ref no longer exist, `git status --porcelain` is empty and the working tree equals the new leaf tip.
- [test] for the one-closed-one-active stack, `runRestack` does not move `feat/daemon-demo` and creates no branch for position 3; when the journaled old `closed/c1` is not an ancestor of `feat/c2/demo`'s tip, `runRestack` halts needs-human through `haltRestack` and persists `restack_refused` with reason `range-not-ancestor` naming child 2, and no ref moves.
- [test] when `feat/c1/demo` holds a halt-record-only commit past `closed/c1`, a `base-refresh` `runRestack` leaves the new `feat/c1/demo` equal to the new `closed/c1`, that commit appears in no child, and `git reflog feat/c1/demo` still lists it.
- [test] after a restack applies, `.pipeline/events.jsonl` contains `restack_planned` {opId, cause, children} followed by one `restack_applied` per moved child, each carrying `opId`, `cause`, `child`, `oldTip`, `newTip`, `wouldInvalidate` and `parentOverlapPaths`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — new executor
- `src/conductor/test/engine/restack/restack-executor.realgit.test.ts` — real-git tests

**Dependencies:** Task 2, Task 4, Task 5, Task 6, Task 7

### Task 9: Pre-move checks: checked-out-elsewhere, dirty overlap, untracked collisions and the seal
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-premove.realgit.test.ts`: a second worktree holding `feat/c1/demo`; a tracked dirty `src/a.ts` inside the delta; an untracked `tmp/out.txt` the new tip adds (with a writable and a read-only quarantine directory); a violated seal; a modified ignored build-output file.
2. Implement `checkRestackPreMove` in `src/conductor/src/engine/restack/restack-move.ts`, called by `runRestack` at `ready` before `applyRestackMove`: refuse `checked-out-elsewhere` for any branch whose tip will change and that is checked out outside the feature worktree (an originating child of a repair is exempt only when the plan leaves its own branch tip unchanged); refuse `dirty-overlap` when a tracked dirty path intersects `diff(old, new)` (ignored files never count); move untracked collisions aside with the existing quarantine (`moveRebaseUntrackedPathsToQuarantine`, reused as-is: move, never delete), then dry-run `read-tree -m -u -n <old> <new>` and refuse `sync-collision` if anything still collides; run `verifyProtectedArtifactSeal` and halt on a violation. Never stash or autostash.
3. Verify GREEN, commit.

**Done when:**
- [test] when `feat/c1/demo` is checked out in another worktree and child 1's tip will change, the restack is refused `checked-out-elsewhere` naming that worktree and nothing moves; in a two-origin repair with `feat/c2/demo` checked out elsewhere, the restack is refused `checked-out-elsewhere` naming that worktree because child 2's tip moves, while child 1 checked out elsewhere (its own branch tip unchanged) is not refused.
- [test] with an uncommitted edit to `src/a.ts` that changes between the checked-out branch's old and new tips, the restack is refused before any ref moves with `restack_refused` reason `dirty-overlap` naming `src/a.ts`, the edit is untouched and `git stash list` is empty.
- [test] an untracked `tmp/out.txt` that the new tip adds as a tracked file is moved into `REBASE_UNTRACKED_QUARANTINE_DIR` and the restack applies; with the quarantine directory read-only, the restack is refused before any ref moves with reason `sync-collision` naming `tmp/out.txt`; a quarantine failure is mapped to that refusal and never throws.
- [test] when the protected-artifact seal is already violated, the restack halts on the seal violation from `verifyProtectedArtifactSeal` before any ref moves.
- [test] a modified ignored build-output file is not treated as dirty, and the restack applies.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-move.ts` — `checkRestackPreMove`
- `src/conductor/src/engine/restack/restack-executor.ts` — call the checks at `ready`
- `src/conductor/test/engine/restack/restack-premove.realgit.test.ts` — real-git tests

**Dependencies:** Task 8

### Task 10: The sync carries local work, never stashes, and rotates the seal
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-sync.realgit.test.ts` and a mocked-boundary test in `src/conductor/test/engine/restack/restack-no-stash.test.ts`.
2. Implement `syncRestackedWorktree` in `src/conductor/src/engine/restack/restack-sync.ts` (extracted from Task 8's inline sync): `read-tree -m -u <old> <new>` carries dirty paths outside the delta as `git switch` does; after the sync, `rotateProtectedArtifactSeal` rotates the seal exactly as `performRebase` does (adr-2026-07-26 D3).
3. Verify GREEN, commit.

**Done when:**
- [test] on a clean three-child stack, after `runRestack` moves the leaf, the protected-artifact seal verifies against the new tip because it was verified before the move and rotated by `rotateProtectedArtifactSeal` after the sync.
- [test] an uncommitted edit to `notes.txt`, which no change between the old and new tips touches, is still present after `runRestack` moves the checked-out branch, and `git stash list` is empty.
- [test] a mocked git boundary records no `stash` subcommand and no `--autostash` argument from `runRestack`, `syncRestackedWorktree` or `checkRestackPreMove`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-sync.ts` — new sync helper
- `src/conductor/src/engine/restack/restack-executor.ts` — use it
- `src/conductor/test/engine/restack/restack-sync.realgit.test.ts` — real-git tests
- `src/conductor/test/engine/restack/restack-no-stash.test.ts` — mocked boundary test

**Dependencies:** Task 8, Task 9

### Task 11: Patch equivalence only against commits new to the stack
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-patch-equivalence.realgit.test.ts` (cherry-pick to main; repair commit already cherry-picked into child 2; a child that reverts and re-applies its parent's change).
2. Extend `replayChildRange`: compute `git patch-id --stable` for the commits new to the stack in this operation (`oldDefault..newDefault` for a base refresh, the appended commits for a repair) and skip a child commit only when its patch-id is in that set; a patch-id that occurs only in the stack's own history is never an equivalence.
3. Verify GREEN, commit.

**Done when:**
- [test] when child 1's `A2` was cherry-picked to `origin/main` within the default advance, after a `base-refresh` `runRestack` `git rev-list B'..feat/c1/demo` lists exactly one commit (the rewrite of `A1`) and child 1's tree equals `B'` with `A1`'s change applied.
- [test] in a repair restack whose originating commit `X` on child 1 was already cherry-picked into child 2 as `X2`, the new child 2 contains no commit for `X2`.
- [test] when child 2 reverts its parent's commit `A1` and later re-applies it as `A1r` (same patch-id), a restack moving child 2 replays `A1r` and child 2's tree keeps `A1`'s change.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-replay.ts` — patch-equivalence set
- `src/conductor/test/engine/restack/restack-patch-equivalence.realgit.test.ts` — real-git tests

**Dependencies:** Task 8

### Task 12: Merge-bearing children: ancestry-only, Q-carried and flattened merges
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-merges.realgit.test.ts` for the stories' merge fixtures, including main later editing and later reverting the merged line.
2. Extract the per-merge classification out of `planFlattenedReplay` in `rebase.ts` into the exported `classifyReplayMerge(git, merge, newParent, mode)` with `mode: 'n1' | 'stacked'`. `planFlattenedReplay` calls it in `n1` mode, which keeps adr-2026-09-29 D2's two-class rule (ancestry-only or flatten) so N=1 results are unchanged. Only `replayChildRange` uses `stacked` mode, the three-class rule: let `auto = merge-tree --write-tree P Q`; drop M when `tree(M) == auto` and Q is an ancestor of the new parent; replay only `merge-tree --merge-base auto <acc> M` when Q is an ancestor of the new parent; otherwise flatten P→M into one commit. Every synthesized commit carries `Flattened-merge:` and `runRestack` emits `rebase_merge_audit`.
3. Verify GREEN, commit.

**Done when:**
- [test] child 2's merge `M` of `origin/main` at `D1` whose tree equals the automatic merge produces no commit when the new parent contains `D1`, and a merge of a side branch `Q` the new parent does not contain becomes one flattened commit carrying `M`'s change relative to its first parent when replayed cleanly.
- [test] a merge `M` of `D1` with a hand resolution, replayed onto a parent containing `D1`, is replaced by exactly one commit whose change is only the hand resolution, carrying a `Flattened-merge:` trailer, and `rebase_merge_audit` is persisted.
- [test] when main later changed the merged lines at `D2` and the new parent contains `D2`, a `base-refresh` restack replays child 2 with no conflict and child 2's tree keeps `D2`'s lines; when main later reverted `D1`'s line, the reverted line is absent from child 2.
- [test] `classifyReplayMerge` exported from `rebase.ts` is the only merge classifier both `performRebase` and `replayChildRange` call, and the existing `rebase-flatten*.test.ts` suites pass unchanged.
- [test] `planFlattenedReplay` calls `classifyReplayMerge` in `n1` mode only, so an N=1 rebase of a branch that merged `origin/main` still flattens exactly as today (identical replay entries, audit and flattened commit), and only `replayChildRange` uses `stacked` mode with the Q-carried class.

**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — export `classifyReplayMerge`
- `src/conductor/src/engine/restack/restack-replay.ts` — merge classes
- `src/conductor/test/engine/restack/restack-merges.realgit.test.ts` — real-git tests

**Dependencies:** Task 8

### Task 13: Path-ownership acceptance and `parentOverlapPaths`
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-ownership.realgit.test.ts` for both silent-revert shapes, rename-then-edit, set-then-set, and overlap/no-overlap.
2. Implement `checkPathOwnership` and `parentOverlapPaths` in `src/conductor/src/engine/restack/restack-ownership.ts`: owned paths are `diff --no-renames --name-only oldParent oldOwnTip` (for a Q-carried merge only its hand-resolved paths count); a replayed child is accepted only when `diff --no-renames --name-only newParent newTip` is a subset; `parentOverlapPaths` is the intersection of `oldParent..newParent` with the owned paths. `runRestack` checks each child before `ready` and halts `replay-mismatch` through `haltRestack`, leaving the journal `aborted` and its staging refs in place.
3. Verify GREEN, commit.

**Done when:**
- [test] `checkPathOwnership` accepts a replay whose `diff --no-renames --name-only newParent newTip` is a subset of the owned paths, so a restack where every child changes only paths it changed before applies, including child 2's rename of `src/x.ts` to `src/y.ts` followed by edits, and child 2's set-then-set of line L in `src/h.ts` onto a parent carrying `L=a` applies with `L=b`.
- [test] when child 2 added and later reverted change X in `src/g.ts` and the repaired parent now adds X, the restack halts with `restack_refused` reason `replay-mismatch` naming child 2 and `src/g.ts`, no ref moves, and the journal and staging refs still exist after the halt, with the journal `aborted`.
- [test] when child 2 renamed `src/x.ts` to `src/z.ts` and the new parent independently created `src/z.ts`, the replay of child 2 is not accepted as a clean replay: `replayChildRange` reports a conflict on `src/z.ts` rather than a clean replay.
- [test] `restack_applied` for child 2 lists `src/f.ts` in `parentOverlapPaths` when both the parent's new changes and child 2's owned paths include it, and carries `parentOverlapPaths: []` when they do not overlap.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-ownership.ts` — new acceptance check
- `src/conductor/src/engine/restack/restack-executor.ts` — check before `ready`
- `src/conductor/test/engine/restack/restack-ownership.realgit.test.ts` — real-git tests

**Dependencies:** Task 8

### Task 14: Narrow resolver primitive in a temporary detached worktree
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolver.realgit.test.ts` (accepted, rejected, and crashed hand-offs) and extend `src/conductor/test/structural/worktree-removal-coverage.test.ts`.
2. Implement `resolveRestackConflict` in `src/conductor/src/engine/restack/restack-resolver.ts`: `git worktree add --detach` at child j's old own tip under the feature worktree's gitignored `.pipeline/restack/resolve/`; run `rebase -i --onto <newParent> <oldParent>` with no branch argument, no `--autostash`, `withPinnedGitConfig`, and an engine-written todo listing exactly the commits `replayChildRange` would apply; set `GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL`/`GIT_COMMITTER_DATE` from the journal's committer stamp and export them to the resolver dispatch environment and every git call in the temporary worktree, including `rebase --continue`; dispatch the existing resolver (`resolveRebaseConflicts`) within its existing budget; read the old-to-new map from rebase's rewritten list; in a `finally`, remove the worktree and run `git worktree prune`.
3. Classify the removal in `worktree-removal-coverage.test.ts` (conflict-report plan obligation).
4. Verify GREEN, commit.

**Done when:**
- [test] `resolveRestackConflict` runs `rebase -i --onto <newParent> <oldParent>` with no branch argument and no `--autostash` in a detached worktree under `.pipeline/restack/resolve/`, and no `refs/heads/*` or `refs/conductor/*` ref moves during the hand-off; every commit the resolved rebase writes, including those written by `rebase --continue` after the resolver's dispatch, has committer name, email and date equal to the journal's committer stamp.
- [test] when the hand-off ends accepted, rejected or crashed (an injected throw), its temporary worktree no longer appears in `git worktree list`.
- [test] when child 2 has a started-empty commit `E` and a commit cherry-picked to main within the default advance, the engine-written todo includes `E` and excludes the cherry-picked commit, equal to the list `replayChildRange` applies.
- [test] with `rebase.updateRefs=true`, `rebase.autoSquash=true` and `merge.renames=false` in the operator's git config, the resolver todo and resulting tip are identical to those produced with the keys unset.
- [test] `worktree-removal-coverage.test.ts` classifies the temporary-worktree removal in `engine/restack/restack-resolver.ts` with a written reason, and fails when that classification is removed.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-resolver.ts` — new resolver primitive
- `src/conductor/test/engine/restack/restack-resolver.realgit.test.ts` — real-git tests
- `src/conductor/test/structural/worktree-removal-coverage.test.ts` — classification

**Dependencies:** Task 3, Task 8, Task 11

### Task 15: Resolver acceptance and the unresolved-conflict halt
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-conflict.realgit.test.ts` with a scripted resolver that resolves, exhausts its budget, drops a subject, bases on the wrong parent, or edits an unowned path.
2. Wire `runRestack`'s conflict branch: only the conflicting child is handed to `resolveRestackConflict`; accept the result only through the FR-8 guard with `newParent` as its base, the FR-9 guard over `oldParent..ORIG_HEAD`, and `checkPathOwnership`; pin an accepted tip with its staging ref and mark it `resolved` through `updateRestackChildStatus`; otherwise first pin child 2's old own tip (the journaled old SHA of its branch, the tip of `oldParent..oldTip`) at `staging/c<j>` through `pinStagingRef`, then abort the journal (refs never moved), emit `restack_conflict`, and halt needs-human naming the child, the commit and the paths, keeping the staging refs.
3. Verify GREEN, commit.

**Done when:**
- [test] when child 2's commit `C2` conflicts onto the new `closed/c1` and the resolver resolves it, the accepted tip is pinned by `refs/conductor/demo/restack/staging/c2` and marked `resolved` through `updateRestackChildStatus`, the leaf is replayed onto the resolved child-2 tip, the restack applies, and a spy on `replayChildRange` records child 1 exactly once (child 1 is not replayed again).
- [test] when the resolver exhausts its budget on `C2` conflicting on `src/c.ts`, the restack halts needs-human naming child 2, `C2` and `src/c.ts`, persists `restack_conflict` {opId, child, commit, paths}, moves no child branch or closure ref, and leaves the journal `aborted` with child 2's staging ref present, pinned by `pinStagingRef` to child 2's old own tip before the abort.
- [test] a resolver result missing one of child 2's own commit subjects (FR-9 over `oldParent..ORIG_HEAD`), or one not based on the new `closed/c1` (FR-8 with `newParent` as base), is rejected and the run halts as the unresolved conflict above.
- [test] a resolver result changing a path child 2 never owned is rejected with `restack_refused` reason `replay-mismatch`; when child 2 renamed `src/x.ts` to `src/z.ts` and the new parent independently created `src/z.ts`, the conflict on `src/z.ts` is handed to `resolveRestackConflict` and never accepted as a clean replay.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — conflict branch and acceptance
- `src/conductor/test/engine/restack/restack-conflict.realgit.test.ts` — real-git tests

**Dependencies:** Task 13, Task 14

### Task 16: Halt-record conflicts inside a range resolve mechanically
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-halt-record.realgit.test.ts` (halt-record add/add between child 1's and child 2's ranges; a mixed conflict).
2. In `replayChildRange`, when `merge-tree` reports a conflict confined to `.docs/halted/<slug>.md`, take the upper child's blob and continue; any conflict that also touches another path goes to `resolveRestackConflict`.
3. Verify GREEN, commit.

**Done when:**
- [test] when child 1's and child 2's ranges both contain halt-record commits that conflict only on `.docs/halted/demo.md`, replaying child 2 keeps child 2's record and dispatches no resolver.
- [test] a conflict touching `.docs/halted/demo.md` and `src/c.ts` together is not resolved mechanically and is handed to `resolveRestackConflict`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-replay.ts` — halt-record conflict rule
- `src/conductor/test/engine/restack/restack-halt-record.realgit.test.ts` — real-git tests

**Dependencies:** Task 14, Task 15

### Task 17: A conflicting merge-bearing child halts `flatten_refused`
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-flatten-refused.realgit.test.ts` (Q carried and Q not carried).
2. In `runRestack`'s conflict branch, a child whose own range contains a merge refuses the hand-off: abort the journal and halt through `haltRestack` with reason `flatten_refused`, naming the merge. The halt body tells the operator to resolve on the child branch and resume; it never prints `flattenRefusalRecipe` (a single-branch `git rebase`) for a stacked branch.
3. Verify GREEN, commit.

**Done when:**
- [test] when a merge-bearing child's replay conflicts, with Q carried or not, the restack halts with `restack_refused` reason `flatten_refused` naming the merge, dispatches no resolver, and moves no ref.
- [test] that halt's recovery text tells the operator to resolve on the child branch and resume, and contains no `git rebase` command for a stacked branch.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — `flatten_refused` branch
- `src/conductor/test/engine/restack/restack-flatten-refused.realgit.test.ts` — real-git tests

**Dependencies:** Task 12, Task 15

### Task 18: Verdicts after a restack: active-child tuple, whole-stack tuple, closed children untouched
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-transition.test.ts` (real-git stack plus seeded per-child verdict files).
2. Implement `applyRestackTransition` in `src/conductor/src/engine/restack/restack-transition.ts`, called by `runRestack` at `synced`: for a moved active child, compute the tuple P = old tip, B = old parent, O = new parent, H = new tip and run today's `applyRebaseVerdicts`/`applyRebaseTransition` with `child` so region gates land in that child's stores; for the leaf's whole-feature gates use P = old leaf tip, B = `merge-base(old c1, old default)`, O = new default (base refresh) or old default (repair), H = new leaf tip, feeding the P→H delta into the selective policy's gate projection; for closed children compute the same projection without writing and return it as `wouldInvalidate`.
3. Verify GREEN, commit.

**Done when:**
- [test] when a restack moves the active child 2 with an unchanged replay, `applyRestackTransition` keeps child 2's passed region gates passed in `.pipeline/children/2/`; when the new parent's changes intersect a passed region gate's inputs, that gate is invalidated in `.pipeline/children/2/` and no flat region verdict is written under `.pipeline/gates/`; `rebase_gate_preserved` and `rebase_gate_invalidated` events for child 2 match the applied preserve/invalidate set, and the next selected step is no earlier than `test_suite`.
- [test] when a restack moves closed child 1 in a fixture where the policy would invalidate at least one of child 1's gates, child 1's verdict files and closure position are byte-identical before and after, `restack_applied` for child 1 carries a non-empty `wouldInvalidate` listing those gates, and as the feature continues to completion no region gate of child 1, including every gate listed in `wouldInvalidate`, is re-run in this feature.
- [test] for a `feature-repair` restack whose originating commit `X` changes a path in the leaf's review inputs, the whole-feature and leaf gates whose inputs include that path are invalidated even though the default branch did not move, and when `X` changes only paths outside every passed gate's inputs they stay passed.
- [test] for a `feature-repair` restack the whole-feature tuple uses the unchanged old default tip as its base, and a mocked git boundary records no `fetch` of `origin/main` during the re-judgement.
- [test] after a restack, `resolveChildBase` for child 2 returns the restacked `closed/c1` tip as child 2's fresh base, and the `build_review` fresh-base disposition issues no rebase.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-transition.ts` — new transition
- `src/conductor/src/engine/restack/restack-executor.ts` — call it at `synced`
- `src/conductor/test/engine/restack/restack-transition.test.ts` — transition tests

**Dependencies:** Task 8

### Task 19: Translation through the flat rewrite map, and `current-task` preserved
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-translate.test.ts`.
2. In `applyRestackTransition`, merge each moved child's exact old-to-new map into `.pipeline/rebase-rewrites.json` through `persistRewriteMap` with pre-image range `oldParent..oldTip`, then run the existing `translateAfterRebase` orchestration with that exact per-child map (evidence stamps, `task-status` commits, the retained RED proof, `provenanceHeadSha`, repair-obligation baselines with nearest-successor boundaries, the attribution-memo re-key, and residue). Write only the flat stores and the active child's stores; never rewrite a closed child's stores. Leave `.pipeline/current-task` untouched.
3. Verify GREEN, commit.

**Done when:**
- [test] after a restack moving a child whose commits carry evidence stamps and `task-status` commits, `.pipeline/rebase-rewrites.json` maps each moved commit by SHA with pre-image range `oldParent..oldTip`, and evidence stamps, `task-status` commits, the retained RED proof and `provenanceHeadSha` resolve to the new SHAs; the translation writes only the flat stores and the active child's stores, and every closed child's `.pipeline/children/<k>/` store is byte-identical before and after; after a resolver hand-off, `.pipeline/rebase-rewrites.json` maps child 2's commits to the resolved commits taken from rebase's rewritten list.
- [test] on the one-closed-one-active stack with `.pipeline/current-task` naming `T3`, a `base-refresh` restack moving child 1 and the checked-out child 2 leaves `current-task` naming `T3`, and `T3`'s commits resolve through the rewrite map.
- [test] after a `feature-repair` restack that moves only child 2 and the leaf, `rebase-rewrites.json` has no entry for any child-1 or default-branch commit.
- [test] `applyRestackTransition` runs `translateAfterRebase` with each moved child's exact map: repair-obligation baselines resolve through it, directly or to the nearest surviving successor, and `repair_boundary_translated` is persisted; `attribution-memo.json` is re-keyed onto the new tip; and a dropped commit that evidence still cites appears in a persisted `rebase_citation_residue` event.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-transition.ts` — translation
- `src/conductor/test/engine/restack/restack-translate.test.ts` — translation tests

**Dependencies:** Task 15, Task 18

### Task 20: The `leaf-moved` ref replaces the rewrite-map presence test
**Story:** 11
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-leaf-moved.realgit.test.ts` and extend `src/conductor/test/engine/child-cursor.test.ts`.
2. `applyRestackMove` adds `refs/conductor/<slug>/leaf-moved` to the move transaction only when it moves the leaf while the leaf is the active child. In `resolveActiveChild` (`child-cursor.ts`), replace the `rewrites.present` test with a read of that ref; an in-flight leaf without the ref that already contains the last closure's rewrite image is treated as moved and the ref is written.
3. Verify GREEN, commit.

**Done when:**
- [test] the restack move transaction writes `refs/conductor/demo/leaf-moved` only when it moves the leaf while the leaf is the active child, so after the three-child restack applies `refs/conductor/demo/leaf-moved` exists.
- [test] on the one-closed-one-active stack where `feat/c1/demo` was created from a pre-region halt record `H` and the unentered leaf still sits at `H`, a `base-refresh` restack that rewrites `H` to `H'` moves the leaf to `H'` in the same move, writes no `refs/conductor/demo/leaf-moved` ref, and when child 2 later closes `moveLeaf` completes with no stray-commit refusal.
- [test] when a restack left the leaf in place and the last intermediate child has just closed, `resolveActiveChild` still reports `leafMovePending: true` although `.pipeline/rebase-rewrites.json` is present.
- [test] an in-flight stacked leaf with no `leaf-moved` ref whose branch already contains the rewrite image of the last closure is treated as moved: `resolveActiveChild` reports no pending leaf move, and `refs/conductor/demo/leaf-moved` is written.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-move.ts` — `leaf-moved` in the transaction
- `src/conductor/src/engine/child-cursor.ts` — read the ref
- `src/conductor/test/engine/restack/restack-leaf-moved.realgit.test.ts` — real-git tests
- `src/conductor/test/engine/child-cursor.test.ts` — cursor test

**Dependencies:** Task 8

### Task 21: Restack cause on the operation record, and cause-scoped refunds
**Story:** 12
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase-transition.test.ts` and `src/conductor/test/conductor-kickback.test.ts`.
2. Add optional `cause?: RestackCause` to `RebaseOperationRecord` (`gate-verdicts.ts`), written only for stacked operations; thread it through `applyRebaseTransition` into `creditBuildReviewConvergence`, which credits only when the cause is absent or `base-refresh`. Guard `advanceTail`'s legacy rebase-step refund in `conductor.ts` so it credits only kickbacks whose originating operation's cause is `base-refresh`. A `feature-repair` restack persists no `rebase_changed`.
3. Verify GREEN, run the N=1 golden suite, commit.

**Done when:**
- [test] when a `base-refresh` restack invalidates the active child's `build_review`, `creditBuildReviewConvergence` credits its convergence laps once in that child's ledger with the restack's opId as receipt, and applying `applyRestackTransition` twice with the same opId writes no second credit; exactly one `kickback` event with `convergenceCredit: {gate: 'build_review'}` is persisted.
- [test] when a `feature-repair` restack invalidates the active child's `build_review`, no laps are credited and the operation record carries `cause: 'feature-repair'`, and a `feature-repair` restack persists no `rebase_changed` event.
- [test] `advanceTail`'s legacy refund credits laps only for kickbacks whose originating operation's cause is `base-refresh`: for a `feature-repair` restack `advanceTail`'s legacy rebase-step refund credits no laps (a spy on `creditKickbackGateLaps` records no call from that path); every rebase-origin kickback record carries its originating operation's `cause`, which is the link the legacy refund checks.
- [test] for an N=1 rebase that invalidates `build_review`, the refund equals today's and the operation record in `.pipeline/gates/rebase.json` has no `cause` field.
- [test] the #3019 N=1 golden suite (`n1-golden-state.test.ts`, `n1-golden-renderings.test.ts`) passes byte-identical with no fixture change.

**Files likely touched:**
- `src/conductor/src/engine/gate-verdicts.ts` — optional `cause`
- `src/conductor/src/engine/rebase-transition.ts` — cause-scoped refund
- `src/conductor/src/engine/conductor.ts` — `advanceTail` guard
- `src/conductor/test/engine/rebase-transition.test.ts` — refund tests
- `src/conductor/test/conductor-kickback.test.ts` — legacy refund test

**Dependencies:** Task 18

### Task 22: Per-child cascade counter and the cascade-cap halt
**Story:** 13
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/cascade-cap.test.ts`.
2. Implement `src/conductor/src/engine/restack/cascade-cap.ts` (ref-backed blob pattern as in Task 4): `readCascadeCounts` (typed or `unreadable`), `cascadeUpdateLines` (added to the `applied` transaction for a `feature-repair`, charged to the originating child), and `checkCascadeCap` (`MAX_RESTACK_CASCADES_PER_CHILD = 3`, or the raised limit), called by `runRestack` before `createRestackJournal`. On the cap: no journal, write cap evidence to the active child's kickback ledger under pseudo-gate `restack` with allowance `restacks` naming the originating child, with a snapshot of its count and limit from `cascades` for rendering, and halt `needs-human`. Add `restacks` to the allowance unions in `kickback-ledger.ts` and `restack: 'needs-human'` to `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` in `halt-classification.ts`. An unreadable blob counts as exhausted.
3. Verify GREEN, commit.

**Done when:**
- [test] after child 1 originates three applied `feature-repair` restacks, `refs/conductor/demo/cascades` records child 1's count as 3, written in the same transaction that moves the journal to `applied`; `base-refresh` restacks and aborted restacks change no count; with repairs originating from child 1 and child 2 alternately each count reflects only that child's restacks and the leaf's count is 0; one repair whose originating children are child 1 and child 2 charges one cascade to each.
- [test] when child 1's count is 3 and a fourth repair is due, `checkCascadeCap` refuses before `createRestackJournal`: no journal is created, no `restack_planned` is emitted, `HALT.class` is `needs-human` naming child 1, and the active child's ledger holds cap evidence for gate `restack` with allowance `restacks` naming child 1, and `restack_refused` with reason `cascade-cap` naming child 1 is persisted; the cap is checked for every originating child before any journal exists, and the evidence snapshots child 1's count and limit read from `cascades` for rendering.
- [test] an unreadable or malformed `cascades` blob counts as an exhausted cap, and the repair halts needs-human naming the unreadable `refs/conductor/demo/cascades` ref.
- [test] after the feature worktree is deleted and recreated from its branch, `readCascadeCounts` returns unchanged counts, and `RECOVERABLE_CAP_HALT_CLASS_BY_GATE.restack` is `needs-human`; `kickback-budget inspect` and the cap-halt body render child 1's restack count and limit through `renderKickbackBudgetView` (`kickback-budget-view.ts`).

**Files likely touched:**
- `src/conductor/src/engine/restack/cascade-cap.ts` — new cap store and check
- `src/conductor/src/engine/restack/restack-executor.ts` — cap check and `applied` lines
- `src/conductor/src/engine/kickback-ledger.ts` — `restacks` allowance
- `src/conductor/src/engine/halt-classification.ts` — `restack` gate
- `src/conductor/src/engine/kickback-budget-view.ts` — render restack count and limit
- `src/conductor/test/engine/restack/cascade-cap.test.ts` — real-git tests

**Dependencies:** Task 4, Task 8

### Task 24: Journal recovery from refs alone
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing real-git crash tests in `src/conductor/test/engine/restack/restack-recovery.realgit.test.ts`: inject a crash (a thrown error from a test seam) at every journal state; recreate the worktree from its branch; delete `.pipeline/`.
2. Implement `recoverRestackJournal` in `src/conductor/src/engine/restack/restack-recovery.ts` per ADR decision 7's table: `planned` keeps the `replayed`/`resolved` children (statuses written by `updateRestackChildStatus`) whose staging refs and inputs are unchanged and resumes from the first `pending` child, aborting if any input ref changed; `ready` re-runs `checkRestackPreMove` then the move with the journaled SHAs, then `verifyRestackMove` (rollback on failure); `moved` runs `verifyRestackMove` first (rollback on failure), then the bounded sync, then `synced`; an `applied` journal naming a follow-on runs `runRestack({ cause: 'base-refresh' })` through `replaceAppliedJournalWithFollowOn`; a journal whose owner (host, pid, process start time) is alive is left untouched; `rolling-back` re-runs the reverse transaction; `synced` applies the transition then `applied`; leftover `applied` (no follow-on) or `aborted` (halt cleared) is deleted with its staging refs and any `.pipeline/restack/resolve/` worktree. Emit `restack_recovered` only when a journal is driven out of `planned`, `ready`, `moved`, `rolling-back` or `synced`. Read only refs: whether an `aborted` journal's halt is still outstanding is read from the committed halt record `.docs/halted/<slug>.md` at the active branch tip (`Status: halted` means outstanding; any other status, or no record, means cleared), never from `.pipeline/`.
3. Verify GREEN, commit.

**Done when:**
- [test] after a crash at `planned` with child 1 `replayed` and its inputs unchanged, `recoverRestackJournal` continues planning from child 2 and reuses child 1's staging SHA, so child 1's rewritten SHAs are identical to the first attempt's; when `feat/c2/demo` moved after the crash, it aborts the journal, removes the staging refs and moves no ref.
- [test] after a crash at `ready`, recovery completes the move with the journaled SHAs, replays no child (a spy on `replayChildRange` records no call), and persists `restack_recovered` with `fromState: ready`; the same outcome holds when the feature worktree was deleted and recreated from its branch, and when `.pipeline/` was deleted, before resume; after the recovered move, `verifyRestackMove` runs and a failed check rolls every ref back to its journaled old SHA and halts `verification-failed`.
- [test] after a crash at `moved`, recovery synchronises the worktree, applies the transition once and removes the journal; after a crash at `synced`, it applies the transition once and removes the journal; after a crash at `rolling-back`, every ref equals its journaled old SHA and the journal ends `aborted`; an injected throw mid-`runRestack` in a live process reaches its `finally`, leaving no journal in `ready` or `moved` and every ref at its old SHA; each completed recovery from `planned`, `ready`, `moved`, `synced` or `rolling-back` persists `restack_recovered` carrying the journal's `opId` and the matching `fromState`; recovery entered at `moved` runs `verifyRestackMove` before syncing and rolls back on a failed check.
- [test] a leftover journal in `applied` with no follow-on, or in `aborted` whose halt is cleared, is removed with its staging refs and any temporary resolver worktree, no `restack_recovered` event is emitted, and resume continues; with no journal, no `restack_recovered` event is emitted; with or without `.pipeline/` (deleting it changes no recovery outcome), an `aborted` journal whose committed halt record at the active branch tip reads `Status: halted` is kept with its staging refs, and one whose record no longer reads `Status: halted` is removed, with no ref moved in either case.
- [test] running `recoverRestackJournal` twice in a row leaves refs, worktree contents and `events.jsonl` unchanged by the second run; recovery acts only on a dead owner's journal, and while the owner is alive it leaves the journal and every ref untouched.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-recovery.ts` — new recovery
- `src/conductor/test/engine/restack/restack-recovery.realgit.test.ts` — crash tests

**Dependencies:** Task 9, Task 14, Task 18

### Task 25: Recovery refusals: operator edits in the sync window, new dirty overlap, unreadable journals
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-recovery-refusals.realgit.test.ts`.
2. Implement half-applied-sync recovery in `restack-sync.ts`: for each path in `diff(old, new)`, content equal to the old blob is restored from the new tip, content equal to the new blob is left alone, any other content is an operator edit that is never overwritten: roll back (`rolling-back` → `aborted`) and halt needs-human naming the path. In `recoverRestackJournal`, an unreadable journal halts needs-human naming the journal ref and every child branch, closure ref and staging ref of the feature with its live value; live refs matching neither the journaled old nor new SHAs halt needs-human naming every journaled ref and its live value. From `moved` onward, a checked-out branch equal to its journaled new SHA plus only halt-record commits counts as the new side, and the `applied` transaction compare-and-swaps only the journal and `cascades`, never a branch.
3. Verify GREEN, commit.

**Done when:**
- [test] after a crash at `moved` where `src/a.ts` holds content equal to neither its old nor its new blob, recovery does not overwrite `src/a.ts`, rolls the stack back to its journaled old SHAs, and halts needs-human naming `src/a.ts`; paths holding their old blob are restored from the new tip and paths holding their new blob are left alone.
- [test] after a crash at `ready` followed by an uncommitted edit overlapping the move, recovery aborts the journal and moves no ref.
- [test] with an unreadable journal blob, recovery halts needs-human naming the journal ref and every child branch, closure ref and staging ref of the feature with its live value, and moves no ref.
- [test] with live refs matching neither the journaled old nor new SHAs, recovery halts needs-human naming every journaled ref and its live value and moves no ref, while a checked-out branch carrying only halt-record commits past its journaled new SHA counts as the new side.
- [test] when a halt-record commit lands on the checked-out branch while the journal is `synced`, recovery completes to `applied` with no needs-human halt, because the `applied` transaction compare-and-swaps only the journal and `cascades`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-sync.ts` — half-applied sync recovery
- `src/conductor/src/engine/restack/restack-recovery.ts` — refusal paths
- `src/conductor/test/engine/restack/restack-recovery-refusals.realgit.test.ts` — real-git tests

**Dependencies:** Task 10, Task 22, Task 24

### Task 26: Guarded engine-commit helper (the commit fence)
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/guarded-engine-commit.realgit.test.ts`.
2. Implement `commitEngineChange({ worktree, slug, pathspec, message, noVerify })` in `src/conductor/src/engine/guarded-engine-commit.ts`: refuse when the journal is `ready`, `moved` or `rolling-back`; read HEAD; build the commit tree from a temporary index (`GIT_INDEX_FILE`) seeded from HEAD plus only the site's own pathspec, so stray staged changes in the worktree index are neither committed nor blocking; through `git hook run` on a message file, with `GIT_INDEX_FILE` set to the temporary index, run the hooks in git's order: `pre-commit`, `prepare-commit-msg` and `commit-msg` before the commit is written, and `post-commit` after HEAD moves; `noVerify` skips only `pre-commit` and `commit-msg` (exactly `git commit --no-verify` semantics); stamp the message with `withDaemonCoAuthorTrailer` (the shared stamper, not a second one); `write-tree` and `commit-tree` (with `-S` when `commit.gpgSign` is set); re-read the journal; then `update-ref HEAD <new> <head read at the start>`; then update the worktree index for the site's own paths only; then run `post-commit`.
3. Verify GREEN, commit.

**Done when:**
- [test] when the journal is `ready`, `moved` or `rolling-back`, `commitEngineChange` refuses and HEAD is unchanged.
- [test] with staged changes outside the committing site's own paths, `commitEngineChange` builds the commit from a temporary index (`GIT_INDEX_FILE`) seeded from HEAD plus its own pathspec, so the commit contains only the site's own paths, the stray changes stay staged and uncommitted in the worktree index, and the commit is not blocked; afterwards the worktree index is updated for the site's own paths only.
- [test] through `git hook run` it runs `pre-commit`, `prepare-commit-msg` and `commit-msg` in that order with `GIT_INDEX_FILE` set to the temporary index (with `noVerify` only `prepare-commit-msg` of those three runs), writes the commit with `write-tree` and `commit-tree` (signed with `-S` when `commit.gpgSign` is set), and moves HEAD with `update-ref HEAD <new> <old>` using the HEAD it read before staging, and runs `post-commit` only after HEAD has moved (with or without `noVerify`).
- [test] when another process moves the HEAD branch between the helper's HEAD read and its `update-ref`, the compare-and-swap fails, `commitEngineChange` returns a failure, and the branch keeps the other process's tip.
- [test] in a real-git worktree created by `prepareWorktree` with the engine hooks installed, `commitEngineChange`'s `update-ref HEAD` passes the installed `reference-transaction` hook.

**Files likely touched:**
- `src/conductor/src/engine/guarded-engine-commit.ts` — new helper
- `src/conductor/test/engine/guarded-engine-commit.realgit.test.ts` — real-git tests

**Dependencies:** Task 4

### Task 27: Route every engine commit site through the guarded helper
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests: per-site tests in `src/conductor/test/engine/engine-commit-sites.test.ts`, and a structural test `src/conductor/test/structural/engine-commit-sites.test.ts`.
2. Enumerated sites (ADR decision 4 and architecture-review condition 4). When the worktree has durable child state each calls `commitEngineChange` with its own pathspec and its current `--no-verify` choice (so `prepare-commit-msg` still stamps co-author and `Task:` trailers at `--no-verify` sites, as `git commit --no-verify` does today); otherwise it issues today's `git commit` argv unchanged:
   - `commitHaltRecordChange` in `halt-record.ts` (used by `recordHalt` and `supersedeHaltRecord`, including the `daemon-deps.ts` and `daemon-cli.ts` supersede callers);
   - the plan-amendment commit in `conductor.ts` (`chore(plan): record appended remediation tasks`);
   - the three `setup-triage.ts` commits (quarantine, rejected-repair preservation, retained repair), whose pathspec is the captured repair's paths;
   - `finish-publication-production.ts` (shipped-record findings);
   - `shipped-record-cli.ts` (shipped record);
   - `shipment-evidence-cli.ts` (shipped-record repair).
   - `build-failure-escalation.ts` makes no commit (it only pushes, through `executeRemoteGit`); the structural test records it as push-only.
3. The structural test parses `src/conductor/src` with the TypeScript compiler API and fails when a process-invoking call passes a `commit` subcommand outside an allowlist whose entries each name the site, or why it never runs in a feature worktree (for example `engine/engineer/land-spec.ts` in a spec worktree, and `rebase.ts`'s flattened-replay proof, which uses `commit-tree` on a detached accumulator).
4. Verify GREEN, commit.

**Done when:**
- [test] in a stacked feature worktree with no journal and `.pipeline/co-author` set, `recordHalt` commits through `commitEngineChange`, only `.docs/halted/demo.md` changes in the commit, the message carries the same co-author and `Task:` trailers a `git commit` at that site carries today, and `git verify-commit` succeeds with `commit.gpgSign=true`; for `recordHalt` (a `--no-verify` site) `prepare-commit-msg` runs and `pre-commit` and `commit-msg` do not.
- [test] when setup-triage captured a repair touching `a.txt` and `b/c.txt` in a stacked worktree, its retained-repair commit contains exactly those paths and is not refused; `supersedeHaltRecord` commits its record while unrelated staged changes are present, and those stay staged and uncommitted.
- [test] each enumerated site calls `commitEngineChange` when the worktree has durable child state, and issues today's `git commit` argv unchanged (mocked runner) when it has none; with the journal `ready`, `moved` or `rolling-back`, a commit attempted from every enumerated site is refused and HEAD is unchanged.
- [test] the structural test `engine-commit-sites.test.ts` fails on an in-memory fixture that adds an unlisted `git commit` call, and passes on the real tree with `build-failure-escalation.ts` recorded as push-only, proving no other engine commit path runs in a stacked feature worktree.

**Files likely touched:**
- `src/conductor/src/engine/halt-record.ts` — `commitHaltRecordChange`
- `src/conductor/src/engine/conductor.ts` — plan-amendment commit
- `src/conductor/src/engine/setup-triage.ts` — three commits
- `src/conductor/src/engine/finish-publication-production.ts` — findings commit
- `src/conductor/src/engine/shipped-record-cli.ts` — shipped-record commit
- `src/conductor/src/engine/shipment-evidence-cli.ts` — repair commit
- `src/conductor/test/engine/engine-commit-sites.test.ts` — per-site tests
- `src/conductor/test/structural/engine-commit-sites.test.ts` — structural audit

**Dependencies:** Task 26

### Task 28: Halts during a restack: recovery first, one halt, and the two-process race
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-halt-seam.realgit.test.ts`, including a separate `node` child process that runs `supersedeHaltRecord` against the same temp repository while the parent applies a restack move, in both orders.
2. In `writeHaltMarker` (`halt-marker.ts`) and `writeHalt` (`rebase.ts`): when a journal is `ready`, `moved` or `rolling-back`, first run `recoverRestackJournal({ target: 'synced' })` (a new target-state parameter that stops forward recovery at `synced`, or drives backward to `aborted`, and never applies the transition) under a re-entry guard (a failing recovery ends `aborted` and never re-invokes the seam), then commit the halt record and record the post-recovery HEAD. `runRestack` drives its own journal to `synced` or `aborted` before calling `haltRestack`.
3. Verify GREEN, commit.

**Done when:**
- [test] when the restack itself must halt while its journal is `moved`, the journal first reaches `synced` or `aborted`, and the halt record commits on the resulting HEAD.
- [test] when the daemon writes a halt through `writeHaltMarker` while the journal is `moved`, journal recovery completes first and the committed record's head SHA is the post-recovery HEAD; the seam calls `recoverRestackJournal` with `target: 'synced'`, so the journal ends `synced` or `aborted`, never `applied`; when the journal's owner is alive, halt-time recovery leaves that journal untouched.
- [test] when halt-time recovery itself fails, the journal ends `aborted`, recovery is not re-entered, and exactly one halt is written.
- [test] when the daemon's halt-record supersede read HEAD, then the restack moved the branch, then the supersede commits (a separate `node` process), the supersede has failed and the branch still holds the restacked tree; across repeated runs in both orders neither side reverts the other.

**Files likely touched:**
- `src/conductor/src/engine/halt-marker.ts` — recovery before the record
- `src/conductor/src/engine/restack/restack-recovery.ts` — `target` parameter
- `src/conductor/src/engine/rebase.ts` — `writeHalt` uses the same guard
- `src/conductor/src/engine/restack/restack-executor.ts` — halt only after `synced`/`aborted`
- `src/conductor/test/engine/restack/restack-halt-seam.realgit.test.ts` — real-git and two-process tests

**Dependencies:** Task 24, Task 27

### Task 29: `repair-pending` cursor kind and read-only consumers
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/child-cursor.test.ts`, `src/conductor/test/engine/rewind-child.test.ts`, `src/conductor/test/engine/task-cli.test.ts`, `src/conductor/test/engine/daemon-rekick.test.ts` and `src/conductor/test/engine/recovery-cli-child-default.test.ts`.
2. In `resolveActiveChild`, a closed child whose branch has non-halt-record commits appended past its closure, with the closure an ancestor of the tip, yields `{ kind: 'repair-pending', repairChildren: ChildId[], ...active fields }`; `divergent` now carries `check`: a closed child whose own branch tip no longer contains its closure (amended or reset behind) yields `divergent` with `check: 'closed-child-rewritten'` naming that child, and a closure that is not an ancestor of the next child's existing branch yields `divergent` with `check: 'range-not-ancestor'` naming the upper (next) child. `consumeResumeAuthorizations`, `kickback-budget-cli.ts`, `task-cli.ts` and `rewind.ts` treat `repair-pending` as the active child and never act on it. `renderChildCursorRefusal` renders `divergent` as its `check` reason naming the child it carries (no `restack required (#2943)` text remains). The closed-child refusal in `rewind.ts` names `#2944`.
3. Verify GREEN, commit.

**Done when:**
- [test] with operator commit `X` appended past `closed/c1` on `feat/c1/demo` (the closure an ancestor of the tip), `resolveActiveChild` returns `repair-pending` with `repairChildren: [1]` and the active child's identity; with `A2` amended or `feat/c1/demo` reset behind `closed/c1` it returns `divergent` with `check: 'closed-child-rewritten'` for child 1.
- [test] in the `repair-pending` state, the read-only resolutions (`consumeResumeAuthorizations`, `kickback-budget inspect` and default-child resolution, `task`, and the `rewind` refusal) report the active child, none throws, and a mocked git runner records no `update-ref` and no journal write from any of them, a `for-each-ref` snapshot of every ref is identical before and after, no restack entry function is called and no `restack_*` event is persisted; `kickback-budget raise|reset --gate restack` is outside this check because it compare-and-swaps `cascades` by design (Task 31.2).
- [test] `rewind --child 1` on a closed child is refused with a message naming `#2944`, and exits non-zero.
- [test] when `closed/c1` is contained in `feat/c1/demo` but is not an ancestor of `feat/c2/demo`, `resolveActiveChild` returns `divergent` with `check: 'range-not-ancestor'` naming child 2, and `renderChildCursorRefusal` names `range-not-ancestor` and child 2.

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts` — `repair-pending`
- `src/conductor/src/engine/daemon-rekick.ts` — `consumeResumeAuthorizations` tolerates it
- `src/conductor/src/engine/kickback-budget-cli.ts` — tolerates it
- `src/conductor/src/engine/task-cli.ts` — tolerates it
- `src/conductor/src/engine/rewind.ts` — tolerates it; refusal names #2944
- `src/conductor/src/engine/conductor.ts` — `renderChildCursorRefusal` text
- `src/conductor/test/engine/child-cursor.test.ts` — cursor tests
- `src/conductor/test/engine/rewind-child.test.ts` — rewind refusal
- `src/conductor/test/engine/recovery-cli-child-default.test.ts` — read-only consumers

**Dependencies:** Task 2, Task 8

### Task 30: The stack preflight: automatic repair, chained base refresh and deferral
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/stack-preflight.realgit.test.ts`.
2. Implement `runStackPreflight({ worktree, slug, baseRefreshDue, consumeRekick, events })` in `src/conductor/src/engine/restack/stack-preflight.ts`: three phases in order: (1) `recoverRestackJournal`; (2) the halt-record supersede and `consumeResumeAuthorizations`; (3) re-check and remove a leftover `aborted` journal whose halt is cleared, then resolve the cursor and repair; on `repair-pending`, `checkCascadeCap` for every originating child, then `runRestack({ cause: 'feature-repair', originatingChildren: repairChildren })` with a `base-refresh` follow-on when `baseRefreshDue`, run next through `replaceAppliedJournalWithFollowOn` (the preflight calls `consumeRekick` before it starts any restack that carries the follow-on, and never otherwise); on `divergent`, halt needs-human with `restack_refused` whose reason is the cursor's `check` (`closed-child-rewritten` naming the closed child, or `range-not-ancestor` naming the upper child) and run no restack; halt-record-only appended commits run no repair; when the repair halts or the follow-on is refused, emit `restack_refused` reason `deferred-base-refresh`.
3. Verify GREEN, commit.

**Done when:**
- [test] given operator commit `X` on `feat/c1/demo` past `closed/c1`, `runStackPreflight` runs a `feature-repair` restack that moves `closed/c1` to `X` and replays child 2 and the leaf onto it, writes no needs-human halt (when child 1 and child 2 both have appended commits, one `feature-repair` restack repairs both), and also applies when `X` was committed from another worktree that still has `feat/c1/demo` checked out; when `X` is followed by a halt-record commit, `closed/c1` moves to that halt-record commit.
- [test] with commits past `closed/c1` touching only `.docs/halted/demo.md`, no repair runs; with `A2` amended so the branch no longer contains `closed/c1`, or with `feat/c1/demo` reset behind `closed/c1`, no restack runs and the preflight halts needs-human with `restack_refused` reason `closed-child-rewritten` naming child 1, leaving `closed/c1` unchanged; when `closed/c1` is not an ancestor of `feat/c2/demo`, the preflight halts needs-human with `restack_refused` reason `range-not-ancestor` naming child 2 and runs no restack.
- [test] with a repair pending and `baseRefreshDue`, the preflight applies a `feature-repair` restack first and a `base-refresh` restack second with distinct opIds, and when the process died after the repair reached `applied`, the next preflight runs the base-refresh restack: `recoverRestackJournal` finds the `applied` journal naming the follow-on and runs `runRestack({ cause: 'base-refresh' })` through `replaceAppliedJournalWithFollowOn`.
- [test] when the repair is refused (cascade cap, dirty overlap or conflict) while a base refresh was due, `restack_refused` with reason `deferred-base-refresh` is persisted and no base-refresh restack ran; when the repair applied but the follow-on is refused (`checked-out-elsewhere`), `restack_refused` with reason `deferred-base-refresh` is persisted.
- [test] while the repair's journal is `applied` with a pending follow-on, an unrelated restack planned against it is refused `restack-outstanding`, and the follow-on still runs to `applied`; for a feature without durable child state the preflight runs only the guarded journal probe (no cursor, cap check or repair).

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts` — new preflight
- `src/conductor/test/engine/restack/stack-preflight.realgit.test.ts` — real-git tests

**Dependencies:** Task 15, Task 22, Task 24, Task 29

### Task 31: Wire the stack preflight into daemon dispatch and conductor resume
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-preflight-wiring.test.ts` that drive the real daemon per-feature dispatch path in `daemon-cli.ts` (mocked provider and remote) and `Conductor.run()` with `resume: true`.
2. In `daemon-cli.ts`, call `runStackPreflight` after `isOperatorParked` and before `resumeRebaseFirst` (the preflight runs the halt-record supersede and `consumeResumeAuthorizations` as its second phase), passing `baseRefreshDue` when the `REKICK` sentinel exists and a `consumeRekick` callback that removes it. The preflight consumes `REKICK` itself before it starts any restack carrying the chained base-refresh follow-on; when it runs no base refresh it leaves `REKICK` for `resumeRebaseFirst` as today. In `conductor.ts` resume, call it before `resolveActiveChild` and `classifyRebaseOperation` (the supersede runs inside it); defer `classifyRebaseOperation` until the journal is gone (the journal owns any `applying` record it wrote). Keep `resumeRebaseFirst`'s up-front `REKICK` consumption so crash recovery depends only on the journal.
3. Verify GREEN, commit.

**Done when:**
- [test] given a three-child stack in which the operator committed `X` on `feat/c1/demo` past `closed/c1`, both the next daemon dispatch and a conductor resume run a `feature-repair` restack (moving `closed/c1` to `X` and replaying child 2 and the leaf) inside the stack preflight, whose phases run in order (journal recovery, then the halt-record supersede and `consumeResumeAuthorizations`, then the repair), all before `resumeRebaseFirst`, the cursor and `classifyRebaseOperation`, and write no needs-human halt.
- [test] for an operator-parked feature with commits appended past `closed/c1`, the daemon dispatch runs no restack and moves no ref.
- [test] with a journal outstanding and closure refs already moved, resume writes no divergent halt and judges the active child only after recovery; with a journal and an `applying` rebase operation record it wrote, `classifyRebaseOperation` does not classify the record as interrupted until the journal is gone.
- [test] after a crash mid the preflight's chained follow-on base refresh (the preflight removed `REKICK` before starting it), the next dispatch runs only journal recovery and no second re-kick runs; when the preflight runs no base refresh, `REKICK` is still present for `resumeRebaseFirst`.
- [test] when a CLI-triggered conductor resume races a daemon dispatch on the same feature, the loser emits `restack_refused` with reason `restack-outstanding`, creates no journal and moves no ref, and the winner's restack completes to `applied`; while the winner's process (the journal's live owner) runs, the loser does not drive the winner's journal.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — preflight in dispatch
- `src/conductor/src/engine/conductor.ts` — preflight in resume; classification deferral
- `src/conductor/test/engine/stack-preflight-wiring.test.ts` — entry-point tests

**Dependencies:** Task 30

### Task 31.1: Live-HALT gating, preflight halts and leftover cleanup at every restack entry
**Story:** 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-preflight-gating.test.ts` that drive the real daemon per-feature dispatch path in `daemon-cli.ts` (mocked provider and remote).
2. In `runStackPreflight`: when the feature has a live HALT, run only journal recovery; run the automatic repair only when there is no live HALT, or when a resume authorization matching the live halt generation is staged. A halt written by the preflight ends the dispatch: `daemon-cli.ts` runs neither `resumeRebaseFirst` nor `conductor.run()` afterwards.
3. In `runRestack`'s entry (Task 8), re-check for a leftover `aborted` journal after the halt-record supersede and resume authorization have run, and delete it (with its staging refs) when its committed halt record no longer reads `Status: halted`, before creating a new journal.
4. Verify GREEN, commit.

**Done when:**
- [test] on a feature with a live HALT and appended commits past `closed/c1`, the daemon dispatch's preflight runs only journal recovery and no repair; with a staged resume authorization matching the live halt generation, the same dispatch runs the repair.
- [test] when the preflight writes a halt (for example `closed-child-rewritten`), the dispatch ends: a spy records no `resumeRebaseFirst` call and no `conductor.run()` call.
- [test] at the first resume after a restack halt clears, the halt-record supersede and resume-authorization consumption run inside the preflight before the repair (the committed halt record then reads `Status: resolved`), the leftover `aborted` journal and its staging refs are removed before any new journal is created, the repair is not refused `restack-outstanding` (no `restack_refused` with reason `restack-outstanding` is persisted), and no new halt is written.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts` — live-HALT gating
- `src/conductor/src/engine/restack/restack-executor.ts` — leftover cleanup at entry
- `src/conductor/src/daemon-cli.ts` — preflight halt ends the dispatch
- `src/conductor/test/engine/stack-preflight-gating.test.ts` — dispatch tests

**Dependencies:** Task 31

### Task 31.2: `kickback-budget raise|reset --gate restack --child <k>`
**Story:** 13
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-budget-restack.test.ts` (CLI through `dispatchKickbackBudgetCommand`, plus one daemon-dispatch resume through the preflight).
2. In `kickback-budget-cli.ts`, for `--gate restack`: validate the live halt and the typed `restack` cap evidence; validate `--child` against the `cascades` ref (not `.pipeline/children/<k>/`) and against the evidence's originating child; then follow ADR decision 10's order: stage the pending adjustment (`stageKickbackBudgetAdjustment`), append `kickback_budget_adjustment_authorized`, update the limit (`raise`) or count (`reset`) by compare-and-swap on `refs/conductor/<slug>/cascades`, and only then install the resume authorization in the active child's ledger. On CAS loss fail without installing an authorization. A failure before the CAS leaves `cascades` unchanged, and a re-run reconciles the pending adjustment by its adjustment id (applying the CAS at most once). Add `restack` to the `kickback-budget` usage text in `src/conductor/src/cli.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] at the cascade-cap halt for child 1, `kickback-budget raise --gate restack --child 1` stores the raised limit in `refs/conductor/demo/cascades` and the next daemon dispatch's stack preflight runs the repair; `kickback-budget reset --gate restack --child 1` sets child 1's count to 0 and the next resume runs the repair; the authorization is consumed, the HALT is cleared and `.docs/halted/demo.md` reads `Status: resolved`, while with cap evidence but no authorization the dispatch runs no restack, writes no second halt and leaves the evidence generation unchanged.
- [test] with no live cascade-cap halt and no `restack` cap evidence, `kickback-budget reset --gate restack --child 1` is refused and the `cascades` ref is unchanged; with cap evidence for child 1, `kickback-budget raise --gate restack --child 2` is refused and the ref is unchanged; after a `raise`, `reset --gate restack --child 1` sets child 1's count to 0 and keeps the raised limit, `raise` keeps the count, and neither touches another child's entry in `cascades`.
- [test] with the cascade-cap halt for child 1 and a recreated worktree with no `.pipeline/children/1/`, `kickback-budget raise --gate restack --child 1` is accepted, because `--child` is validated against the `cascades` ref; and the `kickback-budget` usage text in `src/conductor/src/cli.ts` lists `restack` as an accepted `--gate`.
- [test] when the CLI's compare-and-swap on `cascades` loses a race with a concurrent write, the command fails, no resume authorization is staged, and the concurrent write is kept.
- [test] when the command fails after staging the pending adjustment and appending `kickback_budget_adjustment_authorized` but before the compare-and-swap, `refs/conductor/demo/cascades` is unchanged and no resume authorization exists; re-running the command reconciles that pending adjustment by its adjustment id, applies the `cascades` update exactly once and installs the authorization once.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — `restack` pseudo-gate
- `src/conductor/src/cli.ts` — usage text
- `src/conductor/test/engine/kickback-budget-restack.test.ts` — CLI and resume tests

**Dependencies:** Task 22, Task 31.1

### Task 32: The FINISH `rebase` step base-refreshes the whole stack
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stacked-finish-rebase.test.ts` driving `runRebaseStep` through the conductor.
2. In `runRebaseStep` (`conductor.ts`), when `hasDurableChildState` is true, first run `runStackPreflight` (journal recovery and any pending repair), then `classifyMergeableSkip` as today for the leaf PR, and only then `runRestack({ cause: 'base-refresh' })` instead of `performRebase`; record the whole-stack tuple and `cause` in the `rebase` step verdict through `recordRebaseStepCompletion`; persist `rebase_changed` with the unfiltered whole-stack delta. A no-op when the new default tip is already an ancestor of `feat/c1/demo`.
3. Verify GREEN, commit.

**Done when:**
- [test] on a three-child stack with a default advance, the FINISH `rebase` step runs a `base-refresh` restack that moves child 1 onto `B'` and restacks child 2 and the leaf, and the `rebase` step verdict's operation carries `cause: 'base-refresh'` and the whole-stack tuple P = old leaf tip, B = `merge-base(old c1, B)`, O = `B'`, H = new leaf tip.
- [test] when that restack applies, `rebase_changed` is persisted with the whole-stack delta from `B` to `B'` as `allChangedPaths`, and `resolveBaseAdvanceForFailure` attributes a test failure on a path in that delta to the base advance.
- [test] when the leaf PR is mergeable and the base delta does not touch the feature's review inputs, `classifyMergeableSkip` applies the existing mergeable-skip and no restack runs; when the advanced base changes an active review input, a `base-refresh` restack runs even though the leaf PR is mergeable.
- [test] with an appended operator commit past `closed/c1` and a mergeable leaf PR at FINISH, `runStackPreflight` runs before `classifyMergeableSkip` and the `feature-repair` restack still applies; that preflight repair inside the FINISH `rebase` step earns no legacy `advanceTail` refund credit.
- [test] with an operator commit `X` past `closed/c1` when the FINISH `rebase` step runs, `runStackPreflight` applies the `feature-repair` restack first and the `base-refresh` restack second, and `X` survives in child 1 and in every child above it (`X`'s change is present in `feat/c1/demo`, `feat/c2/demo` and the leaf).

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `runRebaseStep` stacked branch
- `src/conductor/src/engine/restack/restack-executor.ts` — `rebase_changed` for base refresh
- `src/conductor/test/engine/stacked-finish-rebase.test.ts` — FINISH tests

**Dependencies:** Task 8, Task 18, Task 21, Task 30

### Task 33: The daemon re-kick base-refreshes the whole stack at any active child
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-rekick.test.ts` (rewrite the decision-12 skip tests to assert the whole-stack refresh) and `src/conductor/test/engine/stacked-finish-rebase.test.ts`.
2. In `resumeRebaseFirst` (`daemon-rekick.ts`), remove the non-leaf skip and its `rebase_skipped_for_stack` emission; when `hasDurableChildState` is true, run `runRestack({ cause: 'base-refresh' })` instead of `performRebase`, passing the active child so the transition writes to its stores (replacing the flat `applyRebaseTransition` write). A refusal returns `halted` with a needs-human HALT naming the paths; it never returns silently.
3. Verify GREEN, commit.

**Done when:**
- [test] on the one-closed-one-active stack mid-build with a default advance, the daemon re-kick's `resumeRebaseFirst` runs a `base-refresh` restack that moves child 1 and the active child 2, emits no `rebase_skipped_for_stack` event, and writes child 2's re-judged region gates to `.pipeline/children/2/` while `.pipeline/gates/` region files stay unchanged, and persists `rebase_changed` with the whole-stack delta.
- [test] when `B'` is already an ancestor of `feat/c1/demo`, neither the FINISH step nor the re-kick moves any ref.
- [test] for a stacked feature, a mocked git runner records no single-branch `rebase` of any child branch or the leaf from either the FINISH step or the re-kick, and a spy on `performRebase` records no call.
- [test] when the re-kick's restack is refused for `dirty-overlap`, `resumeRebaseFirst` returns `halted` with a needs-human HALT naming the paths and does not skip silently.
- [test] after a crash mid-restack during a daemon re-kick, the next dispatch runs only journal recovery: no second re-kick runs and a spy on `performRebase` records no call; at the first re-kick after a restack halt clears, once the entry cleanup removed the leftover `aborted` journal, the re-kick's `base-refresh` restack runs to `applied` with no `restack-outstanding`.

**Files likely touched:**
- `src/conductor/src/engine/daemon-rekick.ts` — stacked re-kick restack
- `src/conductor/test/engine/daemon-rekick.test.ts` — re-kick tests
- `src/conductor/test/engine/stacked-finish-rebase.test.ts` — no-op and no-rebase tests

**Dependencies:** Task 31, Task 31.1, Task 32

### Task 34: Published stacks escalate instead of replaying; child branches are never published
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/autoresolve-published-stack.test.ts`, `src/conductor/test/engine/mergeable-sweep.test.ts` and `src/conductor/test/engine/finish-publication-production.test.ts`.
2. In `resolveConflictingPr` (`autoresolve.ts`), before any rebase, when the feature has durable child state: run no replay and no push, call `escalate` with the published-stack reason, persist `restack_refused` with reason `published-stack` and `detail` naming `#2945`, and return the outcome kind `published-stack`. In `mergeable-sweep.ts`, handle that kind by restoring the watch entry's `resolveAttempts` to its pre-dispatch value, so the escalation does not consume the rebase-resolution attempt cap.
3. Verify GREEN, commit.

**Done when:**
- [test] when the mergeable sweep's autoresolve reaches a stacked feature's published leaf PR that conflicts with `origin/main`, `resolveConflictingPr` runs no replay or push (the mocked git and remote boundaries record no `rebase`, `merge-tree` or `push`), escalates to a human through `escalate`, and persists `restack_refused` with reason `published-stack` and `detail` naming `#2945`.
- [test] the published-stack escalation does not consume the rebase-resolution attempt cap: after the sweep, the watch entry's `resolveAttempts` equals its pre-dispatch value.
- [test] in a stacked FINISH, the publication path pushes no `feat/c<k>/demo` branch (the mocked remote boundary records only the leaf).

**Files likely touched:**
- `src/conductor/src/engine/autoresolve.ts` — published-stack escalation
- `src/conductor/src/engine/mergeable-sweep.ts` — cap not consumed
- `src/conductor/test/engine/autoresolve-published-stack.test.ts` — escalation tests
- `src/conductor/test/engine/mergeable-sweep.test.ts` — attempt-cap test
- `src/conductor/test/engine/finish-publication-production.test.ts` — no child push

**Dependencies:** Task 2

### Task 35: Record every successful feature-branch push at `executeRemoteGit`
**Story:** 14
**Type:** happy-path

**Steps:**
1. Write failing real-git tests (with a local bare remote) in `src/conductor/test/engine/push-lease-recording.test.ts`.
2. In `src/conductor/src/engine/push-lease.ts`, implement `recordPushedTip` (`refs/conductor/<slug>/pushed/<branch>`, compare-and-swap) and the intent ref (`{expected, new}`, written before the push and removed after the outcome). Call it from `executeRemoteGit` (`remote-git-operations.ts`) after a successful push, plain or forced, only when the destination is a feature branch (`parseFeatureRef` leaf or child kind).
3. Verify GREEN, run the N=1 golden suite, commit.

**Done when:**
- [test] after `executeRemoteGit` completes a successful push of `feat/daemon-demo`, plain or forced, `refs/conductor/demo/pushed/feat/daemon-demo` holds the pushed SHA and no intent remains; the intent is removed only after the tip is recorded, so it survives a recording failure.
- [test] after a successful engine push to a non-feature ref, no `pushed/` ref is written.
- [test] the #3019 N=1 golden suite (`n1-golden-state.test.ts`, `n1-golden-renderings.test.ts`) passes byte-identical with no fixture change.

**Files likely touched:**
- `src/conductor/src/engine/push-lease.ts` — recording and intent
- `src/conductor/src/engine/remote-git-operations.ts` — record on success
- `src/conductor/test/engine/push-lease-recording.test.ts` — real-git tests

**Dependencies:** Task 2

### Task 36: The expected-SHA lease decision helper
**Story:** 14
**Type:** negative-path

**Steps:**
1. Write failing real-git tests (local bare remote, a second clone acting as a human and as another worktree's full fetch) in `src/conductor/test/engine/push-lease-decision.test.ts`.
2. Implement `forcePushWithExpectedLease({ cwd, slug, branch, remoteGit, events })` in `push-lease.ts`: capture the tracking ref; fetch only `refs/heads/<branch>`; read the remote tip R; push `--force-with-lease=refs/heads/<branch>:<R>` when R equals the recorded tip, or R is an ancestor of HEAD, or there is no record and R equals the pre-fetch tracking ref; adopt the intent's new SHA when it equals R; otherwise refuse without pushing and emit `push_lease_refused`. A failed fetch or remote read, or a missing tracking ref on the no-record path, attempts no push and changes no `pushed/` ref. No intent survives a refused or failed push.
3. Verify GREEN, commit.

**Done when:**
- [test] with no recorded tip and a remote tip equal to the tracking ref captured before the fetch, the helper pushes with `--force-with-lease=refs/heads/feat/daemon-demo:<R>`, succeeds and records a tip.
- [test] when the push succeeded remotely but recording the tip failed, the next force push treats the intended new SHA as the recorded tip and proceeds.
- [test] with no recorded tip and a remote tip that differs from the pre-fetch tracking ref and is not an ancestor of HEAD, the helper refuses without pushing and emits `push_lease_refused`; with no recorded tip and no tracking ref, it refuses naming the missing tracking ref.
- [test] when the single-branch fetch or the remote read fails, no push is attempted and no `pushed/` ref changes; after any refused or failed push no intent remains.
- [test] every push the helper makes reaches the mocked `executeRemoteGit` boundary, which records it with an explicit `--force-with-lease=<ref>:<sha>`, and no bare `--force-with-lease` reaches `executeRemoteGit`.

**Files likely touched:**
- `src/conductor/src/engine/push-lease.ts` — decision helper
- `src/conductor/test/engine/push-lease-decision.test.ts` — real-git tests

**Dependencies:** Task 35

### Task 37: All four force-push callers use the expected-SHA lease
**Story:** 14
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/ship-draft-pr.test.ts`, `src/conductor/test/engine/autoresolve-lease.test.ts`, `src/conductor/test/engine/ci-fix.test.ts` and `src/conductor/test/engine/halt-record-lease.test.ts`, plus a real-git test with the installed engine `pre-push` hook (`PRE_PUSH_HOOK`).
2. Replace the bare `--force-with-lease` argv in `ship-draft-pr.ts` (the `pushMode: 'lease'` post-rebase draft refresh), `pushRefreshedBranch` in `autoresolve.ts` (used by autoresolve and `ci-fix.ts`) and `publishHaltRecord` in `halt-record.ts` with `forcePushWithExpectedLease`. Each keeps its existing failure handling: halt-record publication emits `halt_record_push_failed`, keeps the commit and never throws; the draft refresh logs loudly and the build continues; autoresolve and ci-fix escalate with the refusal or failure as the reason.
3. Verify GREEN, commit.

**Done when:**
- [test] given a recorded tip equal to the remote tip `R`, the post-rebase draft refresh fetches only `feat/daemon-demo` first, pushes with an expected SHA of `R`, succeeds and records the new tip, and the installed engine `pre-push` hook passes for that explicit-SHA push.
- [test] when a human pushed `H` and ci-fix built its HEAD on `H`, ci-fix's force push through `pushRefreshedBranch` succeeds.
- [test] with a recorded tip `R1` and another worktree's full fetch having advanced `origin/feat/daemon-demo` to a human's `R2` (not an ancestor of HEAD), autoresolve's force push is refused and the remote is unchanged, `push_lease_refused` {expected `R1`, actual `R2`} is persisted, and autoresolve escalates with the refusal as the reason; the draft refresh, ci-fix and halt-record publication are each refused in the same way.
- [test] under that same remote state, halt-record publication is refused, `push_lease_refused` and `halt_record_push_failed` are persisted, the halt-record commit is kept, and the halt path does not fail.
- [test] when the single-branch fetch or the remote read fails, halt-record publication emits `halt_record_push_failed`, keeps the commit and does not fail the halt path, the draft refresh logs a loud failure naming the ref and the build continues, autoresolve and ci-fix escalate with the failure as the reason, and none of the four callers passes a bare `--force-with-lease` to `executeRemoteGit`.

**Files likely touched:**
- `src/conductor/src/engine/ship-draft-pr.ts` — lease push
- `src/conductor/src/engine/autoresolve.ts` — `pushRefreshedBranch`
- `src/conductor/src/engine/ci-fix.ts` — failure handling on refusal
- `src/conductor/src/engine/halt-record.ts` — `publishHaltRecord`
- `src/conductor/test/engine/ship-draft-pr.test.ts` — draft refresh tests
- `src/conductor/test/engine/autoresolve-lease.test.ts` — autoresolve tests
- `src/conductor/test/engine/ci-fix.test.ts` — ci-fix tests
- `src/conductor/test/engine/halt-record-lease.test.ts` — halt-record tests

**Dependencies:** Task 36

### Task 38: Teardown and reclaim delete every ref this feature added, by explicit name
**Story:** 14
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` (real-git, plus a mocked boundary for the no-glob assertion), `src/conductor/test/engine/mergeable-sweep.test.ts` and `src/conductor/test/engine/park-reconciliation.test.ts`.
2. Implement `deleteFeatureConductorRefs(slug, git)` in `src/conductor/src/engine/restack/restack-refs-cleanup.ts`: one `update-ref --stdin` transaction of `delete` lines built from a fixed list (`pushed/feat/daemon-<slug>`, `pushed/feat/c<k>/<slug>` for every k up to `MAX_CHILD_ID`, their intents, `cascades`, `leaf-moved`, `restack/journal`) plus the staging refs named in the journal, each verified with `rev-parse --verify` first; never `for-each-ref` or a glob. Call it from shipped-record teardown in `mergeable-sweep.ts` and from `reconcileMergedPark` in `park-reconciliation.ts`, only after that helper's own checks have passed.
3. Verify GREEN, commit.

**Done when:**
- [test] both after shipped-record teardown in `mergeable-sweep.ts` runs for `demo` and, in a separate fixture, after the single-slug reclaim helper `reconcileMergedPark` runs for `demo`, each recorded `pushed/` ref, the intent, `cascades`, `leaf-moved`, the journal and its staging refs are deleted, and the mocked git boundary received only explicit-name `delete <ref>` lines with no glob and no `for-each-ref`.
- [test] after teardown ran for `demo`, a new feature reusing slug `demo` takes the no-record path on its first force push, and its cascade counts start at 0.
- [test] when `reconcileMergedPark` refuses a candidate (in flight, a live HALT, or an invalid slug), `deleteFeatureConductorRefs` is not called and every `refs/conductor/demo/` ref is unchanged.
- [test] a failing or partial ref deletion during shipped-record teardown or `reconcileMergedPark` does not throw out of the sweep or the reclaim, does not alter the worktree reap or reclaim decision, and a re-run deletes the remaining refs.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-refs-cleanup.ts` — new cleanup
- `src/conductor/src/engine/mergeable-sweep.ts` — call at teardown
- `src/conductor/src/engine/park-reconciliation.ts` — call in `reconcileMergedPark`
- `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` — cleanup tests

**Dependencies:** Task 20, Task 22, Task 36

### Task 39: N=1 stays unchanged, and region-access counts are updated deliberately
**Story:** 15
**Type:** negative-path

**Steps:**
1. Write a new test `src/conductor/test/engine/n1-restack-absence.test.ts` that reuses the cells from `n1-golden-shared.ts` without modifying the golden suite files or fixtures.
2. Update `child-region-access-audit.test.ts` so each new restack writer of region verdicts, ledgers and conduct state (`restack-transition.ts`, `cascade-cap.ts`, `daemon-rekick.ts`) is classified individually.
3. Verify GREEN, commit.

**Done when:**
- [test] for a feature with no durable child state, FINISH, re-kick and resume through the #3019 N=1 golden suite (`n1-golden-state.test.ts`, `n1-golden-renderings.test.ts`) are byte-identical to their committed fixtures, with today's rebase result, `rebase` step verdict and events.
- [test] in those N=1 cells no `restack_*` event is emitted, and no `refs/conductor/<slug>/` ref other than `pushed/` and its intent exists after the run; a mocked git boundary records no `update-ref` creating any `refs/conductor/<slug>/` ref other than `pushed/` and its intent during the N=1 run.
- [test] in an N=1 cell whose force push is refused, `push_lease_refused` is the only new event type relative to today's fixture.
- [test] `child-region-access-audit.test.ts` pins updated per-site counts that classify every new restack writer as `child-aware` or `whole-feature-only`, and no allowlist entry is widened to a wildcard.
- [test] on the final tree `restack-refused-emitter.test.ts` passes, with `haltRestack`, the losing planner in `createRestackJournal`, the deferred-base-refresh, published-stack and cascade-cap paths each emitting `restack_refused` only through `emitRestackRefused`.

**Files likely touched:**
- `src/conductor/test/engine/n1-restack-absence.test.ts` — N=1 absence assertions
- `src/conductor/test/engine/child-region-access-audit.test.ts` — updated counts

**Dependencies:** Task 32, Task 33, Task 34, Task 37

## Task Dependency Graph

```
1 → 2 ; 1 → 5 ; 3 → 6 ; 1 → 6 ; 1,2 → 4 ; 2,4 → 7
2,4,5,6,7 → 8
8 → 9, 10, 11, 12, 13, 18, 20 ; 9 → 10 ; 4,8 → 22
3,8,11 → 14 ; 13,14 → 15 ; 14,15 → 16 ; 12,15 → 17
15,18 → 19 ; 18 → 21 ; 9,14,18 → 24 ; 10,22,24 → 25 ; 4 → 26 → 27 ; 24,27 → 28
2,8 → 29 ; 15,22,24,29 → 30 → 31 → 31.1 ; 22,31.1 → 31.2
8,18,21,30 → 32 ; 31,31.1,32 → 33 ; 2 → 34
2 → 35 → 36 → 37 ; 20,22,36 → 38
32,33,34,37 → 39
```

## Integration Points

- **After Task 8:** a real-git three-child stack restacks end to end through `runRestack`.
- **After Task 24:** a crash at any journal state is completed or rolled back from refs alone.
- **After Task 31.1:** the daemon dispatch and conductor resume repair operator commits on closed
  children automatically, through the stack preflight.
- **After Task 33:** the FINISH `rebase` step and the daemon re-kick refresh the whole stack.
- **After Task 37:** every engine force push leases against an explicit expected SHA.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a three-child stack and a default advance, when a `base-refresh` restack completes, then: `git rev-list B'..feat/c1/demo` lists exactly the rewrites of `A1` and `A2`; `git rev-list closed/c1..feat/c2/demo` lists exactly the rewrites of `C1` and `C2`; `git rev-list closed/c2..feat/daemon-demo` lists exactly the rewrite of `L1`. | 8 | "`git rev-list B'..feat/c1/demo` lists exactly the rewrites of `A1` and `A2`" | diff-local |
| Story 1 happy: Given a restack, when each rewritten commit is compared with its original, then its author name, email, date and message are identical, and its committer name, email and date equal the stamp recorded in the journal. | 6 | "committer name, email and date equal to the journal's committer stamp" | diff-local |
| Story 1 happy: Given child 2 contains an empty evidence commit `E` (`git commit --allow-empty` with an `Evidence:` trailer), when a restack moves child 2, then the rewritten child 2 contains a commit with `E`'s message and trailer, and the rewrite map maps `E` to it. | 6 | "the returned rewrite map maps `E` to it" | diff-local |
| Story 1 happy: Given child 1's commit `A2` was cherry-picked to `origin/main` within the default advance, when a `base-refresh` restack runs, then `git rev-list B'..feat/c1/demo` lists exactly one commit (the rewrite of `A1`), and child 1's tree equals `B'` with `A1`'s change applied. | 11 | "lists exactly one commit (the rewrite of `A1`) and child 1's tree equals `B'` with `A1`'s change applied" | diff-local |
| Story 1 happy: Given child 2 reverts its parent's commit `A1` and later re-applies it as `A1r` (same patch-id), when a restack moves child 2, then `A1r` is replayed and child 2's tree keeps `A1`'s change. | 11 | "replays `A1r` and child 2's tree keeps `A1`'s change" | diff-local |
| Story 1 happy: Given `commit.gpgSign=true` and a configured signing key, when a restack completes, then `git verify-commit` succeeds for every rewritten commit. | 6 | "`git verify-commit` succeeds for every replayed commit" | diff-local |
| Story 1 negative: Given a restack in which child 2's commit `C2` becomes empty because the new `closed/c1` already carries its change, when child 2 is replayed, then no commit for `C2` appears in the new child 2. | 6 | "a commit `C2` whose change the new parent already carries produces no commit" | diff-local |
| Story 1 negative: Given a repair restack whose originating commit `X` on child 1 was already cherry-picked into child 2 as `X2`, when child 2 is replayed, then `X2` does not appear in the new child 2. | 11 | "the new child 2 contains no commit for `X2`" | diff-local |
| Story 1 negative: Given the one-closed-one-active stack, when a restack runs, then `feat/daemon-demo` is not moved, and no branch is created for position 3. | 8 | "`runRestack` does not move `feat/daemon-demo` and creates no branch for position 3" | diff-local |
| Story 1 negative: Given the one-closed-one-active stack, where `feat/c1/demo` was created from a pre-region halt record `H` on the unentered leaf (the leaf still sits at `H`), when a `base-refresh` restack rewrites `H` to `H'`, then: the leaf moves to `H'` in the same move; no `refs/conductor/demo/leaf-moved` ref is written; when child 2 later closes, the leaf move succeeds with no stray-commit refusal. | 20 | "moves the leaf to `H'` in the same move, writes no `refs/conductor/demo/leaf-moved` ref, and when child 2 later closes `moveLeaf` completes with no stray-commit refusal" | diff-local |
| Story 1 negative: Given the journaled old `closed/c1` is not an ancestor of `feat/c2/demo`'s tip (child 2 was rebased elsewhere), when a restack is planned, then it halts needs-human with `restack_refused` reason `range-not-ancestor`, naming child 2, and no ref moves. | 5, 8 | "returns a needs-human refusal `range-not-ancestor` naming child 2, creates no journal and moves no ref" | diff-local |
| Story 1 negative: Given the operator's git config sets `rebase.updateRefs=true`, `rebase.autoSquash=true` and `merge.renames=false`, when a restack, an N=1 rebase, or a resolver hand-off runs, then its result and resolver todo are identical to those produced with the keys unset. | 3, 6, 14 | "the resolver todo and resulting tip are identical to those produced with the keys unset" | diff-local |
| Story 1 negative: Given a crash at `planned` after child 1 was replayed, when the next resume re-plans, then child 1's rewritten SHAs are identical to the first attempt's. | 24 | "child 1's rewritten SHAs are identical to the first attempt's" | diff-local |
| Story 1 negative: Given `feat/c1/demo` holds a halt-record-only commit past `closed/c1`, when a `base-refresh` restack moves child 1, then: the new `feat/c1/demo` equals the new `closed/c1`; that commit appears in no child; `git reflog feat/c1/demo` still lists it. | 8 | "leaves the new `feat/c1/demo` equal to the new `closed/c1`, that commit appears in no child, and `git reflog feat/c1/demo` still lists it" | diff-local |
| Story 2 happy: Given child 2 contains a merge `M` of `origin/main` at `D1` whose tree equals the automatic merge, and the new parent contains `D1`, when child 2 is replayed, then no commit for `M` appears. | 12 | "produces no commit when the new parent contains `D1`" | diff-local |
| Story 2 happy: Given child 2 contains a merge `M` of `D1` with a hand resolution, and the new parent contains `D1`, when child 2 is replayed, then exactly one commit replaces `M`: its change is only the hand resolution; it carries a `Flattened-merge:` trailer; a `rebase_merge_audit` event is persisted. | 12 | "replaced by exactly one commit whose change is only the hand resolution, carrying a `Flattened-merge:` trailer, and `rebase_merge_audit` is persisted" | diff-local |
| Story 2 happy: Given child 2 merged a side branch `Q` that the new parent does not contain, when child 2 is replayed cleanly, then one flattened commit replaces `M`, carrying `M`'s change relative to its first parent. | 12 | "becomes one flattened commit carrying `M`'s change relative to its first parent when replayed cleanly" | diff-local |
| Story 2 negative: Given child 2 merged `origin/main` at `D1`, and main later changed the same lines at `D2` (the new parent contains `D2`), when a `base-refresh` restack replays child 2, then no conflict is raised and child 2's tree keeps `D2`'s lines. | 12 | "replays child 2 with no conflict and child 2's tree keeps `D2`'s lines" | diff-local |
| Story 2 negative: Given child 2 merged `origin/main` at `D1`, and main later reverted `D1`'s line (the new parent contains the revert), when child 2 is replayed, then the reverted line is absent from child 2. | 12 | "the reverted line is absent from child 2" | diff-local |
| Story 2 negative: Given a merge-bearing child whose replay conflicts (Q carried or not), when the conflict is handled, then: the restack halts with `restack_refused` reason `flatten_refused`, naming the merge; no resolver is dispatched; no ref moves; the halt's recovery text tells the operator to resolve on the child branch and resume, and never prescribes a single-branch `git rebase` of a stacked branch. | 17 | "halts with `restack_refused` reason `flatten_refused` naming the merge, dispatches no resolver, and moves no ref" | diff-local |
| Story 3 happy: Given a restack in which every replayed child changes, relative to its new parent, only paths it changed relative to its old parent, when the replay finishes, then the restack applies. | 13 | "a restack where every child changes only paths it changed before applies" | diff-local |
| Story 3 happy: Given child 2 renames `src/x.ts` to `src/y.ts`, then edits two lines of `src/y.ts`, and the parent does not touch `src/x.ts`, when child 2 is replayed, then the restack applies. | 13 | "child 2's rename of `src/x.ts` to `src/y.ts` followed by edits" | diff-local |
| Story 3 happy: Given the parent's new changes and child 2's owned paths both include `src/f.ts`, when the restack applies, then `restack_applied` for child 2 lists `src/f.ts` in `parentOverlapPaths`. | 13 | "`restack_applied` for child 2 lists `src/f.ts` in `parentOverlapPaths`" | diff-local |
| Story 3 negative: Given child 2 added change X to `src/g.ts` and later reverted it (no net change to `src/g.ts`), and the repaired parent now adds X, when child 2's replay removes X, then: the restack halts with `restack_refused` reason `replay-mismatch`, naming child 2 and `src/g.ts`; no ref moves; the journal and staging refs remain until that halt is cleared. | 13, 24 | "halts with `restack_refused` reason `replay-mismatch` naming child 2 and `src/g.ts`, no ref moves, and the journal and staging refs still exist after the halt" | diff-local |
| Story 3 negative: Given child 2 sets line L of `src/h.ts` to `a` and then to `b`, and the new parent carries `L=a`, when child 2 is replayed, then the restack applies with `L=b`. | 13 | "onto a parent carrying `L=a` applies with `L=b`" | diff-local |
| Story 3 negative: Given child 2 renames `src/x.ts` to `src/z.ts`, and the new parent independently created `src/z.ts`, when child 2 is replayed, then the collision on `src/z.ts` is not accepted as a clean replay: it is raised as a conflict on `src/z.ts` and handed to the resolver (Story 6). | 13, 15 | "the conflict on `src/z.ts` is handed to `resolveRestackConflict` and never accepted as a clean replay" | diff-local |
| Story 3 negative: Given no overlap between the parent's new changes and child 2's owned paths, when the restack applies, then `restack_applied` for child 2 has `parentOverlapPaths: []`. | 13 | "carries `parentOverlapPaths: []` when they do not overlap" | diff-local |
| Story 4 happy: Given a three-child stack, when a restack applies, then afterwards: `feat/c1/demo`, `feat/c2/demo`, the leaf, `closed/c1` and `closed/c2` all hold their new SHAs; `refs/conductor/demo/leaf-moved` exists; every tip equals the journal, and ancestry holds from `feat/c1/demo` to the leaf; the journal and `restack/staging/*` no longer exist. | 8, 20 | "all hold their new SHAs, every tip equals the journal, ancestry holds from `feat/c1/demo` to the leaf, the journal and every `restack/staging/*` ref no longer exist" | diff-local |
| Story 4 happy: Given a restack, when an injected failure makes any single ref's update fail, then every ref keeps its old SHA, and the journal is not `moved`. | 7 | "an injected failure on any single ref's update leaves every ref at its old SHA and the journal not `moved`" | diff-local |
| Story 4 negative: Given another process moves `feat/c2/demo` after the journal was written, when the restack tries to move the refs, then: none move; the journal is `aborted`; the run halts with `restack_refused` reason `stack-ref-changed`, naming `refs/heads/feat/c2/demo`. | 7 | "no ref moves, the journal becomes `aborted`, and `haltRestack` halts with `restack_refused` reason `stack-ref-changed` and `detail` naming `refs/heads/feat/c2/demo`" | diff-local |
| Story 4 negative: Given a lock file is held on a journaled ref for longer than the retry budget, when the restack tries to move the refs, then: none move; the journal is `aborted`; the run halts with `restack_refused` reason `lock-unavailable`, naming the lock. | 7 | "the run halts with `restack_refused` reason `lock-unavailable` and `detail` naming the lock" | diff-local |
| Story 4 negative: Given a lock is held briefly and released within the retry budget, when the restack moves the refs, then it applies. | 7 | "when the lock is released within the budget, the move applies" | diff-local |
| Story 4 negative: Given `feat/c1/demo` is checked out in another worktree and child 1's tip will change, when a restack is planned, then it is refused with reason `checked-out-elsewhere`, naming that worktree, and nothing moves. | 9 | "the restack is refused `checked-out-elsewhere` naming that worktree and nothing moves" | diff-local |
| Story 4 negative: Given post-move verification finds a tree that differs from its staging ref, when it fails, then: every ref returns to its journaled old SHA; the journal ends `aborted`; the run halts with reason `verification-failed`, naming the check. | 7 | "`rollbackRestackMove` returns every ref to its journaled old SHA, the journal ends `aborted`, and the run halts with reason `verification-failed` and `detail` naming the failed check" | diff-local |
| Story 4 negative: Given a journal already exists, when a second restack is planned (for example a CLI-triggered resume racing the daemon), then the second emits `restack_refused` with reason `restack-outstanding`, creates no journal and moves no ref, and the first completes. | 4, 31 | "the loser emits `restack_refused` with reason `restack-outstanding`, creates no journal and moves no ref, and the winner's restack completes to `applied`" | diff-local |
| Story 5 happy: Given a clean three-child stack, when a restack moves the leaf, then: `git status` is clean afterwards; the working tree equals the new leaf tip; the protected-artifact seal verifies against the new tip. | 8, 10 | "the protected-artifact seal verifies against the new tip" | diff-local |
| Story 5 happy: Given an uncommitted edit to `notes.txt`, which no change between the old and new tips touches, when a restack moves the checked-out branch, then the edit is still present and no `git stash` entry exists. | 10 | "is still present after `runRestack` moves the checked-out branch, and `git stash list` is empty" | diff-local |
| Story 5 happy: Given an untracked `tmp/out.txt` that the new tip adds as a tracked file, when the restack runs, then the untracked file is moved to the existing quarantine location and the restack applies. | 9 | "is moved into `REBASE_UNTRACKED_QUARANTINE_DIR` and the restack applies" | diff-local |
| Story 5 happy: Given the one-closed-one-active stack with `.pipeline/current-task` naming task `T3`, when a `base-refresh` restack moves child 1 and the checked-out child 2, then `current-task` still names `T3`, and its commits resolve through the rewrite map. | 19 | "leaves `current-task` naming `T3`, and `T3`'s commits resolve through the rewrite map" | diff-local |
| Story 5 negative: Given an uncommitted edit to `src/a.ts`, which changes between the checked-out branch's old and new tips, when a restack is planned, then: it is refused before any ref moves, with `restack_refused` reason `dirty-overlap` naming `src/a.ts`; the edit is untouched; no stash entry exists. | 9 | "the restack is refused before any ref moves with `restack_refused` reason `dirty-overlap` naming `src/a.ts`, the edit is untouched and `git stash list` is empty" | diff-local |
| Story 5 negative: Given an untracked `tmp/out.txt` that the new tip adds as a tracked file, and a quarantine destination that cannot be written (its directory is read-only), when a restack is planned, then it is refused before any ref moves with reason `sync-collision`, naming `tmp/out.txt`. | 9 | "with the quarantine directory read-only, the restack is refused before any ref moves with reason `sync-collision` naming `tmp/out.txt`" | diff-local |
| Story 5 negative: Given the protected-artifact seal is already violated, when a restack is planned, then it halts on the seal violation before any ref moves. | 9 | "the restack halts on the seal violation from `verifyProtectedArtifactSeal` before any ref moves" | diff-local |
| Story 5 negative: Given an ignored build-output file was modified, when a restack is planned, then it is not treated as dirty, and the restack applies. | 9 | "a modified ignored build-output file is not treated as dirty, and the restack applies" | diff-local |
| Story 6 happy: Given child 2's commit `C2` conflicts when replayed onto the new `closed/c1`, and the resolver resolves it, when the restack continues, then: the leaf is replayed onto the resolved child-2 tip; the restack applies; child 1 is not replayed again. | 15 | "the leaf is replayed onto the resolved child-2 tip, the restack applies, and a spy on `replayChildRange` records child 1 exactly once" | diff-local |
| Story 6 happy: Given a resolver hand-off, when it ends (accepted, rejected or crashed), then: no real branch moved during it; its temporary worktree no longer appears in `git worktree list`. | 14 | "its temporary worktree no longer appears in `git worktree list`" | diff-local |
| Story 6 happy: Given child 2 has a started-empty commit `E` and a commit cherry-picked to main within the default advance, when its resolver hand-off runs, then the commits it replays include `E` and exclude the cherry-picked commit, matching the clean replay's list. | 14 | "the engine-written todo includes `E` and excludes the cherry-picked commit, equal to the list `replayChildRange` applies" | diff-local |
| Story 6 happy: Given child 1's and child 2's ranges both contain halt-record commits that conflict only on `.docs/halted/demo.md`, when child 2 is replayed, then child 2's record is kept and no resolver is dispatched. | 16 | "replaying child 2 keeps child 2's record and dispatches no resolver" | diff-local |
| Story 6 negative: Given child 2's commit `C2` conflicts on `src/c.ts` and the resolver exhausts its budget, when the restack ends, then: it halts needs-human, naming child 2, `C2` and `src/c.ts`; `restack_conflict` is persisted; no child branch or closure ref moved; the journal (`aborted`) and child 2's staging ref remain until that halt is cleared. | 15, 24 | "halts needs-human naming child 2, `C2` and `src/c.ts`, persists `restack_conflict` {opId, child, commit, paths}, moves no child branch or closure ref, and leaves the journal `aborted` with child 2's staging ref present" | diff-local |
| Story 6 negative: Given a resolver result missing one of child 2's own commit subjects, when acceptance is checked, then it is rejected, and the run halts as the unresolved conflict above. | 15 | "a resolver result missing one of child 2's own commit subjects" | diff-local |
| Story 6 negative: Given a resolver result not based on the new `closed/c1`, when acceptance is checked, then it is rejected, and the run halts as the unresolved conflict above. | 15 | "or one not based on the new `closed/c1` (FR-8 with `newParent` as base), is rejected and the run halts as the unresolved conflict above" | diff-local |
| Story 6 negative: Given a resolver result changing a path child 2 never owned, when acceptance is checked, then it is rejected with reason `replay-mismatch`. | 15 | "a resolver result changing a path child 2 never owned is rejected with `restack_refused` reason `replay-mismatch`" | diff-local |
| Story 6 negative: Given a conflict touching `.docs/halted/demo.md` and `src/c.ts` together, when child 2 is replayed, then it is not resolved mechanically, and goes to the resolver. | 16 | "is not resolved mechanically and is handed to `resolveRestackConflict`" | diff-local |
| Story 7 happy: Given a crash at `planned` with child 1 replayed and its inputs unchanged, when the next resume runs, then planning continues from child 2, and child 1's new SHA is reused. | 24 | "continues planning from child 2 and reuses child 1's staging SHA" | diff-local |
| Story 7 happy: Given a crash at `ready`, when the next resume runs, then the move completes with the journaled SHAs, and no child is replayed again. | 24 | "recovery completes the move with the journaled SHAs, replays no child" | diff-local |
| Story 7 happy: Given a crash at `moved`, when the next resume runs, then the worktree is synchronised, the transition is applied once, and the journal is removed. | 24 | "after a crash at `moved`, recovery synchronises the worktree, applies the transition once and removes the journal" | diff-local |
| Story 7 happy: Given a crash at `synced`, when the next resume runs, then the transition is applied once, and the journal is removed. | 24 | "after a crash at `synced`, it applies the transition once and removes the journal" | diff-local |
| Story 7 happy: Given a crash at `rolling-back`, when the next resume runs, then every ref equals its journaled old SHA and the journal ends `aborted`. | 24 | "after a crash at `rolling-back`, every ref equals its journaled old SHA and the journal ends `aborted`" | diff-local |
| Story 7 happy: Given a leftover journal in `applied` (with no follow-on) or `aborted` (whose halt is cleared), when the next resume runs, then: the journal, staging refs and any temporary resolver worktree are removed; no `restack_recovered` event is emitted; resume continues. | 24 | "is removed with its staging refs and any temporary resolver worktree, no `restack_recovered` event is emitted, and resume continues" | diff-local |
| Story 7 happy: Given a crash at `ready`, when recovery completes the restack, then `restack_recovered` with `fromState: ready` is persisted. | 24 | "persists `restack_recovered` with `fromState: ready`" | diff-local |
| Story 7 happy: Given the feature worktree is deleted and recreated from its branch while the journal is `ready`, when the next resume runs, then the restack completes as above. | 24 | "the same outcome holds when the feature worktree was deleted and recreated from its branch" | diff-local |
| Story 7 happy: Given a journal is outstanding and closure refs have moved, when resume runs, then no divergent halt is written, and the active child is judged only after recovery. | 31 | "resume writes no divergent halt and judges the active child only after recovery" | diff-local |
| Story 7 negative: Given a crash at `planned`, after which `feat/c2/demo` moved, when resume runs, then: the journal is aborted and the staging refs are removed; no ref moves. | 24 | "when `feat/c2/demo` moved after the crash, it aborts the journal, removes the staging refs and moves no ref" | diff-local |
| Story 7 negative: Given a crash at `moved` where `src/a.ts` holds content equal to neither its old nor its new blob, when recovery syncs, then: `src/a.ts` is not overwritten; the stack is rolled back to its old SHAs; the run halts needs-human, naming `src/a.ts`. | 25 | "recovery does not overwrite `src/a.ts`, rolls the stack back to its journaled old SHAs, and halts needs-human naming `src/a.ts`" | diff-local |
| Story 7 negative: Given a crash at `ready`, after which an uncommitted edit overlapping the move appeared, when recovery runs, then the journal is aborted and nothing moves. | 25 | "recovery aborts the journal and moves no ref" | diff-local |
| Story 7 negative: Given an unreadable journal, when recovery runs, then it halts needs-human, naming the journal ref and every child branch, closure ref and staging ref of the feature with its live value. | 25 | "recovery halts needs-human naming the journal ref and every child branch, closure ref and staging ref of the feature with its live value" | diff-local |
| Story 7 negative: Given live refs matching neither the journaled old nor new SHAs (other than a checked-out branch carrying only halt-record commits past its new SHA), when recovery runs, then it halts needs-human, naming every journaled ref and its live value. | 25 | "recovery halts needs-human naming every journaled ref and its live value and moves no ref, while a checked-out branch carrying only halt-record commits past its journaled new SHA counts as the new side" | diff-local |
| Story 7 negative: Given a journal and an `applying` rebase operation record it wrote, when resume runs, then the record is not classified as interrupted until the journal is gone. | 31 | "`classifyRebaseOperation` does not classify the record as interrupted until the journal is gone" | diff-local |
| Story 7 negative: Given recovery runs twice in a row, when the second run ends, then refs, worktree and events are unchanged by it. | 24 | "leaves refs, worktree contents and `events.jsonl` unchanged by the second run" | diff-local |
| Story 7 negative: Given a crash mid-restack during a daemon re-kick, when the daemon resumes, then no second re-kick runs; only journal recovery does, and `performRebase` is never invoked. | 33 | "the next dispatch runs only journal recovery: no second re-kick runs and a spy on `performRebase` records no call" | diff-local |
| Story 7 negative: Given no journal exists, when resume runs, then no `restack_recovered` event is emitted. | 24 | "with no journal, no `restack_recovered` event is emitted" | diff-local |
| Story 8 happy: Given a stacked feature worktree with no journal and `.pipeline/co-author` set, when the engine commits a halt record, then: only `.docs/halted/demo.md` changes in the commit; the message carries the same co-author and `Task:` trailers a `git commit` at that site carries today; the commit verifies when `commit.gpgSign=true`. | 27 | "only `.docs/halted/demo.md` changes in the commit, the message carries the same co-author and `Task:` trailers a `git commit` at that site carries today, and `git verify-commit` succeeds with `commit.gpgSign=true`" | diff-local |
| Story 8 happy: Given the restack itself must halt while its journal is `moved`, when it halts, then the journal first reaches `synced` or `aborted`, and the halt record commits on the resulting HEAD. | 28 | "the journal first reaches `synced` or `aborted`, and the halt record commits on the resulting HEAD" | diff-local |
| Story 8 happy: Given the daemon writes a halt while the journal is `moved`, when the halt record is committed, then journal recovery completed first, and the record's head SHA is the post-recovery HEAD. | 28 | "journal recovery completes first and the committed record's head SHA is the post-recovery HEAD" | diff-local |
| Story 8 negative: Given the daemon's halt-record supersede read HEAD, then the restack moved the branch, then the supersede commits, when the supersede finishes, then it has failed, and the branch still holds the restacked tree. | 28 | "the supersede has failed and the branch still holds the restacked tree" | diff-local |
| Story 8 negative: Given the journal is `ready`, `moved` or `rolling-back`, when any engine commit is attempted in the feature worktree, then it is refused, and HEAD is unchanged. | 26, 27 | "when the journal is `ready`, `moved` or `rolling-back`, `commitEngineChange` refuses and HEAD is unchanged" | diff-local |
| Story 8 negative: Given staged changes outside the committing site's own paths, when the engine commits, then the commit contains only the site's own paths, the stray changes stay staged and uncommitted, and the commit is not blocked. | 26 | "the commit contains only the site's own paths, the stray changes stay staged and uncommitted in the worktree index, and the commit is not blocked" | diff-local |
| Story 8 negative: Given setup-triage captured a repair touching `a.txt` and `b/c.txt` in a stacked worktree, when it commits the repair, then exactly those paths are committed, and the commit is not refused. | 27 | "its retained-repair commit contains exactly those paths and is not refused" | diff-local |
| Story 8 negative: Given halt-time recovery itself fails, when the halt is written, then the journal ends `aborted`, and exactly one halt is written. | 28 | "the journal ends `aborted`, recovery is not re-entered, and exactly one halt is written" | diff-local |
| Story 9 happy: Given a three-child stack in which the operator committed `X` on `feat/c1/demo` past `closed/c1`, when the next daemon dispatch or conductor resume runs, then: a `feature-repair` restack moves `closed/c1` to `X`; child 2 and the leaf are replayed onto it; no needs-human halt is written. | 31 | "both the next daemon dispatch and a conductor resume run a `feature-repair` restack (moving `closed/c1` to `X` and replaying child 2 and the leaf)" | diff-local |
| Story 9 happy: Given that state before the restack runs, when `consumeResumeAuthorizations`, `kickback-budget` inspection, `task` or `rewind` reads the active child, then: they report the active child; none throws; none moves a ref or starts a restack (`kickback-budget raise` or `reset --gate restack` updates `cascades` by design; see Story 13). | 29 | "(`consumeResumeAuthorizations`, `kickback-budget inspect` and default-child resolution, `task`, and the `rewind` refusal) report the active child, none throws, and a mocked git runner records no `update-ref` and no journal write from any of them" | diff-local |
| Story 9 happy: Given an operator commit on a closed child and a default advance at the same resume, when it runs, then a `feature-repair` restack applies first, and a `base-refresh` restack second, with distinct opIds. | 30 | "applies a `feature-repair` restack first and a `base-refresh` restack second with distinct opIds" | diff-local |
| Story 9 happy: Given the operator committed `X` from another worktree that still has `feat/c1/demo` checked out, when the repair runs, then it applies. | 30 | "also applies when `X` was committed from another worktree that still has `feat/c1/demo` checked out" | diff-local |
| Story 9 happy: Given the operator's `X` is followed by a halt-record commit on `feat/c1/demo`, when the repair runs, then `closed/c1` moves to the halt-record commit, which includes both. | 30 | "when `X` is followed by a halt-record commit, `closed/c1` moves to that halt-record commit" | diff-local |
| Story 9 negative: Given the operator amended `A2` on a closed child, so the branch no longer contains `closed/c1`, when resume runs, then: no restack runs; it halts needs-human, with `restack_refused` reason `closed-child-rewritten`, naming child 1. | 30 | "no restack runs and the preflight halts needs-human with `restack_refused` reason `closed-child-rewritten` naming child 1" | diff-local |
| Story 9 negative: Given the operator reset `feat/c1/demo` behind `closed/c1`, when resume runs, then it halts as `closed-child-rewritten`, and `closed/c1` is unchanged. | 30 | "or with `feat/c1/demo` reset behind `closed/c1`, no restack runs and the preflight halts needs-human with `restack_refused` reason `closed-child-rewritten` naming child 1, leaving `closed/c1` unchanged" | diff-local |
| Story 9 negative: Given commits past `closed/c1` touching only `.docs/halted/demo.md`, when resume runs, then no repair runs. | 30 | "with commits past `closed/c1` touching only `.docs/halted/demo.md`, no repair runs" | diff-local |
| Story 9 negative: Given a refused repair (cap, dirty overlap or conflict) while a base refresh was also due, when the resume ends, then `restack_refused` with reason `deferred-base-refresh` is persisted, and no base-refresh restack ran. | 30 | "`restack_refused` with reason `deferred-base-refresh` is persisted and no base-refresh restack ran" | diff-local |
| Story 9 negative: Given the repair applied but the follow-on base refresh is refused (for example `checked-out-elsewhere`), when the resume ends, then `restack_refused` with reason `deferred-base-refresh` is persisted. | 30 | "when the repair applied but the follow-on is refused (`checked-out-elsewhere`), `restack_refused` with reason `deferred-base-refresh` is persisted" | diff-local |
| Story 9 negative: Given a parked feature with commits appended past `closed/c1`, when the daemon's dispatch considers it, then no restack runs and no ref moves. | 31 | "the daemon dispatch runs no restack and moves no ref" | diff-local |
| Story 9 negative: Given the repair reached `applied` and the process died before the base refresh started, when the next resume runs, then the base-refresh restack runs. | 30 | "when the process died after the repair reached `applied`, the next preflight runs the base-refresh restack" | diff-local |
| Story 9 negative: Given the repair's journal is `applied` with a pending follow-on, when an unrelated restack is planned, then it is refused `restack-outstanding`, and the follow-on still runs. | 30 | "an unrelated restack planned against it is refused `restack-outstanding`, and the follow-on still runs to `applied`" | diff-local |
| Story 9 negative: Given `rewind --child 1` on a closed child, when it runs, then it is refused with a message naming #2944. | 29 | "`rewind --child 1` on a closed child is refused with a message naming `#2944`" | diff-local |
| Story 10 happy: Given a three-child stack and a default advance, when the FINISH `rebase` step runs, then: a `base-refresh` restack moves child 1 onto `B'` and restacks child 2 and the leaf; the `rebase` step verdict's operation carries `cause: 'base-refresh'` and the whole-stack tuple: P = old leaf tip, B = `merge-base(old c1, B)`, O = `B'`, H = new leaf tip. | 32 | "the `rebase` step verdict's operation carries `cause: 'base-refresh'` and the whole-stack tuple P = old leaf tip, B = `merge-base(old c1, B)`, O = `B'`, H = new leaf tip" | diff-local |
| Story 10 happy: Given the one-closed-one-active stack mid-build and a default advance, when the daemon re-kicks the feature, then: a `base-refresh` restack moves child 1 and the active child 2; no `rebase_skipped_for_stack` event is emitted. | 33 | "runs a `base-refresh` restack that moves child 1 and the active child 2, emits no `rebase_skipped_for_stack` event" | diff-local |
| Story 10 happy: Given `B'` is already an ancestor of `feat/c1/demo`, when the FINISH step or a re-kick runs, then no ref moves. | 33 | "neither the FINISH step nor the re-kick moves any ref" | diff-local |
| Story 10 happy: Given a `base-refresh` restack applies, when the events are read, then `rebase_changed` is persisted with the whole-stack delta from `B` to `B'`, so base-caused test failures stay attributed to the base advance. | 32 | "`rebase_changed` is persisted with the whole-stack delta from `B` to `B'`" | diff-local |
| Story 10 happy: Given the leaf PR is mergeable and the base delta does not touch the feature's review inputs, when the FINISH step runs, then the existing mergeable-skip applies. | 32 | "`classifyMergeableSkip` applies the existing mergeable-skip and no restack runs" | diff-local |
| Story 10 negative: Given a stacked feature, when the FINISH step or a re-kick runs, then no single-branch rebase runs on any child branch or the leaf. | 33 | "records no single-branch `rebase` of any child branch or the leaf from either the FINISH step or the re-kick" | diff-local |
| Story 10 negative: Given a re-kick whose restack is refused for `dirty-overlap`, when the re-kick ends, then it halts needs-human naming the paths, and does not skip silently. | 33 | "`resumeRebaseFirst` returns `halted` with a needs-human HALT naming the paths and does not skip silently" | diff-local |
| Story 10 negative: Given a feature with no durable child state, when the FINISH step or a re-kick runs, then today's rebase runs, and its result, verdict and events match today's (pinned config aside). | 39 | "are byte-identical to their committed fixtures, with today's rebase result, `rebase` step verdict and events" | diff-local |
| Story 10 negative: Given a stacked FINISH, when publication runs, then no `feat/c<k>/demo` branch is pushed. | 34 | "the publication path pushes no `feat/c<k>/demo` branch" | diff-local |
| Story 10 negative: Given a stacked feature's published leaf PR has a merge conflict with `origin/main`, when the mergeable sweep's autoresolve reaches it, then: no replay or push runs; it escalates to a human; `restack_refused` with reason `published-stack`, naming #2945, is persisted. | 34 | "runs no replay or push (the mocked git and remote boundaries record no `rebase`, `merge-tree` or `push`), escalates to a human through `escalate`, and persists `restack_refused` with reason `published-stack` and `detail` naming `#2945`" | diff-local |
| Story 11 happy: Given a restack moves the active child 2 with an unchanged replay, when the transition runs, then child 2's passed region gates stay passed in `.pipeline/children/2/`. | 18 | "keeps child 2's passed region gates passed in `.pipeline/children/2/`" | diff-local |
| Story 11 happy: Given a restack moves the active child 2, and the new parent's changes intersect a passed region gate's inputs, when the transition runs, then that gate is invalidated in `.pipeline/children/2/`, and no flat region verdict is written. | 18 | "that gate is invalidated in `.pipeline/children/2/` and no flat region verdict is written under `.pipeline/gates/`" | diff-local |
| Story 11 happy: Given a restack moves closed child 1, when it applies, then: child 1's verdict files and closure position are unchanged; `restack_applied` for child 1 lists, in `wouldInvalidate`, the gates the same policy would invalidate. | 18 | "child 1's verdict files and closure position are byte-identical before and after, `restack_applied` for child 1 carries a non-empty `wouldInvalidate` listing those gates" | diff-local |
| Story 11 happy: Given a restack moves a child whose commits carry evidence stamps and `task-status` commits, when it applies, then evidence stamps, task-status commits, the retained RED proof and `provenanceHeadSha` resolve to the new SHAs. | 19 | "evidence stamps, `task-status` commits, the retained RED proof and `provenanceHeadSha` resolve to the new SHAs" | diff-local |
| Story 11 happy: Given a `feature-repair` restack whose originating commit `X` changes a path in the leaf's review inputs, when whole-feature and leaf gates are re-judged, then the gates whose inputs include that path are invalidated, even though the default branch did not move. | 18 | "the whole-feature and leaf gates whose inputs include that path are invalidated even though the default branch did not move" | diff-local |
| Story 11 happy: Given a `feature-repair` restack whose commit `X` changes only paths outside every passed gate's inputs, when the gates are re-judged, then they stay passed. | 18 | "when `X` changes only paths outside every passed gate's inputs they stay passed" | diff-local |
| Story 11 negative: Given a restack leaves the leaf in place while the last intermediate child has just closed, when the cursor checks for a pending leaf move, then the leaf move is still reported pending. | 20 | "`resolveActiveChild` still reports `leafMovePending: true` although `.pipeline/rebase-rewrites.json` is present" | diff-local |
| Story 11 negative: Given a `feature-repair` restack, when whole-feature gates are re-judged, then the base used is the unchanged old default, not a freshly fetched `origin/main`. | 18 | "the whole-feature tuple uses the unchanged old default tip as its base, and a mocked git boundary records no `fetch` of `origin/main` during the re-judgement" | diff-local |
| Story 11 negative: Given a closed child with a non-empty `wouldInvalidate`, when the feature continues, then no region gate of that closed child is re-run in this feature. | 18 | "no region gate of child 1, including every gate listed in `wouldInvalidate`, is re-run in this feature" | diff-local |
| Story 11 negative: Given a `feature-repair` restack that moves only child 2 and the leaf, when `rebase-rewrites.json` is read, then it has no entry for any child-1 or default-branch commit. | 19 | "`rebase-rewrites.json` has no entry for any child-1 or default-branch commit" | diff-local |
| Story 12 happy: Given a `base-refresh` restack invalidates the active child's `build_review`, when the transition runs, then `build_review` convergence laps are credited once in that child's ledger for that opId. | 21 | "credits its convergence laps once in that child's ledger with the restack's opId as receipt" | diff-local |
| Story 12 happy: Given an N=1 feature whose rebase invalidates `build_review`, when the transition runs, then the refund equals today's, and the operation record has no `cause` field. | 21 | "the refund equals today's and the operation record in `.pipeline/gates/rebase.json` has no `cause` field" | diff-local |
| Story 12 negative: Given a `feature-repair` restack invalidates the active child's `build_review`, when the transition runs, then: no laps are credited; the operation record carries `cause: 'feature-repair'`. | 21 | "no laps are credited and the operation record carries `cause: 'feature-repair'`" | diff-local |
| Story 12 negative: Given the same `base-refresh` transition is applied twice by recovery, when the second application runs, then no second credit is written. | 21 | "applying `applyRestackTransition` twice with the same opId writes no second credit" | diff-local |
| Story 12 negative: Given a `feature-repair` restack, when the step tail runs, then the legacy rebase-step refund does not credit laps. | 21 | "`advanceTail`'s legacy rebase-step refund credits no laps" | diff-local |
| Story 13 happy: Given child 1 has originated 2 applied `feature-repair` restacks, when a third applies, then child 1's cascade count in `refs/conductor/demo/cascades` is 3. | 22 | "`refs/conductor/demo/cascades` records child 1's count as 3" | diff-local |
| Story 13 happy: Given `base-refresh` restacks and aborted restacks, when they finish, then no cascade count changes. | 22 | "`base-refresh` restacks and aborted restacks change no count" | diff-local |
| Story 13 happy: Given the cascade-cap halt for child 1, when the operator runs `kickback-budget raise --gate restack --child 1`, then: the raised limit is stored in `refs/conductor/demo/cascades`; the next resume runs the repair. | 31.2 | "`kickback-budget raise --gate restack --child 1` stores the raised limit in `refs/conductor/demo/cascades` and the next daemon dispatch's stack preflight runs the repair" | diff-local |
| Story 13 happy: Given the cascade-cap halt for child 1, when the operator runs `kickback-budget reset --gate restack --child 1`, then child 1's count is 0, and the next resume runs the repair. | 31.2 | "`kickback-budget reset --gate restack --child 1` sets child 1's count to 0 and the next resume runs the repair" | diff-local |
| Story 13 happy: Given the worktree is recreated, when the counts are read, then they are unchanged. | 22 | "`readCascadeCounts` returns unchanged counts" | diff-local |
| Story 13 negative: Given child 1 has originated 3 applied `feature-repair` restacks, when a fourth repair is due, then: no journal is created and no `restack_planned` event is emitted; it halts with `HALT.class` `needs-human`, naming child 1; the active child's ledger holds cap evidence for gate `restack`, with allowance `restacks`, naming child 1. | 22 | "no journal is created, no `restack_planned` is emitted, `HALT.class` is `needs-human` naming child 1, and the active child's ledger holds cap evidence for gate `restack` with allowance `restacks` naming child 1" | diff-local |
| Story 13 negative: Given no live cascade-cap halt and no `restack` cap evidence, when `kickback-budget reset --gate restack --child 1` runs, then it is refused, and the ref is unchanged. | 31.2 | "`kickback-budget reset --gate restack --child 1` is refused and the `cascades` ref is unchanged" | diff-local |
| Story 13 negative: Given the cascade-cap halt for child 1 and a recreated worktree with no `.pipeline/children/1/`, when `kickback-budget raise --gate restack --child 1` runs, then it is accepted, because `--child` is validated against the `cascades` ref. | 31.2 | "`kickback-budget raise --gate restack --child 1` is accepted, because `--child` is validated against the `cascades` ref" | diff-local |
| Story 13 negative: Given the `cascades` blob is unreadable or malformed, when a repair is due, then the cap counts as exhausted, and it halts needs-human naming the unreadable ref. | 22 | "an unreadable or malformed `cascades` blob counts as an exhausted cap, and the repair halts needs-human naming the unreadable `refs/conductor/demo/cascades` ref" | diff-local |
| Story 13 negative: Given cap evidence for child 1, when `kickback-budget raise --gate restack --child 2` runs, then it is refused, and the ref is unchanged. | 31.2 | "`kickback-budget raise --gate restack --child 2` is refused and the ref is unchanged" | diff-local |
| Story 13 negative: Given the CLI's update to `cascades` loses a race with a concurrent write, when it ends, then it has failed, no resume authorization is staged, and the concurrent write is kept. | 31.2 | "the command fails, no resume authorization is staged, and the concurrent write is kept" | diff-local |
| Story 13 negative: Given repairs originate from child 1 and child 2 alternately, when counts are read, then each child's count reflects only the restacks it originated, and the leaf's count is 0. | 22 | "with repairs originating from child 1 and child 2 alternately each count reflects only that child's restacks and the leaf's count is 0" | diff-local |
| Story 14 happy: Given an engine push of `feat/daemon-demo` succeeds, plain or forced, when it completes, then `refs/conductor/demo/pushed/feat/daemon-demo` holds the pushed SHA, and no intent remains. | 35 | "`refs/conductor/demo/pushed/feat/daemon-demo` holds the pushed SHA and no intent remains" | diff-local |
| Story 14 happy: Given the recorded tip equals the remote tip `R`, when the post-rebase draft refresh force-pushes, then: it fetches only `feat/daemon-demo` first; it pushes with an expected SHA of `R`; it succeeds and records the new tip. | 37 | "the post-rebase draft refresh fetches only `feat/daemon-demo` first, pushes with an expected SHA of `R`, succeeds and records the new tip" | diff-local |
| Story 14 happy: Given a human pushed `H` and ci-fix built its HEAD on `H`, when ci-fix force-pushes, then the push succeeds. | 37 | "ci-fix's force push through `pushRefreshedBranch` succeeds" | diff-local |
| Story 14 happy: Given a feature in flight before this change (no recorded tip), whose remote tip equals the tracking ref captured before the fetch, when it force-pushes, then the push succeeds and a tip is recorded. | 36 | "with no recorded tip and a remote tip equal to the tracking ref captured before the fetch, the helper pushes with `--force-with-lease=refs/heads/feat/daemon-demo:<R>`, succeeds and records a tip" | diff-local |
| Story 14 happy: Given the push succeeded remotely but recording the tip failed, when the next force push runs, then it treats the intended new SHA as the recorded tip, and proceeds. | 36 | "the next force push treats the intended new SHA as the recorded tip and proceeds" | diff-local |
| Story 14 happy: Given shipped-record teardown, or the single-slug reclaim helper, runs for `demo`, when it completes, then each recorded `pushed/` ref, the intent, `cascades`, `leaf-moved`, and the journal and staging refs are deleted by explicit name. No glob delete is used. | 38 | "each recorded `pushed/` ref, the intent, `cascades`, `leaf-moved`, the journal and its staging refs are deleted, and the mocked git boundary received only explicit-name `delete <ref>` lines with no glob and no `for-each-ref`" | diff-local |
| Story 14 negative: Given a recorded tip `R1`, and another worktree's full fetch advanced `origin/feat/daemon-demo` to a human's `R2` (not an ancestor of HEAD), when autoresolve force-pushes, then: it is refused and the remote is unchanged; `push_lease_refused` {expected `R1`, actual `R2`} is persisted; autoresolve escalates with the refusal as the reason. | 37 | "autoresolve's force push is refused and the remote is unchanged, `push_lease_refused` {expected `R1`, actual `R2`} is persisted, and autoresolve escalates with the refusal as the reason" | diff-local |
| Story 14 negative: Given the same remote state, when halt-record publication force-pushes, then it is refused, `push_lease_refused` and `halt_record_push_failed` are persisted, the halt-record commit is kept, and the halt path does not fail. | 37 | "halt-record publication is refused, `push_lease_refused` and `halt_record_push_failed` are persisted, the halt-record commit is kept, and the halt path does not fail" | diff-local |
| Story 14 negative: Given the same remote state, when the draft refresh, ci-fix or halt-record publication force-pushes, then each is refused in the same way. | 37 | "the draft refresh, ci-fix and halt-record publication are each refused in the same way" | diff-local |
| Story 14 negative: Given no recorded tip and a remote tip that differs from the pre-fetch tracking ref and is not an ancestor of HEAD, when a force push runs, then it is refused. | 36 | "with no recorded tip and a remote tip that differs from the pre-fetch tracking ref and is not an ancestor of HEAD, the helper refuses without pushing" | diff-local |
| Story 14 negative: Given the single-branch fetch or the remote read fails, when a force push is due, then: no push is attempted, and no `pushed/` ref changes; halt-record publication emits `halt_record_push_failed`, keeps the commit and does not fail the halt path; the draft refresh logs a loud failure naming the ref, and the build continues; autoresolve and ci-fix escalate with the failure as the reason. | 36, 37 | "halt-record publication emits `halt_record_push_failed`, keeps the commit and does not fail the halt path, the draft refresh logs a loud failure naming the ref and the build continues, autoresolve and ci-fix escalate with the failure as the reason" | diff-local |
| Story 14 negative: Given no recorded tip and no tracking ref, when a force push is due, then it is refused, naming the missing tracking ref. | 36 | "with no recorded tip and no tracking ref, it refuses naming the missing tracking ref" | diff-local |
| Story 14 negative: Given a refused or failed push, when it ends, then no intent remains. | 36 | "after any refused or failed push no intent remains" | diff-local |
| Story 14 negative: Given an engine push to a non-feature ref, when it succeeds, then no `pushed/` ref is written. | 35 | "after a successful engine push to a non-feature ref, no `pushed/` ref is written" | diff-local |
| Story 14 negative: Given teardown ran for `demo` and a new feature reuses slug `demo`, when it first force-pushes, then it takes the no-record path, and its cascade counts start at 0. | 38 | "a new feature reusing slug `demo` takes the no-record path on its first force push, and its cascade counts start at 0" | diff-local |
| Story 14 negative: Given an explicit-SHA force push, when the engine's `pre-push` hook runs, then it passes. | 37 | "the installed engine `pre-push` hook passes for that explicit-SHA push" | diff-local |
| Story 15 happy: Given a restack that applies, when `.pipeline/events.jsonl` is read, then it contains: `restack_planned` {opId, cause, children}; then one `restack_applied` per moved child, each carrying `opId`, `cause`, `child`, `oldTip`, `newTip`, `wouldInvalidate` and `parentOverlapPaths`. | 8 | "`.pipeline/events.jsonl` contains `restack_planned` {opId, cause, children} followed by one `restack_applied` per moved child, each carrying `opId`, `cause`, `child`, `oldTip`, `newTip`, `wouldInvalidate` and `parentOverlapPaths`" | diff-local |
| Story 15 happy: Given a recovery, when it completes, then `restack_recovered` {opId, fromState} is persisted. | 24, 2 | "persists `restack_recovered` with `fromState: ready`" | diff-local |
| Story 15 happy: Given any restack refusal, when it occurs, then `restack_refused` carries one of the reasons ADR decision 12 enumerates, and carries `child` whenever a child is named. | 2, 7 | "`restack_refused` carries one of exactly the 14 reasons" | diff-local |
| Story 15 happy: Given a conflict halt, when it is written, then `restack_conflict` {opId, child, commit, paths} is persisted. | 15 | "persists `restack_conflict` {opId, child, commit, paths}" | diff-local |
| Story 15 negative: Given a feature with no durable child state, when it runs FINISH, re-kick and resume, then: #3019's N=1 golden suite is byte-identical; no `restack_*` event is emitted; no `refs/conductor/<slug>/` ref other than `pushed/` and its intent is written. | 39 | "no `restack_*` event is emitted, and no `refs/conductor/<slug>/` ref other than `pushed/` and its intent exists after the run" | diff-local |
| Story 15 negative: Given a feature with no durable child state, when a force push is refused, then `push_lease_refused` is its only new event. | 39 | "`push_lease_refused` is the only new event type relative to today's fixture" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | task | task-3, task-39 | no `restack_*` event is emitted, and no `refs/conductor/<slug>/` ref other than `pushed/` and its intent exists after the run |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | task | task-5, task-20, task-11, task-16 | an unentered leaf whose tip `H` lies inside child 1's own range is planned to move to `H`'s rewrite |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | task | task-6, task-11, task-12, task-13 | `checkPathOwnership` accepts a replay whose `diff --no-renames --name-only newParent newTip` is a subset of the owned paths |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | task | task-4, task-26, task-27, task-28, task-7, task-22, task-24 | moves HEAD with `update-ref HEAD <new> <old>` using the HEAD it read before staging |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | task | task-7, task-9, task-10, task-25, task-19 | in one `update-ref --stdin` transaction |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-14, task-15, task-17, task-19 | `.pipeline/rebase-rewrites.json` maps child 2's commits to the resolved commits taken from rebase's rewritten list |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | task | task-24, task-29, task-30, task-31, task-31.1, task-25 | whose phases run in order (journal recovery, then the halt-record supersede and `consumeResumeAuthorizations`, then the repair) |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | task | task-18, task-19, task-20, task-32, task-33 | keeps child 2's passed region gates passed in `.pipeline/children/2/` |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | task | task-30, task-32, task-33, task-34, task-29 | runs a `base-refresh` restack that moves child 1 and the active child 2, emits no `rebase_skipped_for_stack` event |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | task | task-21, task-22, task-31.2 | `checkCascadeCap` refuses before `createRestackJournal` |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | task | task-35, task-36, task-37, task-38 | none of the four callers passes a bare `--force-with-lease` to `executeRemoteGit` |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | task | task-2, task-24, task-32, task-21, task-33, task-39 | `EVENT_SINKS` declares `restack_planned`, `restack_applied`, `restack_conflict`, `restack_refused`, `restack_recovered` and `push_lease_refused` with `persist: true` |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | task | task-39, task-24, task-28, task-6, task-7, task-9, task-11, task-12, task-13, task-16, task-25 | pins updated per-site counts that classify every new restack writer as `child-aware` or `whole-feature-only` |
| adr-2026-06-29-rebase-conflict-resolution-dispatch#D1 | task | task-15 | (FR-9 over `oldParent..ORIG_HEAD`) |
| adr-2026-06-29-rebase-conflict-resolution-dispatch#D2 | task | task-14 | the engine-written todo includes `E` and excludes the cherry-picked commit, equal to the list `replayChildRange` applies |
| adr-2026-07-03-post-rebase-force-with-lease#D1 | task | task-35, task-36, task-37 | pushes with an expected SHA of `R` |
| adr-2026-07-03-post-rebase-force-with-lease#D2 | existing | none | Other early-draft pushes stay plain: `openShipDraftPr` pushes `HEAD:refs/heads/<branch>` without a lease unless `pushMode === 'lease'` (src/conductor/src/engine/ship-draft-pr.ts); #2943 changes only the lease branch |
| adr-2026-07-03-post-rebase-force-with-lease#D3 | no-change | none | No new push is added during a paused rebase or rebase-conflict HALT; the stacked restack never pauses a rebase in the feature worktree, and the halt-record push tension is an operator-accepted degrading conflict in the conflict report |
| adr-2026-07-03-post-rebase-force-with-lease#D4 | no-change | none | ADR-001 rebase detection and the satisfied predicate are not touched by this feature |
| adr-2026-07-03-post-rebase-force-with-lease#D5 | task | task-36, task-37 | no bare `--force-with-lease` reaches `executeRemoteGit` |
| adr-2026-07-12-rebase-evidence-stamp-translation#D1 | task | task-19 | `.pipeline/rebase-rewrites.json` maps child 2's commits to the resolved commits taken from rebase's rewritten list |
| adr-2026-07-12-rebase-evidence-stamp-translation#D2 | task | task-19 | evidence stamps, `task-status` commits, the retained RED proof and `provenanceHeadSha` resolve to the new SHAs |
| adr-2026-07-12-rebase-evidence-stamp-translation#D3 | existing | none | Read-time trailer resolution through `resolveThroughMap` in src/conductor/src/engine/rebase-translate.ts; unchanged |
| adr-2026-07-12-rebase-evidence-stamp-translation#D4 | task | task-19 | a dropped commit that evidence still cites appears in a persisted `rebase_citation_residue` event |
| adr-2026-07-12-rebase-evidence-stamp-translation#D5 | existing | none | No-laundering substitution in `resolveThroughMap` (src/conductor/src/engine/rebase-translate.ts) substitutes only mapped SHAs; unchanged |
| adr-2026-07-12-rebase-evidence-stamp-translation#D6 | task | task-19 | repair-obligation baselines resolve through it, directly or to the nearest surviving successor, and `repair_boundary_translated` is persisted |
| adr-2026-07-12-rebase-evidence-stamp-translation#D7 | task | task-19 | directly or to the nearest surviving successor |
| adr-2026-07-12-rebase-evidence-stamp-translation#D8 | task | task-19 | `repair_boundary_translated` is persisted |
| adr-2026-07-12-rebase-evidence-stamp-translation#D9 | existing | none | The read-time fallback in src/conductor/src/engine/autoheal.ts remains a fallback; unchanged |
| adr-2026-07-12-rebase-evidence-stamp-translation#D10 | existing | none | Absorption pairs recorded in `FlattenedReplayPlan.absorptionPoints` (src/conductor/src/engine/rebase.ts) for the N=1 flattened path; unchanged |
| adr-2026-07-23-build-review-fresh-base-disposition#D1 | task | task-18 | `resolveChildBase` for child 2 returns the restacked `closed/c1` tip as child 2's fresh base |
| adr-2026-07-23-build-review-fresh-base-disposition#D2 | task | task-18 | the `build_review` fresh-base disposition issues no rebase |
| adr-2026-07-23-build-review-fresh-base-disposition#D3 | existing | none | Base-freshness evidence produced by `resolveFreshBase` (`FreshBaseResolution` with `trackingRefSha`/`remoteHeadSha`) in src/conductor/src/engine/rebase.ts; unchanged |
| adr-2026-07-26-protected-artifact-seal-rebaseline#D1 | existing | none | Unevaluable-seal trigger in `evaluateProtectedArtifactSealRotation` (src/conductor/src/engine/protected-artifact-seal.ts); unchanged |
| adr-2026-07-26-protected-artifact-seal-rebaseline#D2 | existing | none | Rotation permission in `evaluateProtectedArtifactSealRotationInRepository` (src/conductor/src/engine/protected-artifact-seal.ts); unchanged |
| adr-2026-07-26-protected-artifact-seal-rebaseline#D3 | task | task-9, task-10 | because it was verified before the move and rotated by `rotateProtectedArtifactSeal` after the sync |
| adr-2026-07-26-protected-artifact-seal-rebaseline#D4 | existing | none | Seal lineage written by `rotateProtectedArtifactSeal` (src/conductor/src/engine/protected-artifact-seal.ts); unchanged |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D1 | no-change | none | #2943 adds no reap to the runner's happy path |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D2 | existing | none | The mergeable sweep owns the reap through `teardownWorktree` in src/conductor/src/engine/mergeable-sweep.ts; Task 38 adds ref deletion beside it without moving it |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D3 | no-change | none | The reap gate (file presence on `origin/main`) is not touched by #2943 |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D4 | no-change | none | MERGED versus CLOSED-unmerged handling in the sweep is not touched by #2943 |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D5 | no-change | none | Retain/reap log lines are not touched by #2943 |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D6 | task | task-38 | the mocked git boundary received only explicit-name `delete <ref>` lines with no glob and no `for-each-ref` |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D7 | task | task-38 | does not alter the worktree reap or reclaim decision, and a re-run deletes the remaining refs |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D8 | task | task-38 | after the single-slug reclaim helper `reconcileMergedPark` runs for `demo` |
| adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main#D9 | existing | none | Retention reasons emitted as `worktree_reclaim_retained` (src/conductor/src/types/events.ts, src/conductor/src/engine/park-reconciliation.ts); unchanged |
| adr-2026-07-29-ship-start-draft-pr#D1 | existing | none | One ship-start draft PR via `openShipDraftPr` (src/conductor/src/engine/ship-draft-pr.ts); unchanged |
| adr-2026-07-29-ship-start-draft-pr#D2 | existing | none | `openShipDraftPr` (src/conductor/src/engine/ship-draft-pr.ts) calls `findOrCreatePr` (src/conductor/src/engine/pr-labels.ts), whose draft create goes through `executeGithubOperation` with `draft: true`; unchanged |
| adr-2026-07-29-ship-start-draft-pr#D3 | task | task-37 | the post-rebase draft refresh fetches only `feat/daemon-demo` first |
| adr-2026-07-29-ship-start-draft-pr#D4 | existing | none | Lazy `rev-list --count` check in `openShipDraftPr` (src/conductor/src/engine/ship-draft-pr.ts); unchanged |
| adr-2026-07-29-ship-start-draft-pr#D5 | existing | none | Advisory `[ship-draft-pr]` log-and-return failures in src/conductor/src/engine/ship-draft-pr.ts; the lease refusal keeps that handling |
| adr-2026-07-29-ship-start-draft-pr#D6 | existing | none | Idempotent lookup in `findOrCreatePr` (src/conductor/src/engine/pr-labels.ts) returns an already-OPEN PR untouched, plus the per-run latch in src/conductor/src/engine/ship-draft-pr.ts; unchanged |
| adr-2026-07-29-ship-start-draft-pr#D7 | existing | none | Draft-to-ready flip by `ensureShipReady` (src/conductor/src/engine/halt-pr-rehabilitation.ts); unchanged |
| adr-2026-07-29-ship-start-draft-pr#D8 | existing | none | Placeholder body carries `PR_BODY_FLOOR_MARKER` (src/conductor/src/engine/ship-draft-pr.ts); unchanged |
| adr-2026-07-29-ship-start-draft-pr#D9 | no-change | none | Self-host ready-for-review precedence is not touched by #2943 |
| adr-2026-08-13-durable-base-advance-attribution#D1 | task | task-32, task-21 | a `feature-repair` restack persists no `rebase_changed` event |
| adr-2026-08-13-durable-base-advance-attribution#D2 | existing | none | Attribution join with path overlap in `resolveBaseAdvanceForFailure` and `diagnosticOverlapsBaseAdvance` (src/conductor/src/engine/test-suite-remediation.ts); unchanged |
| adr-2026-08-13-durable-base-advance-attribution#D3 | existing | none | Gate-agnostic history read by `readBaseAdvanceHistory` (src/conductor/src/engine/test-suite-remediation.ts); unchanged |
| adr-2026-08-13-durable-base-advance-attribution#D4 | existing | none | Grading provenance rides the existing `build_review_repair_context` event (src/conductor/src/types/events.ts); unchanged |
| adr-2026-08-13-durable-base-advance-attribution#D5 | no-change | none | Evidence-not-exemption is a policy constraint; #2943 adds no exemption |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D1 | existing | none | No convergence counter is cleared on `build_review` PASS (no reset path in src/conductor/src/engine/kickback-ledger.ts); unchanged |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D2 | task | task-21 | no laps are credited and the operation record carries `cause: 'feature-repair'` |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D3 | task | task-21 | exactly one `kickback` event with `convergenceCredit: {gate: 'build_review'}` is persisted |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D4 | no-change | none | #2943 adds no config switch for refunds |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D5 | existing | none | Credit applied only to `ledger.gates.build_review` in `creditBuildReviewConvergence` (src/conductor/src/engine/rebase-transition.ts); unchanged |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D6 | existing | none | Entry-wide rule in `creditKickbackGateLaps` (src/conductor/src/engine/kickback-ledger.ts); unchanged |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D1 | task | task-29 | `rewind --child 1` on a closed child is refused with a message naming `#2944` |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D2 | existing | none | Demotions through `ConductStateStore` mutations in `rewindChildState` (src/conductor/src/engine/rewind.ts); unchanged |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D3 | task | task-29 | `rewind --child 1` on a closed child is refused with a message naming `#2944`, and exits non-zero |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D4 | existing | none | Verdict and HALT clear via `clearHaltAtomically` (src/conductor/src/engine/rewind.ts); unchanged |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D5 | existing | none | `operator_rewind` event (src/conductor/src/types/events.ts); unchanged |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D6 | existing | none | Operator-only entry through `detectRewindCommand` (src/conductor/src/index.ts, src/conductor/src/engine/rewind.ts); unchanged |
| adr-2026-08-23-committed-halt-record#D1 | task | task-27 | for `recordHalt` (a `--no-verify` site) `prepare-commit-msg` runs and `pre-commit` and `commit-msg` do not |
| adr-2026-08-23-committed-halt-record#D2 | task | task-28 | journal recovery completes first and the committed record's head SHA is the post-recovery HEAD |
| adr-2026-08-23-committed-halt-record#D3 | existing | none | `isRecordableHaltClass` excludes mechanical halts (src/conductor/src/engine/halt-record.ts); unchanged |
| adr-2026-08-23-committed-halt-record#D4 | task | task-28 | the journal first reaches `synced` or `aborted`, and the halt record commits on the resulting HEAD |
| adr-2026-08-23-committed-halt-record#D5 | task | task-27, task-37 | halt-record publication is refused, `push_lease_refused` and `halt_record_push_failed` are persisted, the halt-record commit is kept, and the halt path does not fail |
| adr-2026-08-23-committed-halt-record#D6 | task | task-37 | halt-record publication emits `halt_record_push_failed`, keeps the commit and does not fail the halt path |
| adr-2026-08-23-committed-halt-record#D7 | task | task-27, task-28 | the supersede has failed and the branch still holds the restacked tree |
| adr-2026-08-23-committed-halt-record#D8 | existing | none | `halt_record_written`/`halt_record_push_failed` events (src/conductor/src/types/events.ts); unchanged |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D1 | task | task-22 | `HALT.class` is `needs-human` naming child 1 |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D2 | task | task-22 | the active child's ledger holds cap evidence for gate `restack` with allowance `restacks` naming child 1 |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D3 | task | task-31.2 | the next daemon dispatch's stack preflight runs the repair |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D4 | task | task-31.2 | `reset --gate restack --child 1` sets child 1's count to 0 and keeps the raised limit, `raise` keeps the count, and neither touches another child's entry in `cascades` |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D5 | task | task-31.2 | `kickback-budget reset --gate restack --child 1` sets child 1's count to 0 |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D1 | task | task-31.2 | stores the raised limit in `refs/conductor/demo/cascades` |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D2 | task | task-31.2 | `reset --gate restack --child 1` sets child 1's count to 0 and keeps the raised limit, `raise` keeps the count |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D3 | task | task-31.2 | the `kickback-budget` usage text in `src/conductor/src/cli.ts` lists `restack` as an accepted `--gate` |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D4 | task | task-31.2 | when the CLI's compare-and-swap on `cascades` loses a race with a concurrent write, the command fails, no resume authorization is staged, and the concurrent write is kept |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D5 | task | task-31.2 | re-running the command reconciles that pending adjustment by its adjustment id, applies the `cascades` update exactly once and installs the authorization once |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D6 | task | task-31.2 | the authorization is consumed, the HALT is cleared and `.docs/halted/demo.md` reads `Status: resolved` |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D7 | existing | none | Adjustment authorization events on the existing spine emitted by src/conductor/src/engine/kickback-budget-cli.ts; unchanged |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D8 | task | task-22 | render child 1's restack count and limit through `renderKickbackBudgetView` |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D1 | existing | none | Normal-finish prospective merge `classifyProspectiveMerge` (src/conductor/src/engine/rebase.ts); unchanged |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D2 | task | task-32 | `classifyMergeableSkip` applies the existing mergeable-skip and no restack runs |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D3 | task | task-32 | when the advanced base changes an active review input, a `base-refresh` restack runs even though the leaf PR is mergeable |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D4 | task | task-32, task-15, task-18 | the leaf is replayed onto the resolved child-2 tip, the restack applies |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D5 | task | task-33 | `resumeRebaseFirst` returns `halted` with a needs-human HALT naming the paths and does not skip silently |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D6 | task | task-33 | records no single-branch `rebase` of any child branch or the leaf from either the FINISH step or the re-kick |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D7 | no-change | none | coverage_binding stays non-tree-attesting; #2943 adds no resume-validity stamp |
| adr-2026-09-11-selective-post-rebase-verification#D1 | task | task-18, task-33 | writes child 2's re-judged region gates to `.pipeline/children/2/` |
| adr-2026-09-11-selective-post-rebase-verification#D2 | task | task-18, task-32 | the whole-stack tuple P = old leaf tip, B = `merge-base(old c1, B)`, O = `B'`, H = new leaf tip |
| adr-2026-09-11-selective-post-rebase-verification#D3 | existing | none | Combined-tree versus review-input projection in `resolveReviewInputs` and the gate projection used by `applyRebaseVerdicts` (src/conductor/src/engine/rebase.ts); reused unchanged by Task 18 |
| adr-2026-09-11-selective-post-rebase-verification#D4 | task | task-18 | `rebase_gate_preserved` and `rebase_gate_invalidated` events for child 2 match the applied preserve/invalidate set |
| adr-2026-09-11-selective-post-rebase-verification#D5 | task | task-18 | child 1's verdict files and closure position are byte-identical before and after |
| adr-2026-09-11-selective-post-rebase-verification#D6 | existing | none | Repair only on concrete failure evidence, in `resumeRebaseFirst`'s completed-BUILD evidence halt (src/conductor/src/engine/daemon-rekick.ts); unchanged |
| adr-2026-09-11-selective-post-rebase-verification#D7 | task | task-18 | `rebase_gate_preserved` and `rebase_gate_invalidated` events for child 2 match the applied preserve/invalidate set, and the next selected step is no earlier than `test_suite` |
| adr-2026-09-11-selective-post-rebase-verification#D8 | no-change | none | A verification-coverage obligation for that ADR's own flow; #2943's restack proofs are owned by its own tasks |
| adr-2026-09-23-engine-git-guard-on-agent-path#D1 | existing | none | Embedded guard asset written by `writeGitGuard` (src/conductor/src/engine/git-guard.ts); unchanged |
| adr-2026-09-23-engine-git-guard-on-agent-path#D2 | existing | none | Provider child-environment enforcement through `ensureGitGuardForDispatch` (src/conductor/src/engine/git-guard.ts); unchanged |
| adr-2026-09-23-engine-git-guard-on-agent-path#D3 | existing | none | Re-verification before every guarded dispatch in `ensureGitGuardForDispatch` (src/conductor/src/engine/git-guard.ts); unchanged |
| adr-2026-09-23-engine-git-guard-on-agent-path#D4 | no-change | none | Feature-repository scoping of agent refusals is not touched by #2943 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D5 | no-change | none | The agent-path refusal matrix is not touched by #2943 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D6 | no-change | none | Refusal messages of the agent guard are not touched by #2943 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D7 | no-change | none | Engine git stays outside the agent guard; #2943's engine commits and ref moves run in engine processes |
| adr-2026-09-23-engine-git-guard-on-agent-path#D8 | no-change | none | The operator hook's early feedback is not touched by #2943 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D9 | no-change | none | Skill text is not touched by #2943 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D10 | no-change | none | That ADR's own coverage tests are not changed by #2943 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D11 | existing | none | `reference-transaction` and `pre-push` hooks installed from src/conductor/src/engine/git-hook-assets.ts via src/conductor/src/engine/worktree-prepare.ts; unchanged |
| adr-2026-09-23-engine-git-guard-on-agent-path#D12 | existing | none | `REFERENCE_TRANSACTION_HOOK` refuses only branch deletions; restack moves are updates (src/conductor/src/engine/git-hook-assets.ts); unchanged |
| adr-2026-09-23-engine-git-guard-on-agent-path#D13 | task | task-37 | the installed engine `pre-push` hook passes for that explicit-SHA push |
| adr-2026-09-23-engine-git-guard-on-agent-path#D14 | task | task-26 | moves HEAD with `update-ref HEAD <new> <old>` using the HEAD it read before staging |
| adr-2026-09-23-engine-git-guard-on-agent-path#D15 | task | task-37, task-26 | `commitEngineChange`'s `update-ref HEAD` passes the installed `reference-transaction` hook |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D1 | task | task-3 | `withPinnedGitConfig` sets `rebase.updateRefs=false`, `rebase.rebaseMerges=false`, `rebase.autoSquash=false` |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D2 | task | task-12 | replaced by exactly one commit whose change is only the hand resolution |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D3 | existing | none | N=1 replay proof before mutation in `proveFlattenedReplay` (src/conductor/src/engine/rebase.ts); unchanged |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D4 | task | task-14 | runs `rebase -i --onto <newParent> <oldParent>` with no branch argument and no `--autostash` |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D5 | task | task-17 | contains no `git rebase` command for a stacked branch |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D6 | task | task-12 | carrying a `Flattened-merge:` trailer, and `rebase_merge_audit` is persisted |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D7 | existing | none | Post-replay verification for N=1 unchanged in `performRebase` (src/conductor/src/engine/rebase.ts); stacked acceptance is new-ADR decision 3 |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D8 | task | task-12 | `classifyReplayMerge` exported from `rebase.ts` is the only merge classifier both `performRebase` and `replayChildRange` call |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D9 | existing | none | Refusals that cannot name the merge fall back to the existing refusal in `startFeatureReplay` (src/conductor/src/engine/rebase.ts); unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | existing | none | `leafBranchFor`, `childBranchFor` and `parseFeatureRef` in src/conductor/src/engine/feature-branch-identity.ts; unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | existing | none | Child arms ahead of non-child logic (e.g. `publishHaltRecord`'s child-branch refusal in src/conductor/src/engine/halt-record.ts); unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | no-change | none | Attribution-is-not-authority is a constraint #2943 follows; no change |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | no-change | none | The reserved `feat/c<k>` namespace is not changed; #2943 creates no new branch names |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | existing | none | Child ids bounded by `MAX_CHILD_ID` (src/conductor/src/engine/child-context.ts); unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | task | task-20 | moves the leaf to `H'` in the same move |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | no-change | none | Positions stay immutable; a restack never changes positions |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | existing | none | Per-child state under `.pipeline/children/<k>/` (`childStateExists` in src/conductor/src/engine/child-context.ts); unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | no-change | none | Region caps stay per child; the restack cascade cap is a ref-backed per-originating-child count (new-ADR decision 10), not a region cap |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | task | task-29 | `resolveActiveChild` returns `repair-pending` with `repairChildren: [1]` and the active child's identity |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | task | task-18 | `resolveChildBase` for child 2 returns the restacked `closed/c1` tip as child 2's fresh base |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | task | task-7 | `haltRestack` persists `child` on every refusal that names a child |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | task | task-31.2 | `kickback-budget raise --gate restack --child 1` is accepted, because `--child` is validated against the `cascades` ref |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | task | task-39 | are byte-identical to their committed fixtures, with today's rebase result, `rebase` step verdict and events |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | no-change | none | Whole-feature rubrics still run once at the leaf; #2943 only re-judges them after a restack (Task 18) |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D1 | task | task-21 | the operation record carries `cause: 'feature-repair'` |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D2 | task | task-31 | `classifyRebaseOperation` does not classify the record as interrupted until the journal is gone |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D3 | existing | none | Fail-closed fallbacks in `completeInterruptedRebaseOperation` (src/conductor/src/engine/rebase-transition.ts); unchanged |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D4 | existing | none | Resume-time fence via `classifyRebaseOperation` (src/conductor/src/engine/gate-code-validity.ts); unchanged apart from Task 31's deferral |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D5 | no-change | none | The finish fence is unchanged by #2943 |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D6 | existing | none | Resume-fence halt text naming pending operator decisions in src/conductor/src/engine/conductor.ts; unchanged |
| adr-2026-10-07-per-child-build-region#D1 | task | task-7, task-20, task-29, task-30 | `resolveActiveChild` still reports `leafMovePending: true` although `.pipeline/rebase-rewrites.json` is present |
| adr-2026-10-07-per-child-build-region#D2 | existing | none | Child-existence and envelope-missing handling in `resolveActiveChild`/`hasDurableChildState` (src/conductor/src/engine/child-cursor.ts); unchanged |
| adr-2026-10-07-per-child-build-region#D3 | task | task-20, task-8 | moves the leaf to `H'` in the same move, writes no `refs/conductor/demo/leaf-moved` ref |
| adr-2026-10-07-per-child-build-region#D4 | task | task-18 | no flat region verdict is written under `.pipeline/gates/` |
| adr-2026-10-07-per-child-build-region#D5 | no-change | none | Per-child acceptance specs are not touched by #2943 |
| adr-2026-10-07-per-child-build-region#D6 | no-change | none | Per-child build, stall detection and the commit hook are not touched by #2943 |
| adr-2026-10-07-per-child-build-region#D7 | no-change | none | Per-child test_suite and the leaf aggregate are not touched by #2943 |
| adr-2026-10-07-per-child-build-region#D8 | existing | none | One base producer `resolveChildBase` (src/conductor/src/engine/child-cursor.ts) reads the closure ref, which a restack moves; no consumer changes |
| adr-2026-10-07-per-child-build-region#D9 | no-change | none | Child-local build_review and leaf-only security are not touched by #2943 |
| adr-2026-10-07-per-child-build-region#D10 | existing | none | Per-child kickback caps via the child-capable ledger functions in src/conductor/src/engine/kickback-ledger.ts; unchanged |
| adr-2026-10-07-per-child-build-region#D11 | task | task-29 | `rewind --child 1` on a closed child is refused with a message naming `#2944` |
| adr-2026-10-07-per-child-build-region#D12 | task | task-33 | emits no `rebase_skipped_for_stack` event |
| adr-2026-10-07-per-child-build-region#D13 | no-change | none | Child event variants and position immutability are not changed; #2943 adds its own variants (Task 2) |
| adr-2026-10-07-per-child-build-region#D14 | task | task-35, task-39 | after `executeRemoteGit` completes a successful push of `feat/daemon-demo`, plain or forced, `refs/conductor/demo/pushed/feat/daemon-demo` holds the pushed SHA |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of 2–5 falsifiable checks, each on one physical line
- [x] Dependencies are explicit and acyclic
- [ ] Independent coverage (§7a) and contradiction (§7b) judgements run in fresh subagents

Scope note: 40 tasks puts this plan in the 21–40 warning band. The operator chose all eight #2943
outcomes as one feature (track scope boundary).
