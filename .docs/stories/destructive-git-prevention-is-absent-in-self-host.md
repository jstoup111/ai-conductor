**Status:** Accepted

# Stories: engine-owned destructive-git guard for every provider and run mode (#1354)

Technical track (no PRD). Acceptance is grounded in the APPROVED
`adr-2026-09-23-engine-git-guard-on-agent-path` (D1–D10) and the conditions C1–C5 in
`architecture-review-2026-09-23-destructive-git-prevention-is-absent-in-self-host`.

Terms used below:

- **Guarded agent shell:** a shell run by an agent dispatched by the daemon into an engine-prepared
  feature worktree.
- **Feature repository:** that worktree's repository, including its sibling worktrees and the root
  checkout.

## Story 1: Force pushes and hard resets are refused in the feature repository

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D5

As the harness operator, I want an agent's force push or hard reset in the feature repository refused before git runs, so that remote history and uncommitted work cannot be destroyed by accident.

### Happy Path

- **Given** a guarded agent shell in the feature worktree with a remote-tracking feature branch, **When** the agent runs `git push --force`, `git push -f`, or `git push origin +HEAD:«branch»`, **Then** the command exits non-zero without contacting the remote and the remote branch tip is unchanged.
- **Given** a guarded agent shell in the feature worktree with an uncommitted modification to a tracked file, **When** the agent runs `git reset --hard` or `git reset --hard HEAD~1`, **Then** the command exits non-zero, the modification is still present, and the branch tip is unchanged.

### Negative Paths

- **Given** a guarded agent shell in the feature worktree, **When** the agent runs `git push --force-with-lease` (alone or with `--force-if-includes`) or a plain `git push`, **Then** the push reaches the real git unchanged and its exit status and output are git's own.
- **Given** a guarded agent shell in the feature worktree, **When** the agent runs `git push --force-with-lease --force` (a lease option followed by a bare force), **Then** the command is refused because a lease option never excuses a bare force.
- **Given** a guarded agent shell in the feature worktree, **When** the agent runs `git reset --keep «target»`, `git reset --soft «target»`, or `git reset --mixed «target»`, **Then** the command reaches the real git unchanged.

### Done When

- [ ] A guard test drives each refused push/reset argv against a stub real git and asserts non-zero exit with zero stub calls
- [ ] A guard test asserts each lease/plain push and `--keep`/`--soft`/`--mixed` reset argv reaches the stub unchanged

## Story 2: Force-deleting a branch whose commits would be lost is refused

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D5

As the harness operator, I want an agent's force-delete refused when it would make commits unreachable, so that work reachable only from that branch is not lost.

### Happy Path

- **Given** a guarded agent shell and a local branch whose tip is not reachable from any other local branch or remote-tracking ref, **When** the agent runs `git branch -D «branch»` or `git branch --delete --force «branch»`, **Then** the command exits non-zero and the branch still exists at the same tip.

### Negative Paths

- **Given** a guarded agent shell and a local branch whose tip is reachable from another local branch or a remote-tracking ref (for example a smoke branch created at `HEAD`, or a branch merged into `origin/main` while local `main` lags), **When** the agent runs `git branch -D «branch»`, **Then** the deletion reaches the real git and the branch is deleted.
- **Given** a guarded agent shell, **When** the agent runs `git branch -d «branch»` on any branch, **Then** the command reaches the real git unchanged and git's own merged-branch check decides the outcome.
- **Given** a guarded agent shell and two named branches where only one tip is reachable from another ref, **When** the agent runs `git branch -D «reachable» «unreachable»`, **Then** the whole command is refused and both branches still exist.

### Done When

- [ ] A guard test in a scratch repository asserts `-D` of a branch with otherwise-unreachable commits leaves the ref at its original tip
- [ ] A guard test asserts `-D` of a branch reachable from another local or remote-tracking ref, and every `-d`, reach the real git

## Story 3: Forced cleans and working-tree path discards are refused

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D5

As the harness operator, I want forced cleans and path-scoped discards refused, so that untracked files and uncommitted edits, which have no commit to recover from, survive.

### Happy Path

- **Given** a guarded agent shell in the feature worktree with an untracked file, **When** the agent runs `git clean -f`, `git clean -fd`, `git clean -xdf`, or `git clean --force`, **Then** the command exits non-zero and the untracked file still exists.
- **Given** a guarded agent shell in the feature worktree with an uncommitted edit to a tracked file, **When** the agent runs `git checkout -- «file»`, `git checkout HEAD -- «file»`, `git checkout -- .`, `git restore «file»`, or `git restore .`, **Then** the command exits non-zero and the edit is still present.

