# Implementation Plan: A lower stack child never gains a higher child's commits (#3676)

**Date:** 2026-11-15
**Design:** `.docs/decisions/architecture-review-2026-11-15-repair-host-merged-a-higher-child-into-its-branch-.md` (technical track, no PRD)
**Stories:** .docs/stories/repair-host-merged-a-higher-child-into-its-branch-.md
**Conflict check:** Clean as of 2026-11-15 (`.docs/conflicts/repair-host-merged-a-higher-child-into-its-branch-.md`)

## Summary

One engine predicate decides whether a stacked child branch would hold work from an entered higher child. Three layers enforce it:

- the agent-path git wrapper refuses before git mutates anything;
- the `reference-transaction` hook aborts the ref move;
- the conductor halts `test_suite`, `build_review` and the routed exit with a named cause.

There is no bypass variable, and engine ref moves pass on their own. The plan has 10 tasks, delivered in a single PR. It is blocked by #3653.

## Technical Approach

- **The predicate** (`src/conductor/src/engine/stack-containment.ts`, new). One module, with the verdict as a discriminated union: `contained`, `foreign` (higher position plus offending commits, each tagged `ancestry` or `patch`), or `unavailable` (cause).
  - **Inputs.** It reads:
    - the sealed positions record `refs/conductor/<slug>/positions`;
    - closure refs `refs/conductor/<slug>/closed/c<k>`;
    - child branches `feat/c<k>/<slug>`;
    - the leaf branch, which holds the top position;
    - the default branch, discovered the way the rebase path does it.
  - **Entered.** A higher position `j` is entered when `closed/c<p(j)>` exists, where `p(j)` is the predecessor position in the positions record.
  - **Own range.** `rev-list <branch j> ^closed/c<p(j)> ^origin/<default>`.
  - **Two entry points:**
    - `checkRefMove({ref, old, new})` runs identity mode over the gained commits: `rev-list new ^old`, or all of `new` for a creation;
    - `checkTree({head})` runs identity mode, whether `HEAD` reaches an own-range commit, plus patch mode: `git patch-id --stable` over `closed/c<k>..HEAD` against the own-range patch-ids.

    Both are vacuous when:
    - the branch is not a `feat/c<k>/<slug>` child of a feature with durable child state (`hasDurableChildState`);
    - no higher position is entered.
  - **Pattern.** It follows the dependency-injected shape of `src/conductor/src/engine/stack-commit-guard-cli.ts` (`runStackCommitGuard` with an injectable `deps` object). Traits to keep:
    - pure decision logic over injected git readers;
    - the `refuse(print, message)` shape for CLI output.

    Allowed variation: a returned verdict object instead of an exit code. Search hint: `parseFeatureBranch`, `hasDurableChildState`, `loadSliceTopology`.
- **The launcher subcommand** (`src/conductor/src/engine/stack-containment-check-cli.ts`, new). This is a hidden internal command registered exactly as `stack-commit-guard` is:
  - the hidden list in `src/conductor/src/cli.ts`;
  - the detector in `src/conductor/src/cli-pre-dispatch.ts`;
  - dispatch in `src/conductor/src/index.ts`;
  - the daemon-session allowlist in `src/conductor/src/execution/daemon-session.ts`.

  It has two modes:
  - `stack-containment-check --ref-update <ref> <old> <new>`, for the hook;
  - `stack-containment-check --incoming <rev>...`, for the wrapper, where the revisions are the commits the command would bring in.

  It exits 0 when contained, and 1 with a stderr message when foreign or unavailable.
- **The `reference-transaction` hook** (`src/conductor/src/engine/git-hook-assets.ts`). `REFERENCE_TRANSACTION_HOOK` becomes `buildReferenceTransactionHook(launcher)`, like `buildPreCommitHook`.
  - **Trigger.** At the `prepared` stage, a non-deletion line whose ref matches `refs/heads/feat/c*/*` calls the launcher. Every other line keeps zero git calls and no process.
  - **Unchanged.** The deletion rule and the chained hook stay as they are.
  - **Callers.** `writeGitHooks` (`src/conductor/src/engine/worktree-prepare.ts`) and the D3 re-verification write and compare the built content.
