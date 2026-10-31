# Implementation Plan: Halt records committed on stacked child branches make every restack conflict

**Date:** 2026-10-28
**Design:** .docs/decisions/architecture-review-2026-10-28-halt-records-committed-on-stacked-child-branches-m.md
**Stories:** .docs/stories/halt-records-committed-on-stacked-child-branches-m.md
**Conflict check:** Clean as of 2026-10-28 (.docs/conflicts/halt-records-committed-on-stacked-child-branches-m.md)

## Summary

Every stacked restack replay path treats halt-record commits as bookkeeping, so they never reach
the provider resolver or conflict across children. The two paths are `replayChildRange` (plumbing)
and `resolveRestackConflict` (the `git rebase` fallback).

- Neither path replays a halt-record-only commit.
- When both sides changed the halt record, the side being rebuilt wins.
- One `halt record: <slug>` commit carries the newer record at the tip.
- Each omitted commit still gets a rewrite entry, so an unentered leaf can move.

The plan has 9 tasks.

## Technical Approach

- **One shared module: `src/conductor/src/engine/restack/halt-record-bookkeeping.ts`
  (architecture-review C1).** It owns every halt-record rule; neither replay path keeps its own
  copy. It exports:
  - `haltRecordPathFor(slug)`, which returns `.docs/halted/<slug>.md`.
  - `isHaltRecordOnlyCommit(git, commit, slug)`. A commit qualifies when it has exactly one parent,
    and its `diff-tree --no-commit-id --name-only -r` path set is non-empty and every path equals
    `haltRecordPathFor(slug)`. A merge never qualifies; it goes through the existing merge
    classification. Apart from the merge exclusion, this is the predicate `isHaltRecordOnly` in
    `restack-plan.ts` applies, and this feature leaves that function in place.
  - `haltRecordTime(text)`. It reads the `Resolved at:` line, or the `Halted at:` line when none
    is present, and parses it as an ISO-8601 time. It returns `undefined` when neither line parses.
  - `chooseHaltRecord(parentText, rangeText)`, which returns `'parent'` or `'range'`:
    - `'range'` when the parent has no record and the range has one;
    - `'range'` when both times parse and the range's is strictly later;
    - `'range'` when only the range's time parses;
    - `'parent'` in every other case: a tie, the parent's time later, only the parent's time
      parses, neither parses, or the range has no record.
  - `carryNewestHaltRecord(git, { range, newParent, slug, tip, stamp })`. It returns `{ tip, added }`.
    - **The winner.** `rangeTouchedRecord` is whether the halt path is among the child's owned
      paths, as `ownedPaths(range, newParent, git)` in `restack-ownership.ts` computes them. That
      function is exported for this purpose and is the same one `checkPathOwnership` uses, so a path
      a carried merge supplied automatically is not owned. When it is false, the winner is `newParent:<path>`. When it is true, the
      winner is `chooseHaltRecord(newParent:<path>, oldTip:<path>)`.
    - **When a commit is added.** Only when `tip:<path>` differs from the winner (in bytes or in
      presence). This includes a kept commit having cleanly applied an older record.
    - **How it is built.** Off-worktree, with a temporary index: `read-tree <tip>`, then
      `update-index --cacheinfo` with the winner's blob (or `--force-remove` when the winner has
      no record), `write-tree`, and `commit-tree -p <tip>`.
    - **Its message** is exactly `halt record: <slug>`, with no trailer. Replay itself appends
      none, and an attribution-dependent trailer would make a recovered replay differ.
    - **Its author and committer** both come from the journal's committer stamp, so a recovered
      replay produces the same SHA.
    - It is signed with `-S` when `commit.gpgSign` is set.
  - `mapOmittedHaltRecordCommits(order, omitted, rewrites, newParent, finalTip)`. It adds a rewrite
    entry for each omitted commit:
    - the rewrite of the nearest earlier commit in `order` that has one (patch-equivalent,
      ancestry-only and newly-empty commits have none);
    - `newParent` when no earlier commit has one;
    - `finalTip` when no later commit in `order` has one.
- **Plumbing replay (`restack-replay.ts`).**
  - `ReplayChildRangeOptions` gains an optional `haltRecordSlug`. Without it, behavior is unchanged
    (Story 3).
  - With it, each commit is classified before its patch-id check, and halt-record-only commits are
    skipped.
  - `upperChildHaltRecordTree` is replaced by an accumulator pin: when the only conflict path is the
    halt record, the merged tree takes the accumulator's blob.
  - A conflict that names any other path still throws `merge-tree failed for <sha>:`, as today.
  - After the loop, `carryNewestHaltRecord` runs, and then `mapOmittedHaltRecordCommits` maps the
    omitted commits.