### Negative Paths

- **Given** a guarded agent shell with a rebase or merge stopped on a conflicted file, **When** the agent runs `git checkout --theirs -- «file»`, `git checkout --ours -- «file»`, or `git restore --theirs «file»`, **Then** the command reaches the real git and the conflicted file takes the chosen side.
- **Given** a guarded agent shell, **When** the agent runs `git restore --staged «file»` or `git checkout «branch»` with no pathspec, **Then** the command reaches the real git unchanged.
- **Given** a guarded agent shell, **When** the agent runs `git clean -n` or `git clean --dry-run`, **Then** the command reaches the real git and lists what would be removed without removing anything.

### Done When

- [ ] A guard test in a scratch repository asserts each refused clean/discard form leaves the untracked file and tracked edit byte-identical
- [ ] A guard test with a stopped conflicted merge asserts `--ours`/`--theirs` checkout and restore resolve the file

## Story 4: Only the feature repository is guarded, and everything else passes through untouched

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D4

As a build agent, I want git to behave exactly as normal outside the destructive classes and outside the feature repository, so that test suites, fixtures, and ordinary git work are unaffected.

### Happy Path

- **Given** a guarded agent shell and a temporary repository outside the feature repository (for example a test fixture), **When** the agent or a test it runs executes `git reset --hard`, `git clean -fd`, or `git branch -D «branch»` in that repository, **Then** the command reaches the real git and takes effect.
- **Given** a guarded agent shell in the feature worktree, **When** the agent runs a non-destructive command such as `git status`, `git log -1`, `git diff`, `git commit`, or `git rebase --continue`, **Then** the output, exit status, and side effects are identical to running the real git directly.

### Negative Paths

- **Given** a guarded agent shell whose current directory is a temporary repository, **When** the agent runs `git -C «feature-worktree» reset --hard` or sets `GIT_DIR` to the feature repository's git directory, **Then** the command is refused because the target, not the current directory, decides the scope.
- **Given** a guarded agent shell in a sibling worktree or the root checkout of the feature repository, **When** the agent runs `git clean -f`, **Then** the command is refused.
- **Given** a feature repository whose git config defines a non-shell alias that expands to `reset --hard`, **When** the agent runs that alias in a guarded agent shell, **Then** the command is refused.

### Done When

- [ ] A guard test asserts destructive argv in a repository with a different git common dir reaches the real git and takes effect
- [ ] A guard test asserts `-C`, `GIT_DIR`, sibling-worktree and alias forms targeting the feature repository are refused

## Story 5: A refusal explains what was refused and the safe alternative

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D6

As a build agent, I want a refusal to tell me what was blocked and what to do instead, so that I can continue the task without operator help.

### Happy Path

- **Given** a guarded agent shell, **When** any refused command runs, **Then** it exits with a non-zero status, prints nothing to stdout, and writes to stderr one message naming the refused operation, why it is refused, and the safe alternative for that class (`--force-with-lease`, `reset --keep`, `branch -d`, `clean -n`, or commit a WIP / use a temporary worktree).

### Negative Paths

- **Given** a guarded agent shell, **When** a refused command runs, **Then** the real git is never invoked for that command, as a stub real git that records every call shows.
- **Given** a guarded agent shell, **When** an allowed command fails inside git (for example a push rejected as non-fast-forward), **Then** the message and exit status the agent sees are git's own, with no refusal text added.

### Done When

- [ ] A guard test asserts every refusal's stderr names the refused operation and its class's safe alternative, with empty stdout
- [ ] A guard test asserts a git-side failure of an allowed command surfaces git's own exit status and stderr unchanged

## Story 6: Every provider and run mode dispatches with the guard, without the operator's home

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D2

As the harness operator, I want the guard present for Claude and Codex in both self-host and non-self-host daemon runs, so that coverage never depends on inherited personal configuration.

### Happy Path

