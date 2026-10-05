**Status:** Accepted

# Stories: fail-closed git option normalization for both destructive-git guards (#2904)

Technical track (no PRD). Acceptance is grounded in the APPROVED
`adr-2026-10-03-fail-closed-git-option-normalization` (D1–D8), which extends
`adr-2026-09-23-engine-git-guard-on-agent-path` D5 and D8, and in the conditions of
`architecture-review-2026-10-03-destructive-git-guard-parser-misses-valid-git-and-`.

Terms used below:

- **PATH guard:** the engine `git` wrapper at `«worktree»/.pipeline/bin/git`, driven in tests
  against a stub real `git` that records every call it receives.
- **Claude hook:** `hooks/claude/block-destructive-git.sh`, driven with a `PreToolUse` payload
  whose `tool_input.command` is the shell text. In tests, `git` and `gh` on its `PATH` are stubs
  that record each call.
- **Feature repository:** a repository whose git common directory equals the guard's recorded one.
- **Guarded subcommand:** `reset`, `branch`, `clean`, `push`, `checkout` or `restore`.
- **Refused (PATH guard):** exits non-zero, stderr names the operation, why, and the safe
  alternative, and the stub real `git` records no call to the refused subcommand.
- **Refused (Claude hook):** exits 2 with a message on stderr.
- **Unreachable branch:** a branch whose tip no other `refs/heads/` or `refs/remotes/` ref
  contains.

## Story 1: The PATH guard refuses every spelling git accepts for a refused form

**Requirement:** adr-2026-10-03-fail-closed-git-option-normalization D2, D4, D5

As the harness operator, I want the PATH guard to judge a command by what git will do, not how it
is spelled, so that an agent cannot run a refused operation by abbreviating or bundling its options.

### Acceptance Criteria

#### Happy Path
- Given the feature repository, when the PATH guard receives `reset --har` or `reset --ha HEAD~1`, then it is refused as a hard reset with `git reset --keep «target»` as the alternative.
- Given the feature repository and an unreachable branch, when the PATH guard receives `branch -df «branch»`, `branch -fd «branch»`, `branch -Dq «branch»` or `branch --del --force «branch»`, then each is refused as a force deletion that would make commits unreachable, with `git branch -d «branch»` as the alternative.
- Given the feature repository, when the PATH guard receives `clean --fo`, `clean --forc -d` or `clean -dxf`, then each is refused as a forced clean with `git clean -n` as the alternative.
- Given the feature repository, when the PATH guard receives `-C «repo» --no-pager reset --har` or `--config-env=core.pager=PAGER reset --ha`, then it is refused as a hard reset.
- Given the feature repository and a non-shell alias `nuke = reset --har`, when the PATH guard receives `nuke`, then it is refused as a hard reset.

#### Negative Paths
- Given the feature repository, when the PATH guard receives `reset --ke HEAD~1`, `reset --so HEAD~1` or `reset --mix`, then the stub real `git` receives the original argv unchanged and the guard exits with its status.
- Given the feature repository, when the PATH guard receives `push --force-with origin main` (a unique prefix of `--force-with-lease`), then the stub real `git` receives the original argv unchanged.
- Given the feature repository and a branch whose tip another local branch contains, when the PATH guard receives `branch -df «branch»`, then the stub real `git` receives the original argv unchanged.
- Given the feature repository, when the PATH guard receives `clean -nd` or `clean --dry`, then the stub real `git` receives the original argv unchanged.
- Given the feature repository, when the PATH guard receives `checkout -- --har` (a pathspec after `--`), then it is refused as a path checkout, not as a hard reset or an unrecognized option.
- Given a repository whose common directory differs from the recorded one, when the PATH guard receives `reset --har`, then the stub real `git` receives the original argv unchanged.

### Done When
- [ ] A PATH guard test drives every happy-path argv against the stub real `git` and asserts a non-zero exit, the operation-specific reason and alternative on stderr, and no recorded call to the refused subcommand
- [ ] A PATH guard test drives every negative-path argv and asserts the stub real `git` recorded the exact original argv

## Story 2: The PATH guard refuses what it cannot resolve

**Requirement:** adr-2026-10-03-fail-closed-git-option-normalization D2, D3

As the harness operator, I want a guarded subcommand with an option the guard cannot resolve to be
refused, so that a spelling nobody modeled becomes a false refusal instead of a bypass.

### Acceptance Criteria

