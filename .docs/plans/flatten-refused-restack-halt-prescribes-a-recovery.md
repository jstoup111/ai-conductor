# Implementation Plan: Stacked restacks recover merge-bearing conflicts automatically (#3438)

**Date:** 2026-11-01
**Stories:** .docs/stories/flatten-refused-restack-halt-prescribes-a-recovery.md
**Conflict check:** Clean as of 2026-11-01 (`.docs/conflicts/2026-11-01-flatten-refused-restack-halt-prescribes-a-recovery.md`)
**Architecture:** `architecture-review-2026-11-01-flatten-refused-restack-halt-prescribes-a-recovery` (APPROVED); amendments to `adr-2026-10-10-stacked-restack-journaled-replay`, `adr-2026-10-25-operator-recorded-restack-conflict-resolution` and `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`

## Summary

The plan has 12 tasks. A stacked restack conflict on a child whose range contains a merge reaches the resolver with the merge flattened. When unsettled, it takes the ordinary conflict halt, whose `--tip` recipe starts from a pinned flattened tip. The restack `flatten_refused` refusal is retired.

## Technical Approach

- **Flattened hand-off.** A new `buildFlattenedHandoff` in `restack/restack-resolver.ts` walks `rev-list --first-parent --reverse oldParent..oldTip` and builds one linear chain rooted at `oldParent` with `commit-tree`, whose final tree equals `oldTip`'s tree. It returns the todo entries, the chain tip, the candidate originals, and the merge audit.
  - **Ordinary commits.** The todo picks the original commit, and its tree is copied into the chain. Halt-record-only and patch-equivalent commits keep their chain entry but get no todo entry, as `replayCandidates` does today.
  - **Merges,** classified by `classifyReplayMerge(git, merge, newParent, 'stacked')`, as `replayChildRange` does. `ancestry-only`: the chain takes an automatic-tree commit and no todo entry. `q-carried`: the chain takes an automatic-tree commit, then a flattened commit of the merge's tree on top, and the todo picks only the flattened commit. `flattened`: one flattened commit of the merge's tree.
  - **Flattened commits.** They keep the merge's author and subject, and append `Flattened-merge: <merge>`, as `replayChildRange` does. A flattened commit has no todo entry or candidate when `merge-tree --write-tree --merge-base <its parent> <newParent> <it>` is clean and yields `newParent`'s tree.
- **Resolver.** `resolveRestackConflict` calls the builder only when the range holds a merge. A range with no merge keeps its current path, so its todo and command do not change. The rewritten list is translated from flattened commits back to their merges, and `RestackConflictResolution` gains an optional `audit`.
- **Entry points.** `runRestack` and `resumePlanned` drop their `mergeInRange` refusal, and the conflict falls through to the shipped decision delivery and resolver. Their merge audit includes the resolver's. `mergeInRange` and recovery's `flatten-refused` result are deleted.
- **Pinned tip.** `RestackConflictRecord` gains an optional `flattenedTip`, written by `writeConflictRecord` in the same compare-and-swap transaction as `refs/conductor/<slug>/restack/conflict/flattened-tip`. A record with no `flattenedTip` deletes any earlier pin. Because the record blob is already verified at the move, no new verify line is needed. `appliedTransactionLines` deletes the pin using the consumed record's value, and `featureConductorRefNames` names it.
- **Halt.** `haltRecordedRestackConflict` runs the builder when the range holds a merge, records its candidate subjects and tip, and passes the tip to `haltRestackConflict` as the recipe's starting point. Every conflict halt, including the `rem-*` body-mismatch halt, therefore gets the same treatment.
- **Local pattern.** `replayChildRange` is the precedent for classification, the trailer and audit reporting. Preserve its `stacked` classification and message form. The hand-off differs only because it needs commits it can `pick`. To find comparable tests, search `test/engine/restack` for `Flattened-merge` and `rebase_merge_audit`.
- **Test isolation.** Tests are real-git, in temporary repositories, and inject a fake resolver at `resolver` on `runRestack` and on recovery's options.
- **Known gap.** A recorded `--tip` goes stale on parent-tree drift until #3557 ships. Task 9's fixture keeps the parent tree unchanged.

