**Status:** Accepted

# Stories: git-side veto for ref-moving destructive git that bypasses the build guard (#2693)

Technical track (no PRD). Acceptance is grounded in the APPROVED
`adr-2026-09-23-engine-git-guard-on-agent-path` amendment D11–D15 and the conditions in
`architecture-review-2026-10-03-ref-moving-destructive-git-that-bypasses-the-build`.

Terms used below:

- **Prepared worktree:** a linked worktree that `prepareWorktree` has provisioned, so its
  worktree-scoped `core.hooksPath` is its own `.pipeline/git-hooks`.
- **Unguarded git:** the real `git` binary invoked by absolute path, with `HOME` set to an empty
  directory, so neither the #1354 `PATH` guard nor any operator configuration is in effect.
- **Unique tip:** a branch tip that no other `refs/heads/` or `refs/remotes/` ref contains.

## Story 1: Deleting a branch whose commits would be lost is refused inside git

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D12

As the harness operator, I want a branch deletion that would orphan commits refused by git itself, so that a `git` that bypasses the `PATH` guard still cannot lose that work.

### Happy Path

- Given a prepared worktree and a local branch with a unique tip, when unguarded git runs `git branch -D «branch»` there, then the command exits non-zero and the branch still exists at the same tip.
- Given a prepared worktree and a local branch with a unique tip, when unguarded git runs `git update-ref -d refs/heads/«branch»` there, then the command exits non-zero and the branch still exists at the same tip.
- Given a prepared worktree and a local branch with a unique tip, when unguarded git refuses its deletion, then stderr names the refused branch deletion, says its commits would become unreachable, and names pushing or merging it first or `git branch -d` as the safe alternative.

### Negative Paths

- Given a prepared worktree and a local branch whose tip another local branch contains, when unguarded git runs `git branch -D «branch»` there, then the branch is deleted and the command exits zero.
- Given a prepared worktree and a local branch whose tip only its remote-tracking ref contains, when unguarded git runs `git branch -D «branch»` there, then the branch is deleted and the command exits zero.
- Given a prepared worktree and a local branch with a unique tip, when unguarded git runs `git branch -m «branch» «new-name»` there, then the command exits non-zero, the original branch still exists at the same tip, and stderr names creating the new branch and then deleting the old one with `git branch -d` as the safe alternative.
- Given a prepared worktree and a local branch whose tip another local branch contains, when unguarded git runs `git branch -m «branch» «new-name»` there, then the branch is renamed and the command exits zero.
- Given a prepared worktree and a local branch with a unique tip, when unguarded git runs `CONDUCT_ENGINE_COMMIT=1 git branch -D «branch»` there, then the command exits non-zero and the branch still exists at the same tip.

### Done When

- [ ] A real-git test drives each refused deletion and rename through unguarded git in a prepared worktree and asserts a non-zero exit, the unchanged branch tip, and the refusal text naming the operation and its safe alternative
- [ ] A real-git test asserts that deleting or renaming a branch whose tip another local branch or a remote-tracking ref contains exits zero

## Story 2: Git maintenance and ordinary ref updates keep working

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D12

As the harness operator, I want git's own housekeeping and every non-deleting ref update to pass the new hook, so that the backstop does not break builds.

### Happy Path

- Given a prepared worktree with loose branch refs including one with a unique tip, when unguarded git runs `git pack-refs --all` there, then the command exits zero and every branch resolves to its previous tip.
- Given a prepared worktree with loose branch refs including one with a unique tip, when unguarded git runs `git gc` there, then the command exits zero, its output contains no `failed to run pack-refs` error, and every branch resolves to its previous tip.
- Given a prepared worktree on a feature branch, when unguarded git runs `git commit`, `git commit --amend`, `git rebase «base»`, `git reset --keep «target»`, or `git branch -f «other» «target»` there, then each command exits with the same status it has with no hooks installed.