- **The agent-path wrapper.** `GIT_GUARD_SCRIPT` becomes `buildGitGuardScript(launcher)`, written by `writeGitGuard` (`src/conductor/src/engine/git-guard.ts`).
  - **Containment class.** It applies to `merge`, `cherry-pick`, `reset` and `rebase` when the checked-out branch is `feat/c*/*`. The wrapper normalizes argv against the generated grammar, resolves the incoming commits with read-only `rev-list` (or the named cherry-pick commits), and calls the launcher's `--incoming` mode before `exec`ing the real git.
  - **Grammar.** `src/conductor/src/engine/git-option-spec.ts` gains `merge`, `cherry-pick` and `rebase` grammars. The Claude hook's embedded spec (`hooks/claude/block-destructive-git.sh`) is regenerated so the parity test stays green. The Claude hook's refusal behavior is unchanged.
- **Gate backstop** (`src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/routing/routed-exit.ts`). Before dispatching `test_suite` or `build_review`, and inside `requestRoutedExit` before a host settles, the conductor calls `checkTree` when the checked-out branch is `feat/c<k>/<slug>`.
  - **Foreign:** `writeHaltMarker(worktree, body, 'needs-human', events)` with reason `stack-containment-violated`. The body names the host, the higher position, each commit with its mode, and the recovery.
  - **Unavailable:** a needs-human HALT naming the cause.
  - **Events.** `writeHaltMarker` already emits `halt_record_written`; no new event variant is added.
  - **Precedent.** The routed exit's existing `routing foreign-round commit` halt (`routed-exit.ts`, `writeHaltMarker` call), with the same placement, before settlement.
- **Sequencing.** The predicate comes first (Tasks 1–2), then the CLI (Task 3). The hook (Task 4) and the grammar and wrapper (Tasks 5–6) follow. Engine-operation proofs (Task 7) need the hook. The gates (Tasks 8–10) need only the predicate.

## Prerequisites

- #3653 (`adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish`) is merged: leaf execution and the fold transaction exist on main.

## Tasks

