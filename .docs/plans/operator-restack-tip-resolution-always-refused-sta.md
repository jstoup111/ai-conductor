# Implementation Plan: Operator restack --tip resolution always refused stale on a stacked feature

**Date:** 2026-11-02
**Design:** `.docs/decisions/adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref.md`
**Stories:** `.docs/stories/operator-restack-tip-resolution-always-refused-sta.md`
**Conflict check:** Clean as of 2026-11-02

## Summary

Closes the silent loss of a child's commits, makes an operator's `--tip` survive halt bookkeeping, turns real staleness into an answerable conflict, moves stacked halt records onto a ref, and repairs the leaf move. 17 tasks, delivered as a single PR by operator decision.

## Technical Approach

- **Dropped tip first (Tasks 1-4).** `InvokeOptions` gains `environmentOverlay`, and `StepRunner.resolveRebaseConflict` forwards the restack's environment. `resolveRestackConflict` takes its tip from the temporary checkout's HEAD, with the post-rewrite list as a fallback. Rewrites fall back to unique-subject matching, reusing the logic behind `consumeRecordedResolution`. `newParent` is a valid tip only with zero candidates.
- **Consumption (Tasks 5-7).** `consumeRecordedResolution` compares trees with `.docs/halted/<slug>.md` removed through `haltRecordTree`, tolerates halt-record-only drift in the range with `isHaltRecordOnlyCommit`, and replays with `haltRecordSlug` at both call sites.
- **Staleness (Tasks 8-11).** The resolution ref is deleted first, then `haltRecordedRestackConflict` writes a fresh record and the normal halt. An orphan resolution is retired and the replay continues. `restack_resolution` gains `retired`.
- **Record location (Tasks 12-15).** New module `halt-record-ref.ts` follows `restack-conflict-record.ts`: compare-and-swap writes, an explicit teardown entry, and no `for-each-ref` discovery. It differs by storing a commit chain, so the audit trail survives. `recordHalt` and `supersedeHaltRecord` branch on `hasDurableChildState`, and `hasOutstandingHalt` reads through the ref-first rule. The shipped halt-record exemptions stay, because in-flight stacks need them.
- **Leaf move (Tasks 16-17).** `moveLeaf` skips halt-record-only strays and uses a new no-fetch helper shared with `resolveBaseCore`.

Notation for the checks: `demo` is the fixture slug, "the record ref" is `refs/conductor/demo/halt-record`, and "both recipes" means the `git rebase --onto` line with `stack restack-resolve --tip`, and `stack restack-resolve --decision`.

## Prerequisites

None.

## Tasks

### Task 1: Provider adapters apply an environment overlay
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/execution/provider-environment-overlay.test.ts` for every Done-when check below, mocking each adapter's process boundary.
2. Add `environmentOverlay?: NodeJS.ProcessEnv` to `InvokeOptions`. Apply it in Claude `buildEnv`, Codex `invocationEnv` and the Pi environment, after the self-host environment and before the session marker and tmux scrub.

**Done when:**
- [test] With `environmentOverlay: { GIT_CONFIG_KEY_0: 'core.hooksPath' }`, the mocked spawn of the Claude, Codex and Pi adapters each receives that variable in the child's environment.
- [test] An overlay setting `TMUX` and the daemon-session marker variable does not change them: each adapter's spawned environment still has the tmux variables masked and its session marker set.
- [test] Without `environmentOverlay`, each adapter's spawned environment has no `GIT_CONFIG_KEY_0` added by the adapter.

**Files:** `src/conductor/src/execution/llm-provider.ts`; `src/conductor/src/execution/claude-provider.ts`; `src/conductor/src/execution/codex-provider.ts`; `src/conductor/src/execution/pi-provider.ts`; `src/conductor/test/execution/provider-environment-overlay.test.ts`

### Task 2: The production resolver forwards the restack's environment
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolver-wiring.test.ts` for every Done-when check below.
2. Add optional `environment` to `ResolutionContext`, and set `environmentOverlay` from it in `StepRunner.resolveRebaseConflict` for both the provider-aware path and `invokeWithLadder`.

**Done when:**
- [test] `resolveRestackConflict` driven through `restackResolverForStepRunner` and a real `StepRunner` with a stub provider-aware path passes `environmentOverlay` containing `GIT_CONFIG_KEY_0=core.hooksPath` and the journal's `GIT_COMMITTER_NAME` to that provider invocation.
- [test] The same drive with no provider runtimes passes that `environmentOverlay` to `invokeWithLadder`, the fallback model ladder.
- [test] `StepRunner.resolveRebaseConflict` called with a context that has no `environment` passes no `environmentOverlay`.

