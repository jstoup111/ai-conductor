# Implementation Plan: Restack accepts resolutions that adapt the new parent's files

**Date:** 2026-11-07
**Design:** `.docs/architecture/restack-refuses-child-resolution-that-adapts-tests.md`
**Stories:** `.docs/stories/restack-refuses-child-resolution-that-adapts-tests.md` (accepted stories)
**Conflict check:** Clean as of 2026-11-07 (`.docs/conflicts/2026-11-07-restack-refuses-child-resolution-that-adapts-tests.md`)

## Summary

The plan has 11 tasks. A resolved restack tip, from the resolver, an operator `--tip`, or either consumed by journal recovery, may change files its new parent changed. Those adapted paths are refused only when they restore the old parent's content. They are emitted as `adaptedPaths` and re-open the child's feature-scoped reviews. A refused resolution keeps its tip at `refs/conductor/<slug>/restack/conflict/refused-tip` and takes the recoverable restack-conflict halt. A clean plumbing replay keeps the strict owned-paths rule.

## Technical Approach

- **Prerequisite build.** Build starts from main after #3438 (merge-bearing restack conflicts reach the resolver) has merged. #3438 changes the resolver hand-off, `haltUnresolvedConflict`, the restack-conflict halt's `--tip` recipe start (`flattened-tip`), and recovery's conflict path, in the same files. Rediscover those symbols on the current HEAD; do not rely on pre-#3438 line positions.
- **One resolved-tip rule, in `restack-ownership.ts`.** Add the following beside `checkPathOwnership`, which keeps its clean-replay semantics unchanged:
  - `adaptedPathsFor(range, newParent, tip, git)`: `(newParent..tip) ∩ (oldParent..newParent) − ownedPaths`, using `--no-renames` name-only diffs and the shipped `ownedPaths`. It returns sorted paths.
  - `checkResolvedTipOwnership(range, newParent, tip, git, options)`: returns `{ kind: 'accepted', adaptedPaths }` or `{ kind: 'refused', paths: { path, cause: 'unowned' | 'parent-revert' }[] }`. A path in `newParent..tip` is accepted when it is owned, or when it is in the parent delta and the tip's content differs from `oldParent`'s. "Content" means the `git show <rev>:<path>` result, with absence as a distinct value. It is `parent-revert` when the parent-delta path's tip content equals `oldParent`'s, including both absent. It is `unowned` when the path is in neither set. The `normaliseInheritedRemBlocks` option behaves as it does in `checkPathOwnership`.
  - The refusal cause is a closed union. It is never a free-form string.
- **Callers.** Every resolved-tip site switches to `checkResolvedTipOwnership`:
  - the resolver result and recorded-resolution consumption in `runRestack` (`restack-executor.ts`);
  - the same two in recovery's `resumePlanned` (`restack-recovery.ts`);
  - `checkRestackResolution` (`stack-restack-resolve-cli.ts`).
  The clean-replay sites in both files keep `checkPathOwnership`.
- **Event.** `restack_applied` gains `adaptedPaths: string[]` (`src/conductor/src/types/events.ts`). It is computed per moved child at the emission site in `runRestack`, from the journal range, its new parent and the moved tip, so the restack journal stores nothing new. A clean replay yields `[]`, because the strict rule already guarantees no non-owned changes.
- **Re-review.** `applyRestackTransition` (`restack-transition.ts`) gives `normalizedReplayComparison` and `outcomeFor`'s `featureSurface` the child's adapted paths, from `adaptedPathsFor` on the same tuple, as part of the child-owned surface. A resolution confined to parent-delta paths is then `changed`, not normalized to `unchanged`, so `classifyReplayGateInvalidation` invalidates the feature-scoped reviews.
- **Refused-tip ref.** `refusedTipRefFor(slug)` sits in `restack-conflict-record.ts` beside `conflictParentRefFor`.
  - **Written:** on an ownership-refused resolver result, in the executor's unresolved-conflict halt path and recovery's equivalent. The refusal now writes the conflict record and parent pin through `haltRecordedRestackConflict`, instead of a bare `replay-mismatch` halt. `restack_refused` is still emitted with reason `replay-mismatch`.
  - **Deleted:** wherever the conflict parent pin is deleted (`conflictDeleteLines`, `retireRecordedResolution`, the applied transaction, `restack-refs-cleanup.ts` teardown), and when a later non-refusal conflict halt writes a record.
  - **Recipe:** the restack-conflict halt's `--tip` recipe start takes the refused tip when present, ahead of #3438's `flattened-tip`, which stays pinned.
