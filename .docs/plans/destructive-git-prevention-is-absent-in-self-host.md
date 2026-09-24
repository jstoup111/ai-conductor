# Implementation Plan: engine-owned destructive-git guard for every provider and run mode (#1354)

**Date:** 2026-09-23
**Design:** .docs/architecture/destructive-git-prevention-is-absent-in-self-host.md
**Stories:** .docs/stories/destructive-git-prevention-is-absent-in-self-host.md
**Conflict check:** Clean as of 2026-09-23
**Source:** jstoup111/ai-conductor#1354

## Summary

Seventeen tasks deliver an engine-generated `git` argv guard, provisioned fail-closed into every daemon-prepared worktree and prepended to the child `PATH` of every Claude and Codex dispatch in both run modes. It is re-verified before each dispatch. The same tasks fix the operator hook's heredoc false positive, align the `tdd` skill and the environment-claim audit, and prove coverage with unit, adapter, dispatch-shape, containment and live smoke tests.

## Technical Approach

- **Guard asset (ADR adr-2026-09-23-engine-git-guard-on-agent-path D1, D4–D6).** `GIT_GUARD_SCRIPT` is a static bash string exported from `src/conductor/src/engine/git-hook-assets.ts`, so the existing interpreter-source inventory (`check-interpreter-source.mts`) scans it automatically. Runtime values (the real-git path and the feature common dir) live in data files under `.pipeline/git-guard/`, never inside script source (#1478). Classification is argv-only, so descriptive text can never trip it. Git is consulted only for destructive-shaped argv (`rev-parse --git-common-dir`, `for-each-ref`, `merge-base --is-ancestor`, `config --get alias.*`).
- **Pattern basis.** The per-worktree preventive git-hook asset. Traits: embedded string constant, 0755 regular file under `.pipeline/`, fail-closed write inside `writeGitHooksAndWire`, idempotent rewrite. Rediscover via `PRE_COMMIT_HOOK`, `writeGitHooks`, `writeGitHooksAndWire`. The per-dispatch check follows `sessionHookNeedsRepair` (content plus `mode & 0o777`). Allowed variation: the guard is reached through `PATH`, not `core.hooksPath`.
- **Provisioning (D1, D3).** A new `src/conductor/src/engine/git-guard.ts` owns `resolveRealGit`, `writeGitGuard` and `ensureGitGuardForDispatch`. A directory counts as engine-prepared when its worktree-scoped `core.hooksPath` is its own `.pipeline/git-hooks`.
- **Enforcement point (D2).** Each adapter's `invoke` calls `ensureGitGuardForDispatch(options.cwd)` and prepends the returned directory with `withGitGuardPath` (`child-environment.ts`) as the last env step. Codex also gets `shell_environment_policy.set.PATH`. Every dispatch shape ends at `invoke`, and the daemon `process.env` is only read.
- **Around the guard.** Build-review containment mounts the guard read-only. The environment-claim audit recognises guard-refused force pushes (D6 amendment). The operator hook drops heredoc bodies (D8). The `tdd` counterfactual moves to a temporary worktree (D9). Live smoke files per provider prove `PATH` reach (D10).
- **Sequencing.** The guard script (1–5, serial because they share one file) comes first, then provisioning (6–7), then the adapters (8–9), then dispatch shapes and containment (10–11) and proofs (12, 16). Tasks 13–15 are independent. The release waiver (17) follows the hook edit.
- **Documentation.** The control-inventory update for intake outcome 2 and review condition C5 is routed to the documentation-maintenance step through the coherence waiver, not a plan task.

## Prerequisites

- None. Worktree preparation already provisions `.pipeline/git-hooks/` fail-closed (`writeGitHooksAndWire`).

## Tasks

### Task 1: Guard script: refuse bare force pushes and hard resets, pass everything else through
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-guard-script.test.ts`. Materialize `GIT_GUARD_SCRIPT` into a temp `.pipeline/bin/git`, write `.pipeline/git-guard/real-git` pointing at a recording stub git (appends argv to a log, exits with a configurable status), and write `.pipeline/git-guard/common-dir` as the scratch repository's absolute common dir. Cover the refused push/reset forms and the allowed forms listed in Done when. For state assertions use a real scratch repository with a bare remote, created under `tmpdir()` and never the harness checkout, so the test is harmless if the guard is absent (test-process-isolation rule).
2. Verify RED.
3. Implement `GIT_GUARD_SCRIPT` as a new string export in `src/conductor/src/engine/git-hook-assets.ts`, following the existing embedded hook-asset pattern: a static bash string with no interpolated runtime values (rediscover via `PRE_COMMIT_HOOK`, `COMMIT_MSG_HOOK`). The script reads the real-git path and feature common dir as data from `$(dirname "${BASH_SOURCE[0]}")/../git-guard/real-git` and `.../common-dir`. It classifies argv (skipping global options `-C`, `-c`, `--git-dir`, `--work-tree`, `--no-pager`) and `exec`s the real git for anything not refused. Refuse `push` carrying `--force`/`-f` or a `+`-prefixed refspec even beside `--force-with-lease`. Refuse `reset --hard`. `checkInventory` in `src/conductor/scripts/check-interpreter-source.mts` accepts any string export, so it needs no change.
4. Verify GREEN. Commit: "git guard: refuse bare force push and hard reset in the feature repo"

**Done when:**
- In the guard-script test, `push --force`, `push -f`, `push origin +HEAD:feature` and `push --force-with-lease --force` each exit non-zero with zero calls recorded by the stub real git, and in a scratch repository with a bare remote the remote branch tip is unchanged afterwards.
- In a scratch repository with an uncommitted edit to a tracked file, `reset --hard` and `reset --hard HEAD~1` through the guard exit non-zero, the edit is byte-identical afterwards, and `rev-parse HEAD` is unchanged.
- `push --force-with-lease`, `push --force-with-lease --force-if-includes`, plain `push`, `reset --keep`, `reset --soft` and `reset --mixed` reach the stub real git with byte-identical argv, and the guard returns the stub's exit status, stdout and stderr unchanged.
- The interpreter-source inventory test passes with `GIT_GUARD_SCRIPT` present as a string export of `git-hook-assets.ts`, with no finding reported for it.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** none

### Task 2: Guard script: refuse force-deleting a branch whose commits would become unreachable
**Story:** 2
**Type:** negative-path

**Steps:**
1. Add failing reachability tests to `git-guard-script.test.ts` using real scratch repositories under `tmpdir()`: a branch reachable from no other ref, a branch created at `HEAD`, a branch reachable only from `refs/remotes/origin/main` while local `main` lags, a mixed two-operand `-D`, and `-d` on merged and unmerged branches.
2. Verify RED.
3. Implement in `GIT_GUARD_SCRIPT`. For `branch -D`/`--delete --force` (and `-D` combined with other flags), refuse when any named branch's tip is not reachable from some other local branch or remote-tracking ref. Check with the real git: `for-each-ref --format='%(refname)' refs/heads refs/remotes` excluding the branch itself, then `merge-base --is-ancestor`. Refuse the whole command if any operand fails. Pass `-d` through untouched.
4. Verify GREEN. Commit: "git guard: refuse force-deleting branches with otherwise-unreachable commits"

**Done when:**
- In a scratch repository, `branch -D` and `branch --delete --force` of a branch whose tip is reachable from no other local branch or remote-tracking ref exit non-zero and `rev-parse` shows the branch at its original tip.
- `branch -D` of a branch created at `HEAD`, and of a branch reachable only from `refs/remotes/origin/main` while local `main` lags, reach the real git and the branch no longer exists, as asserted by the two reachability tests.
- `branch -d «branch»` reaches the real git with unchanged argv for both a merged and an unmerged branch, so git's own merged-branch check decides the outcome.
- `branch -D «reachable» «unreachable»` exits non-zero and both branches still exist, as asserted by the mixed-operand test.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** 1

### Task 3: Guard script: refuse forced cleans and working-tree path discards, allow conflict-side checkouts
**Story:** 3
**Type:** negative-path

**Steps:**
1. Add failing tests to `git-guard-script.test.ts` in scratch repositories: an untracked file under each forced-clean form; an uncommitted tracked edit under each discard form; a merge stopped on a conflicted file for the `--ours`/`--theirs` forms; and the allowed forms `restore --staged`, branch switch, `clean -n` and `clean --dry-run`.
2. Verify RED.
3. Implement in `GIT_GUARD_SCRIPT`. Refuse `clean` when any short-flag cluster contains `f` or `--force` appears. Refuse `checkout` with a `--` pathspec (with or without a tree-ish) unless `--ours`, `--theirs`, `--merge` or `-m` is present. Refuse `restore` unless it is `--staged`-only (no `--worktree`/`-W`) or carries `--ours`/`--theirs`/`--merge`.
4. Verify GREEN. Commit: "git guard: refuse forced clean and path discards"

**Done when:**
- In a scratch repository with an untracked file, `clean -f`, `clean -fd`, `clean -xdf` and `clean --force` through the guard exit non-zero and the untracked file still exists.
- With an uncommitted tracked edit, `checkout -- «file»`, `checkout HEAD -- «file»`, `checkout -- .`, `restore «file»` and `restore .` through the guard exit non-zero and the edit is byte-identical afterwards.
- With a merge stopped on a conflicted file, `checkout --theirs -- «file»`, `checkout --ours -- «file»` and `restore --theirs «file»` reach the real git and the file's content equals the chosen side.
- `restore --staged «file»`, `checkout «branch»` with no pathspec, `clean -n` and `clean --dry-run` reach the real git with unchanged argv, and `clean -n` prints the untracked path while the file still exists.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** 2

### Task 4: Guard script: scope refusals to the feature repository's common dir
**Story:** 4
**Type:** negative-path

**Steps:**
1. Add failing tests to `git-guard-script.test.ts`: a separate temporary repository with a different common dir; non-destructive commands compared byte-for-byte against the real git; `-C` and `GIT_DIR` retargeting from a temp repository; a sibling worktree (`git worktree add` inside the scratch feature repository); and a non-shell alias `alias.nuke=reset --hard` in the scratch repository's config.
2. Verify RED.
3. Implement in `GIT_GUARD_SCRIPT`. Only when argv is destructive-shaped, resolve the target's common dir with the real git (`rev-parse --path-format=absolute --git-common-dir`, passing through the invocation's `-C`, `--git-dir` and the inherited `GIT_DIR`). Compare it with the recorded common dir and refuse only on equality. Before classification, expand one level of a non-shell alias read with the real `git config --get alias.«name»`. Leave `!` aliases unexpanded.
4. Verify GREEN. Commit: "git guard: scope refusals to the feature repository"

**Done when:**
- In a temporary repository whose git common dir differs from the recorded feature common dir, `reset --hard`, `clean -fd` and `branch -D` through the guard reach the real git and take effect.
- `status`, `log -1`, `diff`, `commit` and `rebase --continue` through the guard produce stdout, stderr, exit status and resulting `HEAD` byte-identical to the real git run directly from the same repository state, as asserted by the pass-through equivalence test.
- From a temporary repository, `-C «feature-worktree» reset --hard` and `reset --hard` with `GIT_DIR` set to the feature repository's git dir exit non-zero, because the guard resolves the target's common dir via the real git's `rev-parse --git-common-dir` honouring `-C`, `--git-dir` and `GIT_DIR`.
- `clean -f` in a sibling worktree of the feature repository, and a non-shell alias expanding to `reset --hard` in the feature worktree, both exit non-zero, as asserted by the sibling-worktree and alias tests.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** 3

### Task 5: Guard script: every refusal names the operation, the reason and the safe alternative
**Story:** 5
**Type:** negative-path

**Steps:**
1. Add a table-driven failing test to `git-guard-script.test.ts` over every refused form from Tasks 1–4, asserting exit status, empty stdout, the stderr message fields, and zero stub invocations. Add a test where an allowed push is rejected by the stub with a non-fast-forward error.
2. Verify RED.
3. Implement in `GIT_GUARD_SCRIPT`: one `refuse` function printing a single line `ai-conductor git guard: refused «operation» — «reason». Safe alternative: «alternative».` to stderr and exiting 1. The alternatives per class: `git push --force-with-lease`, `git reset --keep «target»`, `git branch -d «branch»`, `git clean -n` then remove named paths, and "commit a WIP first or use a temporary worktree".
4. Verify GREEN. Commit: "git guard: explain each refusal with its safe alternative"

**Done when:**
- Every refused form from Tasks 1–4 exits with status 1, writes nothing to stdout, and writes one stderr message containing the refused operation, a reason, and its class's safe alternative (`--force-with-lease`, `reset --keep`, `branch -d`, `clean -n`, or commit a WIP / use a temporary worktree), as asserted by the table-driven refusal-message test.
- For every refused form the recording stub real git records zero invocations.
- An allowed `push` that the stub real git rejects with a non-fast-forward error surfaces the stub's exact stderr and exit status with no guard text added.

**Files likely touched:**
- `src/conductor/src/engine/git-hook-assets.ts`
- `src/conductor/test/engine/git-guard-script.test.ts`

**Dependencies:** 4

### Task 6: Provision the guard during worktree preparation, fail-closed
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/git-guard.test.ts` and extend `src/conductor/test/engine/worktree-prepare.test.ts`: after `prepareWorktree` on a scratch git worktree, assert the guard file, mode, content, and both data files; `resolveRealGit` with a `PATH` whose first entry is a `.pipeline/bin` holding a fake `git`; and a guard-write failure caused by occupying `.pipeline/bin` with a regular file.
2. Verify RED.
3. Implement `src/conductor/src/engine/git-guard.ts`. `resolveRealGit(pathEnv)` walks `PATH` in the daemon process, skipping any entry ending in `.pipeline/bin`, and returns the first executable `git`. `writeGitGuard(worktreePath)` writes `.pipeline/bin/git` (0755, regular file, content `GIT_GUARD_SCRIPT`) and the `.pipeline/git-guard/real-git` and `common-dir` data files. Call `writeGitGuard` from `writeGitHooks` in `worktree-prepare.ts`, inside the existing fail-closed `writeGitHooksAndWire` try-block, which rethrows as `preventive git hook installation failed` (precedent: adr-2026-08-07). The daemon's `process.env` is only read.
4. Verify GREEN. Commit: "worktree prepare: provision the git guard fail-closed"

**Done when:**
- After `prepareWorktree`, `.pipeline/bin/git` is a regular file (lstat not a symlink) with mode 0755 whose content equals `GIT_GUARD_SCRIPT`, and `.pipeline/git-guard/real-git` names an absolute executable git that is not under any `.pipeline/bin` directory, as asserted by the worktree-prepare guard test.
- `.pipeline/git-guard/common-dir` equals the prepared worktree's `git rev-parse --path-format=absolute --git-common-dir`, as asserted by the same test.
- `resolveRealGit` given a `PATH` whose first entry is a `.pipeline/bin` directory containing a `git` returns the next `git` on that `PATH`, as asserted by the resolution test.
- When the guard write fails because `.pipeline/bin` is occupied by a regular file, `prepareWorktree` rejects with an error naming `.pipeline/bin/git` and logs no `git hooks: skipped` line, as asserted by the provisioning-failure test.

**Files likely touched:**
- `src/conductor/src/engine/git-guard.ts`
- `src/conductor/src/engine/worktree-prepare.ts`
- `src/conductor/test/engine/git-guard.test.ts`
- `src/conductor/test/engine/worktree-prepare.test.ts`

**Dependencies:** 1

### Task 7: Verify and repair the guard before every dispatch, or refuse to launch
**Story:** 7
**Type:** negative-path

**Steps:**
1. Add failing tests to `git-guard.test.ts` for `ensureGitGuardForDispatch(cwd)`: deleted, edited, and chmod-0644 guards on a prepared worktree; a read-only `.pipeline/bin` with the guard missing; and an unprepared directory.
2. Verify RED.
3. Implement `ensureGitGuardForDispatch(cwd)` in `git-guard.ts`, following the `sessionHookNeedsRepair` pattern in `worktree-prepare.ts` (compare content and `mode & 0o777`, rewrite on mismatch, re-stat the real filesystem afterwards). A directory counts as prepared when its worktree-scoped `core.hooksPath` equals its own `.pipeline/git-hooks`. Return the `.pipeline/bin` path when prepared, or `null` when not prepared, without writing anything. Throw an error naming the guard path when the rewrite cannot be confirmed.
4. Verify GREEN. Commit: "git guard: verify and repair before every dispatch"

**Done when:**
- `ensureGitGuardForDispatch` on a prepared worktree whose guard was deleted, edited, or chmod 0644 rewrites it to `GIT_GUARD_SCRIPT` with mode 0755 and returns the worktree's `.pipeline/bin` path, as asserted by the three repair tests.
- `ensureGitGuardForDispatch` on a prepared worktree whose `.pipeline/bin` directory is read-only and whose guard is missing throws an error naming the guard path, as asserted by the unrewritable-guard test.
- `ensureGitGuardForDispatch` returns null and writes nothing for a directory whose worktree-scoped `core.hooksPath` is not its own `.pipeline/git-hooks`, as asserted by the unprepared-directory test.

**Files likely touched:**
- `src/conductor/src/engine/git-guard.ts`
- `src/conductor/test/engine/git-guard.test.ts`

**Dependencies:** 6

### Task 8: Prepend the guard to the Claude child PATH for prepared worktrees
**Story:** 6
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/claude-provider.test.ts` (captured spawn options, following the existing env tests there): non-self-host and self-host dispatches into a prepared scratch worktree with `HOME` set to an empty temp directory; an unprepared `cwd`; `process.env.PATH` before and after; the existing credential-strip and review-allowlist assertions plus the guarded `PATH`; and `ensureGitGuardForDispatch` throwing.
2. Verify RED.
3. Add `withGitGuardPath(env, guardDir)` to `src/conductor/src/execution/child-environment.ts`. It returns a copy of the env whose `PATH` is `guardDir` prepended, and never mutates its input. In `ClaudeProvider.invoke`, before building the env, call `ensureGitGuardForDispatch(options.cwd)`. If it throws, return a failed result whose output names the guard path, without spawning. If it returns a directory, apply `withGitGuardPath` as the last step of `buildEnv` in both the review and ordinary branches.
4. Verify GREEN. Commit: "claude provider: dispatch with the git guard on PATH"

**Done when:**
- `ClaudeProvider` invocation for non-self-host and self-host dispatches into a prepared worktree, with `HOME` pointing at an empty directory, passes a child env whose `PATH` begins with that worktree's `.pipeline/bin`, as asserted by the two Claude env-cell tests on the captured spawn options.
- A Claude dispatch whose `cwd` is an unprepared directory passes a child `PATH` equal to the inherited one, and `process.env.PATH` is identical before and after every guarded Claude dispatch, as asserted by the unprepared and no-bleed tests.
- A guarded Claude dispatch's child env still omits `CLAUDE_CODE_OAUTH_TOKEN` wherever it is stripped today, and the contained-review env still equals the allowlisted set with only `PATH` changed, as asserted by the existing credential and review-allowlist tests extended with the guarded `PATH`.
- When `ensureGitGuardForDispatch` throws, `ClaudeProvider.invoke` resolves a failed result whose output names the guard path and the recorded spawn function is never called.

**Files likely touched:**
- `src/conductor/src/execution/child-environment.ts`
- `src/conductor/src/execution/claude-provider.ts`
- `src/conductor/test/execution/claude-provider.test.ts`
- `src/conductor/test/execution/child-environment.test.ts`

**Dependencies:** 7

### Task 9: Prepend the guard to the Codex child PATH and its shell-environment policy
**Story:** 6
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/codex-provider.test.ts`: the two env cells with an empty `HOME`; an unprepared `cwd`; the existing review-allowlist test extended with the guarded `PATH`; the argv carrying `shell_environment_policy.set.PATH` for a guarded dispatch and not for an unguarded one; and `ensureGitGuardForDispatch` throwing.
2. Verify RED.
3. In `CodexProvider.invoke`, call `ensureGitGuardForDispatch(options.cwd)` exactly as Task 8 does. Apply `withGitGuardPath` to the overlay built by `invocationEnv`, computing the full `PATH` from the inherited `PATH` because execa merges the overlay over `process.env`. When guarded, append `--config`, `shell_environment_policy.set.PATH=«toml-string»` to the args builder, with the value rendered as a TOML basic string via `JSON.stringify`.
4. Verify GREEN. Commit: "codex provider: dispatch with the git guard on PATH"

**Done when:**
- `CodexProvider` invocation for non-self-host and self-host dispatches into a prepared worktree, with `HOME` pointing at an empty directory, passes a child env whose `PATH` begins with that worktree's `.pipeline/bin`, as asserted by the two Codex env-cell tests.
- The Codex argv for a guarded dispatch contains `--config` with `shell_environment_policy.set.PATH` equal to the guarded child `PATH`, and an unguarded dispatch's argv contains no `shell_environment_policy.set.PATH`, as asserted by the argv tests.
- When `ensureGitGuardForDispatch` throws, `CodexProvider.invoke` resolves a failed result naming the guard path without calling the spawn function, and `process.env.PATH` is unchanged after every Codex dispatch.
- A Codex dispatch whose `cwd` is an unprepared directory passes an env overlay with no `PATH` override, and a guarded Codex review-profile env still equals the allowlisted set with only `PATH` changed and no credential variable added, as asserted by the unprepared and review-allowlist tests.

**Files likely touched:**
- `src/conductor/src/execution/codex-provider.ts`
- `src/conductor/test/execution/codex-provider.test.ts`

**Dependencies:** 8

### Task 10: Every dispatch shape reaches the provider with the guarded PATH
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write a failing integration test `src/conductor/test/engine/git-guard-dispatch-shapes.test.ts`. It drives `executeProviderCandidates` (an initial dispatch, a model-fallback ladder rung, and a replacement-provider candidate) and `executeAuxiliaryProviderCandidates` with real `ClaudeProvider`/`CodexProvider` instances whose spawn function is a recorder, into a prepared scratch worktree.
2. Verify RED (expected to fail only if some shape bypasses the adapter's `invoke`).
3. Implement any missing wiring so every shape reaches the adapter's `invoke`, which is the single env-construction path per adr-2026-08-24-one-dispatch-member-on-the-provider-contract.
4. Verify GREEN. Commit: "git guard: cover every dispatch shape"

**Done when:**
- Through `executeProviderCandidates`, an initial dispatch, a model-fallback rung retry, and a replacement-provider candidate into a prepared worktree each reach the recorded spawn with a child `PATH` beginning with the guard directory, as asserted by the dispatch-shape integration test.
- Through `executeAuxiliaryProviderCandidates`, an auxiliary dispatch into a prepared worktree reaches the recorded spawn with a child `PATH` beginning with the guard directory.

**Files likely touched:**
- `src/conductor/test/engine/git-guard-dispatch-shapes.test.ts`
- `src/conductor/src/engine/provider-execution.ts`

**Dependencies:** 9

### Task 11: Contained build_review launches resolve git to the guard
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/build-review-containment.test.ts`, `composeReviewLaunchMounts` for a review source that is a prepared worktree; in the existing bwrap-gated containment test file, a contained launch that runs `command -v git`.
2. Verify RED.
3. In `composeReviewLaunchMounts` (`build-review-containment.ts`), when the review source is a prepared worktree, add read-only mounts for its `.pipeline/bin` and `.pipeline/git-guard` and for the real-git path recorded in `.pipeline/git-guard/real-git`. This keeps the read-only review role of adr-2026-09-10 D5 and widens no writable mount.
4. Verify GREEN. Commit: "build review containment: mount the git guard read-only"

**Done when:**
- `composeReviewLaunchMounts` for a review whose source is a prepared worktree includes the worktree's `.pipeline/bin` and `.pipeline/git-guard` and the recorded real-git path as read-only mounts and adds no writable mount, as asserted by the mount-composition test.
- In the bwrap-gated containment test, a contained review launch in a prepared worktree resolves `command -v git` to that worktree's `.pipeline/bin/git`, as asserted by the contained-review resolution test.

**Files likely touched:**
- `src/conductor/src/engine/build-review-containment.ts`
- `src/conductor/test/engine/build-review-containment.test.ts`

**Dependencies:** 8

### Task 12: Engine git and engine CLIs are unaffected; the GitHub invocation audit stays clean
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/git-guard-engine-unaffected.test.ts`. After a guarded dispatch, assert the daemon `process.env.PATH` and the engine git runner's resolved executable. Run a static inventory of the git argv issued by agent-launched engine CLIs (the draft-PR lease push in `ship-draft-pr.ts`, the `github-operation` push and named-remote delete forms, and `compose land`/`handoff` git calls) through the guard against a recording stub in a scratch feature worktree. Assert `auditShippedGithubInvocationBoundary` reports no finding for the guard files.
2. Verify they pass against Tasks 1–9 (this task delivers assertions, not production change). Where one fails, the defect belongs to the task that owns that behavior.
3. Commit: "git guard: prove engine git and engine CLIs are unaffected"

**Done when:**
- After a guarded dispatch, the daemon process's `PATH` contains no `.pipeline/bin` entry and the engine git runner used for rebase, quarantine, setup-triage reset/clean and shipped-record refresh resolves `git` to the same executable as before the dispatch, as asserted by the engine-git resolution test.
- Every git argv in the engine-CLI argv inventory test, including `push --force-with-lease` from the draft-PR ship path and the `github-operation` push and delete forms, reaches the stub real git when run through the guard in the feature worktree, and the test fails if any inventoried argv is refused.
- `auditShippedGithubInvocationBoundary` over the conductor source including `git-hook-assets.ts` and `git-guard.ts` reports no finding attributed to either file, as asserted by the audit test.

**Files likely touched:**
- `src/conductor/test/engine/git-guard-engine-unaffected.test.ts`

**Verify-only:** yes

**Dependencies:** 9

### Task 13: The environment-claim audit accepts a truthful guard-refused force-push report
**Story:** 12
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/environment-claim-audit.test.ts`: Claude self-host blocker text claiming the environment refused `git push --force` / `git push -f` is not refuted; plain `git push` and `git push --force-with-lease` claims are still refuted; `gh pr` verdicts are unchanged.
2. Verify RED.
3. In `auditEnvironmentBlockerClaims` (`self-host/environment-claim-audit.ts`), treat a claim whose named push form is a bare force push (`--force`/`-f` or a `+` refspec) as deniable by the engine git guard, so it is left alone. Update the module's header premise that the write fence is the only environmental control. Keep refuting every other `git push` claim.
4. Verify GREEN. Commit: "environment-claim audit: recognise guard-refused force pushes"

**Done when:**
- `auditEnvironmentBlockerClaims` given Claude self-host blocker text claiming the environment refused `git push --force` or `git push -f` returns no refutation, as asserted by the guard-refused-claim test.
- The same audit still refutes blocker text claiming plain `git push` or `git push --force-with-lease` is blocked, and its verdicts for `gh pr` claims are unchanged, as asserted by the existing claim-audit tests plus the new lease-claim case.

**Files likely touched:**
- `src/conductor/src/engine/self-host/environment-claim-audit.ts`
- `src/conductor/test/engine/environment-claim-audit.test.ts`

**Dependencies:** none

### Task 14: Operator hook ignores heredoc bodies but still refuses real commands
**Story:** 9
**Type:** negative-path

**Steps:**
1. Add failing cases to `src/conductor/test/engine/destructive-git-hook.test.ts`, keeping its PATH-stubbed `git`/`gh` harness: heredoc bodies with quoted and unquoted delimiters containing destructive text; a heredoc followed by an unquoted `git reset --hard`; and regression cases for `git clean -f`, `git branch -D` of an unmerged stub branch, and `git checkout -- .`.
2. Verify RED.
3. In `hooks/claude/block-destructive-git.sh`, extend the scannable-copy step to drop heredoc bodies. A body starts after a `<<`/`<<-` operator with an optionally quoted delimiter and ends at the line equal to that delimiter; scanning resumes after it. This stays compatible with #2159's compound-separator handling.
4. Verify GREEN. Commit: "block-destructive-git: ignore heredoc bodies"

**Done when:**
- `block-destructive-git.sh` exits 0 for a command whose heredoc body (quoted `<<'EOF'` and unquoted `<<EOF` delimiters) contains `git reset --hard` or `git push --force`, as asserted by the heredoc allow tests.
- `block-destructive-git.sh` exits 2 for a heredoc followed on a later line by an unquoted `git reset --hard`, and still exits 2 for unquoted `git clean -f`, `git branch -D «unmerged»` and `git checkout -- .`, as asserted by the post-heredoc and regression tests.

**Files likely touched:**
- `hooks/claude/block-destructive-git.sh`
- `src/conductor/test/engine/destructive-git-hook.test.ts`

**Dependencies:** none

### Task 15: TDD skill counterfactual runs in a temporary worktree with no discard
**Story:** 10
**Type:** negative-path

**Steps:**
1. Write a failing skill-content test `src/conductor/test/engine/tdd-counterfactual-skill.test.ts` that reads `skills/tdd/SKILL.md`, isolates the Pre-diff sensitivity check item, and asserts its required and forbidden phrases.
2. Verify RED.
3. Rewrite that item: create a temporary detached worktree at the base commit (`git worktree add --detach «tmp» «base»`), copy only the new or changed test files into it, run them there, then `git worktree remove --force «tmp»`. It must not tell the agent to stash, or to check out, restore or reset paths in any worktree.
4. Verify GREEN. Commit: "tdd skill: run the counterfactual in a temporary worktree"

**Done when:**
- The skill-content test asserts the `skills/tdd/SKILL.md` pre-diff sensitivity item names a temporary detached worktree at the base commit and copying the new or changed test files into it, then removing that worktree.
- The same test asserts the item contains none of `stash`, `checkout --`, `git restore`, or `reset`, so following it never discards paths in any worktree.

**Files likely touched:**
- `skills/tdd/SKILL.md`
- `src/conductor/test/engine/tdd-counterfactual-skill.test.ts`

**Dependencies:** none

### Task 16: Live smoke: real Claude and Codex sessions resolve git to the guard
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write `src/conductor/test/smoke/git-guard-claude.smoke.test.ts` (`const smokeCapability = 'credentialed:claude';`) and `src/conductor/test/smoke/git-guard-codex.smoke.test.ts` (`const smokeCapability = 'credentialed:codex';`). Each prepares a scratch worktree with `prepareWorktree` and dispatches a real provider session through the adapter, prompting it to run `command -v git` and then `git clean -f` and report both outputs. Skip handling follows the existing live-smoke precedent (`daemon-e2e-live-*.smoke.test.ts`).
2. Register both files in `src/conductor/test/structural/smoke-entry-point.test.ts` with their capabilities, and extend `src/conductor/test/engine/smoke-runner.test.ts` for the advisory-skip and gate-fail cases.
3. Run with `npm run smoke` where credentials exist. Commit: "smoke: live git-guard resolution for claude and codex"

**Done when:**
- `git-guard-claude.smoke.test.ts` declares `credentialed:claude` and, with Claude credentials and binary present, asserts a real Claude session's `command -v git` output equals the prepared worktree's `.pipeline/bin/git` and its `git clean -f` output contains the guard's refusal text.
- `git-guard-codex.smoke.test.ts` declares `credentialed:codex` and makes the same two assertions against a real Codex session.
- In advisory mode a guard smoke file lacking its credential or binary reports skipped naming the missing prerequisite, and in gate mode the smoke runner fails naming the missing credential, as asserted by the smoke-runner tests.
- The smoke-entry-point test lists both files with their capabilities and confirms the default `vitest` configuration excludes them.

**Files likely touched:**
- `src/conductor/test/smoke/git-guard-claude.smoke.test.ts`
- `src/conductor/test/smoke/git-guard-codex.smoke.test.ts`
- `src/conductor/test/structural/smoke-entry-point.test.ts`
- `src/conductor/test/engine/smoke-runner.test.ts`

**Dependencies:** 9

### Task 17: Release-gate waiver for the operator-hook content change
**Story:** 9
**Type:** infrastructure

**Steps:**
1. Write `.docs/release-waivers/destructive-git-prevention-is-absent-in-self-host.md` (the always-allowed `.docs/release-waivers/` prefix) in the same diff as Task 14.
2. Commit: "release waiver: block-destructive-git content-only change"

**Done when:**
- `.docs/release-waivers/destructive-git-prevention-is-absent-in-self-host.md` contains the line `Waives: hook wiring` and a non-empty `Rationale:` stating that the `block-destructive-git.sh` registration in `bin/install` is unchanged and only its scanner content changed.
- The `Waives:` line names no canonical surface other than `hook wiring`.

**Files likely touched:**
- `.docs/release-waivers/destructive-git-prevention-is-absent-in-self-host.md`

**Dependencies:** 14

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5
1 → 6 → 7 → 8 → 9 → 10
              8 → 11
              9 → 12
              9 → 16
13 (independent)
14 → 17
15 (independent)
```

## Integration Points

- After Task 5: the guard script is complete and testable standalone against scratch repositories.
- After Task 9: a real daemon dispatch on either provider runs with the guard on `PATH`.
- After Task 10: every dispatch shape is proven to reach the guarded env (cross-boundary owner for ADR D2).
- After Task 16: live sessions prove `PATH` reach on each provider (review condition C1).

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: **Given** a guarded agent shell in the feature worktree with a remote-tracking feature branch, **When** the agent runs `git push --force`, `git push -f`, or `git push origin +HEAD:«branch»`, **Then** the command exits non-zero without contacting the remote and the remote branch tip is unchanged. | 1 | "each exit non-zero with zero calls recorded by the stub real git, and in a scratch repository with a bare remote the remote branch tip is unchanged afterwards" | diff-local |
| Story 1 happy: **Given** a guarded agent shell in the feature worktree with an uncommitted modification to a tracked file, **When** the agent runs `git reset --hard` or `git reset --hard HEAD~1`, **Then** the command exits non-zero, the modification is still present, and the branch tip is unchanged. | 1 | "through the guard exit non-zero, the edit is byte-identical afterwards, and `rev-parse HEAD` is unchanged" | diff-local |
| Story 1 negative: **Given** a guarded agent shell in the feature worktree, **When** the agent runs `git push --force-with-lease` (alone or with `--force-if-includes`) or a plain `git push`, **Then** the push reaches the real git unchanged and its exit status and output are git's own. | 1 | "plain `push`, `reset --keep`, `reset --soft` and `reset --mixed` reach the stub real git with byte-identical argv, and the guard returns the stub's exit status, stdout and stderr unchanged" | diff-local |
| Story 1 negative: **Given** a guarded agent shell in the feature worktree, **When** the agent runs `git push --force-with-lease --force` (a lease option followed by a bare force), **Then** the command is refused because a lease option never excuses a bare force. | 1 | "`push --force-with-lease --force` each exit non-zero" | diff-local |
| Story 1 negative: **Given** a guarded agent shell in the feature worktree, **When** the agent runs `git reset --keep «target»`, `git reset --soft «target»`, or `git reset --mixed «target»`, **Then** the command reaches the real git unchanged. | 1 | "`reset --keep`, `reset --soft` and `reset --mixed` reach the stub real git with byte-identical argv" | diff-local |
| Story 2 happy: **Given** a guarded agent shell and a local branch whose tip is not reachable from any other local branch or remote-tracking ref, **When** the agent runs `git branch -D «branch»` or `git branch --delete --force «branch»`, **Then** the command exits non-zero and the branch still exists at the same tip. | 2 | "whose tip is reachable from no other local branch or remote-tracking ref exit non-zero and `rev-parse` shows the branch at its original tip" | diff-local |
| Story 2 negative: **Given** a guarded agent shell and a local branch whose tip is reachable from another local branch or a remote-tracking ref (for example a smoke branch created at `HEAD`, or a branch merged into `origin/main` while local `main` lags), **When** the agent runs `git branch -D «branch»`, **Then** the deletion reaches the real git and the branch is deleted. | 2 | "reach the real git and the branch no longer exists, as asserted by the two reachability tests" | diff-local |
| Story 2 negative: **Given** a guarded agent shell, **When** the agent runs `git branch -d «branch»` on any branch, **Then** the command reaches the real git unchanged and git's own merged-branch check decides the outcome. | 2 | "reaches the real git with unchanged argv for both a merged and an unmerged branch, so git's own merged-branch check decides the outcome" | diff-local |
| Story 2 negative: **Given** a guarded agent shell and two named branches where only one tip is reachable from another ref, **When** the agent runs `git branch -D «reachable» «unreachable»`, **Then** the whole command is refused and both branches still exist. | 2 | "`branch -D «reachable» «unreachable»` exits non-zero and both branches still exist" | diff-local |
| Story 3 happy: **Given** a guarded agent shell in the feature worktree with an untracked file, **When** the agent runs `git clean -f`, `git clean -fd`, `git clean -xdf`, or `git clean --force`, **Then** the command exits non-zero and the untracked file still exists. | 3 | "through the guard exit non-zero and the untracked file still exists" | diff-local |
| Story 3 happy: **Given** a guarded agent shell in the feature worktree with an uncommitted edit to a tracked file, **When** the agent runs `git checkout -- «file»`, `git checkout HEAD -- «file»`, `git checkout -- .`, `git restore «file»`, or `git restore .`, **Then** the command exits non-zero and the edit is still present. | 3 | "through the guard exit non-zero and the edit is byte-identical afterwards" | diff-local |
| Story 3 negative: **Given** a guarded agent shell with a rebase or merge stopped on a conflicted file, **When** the agent runs `git checkout --theirs -- «file»`, `git checkout --ours -- «file»`, or `git restore --theirs «file»`, **Then** the command reaches the real git and the conflicted file takes the chosen side. | 3 | "reach the real git and the file's content equals the chosen side" | diff-local |
| Story 3 negative: **Given** a guarded agent shell, **When** the agent runs `git restore --staged «file»` or `git checkout «branch»` with no pathspec, **Then** the command reaches the real git unchanged. | 3 | "`restore --staged «file»`, `checkout «branch»` with no pathspec" | diff-local |
| Story 3 negative: **Given** a guarded agent shell, **When** the agent runs `git clean -n` or `git clean --dry-run`, **Then** the command reaches the real git and lists what would be removed without removing anything. | 3 | "`clean -n` prints the untracked path while the file still exists" | diff-local |
| Story 4 happy: **Given** a guarded agent shell and a temporary repository outside the feature repository (for example a test fixture), **When** the agent or a test it runs executes `git reset --hard`, `git clean -fd`, or `git branch -D «branch»` in that repository, **Then** the command reaches the real git and takes effect. | 4 | "through the guard reach the real git and take effect" | diff-local |
| Story 4 happy: **Given** a guarded agent shell in the feature worktree, **When** the agent runs a non-destructive command such as `git status`, `git log -1`, `git diff`, `git commit`, or `git rebase --continue`, **Then** the output, exit status, and side effects are identical to running the real git directly. | 4 | "produce stdout, stderr, exit status and resulting `HEAD` byte-identical to the real git run directly from the same repository state" | diff-local |
| Story 4 negative: **Given** a guarded agent shell whose current directory is a temporary repository, **When** the agent runs `git -C «feature-worktree» reset --hard` or sets `GIT_DIR` to the feature repository's git directory, **Then** the command is refused because the target, not the current directory, decides the scope. | 4 | "`-C «feature-worktree» reset --hard` and `reset --hard` with `GIT_DIR` set to the feature repository's git dir exit non-zero" | diff-local |
| Story 4 negative: **Given** a guarded agent shell in a sibling worktree or the root checkout of the feature repository, **When** the agent runs `git clean -f`, **Then** the command is refused. | 4 | "`clean -f` in a sibling worktree of the feature repository" | diff-local |
| Story 4 negative: **Given** a feature repository whose git config defines a non-shell alias that expands to `reset --hard`, **When** the agent runs that alias in a guarded agent shell, **Then** the command is refused. | 4 | "a non-shell alias expanding to `reset --hard` in the feature worktree, both exit non-zero" | diff-local |
| Story 5 happy: **Given** a guarded agent shell, **When** any refused command runs, **Then** it exits with a non-zero status, prints nothing to stdout, and writes to stderr one message naming the refused operation, why it is refused, and the safe alternative for that class (`--force-with-lease`, `reset --keep`, `branch -d`, `clean -n`, or commit a WIP / use a temporary worktree). | 5 | "exits with status 1, writes nothing to stdout, and writes one stderr message containing the refused operation, a reason, and its class's safe alternative" | diff-local |
| Story 5 negative: **Given** a guarded agent shell, **When** a refused command runs, **Then** the real git is never invoked for that command, as a stub real git that records every call shows. | 5 | "For every refused form the recording stub real git records zero invocations." | diff-local |
| Story 5 negative: **Given** a guarded agent shell, **When** an allowed command fails inside git (for example a push rejected as non-fast-forward), **Then** the message and exit status the agent sees are git's own, with no refusal text added. | 5 | "surfaces the stub's exact stderr and exit status with no guard text added" | diff-local |
| Story 6 happy: **Given** an engine-prepared feature worktree and an empty operator home (no `~/.claude/settings.json`, no Codex config), **When** the daemon dispatches Claude non-self-host, Claude self-host, Codex non-self-host, and Codex self-host into that worktree, **Then** each child environment's `PATH` begins with that worktree's guard directory. | 8, 9 | "passes a child env whose `PATH` begins with that worktree's `.pipeline/bin`, as asserted by the two Claude env-cell tests" | diff-local |
| Story 6 happy: **Given** a Codex dispatch into an engine-prepared worktree, **When** the engine builds the Codex invocation, **Then** the shell-environment policy passed to Codex carries the same guarded `PATH`. | 9 | "contains `--config` with `shell_environment_policy.set.PATH` equal to the guarded child `PATH`" | diff-local |
| Story 6 happy: **Given** a contained build_review dispatch into an engine-prepared worktree, **When** the reviewer's shell resolves `git`, **Then** it resolves to the guard. | 11 | "resolves `command -v git` to that worktree's `.pipeline/bin/git`" | diff-local |
| Story 6 negative: **Given** a dispatch whose working directory is not an engine-prepared worktree (an interactive run or the root checkout), **When** the engine builds the child environment, **Then** `PATH` is unchanged and no guard directory is added. | 8, 9 | "passes a child `PATH` equal to the inherited one" | diff-local |
| Story 6 negative: **Given** any guarded dispatch, **When** the engine builds the child environment, **Then** the daemon's own `process.env.PATH` is identical before and after, and the credential stripping and review allowlisting are unchanged. | 8, 9 | "still omits `CLAUDE_CODE_OAUTH_TOKEN` wherever it is stripped today, and the contained-review env still equals the allowlisted set with only `PATH` changed" | diff-local |
| Story 6 negative: **Given** a model-fallback retry, an auxiliary dispatch, or a replacement-provider dispatch into an engine-prepared worktree, **When** the engine builds that child environment, **Then** its `PATH` begins with the guard directory, just like the initial dispatch. | 10 | "an initial dispatch, a model-fallback rung retry, and a replacement-provider candidate into a prepared worktree each reach the recorded spawn with a child `PATH` beginning with the guard directory" | diff-local |
| Story 7 happy: **Given** an engine-prepared worktree whose guard file was deleted, edited, or had its execute bit removed, **When** the next dispatch into that worktree is prepared, **Then** the guard is rewritten from the embedded asset with mode 0755 before the provider launches, and the dispatch proceeds guarded. | 7, 8 | "rewrites it to `GIT_GUARD_SCRIPT` with mode 0755 and returns the worktree's `.pipeline/bin` path" | diff-local |
| Story 7 happy: **Given** a fresh worktree being prepared, **When** worktree preparation completes, **Then** the guard exists as a regular file (not a symlink) with mode 0755, and embeds the absolute path of a real git that is not itself the guard. | 6 | "is a regular file (lstat not a symlink) with mode 0755 whose content equals `GIT_GUARD_SCRIPT`" | diff-local |
| Story 7 negative: **Given** an engine-prepared worktree whose guard cannot be rewritten (for example its directory is read-only), **When** a dispatch into it is prepared, **Then** the provider is not launched and the dispatch fails with a message naming the guard path. | 8, 9 | "resolves a failed result whose output names the guard path and the recorded spawn function is never called" | diff-local |
| Story 7 negative: **Given** worktree preparation whose guard write fails, **When** preparation runs, **Then** preparation fails with a message naming the guard, instead of logging a skip and continuing. | 6 | "`prepareWorktree` rejects with an error naming `.pipeline/bin/git` and logs no `git hooks: skipped` line" | diff-local |
| Story 7 negative: **Given** a daemon whose own `PATH` contains a `.pipeline/bin` directory, **When** the guard is written, **Then** the embedded real-git path does not point into any `.pipeline/bin` directory. | 6 | "returns the next `git` on that `PATH`" | diff-local |
| Story 8 happy: **Given** an engine-prepared worktree with the guard present, **When** the daemon runs its own git operations for rebase, quarantine, setup-triage reset or clean, and shipped-record refresh, **Then** they run against the real git and their outcomes are unchanged. | 12 | "resolves `git` to the same executable as before the dispatch" | diff-local |
| Story 8 happy: **Given** a guarded agent shell, **When** the agent launches an engine CLI whose git use includes a `--force-with-lease` push (the draft-PR ship path), **Then** that push reaches the real git. | 12 | "including `push --force-with-lease` from the draft-PR ship path" | diff-local |
| Story 8 negative: **Given** a guarded agent shell, **When** the agent launches an engine CLI in the feature repository, **Then** every git argv that CLI issues today is classified as allowed by the guard, and a test fails if any is refused. | 12 | "the test fails if any inventoried argv is refused" | diff-local |
| Story 8 negative: **Given** the GitHub-operation production-boundary audit, **When** it runs over a tree containing the guard asset and its provisioning code, **Then** it reports no new remote-write finding for the guard. | 12 | "reports no finding attributed to either file" | diff-local |
| Story 9 happy: **Given** the operator hook, **When** it evaluates a command whose heredoc body (quoted or unquoted delimiter) contains `git reset --hard` or `git push --force`, **Then** it allows the command. | 14 | "exits 0 for a command whose heredoc body" | diff-local |
| Story 9 negative: **Given** the operator hook, **When** it evaluates a command where a heredoc is followed on a later line by an unquoted `git reset --hard`, **Then** it still refuses the command with exit 2. | 14 | "exits 2 for a heredoc followed on a later line by an unquoted `git reset --hard`" | diff-local |
| Story 9 negative: **Given** the operator hook, **When** it evaluates `git clean -f`, `git branch -D «unmerged»`, or `git checkout -- .` outside any heredoc or quoted span, **Then** it still refuses as before. | 14 | "still exits 2 for unquoted `git clean -f`, `git branch -D «unmerged»` and `git checkout -- .`" | diff-local |
| Story 10 happy: **Given** the `tdd` skill, **When** its counterfactual step is read, **Then** it directs the agent to create a temporary detached worktree at the base commit, copy only the new or changed test files into it, run them there, and remove that worktree afterwards. | 15 | "names a temporary detached worktree at the base commit and copying the new or changed test files into it" | diff-local |
| Story 10 negative: **Given** the `tdd` skill, **When** its counterfactual step is read, **Then** it tells the agent neither to stash nor to check out, restore, or reset paths in any worktree, including the temporary one. | 15 | "contains none of `stash`, `checkout --`, `git restore`, or `reset`" | diff-local |
| Story 11 happy: **Given** a smoke file declaring `credentialed:claude` run with Claude credentials and binary available, **When** a real Claude session dispatched into an engine-prepared worktree runs `command -v git` and then `git clean -f`, **Then** `git` resolves to that worktree's guard and the clean is refused with the guard's message. | 16 | "asserts a real Claude session's `command -v git` output equals the prepared worktree's `.pipeline/bin/git` and its `git clean -f` output contains the guard's refusal text" | diff-local |
| Story 11 happy: **Given** a smoke file declaring `credentialed:codex` run with Codex credentials and binary available, **When** a real Codex session dispatched into an engine-prepared worktree runs `command -v git` and then `git clean -f`, **Then** `git` resolves to that worktree's guard and the clean is refused with the guard's message. | 16 | "makes the same two assertions against a real Codex session" | diff-local |
| Story 11 negative: **Given** an advisory-mode smoke run without a provider's credentials or binary, **When** that provider's guard smoke file runs, **Then** its case is reported as skipped with the missing prerequisite named, never as passed. | 16 | "reports skipped naming the missing prerequisite" | diff-local |
| Story 11 negative: **Given** a gate-mode smoke run that selects a provider's credentialed leg without that provider's credentials, **When** the guard smoke file runs, **Then** the run fails naming the missing credential and does not skip. | 16 | "in gate mode the smoke runner fails naming the missing credential" | diff-local |
| Story 11 negative: **Given** the default (non-smoke) test suite, **When** it runs, **Then** no live provider session is started. | 16 | "confirms the default `vitest` configuration excludes them" | diff-local |
| Story 12 happy: **Given** a Claude self-host dispatch whose blocker text claims the environment refused `git push --force` (or `git push -f`), **When** the environment-claim audit evaluates that text, **Then** it does not refute the claim. | 13 | "returns no refutation, as asserted by the guard-refused-claim test" | diff-local |
| Story 12 negative: **Given** a Claude self-host dispatch whose blocker text claims the environment blocks plain `git push` or `git push --force-with-lease`, **When** the environment-claim audit evaluates that text, **Then** it still refutes the claim as it does today. | 13 | "still refutes blocker text claiming plain `git push` or `git push --force-with-lease` is blocked" | diff-local |
| Story 12 negative: **Given** a Claude self-host dispatch whose blocker text claims the environment blocks `gh pr`, **When** the environment-claim audit evaluates that text, **Then** its verdict is unchanged from today. | 13 | "its verdicts for `gh pr` claims are unchanged" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-23-engine-git-guard-on-agent-path#D1 | task | task-6 | is a regular file (lstat not a symlink) with mode 0755 whose content equals `GIT_GUARD_SCRIPT` |
| adr-2026-09-23-engine-git-guard-on-agent-path#D2 | task | task-8, task-9, task-10 | passes a child env whose `PATH` begins with that worktree's `.pipeline/bin` |
| adr-2026-09-23-engine-git-guard-on-agent-path#D3 | task | task-7, task-8, task-9 | rewrites it to `GIT_GUARD_SCRIPT` with mode 0755 |
| adr-2026-09-23-engine-git-guard-on-agent-path#D4 | task | task-4 | resolves the target's common dir via the real git's `rev-parse --git-common-dir` |
| adr-2026-09-23-engine-git-guard-on-agent-path#D5 | task | task-2, task-1, task-3, task-4 | whose tip is reachable from no other local branch or remote-tracking ref exit non-zero |
| adr-2026-09-23-engine-git-guard-on-agent-path#D6 | task | task-5, task-13 | writes one stderr message containing the refused operation, a reason, and its class's safe alternative |
| adr-2026-09-23-engine-git-guard-on-agent-path#D7 | task | task-12 | the daemon process's `PATH` contains no `.pipeline/bin` entry |
| adr-2026-09-23-engine-git-guard-on-agent-path#D8 | task | task-14 | exits 0 for a command whose heredoc body |
| adr-2026-09-23-engine-git-guard-on-agent-path#D9 | task | task-15 | names a temporary detached worktree at the base commit |
| adr-2026-09-23-engine-git-guard-on-agent-path#D10 | task | task-16, task-8, task-9 | asserts a real Claude session's `command -v git` output equals the prepared worktree's `.pipeline/bin/git` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks naming its mechanism
- [x] Dependencies are explicit and acyclic
