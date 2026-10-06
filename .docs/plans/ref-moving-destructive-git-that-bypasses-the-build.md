# Implementation Plan: git-side veto for ref-moving destructive git that bypasses the build guard (#2693)

**Date:** 2026-10-03
**Design:** .docs/architecture/ref-moving-destructive-git-that-bypasses-the-build.md
**Stories:** .docs/stories/ref-moving-destructive-git-that-bypasses-the-build.md
**Conflict check:** Clean as of 2026-10-03
**Source:** jstoup111/ai-conductor#2693

## Summary

Eleven tasks add two engine git hooks, `reference-transaction` and `pre-push`, to every prepared worktree's `.pipeline/git-hooks/`. They refuse deleting a branch whose commits would become unreachable and a push that overwrites remote history the worktree has not fetched. Both hooks chain to the repository's own hooks, are re-verified before each guarded dispatch, and are proven with real-git tests that bypass the `PATH` guard.

## Technical Approach

- **Hook assets (adr-2026-09-23-engine-git-guard-on-agent-path D11).** `REFERENCE_TRANSACTION_HOOK` and `PRE_PUSH_HOOK` are static bash strings exported from `src/conductor/src/engine/git-hook-assets.ts`. `writeGitHooks` writes them beside the commit-time hooks inside the existing fail-closed `writeGitHooksAndWire`, and the worktree-scoped `core.hooksPath` that `wireGitHooks` already sets makes git run them. The interpreter-source inventory scans every string export, so it covers them without change.
- **Pattern basis.** The embedded preventive hook asset. Traits: a static exported string, no runtime value interpolated into source, a 0755 regular file under `.pipeline/git-hooks/`, a fail-closed idempotent write, chaining to `$GIT_COMMON_DIR/hooks/«name»`. Rediscover via `PRE_COMMIT_HOOK`, `COMMIT_MSG_HOOK`, `writeGitHooks`. Allowed variation: these hooks refuse on positive evidence and never read `CONDUCT_ENGINE_COMMIT`.
- **reference-transaction (D12).** Only the `prepared` stage and only `refs/heads/*` lines with an all-zero new value are judged; every other line passes with no git call. A deletion is allowed for a loose-ref prune (loose file present and `packed-refs` holds the same value) or when another `refs/heads/` or `refs/remotes/` ref contains the tip; otherwise the transaction aborts. `git branch -D` passes an all-zero old value, so the hook resolves the tip itself. Verified on git 2.53.0 on 2026-10-03.
- **pre-push (D13).** Per stdin line: allow a remote deletion, a new ref, a fast-forward, or an update whose remote value equals `refs/remotes/«remote»/«branch»`; refuse the rest. Git withholds locally rejected updates from `pre-push`, so plain non-fast-forward and stale-lease pushes keep git's own rejection.
- **No bypass (D14).** The engine deletes branches only from the root checkout, and its pushes are plain or bare-lease, so no escape variable exists. `ensureGitGuardForDispatch` also re-verifies both hooks before each Claude and Codex dispatch.
- **Proof (D15).** Real-git tests in temporary repositories and linked worktrees provisioned by `prepareWorktree`, with a local bare remote, the real `git` called by absolute path and `HOME` set to an empty directory. Because git itself runs the hooks, this one proof covers every provider and run mode.
- **Sequencing.** Task 1 provisions both assets. Tasks 2–9 edit the same asset file and run serially. Task 10 proves engine operations after both hooks exist. Task 11 touches only `git-guard.ts` and runs in parallel after Task 1.
- **Documentation.** The control-inventory and hook-table updates in `docs/reference/settings-and-hooks.md` are routed to the documentation-maintenance step, not a plan task.

## Prerequisites

- None. Worktree preparation already provisions `.pipeline/git-hooks/` fail-closed and wires the worktree-scoped `core.hooksPath`.

## Tasks

### Task 1: Provision the reference-transaction and pre-push hook assets in every prepared worktree
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/worktree-prepare.test.ts`: after `prepareWorktree` on a fresh linked worktree, both new hook files exist with mode 0755 and contents equal to the exports; with `.pipeline/git-hooks` made unwritable, preparation rejects. Add a case to `src/conductor/test/scripts/interpreter-source-inventory.test.ts` that runs the inventory over the real `git-hook-assets` exports. Add a `src/conductor/test/engine/daemon-runner.test.ts` case whose `prepareWorktree` dependency rejects with the preventive-hook error.
2. Verify RED.
3. Implement: export `REFERENCE_TRANSACTION_HOOK` and `PRE_PUSH_HOOK` from `src/conductor/src/engine/git-hook-assets.ts` as pass-through bash hooks (exit 0) and write both in `writeGitHooks` (`src/conductor/src/engine/worktree-prepare.ts`) beside the commit-time hooks with `writeFile` then `chmod 0755`, inside the existing fail-closed `writeGitHooksAndWire`. Follow the embedded preventive hook-asset pattern: a static exported bash string in `git-hook-assets.ts` with no runtime value interpolated into its source and no `node -e`/`python3 -c` over shell-expanded data, so the interpreter-source inventory accepts it; rediscover via `PRE_COMMIT_HOOK` and `COMMIT_MSG_HOOK`. Allowed variation: these hooks refuse on positive evidence and never read `CONDUCT_ENGINE_COMMIT`.
4. Verify GREEN. Commit: "git hooks: provision reference-transaction and pre-push in prepared worktrees"

**Done when:**
- After `prepareWorktree` on a fresh linked worktree, `.pipeline/git-hooks/reference-transaction` and `.pipeline/git-hooks/pre-push` exist with mode 0755 and contents equal to the exported `REFERENCE_TRANSACTION_HOOK` and `PRE_PUSH_HOOK`, as asserted in `worktree-prepare.test.ts`.
- `prepareWorktree` on a linked worktree whose `.pipeline/git-hooks` directory cannot be written rejects with the existing `preventive git hook installation failed` error, as asserted by the unwritable-hooks-directory test.
- A daemon-runner run whose `prepareWorktree` dependency rejects with the preventive-hook installation error errors the feature and records no build or provider dispatch, as asserted in `daemon-runner.test.ts`.
- The interpreter-source inventory run over the real `git-hook-assets` exports reports no shell-expanded runtime data in `REFERENCE_TRANSACTION_HOOK` or `PRE_PUSH_HOOK`, as asserted in `interpreter-source-inventory.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/src/engine/worktree-prepare.ts`
- `src/conductor/test/engine/worktree-prepare.test.ts`
- `src/conductor/test/scripts/interpreter-source-inventory.test.ts`
- `src/conductor/test/engine/daemon-runner.test.ts`

**Dependencies:** none

### Task 2: reference-transaction: refuse every local branch deletion and pass all other ref updates
**Story:** 1
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/reference-transaction-hook.test.ts`. Fixture: a temporary repository under `tmpdir()` (`initTestRepo`), a linked worktree added from it and provisioned with `prepareWorktree`, and, for pushes, a local bare remote under `tmpdir()`; drive every command through unguarded git (absolute-path real `git`, `HOME` set to an empty directory). Never touch the harness checkout or a real remote, so the test stays harmless when the hook is absent (test-process-isolation rule). Cover `git branch -D` and `git update-ref -d refs/heads/«branch»` of a unique-tip branch (also with `CONDUCT_ENGINE_COMMIT=1` set), the ordinary commands `git commit`, `git commit --amend`, `git rebase «base»`, `git reset --keep «target»` and `git branch -f «other» «target»` (compare each exit status with the same command in an identical repository with no hooks installed), a tag deletion, and `git fetch --prune` of a deleted remote branch.
2. Verify RED.
3. Implement `REFERENCE_TRANSACTION_HOOK`: exit 0 for every stage except `prepared`; at `prepared` read `«old» «new» «ref»` lines and, for a line whose ref starts with `refs/heads/` and whose new value is all zeros, exit 1. Every other line passes with no git call. Follow the embedded preventive hook-asset pattern: a static exported bash string in `git-hook-assets.ts` with no runtime value interpolated into its source and no `node -e`/`python3 -c` over shell-expanded data, so the interpreter-source inventory accepts it; rediscover via `PRE_COMMIT_HOOK` and `COMMIT_MSG_HOOK`. Allowed variation: these hooks refuse on positive evidence and never read `CONDUCT_ENGINE_COMMIT`.
4. Verify GREEN. Commit: "reference-transaction hook: refuse local branch deletions"