**Files:** `src/conductor/src/engine/rebase.ts`; `src/conductor/src/engine/step-runners.ts`; `src/conductor/test/engine/restack/restack-resolver-wiring.test.ts`

### Task 3: The settled tip is the checkout's HEAD
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 2

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-resolver-tip-authority.realgit.test.ts` for every Done-when check below. Drive `runRestack` with a resolver built by `restackResolverForStepRunner` whose fake `resolveRebaseConflict` runs Git.
2. In `resolveRestackConflict`, read HEAD through the temporary runner before the checkout is removed. Use the post-rewrite list's last entry only when HEAD cannot be read. Return `newParent` only for zero candidates. When the list is empty, build rewrites by unique subject between the old range and `newParent..tip`.

**Done when:**
- [test] A fake resolver that continues the rebase with the supplied environment leaves child 3's branch from `runRestack` with 8 commits above its parent, with the original subjects and the journal committer stamp, and `restack_applied` reports a new tip different from the parent's tip.
- [test] A fake resolver that runs `git rebase --continue` without the environment, so `resolveRestackConflict` sees no rewritten list, leaves child 3's new tip equal to the settled temporary checkout's HEAD and child 3's branch holding all 8 commits.
- [test] In that run with no rewritten list, the journal's child entry is `resolved`, maps each candidate with a unique subject to its rebuilt commit, and omits candidates that share a subject.
- [test] `resolveRestackConflict` for a child whose todo has no candidates returns a tip equal to `newParent`, and `runRestack` writes no `.pipeline/HALT`.

**Files:** `src/conductor/src/engine/restack/restack-resolver.ts`; `src/conductor/src/engine/restack/restack-conflict-record.ts`; `src/conductor/test/engine/restack/restack-resolver-tip-authority.realgit.test.ts`

### Task 4: A lost or unreadable commit halts with nothing moved
**Story:** Story 1
**Type:** negative-path
**Dependencies:** Task 3

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-resolver-lost-commit.realgit.test.ts` for every Done-when check below. Add an optional temporary-runner seam on `ResolveRestackConflictOptions` so a test can fail `rev-parse HEAD` in the temporary checkout.
2. After choosing the tip, run `missingCandidateSubjects` against `newParent..tip`. A missing subject, or no readable tip with candidates, returns a `conflict_halt` outcome with a reason naming it, which the callers' shipped unresolved-conflict path handles.

**Done when:**
- [test] A fake resolver that skips one of 8 candidates leaves every `feat/` and `closed/` ref unmoved, the journal aborted, and a needs-human `.pipeline/HALT` with a `Restack-Conflict` line, both recipes and the missing commit's subject.
- [test] With 8 candidates, a settled rebase, a seam failing `rev-parse HEAD` and no rewritten list, `resolveRestackConflict` reports `conflict_halt`, `runRestack` moves no `feat/` or `closed/` ref and sets no child branch to the new parent, and the needs-human HALT names the unreadable tip.
- [test] With 8 candidates, the same seam and a rewritten list whose result lacks a candidate's subject, `runRestack` moves no `feat/` or `closed/` ref and the needs-human HALT names that subject.
- [test] A fake resolver returning `{ resolved: false }` produces the shipped unresolved-conflict HALT with a fresh `restack/conflict/record` and both recipes, unchanged from its existing expected text.
- [test] `recoverRestackJournal` resuming a planned journal with a fake resolver that continues without the environment leaves the child with all of its candidates, the same as the `runRestack` run.

**Files:** `src/conductor/src/engine/restack/restack-resolver.ts`; `src/conductor/test/engine/restack/restack-resolver-lost-commit.realgit.test.ts`