### Task 1: The containment predicate's identity mode over entered higher positions
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/stack-containment.realgit.test.ts`. Build a stack with positions `1,2,3`, closures `closed/c1` and `closed/c2`, the leaf as the top position, and a default branch.
2. Verify RED.
3. Implement `checkRefMove` and the shared own-range computation in `src/conductor/src/engine/stack-containment.ts` with injected git readers, following the `stack-commit-guard-cli.ts` dependency-injection shape (pure decision over injected readers; search `runStackCommitGuard`, `parseFeatureBranch`, `hasDurableChildState`).
4. Verify GREEN and commit.

**Done when:**
- [test] `checkRefMove` on `refs/heads/feat/c2/<slug>` from child 2's tip to child 3's tip returns `foreign` naming position 3 and listing child 3's own-range commits tagged `ancestry`, and returns `contained` for an ordinary new commit on child 2.
- [test] `checkRefMove` returns `contained` for creating `feat/c1/<slug>` (all-zero old value) at a leaf tip carrying a halt-record commit, and for creating `feat/c2/<slug>` at `closed/c1`, because no higher position is entered.
- [test] `checkRefMove` returns `contained` when child 2's new tip gains default-branch commit `D1` that child 3 had already merged, because own ranges exclude `origin/<default>`.
- [test] With gapped positions `1,3,5`, where `closed/c1` and `closed/c3` exist, `checkRefMove` on child 1 gaining child 3's commits returns `foreign` naming position 3.
- [test] `checkRefMove` returns `unavailable` naming the cause when the positions ref cannot be read, when the default branch cannot be discovered, or when position 3 is entered but `closed/c1` is missing on a child-1 check.

**Files likely touched:**
- `src/conductor/src/engine/stack-containment.ts` — predicate, own ranges, verdict union
- `src/conductor/test/engine/stack-containment.realgit.test.ts` — real-git predicate tests

**Dependencies:** none

### Task 2: The predicate's tree check adds patch mode for copied commits
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Add failing real-git tests to `src/conductor/test/engine/stack-containment.realgit.test.ts` for `checkTree`.
2. Verify RED.
3. Implement `checkTree({head})` in `src/conductor/src/engine/stack-containment.ts`. Identity mode checks whether `HEAD` reaches any own-range commit. Patch mode runs `git patch-id --stable` over `closed/c<k>..HEAD` against the patch-ids of every entered higher own range.
4. Verify GREEN and commit.

**Done when:**
- [test] `checkTree` on child 2 whose `HEAD` contains a merge of child 3 returns `foreign` with child 3's own-range commits tagged `ancestry`.
- [test] `checkTree` on child 2 carrying a cherry-picked copy of a child-3 own-range commit (new SHA, same patch) returns `foreign` with that copy tagged `patch`.
- [test] `checkTree` returns `contained` for child 2 holding only its own post-closure commits, for a first-pass child 2 with no entered higher position, and for a stack where every branch and closure moved in one simulated fold transaction.
- [test] `checkTree` returns `contained` without computing own ranges for the leaf branch, a non-`feat/c*` branch, and a repository with no durable child state, as asserted through an injected git reader that records no `rev-list` call.

**Files likely touched:**
- `src/conductor/src/engine/stack-containment.ts` — `checkTree`, patch mode
- `src/conductor/test/engine/stack-containment.realgit.test.ts` — tree-check tests

**Dependencies:** Task 1

### Task 3: A hidden `stack-containment-check` launcher subcommand exposes the predicate to git
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stack-containment-check-cli.test.ts` for argument parsing, exit codes and stderr.
2. Verify RED.
3. Implement `detectStackContainmentCheckCommand` and `runStackContainmentCheck` in `src/conductor/src/engine/stack-containment-check-cli.ts`, with `--ref-update <ref> <old> <new>` and `--incoming <rev>...` modes. Register it as `stack-commit-guard` is registered: the hidden command list in `src/conductor/src/cli.ts`, the detector table in `src/conductor/src/cli-pre-dispatch.ts`, dispatch in `src/conductor/src/index.ts`, and the allowlist in `src/conductor/src/execution/daemon-session.ts`.
4. Verify GREEN and commit.

**Done when:**
- [test] `runStackContainmentCheck` returns 1 for a foreign `--ref-update` and writes stderr naming the higher position, the commit count and the recovery `git reset --merge HEAD`, or `git merge --abort` when `MERGE_HEAD` exists.
- [test] `runStackContainmentCheck` returns 1 for an `unavailable` verdict with stderr naming the cause, and 0 with empty stderr for a contained verdict.
- [test] `stack-containment-check` is in the hidden command list, the pre-dispatch detector table and the daemon-session allowlist, as asserted by the existing CLI registration tests extended with this name.

**Files likely touched:**
- `src/conductor/src/engine/stack-containment-check-cli.ts` — CLI
- `src/conductor/src/cli.ts` — hidden command name
- `src/conductor/src/cli-pre-dispatch.ts` — detector entry
- `src/conductor/src/index.ts` — dispatch
- `src/conductor/src/execution/daemon-session.ts` — allowlist
- `src/conductor/test/engine/stack-containment-check-cli.test.ts` — CLI tests

**Dependencies:** Task 1

