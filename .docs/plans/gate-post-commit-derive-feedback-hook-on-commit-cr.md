# Implementation Plan: Gate the post-commit derive-feedback hook on commit-creating Bash commands

**Date:** 2026-09-06
**Stories:** .docs/stories/gate-post-commit-derive-feedback-hook-on-commit-cr.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the slice adds two early exits ahead of an existing advisory hook's unchanged body and touches no shared contract — the settings wiring, matcher, timeout, engine subcommand, warning text, bash fallback, and engine-override environment variable all keep their current behaviour.

## Summary

Four bounded tasks deliver #2162. The hook learns which Bash command the host just ran and returns immediately unless that command could create a commit, then confirms HEAD is a freshly created commit before spending the engine call. A payload the hook cannot read leaves today's behaviour exactly as it is. The hook's settings wiring, its engine contract, its bash fallback, and the integrity-suite wiring of its test script are all outside this slice.

## Technical Approach

Read the tool payload with the bounded pattern the sibling documentation guard already uses — `timeout` around a byte-capped `head`, discarding errors — so a host that holds the hook's standard input open can never hang a session and an empty or partial read simply falls through. Extract `tool_input.command` with the same one-line `python3` expression the destructive-git guard uses, and build the same "scannable" copy of that command by deleting single- and double-quoted spans, so a commit-creating phrase that appears only inside a commit message, an `echo`, or a comment does not trigger the gate.

Classify the scannable copy by splitting it on unquoted `;`, `|`, and `&` and asking whether any resulting segment is a `git` invocation whose subcommand can create a commit: `commit`, `merge`, `revert`, `cherry-pick`, `am`, or `rebase`. Options and path operands may sit between `git` and its subcommand, so `git -C <path> commit` classifies correctly; a token that merely ends in the subcommand word, such as a branch named for a commit, does not. When no segment classifies, exit 0 before the hook touches Git at all — that is the entire latency fix, and it costs one bounded read plus one interpreter start.

Both unclassifiable directions resolve toward today's behaviour, never toward silence. An empty read, a payload that is not JSON, and a payload with no command field all yield an empty command, and an empty command falls through to the existing evaluation. That keeps the hook useful when a host delivers no payload, keeps every pre-existing assertion in the hook's test script true, and means a parsing defect can only cost a redundant warning, never a missed one.

After the existing empty-HEAD guard, and before the engine call, confirm the commit is new: read HEAD's committer timestamp and exit 0 when it is older than a fixed freshness window held as a named constant in the script. This is what makes the outcome "a command that actually created a commit" rather than "a command that could have". A `git commit` that aborted, a `git merge --ff-only` that fast-forwarded onto an older upstream commit, and a `git rebase --abort` all leave an old HEAD and stay silent. A commit, an amend, or a rebase that wrote new commits leaves a HEAD seconds old and warns as before. A clock that reports a HEAD in the future is treated as fresh, keeping the fail-open direction. The window is a script constant rather than a configuration key: no consumer surface is added, so no configuration documentation changes.

Tests extend the hook's existing shell test script, which is the established mirror for this shell subject; no unit-test file under the engine's test tree corresponds to it. Each new case builds an isolated temporary Git repository with `mktemp -d`, a pinned local identity, and no remote, then drives the real hook script end to end with a payload on standard input. The engine boundary is faked exactly the way the script's existing cases fake it: `AI_CONDUCTOR_ENGINE_BIN` points at a stub that appends its argv to a log and prints a fixed JSON verdict, so "never invokes the engine derive binary" is asserted as the absence of that log rather than by timing. Nothing in the suite reaches a real LLM, a network service, or the real engine. Back-dating a commit uses the Git author and committer date environment variables, so the freshness case is deterministic and needs no sleep.

Two facts about running the suite locally. Every pre-existing invocation of the hook inherits the caller's standard input, so each one is updated to read from the null device — otherwise a caller holding a pipe open makes each case pay the bounded read timeout. And the script's three silence assertions already fail in a checkout where the engine bundle has not been built, because the hook then prints its engine-unavailable notice to standard error and those cases capture standard error; build the engine bundle first, or run those cases against a stub binary, and do not misread that pre-existing condition as a regression from this change.

Any change under the hooks directory trips the release gate's path-based classifier as the canonical `hook wiring` breaking surface, but this edit changes no consumer-visible wiring, schema, or CLI — the installed settings entry, matcher, command path, and timeout are byte-identical. The correct response is the internal-only waiver the governing waiver rule prescribes, committed in the same diff and naming that one surface, not an invented empty migration block.

## Preconditions and claim ledger