### Task 5: The parent comparison ignores only this feature's halt record
**Story:** Story 2
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-resolution-drift.realgit.test.ts` for every Done-when check below. Each drives a conflict halt, `dispatchStackRestackResolve --tip`, and the next `runRestack`.
2. In `consumeRecordedResolution`, compare the live and recorded trees after removing `.docs/halted/<slug>.md` with `haltRecordTree` `{kind: 'write', record: undefined}`. Equal raw trees skip the masking. A Git failure while masking returns `stale` with field `parent-tree`.

**Done when:**
- [test] A parent that gained two halt-record-only commits since the conflict record makes `runRestack` consume the recorded `--tip`, persisting `restack_resolution` action `consumed` with no `restack-resolution-stale` event and no such halt.
- [test] A parent rebuilt with new commit ids whose tree differs from `newParentTree` only at `.docs/halted/demo.md` makes `consumeRecordedResolution` return `consumed`.
- [test] A parent differing at `.docs/halted/other.md`, and separately at `.docs/halted/demo.md` and `src/a.ts`, each makes `consumeRecordedResolution` return `stale` with no consumption, and the halt written by `runRestack` names `parent-tree`.
- [test] A runner failing the masked-tree computation of the live tree, and in a separate run of the recorded tree, each makes `consumeRecordedResolution` return `stale`, and `runRestack` consumes nothing, moves no `feat/` or `closed/` ref, and halts naming `parent-tree`.

**Files:** `src/conductor/src/engine/restack/restack-conflict-record.ts`; `src/conductor/test/engine/restack/restack-resolution-drift.realgit.test.ts`

### Task 6: The range comparison tolerates only this feature's halt-record commits
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 5

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-resolution-drift.realgit.test.ts` for every Done-when check below.
2. Accept a live `oldParent` or `oldTip` that descends from the recorded value through commits that all pass `isHaltRecordOnlyCommit`.

**Done when:**
- [test] Child 3's branch with a halt-record-only commit past the recorded old tip makes `runRestack` consume the recorded `--tip`.
- [test] A live range that differs from the record by a commit changing `.docs/halted/demo.md` and `src/a.ts` makes `consumeRecordedResolution` return `stale`, with no consumption, and the halt names `range`.
- [test] A live range that differs from the record by a merge commit changing only `.docs/halted/demo.md` makes `consumeRecordedResolution` return `stale`, with no consumption, and the halt names `range`.

**Files:** `src/conductor/src/engine/restack/restack-conflict-record.ts`; `src/conductor/test/engine/restack/restack-resolution-drift.realgit.test.ts`

### Task 7: Consumption replays with halt-record handling on both paths
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 6

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-resolution-drift.realgit.test.ts` and `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts` for every Done-when check below.
2. Pass `haltRecordSlug` in the `replayChildRange` calls that `runRestack` and `resumePlanned` give to `consumeRecordedResolution`.

**Done when:**
- [test] An operator range containing a halt-record-only commit whose record differs from the live parent's is consumed by `runRestack` with that commit not replayed, no conflict, and a rebuilt tip carrying the newer of the two records.
- [test] After two halts and clears followed by consumption, `.docs/halted/demo.md` at the rebuilt tip equals the newest record, and `git log` of the parent still lists the older record commits.
- [test] `recoverRestackJournal` resuming a planned journal over a parent with halt-record-only drift consumes the resolution, with the same rebuilt tree and `consumed` event as `runRestack`.

**Files:** `src/conductor/src/engine/restack/restack-executor.ts`; `src/conductor/src/engine/restack/restack-recovery.ts`; `src/conductor/test/engine/restack/restack-resolution-drift.realgit.test.ts`; `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts`

### Task 8: A stale resolution becomes a fresh conflict in `runRestack`
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 6

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-resolution-stale.realgit.test.ts` for every Done-when check below.
2. Add action `retired` to `restack_resolution`. Add a helper that deletes the resolution ref by compare-and-swap and returns the old record's `commit` and `paths`. On a `parent-tree` or `range` stale result, `runRestack` aborts the journal, emits `restack_refused`, deletes the ref, then calls `haltRecordedRestackConflict` with subjects from the range's replay candidates and a detail naming the reason and field.

**Done when:**
- [test] A recorded `--tip` with a parent whose feature content changed leaves `runRestack` moving no `feat/` or `closed/` ref, `restack/resolution/c2` absent, and `restack_refused` with reason `restack-resolution-stale` and detail `parent-tree`.
- [test] After that outcome `readConflictRecord` returns the live range's `oldParent` and `oldTip`, the live parent, the live parent's tree, and the prior record's `commit` and `paths`.
- [test] After that outcome `.pipeline/HALT` contains `restack-resolution-stale`, `parent-tree`, `Restack-Conflict: 2 <opId>` with this journal's opId, and both recipes naming the live parent.
- [test] After that outcome `.pipeline/events.jsonl`, written through `EventPersister`, holds `restack_resolution` with action `retired` and the old tip.
- [test] A live range changed by a non-bookkeeping commit produces all of those outcomes with detail `range`: no ref moved, the resolution absent, the fresh record, and the HALT naming `range`.

**Files:** `src/conductor/src/types/events.ts`; `src/conductor/src/engine/restack/restack-conflict-record.ts`; `src/conductor/src/engine/restack/restack-executor.ts`; `src/conductor/src/engine/restack/restack-resolver.ts`; `src/conductor/test/engine/restack/restack-resolution-stale.realgit.test.ts`