## Prerequisites

- #3522 and #3478 (`stack restack-resolve --tip` and `--decision`, the conflict record) are on main.

## Tasks

### Task 1: Build the flattened hand-off for a merge-bearing range
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-flattened-handoff.realgit.test.ts` for every Done-when check below.
2. Implement `buildFlattenedHandoff` in `restack/restack-resolver.ts` as the Technical Approach states. Follow `replayChildRange`'s `stacked` classification, its message form and its audit counts; the variation is that the result is a chain of commits and a todo, not one replayed tip.
3. Run the targeted test file and commit.

**Done when:**
- [test] `buildFlattenedHandoff` over a range of ordinary `C`, not-carried merge `M` and ordinary `T` returns todo entries in that order, whose `C` and `T` entries are the original shas and whose `M` entry has one parent, `M`'s subject and author, and the trailer `Flattened-merge: <M>`.
- [test] `buildFlattenedHandoff`'s chain tip has a tree equal to the range's old tip tree, and `rev-list --min-parents=2 <oldParent>..<chain tip>` returns nothing, for a range holding ancestry-only, Q-carried and not-carried merges.
- [test] For a merge whose side the new parent contains and whose tree equals the automatic merge, `buildFlattenedHandoff` returns no todo entry and no candidate for it, and lists it in `audit.ancestryOnlyMerges`.
- [test] For a not-carried merge whose change the new parent already contains, `buildFlattenedHandoff` returns no todo entry and no candidate for it.
- [test] For a range holding a halt-record-only commit, `buildFlattenedHandoff` returns no todo entry and no candidate for that commit, and the chain tip's tree still equals the old tip's tree.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-resolver.ts` — add the builder
- `src/conductor/test/engine/restack/restack-flattened-handoff.realgit.test.ts` — new tests

**Dependencies:** none

### Task 2: The resolver replays a merge-bearing range from the flattened todo
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolver.realgit.test.ts` for every Done-when check below.
2. Implement: in `resolveRestackConflict`, use the builder's todo and candidates when `rev-list --min-parents=2 oldParent..oldTip` is non-empty. Translate `readRewrites` output from flattened commits to their merges, and return the builder's audit. Leave the no-merge path as it is.
3. Run the targeted test file and commit.

**Done when:**
- [test] With a merge whose side the new parent contains and whose result has a hand edit, `resolveRestackConflict` with a settling fake resolver returns a tip that holds the hand edit and a later main edit to the side's lines, and whose diff from the new parent contains none of the side's already-carried paths.
- [test] With a side-lineage commit `S` of merge `M`, the tip `resolveRestackConflict` returns has no commit with `S`'s subject, the FR-9 acceptance guard still accepts it, and `S`'s subject is absent from the returned candidates' subjects.
- [test] With a settling fake resolver over ordinary `C` and merge `M`, `resolveRestackConflict` returns `rewrites` whose key for the flattened entry is `M`'s sha and whose value is a commit in the returned tip's history, and returns an `audit` listing `M` in `flattenedMerges`.
- [test] With an ancestry-only merge in the range, a settled tip with no commit carrying that merge's subject passes the FR-9 acceptance guard in `resolveRestackConflict`.
- [test] With a stacked child with no merge in its range and a settling fake resolver, when the restack runs, then the todo `resolveRestackConflict` writes lists the child's original commits by their own shas and the returned `audit` is undefined.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-resolver.ts` — use the builder, translate rewrites, return the audit
- `src/conductor/test/engine/restack/restack-resolver.realgit.test.ts` — new cases

**Dependencies:** Task 1

### Task 3: `runRestack` hands merge-bearing conflicts to the resolver for both causes
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Replace the flatten refusal scenarios: move the fixture of `src/conductor/test/engine/restack/restack-flatten-refused.realgit.test.ts` into a new `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts`, delete the old file, and write failing tests for every Done-when check below. Update the refusal expectations in `restack-conflict-record.realgit.test.ts` and `restack-halt-record-refusals.realgit.test.ts` to the ordinary conflict halt.
2. Implement: in `runRestack`, remove the `mergeInRange` branch, and add `resolution.audit` to `mergeAudit` after an accepted resolution.
3. Run the targeted test files and commit.