**Done when:**
- In `src/conductor/test/engine/reference-transaction-hook.test.ts`, `git branch -D «branch»` and `git update-ref -d refs/heads/«branch»` of a unique-tip branch run through unguarded git in a prepared worktree each exit non-zero and `git rev-parse refs/heads/«branch»` still returns the original tip.
- The same `git branch -D «branch»` run with `CONDUCT_ENGINE_COMMIT=1` in the environment exits non-zero and the branch still resolves to its original tip, as asserted in `src/conductor/test/engine/reference-transaction-hook.test.ts`.
- `git commit`, `git commit --amend`, `git rebase «base»`, `git reset --keep «target»` and `git branch -f «other» «target»` run through unguarded git in a prepared worktree each exit with the same status as in an identical repository with no hooks, as asserted in `src/conductor/test/engine/reference-transaction-hook.test.ts`.
- Deleting a tag and running `git fetch --prune` for a deleted remote branch through unguarded git in a prepared worktree both exit zero and the tag and remote-tracking ref are gone, so `REFERENCE_TRANSACTION_HOOK` never refuses a ref outside `refs/heads/`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/reference-transaction-hook.test.ts`

**Dependencies:** Task 1

### Task 3: reference-transaction: refusal message names the deletion and its safe alternatives, including rename
**Story:** 1
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/reference-transaction-hook.test.ts` asserting the stderr of a refused `git branch -D «branch»` and of a refused `git branch -m «branch» «new-name»` for a unique-tip branch.
2. Verify RED.
3. Implement in `REFERENCE_TRANSACTION_HOOK`: before exiting 1, write one stderr message `refused branch deletion of «ref»: its commits would become unreachable`, and naming the safe alternatives: push or merge it first, or use `git branch -d`; to rename, create the new branch first and then delete the old one with `git branch -d`. The hook cannot tell a rename from a deletion, so one message carries both alternatives.
4. Verify GREEN. Commit: "reference-transaction hook: explain refused deletions"

**Done when:**
- A refused `git branch -D «branch»` of a unique-tip branch writes stderr that contains `refused branch deletion`, `refs/heads/«branch»`, the words `its commits would become unreachable`, and both `git branch -d` and `push or merge it first`, as asserted in `src/conductor/test/engine/reference-transaction-hook.test.ts`.
- `git branch -m «branch» «new-name»` of a unique-tip branch run through unguarded git in a prepared worktree exits non-zero, `refs/heads/«branch»` still resolves to its original tip, and stderr contains `create the new branch first` and `git branch -d`, as asserted in `src/conductor/test/engine/reference-transaction-hook.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/reference-transaction-hook.test.ts`

**Dependencies:** Task 2

### Task 4: reference-transaction: allow deleting or renaming a branch whose tip another ref contains
**Story:** 1
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/reference-transaction-hook.test.ts`: delete a branch whose tip another local branch contains; delete a branch whose tip only its own remote-tracking ref contains; rename a branch whose tip another local branch contains.
2. Verify RED.
3. Implement in `REFERENCE_TRANSACTION_HOOK`: for a refused-candidate deletion, resolve the ref's current value with `git rev-parse -q --verify «ref»` (`git branch -D` passes an all-zero old value), list `git for-each-ref --format=%(refname) refs/heads refs/remotes`, exclude the deleted ref itself, and allow when `git merge-base --is-ancestor «tip» «other»` holds for any remaining ref. This is the reachability rule of adr-2026-09-23-engine-git-guard-on-agent-path D5's amendment.
4. Verify GREEN. Commit: "reference-transaction hook: allow deletions whose commits stay reachable"

**Done when:**
- `git branch -D «branch»` run through unguarded git in a prepared worktree exits zero and the branch no longer exists when another local branch contains its tip, and also when only its remote-tracking ref contains its tip, as asserted by the two reachability tests in `src/conductor/test/engine/reference-transaction-hook.test.ts`.
- `git branch -m «branch» «new-name»` of a branch whose tip another local branch contains exits zero, `refs/heads/«new-name»` resolves to the original tip and `refs/heads/«branch»` no longer exists, as asserted in `src/conductor/test/engine/reference-transaction-hook.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/reference-transaction-hook.test.ts`

**Dependencies:** Task 3

### Task 5: reference-transaction: let pack-refs and gc prune loose refs, keep packed branches protected
**Story:** 2
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/reference-transaction-hook.test.ts`: in a prepared worktree with loose branch refs including one unique-tip branch, run `git pack-refs --all`, then separately `git gc`; then delete the packed unique-tip branch with `git branch -D`.
2. Verify RED.
3. Implement in `REFERENCE_TRANSACTION_HOOK`: before the reachability check, allow a deletion when the loose ref file `$(git rev-parse --git-common-dir)/«ref»` exists and `packed-refs` holds `«ref»` at the same value as the line's old value. That is how `git pack-refs` and `git gc` remove the loose copy. A packed-only branch has no loose file, so its deletion still goes to the reachability rule.
4. Verify GREEN. Commit: "reference-transaction hook: allow loose-ref pruning by pack-refs and gc"