### Negative Paths

- Given a prepared worktree whose branch refs are already packed, when unguarded git runs `git branch -D «branch»` for a packed branch with a unique tip, then the command exits non-zero and the branch still exists at the same tip.
- Given a prepared worktree, when unguarded git updates a ref outside `refs/heads/`, such as deleting a tag or pruning a remote-tracking ref with `git fetch --prune`, then the hook does not refuse it.

### Done When

- [ ] A real-git test asserts that `git pack-refs --all` and `git gc` exit zero in a prepared worktree and leave every branch tip unchanged, including a unique-tip branch
- [ ] A real-git test asserts that deleting a packed unique-tip branch is still refused after `git pack-refs --all`

## Story 3: A push that overwrites unseen remote history is refused inside git

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D13

As the harness operator, I want a push that would overwrite remote commits this worktree never fetched refused by git itself, so that a forced push that bypasses the `PATH` guard cannot destroy someone else's work.

### Happy Path

- Given a prepared worktree whose remote branch has advanced past its remote-tracking ref, when unguarded git runs `git push --force origin HEAD:«branch»` with a rewritten local branch, then the command exits non-zero and the remote branch tip is unchanged.
- Given a prepared worktree whose remote branch has advanced past its remote-tracking ref, when unguarded git runs `git push origin +HEAD:«branch»` with a rewritten local branch, then the command exits non-zero and the remote branch tip is unchanged.
- Given a prepared worktree whose remote branch has advanced past its remote-tracking ref, when unguarded git runs `git push --force-with-lease=«branch»:«current-remote-tip» origin HEAD:«branch»`, then the command exits non-zero and the remote branch tip is unchanged.
- Given a prepared worktree whose remote branch has advanced past its remote-tracking ref, when unguarded git refuses a forced push, then stderr names the refused push and its branch, says it would overwrite remote history this worktree has not fetched, and names fetching then `git push --force-with-lease` as the safe alternative.

### Negative Paths

- Given a prepared worktree whose remote-tracking ref equals the remote branch tip, when unguarded git runs `git push --force-with-lease origin HEAD:«branch»` with a rewritten local branch, then the remote branch moves to the local tip and the command exits zero.
- Given a prepared worktree whose remote-tracking ref equals the remote branch tip, when unguarded git runs `git push --force origin HEAD:«branch»` with a rewritten local branch, then the remote branch moves to the local tip and the command exits zero.
- Given a prepared worktree, when unguarded git runs a plain fast-forward `git push origin HEAD:«branch»` or pushes a branch the remote does not have, then the remote branch moves to the local tip and the command exits zero.
- Given a prepared worktree whose remote-tracking ref equals the remote branch tip, when unguarded git runs a plain `git push origin HEAD:«branch»` with a rewritten local branch, then git rejects it as non-fast-forward with its own message and the hook's refusal text does not appear.
- Given a prepared worktree, when unguarded git runs `git push origin --delete «branch»`, then the hook does not refuse the deletion.

### Done When

- [ ] A real-git test against a local bare remote drives each refused push through unguarded git and asserts a non-zero exit, the unchanged remote tip, and the refusal text naming the push and its safe alternative
- [ ] A real-git test asserts that bare lease, tracking-matched force, fast-forward, new-branch, and remote-delete pushes succeed and that a plain non-fast-forward push carries git's own rejection without the hook's text

## Story 4: Repository hooks still run behind the engine hooks

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D11

As a consumer project maintainer, I want my repository's own `pre-push` and `reference-transaction` hooks to keep running in prepared worktrees, so that the engine's override of `core.hooksPath` does not silently disable them.

### Happy Path

- Given a prepared worktree whose repository has an executable `$GIT_COMMON_DIR/hooks/pre-push` that records its invocation, when unguarded git runs an allowed push there, then the repository hook runs once with the same arguments and stdin lines.
- Given a prepared worktree whose repository has an executable `$GIT_COMMON_DIR/hooks/reference-transaction` that records its invocation, when unguarded git runs an allowed ref update there, then the repository hook runs for that transaction.