### Task 4: The reference-transaction hook aborts child-branch moves that gain higher work
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/stack-containment-hook.realgit.test.ts`. Provision a worktree with `prepareWorktree`, call `git` by absolute path so the wrapper is bypassed, and set `HOME` to an empty directory.
2. Verify RED.
3. Replace `REFERENCE_TRANSACTION_HOOK` with `buildReferenceTransactionHook(launcher = resolveCanonicalLauncher())` in `src/conductor/src/engine/git-hook-assets.ts`. At the `prepared` stage it calls `<launcher> stack-containment-check --ref-update` only for non-deletion lines matching `refs/heads/feat/c*/*`. Update `writeGitHooks` and the hook re-verification in `src/conductor/src/engine/worktree-prepare.ts` to write and compare the built content.
4. Verify GREEN and commit.

**Done when:**
- [test] On child 2 with absolute-path git, each of `merge --ff-only feat/c3/<slug>`, `reset --keep feat/c3/<slug>` and `update-ref refs/heads/feat/c2/<slug> <c3 tip>` fails with `ref updates aborted by hook`, leaves `feat/c2/<slug>` at its previous SHA, and prints stderr naming child 3 and `git reset --merge HEAD`; running `git reset --merge HEAD` afterwards leaves `git status --porcelain` empty, `git diff --cached` against child 2's tip empty, and no `MERGE_HEAD`.
- [test] `merge --no-ff --no-commit feat/c3/<slug>` followed by `commit` leaves `feat/c2/<slug>` at its previous SHA with stderr naming child 3 and `git merge --abort`, and running the named recovery leaves `git status --porcelain` empty with no `.git/.../MERGE_HEAD`.
- [test] An ordinary commit on child 2 advances the branch, and updates to `main`, the leaf branch, a `refs/conductor/` ref and a tag pass without starting the launcher, as asserted by a stub launcher that records no invocation.
- [test] Deleting a branch whose tip another ref holds still succeeds, and deleting an otherwise-unreachable tip is still refused with the existing message.
- [test] With a stub launcher that exits 1 printing `unavailable: cannot read refs/conductor/<slug>/positions`, a child-2 commit is aborted, the branch is unchanged, and the hook's stderr contains that `unavailable` cause text.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts` — `buildReferenceTransactionHook`
- `src/conductor/src/engine/worktree-prepare.ts` — write and re-verify the built hook
- `src/conductor/test/engine/stack-containment-hook.realgit.test.ts` — real-git hook tests
- `src/conductor/test/engine/git-hook-assets.test.ts` — asset content expectations

**Dependencies:** Task 3

### Task 5: The option spec gains merge, cherry-pick and rebase grammars
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-option-spec.test.ts` for the three grammars against git 2.53's `--git-completion-helper` output, the same drift method the spec already uses.
2. Verify RED.
3. Add `merge`, `cherry-pick` and `rebase` entries to `GIT_OPTION_SPEC` in `src/conductor/src/engine/git-option-spec.ts`. Regenerate the embedded spec in `hooks/claude/block-destructive-git.sh` without changing that hook's refusal logic.
4. Verify GREEN and commit.

**Done when:**
- [test] `GIT_OPTION_SPEC` lists `merge`, `cherry-pick` and `rebase` options matching git 2.53's completion-helper output, as asserted by the existing drift test extended to these subcommands.
- [test] `destructive-git-hook-spec-parity.test.ts` passes with the regenerated embedded spec, and the Claude hook still passes `git merge`, `git cherry-pick` and `git rebase` through unchanged in its existing behavior tests.

**Files likely touched:**
- `src/conductor/src/engine/git-option-spec.ts` — three grammars
- `hooks/claude/block-destructive-git.sh` — regenerated embedded spec
- `src/conductor/test/engine/git-option-spec.test.ts` — grammar drift tests

**Dependencies:** none

### Task 6: The agent-path wrapper refuses higher-child merges, picks, resets and rebases before mutation
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing real-git tests in `src/conductor/test/engine/git-guard-stack-containment.realgit.test.ts`. They drive the written `.pipeline/bin/git` wrapper in a `prepareWorktree` child worktree, with the real launcher, the hook installed, and `HOME` empty.
2. Verify RED.
3. Replace `GIT_GUARD_SCRIPT` with `buildGitGuardScript(launcher)` in `src/conductor/src/engine/git-hook-assets.ts`, and update `writeGitGuard` in `src/conductor/src/engine/git-guard.ts`. Add the containment class: on a `feat/c*/*` checkout, normalize `merge`/`cherry-pick`/`reset`/`rebase` argv with the generated grammar, resolve the incoming commits with read-only `rev-list` (or the named cherry-pick commits and ranges), and call `<launcher> stack-containment-check --incoming` before `exec`ing the real git. Refuse an unresolved option on a child branch, naming the token.
4. Verify GREEN and commit.

**Done when:**
- [test] On child 2, wrapper `merge feat/c3/<slug>`, `merge --no-ff --no-commit feat/c3/<slug>`, `cherry-pick <c3 commit>`, `cherry-pick <range containing c3 commit>`, `reset --keep`/`--soft`/`--mixed feat/c3/<slug>` and `rebase feat/c3/<slug>`/`rebase --onto feat/c3/<slug> HEAD~1` each exit non-zero with `feat/c2/<slug>`, `git write-tree` of the index and `git status --porcelain` unchanged and no `MERGE_HEAD`.
- [test] Each refusal's stderr is exactly the containment refusal template `stack containment: refusing <op> on feat/c2/<slug>: it would bring in <n> commit(s) owned by child 3. Build this work on the child that owns its prerequisite, or stop and report the missing prerequisite.`, with `<op>` the refused subcommand and `<n>` the incoming child-3 commit count (the cherry-pick form also lists the refused commit SHAs), so it names child 3 and gives no instruction to move, copy or cherry-pick commits onto child 2.
- [test] On child 2, wrapper `merge`, `cherry-pick`, `reset` and `rebase` whose incoming commits are already reachable from child 2 or come only from `origin/<default>` run and succeed exactly as with the guard absent, including `merge origin/<default>` when child 3 has already merged that same default commit `D1`; and on a first-pass child 2 with no entered higher position, `merge` of the leaf branch is not refused by the containment class.
- [test] On child 2, `merge --bogus-opt feat/c3/<slug>` is refused with stderr naming `--bogus-opt` and `feat/c2/<slug>` unchanged; a launcher stub exiting 1 with `unavailable: <cause>`, and a real run where `refs/conductor/<slug>/positions` is unreadable, each refuse `merge feat/c3/<slug>` without running it, with stderr naming the failure cause.
- [test] On `main`, the leaf branch, an N=1 feature branch and a temp repository outside the feature, all four commands reach the real git with no launcher call.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts` — `buildGitGuardScript`, containment class
- `src/conductor/src/engine/git-guard.ts` — `writeGitGuard` writes the built script
- `src/conductor/test/engine/git-guard-stack-containment.realgit.test.ts` — wrapper tests
- `src/conductor/test/engine/git-guard-script.test.ts` — script content expectations