- **Resolver fallback (`restack-resolver.ts`).**
  - `ResolveRestackConflictOptions` gains an optional `haltRecordSlug`, and `replayCandidates`
    drops halt-record-only commits. FR-9's `expectedSubjects` already comes from the candidates
    (`candidateSubjects` into `resolveRebaseConflicts`, `rebase.ts` `subjectsBefore`), so omitted
    commits are never expected.
  - The rebase environment adds `core.attributesFile=<helpers>/attributes` (whose content is
    `<halt path> merge=conductor-halt-record`) and `merge.conductor-halt-record.driver=true`.
    These sit beside the existing `core.hooksPath` entry through `GIT_CONFIG_COUNT`, so when both
    sides changed the record, git keeps the side being rebuilt and never reports it as conflicted
    (C2; tested with real git during architecture review).
  - The accepted tip then passes through `carryNewestHaltRecord` and `mapOmittedHaltRecordCommits`.
- **Ownership (`restack-ownership.ts`).** Export the existing `ownedPaths` unchanged. The winner rule
  and the acceptance check then share one definition of "the range touched the record".
- **Callers (`restack-executor.ts`, `restack-recovery.ts`).**
  - Both `runRestack` and planned journal recovery pass `haltRecordSlug: slug` to both functions.
    The recovery slug is `current.slug`.
  - Both `replayConflict` copies remove `haltRecordPathFor(slug)` from the hand-off path set, so the
    conflict halt and `restack_conflict` never name the halt record.
  - No other caller logic changes. Path ownership (`checkPathOwnership`) still runs on the returned
    tip, which already includes the bookkeeping commit.
- **Local pattern basis.** The precedent is the rem-* plan union (`unionPlanConflictTree` in
  `restack-replay.ts`): a deterministic engine resolution of one known bookkeeping path, built in a
  temporary index off-worktree, before any resolver call. Preserve the temporary-index construction
  and the `requiredSha` checks. The allowed variation is that this rule applies on every stacked
  restack, not only a routed repair. To find it, search for `unionPlanConflictTree`,
  `upperChildHaltRecordTree` and `GIT_INDEX_FILE` in `src/conductor/src/engine/restack/`.
- **Out of scope (track boundary).** No change to `halt-record.ts`, `halt-marker.ts`,
  `performRebase` in `rebase.ts`, or the halt-record-only tolerances in `child-cursor.ts`,
  `routing/operator-round.ts`, `restack-plan.ts`, `restack-recovery.ts`'s `isHaltRecordOnlyDescendant`,
  or `stack-commit-guard-cli.ts` (C4).

## Prerequisites

- **Sequenced after #3421.** This spec lands with a depends-on #3421 edge, so the daemon builds it
  after #3421's build, which edits `restack-resolver.ts` and `restack-executor.ts`. #3421 composes
  its recorded subject list from `replayCandidates`, so filtering there covers both. If #3421 has
  changed `replayConflict` or the conflict-halt path set by the time this builds, apply the
  halt-path removal (Task 6) to the path set that the conflict halt and `restack_conflict` use.
- Worktree vitest runs need `node_modules/.bin` on `PATH` (`PATH=$PWD/src/conductor/node_modules/.bin:$PATH`).

## Tasks

