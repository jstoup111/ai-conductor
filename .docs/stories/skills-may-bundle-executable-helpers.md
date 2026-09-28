**Status:** Accepted

# Stories: Skills may bundle executable helpers (#742)

## Story 1: The intake helper files from whatever repository the operator is in

**Requirement:** Technical intent TI-1 — the migrated intake helper is invoked by its skill-directory path and acts on the caller's working directory (ADR D3, D5, D7).

As an operator filing an intake issue from any repository, I want the intake skill's helper to run from its own skill directory and act on my current repository so that filing works outside the harness checkout and never lands in the wrong repository.

### Acceptance Criteria

#### Happy Path

- Given a working directory that is a repository other than the harness and the intake skill installed through a whole-directory symlink, when the helper is run by its path inside that installed skill directory, then the engine's intake-file entry point runs with that same working directory.
- Given the helper is run from a foreign working directory without an explicit repository argument, when the entry point resolves the filing repository, then it resolves the repository of the caller's working directory rather than the harness repository.
- Given the helper is run with a title, a body, a size, a priority, and a dependency argument, when it hands off to the entry point, then every argument arrives unchanged and in the original order.

#### Negative Paths

- Given the helper is run without the required title argument, when the entry point rejects the arguments, then the helper exits with the entry point's non-zero status and prints the entry point's own error, and no issue is filed.
- Given the entry point exits non-zero after an issue-create failure, when the helper returns, then its exit status equals the entry point's status rather than zero.
- Given the helper is invoked through a relative path from a directory that is neither the harness nor the skill directory, when it starts, then it still locates the engine and does not change the caller's working directory.

### Done When

- [ ] A test runs `skills/intake/scripts/intake-file` from a temporary repository with a stubbed engine entry point and asserts the stub observed the temporary repository as its working directory and received the arguments verbatim.
- [ ] A test asserts the helper's exit status equals a stubbed entry point's non-zero status.
- [ ] `skills/intake/SKILL.md` directs the filing step to `scripts/intake-file` relative to the skill's own directory, and names how each supported host supplies that directory (Claude's injected base directory, the directory of the `SKILL.md` path Codex lists).

## Story 2: The helper locates the harness engine deterministically and never guesses

**Requirement:** Technical intent TI-2 — harness-root resolution walks the helper's physical ancestors for a directory holding both the engine entry point and the engine's installed runner, falls back to the `ai-conductor` found on `PATH`, and otherwise fails with a named error (ADR D4).

As an operator running the helper from an installed, sandboxed, or self-host provider-home copy of the skill, I want the helper to find a real, runnable harness engine or stop with a clear message so that it never runs code from an unverified location.

### Acceptance Criteria

#### Happy Path

- Given the helper is reached through a symlinked skill directory whose target is inside a harness checkout with the engine entry point and its installed runner, when it resolves the harness root, then it uses that checkout.
- Given a copy of the skill directory sits several levels beneath a harness checkout that has the engine entry point and its installed runner (as a self-host provider-home copy sits beneath its worktree), when the helper resolves the harness root, then it uses that nearest qualifying ancestor.
- Given the helper's physical location has no qualifying ancestor and an `ai-conductor` on `PATH` whose physical location is inside a qualifying harness checkout, when it resolves the harness root, then it uses that checkout.

#### Negative Paths

- Given no ancestor of the helper qualifies and no `ai-conductor` on `PATH` leads to a qualifying checkout, when the helper runs, then it exits non-zero with a message naming the path it walked from and the `PATH` result, and no engine code runs.
- Given no ancestor of the helper qualifies and no `ai-conductor` is on `PATH`, when the helper runs, then it exits non-zero with a message stating that no `ai-conductor` was found on `PATH`, and no engine code runs.
- Given the nearest ancestor holds the engine entry point but no installed runner (as a worktree without dependencies does) and a further ancestor holds both, when the helper resolves the harness root, then it skips the nearer one and uses the further ancestor.
- Given the `ai-conductor` on `PATH` is itself a symlink in a bin directory outside the harness, when the fallback resolves it, then it follows the link to the physical harness location rather than treating the bin directory's parent as the harness root.

### Done When