**Dependencies:** Tasks 3, 5

### Task 7: Engine ref operations pass the installed hook with no bypass variable
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing-first real-git tests in `src/conductor/test/engine/stack-containment-engine-ops.realgit.test.ts`. A feature worktree has the hook installed through `prepareWorktree`, and engine operations run through their production entry points with `makeGitRunner(worktree)`.
2. Verify RED (the hook from Task 4 is the subject).
3. Fix any engine path that the hook refuses only by correcting what it moves, never by adding an exemption.
4. Verify GREEN and commit.

**Done when:**
- [test] With the hook installed, the journaled restack replay moving children 2 and 3 in one transaction, a verified prerequisite reroute resetting child 2 to `closed/c2`, a child-cursor advance creating the next child's branch, and a base-refresh restack moving child 2 onto a base containing default commit `D1` that child 3 had merged each succeed and leave their target refs at the expected SHAs.
- [test] With the hook installed, the engine creates `feat/c1/<slug>` at a leaf tip carrying a pre-region halt-record commit `H`, then `feat/c2/<slug>` at `closed/c1`, and both creations succeed.
- [test] A routed repair round hosted on child 2 commits ordinary repair work through `git commit` with the hook and wrapper installed, each commit advances `feat/c2/<slug>`, and the round's routed exit then settles host 2 with the same route-record settlement state as with the hook and wrapper absent.
- [test] The built hook and wrapper containment branches contain no `CONDUCT_ENGINE_COMMIT` reference and act only on the launcher's exit status, and `runStackContainmentCheck` returns the same refusal for a foreign `--ref-update` with and without `CONDUCT_ENGINE_COMMIT=1` and `CONDUCT_DAEMON_SESSION=1` in its environment, because its dependencies carry no environment input.
- [test] For an N=1 feature, commit, reset and merge start no launcher process (a stub launcher records no invocation) and produce the same exit status and resulting branch SHA as with the hook and wrapper absent.