### Task 9: Recovery writes the same fresh conflict
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 8

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts` for every Done-when check below.
2. In `recoverRestackJournal`'s `resolution-stale` branch, abort the journal and use the helper from Task 8.

**Done when:**
- [test] `recoverRestackJournal` meeting a stale resolution leaves the journal `aborted`, and `readConflictRecord` plus `.pipeline/HALT` match what the executor writes for the same fixture, apart from the opId.
- [test] That recovery moves no `feat/` or `closed/` ref and leaves `restack/resolution/c2` absent.

**Files:** `src/conductor/src/engine/restack/restack-recovery.ts`; `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts`

### Task 10: An orphan resolution is retired, and a partial stale write recovers
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 8

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-resolution-stale.realgit.test.ts` and `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts` for every Done-when check below.
2. On a `record` stale result, both paths delete the resolution ref, emit `retired`, and continue to the ordinary replay. A failed fresh-record write leaves the shipped record-failure text in the HALT.

**Done when:**
- [test] A resolution ref for child 2 with no conflict record leaves `runRestack` with `restack/resolution/c2` absent, `restack_resolution` action `retired` persisted, and child 2 replayed by the ordinary replay; `recoverRestackJournal` does the same.
- [test] A resolution ref for child 2 and a record naming child 3 retires the child 2 resolution, leaves `restack/conflict/record` for child 3 byte-identical, and runs the ordinary replay of child 2.
- [test] A retired orphan whose ordinary replay conflicts with a resolver returning `{ resolved: false }` writes the shipped conflict HALT with a fresh `restack/conflict/record` and both recipes.
- [test] On a stale `parent-tree` outcome from `runRestack`, a runner failing the fresh record's `update-ref` leaves a HALT naming the record failure and no moved `feat/` or `closed/` ref, and the next `runRestack` runs the ordinary replay with no resolution ref present.
- [test] A fixture with the resolution ref deleted and the old record kept, the state after a crash between the two writes, makes the next `runRestack` consume nothing and run the ordinary replay.

**Files:** `src/conductor/src/engine/restack/restack-executor.ts`; `src/conductor/src/engine/restack/restack-recovery.ts`; `src/conductor/test/engine/restack/restack-resolution-stale.realgit.test.ts`; `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts`

### Task 11: The operator can answer a stale halt through the CLI
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 8

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-resolution-stale.realgit.test.ts` for every Done-when check below. Parse the commands from `.pipeline/HALT` and run them through `dispatchStackRestackResolve`, without calling `git update-ref` in the test.

**Done when:**
- [test] After a stale `parent-tree` halt, running the printed `git rebase --onto` recipe and `dispatchStackRestackResolve` with `--tip` makes the next `runRestack` emit `restack_resolution` action `consumed` and apply the tip, with no `git update-ref` run by the test.
- [test] After that stale halt, `dispatchStackRestackResolve` with `--decision` persists `restack_decision` action `recorded`, clears `.pipeline/HALT`, and the next `runRestack` passes the answer to the resolver as `operatorDecision`.
- [test] After that stale halt, `dispatchStackRestackResolve` with a `--tip` that does not descend from the fresh record's live parent exits 1 with a refusal naming that parent, and `.pipeline/HALT` is unchanged.

**Files:** `src/conductor/test/engine/restack/restack-resolution-stale.realgit.test.ts`

### Task 12: A ref-backed halt-record store
**Story:** Story 4
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/halt-record-ref.realgit.test.ts` for every Done-when check below.
2. Add `src/conductor/src/engine/halt-record-ref.ts` with the ref name, a compare-and-swap append building a one-file tree with `mktree` and `commit-tree` under the engine commit environment, and a reader returning the ref's text or else `HEAD`'s. Add the ref to `featureConductorRefNames`. Leave `STACK_OWNED_CONDUCTOR_REFS` unchanged, so the ref is not durable child state. Follow `restack-conflict-record.ts`: named refs, compare-and-swap, no `for-each-ref` discovery.

**Done when:**
- [test] Two appends leave `git log -p refs/conductor/demo/halt-record` showing both record versions, with the second commit's parent being the first and its tree holding only `.docs/halted/demo.md`.
- [test] An append whose expected old value no longer matches returns a stale result and leaves the ref unchanged.
- [test] `featureConductorRefNames('demo')` includes the record ref, and single-slug teardown deletes it with the other feature refs.
- [test] With only a record ref for a slug and no positions, closure or restack refs, `hasDurableChildState` returns false.