- Verified: `hooks/claude/post-commit-derive-feedback.sh` never reads standard input; it computes `commit=$(git rev-parse HEAD ...)` and then runs `timeout 5s "$engine_bin" derive-feedback --sha "$commit"` on every invocation.
- Verified: `bin/install` registers that script under the `PostToolUse` matcher `Bash` with a 15-second timeout, so the host invokes it after every Bash tool call.
- Verified: `hooks/claude/docs-guard.sh` reads its payload as `timeout 3 head -c 1048576` with an error-swallowing fallback, and treats an unparseable payload as fail-open.
- Verified: `hooks/claude/block-destructive-git.sh` extracts `tool_input.command` through a one-line `python3` JSON read and strips single- and double-quoted spans to build its scannable copy.
- Verified: `test/test_post_commit_derive_feedback.sh` already fakes the engine through `AI_CONDUCTOR_ENGINE_BIN` and an argv-logging stub, and is not referenced by `test/test_harness_integrity.sh` or any CI workflow, so it remains an operator-run script after this change.
- Verified: in a worktree without a built engine bundle the script's silence assertions fail on the hook's engine-unavailable notice; this predates the change.
- Verified: `src/conductor/src/engine/self-host/release-gate.ts` maps any path beginning with `hooks/` to the canonical `hook wiring` surface, and `.docs/release-waivers` is not one of the sealed protected artifact directories.
- Verified: `docs/reference/settings-and-hooks.md` describes this hook in exactly two places, a wiring row and a contract row; `docs/reference/environment.md` documents only the engine-binary override, which this slice does not change.
- Scope check: consumer-facing (the hook installs into every consumer repository), no new skill, no new provider asymmetry. Event-spine: no new channel, no watcher, no sidecar, no stamped timestamp — the gate reads the payload the host already delivers and Git metadata that already exists.
- Verify-claims verdict: CLEAR. Every path, symbol, and behaviour above was read in the worktree. No open product or scope assumption remains; the operator-delegated choice of the payload gate over a stamped last-seen-sha file is recorded in the track marker.

## Tasks

### Task 1: Return early unless the Bash command could create a commit
**Story:** Story 1
**Type:** happy-path
**Files:** hooks/claude/post-commit-derive-feedback.sh, test/test_post_commit_derive_feedback.sh
**Dependencies:** none

**Steps:**
1. Add shell test cases that build isolated temporary repositories and drive the hook with a payload on standard input, using the script's existing engine stub and argv log: a non-commit command, a commit-creating command against a just-created untrailered HEAD, and a command whose commit-creating text sits only inside a quoted argument.
2. Establish RED against the current hook, which invokes the engine for all three.
3. Implement the gate at the top of the hook: bounded payload read, `tool_input.command` extraction, quoted-span stripping, segment split on unquoted separators, and a classifier for the commit-creating git subcommands. Exit 0 when no segment classifies. Leave the rest of the script untouched.
4. Run the hook's shell test script and this repository's shell linter, then commit the focused change.

**Done when:**
1. A non-commit payload leaves the engine argv log absent and the hook silent.
2. A commit-creating payload against a fresh untrailered HEAD records one derive invocation naming that commit and prints the existing warning.
3. A payload whose commit-creating text is quoted leaves the engine argv log absent and the hook silent.
4. The hook script passes the repository's shell linter at error severity.

### Task 2: Require a freshly created HEAD before spending the engine call
**Story:** Story 2
**Type:** negative-path
**Files:** hooks/claude/post-commit-derive-feedback.sh, test/test_post_commit_derive_feedback.sh
**Dependencies:** 1

**Steps:**
1. Add a case that commits with back-dated author and committer date environment variables, then drives the hook with a commit-creating payload; add a case that runs the hook with a commit-creating payload in a repository initialised with no commits.
2. Establish RED for the back-dated case, which currently reaches the engine.
3. Add the freshness window as a named constant and, after the existing empty-HEAD guard and before the engine call, exit 0 when HEAD's committer timestamp is older than that window. Treat an unreadable timestamp and a future timestamp as fresh so the hook keeps failing open.
4. Run the hook's shell test script and the shell linter, then commit the focused change.

**Done when:**
1. A back-dated HEAD with a commit-creating payload leaves the engine argv log absent and the hook silent.
2. A repository with no commits exits 0 with no output and no engine invocation.
3. The just-created-commit case from the previous task still records its derive invocation and warning.

### Task 3: Keep an unreadable payload on today's advisory behaviour
**Story:** Story 3
**Type:** negative-path
**Files:** hooks/claude/post-commit-derive-feedback.sh, test/test_post_commit_derive_feedback.sh
**Dependencies:** 2