### Negative Paths

- Given a prepared worktree whose repository `pre-push` hook exits non-zero, when unguarded git runs a push the engine hook allows, then the push exits non-zero and the remote branch tip is unchanged.
- Given a prepared worktree whose repository has an executable `pre-push` hook, when unguarded git runs a push the engine hook refuses, then the push exits non-zero and the repository hook does not run.
- Given a prepared worktree whose repository hook file exists but is not executable, when unguarded git runs an allowed push there, then the push succeeds and the repository hook does not run.

### Done When

- [ ] A real-git test installs recording repository hooks and asserts they run for allowed operations, do not run after an engine refusal, and fail the operation when they exit non-zero

## Story 5: The engine's own ref operations pass the hooks unchanged

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D14

As the harness operator, I want every ref operation the engine performs to succeed under the new hooks with no bypass variable, so that the backstop never halts a build.

### Happy Path

- Given a prepared feature worktree, when the setup-triage quarantine moves `wip/setup-quarantine-«slug»` with `git branch -f` there, then the quarantine ref points at the new commit.
- Given a prepared feature worktree, when the engine runs `git update-ref HEAD «recovery-head» «current-head»` there, then the branch moves to the recovery head.
- Given a prepared feature worktree that has fetched its remote branch and rewritten its history, when the engine's lease publication runs `git push origin HEAD:refs/heads/«branch» --force-with-lease`, then the remote branch moves to the local tip.
- Given a prepared feature worktree and its feature branch with a unique tip, when the engine's worktree cleanup runs `git branch -D «branch»` with the root checkout as its working directory, then the branch is deleted.

### Negative Paths

- Given a prepared feature worktree whose remote branch has advanced since its last fetch, when the engine's lease publication runs its bare `--force-with-lease` push, then git rejects it as stale and the hook's refusal text does not appear.
- Given a prepared feature worktree, when the engine runs `git branch -D «branch»` for a unique-tip branch with the feature worktree as its working directory, then the command exits non-zero and the branch still exists at the same tip.

### Done When

- [ ] A real-git test runs each engine ref operation listed above in a prepared worktree with the engine's argv and working directory and asserts it succeeds
- [ ] A real-git test asserts a unique-tip branch deletion succeeds from the root checkout and is refused from the prepared worktree

## Story 6: The hooks are provisioned and kept in place before every dispatch

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D11

As the harness operator, I want both hooks written at preparation and restored before each dispatch, so that a missing or altered hook cannot silently disable the backstop.

### Happy Path

- Given a fresh linked worktree, when `prepareWorktree` runs, then `.pipeline/git-hooks/reference-transaction` and `.pipeline/git-hooks/pre-push` exist with mode 0755 and contents equal to the engine's embedded hook assets.
- Given a prepared worktree whose `reference-transaction` or `pre-push` hook was deleted or edited, when a guarded dispatch is prepared for it, then the hook is rewritten to the embedded asset with mode 0755 before the provider is launched.

### Negative Paths

- Given a linked worktree whose `.pipeline/git-hooks` directory cannot be written, when `prepareWorktree` runs, then preparation fails with the existing preventive-hook installation error and no dispatch proceeds.
- Given a prepared worktree whose hook cannot be rewritten before dispatch, when a guarded dispatch is prepared for it, then the dispatch is not launched and the failure message names the hook path.
- Given the embedded hook assets, when the interpreter-source inventory check runs, then it reports no shell-expanded runtime data in either new hook.

### Done When

- [ ] A worktree-preparation test asserts both hook files exist with mode 0755 and contents equal to the exported assets
- [ ] A dispatch re-verification test asserts a deleted or edited hook is restored before launch and an unrestorable hook blocks the dispatch with a message naming its path