- **Local test pattern.** Real-git restack scenarios build a three-slice `demo` stack in a temp repo and inject a fake resolver at the production resolver seam. Search hints: `restack-conflict.realgit.test.ts`, `restack-resolver-tip-authority.realgit.test.ts`, `restack-recovery-resolution.realgit.test.ts`, `stack-restack-resolve-decision.realgit.test.ts`.
  - Traits to keep: a temp repo per test, the shipped `makeGitRunner`, and assertions on persisted events, refs and `.pipeline/HALT`.
  - Allowed variation: fixture helper names and file contents.

## Prerequisites

- jstoup111/ai-conductor#3438 merged to main (blocked-by edge).

## Tasks

### Task 1: The resolved-tip ownership rule and adapted-path computation
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in a new `restack-adapted-paths.realgit.test.ts`. Build child 2's owned paths `src/c.ts` and `src/main.ts`, and a new parent that adds `tests/a.test.ts`, modifies `tests/b.test.ts` and changes `src/c.ts`. Call `checkResolvedTipOwnership` and `adaptedPathsFor` on tips that:
   - adapt `tests/a.test.ts`;
   - adapt `tests/b.test.ts`;
   - delete `tests/a.test.ts`;
   - restore `tests/b.test.ts` to its old-parent bytes;
   - change `src/other.ts`;
   - mix the `tests/a.test.ts` adaptation with `src/other.ts`.
   Assert the same `tests/b.test.ts` adaptation is refused by the unchanged `checkPathOwnership`.