### Task 1: Choose the newer of two halt records
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/restack/halt-record-bookkeeping.test.ts` for every Done-when check. Build record text with `renderHaltRecord` and `supersedeHaltRecordText` from `halt-record.ts`, so the fixtures carry the real `Halted at:` and `Resolved at:` lines.
2. Verify RED.
3. Implement `haltRecordPathFor`, `haltRecordTime` and `chooseHaltRecord` in `src/conductor/src/engine/restack/halt-record-bookkeeping.ts`, as Technical Approach states.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] chooseHaltRecord returns 'parent' for a parent record resolved at 2026-10-26T12:30:00.000Z against a range record halted at 2026-10-26T11:00:00.000Z, and 'range' for a parent record resolved at 2026-10-26T10:00:00.000Z against a range record halted at 2026-10-26T12:05:00.000Z, as asserted in halt-record-bookkeeping.test.ts.
- [test] chooseHaltRecord returns 'parent' for two records with the same time, 'parent' when only the parent's time parses, 'range' when only the range's time parses, and 'parent' when neither parses, as asserted in halt-record-bookkeeping.test.ts.
- [test] chooseHaltRecord returns 'range' when the parent text is undefined and the range text is a halted record, 'parent' when the range text is undefined, and haltRecordTime reads `Resolved at:` in preference to `Halted at:` on a superseded record, as asserted in halt-record-bookkeeping.test.ts.

**Files likely touched:**
- src/conductor/src/engine/restack/halt-record-bookkeeping.ts — record time and newest-record choice
- src/conductor/test/engine/restack/halt-record-bookkeeping.test.ts — unit tests

**Dependencies:** none

### Task 2: Classify halt-record-only commits, add the tip bookkeeping commit, map omitted commits
**Story:** Story 1, Story 2
**Type:** infrastructure

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/restack/halt-record-bookkeeping.realgit.test.ts` for every Done-when check. Use a temporary repository with `user.email` and `user.name` configured.
2. Verify RED.
3. Implement `isHaltRecordOnlyCommit`, `carryNewestHaltRecord` and `mapOmittedHaltRecordCommits` in `halt-record-bookkeeping.ts`, as Technical Approach states. Export the existing `ownedPaths` from `restack-ownership.ts` unchanged, and use it for `rangeTouchedRecord`. Follow the local temporary-index pattern of `unionPlanConflictTree` in `restack-replay.ts`: `mkdtemp`, `GIT_INDEX_FILE`, `read-tree`, `update-index --cacheinfo`, `write-tree`, `requiredSha`, and removal of the directory in `finally`. Search hint: `GIT_INDEX_FILE` in `src/conductor/src/engine/restack/`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] isHaltRecordOnlyCommit returns true for a commit changing only `.docs/halted/demo.md`, and false for a commit changing `.docs/halted/demo.md` and `.docs/plans/<stem>.md`, a commit changing only `.docs/halted/other.md`, an empty commit, and a merge commit whose diff against either parent names only `.docs/halted/demo.md`, all with slug `demo`, as asserted in halt-record-bookkeeping.realgit.test.ts.
- [test] carryNewestHaltRecord with a newer range record returns added true and a tip whose parent is the input tip, whose full message (`git log -1 --format=%B`) is exactly `halt record: demo` with no trailer, whose author and committer name, email and date equal the supplied stamp, whose `diff-tree` names only `.docs/halted/demo.md`, and whose record equals the range old tip's record byte-for-byte, as asserted in halt-record-bookkeeping.realgit.test.ts.
- [test] for a range whose only change to `.docs/halted/demo.md` arrives automatically through a q-carried merge (so `ownedPaths` excludes it) while the new parent carries an older record, carryNewestHaltRecord returns added false and the tip keeps the new parent's record, and checkPathOwnership on that tip returns accepted, as asserted in halt-record-bookkeeping.realgit.test.ts.
- [test] carryNewestHaltRecord returns added false and the input tip unchanged when the range never touched the record (even though the old tip's record is newer than the new parent's) and the tip already carries the new parent's record, and when the parent wins and the tip already carries it; when the parent wins but the tip carries an older record a kept commit applied, it returns added true and a tip carrying the parent's record byte-for-byte, as asserted in halt-record-bookkeeping.realgit.test.ts.
- [test] mapOmittedHaltRecordCommits maps an omitted commit between kept commits K1 and K2 to K1's rewrite, a leading omitted commit to newParent, an omitted commit whose only earlier commit has no rewrite (patch-equivalent) to newParent, and a trailing omitted commit to finalTip, as asserted in halt-record-bookkeeping.realgit.test.ts.

**Files likely touched:**
- src/conductor/src/engine/restack/halt-record-bookkeeping.ts — predicate, tip commit, omitted mapping
- src/conductor/src/engine/restack/restack-ownership.ts — export `ownedPaths`
- src/conductor/test/engine/restack/halt-record-bookkeeping.realgit.test.ts — real-git tests

**Dependencies:** Task 1

### Task 3: Plumbing replay leaves halt-record-only commits out and pins the halt path
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Rewrite the two tests in `src/conductor/test/engine/restack/restack-halt-record.realgit.test.ts` ("keeps the upper child halt record when the conflict is confined to that record" and "leaves a mixed halt-record and source conflict for the resolver hand-off") so they assert the new behavior in the Done-when checks, and add the remaining checks as new tests. Call `replayChildRange(..., { haltRecordSlug: 'demo' })`.
2. Verify RED.
3. In `restack-replay.ts`, add `haltRecordSlug?: string` to `ReplayChildRangeOptions`. When it is set:
   - classify each first-parent commit with `isHaltRecordOnlyCommit`, and skip halt-record-only commits;
   - replace `upperChildHaltRecordTree` with a pin that takes the accumulator's blob (use the same temporary-index pattern);
   - after the loop, call `mapOmittedHaltRecordCommits` so every omitted commit has a rewrite.
   Leave `merge-tree failed for <sha>:` unchanged for any conflict that names a non-halt path.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] replayChildRange with haltRecordSlug over a range of 2 code commits and 2 halt-record-only commits returns a tip whose `newParent..tip` log contains both code subjects and no halt-record-only commit, as asserted in restack-halt-record.realgit.test.ts.
