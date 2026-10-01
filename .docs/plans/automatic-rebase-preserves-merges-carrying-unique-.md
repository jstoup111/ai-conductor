# Implementation Plan: Automatic rebase preserves merges carrying unique content

**Date:** 2026-09-29
**Stories:** .docs/stories/automatic-rebase-preserves-merges-carrying-unique-.md
**Conflict check:** Clean as of 2026-09-29

## Summary

Every engine-started feature rebase (`performRebase` and open-PR autoresolve) replays a merge-bearing branch as a proven, first-parent flattened list through one shared primitive. The flattened list drops ancestry-only merges, turns each content-bearing merge into one commit, and never replays side lineage. A conflicting flattened merge halts before mutation with a recovery recipe. 12 tasks.

## Technical Approach

- **One primitive, two callers (ADR D1, D8).** `startFeatureReplay(git, baseRef, mergeBase)` in `src/conductor/src/engine/rebase.ts` owns the replay decision:
  - A range with no merge issues today's `rebase --autostash <base>` byte-for-byte.
  - A merge-bearing range is planned (Task 2), proven (Task 3), and started as `rebase -i --autostash <base>`, with a todo installed through `-c sequence.editor=cp <todo>`. The todo lives at `rev-parse --git-path ai-conductor-flatten-todo`, so the worktree is never written. The `GitRunner` has no env parameter, so flattened-commit authorship uses `-c user.name`/`-c user.email`.
  - `performRebase` (Task 5) and `autoresolve.ts` (Task 11) both call it in place of their own `git rebase` start.
- **Classification by tree identity (D2).** Walk `rev-list --reverse --first-parent`. A merge whose tree equals its first parent's tree is ancestry-only and is dropped. Any other merge becomes a `commit-tree <merge tree> -p <merge^1>` object carrying the merge subject and a `Flattened-merge:` trailer. A 2026-09-29 probe verified that this reproduces HEAD's tree in place on 5 of 5 merge-bearing branches.
- **Proof before mutation (D3).** `proveFlattenedReplay` chains `merge-tree --write-tree --merge-base` and `commit-tree`, following the tree-only pattern of `captureReplayIdentity` in `rebase-replay.ts`: an explicit merge base, exit 1 meaning conflict, and no ref, index, or worktree write.
- **Outcomes.**
  - A refusal becomes the distinct `flatten_refused` `RebaseOutcome` (D5). Callers HALT, or autoresolve escalates, without resolver dispatch.
  - An ordinary conflict stays `conflict_halt` on a real paused `rebase -i`. The existing resolver, `--continue`, `--abort`, autostash, and untracked-collision heal keep working (D4).
- **Downstream.**
  - FR-9 uses the primitive's expected subjects on a flattened replay (amendment D2 of adr-2026-06-29).
  - Translation adds engine-recorded absorption pairs after the patch-id pass (amendment D10 of adr-2026-07-12).
  - `emitRebaseEvent` emits one `rebase_merge_audit` event (D6).
- **Sequencing.** Types (1), then plan (2), proof (3), primitive (4), then `performRebase` wiring (5). The refusal halt (6), paused-state reuse (7), and events (10) follow Task 5. FR-9 (8) and translation (9) need only the primitive. Autoresolve (11 and 12) comes last.

## Prerequisites

- None. `git merge-tree --write-tree` (git 2.38 or later) is already a production dependency of `rebase.ts` and `rebase-replay.ts`.

## Tasks

### Task 1: Declare the flatten outcome, audit event, and halt field types
**Story:** 8
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing test: a type-level test in `src/conductor/test/engine/rebase-flatten-types.test.ts` constructs a `flatten_refused` `RebaseOutcome` and a `rebase_merge_audit` event, and asserts `EVENT_SINKS.rebase_merge_audit.persist === true`.
2. Verify test fails (RED).
3. Implement: add the `flatten_refused` kind to `RebaseOutcomeKind` in `rebase.ts` with the fields `mergeSha`, `parents`, `flattenedSha`, `conflicts`, `reason`, and `recipe`. Add the `rebase_merge_audit` variant, and the optional `mergeAudit` field on `rebase_conflict_halt`, to `types/events.ts`. Add the `EVENT_SINKS` row. Give every existing `RebaseOutcome` switch an explicit `flatten_refused` branch that returns the conflict-halt handling stub, which Task 6 replaces.
4. Verify test passes (GREEN).
5. Commit with message: "feat(rebase): declare flatten_refused outcome and merge-audit event types"

**Done when:**
- `RebaseOutcomeKind` in `src/engine/rebase.ts` has a `flatten_refused` member carrying `mergeSha`, `parents`, `flattenedSha`, `conflicts`, `reason`, and `recipe`, and `npm run typecheck` fails when any `RebaseOutcome` switch in `conductor.ts`, `daemon-rekick.ts`, or `autoresolve.ts` omits a `flatten_refused` branch.
- `ConductorEvent` in `src/types/events.ts` has a `rebase_merge_audit` variant carrying `flattenedMerges`, `ancestryOnlyMerges`, and `sideLineageCount`, and `rebase_conflict_halt` has an optional typed `mergeAudit` field.
- `EVENT_SINKS` in `src/engine/event-sinks.ts` declares `rebase_merge_audit` with `persist: true`, and deleting that row makes `npm run typecheck` fail because the registry is typed `Record<ConductorEvent['type'], SinkDeclaration>`, so compilation fails for a union member with no `EVENT_SINKS` row.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/src/engine/autoresolve.ts`, `src/conductor/test/engine/rebase-flatten-types.test.ts`

**Dependencies:** none

### Task 2: Build the first-parent replay list and classify each merge by tree identity
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: in `src/conductor/test/engine/rebase-flatten.test.ts`, drive `planFlattenedReplay` with an injected `GitRunner` fixture: a three-merge first-parent chain (one ancestry-only merge, two content-bearing merges), side-lineage commits, and a merge whose author differs from its committer.
2. Verify test fails (RED).
3. Implement `planFlattenedReplay(git, mergeBase)` in `rebase.ts`:
   - Walk `rev-list --reverse --first-parent <mergeBase>..HEAD`.
   - For each merge, compare `<merge>^{tree}` with `<merge>^1^{tree}`. When they are equal, record the merge as ancestry-only and emit no list entry.
   - Otherwise call `commit-tree <merge tree> -p <merge^1>` through the runner, with `-c user.name=<merge author name> -c user.email=<merge author email>` and a message whose subject is the merge's subject and whose body ends with a `Flattened-merge: <merge sha>` trailer. Record the pair.
   - Count side-lineage commits as `rev-list <mergeBase>..HEAD` minus the first-parent list.
   - Follow the tree-only pattern of `captureReplayIdentity` in `rebase-replay.ts`: only the injected runner and object-writing plumbing, never a ref, index, or worktree write.
4. Verify test passes (GREEN).
5. Commit with message: "feat(rebase): plan a first-parent flattened replay list"

**Done when:**
- `planFlattenedReplay` in `src/engine/rebase.ts` classifies each merge of the three-merge first-parent chain fixture exactly once by comparing that merge's tree to its own first parent's tree, so none is skipped or classified twice, as asserted by the per-merge classification test.
- For the ancestry-only merge, the returned replay list has no entry carrying that merge's subject or content, and the returned audit lists the merge sha under `ancestryOnlyMerges`.
- For each content-bearing merge, the runner receives one `commit-tree` call with the merge's tree and `-p <merge^1>`, a message whose subject is the merge's subject and whose last line is `Flattened-merge: <merge sha>`, and `-c user.name`/`-c user.email` equal to the merge's author (not its committer) in the author-differs fixture.
- The returned replay list never contains a side-lineage commit (reachable only through a second parent), and the audit reports their count as `sideLineageCount`.
- The runner call log for `planFlattenedReplay` contains no `rebase`, `update-ref`, `reset`, `checkout`, or `add` command.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase-flatten.test.ts`

**Dependencies:** 1

