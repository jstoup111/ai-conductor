# Implementation Plan: Operator-recorded resolution for a stacked repair restack conflict (#3421)

**Date:** 2026-10-25
**Stories:** .docs/stories/stacked-repair-restack-conflict-above-the-repaired.md
**Conflict check:** Clean as of 2026-10-25 (4 degrading conflicts resolved; `.docs/conflicts/2026-10-25-stacked-repair-restack-conflict-above-the-repaired.md`)
**Architecture:** `adr-2026-10-25-operator-recorded-restack-conflict-resolution`; `architecture-review-2026-10-25-stacked-repair-restack-conflict-above-the-repaired` (APPROVED WITH CONDITIONS)

## Summary

This plan adds four things:
- a durable conflict record and a resolution recipe at every unresolved `feature-repair` restack
  conflict halt;
- the `ai-conductor stack restack-resolve` command, which validates an operator's resolution,
  records it and clears its halt;
- consumption of that resolution, as the child's resolver output, by the executor and by journal
  recovery;
- resolver wiring and halt-reason reporting for the routed exit.

15 tasks, delivered as a single PR.

## Technical Approach

- **Prerequisites #3203 and #3365.** The `stack` CLI group (`createProgram` in `cli.ts`,
  `PRE_DISPATCH_COMMANDS` in `cli-pre-dispatch.ts`, dispatch from `index.ts`) and the feature
  dispatch lease (`acquireFeatureDispatchLease` in `engine/feature-dispatch-lease.ts`) come from
  #3203. This plan adds one subcommand to that group and takes the lease the way #3203's
  `stack land` does.
- **Conflict record** (`src/conductor/src/engine/restack/restack-conflict-record.ts`, new).
  - It owns the typed record `{opId, child, oldParent, oldTip, newParent, newParentTree,
    candidateSubjects, commit, paths}` and its refs:
    - `refs/conductor/<slug>/restack/conflict/record`, a JSON blob;
    - `refs/conductor/<slug>/restack/conflict/parent`, which pins `newParent`;
    - `refs/conductor/<slug>/restack/resolution/c<k>`.
  - It provides a compare-and-swap writer, a fail-closed reader (the journal blob's parse pattern
    in `restack-journal.ts`: typed `ChildId`/`CommitSha`/`RestackOpId`, `undefined` on any bad
    field), delete-line builders for an `update-ref --stdin` transaction, and the
    resolution-consumption helper used by both replay loops.
  - Pattern basis: `restack-journal.ts`. Writes go through `writeRestackJournalBlob` and an
    `update-ref --stdin` transaction with explicit old values. Never use a bare `update-ref`
    without an old value.
- **Halt sites.** Both unresolved-conflict sites gain the replay parent they were building on,
  and call the record writer before the halt:
  - `haltUnresolvedConflict` in `restack-executor.ts`, which also covers the `rem-*` body
    mismatch;
  - the `conflict-unresolved` arm of `recoverRestackJournal` in `restack-recovery.ts`.

  `haltRestackConflict` in `restack-move.ts` renders the reason line and the recipe, and stays
  the only writer of the conflict HALT text. The scratch branch is `restack-resolve/<slug>/c<k>`,
  outside `feat/` (architecture-review condition C2). `flatten_refused` and base-refresh conflicts
  are untouched.
- **Candidate subjects.** `restack-resolver.ts` exports one helper, `replayCandidateSubjects(git,
  range, comparisonCommits)`, composed from its existing `replayCandidates` and `candidateSubjects`.
  The halt records its result, and the CLI checks against the record.
- **Strict FR-9.** `missingCandidateSubjects(git, newParent, tip, subjects)` in the conflict-record
  module lists every recorded subject absent from `git log --format=%s newParent..tip`.
  `featureCommitsPreserved` is not reused, because its legacy mode excuses missing subjects through
  `supersededByBase` and reads `ORIG_HEAD` (plan review PR-004).
- **Consumption.**
  - **Where.** Before `replayChildRange` for a replayed range of child `k` in a `feature-repair`
    journal. These are the range loops of `runRestack` (`restack-executor.ts`) and `resumePlanned`
    (`restack-recovery.ts`). Both call one helper, `consumeRecordedResolution`, in the
    conflict-record module.
  - **Outcomes.** `none` falls through to today's replay; `consumed` returns `{tip, rewrites}`;
    `stale` returns the field that differs.
  - **Rebuild.** It reuses `replayChildRange` over the range `newParent..resolutionTip` onto the
    live parent, with the journal's committer stamp and an empty comparison set.
  - **Rewrites.** The child's rewrite map is composed: each original candidate maps, by unique
    subject, to its resolution commit, which maps to the rebuilt commit. Duplicate subjects are
    omitted.
  - **Result.** The child is recorded `resolved` through `updateRestackChildStatus`.
- **Journal.** `RestackJournal` gains an optional `consumedResolution {child, tip, record,
  parent}`, parsed fail-closed.
  - `applyRestackMove` adds a `verify` line per consumed ref to the ready→moved transaction, so a
    ref changed after consumption fails the move with nothing moved.
  - `appliedTransactionLines` then deletes exactly those three refs, with their recorded old
    values (plan review PR-002).