2. Verify RED.
3. Implement both exports in `restack-ownership.ts` as Technical Approach describes, reusing `ownedPaths`, `changedPaths` and `fileAt`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `checkResolvedTipOwnership` returns `accepted` with `adaptedPaths` `["tests/a.test.ts"]` for the `tests/a.test.ts` adaptation and `["tests/b.test.ts"]` for the `tests/b.test.ts` adaptation, as asserted in `restack-adapted-paths.realgit.test.ts`.
- [test] `checkResolvedTipOwnership` returns `refused` with `{ path: "tests/a.test.ts", cause: "parent-revert" }` for the deletion and `{ path: "tests/b.test.ts", cause: "parent-revert" }` for the old-parent restore.
- [test] `checkResolvedTipOwnership` returns `refused` naming only `{ path: "src/other.ts", cause: "unowned" }` both for the `src/other.ts` tip and for the mixed tip that also adapts `tests/a.test.ts`.
- [test] `checkPathOwnership` still returns `refused` naming `tests/b.test.ts` for the same `tests/b.test.ts` adaptation, proving the clean-replay rule is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-ownership.ts` — `adaptedPathsFor`, `checkResolvedTipOwnership`, the refusal-cause type
- `src/conductor/test/engine/restack/restack-adapted-paths.realgit.test.ts` — new

**Dependencies:** none

### Task 2: `runRestack` accepts an adapting resolver result and keeps clean replay strict
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing `runRestack` real-git tests. First, a `feature-repair` restack in which child 2 conflicts on `src/c.ts` and the fake resolver's tip also edits `tests/a.test.ts`. Second, a clean replay in which child 2's range adds and then reverts a line in `tests/b.test.ts` while the repaired parent adds that line.
2. Verify RED.
3. In `runRestack`, replace the resolver-result `checkPathOwnership` call with `checkResolvedTipOwnership`. Leave the clean-replay call on `checkPathOwnership`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] With the adapting fake resolver tip, `runRestack` records child 2 `resolved` in the restack journal, replays child 3 onto child 2's resolved tip, and returns an applied result, as asserted in `restack-adapted-paths.realgit.test.ts`.
- [test] In the clean add-then-revert replay of `tests/b.test.ts`, `runRestack` persists `restack_refused` with reason `replay-mismatch` naming `tests/b.test.ts`, writes a `replay-mismatch` HALT, and moves no `feat/` branch or closure ref.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — the resolver-result ownership call
- `src/conductor/test/engine/restack/restack-adapted-paths.realgit.test.ts` — `runRestack` scenarios

**Dependencies:** Task 1

### Task 3: `restack_applied` carries `adaptedPaths` for every moved child
**Story:** 1, 2
**Type:** happy-path

**Steps:**
1. Write failing tests asserting the persisted `restack_applied` events in three runs: the adapting `tests/a.test.ts` restack, a `tests/b.test.ts` adaptation, and a conflict-free restack.
2. Verify RED.
3. Add `adaptedPaths: string[]` to `restack_applied` in `events.ts`. At the `runRestack` emission site, compute it with `adaptedPathsFor(range, newParent, move.newSha)` for each moved child.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] After the adapting restack, the persisted `restack_applied` for child 2 has `adaptedPaths` `["tests/a.test.ts"]`, and for child 3, which replayed cleanly onto it, `adaptedPaths` `[]`, read from `.pipeline/events.jsonl`.
- [test] A restack whose resolved child-2 tip adapts only `tests/b.test.ts` persists child 2's `restack_applied` with `adaptedPaths` `["tests/b.test.ts"]`.
- [test] A restack in which child 2 replays with no conflict, and one whose resolved tip changes only owned paths, persist child 2's `restack_applied` with `adaptedPaths` `[]`.
- The restack journal's stored child entry has the same keys before and after this change, because `adaptedPaths` is computed at emission and never written to the journal.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — `adaptedPaths` on `restack_applied`
- `src/conductor/src/engine/restack/restack-executor.ts` — emission
- `src/conductor/test/engine/restack/restack-adapted-paths.realgit.test.ts` — event assertions

**Dependencies:** Task 2

### Task 4: The restack transition counts adapted paths as the child's contribution
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `restack-transition.test.ts`, or a new real-git transition test. Child 2 has satisfied `build_review` and `test_suite` verdicts, and a resolved tip whose only change beyond a replay of its own commits is the `tests/a.test.ts` adaptation. Contrast with a clean unchanged replay.
2. Verify RED: the shipped normalization classifies the adapting tip `unchanged` and preserves `build_review`.
3. In `applyRestackTransition`, compute `adaptedPathsFor` for each moved child's tuple and include those paths in the child-owned surface in `normalizedReplayComparison`, and in `outcomeFor`'s `featureSurface`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] For the adapting tip, `applyRestackTransition` leaves child 2's `build_review` and `test_suite` verdicts unsatisfied, and the persisted `restack_applied` lists both gates in child 2's `wouldInvalidate`.
- [test] After that transition, child 2's conduct state records `build_review` as not done, so the conductor's next step for child 2 is `build_review`, not completion.
- [test] For the clean unchanged replay with no adapted paths, `applyRestackTransition` keeps child 2's `build_review` verdict satisfied and leaves it out of `wouldInvalidate`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-transition.ts` — adapted paths in the replay comparison and feature surface
- `src/conductor/test/engine/restack/restack-transition.test.ts` — the adapting and unchanged cases

**Dependencies:** Task 1, Task 3

### Task 5: The refused-tip ref and its lifecycle
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `restack-conflict-record.realgit.test.ts` and `restack-refs-cleanup.test.ts` covering each event in the refused-tip ref's lifecycle:
   - a refused-tip ref written beside a record;
   - deletion on apply;
   - deletion on stale retirement;
   - deletion at feature teardown;
   - persistence when the restack journal is cleaned after the HALT clears;
   - removal when a later conflict record is written without a refused tip.