**Files:** `src/conductor/src/engine/halt-record-ref.ts`; `src/conductor/src/engine/restack/restack-refs-cleanup.ts`; `src/conductor/test/engine/halt-record-ref.realgit.test.ts`

### Task 13: A stacked halt writes only the ref
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 12

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-record-stacked.realgit.test.ts` for every Done-when check below, driving `writeHaltMarker`.
2. In `recordHalt`, branch on `hasDurableChildState`: `true` appends to the ref with no file, no commit and no push; `git-error` returns `failed`. Report the location so `halt_record_written` names the ref. Add the ref to the record's push-status line.
3. Change the "Operator-actionable halts are branch-visible" rule in `HARNESS.md` so a stacked feature's record is stated to live on `refs/conductor/<slug>/halt-record`.

**Done when:**
- [test] `writeHaltMarker` on `demo` with child 2 active leaves the record ref's `.docs/halted/demo.md` with `Status: halted` and `Child: 2`, every `feat/` tip unchanged, `git status --porcelain` showing no `.docs/halted/demo.md`, no mocked push call, and `halt_record_written` naming the record ref as its path.
- [test] `writeHaltMarker` on a feature with no durable child state, including a leaf before its first child, commits `.docs/halted/demo.md`, reaches the mocked push boundary as today, and creates no record ref.
- [test] A `hasDurableChildState` Git error, and separately a record-ref compare-and-swap failure, each leave `.pipeline/HALT` written, no branch commit, `halt_record_write_failed` emitted, and `writeHaltMarker` resolved without throwing.
- [test] A `mechanical` halt on a stacked feature leaves the record ref absent or unchanged, and a halt with a restack journal in state `ready` writes the record ref and moves no journaled ref.
- `HARNESS.md`'s "Operator-actionable halts are branch-visible" rule names `refs/conductor/<slug>/halt-record` as where a stacked feature's record lives, and keeps `.docs/halted/<slug>.md` for other features.

**Files:** `src/conductor/src/engine/halt-record.ts`; `src/conductor/src/engine/halt-marker.ts`; `HARNESS.md`; `src/conductor/test/engine/halt-record-stacked.realgit.test.ts`

### Task 14: Clearing a stacked halt writes only the ref
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 13

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-record-stacked.realgit.test.ts` for every Done-when check below.
2. In `supersedeHaltRecord`, for a stacked feature, read through the ref-first reader, apply `supersedeHaltRecordText`, and append to the ref, with no file, commit or push.

**Done when:**
- [test] Clearing a stacked halt leaves the record ref reading `Status: resolved` with its cause and the original halt body, every `feat/` tip unchanged, and `git log -p refs/conductor/demo/halt-record` showing both versions.
- [test] Halting and clearing with child 1 closed and child 2 active leaves `feat/c1/demo` equal to `refs/conductor/demo/closed/c1`.
- [test] Halting and clearing with the leaf active leaves the leaf's tip unchanged and makes no mocked push call.
- [test] A stack with `Status: halted` committed at HEAD and no record ref, once cleared, has a record ref holding the resolved text, and no branch has gained a commit.
- [test] `supersedeHaltRecord` with no record ref and no committed record returns `noop` and creates no ref.

**Files:** `src/conductor/src/engine/halt-record.ts`; `src/conductor/test/engine/halt-record-stacked.realgit.test.ts`

### Task 15: Outstanding-halt state reads the ref first
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 14

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/restack-recovery-halt-record-ref.realgit.test.ts` for every Done-when check below.
2. Make `hasOutstandingHalt` read through the ref-first reader.

**Done when:**
- [test] A stack upgraded by Task 14's clear, with an aborted journal, makes `cleanClearedAbortedRestackJournal` report no outstanding halt and return `cleaned`.
- [test] A record ref reading `Status: resolved` with a committed HEAD record reading `Status: halted` makes `cleanClearedAbortedRestackJournal` treat no halt as outstanding.
- [test] A record ref reading `Status: halted` with a committed HEAD record reading `Status: resolved` makes `cleanClearedAbortedRestackJournal` treat a halt as outstanding and return `none`.

**Files:** `src/conductor/src/engine/restack/restack-recovery.ts`; `src/conductor/test/engine/restack/restack-recovery-halt-record-ref.realgit.test.ts`

### Task 16: The leaf move ignores only this feature's halt-record commits
**Story:** Story 5
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/child-lifecycle-leaf-move.realgit.test.ts` for every Done-when check below, driving `advanceChildRegion`, whose non-leaf boundary reaches `moveLeaf`.
2. In `moveLeaf`, walk the stray list and skip commits that pass `isHaltRecordOnlyCommit`. Refuse on the first other commit, naming it.