**Done when:**
- `git pack-refs --all` run through unguarded git in a prepared worktree exits zero and `git rev-parse` returns each branch's previous tip, including the unique-tip branch, as asserted in `src/conductor/test/engine/reference-transaction-hook.test.ts`.
- `git gc` run through unguarded git in a prepared worktree exits zero, its output does not contain `failed to run pack-refs`, and every branch, including the unique-tip branch, resolves to its previous tip, as asserted in `src/conductor/test/engine/reference-transaction-hook.test.ts`.
- After `git pack-refs --all`, `git branch -D` of the packed unique-tip branch exits non-zero and the branch still resolves to its original tip, as asserted in `src/conductor/test/engine/reference-transaction-hook.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/reference-transaction-hook.test.ts`

**Dependencies:** Task 4

### Task 6: pre-push: refuse non-fast-forward updates of existing remote branches
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/pre-push-hook.test.ts`. Fixture: a temporary repository under `tmpdir()` (`initTestRepo`), a linked worktree added from it and provisioned with `prepareWorktree`, and, for pushes, a local bare remote under `tmpdir()`; drive every command through unguarded git (absolute-path real `git`, `HOME` set to an empty directory). Never touch the harness checkout or a real remote, so the test stays harmless when the hook is absent (test-process-isolation rule). Advance the bare remote branch from a second clone so it is past the prepared worktree's remote-tracking ref, rewrite the local branch, then push with `git push --force origin HEAD:«branch»`, `git push origin +HEAD:«branch»`, and `git push --force-with-lease=«branch»:«current-remote-tip» origin HEAD:«branch»`.
2. Verify RED.
3. Implement `PRE_PUSH_HOOK`: read `«local-ref» «local-sha» «remote-ref» «remote-sha»` lines from stdin; exit 1 for an update whose local value is non-zero, whose remote value is non-zero, and where `git merge-base --is-ancestor «remote-sha» «local-sha»` fails (also when the remote commit is not present locally). It reads stdin and local refs only and never contacts the remote. Follow the embedded preventive hook-asset pattern: a static exported bash string in `git-hook-assets.ts` with no runtime value interpolated into its source and no `node -e`/`python3 -c` over shell-expanded data, so the interpreter-source inventory accepts it; rediscover via `PRE_COMMIT_HOOK` and `COMMIT_MSG_HOOK`. Allowed variation: these hooks refuse on positive evidence and never read `CONDUCT_ENGINE_COMMIT`.
4. Verify GREEN. Commit: "pre-push hook: refuse non-fast-forward remote updates"

**Done when:**
- With the bare remote branch advanced past the remote-tracking ref, `git push --force origin HEAD:«branch»` and `git push origin +HEAD:«branch»` of a rewritten branch run through unguarded git in a prepared worktree each exit non-zero and `git -C «bare» rev-parse «branch»` still returns the advanced tip, as asserted in `src/conductor/test/engine/pre-push-hook.test.ts`.
- In the same fixture, `git push --force-with-lease=«branch»:«current-remote-tip» origin HEAD:«branch»` exits non-zero and the bare remote branch still returns the advanced tip, as asserted in `src/conductor/test/engine/pre-push-hook.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/pre-push-hook.test.ts`

**Dependencies:** Task 5

### Task 7: pre-push: refusal message names the push, its branch and the safe alternative
**Story:** 3
**Type:** negative-path

**Steps:**
1. Add a failing test to `src/conductor/test/engine/pre-push-hook.test.ts` asserting the stderr of a refused `git push --force origin HEAD:«branch»`.
2. Verify RED.
3. Implement in `PRE_PUSH_HOOK`: before exiting 1, write one stderr message `refused push to «remote-ref»: it would overwrite remote history this worktree has not fetched`, and naming `git fetch` then `git push --force-with-lease` as the safe alternative.
4. Verify GREEN. Commit: "pre-push hook: explain refused pushes"

**Done when:**
- A refused `git push --force origin HEAD:«branch»` writes stderr that contains `refused push`, `refs/heads/«branch»`, the words `would overwrite remote history this worktree has not fetched`, and both `git fetch` and `git push --force-with-lease`, as asserted in `src/conductor/test/engine/pre-push-hook.test.ts`.
- A refused `git push origin +HEAD:«branch»` writes the same message naming `refs/heads/«branch»` to stderr and nothing to stdout, as asserted in `src/conductor/test/engine/pre-push-hook.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/pre-push-hook.test.ts`

**Dependencies:** Task 6

### Task 8: pre-push: allow lease-equivalent, fast-forward, new-branch and delete pushes
**Story:** 3
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/pre-push-hook.test.ts`: with the remote-tracking ref equal to the remote tip, push a rewritten branch with a bare `--force-with-lease` and with `--force`; push a fast-forward and a branch the remote lacks; with the remote advanced and its tip fetched into the remote-tracking ref, push a rewritten branch with a plain `git push`; push `--delete`.
2. Verify RED.
3. Implement in `PRE_PUSH_HOOK`: before refusing, allow an update whose remote value equals `git rev-parse -q --verify refs/remotes/«remote»/«branch»` (the remote's default fetch mapping; `«remote»` is the hook's first argument), and allow every line whose local value is all zeros (a remote deletion). Git withholds updates it already rejected locally, so a plain non-fast-forward push keeps git's own rejection.
4. Verify GREEN. Commit: "pre-push hook: allow lease-equivalent pushes"