- [test] replayChildRange replays a kept commit that changes `src/b.ts` and the halt record onto a parent that also changed the halt record without throwing, and the new tip has the commit's `src/b.ts` content, the parent's halt record, and one replayed commit with the original subject and body, as asserted in restack-halt-record.realgit.test.ts.
- [test] replayChildRange keeps a commit changing `.docs/halted/demo.md` and `.docs/plans/<stem>.md` (its plan change is present at the new tip) and a commit changing only `.docs/halted/other.md`, and a merge commit in the range whose changes include `.docs/halted/demo.md` is classified by the existing merge handling rather than omitted, as asserted in restack-halt-record.realgit.test.ts.
- [test] replayChildRange with a conflict on the halt record and `src/c.ts` in one commit still rejects with `merge-tree failed for <sha>:`, as asserted in restack-halt-record.realgit.test.ts.
- [test] the returned rewrites map a halt-record-only commit after the last kept commit to the returned tip, and one between two kept commits to the rewrite of the kept commit before it; runRestack passes these rewrites to updateRestackChildStatus unchanged, as asserted in restack-halt-record.realgit.test.ts.

**Files likely touched:**
- src/conductor/src/engine/restack/restack-replay.ts — classification, accumulator pin, omitted mapping
- src/conductor/test/engine/restack/restack-halt-record.realgit.test.ts — rewritten and new tests

**Dependencies:** Task 2

### Task 4: Plumbing replay carries the newest halt record to the tip
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-halt-record-newest.realgit.test.ts` for every Done-when check. Build records with `renderHaltRecord` and `supersedeHaltRecordText`, so they carry real ISO times. Replay child 2 onto a parent built from child 1 with `replayChildRange(..., { haltRecordSlug: 'demo' })`.
2. Verify RED.
3. In `replayChildRange`, before `mapOmittedHaltRecordCommits`, call `carryNewestHaltRecord` with the range, `newParent`, the slug, the accumulator tip and the replay's committer stamp. Map trailing omitted commits to the final tip.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] with a parent record resolved at 2026-10-26T12:30:00.000Z and a child old-tip record halted at 2026-10-26T11:00:00.000Z, replayChildRange returns a tip carrying the parent's record byte-for-byte and adds no `halt record: demo` commit; with the parent resolved at 2026-10-26T10:00:00.000Z and the child halted at 2026-10-26T12:05:00.000Z, the tip carries the child's record byte-for-byte through exactly one top commit with subject `halt record: demo`, as asserted in restack-halt-record-newest.realgit.test.ts.
- [test] replayChildRange adds no halt-record commit and returns a tip whose `.docs/halted/demo.md` is byte-identical to the parent's record when the two records have the same time, when only the parent's time parses (child 2's `Halted at:` unreadable), and when neither time parses, and adds one `halt record: demo` commit carrying the child's record byte-for-byte when only the child's time parses, as asserted in restack-halt-record-newest.realgit.test.ts.
- [test] when child 2's range never changed `.docs/halted/demo.md` and the parent's record is older than child 2's old-tip record, replayChildRange adds no halt-record commit, and checkPathOwnership on the returned tip returns accepted with no `.docs/halted/demo.md` path, as asserted in restack-halt-record-newest.realgit.test.ts.
- [test] when the parent has no `.docs/halted/demo.md` and child 2's range created it, the replayed tip carries child 2's old-tip record byte-for-byte, as asserted in restack-halt-record-newest.realgit.test.ts.
- [test] when the parent's record is resolved at 2026-10-26T12:30:00.000Z and child 2's range holds a kept commit that changes `src/m.ts` and cleanly replaces that unchanged record with one halted at 2026-10-26T11:00:00.000Z, replayChildRange returns a tip carrying the parent's record byte-for-byte, restored by exactly one top `halt record: demo` commit, with the kept commit's `src/m.ts` change present, as asserted in restack-halt-record-newest.realgit.test.ts.

**Files likely touched:**
- src/conductor/src/engine/restack/restack-replay.ts — call carryNewestHaltRecord at the tip
- src/conductor/test/engine/restack/restack-halt-record-newest.realgit.test.ts — newest-record tests

**Dependencies:** Task 3

### Task 5: Resolver fallback never sees halt-record bookkeeping
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolver-halt-record.realgit.test.ts` for every Done-when check. Call `resolveRestackConflict` with `haltRecordSlug: 'demo'` and a stub resolver that records `context.conflicts`, then resolves `src/a.ts` by taking the child's side with `git checkout --theirs` plus `git add`. Before returning `{ resolved: true }`, the stub must run `git rebase --continue` in `context.projectRoot` with `context.environment`, as the stubs in `restack-conflict.sweepG2.realgit.test.ts` do (`resolveRebaseConflicts` retries while rebase state is still active). Search hint: `'rebase', '--continue'` in `src/conductor/test/engine/restack/`.
2. Verify RED.
3. In `restack-resolver.ts`:
   - add `haltRecordSlug?: string` to `ResolveRestackConflictOptions`;
   - make `replayCandidates` skip commits for which `isHaltRecordOnlyCommit` is true;
   - write `<helpers>/attributes` with the line `.docs/halted/<slug>.md merge=conductor-halt-record`, and raise `GIT_CONFIG_COUNT` to 3, adding `core.attributesFile` and `merge.conductor-halt-record.driver=true` beside `core.hooksPath`;
   - after an accepted tip, apply `carryNewestHaltRecord` and `mapOmittedHaltRecordCommits` to the returned `tip` and `rewrites`.
   Write nothing to the repository's config or attributes.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] for a range holding a code commit conflicting on `src/a.ts` plus 4 halt-record-only commits, resolveRestackConflict returns candidates (the engine-written rebase todo) containing none of the 4 halt-record-only commits, and every recorded `context.conflicts` equals exactly `['src/a.ts']`, as asserted in restack-resolver-halt-record.realgit.test.ts.