- [ ] A test places a copy of the helper several directories beneath a fixture harness with a stubbed entry point and runner, and asserts the fixture's stub ran.
- [ ] A test with a nearer ancestor lacking the runner and a further ancestor holding both asserts the further ancestor's stub ran and the nearer one's did not.
- [ ] A test with no qualifying ancestor and a stub `ai-conductor` symlink on `PATH` pointing into a fixture harness asserts that fixture's stub ran.
- [ ] A test with no qualifying location anywhere asserts a non-zero exit, a message naming both resolution attempts, and that no stub ran.

## Story 3: Bundled skill helpers are inside the repository's shell validation

**Requirement:** Technical intent TI-3 — the shell-lint enumeration (and therefore integrity check 1's syntax check) and the interpreter-source inventory cover shell-shebang files under `skills/*/scripts/` (ADR D6).

As a harness maintainer, I want every bundled helper linted and syntax-checked like the scripts in `bin/` so that a broken helper fails the repository's validation instead of failing on an operator's machine.

### Acceptance Criteria

#### Happy Path

- Given the repository contains `skills/intake/scripts/intake-file` with a bash shebang, when the shell-lint enumeration is listed, then that path appears in the list.
- Given a bash-shebang file exists under any `skills/<name>/scripts/` directory, when the shell-lint enumeration is listed, then it appears alongside the existing `bin/`, `hooks/`, `test/`, and `.github/scripts/` entries, all of which are still present.
- Given the enumeration-pinning test runs against the repository, when it compares the listed surface, then it asserts the `skills/*/scripts/` surface is included.
- Given the repository contains `skills/intake/scripts/intake-file`, when the interpreter-source inventory is built, then that path is among the checked shell assets alongside every `bin/` and `hooks/` shell file.

#### Negative Paths

- Given a file under `skills/<name>/scripts/` contains a bash syntax error, when integrity check 1 runs over the enumerated list, then that check fails and names the file.
- Given a skill directory contains Markdown or YAML files outside `scripts/`, such as `SKILL.md`, `references/*.md`, or `agents/openai.yaml`, when the enumeration is listed, then none of those files appear.
- Given a file under `skills/<name>/scripts/` has no bash or sh shebang, when the enumeration is listed, then it does not appear.
- Given a bundled helper path is listed as a declared exclusion, when the enumeration is listed, then it does not appear, as with any other declared exclusion.
- Given a bundled helper under `skills/<name>/scripts/` invokes an interpreter in a form the interpreter-source check rejects, when that check runs, then it reports a finding naming the helper's path.

### Done When

- [ ] `test/lint_shell.sh --list` output includes `skills/intake/scripts/intake-file`.
- [ ] `test/test_lint_shell_enumeration.sh` asserts the `skills/*/scripts/` surface, and it fails against the pre-change enumeration.
- [ ] A fixture-based test asserts a syntax-broken bundled helper fails the syntax check, and that non-shebang and Markdown files under a skill directory are not enumerated.
- [ ] An interpreter-source inventory test asserts a fixture helper under `skills/<name>/scripts/` is checked and a rejected interpreter form in it is reported by path.

## Story 4: Bundled helpers stay executable wherever the skill is materialized

**Requirement:** Technical intent TI-4 — the existing whole-directory install and the self-host provider-home copy carry bundled helpers with their executable mode (ADR D1).

As an operator on either supported host, and as a self-host build, I want a bundled helper to be present and executable wherever the skill is discovered so that the skill's instruction to run it never meets a missing or non-executable file.

### Acceptance Criteria

#### Happy Path

- Given the harness is installed into a temporary home, when the installed intake skill directory is inspected in both the Claude and the Codex discovery homes, then `scripts/intake-file` is present through the link and executable.
- Given a self-host provider home is materialized from a worktree containing the bundled helper, when the copied skills are inspected, then `intake/scripts/intake-file` is present with its executable mode preserved.

#### Negative Paths

- Given the harness is installed with the bundled helper present, when install freshness is checked, then the intake skill is not reported as stale or drifted because of its `scripts/` contents.
- Given a self-host provider home prunes operator-only skills from its copy, when the copied skills are inspected, then the intake skill and its helper are not pruned.

### Done When

- [ ] An install test in a temporary home asserts the helper is executable through both discovery-home links.
- [ ] A provider-home materialization test asserts the copied helper keeps mode 0755.
- [ ] An install freshness check over a temporary home with the bundled helper reports the intake skill as fresh.