**Done when:**
- With the remote-tracking ref equal to the bare remote tip, `git push --force-with-lease origin HEAD:«branch»` and `git push --force origin HEAD:«branch»` of a rewritten branch through unguarded git each exit zero and the bare remote branch returns the local tip, as asserted in `src/conductor/test/engine/pre-push-hook.test.ts`.
- A fast-forward `git push origin HEAD:«branch»` and a push of a branch the bare remote lacks each exit zero and the bare remote branch returns the local tip, as asserted in `src/conductor/test/engine/pre-push-hook.test.ts`.
- With the bare remote advanced and its tip fetched into the remote-tracking ref, a plain `git push origin HEAD:«branch»` of a rewritten branch exits non-zero with git's `non-fast-forward` rejection and its stderr does not contain the `PRE_PUSH_HOOK` refusal text `has not fetched`, as asserted in `src/conductor/test/engine/pre-push-hook.test.ts`.
- `git push origin --delete «branch»` through unguarded git in a prepared worktree exits zero and the bare remote no longer has the branch, as asserted in `src/conductor/test/engine/pre-push-hook.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/pre-push-hook.test.ts`

**Dependencies:** Task 7

### Task 9: Chain both hooks to the repository's own hooks after an allow
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/ref-hook-chaining.test.ts`. Install recording hooks at `$GIT_COMMON_DIR/hooks/pre-push` and `$GIT_COMMON_DIR/hooks/reference-transaction` that append their arguments and stdin to a log file and exit with a configurable status. Cover an allowed push, an allowed ref update, a repository `pre-push` that exits 1, a push the engine hook refuses, and a non-executable repository hook. Fixture: a temporary repository under `tmpdir()` (`initTestRepo`), a linked worktree added from it and provisioned with `prepareWorktree`, and, for pushes, a local bare remote under `tmpdir()`; drive every command through unguarded git (absolute-path real `git`, `HOME` set to an empty directory). Never touch the harness checkout or a real remote, so the test stays harmless when the hook is absent (test-process-isolation rule).
2. Verify RED.
3. Implement in `REFERENCE_TRANSACTION_HOOK` and `PRE_PUSH_HOOK`: buffer stdin first; after the hook's own decision allows, when `$(git rev-parse --git-common-dir)/hooks/«name»` is an executable file, run it with the same arguments and the buffered stdin and exit with its status. A refusal exits before chaining. Follow the existing chaining in `COMMIT_MSG_HOOK` and `PRE_COMMIT_HOOK` (rediscover via `GIT_COMMON_DIR`).
4. Verify GREEN. Commit: "ref hooks: chain to repository hooks after an allow"

**Done when:**
- For an allowed push through unguarded git in a prepared worktree, the recording repository `pre-push` hook runs exactly once and its log holds the same arguments and stdin lines the engine `pre-push` received, as asserted in `ref-hook-chaining.test.ts`.
- For an allowed branch creation through unguarded git in a prepared worktree, the recording repository `reference-transaction` hook logs that transaction's `prepared` stage, as asserted in `ref-hook-chaining.test.ts`.
- When the repository `pre-push` hook exits 1, a push the engine hook allows exits non-zero and the bare remote branch keeps its previous tip, as asserted in `ref-hook-chaining.test.ts`.
- For a push the engine `pre-push` hook refuses, the push exits non-zero and the recording repository hook's log stays empty, as asserted in `ref-hook-chaining.test.ts`.
- With a repository `pre-push` file present but not executable, an allowed push exits zero, the bare remote branch returns the local tip, and the repository hook's log stays empty, as asserted in `ref-hook-chaining.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/ref-hook-chaining.test.ts`

**Dependencies:** Task 8

### Task 10: Prove the engine's own ref operations pass the hooks unchanged
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/ref-hooks-engine-unaffected.test.ts` that run the engine's exact argv from the engine's working directory through `makeGitRunner` against a prepared feature worktree (rediscover the argv at `quarantine` in `setup-triage.ts`, the `update-ref HEAD` recovery in `conductor.ts`, the lease push in `ship-draft-pr.ts`, and `WorktreeManager.cleanup` in `worktree.ts`): quarantine `branch -f wip/setup-quarantine-«slug» «sha»`; `update-ref HEAD «recovery-head» «current-head»`; after a fetch and a history rewrite, `push origin HEAD:refs/heads/«branch» --force-with-lease` to a local bare remote; with the remote advanced after the fetch, the same lease push; `branch -D «branch»` of a unique-tip branch from the root checkout and from the feature worktree. Fixture: a temporary repository under `tmpdir()` (`initTestRepo`), a linked worktree added from it and provisioned with `prepareWorktree`, and, for pushes, a local bare remote under `tmpdir()`; drive every command through unguarded git (absolute-path real `git`, `HOME` set to an empty directory). Never touch the harness checkout or a real remote, so the test stays harmless when the hook is absent (test-process-isolation rule).
2. Verify RED where the hooks change behaviour (the unique-tip deletion from the feature worktree); the remaining cases are regression guards.
3. Implement: no production change is expected. If a case fails, fix the hook in `git-hook-assets.ts`, never the engine argv.
4. Verify GREEN. Commit: "ref hooks: prove engine ref operations pass"

**Done when:**
- Through `makeGitRunner` in a prepared feature worktree, the quarantine `branch -f wip/setup-quarantine-«slug» «sha»` exits zero with the quarantine ref at `«sha»`, and `update-ref HEAD «recovery-head» «current-head»` exits zero with the branch at `«recovery-head»`, as asserted in `ref-hooks-engine-unaffected.test.ts`.
- After a fetch and a history rewrite in a prepared feature worktree, `push origin HEAD:refs/heads/«branch» --force-with-lease` exits zero and the bare remote branch returns the local tip, as asserted in `ref-hooks-engine-unaffected.test.ts`.
- With the bare remote advanced after the fetch, the same lease push exits non-zero with git's `stale info` rejection and its stderr does not contain the `pre-push` refusal text `has not fetched`, as asserted in `ref-hooks-engine-unaffected.test.ts`.
- `branch -D «branch»` of a unique-tip branch run by `makeGitRunner` with the root checkout as its working directory exits zero and the branch is gone, while the same command run with the prepared feature worktree as its working directory exits non-zero and the branch still resolves to its original tip, as asserted in `ref-hooks-engine-unaffected.test.ts`.

**Files likely touched:**
- `src/conductor/test/engine/ref-hooks-engine-unaffected.test.ts`

**Dependencies:** Task 9