### Task 3: Prove the replay list tree-equal to HEAD and dry-run it onto the target
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase-flatten.test.ts` using injected-runner fixtures for the tree-equal, tree-mismatch, failed-`commit-tree`, failed-`merge-tree`, flattened-conflict, and ordinary-conflict cases. Add a real-git scratch-repository test in `src/conductor/test/engine/rebase-flatten-realgit.test.ts` that snapshots checkout state around each refusal and after a successful dry run.
2. Verify tests fail (RED).
3. Implement `proveFlattenedReplay` in `rebase.ts`:
   - Chain `merge-tree --write-tree --merge-base <entry^> <acc> <entry>` and `commit-tree`, first onto the merge base, then onto the target.
   - A merge-tree exit code of 1 means conflict. Any other non-zero exit from `merge-tree` or `commit-tree` refuses and names the failed subcommand.
   - If the in-place final tree differs from `HEAD^{tree}`, refuse with both tree ids.
   - For the target run, return the first conflicting entry's index, sha, and kind (`flattened` or `ordinary`).
4. Verify tests pass (GREEN).
5. Commit with message: "feat(rebase): prove flattened replay tree identity before mutation"

**Done when:**
- `proveFlattenedReplay` in `src/engine/rebase.ts` replays the list onto the merge base with chained `merge-tree --write-tree --merge-base` and `commit-tree`, and reports `proven` only when the final tree id equals `HEAD^{tree}`, as asserted by the tree-equal fixture.
- When the in-place final tree differs from `HEAD^{tree}`, it returns a refusal whose reason names the tree mismatch and both tree ids, and the runner log contains no `rebase` command.
- When the runner returns a non-zero exit other than merge-tree's conflict exit 1 for `merge-tree` or `commit-tree`, it returns a fail-closed refusal whose reason names that failed git subcommand, and no `rebase` command is issued.
- The target dry run returns the first conflicting entry's index and sha, marked `flattened` or `ordinary`, as asserted by one fixture of each kind.
- The real-git test shows byte-identical `git rev-parse HEAD`, `git ls-files --stage`, `git status --porcelain --ignored`, and `git for-each-ref` output before and after a tree-mismatch refusal and a failed-command refusal, and no created or modified file under the worktree after a successful dry run.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase-flatten.test.ts`, `src/conductor/test/engine/rebase-flatten-realgit.test.ts`

**Dependencies:** 2

### Task 4: Start every feature replay through one shared primitive
**Story:** 1
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase-flatten.test.ts` for `startFeatureReplay`, covering a merge-free range, a merge-bearing range that is proven clean, a merge-bearing range whose first dry-run conflict is ordinary, and a refusal.
2. Verify tests fail (RED).
3. Implement `startFeatureReplay(git, baseRef, mergeBase)` in `rebase.ts`:
   - If `rev-list --merges <baseRef>..HEAD` is empty, issue exactly today's `rebase --autostash <baseRef>`.
   - Otherwise run Tasks 2 and 3. On a refusal, return it without any rebase command.
   - Else write the todo (`pick <sha>` per entry) to the path from `rev-parse --git-path ai-conductor-flatten-todo`, and issue `-c sequence.editor=cp <todo> rebase -i --autostash <baseRef>`.
   - Return the rebase result, the expected FR-9 subjects (picked first-parent subjects plus flattened merge subjects), the flatten pairs, the absorption points, and the audit.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(rebase): shared replay primitive for feature rebases"

**Done when:**
- For a range where `rev-list --merges <base>..HEAD` is empty, including one whose only merge is reachable from the base, `startFeatureReplay` in `src/engine/rebase.ts` issues exactly `['rebase', '--autostash', <base>]`, and the runner log has no `-i`, no `sequence.editor` override, no `commit-tree`, and no `merge-tree` call.
- For a proven merge-bearing range, it writes the todo to the path returned by `rev-parse --git-path ai-conductor-flatten-todo` and issues `rebase -i --autostash <base>` with a `-c sequence.editor=` command that copies that file, so no editor opens.
- For a merge-bearing range, it returns expected FR-9 subjects equal to the picked first-parent subjects plus the flattened merge subjects, and returns the merge-to-flattened pairs, the absorption points, and the audit.
- For a refusal from Task 3, it returns that refusal and issues no `rebase` command.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase-flatten.test.ts`

**Dependencies:** 3

### Task 5: Wire performRebase to the shared primitive and prove the #2498 shape end to end
**Story:** 2
**Story:** 1
**Story:** 3
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/rebase-flatten-realgit.test.ts`. Build a feature branch with duplicated repair lineage through one ancestry-only merge and one content-bearing merge whose author differs from its committer, plus a base that advanced on unrelated files. Build a current branch and a mergeable-skip fixture.
2. Verify tests fail (RED).
3. Implement: in `performRebase`, replace the `rebase --autostash` call with `startFeatureReplay` after the seal check and replay-identity capture, attaching the flatten data (audit, pairs, expected subjects) to the returned `changed`, `noop`, and `conflict_halt` outcomes.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(rebase): performRebase replays merge-bearing branches flattened"

**Done when:**
- `performRebase` on the duplicated-lineage fixture returns `changed` with no conflict, and the rebased `HEAD^{tree}` equals both `git merge-tree --write-tree <pre-rebase HEAD> <base>` and the dry run's final tree, so the real replay ran after the in-place proof.
- After that rebase, `git log <base>..HEAD` has no commit with the ancestry-only merge's subject or content, `outcome.flatten.ancestryOnlyMerges` contains that merge sha, and `git rev-list --merges <base>..HEAD` is empty.
- After that rebase, exactly one non-merge commit carries the content-bearing merge's subject and a `Flattened-merge: <merge sha>` trailer, its diff against its parent equals `git diff <merge^1> <merge>`, and its `%an <%ae>` equals the merge's author.
- After that rebase, no commit subject reachable only through a merge's second parent in the fixture appears in `git log <base>..HEAD` as its own commit.
- For the already-current and mergeable-skip fixtures, each of which contains a merge commit in `main..HEAD`, `performRebase` returns `noop` and `mergeable_skip` respectively with no `commit-tree` or `merge-tree` flatten call in the runner log. The flattened fixture completes with stdin closed within the test timeout, reading its todo from the `--git-path` file.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase-flatten-realgit.test.ts`

**Dependencies:** 4

### Task 6: Halt a flatten refusal before mutation without dispatching the resolver
**Story:** 4
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests. The real-git test in `src/conductor/test/engine/rebase-flatten-realgit.test.ts` builds a flattened merge that conflicts with an advanced base. In `src/conductor/test/engine/rebase-resolution-wiring.test.ts`, drive `runRebaseStep` and `resumeRebaseFirst` with a `flatten_refused` outcome, a stub resolver, and a stub push runner.
2. Verify tests fail (RED).
3. Implement:
   - `performRebase` maps a primitive refusal to `flatten_refused`.
   - `runRebaseStep` (`conductor.ts`) and `resumeRebaseFirst` (`daemon-rekick.ts`) handle `flatten_refused` by writing `.pipeline/HALT` through `writeRebaseOutcomeHalt`, with the recipe as the only recovery note, and emitting `rebase_conflict_halt` with `mergeAudit` through `emitRebaseEvent`.
   - Neither caller passes a `flatten_refused` outcome to `runGatedRebaseResolution`.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(rebase): halt flatten refusals before mutation with a recovery recipe"