- **Given** an engine-prepared feature worktree and an empty operator home (no `~/.claude/settings.json`, no Codex config), **When** the daemon dispatches Claude non-self-host, Claude self-host, Codex non-self-host, and Codex self-host into that worktree, **Then** each child environment's `PATH` begins with that worktree's guard directory.
- **Given** a Codex dispatch into an engine-prepared worktree, **When** the engine builds the Codex invocation, **Then** the shell-environment policy passed to Codex carries the same guarded `PATH`.
- **Given** a contained build_review dispatch into an engine-prepared worktree, **When** the reviewer's shell resolves `git`, **Then** it resolves to the guard.

### Negative Paths

- **Given** a dispatch whose working directory is not an engine-prepared worktree (an interactive run or the root checkout), **When** the engine builds the child environment, **Then** `PATH` is unchanged and no guard directory is added.
- **Given** any guarded dispatch, **When** the engine builds the child environment, **Then** the daemon's own `process.env.PATH` is identical before and after, and the credential stripping and review allowlisting are unchanged.
- **Given** a model-fallback retry, an auxiliary dispatch, or a replacement-provider dispatch into an engine-prepared worktree, **When** the engine builds that child environment, **Then** its `PATH` begins with the guard directory, just like the initial dispatch.

### Done When

- [ ] An adapter test per provider × run-mode cell with an empty operator home asserts the child `PATH` begins with the worktree guard directory
- [ ] A Codex adapter test asserts the invocation carries the guarded `PATH` in its shell-environment policy
- [ ] An adapter test asserts a non-prepared working directory leaves `PATH` unchanged and the daemon `process.env.PATH` is never mutated
- [ ] A contained-review launch test asserts `git` resolves to the worktree guard inside the review containment profile

## Story 7: A missing or altered guard is restored before launch, or the dispatch does not launch

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D3

As the harness operator, I want the guard verified at every dispatch, so that a deleted or edited guard never silently falls through to the real git.

### Happy Path

- **Given** an engine-prepared worktree whose guard file was deleted, edited, or had its execute bit removed, **When** the next dispatch into that worktree is prepared, **Then** the guard is rewritten from the embedded asset with mode 0755 before the provider launches, and the dispatch proceeds guarded.
- **Given** a fresh worktree being prepared, **When** worktree preparation completes, **Then** the guard exists as a regular file (not a symlink) with mode 0755, and embeds the absolute path of a real git that is not itself the guard.

### Negative Paths

- **Given** an engine-prepared worktree whose guard cannot be rewritten (for example its directory is read-only), **When** a dispatch into it is prepared, **Then** the provider is not launched and the dispatch fails with a message naming the guard path.
- **Given** worktree preparation whose guard write fails, **When** preparation runs, **Then** preparation fails with a message naming the guard, instead of logging a skip and continuing.
- **Given** a daemon whose own `PATH` contains a `.pipeline/bin` directory, **When** the guard is written, **Then** the embedded real-git path does not point into any `.pipeline/bin` directory.

### Done When

- [ ] A dispatch-preparation test asserts a deleted, edited, or non-executable guard is rewritten 0755 from the embedded asset before launch
- [ ] A dispatch-preparation test asserts an unrewritable guard prevents launch with a failure naming the guard path
- [ ] A worktree-preparation test asserts a guard write failure fails preparation

## Story 8: Engine-driven history rewrites are unaffected

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D7

As the harness operator, I want the engine's own rebase, quarantine, shipped-record, spec-landing and setup-triage git work to behave exactly as today, so that the guard constrains agents only.

### Happy Path

- **Given** an engine-prepared worktree with the guard present, **When** the daemon runs its own git operations for rebase, quarantine, setup-triage reset or clean, and shipped-record refresh, **Then** they run against the real git and their outcomes are unchanged.
- **Given** a guarded agent shell, **When** the agent launches an engine CLI whose git use includes a `--force-with-lease` push (the draft-PR ship path), **Then** that push reaches the real git.

### Negative Paths

- **Given** a guarded agent shell, **When** the agent launches an engine CLI in the feature repository, **Then** every git argv that CLI issues today is classified as allowed by the guard, and a test fails if any is refused.
- **Given** the GitHub-operation production-boundary audit, **When** it runs over a tree containing the guard asset and its provisioning code, **Then** it reports no new remote-write finding for the guard.

### Done When

- [ ] A test asserts the known engine-CLI git argv set, including the draft-PR lease push, is classified as allowed
- [ ] The GitHub invocation audit test passes with the guard asset and provisioning code present

## Story 9: Text that describes a destructive command is not refused by the operator hook

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D8