2. Verify RED.
3. Add `refusedTipRefFor(slug)`, and an optional refused-tip parameter to the record write. Add its delete line wherever the conflict parent pin is deleted: `conflictDeleteLines`, `retireRecordedResolution`, the applied-transaction lines, and `restack-refs-cleanup.ts`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] Writing a conflict record with a refused tip sets `refs/conductor/demo/restack/conflict/refused-tip` to that tip in the same `update-ref` transaction as the record and parent pin.
- [test] The applied transaction that consumes a resolution, `retireRecordedResolution`, and feature teardown each delete `refs/conductor/demo/restack/conflict/refused-tip` together with the record and parent pin.
- [test] Cleaning the aborted restack journal after the HALT clears leaves `refs/conductor/demo/restack/conflict/refused-tip`, the record and the parent pin in place.
- [test] A later conflict record written without a refused tip leaves no `refs/conductor/demo/restack/conflict/refused-tip` ref.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-conflict-record.ts` — `refusedTipRefFor`, the write parameter, delete lines
- `src/conductor/src/engine/restack/restack-executor.ts` — applied-transaction delete line
- `src/conductor/src/engine/restack/restack-refs-cleanup.ts` — teardown name
- `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` — lifecycle
- `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` — teardown

**Dependencies:** none

### Task 6: A refused resolver result takes the recoverable restack-conflict halt
**Story:** 1, 3
**Type:** negative-path

**Steps:**
1. Write failing `runRestack` real-git tests in a new `restack-refused-tip.realgit.test.ts`. Use fake resolver tips refused for:
   - `src/other.ts`;
   - deleting `tests/a.test.ts`;
   - restoring `tests/b.test.ts`;
   - a merge-bearing child 2, using #3438's merge-bearing fixture, refused for `src/other.ts`.
2. Verify RED.
3. In the executor's unresolved-conflict halt path, on a `refused` result from `checkResolvedTipOwnership`, write the record with the resolver's tip as the refused tip through `haltRecordedRestackConflict`. Emit `restack_refused` with reason `replay-mismatch`. Write a detail listing the refused-tip ref and each `path (cause)`. Make the halt's `--tip` recipe start from the refused tip when one is recorded, ahead of `flattened-tip`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] For the `src/other.ts` refusal, `runRestack` persists `restack_refused` with reason `replay-mismatch` and `restack_conflict`, and sets `refs/conductor/demo/restack/conflict/refused-tip` to the resolver's tip.
- [test] For the same refusal, the conflict record names child 2 and the parent pin is set; `.pipeline/HALT` carries `Restack-Conflict: 2 <opId>`, both the `--tip` and `--decision` recipes, `refs/conductor/demo/restack/conflict/refused-tip`, and `src/other.ts (unowned)`; and its `git switch -c` recipe line starts from the refused tip's sha.
- [test] For the deletion and old-parent-restore refusals, `.pipeline/HALT` names `tests/a.test.ts (parent-revert)` and `tests/b.test.ts (parent-revert)` respectively, and `restack_refused` carries reason `replay-mismatch`.
- [test] After every refusal, no `feat/` branch or closure ref has moved and the restack journal state is `aborted`.
- [test] For the merge-bearing refusal, the `--tip` recipe starts from the refused tip, and `refs/conductor/demo/restack/conflict/flattened-tip` is still set beside the conflict record.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — the refused branch of the unresolved-conflict halt
- `src/conductor/src/engine/restack/restack-conflict-halt.ts` — the refused tip passed to the record and recipe
- `src/conductor/test/engine/restack/restack-refused-tip.realgit.test.ts` — new

**Dependencies:** Task 1, Task 5

### Task 7: A failed refused-tip pin still halts and says so
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test: the refused-tip ref has changed concurrently, so its compare-and-swap write fails during a refusal.
2. Verify RED.
3. Report the pin failure in the halt detail, as the shipped `conflict record write failed` suffix does.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] When the refused-tip ref write fails, `runRestack` still writes a needs-human `.pipeline/HALT` naming child 2 and `src/other.ts (unowned)`.
- [test] That HALT contains the line `refused tip could not be pinned`, with no `feat/` branch or closure ref moved.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-conflict-halt.ts` — pin-failure suffix
- `src/conductor/test/engine/restack/restack-refused-tip.realgit.test.ts` — pin-failure case