- [test] that resolution returns outcome kind `changed` (FR-9 passed on the expectedSubjects computed from the returned candidates), and the returned candidates' subjects include every code commit's subject and none of the 4 halt-record-only commits' subjects, as asserted in restack-resolver-halt-record.realgit.test.ts.
- [test] on the resolver path, a kept commit changing `src/b.ts` and the halt record, over a new parent that also changed the halt record, reports no `.docs/halted/demo.md` conflict, and the resolved tip has its `src/b.ts` change and one commit with its original subject and body; and a kept commit that changes `src/m.ts` and cleanly replaces the parent's record resolved at 2026-10-26T12:30:00.000Z with one halted at 2026-10-26T11:00:00.000Z yields a resolved tip carrying the parent's record byte-for-byte, restored by exactly one top `halt record: demo` commit, whose `src/m.ts` equals the kept commit's version, as asserted in restack-resolver-halt-record.realgit.test.ts.
- [test] after resolveRestackConflict returns, the worktree's `.git/config`, `.git/info/attributes` (absent or unchanged) and tracked `.gitattributes` (absent or unchanged) are byte-identical to their state before the call, as asserted in restack-resolver-halt-record.realgit.test.ts.
- [test] with a parent record resolved at 2026-10-26T10:00:00.000Z and a child record halted at 2026-10-26T12:05:00.000Z, the accepted tip carries the child's record through exactly one top `halt record: demo` commit, and checkPathOwnership on that tip returns accepted, as asserted in restack-resolver-halt-record.realgit.test.ts.

**Files likely touched:**
- src/conductor/src/engine/restack/restack-resolver.ts — candidate filter, environment-only merge driver, tip bookkeeping
- src/conductor/test/engine/restack/restack-resolver-halt-record.realgit.test.ts — resolver tests

**Dependencies:** Task 2

### Task 6: runRestack and journal recovery wire the bookkeeping and keep the halt path out of conflicts
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Rewrite the two tests in `src/conductor/test/engine/restack/restack-halt-record.sweepG2.realgit.test.ts` (S6.4 and S6.9) so they assert the behavior in the Done-when checks, and add the remaining checks there. Drive everything through `runRestack` on a feature-repair stack fixture, as that file's `haltRecordStack` does. For the recovery check, follow the interrupted-journal pattern in `restack-recovery.realgit.test.ts` (search hint: `recoverRestackJournal`).
2. Verify RED.
3. In `restack-executor.ts` and `restack-recovery.ts`:
   - pass `haltRecordSlug` (`options.slug` and `current.slug`) to every `replayChildRange` and `resolveRestackConflict` call;
   - in both `replayConflict` functions, remove `haltRecordPathFor(slug)` from the returned path set, threading the slug in as a parameter.
   Leave every other branch of both callers unchanged.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] on a two-child feature-repair stack where child 1 has a repair commit to `src/r.ts` and 3 halt-record-only commits past its closure, and child 2 has 2 code commits plus 2 halt-record-only commits with different record text, runRestack returns `applied`, the counting resolver is invoked 0 times, no `restack_conflict` event is emitted, `.pipeline/HALT` is absent, and `merge-base --is-ancestor feat/c1/demo feat/c2/demo` succeeds, as asserted in restack-halt-record.sweepG2.realgit.test.ts.
- [test] when child 2's code commit conflicts with child 1's repair on `src/a.ts` and its range also holds 4 halt-record-only commits, runRestack hands the resolver `context.conflicts` equal to exactly `['src/a.ts']`, as asserted in restack-halt-record.sweepG2.realgit.test.ts.
- [test] when that resolver returns unresolved, runRestack returns `halted`, the single `restack_conflict` event's paths and the `.pipeline/HALT` text name `src/a.ts` and not `.docs/halted/demo.md`, and every `refs/heads/feat/` and `refs/conductor/demo/closed/` ref equals its value before the run, as asserted in restack-halt-record.sweepG2.realgit.test.ts.
- [test] after an applied restack where child 2's old-tip record halted at 2026-10-26T12:05:00.000Z is newer than child 1's record resolved at 2026-10-26T10:00:00.000Z, with child 2 checked out, `git show HEAD:.docs/halted/demo.md` (the record hasOutstandingHalt reads) begins with `# Halt record` followed by `Status: halted`, as asserted in restack-halt-record.sweepG2.realgit.test.ts.
- [test] a restack whose journal is left in state `planned` with child 2 pending, then completed by recoverRestackJournal, produces a child 2 tip equal to the one an uninterrupted runRestack produces on an identical fixture with the same committer stamp, including its `halt record: demo` commit, as asserted in restack-halt-record.sweepG2.realgit.test.ts.