As an operator or agent writing about destructive git, I want the operator's Claude hook to ignore commands quoted in heredoc bodies, so that filing an issue or writing docs is not blocked.

### Happy Path

- **Given** the operator hook, **When** it evaluates a command whose heredoc body (quoted or unquoted delimiter) contains `git reset --hard` or `git push --force`, **Then** it allows the command.

### Negative Paths

- **Given** the operator hook, **When** it evaluates a command where a heredoc is followed on a later line by an unquoted `git reset --hard`, **Then** it still refuses the command with exit 2.
- **Given** the operator hook, **When** it evaluates `git clean -f`, `git branch -D «unmerged»`, or `git checkout -- .` outside any heredoc or quoted span, **Then** it still refuses as before.

### Done When

- [ ] A hook test asserts heredoc bodies containing destructive commands are allowed
- [ ] A hook test asserts an unquoted destructive command after a heredoc and the existing refused forms still exit 2

## Story 10: The TDD counterfactual never discards build-worktree changes

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D9

As a build agent following the `tdd` skill, I want its pre-diff counterfactual check to run outside my build worktree, so that following the skill never triggers a guard refusal or loses uncommitted work.

### Happy Path

- **Given** the `tdd` skill, **When** its counterfactual step is read, **Then** it directs the agent to create a temporary detached worktree at the base commit, copy only the new or changed test files into it, run them there, and remove that worktree afterwards.

### Negative Paths

- **Given** the `tdd` skill, **When** its counterfactual step is read, **Then** it tells the agent neither to stash nor to check out, restore, or reset paths in any worktree, including the temporary one.

### Done When

- [ ] A skill-content test asserts the `tdd` counterfactual step names a temporary detached worktree at the base commit and copying test files into it, and names no stash, path checkout, restore, or reset

## Story 11: Live provider sessions resolve git to the guard

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D10

As the harness operator, I want proof from real provider sessions that agent shells use the guard, so that coverage is observed, not inferred.

### Happy Path

- **Given** a smoke file declaring `credentialed:claude` run with Claude credentials and binary available, **When** a real Claude session dispatched into an engine-prepared worktree runs `command -v git` and then `git clean -f`, **Then** `git` resolves to that worktree's guard and the clean is refused with the guard's message.
- **Given** a smoke file declaring `credentialed:codex` run with Codex credentials and binary available, **When** a real Codex session dispatched into an engine-prepared worktree runs `command -v git` and then `git clean -f`, **Then** `git` resolves to that worktree's guard and the clean is refused with the guard's message.

### Negative Paths

- **Given** an advisory-mode smoke run without a provider's credentials or binary, **When** that provider's guard smoke file runs, **Then** its case is reported as skipped with the missing prerequisite named, never as passed.
- **Given** a gate-mode smoke run that selects a provider's credentialed leg without that provider's credentials, **When** the guard smoke file runs, **Then** the run fails naming the missing credential and does not skip.
- **Given** the default (non-smoke) test suite, **When** it runs, **Then** no live provider session is started.

### Done When

- [ ] Two smoke files exist, one declaring `credentialed:claude` and one declaring `credentialed:codex`, each asserting guard resolution and a refused `git clean -f`
- [ ] The smoke-runner discovery test accepts both files; advisory mode skips with a named prerequisite, gate mode fails, and the default suite excludes both

## Story 12: A truthful report of a guard refusal is not refuted as a fabricated blocker

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D6

As a self-host build agent, I want a truthful report that the environment refused my force push to be accepted, so that the engine does not fail my attempt for describing the guard correctly.

### Happy Path

- **Given** a Claude self-host dispatch whose blocker text claims the environment refused `git push --force` (or `git push -f`), **When** the environment-claim audit evaluates that text, **Then** it does not refute the claim.

### Negative Paths

- **Given** a Claude self-host dispatch whose blocker text claims the environment blocks plain `git push` or `git push --force-with-lease`, **When** the environment-claim audit evaluates that text, **Then** it still refutes the claim as it does today.
- **Given** a Claude self-host dispatch whose blocker text claims the environment blocks `gh pr`, **When** the environment-claim audit evaluates that text, **Then** its verdict is unchanged from today.

### Done When

- [ ] An environment-claim audit test asserts a claimed bare-force-push blocker is not refuted while the guard is in force
- [ ] The existing environment-claim audit tests for plain `git push` and `gh` claims pass unchanged