**Done when:**
- On the real-git conflicting-merge fixture, `performRebase` returns `flatten_refused` carrying the merge sha, both parent shas, the flattened sha, and the non-empty conflicting paths, and the runner log contains no `rebase` command.
- After that refusal, `git rev-parse HEAD`, `git ls-files --stage`, `git status --porcelain --ignored`, and `git for-each-ref` output are byte-identical to before, and neither `rebase-merge` nor `rebase-apply` exists under `git rev-parse --git-dir`.
- Both `runRebaseStep` and `resumeRebaseFirst` write `.pipeline/HALT` naming the refusal reason (merge sha, tree mismatch, or failed git subcommand), and its only recovery note is the recipe: park, `git -C <worktree> rebase -i --rebase-merges <base>`, re-apply `git diff <first parent> <merge>` at the merge stop, `git rebase --continue`, clear the HALT. The note contains neither `reset --hard`, nor `checkout --`, nor the paused-conflict resume note written for `conflict_halt`.
- Both callers emit a `rebase_conflict_halt` event whose `mergeAudit` holds those shas and paths and which is persisted to `.pipeline/events.jsonl`, while the stub resolver records zero calls and no `rebase_resolution_attempt` event is emitted.
- With that HALT present, finish for the feature does not run: the stub push runner records zero pushes, and `.pipeline/protected-artifact-seal.json` is byte-identical to before.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/test/engine/rebase-flatten-realgit.test.ts`, `src/conductor/test/engine/rebase-resolution-wiring.test.ts`

**Dependencies:** 1, 5

### Task 7: Pause, resolve, abort, autostash, and heal a flattened replay on the existing rebase state
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/rebase-flatten-realgit.test.ts` for a flattened branch whose first dry-run conflict is an ordinary commit, then its resolve-and-continue, abort, dirty-tracked-change, and untracked-collision variants.
2. Verify tests fail (RED).
3. Implement: carry the flattened `rebaseArgs` (including the `sequence.editor` override and todo path) into the existing untracked-collision heal retry in `performRebase`, so the retry reissues the identical command. The pause, continue, and abort paths need no new code beyond the shared primitive.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(rebase): flattened replays reuse the paused-rebase machinery"

**Done when:**
- On the ordinary-conflict fixture, `performRebase` issues `rebase -i --autostash <base>` with the engine-written todo and returns `conflict_halt` while `rebaseStateActive` is true, so the outcome reaches the gated resolver.
- After a stub resolver resolves the conflict and `git rebase --continue` runs, the remaining todo entries, including the `Flattened-merge:` commit, appear in `git log <base>..HEAD` and `rebaseStateActive` is false.
- Running `git rebase --abort` on the paused flattened replay restores `HEAD` to the pre-rebase sha, and `git rev-list --merges` again lists the original merges.
- An uncommitted tracked change present before a flattened replay is byte-identical in the worktree afterward, through `--autostash`.
- When git refuses the flattened replay over an untracked file, the heal quarantines it and the retry's recorded rebase arguments equal the first attempt's `-i` arguments with the same todo path, never the plain `rebase --autostash <base>`.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase-flatten-realgit.test.ts`

**Dependencies:** 5

### Task 8: Judge FR-9 against the replay list on a flattened replay
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase-resolution.test.ts` for `resolveRebaseConflictsInner` with a `conflict_halt` carrying flatten data, and with one that does not.
2. Verify tests fail (RED).
3. Implement: when the conflict outcome carries flatten data, `resolveRebaseConflictsInner` passes its expected subjects to `featureCommitsPreserved` instead of `log --format=%s {onto}..ORIG_HEAD`. Otherwise it keeps today's derivation.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(rebase): FR-9 expects the flattened replay list"

**Done when:**
- With flatten data whose ancestry-only merge and side-lineage subjects are absent from `base..HEAD` but every picked first-parent subject and flattened merge subject is present, `resolveRebaseConflictsInner` gets `preserved` from `featureCommitsPreserved`.
- With flatten data where a picked first-parent subject is missing afterward, `featureCommitsPreserved` returns `rejected` naming that subject, exactly as the existing FR-9 failure does.
- With flatten data where a flattened merge commit's subject is missing afterward, `featureCommitsPreserved` returns `rejected` naming that merge's subject.
- Without flatten data, the expected subjects come from `log --format=%s {onto}..ORIG_HEAD`, and the existing #2607 declared test-only exception tests in `rebase-resolution.test.ts` pass unchanged.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase-resolution.test.ts`

**Dependencies:** 4

### Task 9: Translate merge and side-lineage citations to their absorption point
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase-translate.test.ts` for `translateAfterRebase` with a flatten-pairs argument, covering a content-bearing merge, a side-lineage commit, an ancestry-only merge with and without a survivor, a patch-identical side commit, and a forged sha.
2. Verify tests fail (RED).
3. Implement: `translateAfterRebase` accepts the pairs and absorption points from `performRebase`. After `buildRewriteMap`'s patch-id pass, it adds entries only for unmapped pre-image shas named in those pairs, applying the ADR amendment D10 rule, before `applyMapToStores`, the obligation rewrite, and `writeResidue`.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(rebase-translate): absorb flattened merge and side-lineage citations"

**Done when:**
- After a flattened rebase, `translateAfterRebase` in `src/engine/rebase-translate.ts` rewrites an obligation `baseline.head` equal to a content-bearing merge sha, and an evidence citation of an absorbed side-lineage commit with no patch-id twin, to the post-image sha of that merge's flattened commit.
- A citation of an ancestry-only merge maps to the post-image of the first surviving first-parent commit after it. When no such commit survives, the sha is written to `.pipeline/rebase-residue.json` and named by a `rebase_citation_residue` event.
- A side-lineage commit patch-identical to a first-parent commit maps to that commit's post-image through `buildRewriteMap`'s patch-id pass before any absorption entry is considered.
- A sha absent from the pre-image and from the pairs is not added to the map and `resolveThroughMap` returns it unchanged, while every sha mapped by absorption is absent from `.pipeline/rebase-residue.json` and from every `rebase_citation_residue` entry.
- Every absorption value persisted in `.pipeline/rebase-rewrites.json` satisfies `git merge-base --is-ancestor <value> HEAD`, and changing the fixture's commit subjects, trailers, or paths without changing the pairs leaves the map byte-identical.

**Files:** `src/conductor/src/engine/rebase-translate.ts`, `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase-translate.test.ts`

**Dependencies:** 4

### Task 10: Emit the merge audit on the event spine only
**Story:** 8
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase-flatten-events.test.ts` for `emitRebaseEvent`, covering a flattened `changed` outcome, merge-free `changed`/`noop` outcomes, a merge-free `conflict_halt`, and persistence through `EventPersister`.
2. Verify tests fail (RED).
3. Implement: `emitRebaseEvent` in `rebase.ts` emits one `rebase_merge_audit` when the outcome carries a flatten audit, and none otherwise. `rebase_conflict_halt` gets `mergeAudit` only from `flatten_refused`.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(rebase): record flattened rebases as rebase_merge_audit events"

**Done when:**
- For a flattened outcome from the two-merge fixture, `emitRebaseEvent` emits exactly one `rebase_merge_audit` event whose `flattenedMerges`, `ancestryOnlyMerges`, and `sideLineageCount` equal the fixture's shas and count, and `EventPersister` writes that record to `.pipeline/events.jsonl`.
- For merge-free clean outcomes, a branch whose only merge is reachable from the base, and the merge-bearing already-current and mergeable-skip fixtures of Task 5, `emitRebaseEvent` emits no `rebase_merge_audit` event, and the existing `rebase.test.ts` outcome-kind assertions pass unchanged.
- For a merge-free conflicted rebase, `performRebase` returns `conflict_halt` and `emitRebaseEvent` emits `rebase_conflict_halt` with no `mergeAudit` field.
- A flattened rebase creates the same set of files under the worktree and `.pipeline/` as a merge-free rebase of the same base (compared by directory listing), and the daemon log writer receives no audit line.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase-flatten-events.test.ts`

**Dependencies:** 1, 5

### Task 11: Route open-PR autoresolve through the shared primitive
**Story:** 9
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/autoresolve-flatten.test.ts`, using the `autoresolve-pr-fixture.ts` real-git fixture with a merge-bearing PR branch and a merge-free one, plus an injected runner.
2. Verify tests fail (RED).
3. Implement: replace `git(['rebase', '--autostash', baseRef])` in `autoresolve.ts` with `startFeatureReplay`, and feed its expected subjects to `acceptanceGuards` in place of the locally captured `subjectsBefore` when the replay was flattened, and emit `rebase_merge_audit` through `deps.events` for a flattened replay. Leave the `--continue`/`--abort` calls unchanged.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(autoresolve): start PR rebases through the shared replay primitive"