**Done when:**
- [test] `advanceChildRegion` with two halt-record-only commits on the leaf outside the tip and the default branch moves the leaf to the tip, and `git reflog` lists the leaf's old value.
- [test] A leaf commit changing `src/a.ts`, one changing only `.docs/halted/other.md`, and one changing `.docs/halted/demo.md` and `src/a.ts` each make `moveLeaf` refuse with that commit's SHA in its detail and leave the leaf unchanged.
- [test] A leaf merge commit changing only `.docs/halted/demo.md` makes `moveLeaf` refuse with that commit's SHA in its detail and leave the leaf unchanged.
- [test] A leaf that changes between the stray check and the update makes `moveLeaf` return the shipped `concurrent update refused` refusal.

**Files:** `src/conductor/src/engine/child-lifecycle.ts`; `src/conductor/test/engine/child-lifecycle-leaf-move.realgit.test.ts`

### Task 17: The leaf move finds the default branch like the rebase path
**Story:** Story 5
**Type:** negative-path
**Dependencies:** Task 16

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/child-lifecycle-leaf-move.realgit.test.ts` for every Done-when check below.
2. Extract the no-fetch discovery from `resolveBaseCore` into an exported helper, `origin/HEAD` then `git remote show origin`, and use it in both places. In `moveLeaf`, exclude `origin/<default>` only when that ref resolves.

**Done when:**
- [test] A clone after `git symbolic-ref --delete refs/remotes/origin/HEAD` whose `git remote show origin` reports `main` makes `advanceChildRegion` move the leaf, and a commit reachable only from `origin/main` is not treated as a stray.
- [test] With discovery failing entirely and every leaf commit reachable from the tip, `moveLeaf` completes and moves the leaf.
- [test] With discovery failing and a leaf commit outside the tip, `moveLeaf` refuses with that commit's SHA in its detail and no `cannot determine origin default branch` text.
- [test] With discovery naming a default branch that has no local `origin/<default>` ref, `moveLeaf` runs the stray check with only `^<tip>` and does not return `cannot inspect leaf branch`.

**Files:** `src/conductor/src/engine/rebase.ts`; `src/conductor/src/engine/child-lifecycle.ts`; `src/conductor/test/engine/child-lifecycle-leaf-move.realgit.test.ts`

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─▶ Task 4
Task 5 ─▶ Task 6 ─▶ Task 7
          Task 6 ─▶ Task 8 ─▶ Task 9, Task 10, Task 11
Task 12 ─▶ Task 13 ─▶ Task 14 ─▶ Task 15
Task 16 ─▶ Task 17
```

## Integration Points