**Files likely touched:**
- src/conductor/src/engine/restack/restack-executor.ts — pass haltRecordSlug, drop halt path from replayConflict
- src/conductor/src/engine/restack/restack-recovery.ts — pass haltRecordSlug, drop halt path from replayConflict
- src/conductor/test/engine/restack/restack-halt-record.sweepG2.realgit.test.ts — rewritten and new runRestack tests

**Dependencies:** Tasks 4, 5

### Task 7: An unentered leaf at an omitted pre-region halt record still moves
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Rewrite the pre-region halt-record leaf assertions in these tests so they expect the leaf at the commit the halt record maps to, the new default in each fixture, since no kept commit precedes it:
   - `src/conductor/test/engine/restack/restack-executor.realgit.test.ts` (the base-refresh test whose leaf sits at a `halt record` commit with a `.pipeline/task-evidence.json` stamp);
   - `restack-executor.sweepG5.realgit.test.ts` ("moves an unentered pre-region halt-record leaf to its rewrite ...");
   - `restack-leaf-moved.sweepG2.realgit.test.ts` ("moves an unentered leaf at pre-region halt record H to H' ...").
2. Run the three tests and confirm the rewritten expectations pass. No production change is expected beyond Tasks 3 and 6. If the leaf lookup in `runRestack` (`rewrites.get(range.oldTip)`) throws `cannot resolve unentered leaf`, fix the omitted-commit mapping in `restack-replay.ts`.
3. Commit.

**Done when:**
- [test] on the base-refresh fixture whose unentered leaf sits at pre-region halt-record commit H inside child 1's range, runRestack returns `applied` without throwing `cannot resolve unentered leaf`, `feat/daemon-demo` equals the single commit H maps to (the advanced default), and the `restack_applied` event for the leaf has oldTip H and that newTip, as asserted in restack-executor.sweepG5.realgit.test.ts.
- [test] in the same scenario no `refs/conductor/demo/leaf-moved` ref is written, and when child 2 later closes the leaf move completes with no stray-commit refusal, as asserted in restack-leaf-moved.sweepG2.realgit.test.ts.
- [test] the new child 1 tip in that fixture carries H's halt record through one `halt record: demo` commit, and the task-evidence stamp that named H is translated to the leaf's new tip, as asserted in restack-executor.realgit.test.ts.

**Files likely touched:**
- src/conductor/test/engine/restack/restack-executor.realgit.test.ts — pre-region leaf expectations
- src/conductor/test/engine/restack/restack-executor.sweepG5.realgit.test.ts — pre-region leaf expectations
- src/conductor/test/engine/restack/restack-leaf-moved.sweepG2.realgit.test.ts — pre-region leaf expectations
- src/conductor/src/engine/restack/restack-replay.ts — only if the omitted mapping needs a fix

**Dependencies:** Task 6

### Task 8: Flat features and non-bookkeeping commits keep today's behavior
**Story:** Story 3
**Type:** verification

**Verify-only:** yes

**Steps:**
1. Run the existing tests named in the Done-when checks with their assertions unedited, and inspect the diff on the named paths.
2. Close with an empty commit carrying `Task: 8` and `Evidence: skipped existing tests and an unchanged diff prove Story 3`.

**Done when:**
- `git diff origin/main...HEAD -- src/conductor/src/engine/halt-record.ts src/conductor/src/engine/halt-marker.ts` is empty, and no hunk changes `performRebase` in `src/conductor/src/engine/rebase.ts`, so the flat commit and push of `halt record: <slug>` and `halt record resolved: <slug>` and the flat FINISH rebase run unchanged code with no halt-record commit omitted or added.
- halt-record-commit.test.ts and halt-record-child.test.ts ("keeps the N=1 record byte shape and publishes it") pass with their assertions unedited.
- restack-replay.realgit.test.ts ("copies authors and raw messages, fixes committer metadata, preserves started-empty evidence, and drops a commit already carried by the parent" and "is deterministic with a journaled stamp ...") passes unedited, showing that a range with no halt-record commits yields the same tip, commits and rewrites and that a newly-empty commit is still dropped while a started-empty one is kept.
- restack-ownership.realgit.test.ts ("halts before ref movement for both silent-revert shapes on paths a child does not own") and restack-conflict.sweepG2.realgit.test.ts ("rejects a resolver result that drops a child 2 subject (FR-9) ...") pass unedited, so `replay-mismatch` and FR-9 still refuse non-bookkeeping commits.

**Files likely touched:**
- none

**Dependencies:** Tasks 6, 7, 9