**Done when:**
- `src/engine/autoresolve.ts` calls `startFeatureReplay` to start its rebase, and outside that call contains no git argument list beginning with `'rebase'` other than `'rebase', '--continue'` and `'rebase', '--abort'`, while its existing `rebase --continue` and `rebase --abort` calls remain.
- For a merge-free PR branch, the injected runner records exactly `['rebase', '--autostash', baseRef]` as autoresolve's rebase command, as today.
- For the merge-bearing PR fixture with duplicated lineage, autoresolve replays the flattened list with no conflict and no `rebase-error` escalation, `acceptanceGuards` is invoked, and the stub publication push is recorded once.
- On the flattened PR replay, `acceptanceGuards` receives the primitive's expected subjects for `featureCommitsPreserved`, and a missing picked subject makes it escalate with reason `acceptance-guards`, as today.
- On the flattened PR replay, autoresolve emits exactly one `rebase_merge_audit` event through `deps.events` carrying the primitive's flattened merge shas, ancestry-only merge shas, and side-lineage count, and emits none for a merge-free PR branch.

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/test/engine/autoresolve-flatten.test.ts`

**Dependencies:** 4, 8

### Task 12: Escalate autoresolve flatten refusals and resolve paused flattened replays
**Story:** 9
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/autoresolve-flatten.test.ts` for a refused flattened PR replay and for a flattened PR replay paused on an ordinary conflict.
2. Verify tests fail (RED).
3. Implement: in `autoresolve.ts`, a refusal from `startFeatureReplay` calls `escalate` with reason `merge-flatten-refused` and a detail carrying the merge sha and recipe, before `runTier1`. A paused flattened replay enters the existing tier-1 and tier-2 path unchanged.
4. Verify tests pass (GREEN).
5. Commit with message: "feat(autoresolve): escalate flatten refusals with the recovery recipe"

**Done when:**
- When `startFeatureReplay` refuses a flattened PR replay, autoresolve calls `escalate` with reason `merge-flatten-refused` and a detail containing the merge sha and the recovery recipe, `runTier1` and the tier-2 resolver are called zero times, and the stub push runner records zero pushes.
- When a flattened PR replay pauses on an ordinary conflict, `runTier1` and the tier-2 resolver run against the paused `rebase -i` state with the conflicted files listed, and completing resolution replays the remaining todo entries and reaches `acceptanceGuards`, matching the plain-rebase fixture's call sequence.

**Files:** `src/conductor/src/engine/autoresolve.ts`, `src/conductor/test/engine/autoresolve-flatten.test.ts`

**Dependencies:** 11

## Task Dependency Graph

```text
1 ─▶ 2 ─▶ 3 ─▶ 4 ─┬─▶ 5 ─┬─▶ 6 (also needs 1)
                  │      ├─▶ 7
                  │      └─▶ 10 (also needs 1)
                  ├─▶ 8 ─┐
                  ├─▶ 9  │
                  └──────┴─▶ 11 ─▶ 12
```

## Integration Points