- **Teardown.** `featureConductorRefNames` in `restack-refs-cleanup.ts` gains the two conflict refs
  and `restack/resolution/c<k>` for every `MAX_CHILD_ID`.
- **Events.** `types/events.ts` gains the variant `restack_resolution {opId, child, action, tip,
  operator?}`, and `RestackRefusalReason` gains `restack-resolution-stale`. `event-sinks.ts`
  declares the variant with `persist: true`, like `restack_conflict`.
- **Routed exit.**
  - `RequestRoutedExitInput` gains `resolver?` and `resolverCap?`. Both callers pass them: the
    conductor's region-exit call through `this.stepRunner.resolveRebaseConflict` and
    `resolveRebaseResolutionAttempts(this.config)`, and the preflight's `resume-exit` call from its
    options.
  - `RunRestackResult`'s `halted` arm gains `detail`, the text the halt wrote. `restackDetail`
    returns it.
- **Proving the assumptions.** A2 holds by inspection: the preflight's `resume-exit` arm already
  re-calls `requestRoutedExit` (`stack-preflight.ts`). It is proven end to end in Task 14, together
  with A3 (architecture-review condition C1).

## Prerequisites

- #3203 merged, which provides the `stack` CLI group, `acquireFeatureDispatchLease` and its
  refusal shape.
- #3365 merged.
- No migration. The new refs are engine-owned. The new journal field fails closed in this
  binary's parser, and older binaries ignore it, so a leftover resolution halts
  `restack-resolution-stale` instead of being silently mis-applied.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D1 | task | task-1, task-3, task-4 | creates `refs/conductor/demo/restack/conflict/record` whose parsed record carries child, opId, oldParent, oldTip, newParent, newParentTree, ordered candidate subjects, commit and paths |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D2 | task | task-3 | both contain `Restack-Conflict: 2 <opId>`, the commit, the paths, and the commands |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D3 | task | task-5, task-6 | the CLI with a valid resolution exits 0, `restack/resolution/c2` names the tip, `.pipeline/HALT` and `.pipeline/HALT.class` are absent |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D4 | task | task-8, task-9, task-10 | `feat/c2/demo` and `closed/c2` carry the resolution's tree, child 2's journal entry is `resolved` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D5 | task | task-11, task-12 | the transaction that applies a consuming restack also deletes `restack/resolution/c2`, `restack/conflict/record` and `restack/conflict/parent` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D6 | task | task-14 | the route record gains its terminal `restacked` occurrence, and the round closes |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D7 | task | task-13 | `requestRoutedExit` forwards the supplied resolver and cap to `runRestack` |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D8 | task | task-2, task-6, task-8, task-9 | a `restack_resolution` event with action `recorded`, child 2, the tip and the machine operator identity |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D9 | task | task-15 | a clean routed repair restack with no resolution ref produces applied refs, journal statuses and emitted events equal to the recorded pre-change snapshot |
| adr-2026-10-25-operator-recorded-restack-conflict-resolution#D10 | task | task-3 | the halt text contains no instruction to rebase or commit on `feat/c2/demo` or `feat/daemon-demo` and none to move a `refs/conductor/demo/closed/*` ref |
| adr-2026-10-10-stacked-restack-journaled-replay#D1 | existing | none | `runStackPreflight` in `src/conductor/src/engine/restack/stack-preflight.ts` serves stacked features only; N=1 rebases stay on `performRebase` in `src/conductor/src/engine/rebase.ts`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D2 | no-change | none | `planRestackRanges` in `src/conductor/src/engine/restack/restack-plan.ts` is not modified; consumption happens after planning, inside the replay loops. |
| adr-2026-10-10-stacked-restack-journaled-replay#D3 | existing | none | Off-worktree replay and path ownership are `replayChildRange` in `restack-replay.ts` and `checkPathOwnership` in `restack-ownership.ts`, both reused unchanged by consumption. |
| adr-2026-10-10-stacked-restack-journaled-replay#D4 | task | task-8 | `parseJournal` accepts a journal carrying `consumedResolution` and returns `undefined` for one whose `consumedResolution` has a malformed sha or child |
| adr-2026-10-10-stacked-restack-journaled-replay#D5 | existing | none | The atomic move and loss-free sync are `applyRestackMove` in `restack-move.ts` and `syncRestackedWorktree` in `restack-sync.ts`, unchanged. |
| adr-2026-10-10-stacked-restack-journaled-replay#D6 | task | task-8 | `feat/c2/demo` and `closed/c2` carry the resolution's tree, child 2's journal entry is `resolved` |
| adr-2026-10-10-stacked-restack-journaled-replay#D7 | existing | none | The one shared preflight is `runStackPreflight` in `restack/stack-preflight.ts`; its `resume-exit` arm re-enters `requestRoutedExit`. |
| adr-2026-10-10-stacked-restack-journaled-replay#D8 | existing | none | Closed-child invalidation is `queueInvalidation` and `applyRestackTransition` in `restack/restack-transition.ts`, reached unchanged by a `resolved` child. |
| adr-2026-10-10-stacked-restack-journaled-replay#D9 | existing | none | Restack triggers are unchanged: `requestRoutedExit` and `runStackPreflight` remain the only feature-repair entry points this spec touches. |
| adr-2026-10-10-stacked-restack-journaled-replay#D10 | existing | none | The per-child cascade cap is `checkCascadeCap` in `restack/cascade-cap.ts`, unchanged; a consumed resolution charges cascades exactly as any repair restack. |
| adr-2026-10-10-stacked-restack-journaled-replay#D11 | no-change | none | This spec pushes nothing; lease-guarded pushes in `remote-git-operations.ts` are untouched. |
| adr-2026-10-10-stacked-restack-journaled-replay#D12 | task | task-2 | writes a `restack_resolution` event with action `recorded`, child, tip and operator to `.pipeline/events.jsonl` |
| adr-2026-10-10-stacked-restack-journaled-replay#D13 | task | task-15 | the N=1 golden suite passes unchanged and no `restack/conflict/*` or `restack/resolution/*` ref is read or written for a flat feature |