### Task 9: Halt-record bookkeeping never masks a replay-mismatch, FR-9 or flatten_refused refusal
**Story:** Story 3, Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-halt-record-refusals.realgit.test.ts` for every Done-when check.
   - For the ownership case, reuse the silent-revert stack shape of `restack-ownership.sweepG2.realgit.test.ts`: child 2 adds and then reverts `X`, and the repaired parent adds `X`. Add 2 halt-record-only commits with different record text to child 2's range.
   - For the FR-9 case, reuse the resolver-result fixture of `restack-conflict.sweepG2.realgit.test.ts`, whose stub resolver returns a tip that drops child 2's code commit `C2`. Add 2 halt-record-only commits to child 2's range.
   - For the merge case, build child 2's range with a merge commit that is itself conflict-free and whose merged side changes `.docs/halted/demo.md` and `src/q.ts`. It conflicts only when replayed onto child 1's repair, which also changes `src/q.ts`. Follow the merge fixtures in the `flatten_refused` tests (search hint: `flatten_refused` in `src/conductor/test/engine/restack/`).
   Drive every case through `runRestack` with `haltRecordSlug` active (Task 6 wiring).
2. Run them. They guard preserved refusals with bookkeeping active, so they may pass at once on Task 6's state; a failure means bookkeeping masks a refusal.
3. Change production code only if a refusal is masked. In `restack-resolver.ts`, the bookkeeping commit is added only after FR-8 and FR-9 accept the resolved tip. On both paths it changes only `.docs/halted/demo.md`, and `checkPathOwnership` then judges the returned tip, which includes it, as Technical Approach states.
4. Commit.

**Done when:**
- [test] on the silent-revert fixture with 2 halt-record-only commits in child 2's range, runRestack returns `halted`, `.pipeline/HALT` names reason `replay-mismatch` and the path `X`, and every `refs/heads/feat/` and `refs/conductor/demo/closed/` ref equals its value before the run, as asserted in restack-halt-record-refusals.realgit.test.ts.
- [test] on the resolver fixture whose resolved tip drops code commit `C2`, with 2 halt-record-only commits in child 2's range, runRestack returns `halted`, the halt text contains FR-9's rejection naming subject `C2`, no `halt record: demo` bookkeeping commit is reachable from any moved ref, and no child or closure ref moved, as asserted in restack-halt-record-refusals.realgit.test.ts.
- [test] on the merge fixture whose merge commit changes `.docs/halted/demo.md` and conflicts on `src/q.ts`, runRestack returns `halted` with `.pipeline/HALT` naming `flatten_refused` and the merge commit's SHA, the merge commit is still reachable from child 2's branch (not omitted), and no child or closure ref moved, as asserted in restack-halt-record-refusals.realgit.test.ts.

**Files likely touched:**
- src/conductor/test/engine/restack/restack-halt-record-refusals.realgit.test.ts — refusal tests with bookkeeping active
- src/conductor/src/engine/restack/restack-replay.ts — only if a refusal is masked
- src/conductor/src/engine/restack/restack-resolver.ts — only if a refusal is masked

**Dependencies:** Task 6

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3 → Task 4 ─┐
              └──────→ Task 5 ────┴→ Task 6 → Task 7 ─┐
                                           └→ Task 9 ──┴→ Task 8
```

## Integration Points

- After Task 4: the plumbing replay alone delivers Stories 1 and 2 for clean and halt-only divergence.
- After Task 6: `runRestack` and journal recovery reach both paths; the issue's incident shape restacks
  without a resolver call.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | no-change | none | Only stacked features restack; `performRebase` and the N=1 path are untouched (Task 8 diff check). |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | task | task-3, task-4, task-7 | replayChildRange with haltRecordSlug over a range of 2 code commits and 2 halt-record-only commits returns a tip whose `newParent..tip` log contains both code subjects and no halt-record-only commit |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | no-change | none | Off-worktree replay, empty-commit rules and path-ownership acceptance are unchanged; the bookkeeping commit is built off-worktree and passes the existing `checkPathOwnership`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | no-change | none | The journal shape and ref transactions are unchanged; omitted commits add entries to the existing rewrites map. |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | no-change | none | The atomic move and worktree sync are unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-5, task-6 | resolveRestackConflict returns candidates (the engine-written rebase todo) containing none of the 4 halt-record-only commits, and every recorded `context.conflicts` equals exactly `['src/a.ts']` |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | no-change | none | The preflight's ordered stages, including halt-record supersede, are unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | no-change | none | Verdict transitions after a restack are unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | no-change | none | Restack triggers and causes are unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | no-change | none | Cascade charging and the cap are unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | no-change | none | Force-push leases are unchanged; child branches are still never pushed by a halt record. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | no-change | none | No new event; `restack_conflict` keeps its shape and only stops naming the halt-record path. |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | no-change | none | The N=1 golden suite and flat-region accessors are untouched (Task 8 diff check). |

## Verification