**Done when:**
- [test] A merge-bearing conflict through `runRestack` with cause `base-refresh` dispatches the fake resolver, whose recorded todo has one entry each for `C`, `M` and `T` in that order, and no `restack_refused` event is emitted.
- [test] A merge-bearing conflict through `runRestack` with cause `feature-repair`, entered through the routed exit `requestRoutedExit`, dispatches the fake resolver and emits no `restack_refused` event.
- [test] After the fake resolver settles a merge-bearing conflict and `runRestack` applies, `feat/c2/demo` holds the hand edit in `hand.txt` and `Q`'s content, `rev-list --min-parents=2` over child 2's new range is empty, and the commit with `M`'s subject carries the trailer `Flattened-merge: <M>`.
- [test] After that restack applies, the event stream holds exactly one `rebase_merge_audit` listing `M` in `flattenedMerges`, and the journal's rewrites for child 2 map `M` to its rebuilt commit.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts` — remove the refusal, merge the audit
- `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` — new tests
- `src/conductor/test/engine/restack/restack-flatten-refused.realgit.test.ts` — deleted
- `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` — updated expectation
- `src/conductor/test/engine/restack/restack-halt-record-refusals.realgit.test.ts` — updated expectation

**Dependencies:** Task 2

### Task 4: Journal recovery hands merge-bearing conflicts to the resolver
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Update the refusal scenario in `src/conductor/test/engine/restack/restack-recovery.realgit.test.ts` and write failing tests for every Done-when check below.
2. Implement: remove `resumePlanned`'s `flatten-refused` result and its halt, delete `mergeInRange`, and emit `rebase_merge_audit` when a recovered restack that used `resolution.audit` applies.
3. Run the targeted test file and commit.

**Done when:**
- [test] A planned journal whose replay hits a merge-bearing conflict, resumed by journal recovery through `resumePlanned`, dispatches the fake resolver and emits no `restack_refused` event.
- [test] When the fake resolver settles that conflict and the recovered restack applies, the child holds the hand edit and `Q`'s content, and exactly one `rebase_merge_audit` lists `M` in `flattenedMerges`.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-recovery.ts` — remove the refusal, emit the audit
- `src/conductor/src/engine/restack/restack-executor.ts` — delete `mergeInRange`
- `src/conductor/test/engine/restack/restack-recovery.realgit.test.ts` — updated scenario and new cases

**Dependencies:** Task 2

### Task 5: The acceptance guards reject a bad settled result on a merge-bearing child
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` for every Done-when check below.
2. Implement whatever the tests expose; the shipped FR-9 and path-ownership guards are expected to apply once Task 3 reaches them.
3. Run the targeted test file and commit.

**Done when:**
- [test] A fake resolver that drops the commit with `M`'s subject has its result rejected by the FR-9 guard, `.pipeline/HALT` begins `restack conflict child 2`, and `for-each-ref refs/heads/feat/ refs/conductor/demo/closed/` output is unchanged.
- [test] A fake resolver whose result changes a path outside child 2's owned paths makes `checkPathOwnership` refuse it, `.pipeline/HALT` begins `restack refused (replay-mismatch) child 2` and names that path, and `for-each-ref refs/heads/feat/ refs/conductor/demo/closed/` output is unchanged.

**Files likely touched:**
- `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` — new cases

**Dependencies:** Task 3

### Task 6: Emptied merges, a missing resolver and an exhausted budget are handled
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` for every Done-when check below.
2. Implement whatever the tests expose in `runRestack`'s fall-through.
3. Run the targeted test file and commit.

**Done when:**
- [test] With a flattened merge whose change the new parent already contains, `runRestack` gives the fake resolver a todo with no entry for that merge, the temporary rebase does not stop on an empty pick and reaches a settled tip, and that merge's subject is absent from the recorded candidate subjects when a separate unsettled run writes the conflict record.
- [test] `runRestack` with no `resolver` option on a merge-bearing conflict writes `.pipeline/HALT` beginning `restack conflict child 2` and containing `restack resolver unavailable`, and `for-each-ref refs/heads/feat/ refs/conductor/demo/closed/` output is unchanged.
- [test] With `resolverCap` 2 and a fake resolver that never settles, `runRestack` dispatches the resolver at most 2 times and writes `.pipeline/HALT` beginning `restack conflict child 2`.