## Tasks

### Task 1: Conflict-record module with fail-closed refs
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `restack/restack-conflict-record.ts`:
   - the `RestackConflictRecord` type;
   - `writeConflictRecord(worktree, slug, record, {git})`: one `update-ref --stdin` transaction that creates or updates `restack/conflict/record` (a blob from `git hash-object -w --stdin`) and `restack/conflict/parent`, with explicit old values;
   - `readConflictRecord`, returning `record`, `missing` or `unreadable`;
   - `resolutionRefFor(slug, child)`;
   - `conflictDeleteLines(...)`.

   Follow `restack-journal.ts`'s typed parse: `parseCommitSha`, `parseChildId`, and `undefined` on any bad field.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-conflict-record.realgit.test.ts` asserts `writeConflictRecord` creates `refs/conductor/demo/restack/conflict/record` whose parsed record carries child, opId, oldParent, oldTip, newParent, newParentTree, ordered candidate subjects, commit and paths, and creates `restack/conflict/parent` naming newParent.
- [test] `restack-conflict-record.realgit.test.ts` asserts a second `writeConflictRecord` naming child 3 replaces the record in one transaction, and a write whose expected old record value no longer matches fails and leaves both refs unchanged.
- [test] `restack-conflict-record.realgit.test.ts` asserts `readConflictRecord` returns `unreadable` for a blob with a non-sha `newParent` or a non-integer child, and `missing` when no record ref exists.
- [test] `restack-conflict-record.realgit.test.ts` asserts `cleanJournal` run on an aborted journal deletes the journal and staging refs and leaves `restack/conflict/record` and `restack/conflict/parent` unchanged.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-conflict-record.ts`
- `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts`

**Dependencies:** none

### Task 2: Event variant and refusal reason
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolution-events.test.ts` for every Done-when check below.
2. Verify RED.
3. Add `restack_resolution {opId, child, action: 'recorded' | 'consumed', tip, operator?}` to the `ConductorEvent` union in `types/events.ts`, and declare it in `event-sinks.ts` with `persist: true`, like `restack_conflict`. Add `restack-resolution-stale` to `RestackRefusalReason` in `restack/restack-types.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-resolution-events.test.ts` asserts the `EventPersister` writes a `restack_resolution` event with action `recorded`, child, tip and operator to `.pipeline/events.jsonl`, and a `consumed` event without operator.
- [test] `restack-resolution-events.test.ts` asserts `emitRestackRefused({ reason: 'restack-resolution-stale', child: 2, detail })` produces a persisted `restack_refused` event carrying that reason.

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/src/engine/restack/restack-types.ts`
- `src/conductor/test/engine/restack/restack-resolution-events.test.ts`

**Dependencies:** none

### Task 3: Executor conflict halt writes the record and prints the recipe
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-conflict-recipe.realgit.test.ts` for every Done-when check below. Fixture: the repaired stack from the stories, driven through `runRestack` with cause `feature-repair` and a resolver that gives up.
2. Verify RED.
3. Implement:
   - Export `replayCandidateSubjects` from `restack-resolver.ts`.
   - Pass the replay `parent` into `haltUnresolvedConflict`. For `feature-repair` only, call `writeConflictRecord` before the halt. If the write fails, the halt is still written, and its detail names the record failure.
   - Extend `haltRestackConflict` in `restack-move.ts` with optional recipe data. It renders the line `Restack-Conflict: <child> <opId>`, `git switch -c restack-resolve/<slug>/c<k> <oldTip>`, `git rebase --onto <newParent> <oldParent>` and `ai-conductor stack restack-resolve --slug <slug> --child <k> --tip <sha>`.
   - Leave the merge-bearing `flatten_refused` branch and base-refresh halts unchanged.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-conflict-recipe.realgit.test.ts` asserts a routed-repair conflict on child 2 creates `restack/conflict/record` with child 2, the opId, child 2's journaled oldParent and oldTip, the replay parent and its tree, the ordered candidate subjects, the commit and the paths.
- [test] `restack-conflict-recipe.realgit.test.ts` asserts `.pipeline/HALT` and the committed `.docs/halted/demo.md` both contain `Restack-Conflict: 2 <opId>`, the commit, the paths, and the commands `git switch -c restack-resolve/demo/c2 <old tip>`, `git rebase --onto <new parent> <old parent>` and `ai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>` with the real shas substituted.
- [test] `restack-conflict-recipe.realgit.test.ts` asserts the halt text contains no instruction to rebase or commit on `feat/c2/demo` or `feat/daemon-demo` and none to move a `refs/conductor/demo/closed/*` ref, and no branch or closure ref moved.
- [test] `restack-conflict-recipe.realgit.test.ts` asserts a base-refresh conflict and a merge-bearing child's `flatten_refused` halt create no `restack/conflict/*` ref and keep their pre-change halt text byte-identical, while a `rem-*` body-mismatch halt does write the record and moves no branch or closure ref.
- [test] `restack-conflict-recipe.realgit.test.ts` asserts that when the conflict record ref was changed concurrently the needs-human HALT is still written, its text names the record write failure, and no branch or closure ref moved.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-move.ts`
- `src/conductor/src/engine/restack/restack-resolver.ts`
- `src/conductor/test/engine/restack/restack-conflict-recipe.realgit.test.ts`

**Dependencies:** Task 1

### Task 4: Recovery's conflict halt writes the same record and recipe
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/restack/restack-recovery-conflict-recipe.realgit.test.ts`: a `planned` feature-repair journal left by a dead owner, whose resumed replay of child 2 conflicts.
2. Verify RED.
3. Return the replay parent in `resumePlanned`'s `conflict-unresolved` result. In `recoverRestackJournal`'s `conflict-unresolved` arm, call `writeConflictRecord` and `haltRestackConflict` with the same recipe data as Task 3.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-recovery-conflict-recipe.realgit.test.ts` asserts `recoverRestackJournal` resuming a planned feature-repair journal that conflicts on child 2 writes a conflict record with the same fields and a HALT with the same `Restack-Conflict` line and recipe commands as an executor-written halt for the same stack.
- [test] `restack-recovery-conflict-recipe.realgit.test.ts` asserts the recovery-written conflict halt has HALT class `needs-human`, aborts the journal, and moves no branch or closure ref.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/test/engine/restack/restack-recovery-conflict-recipe.realgit.test.ts`

**Dependencies:** Task 3

### Task 5: `stack restack-resolve` preconditions and validation
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-restack-resolve-cli.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `checkRestackResolution(root, slug, child, tip, {git})` in `src/conductor/src/engine/stack-restack-resolve-cli.ts`. It returns `ok` or a typed refusal, in this order:
   1. `hasDurableChildState` is false: "feature is not stacked";
   2. `readConflictRecord` is missing: "no restack conflict is recorded";
   3. the record names another child;
   4. no live `.pipeline/HALT` carries the `Restack-Conflict` line for the record's child and opId;
   5. `--tip` does not resolve with `rev-parse --verify <tip>^{commit}`;
   6. FR-8: `merge-base --is-ancestor <newParent> <tip>` fails;
   7. FR-9, strictly: `missingCandidateSubjects(git, newParent, tip, candidateSubjects)` is non-empty, listing every missing subject;
   8. a merge commit exists in `newParent..tip`;
   9. `checkPathOwnership(range, newParent, tip)` is refused, listing the paths.

   Implement `missingCandidateSubjects` in `restack/restack-conflict-record.ts` as an exact set check over `git log --format=%s newParent..tip`, with no supersession excuse.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-restack-resolve-cli.realgit.test.ts` asserts `checkRestackResolution` refuses a tip not descending from the recorded parent naming that parent sha, a tip missing a candidate subject listing it, a tip touching `src/other.ts` naming it as unowned, and a tip whose range contains a merge naming the merge commit.
- [test] `stack-restack-resolve-cli.realgit.test.ts` asserts `checkRestackResolution` refuses `--child 3` against a child-2 record stating the record names child 2, a repaired stack with no record stating no restack conflict is recorded for `demo`, a flat feature stating it is not stacked, and an unresolvable `--tip` naming the value.
- [test] `stack-restack-resolve-cli.realgit.test.ts` asserts that with a child-2 record but a live HALT lacking a `Restack-Conflict` line, `checkRestackResolution` refuses stating no matching restack-conflict halt is live, and that HALT file is byte-identical afterwards.
- [test] `stack-restack-resolve-cli.realgit.test.ts` asserts a tip omitting a candidate subject whose content is already present in the recorded parent is still refused by `missingCandidateSubjects`, with no supersession excuse.

**Files likely touched:**
- `src/conductor/src/engine/stack-restack-resolve-cli.ts`
- `src/conductor/src/engine/restack/restack-conflict-record.ts`
- `src/conductor/test/engine/stack-restack-resolve-cli.realgit.test.ts`

**Dependencies:** Tasks 1, 3

### Task 6: `stack restack-resolve` records the resolution and clears its halt
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-restack-resolve-cli.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `runStackRestackResolve` in `stack-restack-resolve-cli.ts`, under `acquireFeatureDispatchLease` (#3203), refusing a live owner by purpose and pid as `stack land` does. The steps are:
   1. `checkRestackResolution`;
   2. compare-and-swap create or update of `restack/resolution/c<k>`;
   3. append `restack_resolution recorded` with the tip and `resolveMachineOperatorIdentity(root)`;
   4. `clearHaltAtomically` from `rewind.ts`;
   5. release the lease.

   A failure at step 3 or 4 exits non-zero, naming the step, and keeps the HALT and the ref. Every refusal from Task 5 exits non-zero before any write. Register `stack restack-resolve --slug --child --tip` in the #3203 `stack` group in `cli.ts`, add its detector to `PRE_DISPATCH_COMMANDS` in `cli-pre-dispatch.ts`, and dispatch from `index.ts`. Leave it out of `SESSION_SANCTIONED_SUBCOMMANDS`, so a daemon session refuses it before any feature read.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-restack-resolve-cli.realgit.test.ts` asserts the CLI with a valid resolution exits 0, `restack/resolution/c2` names the tip, `.pipeline/HALT` and `.pipeline/HALT.class` are absent, and `.pipeline/events.jsonl` gained a `restack_resolution` event with action `recorded`, child 2, the tip and the machine operator identity, appended before the HALT files were removed, and no `halt_clear_authorized` event.
- [test] `stack-restack-resolve-cli.realgit.test.ts` asserts the recorded order is lease acquire, ref write, event append, HALT clear, lease release, and a re-run with a different valid tip while the conflict HALT is still live exits 0 with `restack/resolution/c2` naming the new tip and the HALT cleared.
- [test] `stack-restack-resolve-cli.realgit.test.ts` asserts each Task 5 refusal through the CLI exits non-zero naming its cause and writes nothing: no `restack/resolution/c2` ref, no `restack_resolution` event, and a byte-identical HALT and HALT class file; a live lease owner refuses naming its purpose and pid with nothing written.
- [test] `stack-restack-resolve-cli.realgit.test.ts` asserts a failing event append exits non-zero naming the event failure, and a failing `clearHaltAtomically` exits non-zero naming the HALT failure, each leaving `.pipeline/HALT` and `.pipeline/HALT.class` present and `restack/resolution/c2` recorded.
- [test] `daemon-session.test.ts` asserts `stack restack-resolve` is absent from `SESSION_SANCTIONED_SUBCOMMANDS` and a daemon-session invocation is refused naming the daemon session before any feature path is read.

**Files likely touched:**
- `src/conductor/src/engine/stack-restack-resolve-cli.ts`
- `src/conductor/src/cli.ts`
- `src/conductor/src/cli-pre-dispatch.ts`
- `src/conductor/src/index.ts`
- `src/conductor/test/engine/stack-restack-resolve-cli.realgit.test.ts`
- `src/conductor/test/execution/daemon-session.test.ts`

**Dependencies:** Tasks 2, 5

### Task 7: Resolution-consumption helper
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `consumeRecordedResolution({slug, range, parent, committer, git})` in `restack-conflict-record.ts`. With no resolution ref for `range.child`, it returns `none`. Otherwise:
   - it returns `stale` with field `record` when the record is missing or names another child;
   - it returns `stale` with field `range` when `oldParent` or `oldTip` differ;
   - it returns `stale` with field `parent-tree` when `parent^{tree}` differs from `newParentTree`.

   On a match, it rebuilds `newParent..tip` onto `parent` with `replayChildRange`, using the committer stamp and no comparison commits. It returns `consumed {tip, rewrites, resolution}`. Each original candidate maps to its rebuilt commit through the unique-subject match. Duplicate subjects are omitted.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-conflict-record.realgit.test.ts` asserts `consumeRecordedResolution` returns `consumed` whose tip has the resolution's tree when the live parent is a different commit with the recorded parent's tree.
- [test] `restack-conflict-record.realgit.test.ts` asserts `consumeRecordedResolution` returns `stale` naming `parent-tree`, `range` or `record` for each mismatch, and `none` when no resolution ref exists for the child.
- [test] `restack-conflict-record.realgit.test.ts` asserts the returned rewrites map each original candidate commit to its rebuilt commit and omit both commits that share one subject.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-conflict-record.ts`
- `src/conductor/test/engine/restack/restack-conflict-record.realgit.test.ts`

**Dependencies:** Task 1

### Task 8: Executor consumes a recorded resolution
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolution-consume.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. In `runRestack`'s range loop, for a `feature-repair` journal and a replayed (non-adopted, non-`leaf-unentered`) range, call `consumeRecordedResolution` before `replayChildRange`. On `consumed`:
   - run `checkPathOwnership(range, parent, tip)`;
   - record the child `resolved` through `updateRestackChildStatus` with the rewrites;
   - put the resolution identity on the journal's new optional `consumedResolution {child, tip, record, parent}` field, added to `RestackJournal` and parsed fail-closed in `parseJournal`;
   - emit `restack_resolution consumed`;
   - continue with `parent = tip`.

   On `none`, replay exactly as today.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-resolution-consume.realgit.test.ts` asserts that after a recorded resolution a second `runRestack` applies, `feat/c2/demo` and `closed/c2` carry the resolution's tree, child 2's journal entry is `resolved`, and each child 1 repair commit appears exactly once in `feat/c2/demo` history.
- [test] `restack-resolution-consume.realgit.test.ts` asserts the leaf `feat/daemon-demo` is replayed onto the new `closed/c2` as an ordinary replay and contains each child 1 repair commit exactly once.
- [test] `restack-resolution-consume.realgit.test.ts` asserts a four-position stack with a recorded resolution for child 3 applies when child 2 is rebuilt to a new commit id with the same tree, with child 3's journal entry `resolved` from the consumed resolution.
- [test] `restack-resolution-consume.realgit.test.ts` asserts a `restack_resolution` event with action `consumed` and child 2 is persisted.
- [test] `restack-journal.test.ts` asserts `parseJournal` accepts a journal carrying `consumedResolution` and returns `undefined` for one whose `consumedResolution` has a malformed sha or child.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-journal.ts`
- `src/conductor/test/engine/restack/restack-resolution-consume.realgit.test.ts`
- `src/conductor/test/engine/restack/restack-journal.test.ts`

**Dependencies:** Tasks 2, 7

### Task 9: Stale or unowned resolutions halt with nothing moved
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolution-consume.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. In `runRestack`, on `stale`, abort the journal with no ref moved. Halt through `haltRestack(worktree, 'restack-resolution-stale', events, {child, detail: <field>})`, which emits `restack_refused`. Keep the resolution and conflict refs. On a consumption ownership refusal, abort and halt `replay-mismatch`, naming the paths.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-resolution-consume.realgit.test.ts` asserts a recorded resolution whose recorded parent tree no longer matches halts needs-human with reason `restack-resolution-stale` naming the parent tree mismatch, emits `restack_refused` with that reason, moves no branch or closure ref, and keeps `restack/resolution/c2`, `restack/conflict/record` and `restack/conflict/parent`.
- [test] `restack-resolution-consume.realgit.test.ts` asserts a changed journaled range halts `restack-resolution-stale` naming the range mismatch, and a resolution ref with no record halts `restack-resolution-stale` naming the missing record, each moving no ref.
- [test] `restack-resolution-consume.realgit.test.ts` asserts a rebuilt resolution failing `checkPathOwnership` halts needs-human naming the unowned paths and moves no ref.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/test/engine/restack/restack-resolution-consume.realgit.test.ts`

**Dependencies:** Task 8

### Task 10: Journal recovery consumes a recorded resolution
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts`: a planned feature-repair journal from a dead owner, with a recorded resolution for child 2.
2. Verify RED.
3. In `resumePlanned`, call `consumeRecordedResolution` at the same point as Task 8. Map `consumed` to `resolved`, and a stale result to an aborted journal and the `restack-resolution-stale` halt in `recoverRestackJournal`.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-recovery-resolution.realgit.test.ts` asserts `recoverRestackJournal` resuming that journal records child 2 `resolved` with the rebuilt tip and applies with `feat/c2/demo` carrying the resolution's tree, the same result as the executor path.
- [test] `restack-recovery-resolution.realgit.test.ts` asserts a stale resolution during recovery aborts the journal, halts `restack-resolution-stale`, and moves no branch or closure ref.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/test/engine/restack/restack-recovery-resolution.realgit.test.ts`

**Dependencies:** Tasks 8, 9

### Task 11: The applied transaction deletes a consumed resolution
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-resolution-lifecycle.realgit.test.ts` for every Done-when check below.
2. Verify RED.
3. `applyRestackMove` (`restack-move.ts`) adds `verify <ref> <old>` lines for the journal's `consumedResolution` refs to the ready→moved transaction. A failed verify maps to the `stack-ref-changed` halt naming the changed ref, with nothing moved. `appliedTransactionLines` appends `conflictDeleteLines` for exactly those old values.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-resolution-lifecycle.realgit.test.ts` asserts the transaction that applies a consuming restack also deletes `restack/resolution/c2`, `restack/conflict/record` and `restack/conflict/parent`, and that a consuming restack aborted before apply leaves all three naming the same objects.
- [test] `restack-resolution-lifecycle.realgit.test.ts` asserts that for each of `restack/resolution/c2`, `restack/conflict/record` and `restack/conflict/parent` changed between consumption and the move, `applyRestackMove`'s transaction fails its verify line, the restack does not apply, halts `stack-ref-changed` naming that ref, and no branch or closure ref moved.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-move.ts`
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/test/engine/restack/restack-resolution-lifecycle.realgit.test.ts`

**Dependencies:** Task 8

### Task 12: Teardown deletes the conflict and resolution refs by name
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts` for every Done-when check below.
2. Verify RED.
3. Add `restack/conflict/record`, `restack/conflict/parent` and `restack/resolution/c<k>` for each id up to `MAX_CHILD_ID` to `featureConductorRefNames`.
4. Verify GREEN and commit.

**Done when:**
- [test] `restack-refs-cleanup.test.ts` asserts `featureConductorRefNames('demo')` lists `refs/conductor/demo/restack/conflict/record`, `refs/conductor/demo/restack/conflict/parent` and `refs/conductor/demo/restack/resolution/c<k>` for every child id, and the single-slug reclaim deletes them.
- [test] `restack-refs-cleanup.test.ts` asserts reclaiming slug `dem` leaves every `refs/conductor/demo/restack/conflict/*` and `restack/resolution/*` ref intact.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-refs-cleanup.ts`
- `src/conductor/test/engine/restack/restack-refs-cleanup.test.ts`

**Dependencies:** Task 1

### Task 13: The routed exit uses the provider resolver and reports the restack's reason
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit.realgit.test.ts` and `src/conductor/test/engine/routing/routed-exit.test.ts` for every Done-when check below.
2. Verify RED.
3. Make these changes:
   - Add `resolver?` and `resolverCap?` to `RequestRoutedExitInput` and forward them to `runRestack`.
   - Pass `this.stepRunner.resolveRebaseConflict` and `resolveRebaseResolutionAttempts(this.config)` from the conductor's region-exit call, and the preflight options' `resolver` and `resolverCap` from the `resume-exit` call in `stack-preflight.ts`.
   - Add `detail` to `RunRestackResult`'s `halted` arm: the text each halt wrote. `restackDetail` returns it.
4. Verify GREEN and commit.

**Done when:**
- [test] `routed-exit.test.ts` asserts `requestRoutedExit` forwards the supplied resolver and cap to `runRestack`, and that the conductor's region-exit call and the preflight's `resume-exit` call both supply `resolveRebaseConflict` and `resolveRebaseResolutionAttempts(config)`.
- [test] `routed-exit.realgit.test.ts` asserts a resolver that resolves child 2's conflict lets the routed exit restack apply with no HALT written.
- [test] `routed-exit.realgit.test.ts` asserts a resolver giving up with `could not reconcile renamed symbol` yields a routed halt whose loop halt reason and committed halt record contain `restack conflict child 2` and `could not reconcile renamed symbol`, and a provider-setup failure yields a halt naming that resolver failure instead of `restack resolver unavailable`, with no ref moved.
- [test] `routed-exit.realgit.test.ts` asserts a routed exit restack that halts on the cascade cap reports a halt detail containing `cascade-cap`.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts`
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/routing/routed-exit.realgit.test.ts`
- `src/conductor/test/engine/routing/routed-exit.test.ts`

**Dependencies:** none

### Task 14: An operator-resolved routed round completes with re-validation, through the conductor
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-resolution-integration.realgit.test.ts` with a real `Conductor` on the repaired stack:
   1. the region passes;
   2. the routed exit halts on child 2;
   3. `runStackRestackResolve` records a valid resolution;
   4. a second dispatch runs.
2. Verify RED.
3. Thread the consumed child's composed rewrites (Task 7) into `rewritesByChild` for `applyRestackTransition`, in both `runRestack` and recovery's `synced` arm. Then `translateAfterRebase` uses the exact map, and falls back to patch-id reconstruction only for omitted duplicate-subject commits. This proves A2 and A3 (architecture-review condition C1).
4. Verify GREEN and commit.

**Done when:**
- [test] `routed-resolution-integration.realgit.test.ts` asserts the second dispatch re-enters the routed exit through the preflight's `resume-exit`, the committed `.docs/halted/demo.md` is superseded by the shipped resume path, the route record gains its terminal `restacked` occurrence, and the round closes.
- [test] `routed-resolution-integration.realgit.test.ts` asserts child 2 is queued for re-validation and its re-validation runs before the leaf, and after `returnToLeaf` the leaf's `prd_audit` and `manual_test` steps are pending.
- [test] `routed-resolution-integration.realgit.test.ts` asserts no `no_task_progress` halt occurs across the resolve-then-revalidate path, and `applyRestackTransition` received child 2's composed rewrite map.
- [test] `routed-resolution-integration.realgit.test.ts` asserts a failing gate in child 2's re-validation is handled inside child 2's region under its caps and the leaf gates do not run first.
- [test] `routed-resolution-integration.realgit.test.ts` asserts that with two child 2 commits sharing one subject both are absent from the rewrite map passed to `applyRestackTransition` and left to `translateAfterRebase`'s patch-id reconstruction, the restack still applies, and child 2's re-validation still runs.

**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/test/engine/routing/routed-resolution-integration.realgit.test.ts`

**Dependencies:** Tasks 6, 8, 10, 11, 13

### Task 15: Restacks with no recorded resolution are unchanged
**Story:** Story 7
**Type:** verification

**Steps:**
1. Write characterization tests in `src/conductor/test/engine/restack/restack-resolution-parity.realgit.test.ts`. They pin today's behavior: the applied refs, journal statuses and emitted events for a clean routed repair restack, a routing-off automatic repair, an unresolved conflict with no resolution ref, and a flat-feature rebase (architecture-review condition C3). They pass before and after Tasks 3 and 8, by design. They prove that those tasks' new reads sit behind `cause === 'feature-repair'` and the existence of the child's resolution ref.
2. Run them and the N=1 golden suite. Commit with a `Task: 15` trailer.

**Done when:**
- [test] `restack-resolution-parity.realgit.test.ts` asserts a clean routed repair restack with no resolution ref produces applied refs, journal statuses and emitted events equal to the recorded pre-change snapshot.
- [test] `restack-resolution-parity.realgit.test.ts` asserts that with no resolution ref an unresolved conflict halts as in Task 3 and the engine creates no `restack/resolution/*` ref.
- [test] `restack-resolution-parity.realgit.test.ts` asserts a routing-off automatic feature-repair restack that replays cleanly behaves identically to the snapshot and writes no `restack/conflict/*` ref.
- [test] the N=1 golden suite passes unchanged and no `restack/conflict/*` or `restack/resolution/*` ref is read or written for a flat feature.

**Files likely touched:**
- `src/conductor/test/engine/restack/restack-resolution-parity.realgit.test.ts`

**Verify-only:** yes

**Dependencies:** Tasks 3, 8

## Task Dependency Graph

```
Task 1  -> Task 3 -> Task 4
Task 1  -> Task 5 (also Task 3) -> Task 6 (also Task 2)
Task 1  -> Task 7 -> Task 8 (also Task 2) -> Task 9 -> Task 10
                     Task 8 -> Task 11
                     Task 8 -> Task 15 (also Task 3)
Task 1  -> Task 12
Task 13 (independent)
Tasks 6, 8, 10, 11, 13 -> Task 14
```

## Integration Points

- After Task 3: a real routed conflict halt shows the record and the recipe.
- After Task 6: an operator can record a resolution end to end through the CLI.
- After Task 8: a second restack applies a recorded resolution.
- After Task 14: the full routed round completes through the real `Conductor`.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-as-built-6: Wrap runStackRestackResolve in acquireFeatureDispatchLease, refuse a live owner by purpose and pid, and release in finally (stack-restack-resolve-cli.ts)
**Gate:** as-built
**Rationale:** ADR D3 is authoritative and the code does not conform: the CLI performs no lease acquire or release. Task 6 step 3 already specifies acquireFeatureDispatchLease, so this is BUILD work and needs no architecture change.
**Governing clause:** adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 3
**Done when:**
- adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 3 is satisfied by this task.
- The repair for task rem-as-built-6 is committed and its targeted tests pass.

### Task rem-as-built-5: Add a checkPathOwnership refusal to checkRestackResolution naming the unowned paths (stack-restack-resolve-cli.ts)
**Gate:** as-built
**Rationale:** ADR D3 requires path-ownership refusal before any write, and checkRestackResolution omits it. Task 5 admits the fix.
**Governing clause:** adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 3
**Done when:**
- adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 3 is satisfied by this task.
- The repair for task rem-as-built-5 is committed and its targeted tests pass.

### Task rem-as-built-10: Call consumeRecordedResolution in resumePlanned: resolved status and rewrites, stale refusal halt, and consumed event (restack-recovery.ts)
**Gate:** as-built
**Rationale:** ADR D4 requires recovery to consume a matching resolution like the executor does, and restack-recovery.ts does not. Task 10 admits this.
**Governing clause:** adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 4
**Done when:**
- adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 4 is satisfied by this task.
- The repair for task rem-as-built-10 is committed and its targeted tests pass.

### Task rem-as-built-3: Pass the replay candidates to haltUnresolvedConflict in the RemBlockBodyMismatchError branch so candidateSubjects is non-empty (restack-executor.ts)
**Gate:** as-built
**Rationale:** ADR D1 requires every child-content conflict, including a rem-* body mismatch, to write a complete record and recipe. The executor site omits candidates (Task 3). The recovery site rethrows through a merge-tree-only parser instead of writing the record (Task 4, whose recovery conflict arm must match the executor).
**Governing clause:** adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 1
**Done when:**
- adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 1 is satisfied by this task.
- The repair for task rem-as-built-3 is committed and its targeted tests pass.

### Task rem-as-built-4: Route recovery's RemBlockBodyMismatchError to the conflict-unresolved arm so it writes the conflict record and recipe instead of rethrowing (restack-recovery.ts)
**Gate:** as-built
**Rationale:** ADR D1 requires every child-content conflict, including a rem-* body mismatch, to write a complete record and recipe. The executor site omits candidates (Task 3). The recovery site rethrows through a merge-tree-only parser instead of writing the record (Task 4, whose recovery conflict arm must match the executor).
**Governing clause:** adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 1
**Done when:**
- adr-2026-10-25-operator-recorded-restack-conflict-resolution decision 1 is satisfied by this task.
- The repair for task rem-as-built-4 is committed and its targeted tests pass.

### Task rem-prd-audit-14: rebase-translate.ts: in buildExactRewriteMap/translateAfterRebase, try patch-id matching for pre-image shas the exact map leaves unmapped (exact entries still win; only patch-id-unmatched shas become residue); add the routed-resolution-integration.realgit.test.ts case where two child 2 commits share one subject, are absent from the map passed to applyRestackTransition, are rebuilt by patch-id, the restack applies, and child 2's re-validation runs
**Gate:** prd-audit
**Rationale:** Verified (~90%) implementation gap, no architectural or product decision needed. S4.5 requires duplicate-subject child commits to stay out of the exact rewrite map and be rebuilt by translateAfterRebase's patch-id matching. Instead, rebase-translate.ts:492-494 sends any defined exactRewrites to buildExactRewriteMap (rebase-translate.ts:42-57), which puts every unmapped pre-image sha into residue without trying a patch-id match. restack-executor.ts always passes a defined map for a consumed child, so the duplicate-subject commits become residue. Task 14 already covers this: its fifth doneWhen asserts this exact scenario. The fix goes to BUILD under task 14: try patch-id matching for pre-image shas the exact map leaves unmapped, and add the duplicate-subject real-git assertion. This preserves completed coverage: exact-mapped commits, including empty and resolver-modified ones, still use the exact map.
**Criterion:** S4.5
**Parent task:** 14
**Done when:**
- [test] `routed-resolution-integration.realgit.test.ts` creates two child-2 commits with the same subject that are omitted from the exact rewrite map, verifies patch-id reconstruction for both and an applied restack, then consumes child 2's queued re-validation and verifies the conductor dispatches `build` and `build_review`, runs the suite verifier once, and records child 2's `build` step as done.
- The repair for task rem-prd-audit-14 is committed and its targeted tests pass.