- After Task 4: a resolver-settled restack cannot lose a commit.
- After Task 11: the full operator round trip works for `--tip` and `--decision`.
- After Task 15: a stacked halt and clear change no branch.
- After Task 17: child boundaries cross with halt records and without `origin/HEAD`.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D1 | task | task-12, task-13 | leaves the record ref's `.docs/halted/demo.md` with `Status: halted` and `Child: 2` |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D2 | task | task-14, task-15 | Clearing a stacked halt leaves the record ref reading `Status: resolved` |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D3 | task | task-5, task-6, task-7 | A parent that gained two halt-record-only commits since the conflict record makes `runRestack` consume the recorded `--tip` |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D4 | task | task-8, task-9 | `Restack-Conflict: 2 <opId>` with this journal's opId |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D5 | task | task-10 | A resolution ref for child 2 with no conflict record leaves `runRestack` with `restack/resolution/c2` absent |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D6 | task | task-1, task-2 | With `environmentOverlay: { GIT_CONFIG_KEY_0: 'core.hooksPath' }` |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D7 | task | task-3, task-4 | leaves child 3's new tip equal to the settled temporary checkout's HEAD |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D8 | task | task-16, task-17 | with two halt-record-only commits on the leaf outside the tip and the default branch moves the leaf to the tip |
| adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref#D9 | no-change | none | Records the scope limits; it requires no implementation. |
| adr-2026-08-23-committed-halt-record#D1 | task | task-13 | commits `.docs/halted/demo.md`, reaches the mocked push boundary as today |
| adr-2026-08-23-committed-halt-record#D2 | existing | none | `writeHaltMarker` in `halt-marker.ts` already calls `recordHalt` as the only record seam. |
| adr-2026-08-23-committed-halt-record#D3 | task | task-13 | A `mechanical` halt on a stacked feature leaves the record ref absent or unchanged |
| adr-2026-08-23-committed-halt-record#D4 | existing | none | `renderHaltRecord` in `halt-record.ts` already renders these fields, and the location does not change them. |
| adr-2026-08-23-committed-halt-record#D5 | task | task-13 | no mocked push call |
| adr-2026-08-23-committed-halt-record#D6 | task | task-13 | `writeHaltMarker` resolved without throwing |
| adr-2026-08-23-committed-halt-record#D7 | task | task-14 | with its cause and the original halt body |
| adr-2026-08-23-committed-halt-record#D8 | no-change | none | The ref is state read by name, and occurrences stay on the existing `halt_record_*` events. |
| adr-2026-10-07-per-child-build-region#D1 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D2 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D3 | task | task-16, task-17 | `git reflog` lists the leaf's old value |
| adr-2026-10-07-per-child-build-region#D4 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D5 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D6 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D7 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D8 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D9 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D10 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D11 | task | task-13 | every `feat/` tip unchanged |
| adr-2026-10-07-per-child-build-region#D12 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D13 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-07-per-child-build-region#D14 | no-change | none | Unaffected: this feature changes only where stacked halt records live and the leaf move. |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | task | task-15 | makes `cleanClearedAbortedRestackJournal` treat a halt as outstanding |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-3, task-4 | leaves child 3's new tip equal to the settled temporary checkout's HEAD |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | task | task-8 | holds `restack_resolution` with action `retired` and the old tip |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | no-change | none | Unaffected: the restack's planning, moves and triggers do not change. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D1 | existing | none | `writeConflictRecord` already writes the durable record, and the stale path reuses it. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D2 | task | task-8 | both recipes naming the live parent |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D3 | existing | none | `checkRestackResolution` already validates a `--tip`, and this feature does not change it. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D4 | task | task-5, task-6, task-8 | each makes `consumeRecordedResolution` return `stale` with no consumption |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D5 | existing | none | `appliedTransactionLines` already deletes consumed refs, and a matching resolution keeps its lifetime. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D6 | no-change | none | Post-restack guarantees still come from the shipped machinery. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D7 | no-change | none | The routed exit's resolver and reason reporting do not change. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D8 | task | task-8 | holds `restack_resolution` with action `retired` and the old tip |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D9 | no-change | none | A restack with no resolution ref still replays exactly as today. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D10 | no-change | none | Guidance changes go through the pre-finish documentation gate, by architecture-review condition 3. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-refusal-a62e8e2b-0279-4f2c-96b7-be6c61ed7cfd: In src/conductor/src/engine/rebase.ts, restore originDefaultBranch to resolve origin/HEAD only, with no `git remote show origin` call. Add a separate exported helper that tries origin/HEAD, then `git remote show origin`, with no fetch. Call that helper only from resolveBaseCore and from child-lifecycle.ts moveLeaf. Leave every other originDefaultBranch caller unchanged.
**Gate:** prd-audit
**Rationale:** Removal-only rework under Task 17. The refused behavior was widening rebase.ts originDefaultBranch, which has about 18 callers including autoheal, with a `git remote show origin` round-trip. The recorded decision keeps originDefaultBranch as origin/HEAD-only and puts the fallback in a new exported helper used only by resolveBaseCore and moveLeaf, which is the shape Task 17 Step 2 asked for. This adds no new capability: it moves existing fallback behavior back to the two approved callers and reverts the collateral test edits. Task 17's leaf-move tests must keep passing.
**Criterion:** NC-1
**Governing clause:** Refused NC-1 (decision a62e8e2b-0279-4f2c-96b7-be6c61ed7cfd r1)
**Done when:**
- [test] NC-1 is satisfied by this task.
- Refused NC-1 (decision a62e8e2b-0279-4f2c-96b7-be6c61ed7cfd r1) is satisfied by this task.
- The repair for task rem-prd-audit-refusal-a62e8e2b-0279-4f2c-96b7-be6c61ed7cfd is committed and its targeted tests pass.