**Files likely touched:**
- `src/conductor/test/engine/stack-containment-engine-ops.realgit.test.ts` — engine-operation proofs

**Dependencies:** Tasks 4, 6

### Task 8: The conductor halts `test_suite` and `build_review` on a foreign child tree
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing engine tests in `src/conductor/test/engine/stack-containment-gate.test.ts`, using a real-git stack and a conductor whose step dispatch is observed.
2. Verify RED.
3. In `src/conductor/src/engine/conductor.ts`, before dispatching `test_suite` or `build_review` while the checked-out branch is `feat/c<k>/<slug>`, call `checkTree`.
   - **Foreign:** call `writeHaltMarker(worktree, body, 'needs-human', events)` with reason `stack-containment-violated`. The body names the host child, the higher position, each commit with `ancestry` or `patch`, and the recovery: move the host back to its closure or last contained commit, then rebuild the work on the child that owns its prerequisite.
   - **Unavailable:** a needs-human HALT naming the cause.

   Either way, return without dispatching.
4. Verify GREEN and commit.

**Done when:**
- [test] For child 2 containing a merge of child 3, the conductor dispatches neither `test_suite` nor `build_review`, `.pipeline/HALT.class` is `needs-human`, and `.pipeline/HALT` contains `stack-containment-violated`, `child 2`, `child 3`, each commit SHA with `ancestry`, and the recovery line `Recovery: move feat/c<k>/<slug> back to closed/c<k> or its last contained commit, then rebuild this work on the child that owns its prerequisite.` with `<k>` = 2.
- [test] For child 2 carrying a patch copy of a child-3 commit, no gate step is dispatched, `.pipeline/HALT.class` is `needs-human`, and the HALT contains `stack-containment-violated`, `child 2`, `child 3`, that commit with `patch`, and the same recovery line with `<k>` = 2.
- [test] Each containment HALT produces exactly one `halt_record_written` event in `.pipeline/events.jsonl`; the run writes no other event type and no new file beyond the HALT marker and its record.
- [test] `test_suite` and `build_review` are dispatched as before with no containment HALT for a contained child 2, a first-pass child 2 with no entered higher position, a child 2 after a fold or feature-repair restack transaction that moved every branch and closure together, a leaf-executed audit host region with the leaf checked out, the leaf branch, and an N=1 feature; for the last three the injected git reader records no containment `rev-list` or `patch-id` call.
- [test] When `closed/c1` is missing while position 3 is entered (on child 1), or when the injected git reader fails, the conductor writes a needs-human HALT naming the missing ref or the failure and dispatches no gate step.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — pre-dispatch containment check
- `src/conductor/test/engine/stack-containment-gate.test.ts` — gate tests

**Dependencies:** Task 2