**Files likely touched:**
- `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` — new cases

**Dependencies:** Task 3

### Task 7: Pin the flattened tip with the conflict record
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` for every Done-when check below.
2. Implement: add `conflictFlattenedTipRefFor` and the optional `flattenedTip` field to the record parser, writer and the transaction. Delete the pin from `appliedTransactionLines` for a consumed record that names it, and add it to `featureConductorRefNames`. Follow the parent pin's compare-and-swap shape.
3. Run the targeted test file and commit.

**Done when:**
- [test] `writeConflictRecord` with a `flattenedTip` updates `refs/conductor/demo/restack/conflict/flattened-tip` to that sha in the same transaction as the record and parent pin, and `readConflictRecord` returns the field.
- [test] A second `writeConflictRecord` with a different `flattenedTip` replaces the pin, and one with no `flattenedTip` deletes the pin; a stored record without the field still parses.
- [test] When the pin changed concurrently, `writeConflictRecord` returns `stale`, leaves the record and parent pin unchanged, and writes nothing.
- [test] `featureConductorRefNames('demo')` contains `refs/conductor/demo/restack/conflict/flattened-tip`, and feature teardown deletes that ref by name after a merge-bearing halt.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-conflict-record.ts` — field, ref helper, transaction
- `src/conductor/src/engine/restack/restack-executor.ts` — applied deletion in `appliedTransactionLines`
- `src/conductor/src/engine/restack/restack-refs-cleanup.ts` — name the ref
- `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` — new cases

**Dependencies:** none

### Task 8: The unsettled merge-bearing halt prints a recovery that keeps the merge's content
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` and `src/conductor/test/engine/restack/restack-recovery-conflict-recipe.realgit.test.ts` for every Done-when check below.
2. Implement: in `haltRecordedRestackConflict`, when the range holds a merge, run `buildFlattenedHandoff`, record its candidate subjects and `flattenedTip`, and pass the tip to `haltRestackConflict`'s `recipe` as the switch starting point. A builder failure joins the existing `conflict record write failed` text.
3. Run the targeted test files and commit.

**Done when:**
- [test] An unsettled merge-bearing conflict through `runRestack` writes `.pipeline/HALT` beginning `restack conflict child 2` and containing `Restack-Conflict: 2 <opId>`, `git switch -c restack-resolve/demo/c2 <flattened-tip>`, `git rebase --onto <new-parent> <old-parent>`, the `--tip` command and the `--decision` command, with real shas, and journal recovery's halt carries the same lines.
- [test] After that halt, the conflict record names child 2 with its candidate subjects, the parent pin is set, `refs/conductor/demo/restack/conflict/flattened-tip` equals the printed tip, the tip's tree equals child 2's old tip tree, and `rev-list --min-parents=2 <old-parent>..<flattened-tip>` is empty.
- [test] That HALT text contains none of `resolve the conflict on child branch`, `feat/c2/demo`, `feat/daemon-demo` and `refs/conductor/demo/closed/`, and `for-each-ref refs/heads/feat/ refs/conductor/demo/closed/` output is unchanged by the restack.
- [test] A merge-bearing `rem-*` body-mismatch halt records candidate subjects with no side-lineage commit subject, and its recipe starts from the flattened tip.
- [test] When the flattened tip pin changed concurrently, the needs-human `.pipeline/HALT` is still written and contains `conflict record write failed`, and `for-each-ref refs/heads/feat/ refs/conductor/demo/closed/` output is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-conflict-halt.ts` — run the builder, record the tip
- `src/conductor/src/engine/restack/restack-move.ts` — recipe starting point
- `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` — new cases
- `src/conductor/test/engine/restack/restack-recovery-conflict-recipe.realgit.test.ts` — new case

**Dependencies:** Tasks 1, 3, 7