- **After Task 5:** the #2498 duplicated-lineage shape rebases cleanly through `performRebase`, which serves both the rebase `loopGate` and the re-kick path.
- **After Task 6:** a conflicting flattened merge halts on both `runRebaseStep` and `resumeRebaseFirst` without resolver dispatch.
- **After Task 11:** the open-PR autoresolve sweep replays merge-bearing PR branches through the same primitive.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature branch whose `base..HEAD` range contains no merge commit, when the engine rebase runs, then the only rebase command it issues is `git rebase --autostash <base>` with no `-i`, no `sequence.editor` override, and no `commit-tree` call. | 4 | "For a range where `rev-list --merges <base>..HEAD` is empty, including one whose only merge is reachable from the base, `startFeatureReplay` in `src/engine/rebase.ts` issues exactly `['rebase', '--autostash', <base>]`, and the runner log has no `-i`, no `sequence.editor` override, no `commit-tree`, and no `merge-tree` call." | diff-local |
| Story 1 happy: Given the same branch, when the rebase completes cleanly, then no `rebase_merge_audit` event is emitted and the rebase outcome kind matches today's outcome for that branch. | 10 | "For merge-free clean outcomes, a branch whose only merge is reachable from the base, and the merge-bearing already-current and mergeable-skip fixtures of Task 5, `emitRebaseEvent` emits no `rebase_merge_audit` event, and the existing `rebase.test.ts` outcome-kind assertions pass unchanged." | diff-local |
| Story 1 negative: Given a branch whose only merge commit is reachable from the base (and so is outside `base..HEAD`), when the engine rebase runs, then it takes the unchanged `git rebase --autostash <base>` path and emits no `rebase_merge_audit` event. | 4, 10 | "For a range where `rev-list --merges <base>..HEAD` is empty, including one whose only merge is reachable from the base, `startFeatureReplay` in `src/engine/rebase.ts` issues exactly `['rebase', '--autostash', <base>]`, and the runner log has no `-i`, no `sequence.editor` override, no `commit-tree`, and no `merge-tree` call." | diff-local |
| Story 1 negative: Given a branch with no merges whose rebase conflicts, when the engine rebase runs, then it returns the existing `conflict_halt` outcome for the resolver path, with no `mergeAudit` field on `rebase_conflict_halt`. | 10 | "For a merge-free conflicted rebase, `performRebase` returns `conflict_halt` and `emitRebaseEvent` emits `rebase_conflict_halt` with no `mergeAudit` field." | diff-local |
| Story 1 negative: Given a merge-bearing branch that is already current with the base, or that finish classifies as a mergeable skip, when the engine rebase runs, then it returns `noop` or `mergeable_skip` as today, issues no `commit-tree` or `merge-tree` flatten call, and emits no `rebase_merge_audit` event. | 5, 10 | "For the already-current and mergeable-skip fixtures, each of which contains a merge commit in `main..HEAD`, `performRebase` returns `noop` and `mergeable_skip` respectively with no `commit-tree` or `merge-tree` flatten call in the runner log. The flattened fixture completes with stdin closed within the test timeout, reading its todo from the `--git-path` file." | diff-local |
| Story 2 happy: Given a feature branch with a merge whose second parent carries commits patch-identical to commits on the first parent, when the engine rebase runs onto a base that does not touch those files, then the rebase completes with no conflict and the rebased HEAD tree equals the merge of the pre-rebase HEAD and the base. | 5 | "`performRebase` on the duplicated-lineage fixture returns `changed` with no conflict, and the rebased `HEAD^{tree}` equals both `git merge-tree --write-tree <pre-rebase HEAD> <base>` and the dry run's final tree, so the real replay ran after the in-place proof." | diff-local |
| Story 2 happy: Given a merge whose tree equals its first parent's tree, when the engine rebase completes, then the rebased history contains no commit carrying that merge's content or subject, and the merge sha is listed as ancestry-only in the audit. | 5, 2 | "After that rebase, `git log <base>..HEAD` has no commit with the ancestry-only merge's subject or content, `outcome.flatten.ancestryOnlyMerges` contains that merge sha, and `git rev-list --merges <base>..HEAD` is empty." | diff-local |
| Story 2 happy: Given a merge whose tree differs from its first parent's tree, when the engine rebase completes, then the rebased history contains exactly one non-merge commit carrying that merge's subject, a `Flattened-merge: <merge sha>` trailer, and the diff from the merge's first parent to the merge. | 5, 2 | "After that rebase, exactly one non-merge commit carries the content-bearing merge's subject and a `Flattened-merge: <merge sha>` trailer, its diff against its parent equals `git diff <merge^1> <merge>`, and its `%an <%ae>` equals the merge's author." | diff-local |
| Story 2 negative: Given a merge-bearing branch, when the engine rebase completes, then no side-lineage commit (reachable only through a merge's second parent) appears in the rebased history as its own commit. | 5, 2 | "After that rebase, no commit subject reachable only through a merge's second parent in the fixture appears in `git log <base>..HEAD` as its own commit." | diff-local |
| Story 2 negative: Given a branch whose first parent is itself a chain of several merges, when the replay list is built, then each merge is classified independently by its own first parent's tree and none is skipped or classified twice. | 2 | "`planFlattenedReplay` in `src/engine/rebase.ts` classifies each merge of the three-merge first-parent chain fixture exactly once by comparing that merge's tree to its own first parent's tree, so none is skipped or classified twice, as asserted by the per-merge classification test." | diff-local |
| Story 2 negative: Given a merge whose author differs from the committer, when it is flattened, then the flattened commit carries the merge's author identity. | 5, 2 | "After that rebase, exactly one non-merge commit carries the content-bearing merge's subject and a `Flattened-merge: <merge sha>` trailer, its diff against its parent equals `git diff <merge^1> <merge>`, and its `%an <%ae>` equals the merge's author." | diff-local |
| Story 3 happy: Given a merge-bearing branch, when the replay list is dry-run onto the merge base, then the resulting tree id equals HEAD's tree id and the real replay proceeds. | 3, 5 | "`proveFlattenedReplay` in `src/engine/rebase.ts` replays the list onto the merge base with chained `merge-tree --write-tree --merge-base` and `commit-tree`, and reports `proven` only when the final tree id equals `HEAD^{tree}`, as asserted by the tree-equal fixture." | diff-local |
| Story 3 happy: Given a proven replay list, when the dry run onto the target is clean, then the real replay runs and its final tree id equals the dry run's final tree id. | 5 | "`performRebase` on the duplicated-lineage fixture returns `changed` with no conflict, and the rebased `HEAD^{tree}` equals both `git merge-tree --write-tree <pre-rebase HEAD> <base>` and the dry run's final tree, so the real replay ran after the in-place proof." | diff-local |
| Story 3 negative: Given a replay list whose in-place dry run yields a tree different from HEAD's tree, when the engine rebase runs, then it refuses with a halt naming the tree mismatch, and HEAD, the index, the worktree, and every ref are byte-identical to before. | 3, 6 | "When the in-place final tree differs from `HEAD^{tree}`, it returns a refusal whose reason names the tree mismatch and both tree ids, and the runner log contains no `rebase` command." | diff-local |
| Story 3 negative: Given the git runner returns a non-zero exit for `merge-tree` or `commit-tree` during the dry run for any reason other than a conflict, when the engine rebase runs, then it refuses fail-closed with a halt naming the failed command and leaves the checkout unchanged. | 3, 6 | "When the runner returns a non-zero exit other than merge-tree's conflict exit 1 for `merge-tree` or `commit-tree`, it returns a fail-closed refusal whose reason names that failed git subcommand, and no `rebase` command is issued." | diff-local |
| Story 3 negative: Given the dry run completes, when the worktree is inspected, then no file under the worktree was created or modified by the dry run (the todo file lives under the git directory). | 3 | "The real-git test shows byte-identical `git rev-parse HEAD`, `git ls-files --stage`, `git status --porcelain --ignored`, and `git for-each-ref` output before and after a tree-mismatch refusal and a failed-command refusal, and no created or modified file under the worktree after a successful dry run." | diff-local |
| Story 4 happy: Given a merge-bearing branch whose first dry-run conflict against the target falls on a flattened merge commit, when `performRebase` runs, then it returns a `flatten_refused` outcome carrying the merge sha, both parent shas, the flattened sha, and the conflicting paths, without issuing any rebase command. | 6 | "On the real-git conflicting-merge fixture, `performRebase` returns `flatten_refused` carrying the merge sha, both parent shas, the flattened sha, and the non-empty conflicting paths, and the runner log contains no `rebase` command." | diff-local |
| Story 4 happy: Given a `flatten_refused` outcome on the rebase step or the re-kick path, when the caller handles it, then `.pipeline/HALT` is written whose only recovery note is the recipe: park, `git -C <worktree> rebase -i --rebase-merges <base>`, re-apply `git diff <first parent> <merge>` at the merge stop, `git rebase --continue`, clear the HALT; and `rebase_conflict_halt` is emitted with its `mergeAudit` field populated. | 6 | "Both `runRebaseStep` and `resumeRebaseFirst` write `.pipeline/HALT` naming the refusal reason (merge sha, tree mismatch, or failed git subcommand), and its only recovery note is the recipe: park, `git -C <worktree> rebase -i --rebase-merges <base>`, re-apply `git diff <first parent> <merge>` at the merge stop, `git rebase --continue`, clear the HALT. The note contains neither `reset --hard`, nor `checkout --`, nor the paused-conflict resume note written for `conflict_halt`." | diff-local |
| Story 4 negative: Given a `flatten_refused` outcome, when the rebase step or the re-kick path handles it, then the gated rebase resolver is never dispatched and no resolution attempt event is emitted. | 6 | "Both callers emit a `rebase_conflict_halt` event whose `mergeAudit` holds those shas and paths and which is persisted to `.pipeline/events.jsonl`, while the stub resolver records zero calls and no `rebase_resolution_attempt` event is emitted." | diff-local |
| Story 4 negative: Given a `flatten_refused` outcome, when HEAD, the index, the worktree, and refs are compared to their pre-rebase state, then all are unchanged and no `.git/rebase-merge` or `.git/rebase-apply` directory exists. | 6 | "After that refusal, `git rev-parse HEAD`, `git ls-files --stage`, `git status --porcelain --ignored`, and `git for-each-ref` output are byte-identical to before, and neither `rebase-merge` nor `rebase-apply` exists under `git rev-parse --git-dir`." | diff-local |
| Story 4 negative: Given a `flatten_refused` halt, when the halt record is inspected, then it contains neither `reset --hard` nor `checkout --` nor the paused-conflict instruction to resolve and `--continue` an existing rebase. | 6 | "Both `runRebaseStep` and `resumeRebaseFirst` write `.pipeline/HALT` naming the refusal reason (merge sha, tree mismatch, or failed git subcommand), and its only recovery note is the recipe: park, `git -C <worktree> rebase -i --rebase-merges <base>`, re-apply `git diff <first parent> <merge>` at the merge stop, `git rebase --continue`, clear the HALT. The note contains neither `reset --hard`, nor `checkout --`, nor the paused-conflict resume note written for `conflict_halt`." | diff-local |
| Story 4 negative: Given a `flatten_refused` halt, when finish is attempted for the feature, then finish is blocked, no push is issued, and the protected-artifact seal is not rotated. | 6 | "With that HALT present, finish for the feature does not run: the stub push runner records zero pushes, and `.pipeline/protected-artifact-seal.json` is byte-identical to before." | diff-local |
| Story 5 happy: Given a merge-bearing branch whose first dry-run conflict falls on an ordinary commit, when the engine rebase runs, then it starts `git rebase -i --autostash <base>` with the engine-written todo and returns the existing `conflict_halt` outcome with an active rebase state for the gated resolver. | 7 | "On the ordinary-conflict fixture, `performRebase` issues `rebase -i --autostash <base>` with the engine-written todo and returns `conflict_halt` while `rebaseStateActive` is true, so the outcome reaches the gated resolver." | diff-local |
| Story 5 happy: Given the resolver resolves that conflict, when `git rebase --continue` runs, then the remaining todo entries (including flattened merge commits) replay and the rebase completes. | 7 | "After a stub resolver resolves the conflict and `git rebase --continue` runs, the remaining todo entries, including the `Flattened-merge:` commit, appear in `git log <base>..HEAD` and `rebaseStateActive` is false." | diff-local |
| Story 5 negative: Given a flattened replay paused on a conflict, when the resolution worktree lifecycle aborts, then `git rebase --abort` restores the pre-rebase HEAD including its merge commits. | 7 | "Running `git rebase --abort` on the paused flattened replay restores `HEAD` to the pre-rebase sha, and `git rev-list --merges` again lists the original merges." | diff-local |
| Story 5 negative: Given the engine-written todo, when the rebase starts, then the todo file is read from the git directory and the editor never opens (no interactive prompt, no hang). | 4, 5 | "For a proven merge-bearing range, it writes the todo to the path returned by `rev-parse --git-path ai-conductor-flatten-todo` and issues `rebase -i --autostash <base>` with a `-c sequence.editor=` command that copies that file, so no editor opens." | diff-local |
| Story 5 negative: Given dirty tracked changes in the worktree, when a flattened replay runs, then `--autostash` stashes and reapplies them as it does on today's path. | 7 | "An uncommitted tracked change present before a flattened replay is byte-identical in the worktree afterward, through `--autostash`." | diff-local |
| Story 5 negative: Given a flattened replay refused by git because an untracked file would be overwritten, when the existing untracked-collision heal quarantines the file and retries, then the retry reissues the same `git rebase -i --autostash <base>` with the same engine-written todo, not the plain command. | 7 | "When git refuses the flattened replay over an untracked file, the heal quarantines it and the retry's recorded rebase arguments equal the first attempt's `-i` arguments with the same todo path, never the plain `rebase --autostash <base>`." | diff-local |
| Story 6 happy: Given a flattened replay resolved through the resolver, when FR-9 runs, then it passes when every picked first-parent commit subject and every flattened merge subject is present in `base..HEAD`, even though ancestry-only merge and side-lineage subjects are absent. | 8 | "With flatten data whose ancestry-only merge and side-lineage subjects are absent from `base..HEAD` but every picked first-parent subject and flattened merge subject is present, `resolveRebaseConflictsInner` gets `preserved` from `featureCommitsPreserved`." | diff-local |
| Story 6 negative: Given a flattened replay where the resolver skipped a picked first-parent commit, when FR-9 runs, then it fails naming that commit's subject exactly as today. | 8 | "With flatten data where a picked first-parent subject is missing afterward, `featureCommitsPreserved` returns `rejected` naming that subject, exactly as the existing FR-9 failure does." | diff-local |
| Story 6 negative: Given a flattened replay where a flattened merge commit's subject is missing afterward, when FR-9 runs, then it fails naming the merge's subject. | 8 | "With flatten data where a flattened merge commit's subject is missing afterward, `featureCommitsPreserved` returns `rejected` naming that merge's subject." | diff-local |
| Story 6 negative: Given an unflattened replay, when FR-9 runs, then its expected subjects are still derived from `{onto}..ORIG_HEAD` and the #2607 declared test-only exception behaves unchanged. | 8 | "Without flatten data, the expected subjects come from `log --format=%s {onto}..ORIG_HEAD`, and the existing #2607 declared test-only exception tests in `rebase-resolution.test.ts` pass unchanged." | diff-local |
| Story 6 negative: Given a flattened replay on the open-PR autoresolve path, when its acceptance guards run, then FR-9 uses the same replay-list subjects returned by the shared primitive, and a missing picked subject fails the guard and escalates as today. | 11 | "On the flattened PR replay, `acceptanceGuards` receives the primitive's expected subjects for `featureCommitsPreserved`, and a missing picked subject makes it escalate with reason `acceptance-guards`, as today." | diff-local |
| Story 7 happy: Given a repair obligation whose `baseline.head` is a content-bearing merge sha, when a flattened rebase completes and translation runs, then `baseline.head` equals the post-image sha of that merge's flattened commit. | 9 | "After a flattened rebase, `translateAfterRebase` in `src/engine/rebase-translate.ts` rewrites an obligation `baseline.head` equal to a content-bearing merge sha, and an evidence citation of an absorbed side-lineage commit with no patch-id twin, to the post-image sha of that merge's flattened commit." | diff-local |
| Story 7 happy: Given evidence citing a side-lineage commit with no patch-id twin, absorbed by a content-bearing merge, when translation runs, then the citation maps to that merge's flattened post-image. | 9 | "After a flattened rebase, `translateAfterRebase` in `src/engine/rebase-translate.ts` rewrites an obligation `baseline.head` equal to a content-bearing merge sha, and an evidence citation of an absorbed side-lineage commit with no patch-id twin, to the post-image sha of that merge's flattened commit." | diff-local |
| Story 7 happy: Given a citation to an ancestry-only merge, when translation runs, then it maps to the post-image of the first surviving first-parent commit after that merge. | 9 | "A citation of an ancestry-only merge maps to the post-image of the first surviving first-parent commit after it. When no such commit survives, the sha is written to `.pipeline/rebase-residue.json` and named by a `rebase_citation_residue` event." | diff-local |
| Story 7 happy: Given a side-lineage commit patch-identical to a first-parent commit, when translation runs, then it maps by patch-id to that commit's post-image before any absorption rule applies. | 9 | "A side-lineage commit patch-identical to a first-parent commit maps to that commit's post-image through `buildRewriteMap`'s patch-id pass before any absorption entry is considered." | diff-local |
| Story 7 negative: Given an ancestry-only merge with no surviving first-parent commit after it, when translation runs, then the sha stays residue and `rebase_citation_residue` reports it. | 9 | "A citation of an ancestry-only merge maps to the post-image of the first surviving first-parent commit after it. When no such commit survives, the sha is written to `.pipeline/rebase-residue.json` and named by a `rebase_citation_residue` event." | diff-local |
| Story 7 negative: Given a sha that was never on the branch before the rebase, when translation runs, then it is not added to the map and is returned unchanged (no laundering). | 9 | "A sha absent from the pre-image and from the pairs is not added to the map and `resolveThroughMap` returns it unchanged, while every sha mapped by absorption is absent from `.pipeline/rebase-residue.json` and from every `rebase_citation_residue` entry." | diff-local |
| Story 7 negative: Given a side-lineage commit or merge that the absorption rule mapped, when translation completes, then that sha does not appear in `.pipeline/rebase-residue.json` and no `rebase_citation_residue` entry names it. | 9 | "A sha absent from the pre-image and from the pairs is not added to the map and `resolveThroughMap` returns it unchanged, while every sha mapped by absorption is absent from `.pipeline/rebase-residue.json` and from every `rebase_citation_residue` entry." | diff-local |
| Story 7 negative: Given a flattened rebase, when `.pipeline/rebase-rewrites.json` is read, then every absorption entry's value is reachable from HEAD and no entry was derived from subjects, trailers, or paths. | 9 | "Every absorption value persisted in `.pipeline/rebase-rewrites.json` satisfies `git merge-base --is-ancestor <value> HEAD`, and changing the fixture's commit subjects, trailers, or paths without changing the pairs leaves the map byte-identical." | diff-local |
| Story 8 happy: Given a merge-bearing branch that flattens successfully, when the rebase runs, then exactly one `rebase_merge_audit` event is emitted, carrying the flattened merge shas, the ancestry-only merge shas, and the side-lineage commit count. | 10 | "For a flattened outcome from the two-merge fixture, `emitRebaseEvent` emits exactly one `rebase_merge_audit` event whose `flattenedMerges`, `ancestryOnlyMerges`, and `sideLineageCount` equal the fixture's shas and count, and `EventPersister` writes that record to `.pipeline/events.jsonl`." | diff-local |
| Story 8 happy: Given the emitted event, when `.pipeline/events.jsonl` is read, then it contains the `rebase_merge_audit` record per its `EVENT_SINKS` declaration. | 10 | "For a flattened outcome from the two-merge fixture, `emitRebaseEvent` emits exactly one `rebase_merge_audit` event whose `flattenedMerges`, `ancestryOnlyMerges`, and `sideLineageCount` equal the fixture's shas and count, and `EventPersister` writes that record to `.pipeline/events.jsonl`." | diff-local |
| Story 8 negative: Given a flattened rebase, when the worktree and `.pipeline/` are inspected, then no sidecar file, marker file, or log line other than the persisted event records the audit. | 10 | "A flattened rebase creates the same set of files under the worktree and `.pipeline/` as a merge-free rebase of the same base (compared by directory listing), and the daemon log writer receives no audit line." | diff-local |
| Story 8 negative: Given a `ConductorEvent` union that gains `rebase_merge_audit` without an `EVENT_SINKS` row, when the engine compiles, then compilation fails. | 1 | "`EVENT_SINKS` in `src/engine/event-sinks.ts` declares `rebase_merge_audit` with `persist: true`, and deleting that row makes `npm run typecheck` fail because the registry is typed `Record<ConductorEvent['type'], SinkDeclaration>`, so compilation fails for a union member with no `EVENT_SINKS` row." | diff-local |
| Story 9 happy: Given an open PR branch whose `baseRef..HEAD` range contains a merge with duplicated lineage, when autoresolve rebases it, then it starts the rebase through the shared primitive, replays the flattened list with no add/add conflict, and proceeds to its existing acceptance guards and publication. | 11 | "For the merge-bearing PR fixture with duplicated lineage, autoresolve replays the flattened list with no conflict and no `rebase-error` escalation, `acceptanceGuards` is invoked, and the stub publication push is recorded once." | diff-local |
| Story 9 happy: Given an open PR branch with no merge in range, when autoresolve rebases it, then the command it issues is `git rebase --autostash <baseRef>` exactly as today. | 11 | "For a merge-free PR branch, the injected runner records exactly `['rebase', '--autostash', baseRef]` as autoresolve's rebase command, as today." | diff-local |
| Story 9 negative: Given the shared primitive refuses a flattened replay for an open PR branch, when autoresolve handles the refusal, then it escalates with reason `merge-flatten-refused` whose detail contains the merge sha and the recipe, and it neither enters tier-1 or tier-2 resolution nor pushes. | 12 | "When `startFeatureReplay` refuses a flattened PR replay, autoresolve calls `escalate` with reason `merge-flatten-refused` and a detail containing the merge sha and the recovery recipe, `runTier1` and the tier-2 resolver are called zero times, and the stub push runner records zero pushes." | diff-local |
| Story 9 negative: Given `autoresolve.ts`, when its source is inspected, then it contains no direct `git rebase` start invocation outside the shared primitive (the continue and abort commands of its existing resolution stay as they are). | 11 | "`src/engine/autoresolve.ts` calls `startFeatureReplay` to start its rebase, and outside that call contains no git argument list beginning with `'rebase'` other than `'rebase', '--continue'` and `'rebase', '--abort'`, while its existing `rebase --continue` and `rebase --abort` calls remain." | diff-local |
| Story 9 negative: Given a flattened replay on the autoresolve path pauses on an ordinary conflict, when tier-1 and tier-2 resolution run, then they operate on the paused `rebase -i` state exactly as they do on a plain rebase. | 12 | "When a flattened PR replay pauses on an ordinary conflict, `runTier1` and the tier-2 resolver run against the paused `rebase -i` state with the conflicted files listed, and completing resolution replays the remaining todo entries and reaches `acceptanceGuards`, matching the plain-rebase fixture's call sequence." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D1 | task | task-4, task-11 | For a range where `rev-list --merges <base>..HEAD` is empty, including one whose only merge is reachable from the base, |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D2 | task | task-2 | `planFlattenedReplay` in `src/engine/rebase.ts` classifies each merge of the three-merge first-parent chain fixture |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D3 | task | task-3 | `proveFlattenedReplay` in `src/engine/rebase.ts` replays the list onto the merge base with chained `merge-tree |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D4 | task | task-4, task-7 | For a proven merge-bearing range, it writes the todo to the path returned by `rev-parse --git-path |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D5 | task | task-6, task-12 | Both `runRebaseStep` and `resumeRebaseFirst` write `.pipeline/HALT` naming the refusal reason (merge sha, tree |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D6 | task | task-10, task-11 | For a flattened outcome from the two-merge fixture, `emitRebaseEvent` emits exactly one `rebase_merge_audit` event |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D7 | no-change | none | selective post-rebase verification keeps its immutable P/B/O identities captured in performRebase before replay; D3 proves the flattened list tree-equal to P, so its tree-identity proof applies unchanged and no code changes |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D8 | task | task-11 | `src/engine/autoresolve.ts` calls `startFeatureReplay` to start its rebase, and outside that call contains no git |
| adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history#D9 | existing | none | `startFeatureReplay` in src/conductor/src/engine/rebase.ts returns an unflattened refusal when no merge, parent pair, or flattened sha exists; `performRebase` maps it to a `startFailure` conflict_halt and autoresolve.ts escalates it as `rebase-error` |
| adr-2026-06-29-rebase-conflict-resolution-dispatch#D1 | existing | none | `featureCommitsPreserved` in src/conductor/src/engine/rebase.ts already accepts `declaredSuperseded` and excuses only declared test-only commits; Task 8 leaves that branch unchanged |
| adr-2026-06-29-rebase-conflict-resolution-dispatch#D2 | task | task-8 | With flatten data whose ancestry-only merge and side-lineage subjects are absent from `base..HEAD` but every picked |
| adr-2026-07-12-rebase-evidence-stamp-translation#D1 | existing | none | `buildRewriteMap` in src/conductor/src/engine/rebase-translate.ts builds the old-to-new map by `git patch-id --stable` correspondence |
| adr-2026-07-12-rebase-evidence-stamp-translation#D2 | existing | none | `applyMapToStores` in src/conductor/src/engine/rebase-translate.ts rewrites task-evidence.json and task-status.json atomically |
| adr-2026-07-12-rebase-evidence-stamp-translation#D3 | existing | none | src/conductor/src/engine/gate-code-validity.ts resolves stamped shas through `resolveThroughMap` at read time |
| adr-2026-07-12-rebase-evidence-stamp-translation#D4 | existing | none | `writeResidue` in src/conductor/src/engine/rebase-translate.ts writes .pipeline/rebase-residue.json and emits `rebase_citation_residue` |
| adr-2026-07-12-rebase-evidence-stamp-translation#D5 | existing | none | `resolveThroughMap` in src/conductor/src/engine/rebase-translate.ts substitutes only map keys and returns unknown shas unchanged |
| adr-2026-07-12-rebase-evidence-stamp-translation#D6 | existing | none | `translateAfterRebase` in src/conductor/src/engine/rebase-translate.ts rewrites repair-obligation `baseline.head` through the map |
| adr-2026-07-12-rebase-evidence-stamp-translation#D7 | existing | none | `selectRepairBoundaryTranslation` and `listFirstParentPreImageOldestFirst` in src/conductor/src/engine/rebase-translate.ts implement the nearest-surviving-successor rule |
| adr-2026-07-12-rebase-evidence-stamp-translation#D8 | existing | none | `translateAfterRebase` emits `repair_boundary_translated` events in src/conductor/src/engine/rebase-translate.ts |
| adr-2026-07-12-rebase-evidence-stamp-translation#D9 | existing | none | `translateRepairBoundary` in src/conductor/src/engine/autoheal.ts follows .pipeline/rebase-rewrites.json as the read-time fallback |
| adr-2026-07-12-rebase-evidence-stamp-translation#D10 | task | task-9 | After a flattened rebase, `translateAfterRebase` in `src/engine/rebase-translate.ts` rewrites an obligation |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [x] Dependencies are explicit and acyclic

### Task rem-as-built-rem-ab9-1: src/conductor/src/engine/rebase.ts:937-940 — build the flattened commit-tree stdin through withDaemonCoAuthorTrailer (already imported at rebase.ts:16) so the message is withDaemonCoAuthorTrailer(`${subject}\n\nFlattened-merge: ${sha}`), keeping the subject, the Flattened-merge line and the -c user.name/user.email author identity unchanged (Task 2 Done-when preserved); add a src/conductor/test/engine/rebase-flatten.test.ts case that installs a resolved bot co-author and asserts the planFlattenedReplay commit-tree input carries the subject, the Flattened-merge: <merge sha> line and the co-author trailer exactly once, while the existing unconfigured Task 2 case still sees Flattened-merge as the last line
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift (as-built AB-9, adr-2026-09-11-github-operation-ownership D10, 99% verified): rebase.ts:937-940 passes a raw `${subject}\n\nFlattened-merge: ${sha}\n` message to commit-tree instead of withDaemonCoAuthorTrailer, and daemon-commit-co-author-guard.test.ts:21 only matches argument arrays that begin with 'commit'/'commit-tree', so the '-c'-prefixed call escapes it; the approved ADR stays authoritative, so this is build work. No active plan task's Done-when names co-author attribution (Task 2 fixes the message subject/trailer/author only), so new tasks are appended. Sweep: rebase.ts:938 is the only '-c'-prefixed commit/commit-tree call in src/ (grep), and rebase.ts:815 is already wrapped. Coverage preserved: Task 2's Done-when (subject, Flattened-merge line, -c user.name/user.email = merge author) and Task 5's realgit trailer assertions stay unchanged and still hold because the helper is a no-op when no bot co-author is installed.
**Governing clause:** adr-2026-09-11-github-operation-ownership decision 10
**Done when:**
- adr-2026-09-11-github-operation-ownership decision 10 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab9-1 is complete.

### Task rem-as-built-rem-ab9-2: src/conductor/test/engine/daemon-commit-co-author-guard.test.ts:21-24 — widen the scan regex to accept leading git global options (any number of '-c', '<value>' pairs, literal or template) before 'commit'/'commit-tree' so prefixed invocations are scanned; add fixture cases: "await git(['-c', 'user.name=x', 'commit-tree', 'tree'], { input: 'raw' });" is reported with its file and line, and the same call with { input: withDaemonCoAuthorTrailer('m') } is allowed; the existing unprefixed commit/commit-tree fixtures and the repo-wide scan stay unchanged and the repo-wide scan passes after rem-ab9-1
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift (as-built AB-9, adr-2026-09-11-github-operation-ownership D10, 99% verified): rebase.ts:937-940 passes a raw `${subject}\n\nFlattened-merge: ${sha}\n` message to commit-tree instead of withDaemonCoAuthorTrailer, and daemon-commit-co-author-guard.test.ts:21 only matches argument arrays that begin with 'commit'/'commit-tree', so the '-c'-prefixed call escapes it; the approved ADR stays authoritative, so this is build work. No active plan task's Done-when names co-author attribution (Task 2 fixes the message subject/trailer/author only), so new tasks are appended. Sweep: rebase.ts:938 is the only '-c'-prefixed commit/commit-tree call in src/ (grep), and rebase.ts:815 is already wrapped. Coverage preserved: Task 2's Done-when (subject, Flattened-merge line, -c user.name/user.email = merge author) and Task 5's realgit trailer assertions stay unchanged and still hold because the helper is a no-op when no bot co-author is installed.
**Governing clause:** adr-2026-09-11-github-operation-ownership decision 10
**Done when:**
- adr-2026-09-11-github-operation-ownership decision 10 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab9-2 is complete.

### Task rem-as-built-rem-ab10-1: src/conductor/src/engine/rebase.ts:1050 — split the rev-list --merges stdout on newlines, drop empty lines, and require every remaining line to match /^[0-9a-f]{40}$/i; any non-matching line returns the existing 'rev-list --merges returned malformed output' refusal that performRebase maps to D9's startFailure conflict_halt with no rebase command; in src/conductor/test/engine/rebase.test.ts:305-327 update the stale malformed-output case to expect kind 'conflict_halt' with startFailure: true (D9) instead of flatten_refused, keep its no-'rebase'-call assertion, and add a case whose rev-list output is one valid 40-hex sha followed by a malformed line asserting the same D9 outcome, no merge-tree/commit-tree call and no rebase call
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift (as-built AB-10, adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D9, 98% verified): rebase.ts:1050 tests only /^[0-9a-f]{40}(?:\s|$)/ against the whole trimmed output, so a valid SHA followed by a malformed line proceeds into planFlattenedReplay instead of D9's generic malformed-output start failure; D9 is approved and determines the fix, so this is build work. The plan's D9 obligation row is 'existing' with no owning task and no Done-when names line-level validation, so a new task is appended. It also owns the matched test: rebase.test.ts:315-327 still expects flatten_refused for malformed output, contradicting D9 and the refusal() flattened:false path (rebase.ts:1026-1028) that performRebase maps to conflict_halt with startFailure (prd-audit S4.1); the task updates that assertion in the same change instead of weakening the code. Sweep: the only other rev-list parse in startFeatureReplay is inside planFlattenedReplay, which already throws into the planning-failure refusal; no sibling prefix-only validator found.
**Governing clause:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 9
**Done when:**
- adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ab10-1 is complete.

### Task rem-as-built-rem-as-built-rem-ab11-1: src/conductor/src/engine/rebase.ts:2301-2340,2606-2617,2793-2870 — make applyRebaseVerdicts, recordRebaseStepCompletion and emitRebaseEvent exhaustive over RebaseOutcome['kind']: route each through an explicit per-kind branch (noop, mergeable_skip, changed, conflict_halt, flatten_refused, setup_stop) ending in assertNeverRebaseOutcome(outcome) (rebase.ts:744) so a new kind fails npm run typecheck, keeping every existing branch's verdict text, saveStepStatus value and emitted event shape byte-identical (Task 1, Task 6 and Task 10 Done-when preserved); sweep rebase.ts for any other function taking a RebaseOutcome that branches on outcome.kind without a never terminal and convert it the same way
**Gate:** as-built
**Rationale:** ADR adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D5 requires exhaustive RebaseOutcome handling, but applyRebaseVerdicts (src/conductor/src/engine/rebase.ts:2322), recordRebaseStepCompletion (:2610) and emitRebaseEvent (:2811) fall through without a never-checked terminal branch; this is conforming implementation drift inside Task 1 Step 3 ('give every existing RebaseOutcome switch an explicit flatten_refused branch', rebase.ts in Task 1 Files) — no architecture change. Sweep: the other consumers (conductor.ts:15218, daemon-rekick.ts:1013, autoresolve.ts:1241) already call assertNeverRebaseOutcome; no other rebase.ts RebaseOutcome consumer was named by the audit. Existing behavior and Task 1/6/10 coverage (verdict text, refused/done stamping, event shapes) are preserved unchanged.
**Governing clause:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 5
**Done when:**
- adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 5 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-as-built-rem-ab11-1 is complete.

### Task rem-as-built-rem-as-built-rem-ab11-2: src/conductor/test/engine/rebase-flatten-types.test.ts — add a type-level case (// @ts-expect-error on a call passing an outcome widened with a synthetic extra kind, or an equivalent compile-time check) proving applyRebaseVerdicts, recordRebaseStepCompletion and emitRebaseEvent reject an unhandled RebaseOutcome kind, and keep the existing rebase.test.ts / rebase-flatten-events.test.ts / rebase-resolution-wiring.test.ts outcome assertions unchanged
**Gate:** as-built
**Rationale:** ADR adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history D5 requires exhaustive RebaseOutcome handling, but applyRebaseVerdicts (src/conductor/src/engine/rebase.ts:2322), recordRebaseStepCompletion (:2610) and emitRebaseEvent (:2811) fall through without a never-checked terminal branch; this is conforming implementation drift inside Task 1 Step 3 ('give every existing RebaseOutcome switch an explicit flatten_refused branch', rebase.ts in Task 1 Files) — no architecture change. Sweep: the other consumers (conductor.ts:15218, daemon-rekick.ts:1013, autoresolve.ts:1241) already call assertNeverRebaseOutcome; no other rebase.ts RebaseOutcome consumer was named by the audit. Existing behavior and Task 1/6/10 coverage (verdict text, refused/done stamping, event shapes) are preserved unchanged.
**Governing clause:** adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 5
**Done when:**
- adr-2026-09-29-automatic-rebase-flattens-merge-bearing-history decision 5 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-as-built-rem-ab11-2 is complete.