### Task 11: Re-verify and repair both hooks before every guarded dispatch
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-guard.test.ts` and `src/conductor/test/execution/git-guard-adapter-cells.test.ts`: in a prepared worktree, delete and separately edit each of `reference-transaction` and `pre-push` (four cases), and for each case call `ensureGitGuardForDispatch` and invoke a Claude and a Codex provider with a recording spawn double that snapshots the hook file at spawn time; make one hook path unrestorable (replace `.pipeline/git-hooks/pre-push` with a directory).
2. Verify RED.
3. Implement in `ensureGitGuardForDispatch` (`src/conductor/src/engine/git-guard.ts`): after the guard check, compare each of `.pipeline/git-hooks/reference-transaction` and `.pipeline/git-hooks/pre-push` with `REFERENCE_TRANSACTION_HOOK` and `PRE_PUSH_HOOK` for content, regular-file type and mode 0755; rewrite a mismatch, re-check, and throw `git hook repair failed: «path»` when it still does not match. Follow the guard's own repair-then-recheck shape in the same function.
4. Verify GREEN. Commit: "git guard: re-verify ref hooks before dispatch"

**Done when:**
- For each of `reference-transaction` and `pre-push`, both when deleted and when edited in a prepared worktree, `ensureGitGuardForDispatch` rewrites the file to its exported asset (`REFERENCE_TRANSACTION_HOOK` or `PRE_PUSH_HOOK`) with mode 0755, as asserted in `git-guard.test.ts`.
- For each of the four cases (`reference-transaction` deleted, `reference-transaction` edited, `pre-push` deleted, `pre-push` edited), a Claude and a Codex provider `invoke` for the prepared worktree record their spawn only after that hook file again equals its exported asset with mode 0755, as asserted in `git-guard-adapter-cells.test.ts`.
- When `.pipeline/git-hooks/pre-push` is a directory that cannot be replaced, `ensureGitGuardForDispatch` throws an error naming that path, and the Claude and Codex provider `invoke` record no spawn, as asserted in `git-guard-adapter-cells.test.ts`.

**Files likely touched:**
- `src/conductor/src/engine/git-guard.ts`
- `src/conductor/test/engine/git-guard.test.ts`
- `src/conductor/test/execution/git-guard-adapter-cells.test.ts`

**Dependencies:** Task 1

## Task Dependency Graph

```text
Task 1 ─┬─▶ Task 2 ─▶ Task 3 ─▶ Task 4 ─▶ Task 5 ─▶ Task 6 ─▶ Task 7 ─▶ Task 8 ─▶ Task 9 ─▶ Task 10
        └─▶ Task 11