### Task rem-prd-audit-refusal-a62e8e2b-0279-4f2c-96b7-be6c61ed7cfd-2: Restore src/conductor/test/engine/autoheal.test.ts to its main-branch 'fails closed with a default-branch resolution anomaly' test. Revert the collateral push-evidence.test.ts `-b main` change and the fixture-portability.test.ts allowlist and line edits wherever they are no longer needed. Confirm child-lifecycle-leaf-move.realgit.test.ts still passes against the new helper.
**Gate:** prd-audit
**Rationale:** Removal-only rework under Task 17. The refused behavior was widening rebase.ts originDefaultBranch, which has about 18 callers including autoheal, with a `git remote show origin` round-trip. The recorded decision keeps originDefaultBranch as origin/HEAD-only and puts the fallback in a new exported helper used only by resolveBaseCore and moveLeaf, which is the shape Task 17 Step 2 asked for. This adds no new capability: it moves existing fallback behavior back to the two approved callers and reverts the collateral test edits. Task 17's leaf-move tests must keep passing.
**Criterion:** NC-1
**Governing clause:** Refused NC-1 (decision a62e8e2b-0279-4f2c-96b7-be6c61ed7cfd r1)
**Done when:**
- [test] NC-1 is satisfied by this task.
- Refused NC-1 (decision a62e8e2b-0279-4f2c-96b7-be6c61ed7cfd r1) is satisfied by this task.
- The repair for task rem-prd-audit-refusal-a62e8e2b-0279-4f2c-96b7-be6c61ed7cfd-2 is committed and its targeted tests pass.

### Task rem-prd-audit-R1: Add a real-git test in src/conductor/test/engine/restack/restack-resolver-lost-commit.realgit.test.ts: recoverRestackJournal resumes a planned journal with a fake resolver that continues without the environment, and the child ends with all of its candidates, matching the runRestack run. Fix restack-recovery.ts only if the test fails.
**Gate:** prd-audit
**Rationale:** Verified (95%): Task 4's fifth Done-when check requires a test where recoverRestackJournal resumes a planned journal with a resolver that continues without the environment. restack-recovery.ts calls the same resolveRestackConflict, but no changed test drives that path. This is missing test coverage inside Task 4's RED/GREEN scope, which already admits restack-resolver-lost-commit.realgit.test.ts. No architecture or product decision is needed.
**Criterion:** S1.6
**Parent task:** 4
**Done when:**
- [test] S1.6 is satisfied by this task.
- The repair for task rem-prd-audit-R1 is committed and its targeted tests pass.

### Task rem-as-built-R2: In src/conductor/src/engine/restack/restack-conflict-record.ts retireRecordedResolution, treat an unreadable conflict record as having no usable record: delete the resolution ref, return retired with no record, and keep the unreadable record bytes. Add real-git tests in restack-resolution-stale.realgit.test.ts and restack-recovery-resolution.realgit.test.ts. A malformed-JSON record must leave runRestack and recoverRestackJournal with the resolution ref absent, restack_resolution 'retired' emitted, and the ordinary replay run.
**Gate:** as-built
**Rationale:** Verified (99%): ADR decision 5 explicitly retires 'a resolution ref with no readable record', then runs the ordinary replay. retireRecordedResolution (restack-conflict-record.ts) instead returns unavailable when readConflictRecord reports unreadable, so the executor throws and recovery returns unavailable. The approved architecture is unambiguous, so this is conforming implementation drift. Task 10 (orphan retirement on both paths, files restack-executor.ts, restack-recovery.ts and their stale and recovery tests) admits the fix.
**Governing clause:** adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref decision 5
**Done when:**
- adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref decision 5 is satisfied by this task.
- The repair for task rem-as-built-R2 is committed and its targeted tests pass.

### Task rem-as-built-R3: In src/conductor/src/engine/restack/restack-recovery.ts, turn the single orphan retire-and-resume step into a bounded loop that retires each successive record-stale orphan, emits 'retired' for each, and resumes the planned journal. Confirm restack-executor.ts runRestack handles successive orphans the same way. Add a real-git test in restack-recovery-resolution.realgit.test.ts: orphan resolution refs for two children, no matching record, recoverRestackJournal retires both and replays both by the ordinary replay.
**Gate:** as-built
**Rationale:** Verified (97%): restack-recovery.ts runs a single `if (resumed.kind === 'resolution-stale' && resumed.field === 'record')` retire-and-resume step. A second child's orphan then reaches the later resolution-stale branch, which aborts the journal and returns unavailable because no matching record exists. ADR decision 5 requires retirement plus ordinary replay for every orphan. Task 10 admits both paths. The sibling runRestack path in restack-executor.ts is in scope for the same check under Task 10.
**Governing clause:** adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref decision 5
**Done when:**
- adr-2026-11-02-stacked-restack-recovery-and-halt-record-ref decision 5 is satisfied by this task.
- The repair for task rem-as-built-R3 is committed and its targeted tests pass.