- [ ] Every Story 1–3 criterion maps to a task whose Done-when checks assert its Then outcomes.
- [ ] Negative paths are explicit (Tasks 1, 3, 4, 5, 6, 7, 8, 9).
- [ ] No terminal catch-all validation task.
- [ ] Dependencies are explicit and acyclic.
- [ ] Task 7 rewrites only expectations that the D2 amendment supersedes; Task 3 and Task 6 rewrite the tests asserting the replaced upper-child and whole-conflict rules.

### Task rem-as-built-R1: src/conductor/src/engine/restack/restack-ownership.ts + halt-record-bookkeeping.ts: export ownedPaths unchanged and compute rangeTouchedRecord in carryNewestHaltRecord from ownedPaths (honoring q-carried merge exclusions) instead of the raw range diff in rangeTouchesPath
**Gate:** as-built
**Rationale:** Verified (95%): halt-record-bookkeeping.ts rangeTouchesPath uses a raw `git diff oldParent oldTip`, but the approved plan Task 2 step 3 explicitly requires exporting `ownedPaths` from restack-ownership.ts unchanged and using it for rangeTouchedRecord, and Task 2's done-when names the q-carried-merge case (record arrives only via a q-carried merge, parent record older => added false, checkPathOwnership accepted). Approved ADR D2 stays authoritative; this is conforming implementation drift admitted by Task 2, so BUILD, not architecture_review.
**Governing clause:** adr-2026-10-10-stacked-restack-journaled-replay decision 2
**Done when:**
- adr-2026-10-10-stacked-restack-journaled-replay decision 2 is satisfied by this task.
- The repair for task rem-as-built-R1 is committed and its targeted tests pass.

### Task rem-as-built-R2: src/conductor/test/engine/restack/halt-record-bookkeeping.realgit.test.ts: add the Task 2 real-git case where the record changes only via a q-carried merge and the new parent's record is older — assert added false, tip keeps the parent's record, and checkPathOwnership returns accepted (RED before R1)
**Gate:** as-built
**Rationale:** Verified (95%): halt-record-bookkeeping.ts rangeTouchesPath uses a raw `git diff oldParent oldTip`, but the approved plan Task 2 step 3 explicitly requires exporting `ownedPaths` from restack-ownership.ts unchanged and using it for rangeTouchedRecord, and Task 2's done-when names the q-carried-merge case (record arrives only via a q-carried merge, parent record older => added false, checkPathOwnership accepted). Approved ADR D2 stays authoritative; this is conforming implementation drift admitted by Task 2, so BUILD, not architecture_review.
**Governing clause:** adr-2026-10-10-stacked-restack-journaled-replay decision 2
**Done when:**
- adr-2026-10-10-stacked-restack-journaled-replay decision 2 is satisfied by this task.
- The repair for task rem-as-built-R2 is committed and its targeted tests pass.

### Task rem-as-built-R3: src/conductor/src/engine/restack/halt-record-bookkeeping.ts: commit the bookkeeping tip with message exactly `halt record: <slug>\n` (drop withDaemonCoAuthorTrailer and its now-unused import)
**Gate:** as-built
**Rationale:** Verified (97%): carryNewestHaltRecord passes `withDaemonCoAuthorTrailer(`halt record: ${slug}\n`)` to commit-tree, while approved plan Task 2's done-when requires the full message (`git log -1 --format=%B`) be exactly `halt record: demo` with no trailer, matching ADR D2's exact-subject requirement so the bookkeeping commit SHA is reproducible from the journal stamp. Clear implementation drift admitted by Task 2; BUILD.
**Governing clause:** adr-2026-10-10-stacked-restack-journaled-replay decision 2
**Done when:**
- adr-2026-10-10-stacked-restack-journaled-replay decision 2 is satisfied by this task.
- The repair for task rem-as-built-R3 is committed and its targeted tests pass.

### Task rem-as-built-R4: src/conductor/test/engine/restack/halt-record-bookkeeping.realgit.test.ts: assert the full `%B` message equals `halt record: demo` with no trailer even when a daemon bot co-author identity resolves, and that two runs with the same stamp produce the same commit SHA (RED before R3)
**Gate:** as-built
**Rationale:** Verified (97%): carryNewestHaltRecord passes `withDaemonCoAuthorTrailer(`halt record: ${slug}\n`)` to commit-tree, while approved plan Task 2's done-when requires the full message (`git log -1 --format=%B`) be exactly `halt record: demo` with no trailer, matching ADR D2's exact-subject requirement so the bookkeeping commit SHA is reproducible from the journal stamp. Clear implementation drift admitted by Task 2; BUILD.
**Governing clause:** adr-2026-10-10-stacked-restack-journaled-replay decision 2
**Done when:**
- adr-2026-10-10-stacked-restack-journaled-replay decision 2 is satisfied by this task.
- The repair for task rem-as-built-R4 is committed and its targeted tests pass.