### Task 9: The routed exit refuses to settle a host whose tree is foreign
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/routed-exit-containment.test.ts`, modeled on the existing foreign-round-commit exit tests.
2. Verify RED.
3. In `requestRoutedExit` (`src/conductor/src/engine/routing/routed-exit.ts`), call `checkTree` for a host on `feat/c<k>/<slug>` before settlement, beside the existing `routing foreign-round commit` halt. Write the same `stack-containment-violated` needs-human HALT through `writeHaltMarker`, and return without settling or restacking.
4. Verify GREEN and commit.

**Done when:**
- [test] For a routed host on child 2 whose branch contains a child-3 own-range commit, `requestRoutedExit` does not settle the host, starts no exit restack (the injected restack runner records no call), and writes a `needs-human` HALT containing `stack-containment-violated`, `child 2`, `child 3`, the commit SHA with `ancestry`, and the recovery line `Recovery: move feat/c<k>/<slug> back to closed/c<k> or its last contained commit, then rebuild this work on the child that owns its prerequisite.` with `<k>` = 2.
- [test] For a routed host on child 2 holding only its own repair commits, `requestRoutedExit` settles exactly as before, with no containment HALT.
- [test] For a leaf-executed host with the leaf checked out, `requestRoutedExit` performs no containment check, and the injected git reader records no own-range `rev-list` call.

**Files likely touched:**
- `src/conductor/src/engine/routing/routed-exit.ts` — exit containment check
- `src/conductor/test/engine/routing/routed-exit-containment.test.ts` — exit tests

**Dependencies:** Task 2

### Task 10: Gapped positions are honored end to end at the gate
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write a failing engine test in `src/conductor/test/engine/stack-containment-gate.test.ts` with sealed positions `1,3,5` (5 is the leaf) where `closed/c1` and `closed/c3` exist.
2. Verify RED.
3. Fix any position arithmetic in the predicate or gate check, using predecessor positions from the positions record and never `k-1` or `k+1`.
4. Verify GREEN and commit.

**Done when:**
- [test] On a `1,3,5` stack, child 1 whose branch merged `feat/c3/<slug>` makes the conductor write a `stack-containment-violated` HALT naming child 3 before `test_suite` dispatch.
- [test] On the same stack, child 1 holding only its own commits dispatches `test_suite` with no containment HALT.

**Files likely touched:**
- `src/conductor/src/engine/stack-containment.ts` — predecessor-position handling
- `src/conductor/test/engine/stack-containment-gate.test.ts` — gapped-position gate tests

**Dependencies:** Task 8

## Integration Points

- **After Task 4:** absolute-path git on a provisioned child worktree is refused by git itself.
- **After Task 6:** a builder's `merge`/`cherry-pick`/`reset`/`rebase` toward a higher child is refused before mutation.
- **After Tasks 8–9:** a lower child's gates and routed exit halt on a foreign tree, with a named cause on the event spine.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-15-stack-children-never-gain-higher-child-commits#D1 | task | task-1, task-2 | `checkRefMove` returns `contained` when child 2's new tip gains default-branch commit `D1` that child 3 had already merged, because own ranges exclude `origin/<default>`. |
| adr-2026-11-15-stack-children-never-gain-higher-child-commits#D2 | task | task-6 | each exit non-zero with `feat/c2/<slug>`, `git write-tree` of the index and `git status --porcelain` unchanged and no `MERGE_HEAD` |
| adr-2026-11-15-stack-children-never-gain-higher-child-commits#D3 | task | task-4 | leaves `feat/c2/<slug>` at its previous SHA, and prints stderr naming child 3 and `git reset --merge HEAD` |
| adr-2026-11-15-stack-children-never-gain-higher-child-commits#D4 | task | task-7 | The built hook and wrapper containment branches contain no `CONDUCT_ENGINE_COMMIT` reference and act only on the launcher's exit status |
| adr-2026-11-15-stack-children-never-gain-higher-child-commits#D5 | task | task-8, task-9 | the conductor dispatches neither `test_suite` nor `build_review`, `.pipeline/HALT.class` is `needs-human` |
| adr-2026-11-15-stack-children-never-gain-higher-child-commits#D6 | task | task-8 | Each containment HALT produces exactly one `halt_record_written` event in `.pipeline/events.jsonl` |
| adr-2026-11-15-stack-children-never-gain-higher-child-commits#D7 | task | task-4, task-6, task-7 | ordinary commit on child 2 advances the branch |
| adr-2026-09-23-engine-git-guard-on-agent-path#D1 | existing | none | `writeGitGuard` (`src/conductor/src/engine/git-guard.ts`) already writes the engine-generated guard asset from `src/conductor/src/engine/git-hook-assets.ts`; Task 6 keeps it generated, as `buildGitGuardScript`. |
| adr-2026-09-23-engine-git-guard-on-agent-path#D2 | no-change | none | Provider adapters' child-environment construction already prepends `.pipeline/bin` for every provider; this feature changes the asset's content, not where it is enforced. |
| adr-2026-09-23-engine-git-guard-on-agent-path#D3 | existing | none | The pre-dispatch re-verification in `src/conductor/src/engine/git-guard.ts` already compares written guard and hook content to the engine's expected content; it consumes the built assets unchanged. |
| adr-2026-09-23-engine-git-guard-on-agent-path#D4 | task | task-6 | all four commands reach the real git with no launcher call |
| adr-2026-09-23-engine-git-guard-on-agent-path#D5 | task | task-6 | each exit non-zero with `feat/c2/<slug>`, `git write-tree` of the index and `git status --porcelain` unchanged and no `MERGE_HEAD` |
| adr-2026-09-23-engine-git-guard-on-agent-path#D6 | task | task-6 | Build this work on the child that owns its prerequisite, or stop and report the missing prerequisite. |
| adr-2026-09-23-engine-git-guard-on-agent-path#D7 | task | task-7 | The built hook and wrapper containment branches contain no `CONDUCT_ENGINE_COMMIT` reference and act only on the launcher's exit status |
| adr-2026-09-23-engine-git-guard-on-agent-path#D8 | task | task-5 | the Claude hook still passes `git merge`, `git cherry-pick` and `git rebase` through unchanged in its existing behavior tests |
| adr-2026-09-23-engine-git-guard-on-agent-path#D9 | no-change | none | No skill text instructs a builder to merge, cherry-pick, reset or rebase toward another child's branch, so no skill text disagrees with the new class. |
| adr-2026-09-23-engine-git-guard-on-agent-path#D10 | no-change | none | The new refusals are proven by this plan's real-git tests; the control-inventory reference text is maintained by the pre-finish documentation gate, not a plan task. |
| adr-2026-09-23-engine-git-guard-on-agent-path#D11 | task | task-4 | fails with `ref updates aborted by hook` |
| adr-2026-09-23-engine-git-guard-on-agent-path#D12 | task | task-4 | pass without starting the launcher |
| adr-2026-09-23-engine-git-guard-on-agent-path#D13 | no-change | none | The `pre-push` hook is not modified; this feature moves no remote ref. |
| adr-2026-09-23-engine-git-guard-on-agent-path#D14 | task | task-7 | each succeed and leave their target refs at the expected SHAs |
| adr-2026-09-23-engine-git-guard-on-agent-path#D15 | task | task-4 | On child 2 with absolute-path git |
| adr-2026-10-03-fail-closed-git-option-normalization#D1 | task | task-5 | `GIT_OPTION_SPEC` lists `merge`, `cherry-pick` and `rebase` options matching git 2.53's completion-helper output |
| adr-2026-10-03-fail-closed-git-option-normalization#D2 | task | task-6 | On `main`, the leaf branch, an N=1 feature branch and a temp repository outside the feature, all four commands reach the real git with no launcher call |
| adr-2026-10-03-fail-closed-git-option-normalization#D3 | task | task-6 | `merge --bogus-opt feat/c3/<slug>` is refused with stderr naming `--bogus-opt` |
| adr-2026-10-03-fail-closed-git-option-normalization#D4 | no-change | none | The destructive predicates and the 2026-09-23 decision 5 matrix entries are not modified; the containment class is a separate classification. |
| adr-2026-10-03-fail-closed-git-option-normalization#D5 | existing | none | The PATH guard's grammar is already generated from `GIT_OPTION_SPEC`; the new `merge`, `cherry-pick` and `rebase` entries reach it through that generation. |
| adr-2026-10-03-fail-closed-git-option-normalization#D6 | task | task-5 | `destructive-git-hook-spec-parity.test.ts` passes with the regenerated embedded spec |
| adr-2026-10-03-fail-closed-git-option-normalization#D7 | task | task-5 | as asserted by the existing drift test extended to these subcommands |
| adr-2026-10-03-fail-closed-git-option-normalization#D8 | no-change | none | No recorded limit is added or removed by this feature. |