```

## Integration Points

- After Task 1: every prepared worktree carries both hooks, wired by the existing `core.hooksPath`.
- After Task 5: unguarded branch deletion and git maintenance behave end to end in a prepared worktree.
- After Task 9: both vetoes and repository-hook chaining work end to end; Task 10 runs the engine's own argv through them.
- After Task 11: Claude and Codex dispatches restore missing or altered hooks before launch.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a prepared worktree and a local branch with a unique tip, when unguarded git runs `git branch -D «branch»` there, then the command exits non-zero and the branch still exists at the same tip. | 2 | "In `src/conductor/test/engine/reference-transaction-hook.test.ts`, `git branch -D «branch»` and `git update-ref -d refs/heads/«branch»` of a unique-tip branch run through unguarded git in a prepared worktree each exit non-zero and `git rev-parse refs/heads/«branch»` still returns the original tip" | diff-local |
| Story 1 happy: Given a prepared worktree and a local branch with a unique tip, when unguarded git runs `git update-ref -d refs/heads/«branch»` there, then the command exits non-zero and the branch still exists at the same tip. | 2 | "In `src/conductor/test/engine/reference-transaction-hook.test.ts`, `git branch -D «branch»` and `git update-ref -d refs/heads/«branch»` of a unique-tip branch run through unguarded git in a prepared worktree each exit non-zero and `git rev-parse refs/heads/«branch»` still returns the original tip" | diff-local |
| Story 1 happy: Given a prepared worktree and a local branch with a unique tip, when unguarded git refuses its deletion, then stderr names the refused branch deletion, says its commits would become unreachable, and names pushing or merging it first or `git branch -d` as the safe alternative. | 3 | "A refused `git branch -D «branch»` of a unique-tip branch writes stderr that contains `refused branch deletion`, `refs/heads/«branch»`, the words `its commits would become unreachable`, and both `git branch -d` and `push or merge it first`" | diff-local |
| Story 1 negative: Given a prepared worktree and a local branch whose tip another local branch contains, when unguarded git runs `git branch -D «branch»` there, then the branch is deleted and the command exits zero. | 4 | "`git branch -D «branch»` run through unguarded git in a prepared worktree exits zero and the branch no longer exists when another local branch contains its tip, and also when only its remote-tracking ref contains its tip" | diff-local |
| Story 1 negative: Given a prepared worktree and a local branch whose tip only its remote-tracking ref contains, when unguarded git runs `git branch -D «branch»` there, then the branch is deleted and the command exits zero. | 4 | "`git branch -D «branch»` run through unguarded git in a prepared worktree exits zero and the branch no longer exists when another local branch contains its tip, and also when only its remote-tracking ref contains its tip" | diff-local |
| Story 1 negative: Given a prepared worktree and a local branch with a unique tip, when unguarded git runs `git branch -m «branch» «new-name»` there, then the command exits non-zero, the original branch still exists at the same tip, and stderr names creating the new branch and then deleting the old one with `git branch -d` as the safe alternative. | 3 | "`git branch -m «branch» «new-name»` of a unique-tip branch run through unguarded git in a prepared worktree exits non-zero, `refs/heads/«branch»` still resolves to its original tip, and stderr contains `create the new branch first` and `git branch -d`" | diff-local |
| Story 1 negative: Given a prepared worktree and a local branch whose tip another local branch contains, when unguarded git runs `git branch -m «branch» «new-name»` there, then the branch is renamed and the command exits zero. | 4 | "`git branch -m «branch» «new-name»` of a branch whose tip another local branch contains exits zero, `refs/heads/«new-name»` resolves to the original tip and `refs/heads/«branch»` no longer exists" | diff-local |
| Story 1 negative: Given a prepared worktree and a local branch with a unique tip, when unguarded git runs `CONDUCT_ENGINE_COMMIT=1 git branch -D «branch»` there, then the command exits non-zero and the branch still exists at the same tip. | 2 | "The same `git branch -D «branch»` run with `CONDUCT_ENGINE_COMMIT=1` in the environment exits non-zero and the branch still resolves to its original tip" | diff-local |
| Story 2 happy: Given a prepared worktree with loose branch refs including one with a unique tip, when unguarded git runs `git pack-refs --all` there, then the command exits zero and every branch resolves to its previous tip. | 5 | "`git pack-refs --all` run through unguarded git in a prepared worktree exits zero and `git rev-parse` returns each branch's previous tip, including the unique-tip branch" | diff-local |
| Story 2 happy: Given a prepared worktree with loose branch refs including one with a unique tip, when unguarded git runs `git gc` there, then the command exits zero, its output contains no `failed to run pack-refs` error, and every branch resolves to its previous tip. | 5 | "`git gc` run through unguarded git in a prepared worktree exits zero, its output does not contain `failed to run pack-refs`, and every branch, including the unique-tip branch, resolves to its previous tip" | diff-local |
| Story 2 happy: Given a prepared worktree on a feature branch, when unguarded git runs `git commit`, `git commit --amend`, `git rebase «base»`, `git reset --keep «target»`, or `git branch -f «other» «target»` there, then each command exits with the same status it has with no hooks installed. | 2 | "`git commit`, `git commit --amend`, `git rebase «base»`, `git reset --keep «target»` and `git branch -f «other» «target»` run through unguarded git in a prepared worktree each exit with the same status as in an identical repository with no hooks" | diff-local |
| Story 2 negative: Given a prepared worktree whose branch refs are already packed, when unguarded git runs `git branch -D «branch»` for a packed branch with a unique tip, then the command exits non-zero and the branch still exists at the same tip. | 5 | "After `git pack-refs --all`, `git branch -D` of the packed unique-tip branch exits non-zero and the branch still resolves to its original tip" | diff-local |
| Story 2 negative: Given a prepared worktree, when unguarded git updates a ref outside `refs/heads/`, such as deleting a tag or pruning a remote-tracking ref with `git fetch --prune`, then the hook does not refuse it. | 2 | "Deleting a tag and running `git fetch --prune` for a deleted remote branch through unguarded git in a prepared worktree both exit zero and the tag and remote-tracking ref are gone, so `REFERENCE_TRANSACTION_HOOK` never refuses a ref outside `refs/heads/`" | diff-local |
| Story 3 happy: Given a prepared worktree whose remote branch has advanced past its remote-tracking ref, when unguarded git runs `git push --force origin HEAD:«branch»` with a rewritten local branch, then the command exits non-zero and the remote branch tip is unchanged. | 6 | "With the bare remote branch advanced past the remote-tracking ref, `git push --force origin HEAD:«branch»` and `git push origin +HEAD:«branch»` of a rewritten branch run through unguarded git in a prepared worktree each exit non-zero and `git -C «bare» rev-parse «branch»` still returns the advanced tip" | diff-local |
| Story 3 happy: Given a prepared worktree whose remote branch has advanced past its remote-tracking ref, when unguarded git runs `git push origin +HEAD:«branch»` with a rewritten local branch, then the command exits non-zero and the remote branch tip is unchanged. | 6 | "With the bare remote branch advanced past the remote-tracking ref, `git push --force origin HEAD:«branch»` and `git push origin +HEAD:«branch»` of a rewritten branch run through unguarded git in a prepared worktree each exit non-zero and `git -C «bare» rev-parse «branch»` still returns the advanced tip" | diff-local |
| Story 3 happy: Given a prepared worktree whose remote branch has advanced past its remote-tracking ref, when unguarded git runs `git push --force-with-lease=«branch»:«current-remote-tip» origin HEAD:«branch»`, then the command exits non-zero and the remote branch tip is unchanged. | 6 | "In the same fixture, `git push --force-with-lease=«branch»:«current-remote-tip» origin HEAD:«branch»` exits non-zero and the bare remote branch still returns the advanced tip" | diff-local |
| Story 3 happy: Given a prepared worktree whose remote branch has advanced past its remote-tracking ref, when unguarded git refuses a forced push, then stderr names the refused push and its branch, says it would overwrite remote history this worktree has not fetched, and names fetching then `git push --force-with-lease` as the safe alternative. | 7 | "A refused `git push --force origin HEAD:«branch»` writes stderr that contains `refused push`, `refs/heads/«branch»`, the words `would overwrite remote history this worktree has not fetched`, and both `git fetch` and `git push --force-with-lease`" | diff-local |
| Story 3 negative: Given a prepared worktree whose remote-tracking ref equals the remote branch tip, when unguarded git runs `git push --force-with-lease origin HEAD:«branch»` with a rewritten local branch, then the remote branch moves to the local tip and the command exits zero. | 8 | "With the remote-tracking ref equal to the bare remote tip, `git push --force-with-lease origin HEAD:«branch»` and `git push --force origin HEAD:«branch»` of a rewritten branch through unguarded git each exit zero and the bare remote branch returns the local tip" | diff-local |
| Story 3 negative: Given a prepared worktree whose remote-tracking ref equals the remote branch tip, when unguarded git runs `git push --force origin HEAD:«branch»` with a rewritten local branch, then the remote branch moves to the local tip and the command exits zero. | 8 | "With the remote-tracking ref equal to the bare remote tip, `git push --force-with-lease origin HEAD:«branch»` and `git push --force origin HEAD:«branch»` of a rewritten branch through unguarded git each exit zero and the bare remote branch returns the local tip" | diff-local |
| Story 3 negative: Given a prepared worktree, when unguarded git runs a plain fast-forward `git push origin HEAD:«branch»` or pushes a branch the remote does not have, then the remote branch moves to the local tip and the command exits zero. | 8 | "A fast-forward `git push origin HEAD:«branch»` and a push of a branch the bare remote lacks each exit zero and the bare remote branch returns the local tip" | diff-local |
| Story 3 negative: Given a prepared worktree whose remote-tracking ref equals the remote branch tip, when unguarded git runs a plain `git push origin HEAD:«branch»` with a rewritten local branch, then git rejects it as non-fast-forward with its own message and the hook's refusal text does not appear. | 8 | "With the bare remote advanced and its tip fetched into the remote-tracking ref, a plain `git push origin HEAD:«branch»` of a rewritten branch exits non-zero with git's `non-fast-forward` rejection and its stderr does not contain the `PRE_PUSH_HOOK` refusal text `has not fetched`" | diff-local |
| Story 3 negative: Given a prepared worktree, when unguarded git runs `git push origin --delete «branch»`, then the hook does not refuse the deletion. | 8 | "`git push origin --delete «branch»` through unguarded git in a prepared worktree exits zero and the bare remote no longer has the branch" | diff-local |
| Story 4 happy: Given a prepared worktree whose repository has an executable `$GIT_COMMON_DIR/hooks/pre-push` that records its invocation, when unguarded git runs an allowed push there, then the repository hook runs once with the same arguments and stdin lines. | 9 | "For an allowed push through unguarded git in a prepared worktree, the recording repository `pre-push` hook runs exactly once and its log holds the same arguments and stdin lines the engine `pre-push` received" | diff-local |
| Story 4 happy: Given a prepared worktree whose repository has an executable `$GIT_COMMON_DIR/hooks/reference-transaction` that records its invocation, when unguarded git runs an allowed ref update there, then the repository hook runs for that transaction. | 9 | "For an allowed branch creation through unguarded git in a prepared worktree, the recording repository `reference-transaction` hook logs that transaction's `prepared` stage" | diff-local |
| Story 4 negative: Given a prepared worktree whose repository `pre-push` hook exits non-zero, when unguarded git runs a push the engine hook allows, then the push exits non-zero and the remote branch tip is unchanged. | 9 | "When the repository `pre-push` hook exits 1, a push the engine hook allows exits non-zero and the bare remote branch keeps its previous tip" | diff-local |
| Story 4 negative: Given a prepared worktree whose repository has an executable `pre-push` hook, when unguarded git runs a push the engine hook refuses, then the push exits non-zero and the repository hook does not run. | 9 | "For a push the engine `pre-push` hook refuses, the push exits non-zero and the recording repository hook's log stays empty" | diff-local |
| Story 4 negative: Given a prepared worktree whose repository hook file exists but is not executable, when unguarded git runs an allowed push there, then the push succeeds and the repository hook does not run. | 9 | "With a repository `pre-push` file present but not executable, an allowed push exits zero, the bare remote branch returns the local tip, and the repository hook's log stays empty" | diff-local |
| Story 5 happy: Given a prepared feature worktree, when the setup-triage quarantine moves `wip/setup-quarantine-«slug»` with `git branch -f` there, then the quarantine ref points at the new commit. | 10 | "Through `makeGitRunner` in a prepared feature worktree, the quarantine `branch -f wip/setup-quarantine-«slug» «sha»` exits zero with the quarantine ref at `«sha»`, and `update-ref HEAD «recovery-head» «current-head»` exits zero with the branch at `«recovery-head»`" | diff-local |
| Story 5 happy: Given a prepared feature worktree, when the engine runs `git update-ref HEAD «recovery-head» «current-head»` there, then the branch moves to the recovery head. | 10 | "Through `makeGitRunner` in a prepared feature worktree, the quarantine `branch -f wip/setup-quarantine-«slug» «sha»` exits zero with the quarantine ref at `«sha»`, and `update-ref HEAD «recovery-head» «current-head»` exits zero with the branch at `«recovery-head»`" | diff-local |
| Story 5 happy: Given a prepared feature worktree that has fetched its remote branch and rewritten its history, when the engine's lease publication runs `git push origin HEAD:refs/heads/«branch» --force-with-lease`, then the remote branch moves to the local tip. | 10 | "After a fetch and a history rewrite in a prepared feature worktree, `push origin HEAD:refs/heads/«branch» --force-with-lease` exits zero and the bare remote branch returns the local tip" | diff-local |
| Story 5 happy: Given a prepared feature worktree and its feature branch with a unique tip, when the engine's worktree cleanup runs `git branch -D «branch»` with the root checkout as its working directory, then the branch is deleted. | 10 | "`branch -D «branch»` of a unique-tip branch run by `makeGitRunner` with the root checkout as its working directory exits zero and the branch is gone, while the same command run with the prepared feature worktree as its working directory exits non-zero and the branch still resolves to its original tip" | diff-local |
| Story 5 negative: Given a prepared feature worktree whose remote branch has advanced since its last fetch, when the engine's lease publication runs its bare `--force-with-lease` push, then git rejects it as stale and the hook's refusal text does not appear. | 10 | "With the bare remote advanced after the fetch, the same lease push exits non-zero with git's `stale info` rejection and its stderr does not contain the `pre-push` refusal text `has not fetched`" | diff-local |
| Story 5 negative: Given a prepared feature worktree, when the engine runs `git branch -D «branch»` for a unique-tip branch with the feature worktree as its working directory, then the command exits non-zero and the branch still exists at the same tip. | 10 | "`branch -D «branch»` of a unique-tip branch run by `makeGitRunner` with the root checkout as its working directory exits zero and the branch is gone, while the same command run with the prepared feature worktree as its working directory exits non-zero and the branch still resolves to its original tip" | diff-local |
| Story 6 happy: Given a fresh linked worktree, when `prepareWorktree` runs, then `.pipeline/git-hooks/reference-transaction` and `.pipeline/git-hooks/pre-push` exist with mode 0755 and contents equal to the engine's embedded hook assets. | 1 | "After `prepareWorktree` on a fresh linked worktree, `.pipeline/git-hooks/reference-transaction` and `.pipeline/git-hooks/pre-push` exist with mode 0755 and contents equal to the exported `REFERENCE_TRANSACTION_HOOK` and `PRE_PUSH_HOOK`" | diff-local |
| Story 6 happy: Given a prepared worktree whose `reference-transaction` or `pre-push` hook was deleted or edited, when a guarded dispatch is prepared for it, then the hook is rewritten to the embedded asset with mode 0755 before the provider is launched. | 11 | "For each of `reference-transaction` and `pre-push`, both when deleted and when edited in a prepared worktree, `ensureGitGuardForDispatch` rewrites the file to its exported asset (`REFERENCE_TRANSACTION_HOOK` or `PRE_PUSH_HOOK`) with mode 0755" | diff-local |
| Story 6 negative: Given a linked worktree whose `.pipeline/git-hooks` directory cannot be written, when `prepareWorktree` runs, then preparation fails with the existing preventive-hook installation error and no dispatch proceeds. | 1 | "`prepareWorktree` on a linked worktree whose `.pipeline/git-hooks` directory cannot be written rejects with the existing `preventive git hook installation failed` error" | diff-local |
| Story 6 negative: Given a prepared worktree whose hook cannot be rewritten before dispatch, when a guarded dispatch is prepared for it, then the dispatch is not launched and the failure message names the hook path. | 11 | "When `.pipeline/git-hooks/pre-push` is a directory that cannot be replaced, `ensureGitGuardForDispatch` throws an error naming that path, and the Claude and Codex provider `invoke` record no spawn" | diff-local |
| Story 6 negative: Given the embedded hook assets, when the interpreter-source inventory check runs, then it reports no shell-expanded runtime data in either new hook. | 1 | "The interpreter-source inventory run over the real `git-hook-assets` exports reports no shell-expanded runtime data in `REFERENCE_TRANSACTION_HOOK` or `PRE_PUSH_HOOK`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-23-engine-git-guard-on-agent-path#D1 | existing | none | `writeGitGuard` in `src/conductor/src/engine/git-guard.ts` writes the static `GIT_GUARD_SCRIPT` to `.pipeline/bin/git` and its data files (shipped by #1354, fd6f539ca); unchanged here |
| adr-2026-09-23-engine-git-guard-on-agent-path#D2 | existing | none | `withGitGuardPath` in `src/conductor/src/execution/child-environment.ts` prepends the guard to the Claude and Codex child `PATH` (shipped by #1354); unchanged here |
| adr-2026-09-23-engine-git-guard-on-agent-path#D3 | task | task-11 | For each of `reference-transaction` and `pre-push`, both when deleted and when edited in a prepared worktree, `ensureGitGuardForDispatch` rewrites the file to its exported asset (`REFERENCE_TRANSACTION_HOOK` or `PRE_PUSH_HOOK`) with mode 0755 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D4 | existing | none | the guard scopes refusal to the baked common dir via `rev-parse --git-common-dir` in `GIT_GUARD_SCRIPT` (shipped by #1354); unchanged here |
| adr-2026-09-23-engine-git-guard-on-agent-path#D5 | existing | none | the guard refusal matrix in `GIT_GUARD_SCRIPT` (shipped by #1354) is unchanged; the hooks reuse its reachability rule in task-4 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D6 | existing | none | `GIT_GUARD_SCRIPT` refusal messages name operation, reason and safe alternative (shipped by #1354); the hooks follow the same shape in task-3 and task-7 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D7 | task | task-10 | `branch -D «branch»` of a unique-tip branch run by `makeGitRunner` with the root checkout as its working directory exits zero and the branch is gone, while the same command run with the prepared feature worktree as its working directory exits non-zero and the branch still resolves to its original tip |
| adr-2026-09-23-engine-git-guard-on-agent-path#D8 | no-change | none | `hooks/claude/block-destructive-git.sh` is not touched by this feature |
| adr-2026-09-23-engine-git-guard-on-agent-path#D9 | no-change | none | the `tdd` skill counterfactual is not touched by this feature |
| adr-2026-09-23-engine-git-guard-on-agent-path#D10 | existing | none | the guard tests, adapter cells and live smokes shipped by #1354 are unchanged; the D10 amendment is satisfied by the D15 tests of this feature |
| adr-2026-09-23-engine-git-guard-on-agent-path#D11 | task | task-1, task-9 | After `prepareWorktree` on a fresh linked worktree, `.pipeline/git-hooks/reference-transaction` and `.pipeline/git-hooks/pre-push` exist with mode 0755 and contents equal to the exported `REFERENCE_TRANSACTION_HOOK` and `PRE_PUSH_HOOK` |
| adr-2026-09-23-engine-git-guard-on-agent-path#D12 | task | task-2, task-3, task-4, task-5 | After `git pack-refs --all`, `git branch -D` of the packed unique-tip branch exits non-zero and the branch still resolves to its original tip |
| adr-2026-09-23-engine-git-guard-on-agent-path#D13 | task | task-6, task-7, task-8 | With the remote-tracking ref equal to the bare remote tip, `git push --force-with-lease origin HEAD:«branch»` and `git push --force origin HEAD:«branch»` of a rewritten branch through unguarded git each exit zero and the bare remote branch returns the local tip |
| adr-2026-09-23-engine-git-guard-on-agent-path#D14 | task | task-10, task-11 | `branch -D «branch»` of a unique-tip branch run by `makeGitRunner` with the root checkout as its working directory exits zero and the branch is gone, while the same command run with the prepared feature worktree as its working directory exits non-zero and the branch still resolves to its original tip |
| adr-2026-09-23-engine-git-guard-on-agent-path#D15 | task | task-2, task-6 | In `src/conductor/test/engine/reference-transaction-hook.test.ts`, `git branch -D «branch»` and `git update-ref -d refs/heads/«branch»` of a unique-tip branch run through unguarded git in a prepared worktree each exit non-zero and `git rev-parse refs/heads/«branch»` still returns the original tip |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-rem-adr-001: docs/reference/settings-and-hooks.md:192-237 — add `reference-transaction` and `pre-push` rows to the git hook table (trigger, refusal rule per ADR D12/D13, chaining per D11, blocks: yes exit 1); :280-290 'What the guard does NOT cover' — add the git-side backstop limits: an overridden core.hooksPath, `git push --no-verify`, git run from the root checkout (no worktree-scoped core.hooksPath), and worktrees not prepared by the engine
**Gate:** as-built
**Rationale:** REMEDIABLE D15 drift with architecture unchanged, in two halves: the test half (ref-hooks-engine-unaffected.test.ts:15-27 missing D14's quarantine move, moving recovery ref, successful/stale lease, root-versus-feature deletion) is admitted by Task 10 and re-staged under S5.1-S5.5; the documentation half (docs/reference/settings-and-hooks.md:192-237 lists only three hooks, :280-290 omits the git-side limits) is admitted by no plan task — the plan's Technical Approach routed it to a documentation-maintenance step that has not run on this feature — so it needs one appended conforming-documentation task. Found-and-excluded: the stale 'Provisioned now … subsequent tasks add' doc comments at git-hook-assets.ts:192-193 and :243-244 (cosmetic audit note, no admitting task).
**Governing clause:** adr-2026-09-23-engine-git-guard-on-agent-path decision 15
**Done when:**
- adr-2026-09-23-engine-git-guard-on-agent-path decision 15 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-001 is complete.