### Task 9: The printed `--tip` recipe works when followed literally
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` for every Done-when check below. Parse the commands from `.pipeline/HALT` and run them, resolving `shared.txt` by hand. Keep the parent tree unchanged, because #3557 owns parent-tree drift.
2. Implement whatever the tests expose.
3. Run the targeted test file and commit.

**Done when:**
- [test] Following the switch and rebase lines parsed from the HALT, settling `shared.txt`, and calling `dispatchStackRestackResolve` with `--tip` returns 0, and the next `runRestack` emits `restack_resolution` with `action: consumed` and leaves `feat/c2/demo` holding the hand edit in `hand.txt` and `Q`'s content.
- [test] After that restack applies, `refs/conductor/demo/restack/conflict/flattened-tip`, `restack/conflict/record` and `restack/conflict/parent` are deleted.
- [test] Two successive unsettled merge-bearing `runRestack` runs onto different new parents leave the record and parent pin naming the second run's new parent and the `flattened-tip` ref equal to the tip printed by the second HALT.
- [test] A tip built by plain `git rebase --onto` of child 2's merge-bearing old tip makes `dispatchStackRestackResolve` return 1 with a message naming `M`'s missing subject, writes no `restack/resolution/c2` ref, and leaves `.pipeline/HALT` in place.

**Files likely touched:**
- `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` — new cases

**Dependencies:** Task 8

### Task 10: A recorded decision settles a merge-bearing conflict on the next restack
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` for every Done-when check below.
2. Implement whatever the test exposes.
3. Run the targeted test file and commit.

**Done when:**
- [test] After an unsettled merge-bearing halt, `dispatchStackRestackResolve` with `--decision "<answer>"` returns 0, and the next `runRestack` passes that answer to the fake resolver as `operatorDecision`.
- [test] When the fake resolver then settles the conflict, that restack applies, `feat/c2/demo` holds the hand edit in `hand.txt`, and `restack_decision` with `action: applied` is emitted.

**Files likely touched:**
- `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` — new cases

**Dependencies:** Task 8

### Task 11: Retire `flatten_refused` as a restack refusal reason
**Story:** Story 1
**Type:** refactor

**Steps:**
1. Remove `flatten_refused` from `RestackRefusalReason` and from the restack reason lists in `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/engine/event-sinks.sweepG1.test.ts` and `src/conductor/test/structural/restack-refused-emitter.sweepG1.test.ts`. Keep `RebaseOutcome`'s `flatten_refused` kind.
2. Run the targeted test files and the typecheck, and commit.

**Done when:**
- `restack-refused-emitter.sweepG1.test.ts` passes with a reason list that omits `flatten_refused`, and the `src/conductor` typecheck reports no errors.
- `RebaseOutcome` still declares the `flatten_refused` kind, and `rebase-flatten.test.ts` passes unchanged.

**Files likely touched:**
- `src/conductor/src/types/restack.ts` — remove the value
- `src/conductor/test/engine/event-sinks.test.ts` — reason list
- `src/conductor/test/engine/event-sinks.sweepG1.test.ts` — reason list
- `src/conductor/test/structural/restack-refused-emitter.sweepG1.test.ts` — reason list

**Dependencies:** Tasks 3, 4

### Task 12: Restacks without a merge conflict and N=1 rebases stay unchanged
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` for the parity checks below, and run the existing no-merge and N=1 test files with their expectations unedited.
2. Implement whatever the tests expose.
3. Run the targeted test files and commit.

**Done when:**
- [test] An unsettled conflict on a stacked child with no merge in its range writes `.pipeline/HALT` whose text equals, line by line, `restack conflict child 2`, the detail lines, `Restack-Conflict: 2 <opId>`, `git switch -c restack-resolve/demo/c2 <old-tip>`, `git rebase --onto <new-parent> <old-parent>`, the `--tip` command and the `--decision` command, a conflict record whose keys are exactly `opId`, `child`, `oldParent`, `oldTip`, `newParent`, `newParentTree`, `candidateSubjects`, `commit` and `paths`, and no `flattened-tip` ref, and `restack-conflict-record.realgit.test.ts`'s no-merge cases pass with unedited expectations.
- [test] A merge-bearing child whose plumbing replay is clean is replayed by `runRestack` with the fake resolver dispatched zero times, carries `Flattened-merge: <M>` as `replayChildRange` writes it, and leaves no `flattened-tip` ref after applying.
- `rebase-flatten.test.ts` and `rebase-flatten-realgit.test.ts` pass with unedited expectations: for a feature without children whose first dry-run conflict falls on a flattened merge, `performRebase` returns `flatten_refused` with its recipe, and the gated resolver is not dispatched.
- [test] For a stacked child with no merge in its range, a recording git runner shows `resolveRestackConflict` starts its rebase with exactly `rebase -i --onto <new-parent> <old-parent>` and no `--empty` argument.
- `n1-restack-absence.test.ts` passes with unedited expectations.

**Files likely touched:**
- `src/conductor/test/engine/restack/restack-merge-bearing-conflict.realgit.test.ts` — new cases

**Dependencies:** Task 3

## Task Dependency Graph

```text
Task 1 ─▶ Task 2 ─▶ Task 3 ─▶ Task 5, Task 6, Task 12
                 └▶ Task 4