#### Happy Path
- Given the feature repository, when the PATH guard receives `reset --bogus HEAD`, then it exits non-zero, stderr names `--bogus` as an unrecognized option for `git reset` and asks for the full option spelling, and the stub real `git` records no `reset` call.
- Given the feature repository, when the PATH guard receives `push --forc origin main` (ambiguous between `--force-with-lease` and `--force-if-includes`), then it is refused naming `--forc` as unrecognized or ambiguous, and the stub real `git` records no `push` call.
- Given the feature repository, when the PATH guard receives `branch -Z «branch»` (an unknown short letter), then it is refused naming `-Z`.
- Given the feature repository, when the PATH guard receives `--no-pag reset --hard` (git's global options do not abbreviate), then it is refused, and the stub real `git` records no `reset` call.

#### Negative Paths
- Given the feature repository, when the PATH guard receives `status --bogus` or `log --ha`, then the stub real `git` receives the original argv unchanged (not a guarded subcommand).
- Given the feature repository, when the PATH guard receives `push -u origin feature`, `branch -vv`, `checkout -b feature`, `restore --staged file` or `reset --soft HEAD~1`, then the stub real `git` receives the original argv unchanged.
- Given the feature repository, when the PATH guard receives `--no-pag status`, then the stub real `git` receives the original argv unchanged.
- Given a repository whose common directory differs from the recorded one, when the PATH guard receives `reset --bogus`, then the stub real `git` receives the original argv unchanged.
- Given the feature repository, when the PATH guard refuses an unrecognized option, then the only calls the stub real `git` recorded are read-only classification queries (`config`, `rev-parse`, `for-each-ref`, `merge-base`).

### Done When
- [ ] A PATH guard test asserts each unresolvable case exits non-zero, names the offending token on stderr, and records no call to the guarded subcommand
- [ ] A PATH guard test asserts each negative-path argv reaches the stub real `git` unchanged

## Story 3: The Claude hook refuses refused forms however git is invoked in the command

**Requirement:** adr-2026-10-03-fail-closed-git-option-normalization D4, D6

As an operator using Claude Code, I want the hook to judge each git invocation in a shell command by
its normalized arguments, so that global options, bundled flags and abbreviations no longer slip
past it.

### Acceptance Criteria

#### Happy Path
- Given the Claude hook, when the command is `git -C /tmp/x reset --hard`, `git -C "my dir" reset --hard`, `git -c a=b push --force`, `git --config-env=a.b=C reset --hard` or `git --git-dir=.git reset --hard`, then the hook exits 2.
- Given the Claude hook, when the command is `git reset --har`, `git clean -xdf`, `git clean --fo` or `git push origin +main`, then the hook exits 2.
- Given the Claude hook, when the command is `cd repo && git -C . reset --hard` or `make build; git clean -fd & wait`, then the hook exits 2.
- Given the Claude hook, when the command is `GIT_TRACE=1 git reset --hard`, `sudo git reset --hard` or `xargs git clean -f`, then the hook exits 2.
- Given the Claude hook and a branch that is not merged, when the command is `git branch -df «branch»` or `git -C . branch --delete --force «branch»`, then the hook exits 2 naming the unmerged branch.

#### Negative Paths
- Given the Claude hook, when `reset --hard` appears only inside a quoted argument (`git commit -m "undo reset --hard"`), a heredoc body, or a comment (`# git reset --hard`), then the hook exits 0.
- Given the Claude hook, when the command is `git push --force-with-lease origin main` or `git -C . push --force-with origin main`, then the hook exits 0.
- Given the Claude hook and a branch that is merged into the default branch, when the command is `git branch -df «branch»`, then the hook exits 0.
- Given the Claude hook, when the command is `git status`, `git -C . log --oneline` or `git reset --soft HEAD~1`, then the hook exits 0, and the `git` and `gh` stubs record no call.
- Given the Claude hook, when the command spells a heredoc delimiter `<<\EOF` or `<<E"OF"`, or opens one only inside a comment (`# <<EOF`), and a later line runs `git reset --hard`, then the hook exits 2.

### Done When
- [ ] A hook test drives every happy-path command and asserts exit 2
- [ ] A hook test drives every negative-path command and asserts exit 0, and for non-`branch` commands asserts the `git` and `gh` stubs recorded no call

## Story 4: The Claude hook refuses what it cannot resolve

**Requirement:** adr-2026-10-03-fail-closed-git-option-normalization D3, D6

As an operator using Claude Code, I want the hook to fail closed on a git invocation it cannot
resolve, so that it never waves through a destructive command it misread.

### Acceptance Criteria

#### Happy Path
- Given the Claude hook, when the command is `git reset --bogus` or `git push --forc origin main`, then the hook exits 2 and stderr names the offending token and asks for the full option spelling.
- Given the Claude hook, when the command is `git --unknown-global reset HEAD`, then the hook exits 2 and stderr names `--unknown-global`.
- Given the Claude hook, when the command contains a `git` word and cannot be split into words (for example an unterminated quote: `git reset "--hard`), then the hook exits 2 and stderr says the command could not be parsed.

#### Negative Paths
- Given the Claude hook, when the command is `git status --bogus` or `git --unknown-global status`, then the hook exits 0 (no guarded subcommand).
- Given the Claude hook, when the command cannot be split into words but contains no `git` word (`echo "unterminated`), then the hook exits 0.
- Given the Claude hook, when it refuses an unresolvable command, then the `git` and `gh` stubs record no call.

### Done When
- [ ] A hook test asserts each unresolvable case exits 2 with the offending token or the parse failure named on stderr, and no `git` or `gh` stub call
- [ ] A hook test asserts each negative-path case exits 0

## Story 5: One corpus, one spec, and drift detection keep the two guards in agreement

**Requirement:** adr-2026-10-03-fail-closed-git-option-normalization D1, D7

As the harness maintainer, I want both guards proven against the same cases and the same option
spec, so that a fix to one guard cannot leave the other behind.

### Acceptance Criteria

#### Happy Path
- Given the committed corpus fixture, where each case declares a separate expected outcome for the PATH guard and for the Claude hook (`refuse`, `allow`, or `not-applicable`), when the PATH guard suite and the Claude hook suite run, then each suite runs every case and every outcome matches its declared expectation for that guard.
- Given a corpus case that only varies the spelling of a form both guards refuse (an abbreviation, a bundled flag, a global-option prefix), when the corpus schema test reads it, then its PATH guard and Claude hook expectations are both `refuse`; the guards' expectations differ only for a form whose policy differs between them (the hook's merged-branch rule for `branch -D`, and the hook refusing only `checkout -- .` and `restore .`).
- Given the corpus fixture, when the corpus presence test reads it, then it contains every spelling named in #2904, the earlier #1354 lap spellings (`--git-dir=` equals form, quoted alias text, multiple and spaced quoted heredocs, quoted heredoc openers), and each residual bypass the architecture review lists (`reset --har`, `branch -df`, `branch --delete --forc`, global-option prefixes, `clean -xdf`, `push origin +main`).
- Given the hook's embedded spec equals the TypeScript spec, when the parity test runs, then it passes.
- Given every long option that `git «cmd» --git-completion-helper` lists for each guarded subcommand is in the spec, when the drift test runs, then it passes.