**Dependencies:** Task 6

### Task 8: `stack restack-resolve --tip` uses the resolved-tip rule
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests through `dispatchStackRestackResolve` against a real restack-conflict halt on child 2. Use operator tips that adapt `tests/a.test.ts`, that delete it, and that change `src/other.ts`.
2. Verify RED.
3. In `checkRestackResolution`, replace `checkPathOwnership` with `checkResolvedTipOwnership`, and format refused paths as `path (cause)`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] For the adapting tip, `dispatchStackRestackResolve` returns 0 and `refs/conductor/demo/restack/resolution/c2` names the tip.
- [test] For the deleting tip, `dispatchStackRestackResolve` returns 1 with a message naming `tests/a.test.ts (parent-revert)`, writes no `restack/resolution/c2` ref, and leaves `.pipeline/HALT` byte-identical.
- [test] For the `src/other.ts` tip, `dispatchStackRestackResolve` returns 1 with a message naming `src/other.ts (unowned)`, writes no `restack/resolution/c2` ref, and leaves `.pipeline/HALT` byte-identical.

**Files likely touched:**
- `src/conductor/src/engine/stack-restack-resolve-cli.ts` — the ownership check and refusal message
- `src/conductor/test/engine/stack-restack-resolve-adapted.realgit.test.ts` — new

**Dependencies:** Task 1

### Task 9: Consumption accepts a recorded adapting resolution, including a reused refused tip
**Story:** 3, 4
**Type:** happy-path

**Steps:**
1. Write failing real-git tests for two scenarios. In the first, a resolution recorded through `stack restack-resolve --tip` adapts `tests/a.test.ts`, and the next restack runs. In the second, the Story 3 path runs end to end: a refused resolver tip, then an operator tip built from `refs/conductor/demo/restack/conflict/refused-tip` with the `src/other.ts` change dropped, recorded with `--tip`, and the next restack.
2. Verify RED.
3. Replace `checkPathOwnership` with `checkResolvedTipOwnership` at recorded-resolution consumption in `runRestack`, and in recovery's `resumePlanned`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] The next restack consumes the recorded adapting resolution: it emits `restack_resolution` with `action: consumed`, applies, and persists child 2's `restack_applied` with `adaptedPaths` `["tests/a.test.ts"]`.
- [test] In the end-to-end refused-tip path, `stack restack-resolve --tip` exits 0, the next restack consumes the resolution and applies, and afterwards `refs/conductor/demo/restack/conflict/refused-tip`, `restack/conflict/record` and `restack/conflict/parent` do not exist.
- [test] A recorded resolution whose range, recorded parent and tip are unchanged is never refused at consumption, in either `runRestack` or `resumePlanned`, when it carries an adapted path.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — consumption ownership call
- `src/conductor/src/engine/restack/restack-recovery.ts` — consumption ownership call
- `src/conductor/test/engine/restack/restack-refused-tip.realgit.test.ts` — end-to-end reuse
- `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts` — recovery consumption

**Dependencies:** Task 3, Task 6, Task 8