Task 3, Task 4 ─▶ Task 11
Task 7 ─┐
Task 1, Task 3 ─▶ Task 8 ─▶ Task 9, Task 10
```

## Integration Points

- After Task 3: a merge-bearing conflict settles end to end through `runRestack`.
- After Task 4: the same holds through journal recovery.
- After Task 9: a human's `--tip` recovery works through `stack restack-resolve` and the next restack.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | no-change | none | Which features restack is unchanged; Task 12 keeps the N=1 suites unedited. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | no-change | none | `planRestackRanges` and range computation are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | task | task-1 | `buildFlattenedHandoff`'s chain tip has a tree equal to the range's old tip tree |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | no-change | none | The journal gains no field; the pinned tip travels in the conflict record blob the move already verifies. |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | no-change | none | `applyRestackMove` and the worktree sync are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-3 | dispatches the fake resolver, whose recorded todo has one entry each for `C`, `M` and `T` in that order |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | no-change | none | The stack preflight order is untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | no-change | none | A resolved child takes the shipped transitions. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | no-change | none | Restack triggers are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | no-change | none | Cause scopes and the cascade cap are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | no-change | none | Push leases are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | task | task-11 | passes with a reason list that omits `flatten_refused` |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | task | task-12 | `n1-restack-absence.test.ts` passes with unedited expectations. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D1 | task | task-7 | in the same transaction as the record and parent pin |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D2 | task | task-8 | `git switch -c restack-resolve/demo/c2 <flattened-tip>` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D3 | task | task-9 | makes `dispatchStackRestackResolve` return 1 with a message naming `M`'s missing subject |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D4 | task | task-9 | emits `restack_resolution` with `action: consumed` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D5 | task | task-9 | `refs/conductor/demo/restack/conflict/flattened-tip`, `restack/conflict/record` and `restack/conflict/parent` are deleted |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D6 | existing | none | A consumed resolution enters the journal as `resolved` in `runRestack`, which then takes the shipped move and transition. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D7 | existing | none | `requestRoutedExit` already passes the conductor's resolver and attempt cap to `runRestack`. |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D8 | task | task-8 | `refs/conductor/demo/restack/conflict/flattened-tip` equals the printed tip |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D9 | task | task-12 | whose keys are exactly `opId`, `child`, `oldParent`, `oldTip`, `newParent`, `newParentTree`, `candidateSubjects`, `commit` and `paths` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D10 | no-change | none | Documentation follows through the `maintain-documentation` pre-finish gate. |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D1 | task | task-8 | the `--tip` command and the `--decision` command, with real shas |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D2 | no-change | none | The `--decision` command and its refusals are untouched. |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D3 | task | task-10 | passes that answer to the fake resolver as `operatorDecision` |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D4 | no-change | none | A decision's ref lifecycle is untouched. |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D5 | no-change | none | The `restack_decision` event is untouched. |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D6 | task | task-12 | `restack-conflict-record.realgit.test.ts`'s no-merge cases pass with unedited expectations |
| adr-2026-10-31-operator-decision-for-stacked-restack-conflicts#D7 | no-change | none | Documentation follows through the `maintain-documentation` pre-finish gate. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