**Steps:**
1. Redirect every pre-existing hook invocation in the test script to read from the null device, so no case waits on an inherited pipe.
2. Add a case feeding non-JSON text on standard input and a case feeding valid JSON with no command field, each against a fresh untrailered HEAD.
3. Confirm both fall through to the existing evaluation and warn; adjust only the gate's empty-command handling if either does not.
4. Run the hook's shell test script in full, confirming the pre-existing assertions still pass, then run the shell linter and commit.

**Done when:**
1. Non-JSON standard input warns for a fresh untrailered HEAD and exits 0.
2. A JSON payload with no command field warns for a fresh untrailered HEAD and exits 0.
3. Every assertion that existed in the test script before this change still passes.

### Task 4: Document the gate and waive the internal-only hook surface
**Story:** Story 1
**Type:** happy-path
**Files:** docs/reference/settings-and-hooks.md, .docs/release-waivers/gate-post-commit-derive-feedback-hook-on-commit-cr.md
**Dependencies:** 3

**Steps:**
1. Rewrite the hook's contract row in the settings-and-hooks reference so it states that the hook returns immediately unless the executed Bash command could create a commit and HEAD is a newly created commit, and that an unreadable payload falls back to evaluating HEAD. Leave the wiring row's matcher and timeout unchanged.
2. Add the release waiver file named for this plan's stem, waiving exactly the canonical `hook wiring` surface, with a rationale stating that the installed settings entry, matcher, command path, and timeout are unchanged and only the script's internal early-exit logic moved.
3. Run the repository's validation suite and the shell linter, then commit.

**Done when:**
1. The hook's contract row states the command gate, the freshness condition, and the unreadable-payload fallback.
2. The wiring row still records the `PostToolUse` matcher `Bash` and its 15-second timeout.
3. The waiver names exactly one canonical surface and carries a non-empty rationale.
4. The repository's validation suite passes.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the hook receives a tool payload whose Bash command is an ordinary non-commit command such as a directory listing, when the hook runs, then it exits 0 with no output and never invokes the engine derive binary. | 1 | "A non-commit payload leaves the engine argv log absent and the hook silent." | diff-local |
| Story 1 happy: Given the hook receives a payload whose Bash command creates a commit and HEAD is a freshly created commit carrying no Task trailer, when the hook runs, then it invokes the engine derive binary and prints the existing warning naming that commit. | 1, 2 | "A commit-creating payload against a fresh untrailered HEAD records one derive invocation naming that commit and prints the existing warning." | diff-local |
| Story 1 negative: Given the hook receives a payload whose Bash command mentions a commit-creating invocation only inside a quoted argument, when the hook runs, then it exits 0 with no output and never invokes the engine derive binary. | 1 | "A payload whose commit-creating text is quoted leaves the engine argv log absent and the hook silent." | diff-local |
| Story 2 happy: Given a payload whose Bash command is commit-creating but HEAD was committed longer ago than the hook's freshness window, when the hook runs, then it exits 0 with no output and never invokes the engine derive binary. | 2 | "A back-dated HEAD with a commit-creating payload leaves the engine argv log absent and the hook silent." | diff-local |
| Story 2 negative: Given a repository that has no commits at all, when the hook runs with a commit-creating payload, then it exits 0 with no output and never invokes the engine derive binary. | 2 | "A repository with no commits exits 0 with no output and no engine invocation." | diff-local |
| Story 3 happy: Given the hook runs with no payload on standard input and HEAD is a freshly created commit carrying no Task trailer, when the hook runs, then it prints the existing warning naming that commit and exits 0. | 3 | "Every assertion that existed in the test script before this change still passes." | diff-local |
| Story 3 negative: Given standard input carries text that is not valid JSON, when the hook runs, then it evaluates HEAD exactly as it does with no payload and exits 0. | 3 | "Non-JSON standard input warns for a fresh untrailered HEAD and exits 0." | diff-local |
| Story 3 negative: Given the payload is valid JSON carrying no Bash command field, when the hook runs, then it evaluates HEAD exactly as it does with no payload and exits 0. | 3 | "A JSON payload with no command field warns for a fresh untrailered HEAD and exits 0." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures in the hook's existing shell test script. Task 1 owns the command-classification cases, Task 2 owns the freshness and empty-repository cases, and Task 3 owns the unreadable-payload cases plus the preservation of every pre-existing assertion. Each case drives the real hook script against an isolated temporary Git repository and fakes the engine at the `AI_CONDUCTOR_ENGINE_BIN` boundary the script already uses; no case reaches a real LLM, a network service, or a shared repository. The engine-unavailable degradation path keeps its existing coverage unchanged, and no aggregate or terminal validation task is added. Wiring this script into the integrity suite is deliberately excluded: the suite's other delegated shell tests run in a checkout that has not built the engine bundle, where three of this script's silence assertions already fail, so that wiring is its own change with its own fix.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 3 -> Task 4