#### Negative Paths
- Given the hook's embedded spec lacks one option the TypeScript spec has, when the parity test runs, then it fails naming the subcommand and option.
- Given the completion helper lists an option the spec lacks, when the drift test runs, then it fails naming the subcommand and option.
- Given the spec holds an option the helper does not list (`--force` for `clean` or `branch`), when the drift test runs, then it passes.
- Given a corpus case is a shell-only form with no PATH-guard meaning (a heredoc or a comment), when the PATH guard suite runs, then that case is skipped because its PATH guard expectation is `not-applicable`, never by an unlisted exclusion.

### Done When
- [ ] One committed corpus fixture with per-guard expectations is read by both guard suites, and each suite fails if it skips a case whose expectation for that guard is not `not-applicable`
- [ ] A parity test and a drift test exist and each fails with the subcommand and option named when its invariant is broken

## Story 6: The existing refusal matrix and its messages do not change

**Requirement:** adr-2026-09-23-engine-git-guard-on-agent-path D5, D6; adr-2026-10-03-fail-closed-git-option-normalization D4

As the harness operator, I want every canonical refusal and allowance to behave as it does today, so
that hardening the parser changes no decision already made.

### Acceptance Criteria

#### Happy Path
- Given the feature repository, when the PATH guard receives each canonical refused form (`push --force`, `push -f`, `push origin +main`, `reset --hard`, `branch -D «unreachable»`, `branch --delete --force «unreachable»`, `clean -f`, `checkout -- «file»`, `restore «file»`), then it is refused with the same reason and alternative text as before this change.
- Given the Claude hook, when the command is each canonical refused form, then it exits 2 with the same message as before this change.

#### Negative Paths
- Given the feature repository, when the PATH guard receives `push --force-with-lease --force-if-includes`, `reset --keep`, `branch -d «branch»`, `clean -n`, `checkout --ours -- «file»` or `restore --staged «file»`, then the stub real `git` receives the original argv unchanged.
- Given the Claude hook, when the command is `git rebase --continue`, then it exits 0 with no note, and when it is `git rebase main`, then it exits 0 with the existing non-blocking rebase note.
- Given the feature repository, when the PATH guard receives `reset --hard --soft` (git applies the last mode), then it is still refused as a hard reset.

### Done When
- [ ] Existing refusal-message assertions in the PATH guard and hook suites pass unchanged
- [ ] A test asserts each canonical allowed form reaches the stub real `git` (PATH guard) or exits 0 (hook)