### Task 10: Journal recovery applies the same rule to a resolver result
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing recovery real-git tests. A restack is interrupted after child 2's resolver hand-off, and `resumePlanned` re-checks a tip that adapts `tests/a.test.ts`, then one that restores `tests/b.test.ts` to old-parent content.
2. Verify RED.
3. Replace recovery's resolver-result `checkPathOwnership` with `checkResolvedTipOwnership`. Carry the resolver tip and per-path causes on its `ownership-refused` result, and route that result through the same refused-tip conflict halt as Task 6.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] For the adapting tip, recovery accepts child 2, the resumed restack applies, and child 2's persisted `restack_applied` lists `tests/a.test.ts` in `adaptedPaths`.
- [test] For the old-parent restore, recovery sets `refs/conductor/demo/restack/conflict/refused-tip` to the resolver tip and writes the conflict record and a `Restack-Conflict: 2` HALT naming `tests/b.test.ts (parent-revert)`, with `restack_refused` reason `replay-mismatch`, and no `feat/` branch or closure ref moves.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-recovery.ts` — resolver-result ownership, the refused result's tip and causes, halt routing
- `src/conductor/test/engine/restack/restack-recovery-refusals.realgit.test.ts` — recovery scenarios

**Dependencies:** Task 3, Task 6

### Task 11: A later ordinary conflict clears a stale refused tip
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing `runRestack` real-git test. A first restack halts with a refused resolver tip. After the halt is cleared, a second restack conflicts on child 2 and the fake resolver does not settle.
2. Verify RED.
3. Make the unsettled-conflict halt write its record with no refused tip, so the Task 5 record write removes the stale ref. Make the recipe start fall back to the shipped base when no refused tip is recorded.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] After the second restack's unsettled conflict halt, `refs/conductor/demo/restack/conflict/refused-tip` does not exist and the conflict record names the second run's opId.
- [test] The second halt's `.pipeline/HALT` `git switch -c` recipe line starts from the same base the shipped conflict halt uses for that child, not from the earlier refused tip's sha.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — the unsettled halt passes no refused tip
- `src/conductor/src/engine/restack/restack-conflict-halt.ts` — recipe fallback
- `src/conductor/test/engine/restack/restack-refused-tip.realgit.test.ts` — the stale refused-tip case

**Dependencies:** Task 6

## Task Dependency Graph

```
Task 1 ──┬─▶ Task 2 ─▶ Task 3 ─┬─▶ Task 4
         │                      ├─▶ Task 9
         │                      └─▶ Task 10
         ├─▶ Task 6 ─┬─▶ Task 7
                     ├─▶ Task 11
Task 5 ──┘           ├─▶ Task 9
                     └─▶ Task 10
Task 1 ──▶ Task 8 ──▶ Task 9
```

## Integration Points

- After Task 2: an adapting resolver result restacks end to end through `runRestack`.
- After Task 6: a refused resolver result halts as an operator-recoverable conflict with its tip preserved.
- After Task 9: the operator reuses a refused tip through `stack restack-resolve --tip` and the next restack.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | no-change | none | Which features restack is unchanged; no restack eligibility code is touched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | no-change | none | `planRestackRanges` and range computation are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | task | task-1, task-2 | `checkPathOwnership` still returns `refused` naming `tests/b.test.ts` for the same `tests/b.test.ts` adaptation, proving the clean-replay rule is unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | task | task-3 | The restack journal's stored child entry has the same keys before and after this change |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | no-change | none | `applyRestackMove` and the worktree sync are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-2 | records child 2 `resolved` in the restack journal, replays child 3 onto child 2's resolved tip |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | no-change | none | The stack preflight order is untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | task | task-4 | leaves child 2's `build_review` and `test_suite` verdicts unsatisfied |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | no-change | none | Restack triggers are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | no-change | none | Cause scopes and the cascade cap are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | no-change | none | Push leases are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | task | task-6 | `restack_refused` carries reason `replay-mismatch` |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | no-change | none | N=1 rebases never reach a restack ownership caller; the N=1 suites are untouched. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D1 | task | task-5 | in the same `update-ref` transaction as the record and parent pin |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D2 | task | task-6 | its `git switch -c` recipe line starts from the refused tip's sha |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D3 | task | task-8 | returns 1 with a message naming `tests/a.test.ts (parent-revert)` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D4 | task | task-9 | is never refused at consumption, in either `runRestack` or `resumePlanned`, when it carries an adapted path |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D5 | task | task-5 | each delete `refs/conductor/demo/restack/conflict/refused-tip` together with the record and parent pin |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D6 | existing | none | A consumed resolution enters the journal as `resolved` in `runRestack`, which then takes the shipped move and transition. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D7 | existing | none | `requestRoutedExit` already passes the conductor's resolver and attempt cap to `runRestack`. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D8 | task | task-6 | `refs/conductor/demo/restack/conflict/flattened-tip` is still set beside the conflict record |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D9 | no-change | none | The conflict record blob's keys are unchanged; the refused tip is a separate ref, not a record field. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D10 | no-change | none | Documentation follows through the `maintain-documentation` pre-finish gate. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
