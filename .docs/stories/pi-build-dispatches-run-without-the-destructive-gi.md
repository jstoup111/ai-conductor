**Status:** Accepted

# Stories: Pi build dispatches run without the destructive-git guard

Source: jstoup111/ai-conductor#3002. Also covers jstoup111/ai-conductor#2895 and
jstoup111/ai-conductor#2854 (operator decision: one spec for all three; close both when this ships).
Track: technical (no PRD). Tier: S.

Claude and Codex dispatches into an engine-prepared feature worktree run with the engine git guard
first on the child `PATH` (adr-2026-09-23-engine-git-guard-on-agent-path D2), are refused before
launch when the guard cannot be verified (D3), and report whether the guard was installed. Pi
dispatches do none of this today. These stories bring the Pi adapter to the same contract, keep the
same review exemption and the same unguarded-but-launching behavior outside prepared worktrees, and
add the Pi live guard proof D10 requires.

## Story 1: A Pi writable dispatch in a prepared worktree runs behind the git guard

**Requirement:** #3002 desired outcomes 1 and 3; #2895 desired outcomes 1 and 2; #2854 desired outcome 1

As an operator running Pi as a build provider, I want Pi's shell to resolve `git` to the engine
guard in the feature worktree, so that Pi cannot discard uncommitted work or rewrite history any
more than Claude or Codex can.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch that is not a review dispatch and whose working directory is an engine-prepared worktree, when the Pi adapter spawns Pi, then the child environment's `PATH` starts with that worktree's `.pipeline/bin` directory followed by the inherited `PATH` unchanged, and the dispatch result reports `gitGuardInstalled` as true.
- Given the child environment the Pi adapter built for that guarded dispatch, when a shell started with that environment in the worktree runs `command -v git` and then `git clean -f`, then `command -v git` prints `<worktree>/.pipeline/bin/git`, `git clean -f` exits non-zero with stderr containing `ai-conductor git guard: refused`, and the worktree's untracked file still exists.
- Given a guarded Pi dispatch that also carries a managed-session context, when the Pi adapter spawns Pi, then the worktree's `.pipeline/bin` directory is the first `PATH` entry, ahead of the managed-session `gh` wrapper directory, which is still present.
- Given a Pi dispatch result that reports `gitGuardInstalled` as true and whose output says the git guard refused a bare force push, when the environment-claim audit checks it for provider `pi`, then that force-push claim is not refuted.

#### Negative Paths
- Given a Pi dispatch that is not a review dispatch, in a prepared worktree whose guard is missing and cannot be rewritten because its `.pipeline/bin` directory is not writable, when the Pi adapter is invoked, then Pi is never spawned and the result is a failure with exit code 1 whose output names the guard path.

### Done When
- [ ] A Pi adapter test asserts the spawned child `PATH` for a prepared-worktree writable dispatch begins with the worktree's `.pipeline/bin`, keeps the inherited `PATH` after it, and the result carries `gitGuardInstalled: true`.
- [ ] A Pi adapter test runs `command -v git` and `git clean -f` in a fixture worktree with the adapter-built environment and observes the guard path and the `ai-conductor git guard: refused` refusal.
- [ ] A Pi adapter test asserts an unrepairable guard returns exit code 1 naming the guard path with zero subprocess spawns.

## Story 2: Pi review dispatches stay exempt from the git guard

**Requirement:** #3002 desired outcome 2; #2895 desired outcome 5

As an operator, I want Pi build-review dispatches to keep the same guard exemption Claude and Codex
reviews have, so that review behavior does not change and a review never fails on a guard it does
not use.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch marked by the engine as a review dispatch whose working directory is an engine-prepared worktree, when the Pi adapter spawns Pi, then no `.pipeline/bin` entry is added to the child `PATH`, the guard is neither verified nor repaired, and the dispatch result reports `gitGuardInstalled` as false.

#### Negative Paths
- Given a Pi review dispatch with a read-only review profile whose working directory is a prepared worktree whose guard is missing and cannot be rewritten, when the Pi adapter is invoked, then Pi is still spawned with no guard failure and its argv keeps the read-only tool restriction `read,grep,find,ls,git_read`.

### Done When
- [ ] A Pi adapter test asserts a review dispatch never consults guard verification, spawns with no `.pipeline/bin` `PATH` entry, and reports `gitGuardInstalled: false`.
- [ ] A Pi adapter test asserts a read-only review over an unrepairable guard still spawns with the unchanged read-only `--tools` value.

## Story 3: A Pi dispatch outside a prepared worktree launches unguarded and says so

**Requirement:** #3002 desired outcome 4; #2854 desired outcome 2

As an operator running Pi interactively or against an ordinary checkout, I want Pi to keep launching
where the engine prepared no guard, and to report honestly that it is unguarded, so that adding the
guard does not break dispatches it cannot protect.

### Acceptance Criteria

#### Happy Path
- Given a Pi dispatch whose working directory is not a git repository, when the Pi adapter is invoked, then Pi is spawned with no `.pipeline/bin` entry on the child `PATH` and the result reports `gitGuardInstalled` as false.
- Given a Pi dispatch whose working directory is a git repository that the engine never prepared, so its worktree-scoped `core.hooksPath` is not that directory's `.pipeline/git-hooks`, when the Pi adapter is invoked, then Pi is spawned with no `.pipeline/bin` entry on the child `PATH`, no guard file is written into that directory, and the result reports `gitGuardInstalled` as false.

#### Negative Paths
- Given a Pi dispatch whose working directory is a linked worktree the engine never prepared, so the repository does not enable worktree-scoped config, when the Pi adapter is invoked, then Pi is spawned without a guard verification failure and the result reports `gitGuardInstalled` as false.

### Done When
- [ ] Pi adapter tests assert the no-repository and unprepared-repository dispatches spawn with no `.pipeline/bin` `PATH` entry, write no `.pipeline/bin/git`, and report `gitGuardInstalled: false`.
- [ ] A Pi adapter test over a real linked worktree without worktree-scoped config asserts Pi is spawned and the result reports `gitGuardInstalled: false`.

## Story 4: An opt-in live smoke proves Pi's shell resolves git to the guard

**Requirement:** #2895 desired outcome 3

As a maintainer, I want a live Pi run to prove the guard is the `git` Pi's own shell tool resolves,
so that Pi coverage rests on observed Pi behavior rather than on the adapter's `PATH` alone.

### Acceptance Criteria

#### Happy Path
- Given `pi` is installed and the `credentialed:pi` smoke capability is available, when the Pi git guard live smoke dispatches Pi in a freshly prepared fixture worktree asking it to run `command -v git` and then `git clean -f`, then the first output line is `<worktree>/.pipeline/bin/git` and the output contains `ai-conductor git guard: refused`.

#### Negative Paths
- Given the default test command or the CI aggregate suite, when it runs, then the Pi git guard live smoke is not executed, and when the smoke file is run without `pi` installed or without its credential, then its suite is skipped rather than failed.

### Done When
- [ ] A Pi git guard smoke test exists under the smoke-only test path, declares the `credentialed:pi` capability, and asserts the guard path and refusal from a live Pi dispatch.
- [ ] The smoke skips when `pi` or its credential is absent and is excluded from the default test command.
