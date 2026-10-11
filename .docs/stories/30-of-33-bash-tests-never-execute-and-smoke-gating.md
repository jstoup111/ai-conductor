**Status:** Accepted

# Stories: Every bash test executes in CI or is removed (#1021)

Track: technical

Tier: M

Scope boundary (from `.docs/track/30-of-33-bash-tests-never-execute-and-smoke-gating.md`): every
top-level `test/*.sh` orphan is triaged to kept, fixed, or deleted. Kept scripts run from a
committed manifest through a sandboxed runner in a new CI job. A mechanical guard fails on any
`test/*.sh` that is neither executed nor a declared sourced helper. On the smoke side, the only
change is a guard that every smoke file declares a `smokeCapability`. Out of scope: unifying the
in-file smoke `skipIf` idioms, and porting bash tests to Vitest. Design:
`.docs/decisions/architecture-review-2026-10-10-30-of-33-bash-tests-never-execute-and-smoke-gating.md`
(APPROVED WITH CONDITIONS C1-C6).

## Story 1: Every shell test script has exactly one verified execution class

As a harness maintainer, I want every top-level `test/*.sh` script to declare how it is executed,
with that declaration checked mechanically, so that a test nothing runs fails the build instead of
passing silently.

### Acceptance Criteria

#### Happy Path

- Given every top-level `test/*.sh` script appears exactly once in the committed shell-test manifest with a valid class, when `test/test_harness_integrity.sh` runs, then the classification check passes and reports the number of scripts it classified.
- Given a script declared with class `integrity`, when the classification check runs and `test/test_harness_integrity.sh` invokes that script, then the check accepts the declaration.
- Given a script declared with class `invoked-by` naming a parent script, when the classification check runs, the parent references the child, and the parent is itself classified as executed, then the check accepts the declaration.
- Given a script declared with class `sourced-helper` and a non-empty reason, when the classification check runs, then the check accepts the declaration without requiring the script to be executed.

#### Negative Paths

- Given a new `test/*.sh` script that is not listed in the manifest, when the classification check runs, then the check fails and the failure output names that script as unclassified.
- Given a manifest entry naming a script that does not exist under `test/`, when the classification check runs, then the check fails and names the stale manifest entry.
- Given a script declared with class `integrity` that `test/test_harness_integrity.sh` does not invoke, when the classification check runs, then the check fails and names the script and the unverified class.
- Given a script declared `invoked-by` a parent that does not reference it, or whose parent is itself unclassified or unexecuted, when the classification check runs, then the check fails and names both the child and the parent.
- Given a script listed twice in the manifest, or listed with a class outside the closed set `shell-runner`, `integrity`, `invoked-by`, `sourced-helper`, when the classification check runs, then the check fails and names the duplicate or invalid entry.
- Given a manifest entry with class `integrity`, `invoked-by`, or `sourced-helper` and an empty reason, when the classification check runs, then the check fails and names the entry missing its reason.
- Given the script enumeration under `test/` returns zero scripts or the manifest cannot be read, when the classification check runs, then the check fails rather than reporting success on an empty set.

### Done When

- [ ] `test/test_harness_integrity.sh` contains a numbered classification check that fails, naming the script, for each negative path above.
- [ ] A fixture-driven test proves the check rejects an unlisted script, a stale entry, an unverified `integrity` class, a broken `invoked-by` chain, a duplicate, an invalid class, a missing reason, and an empty enumeration.

## Story 2: Manifest-listed shell tests run in an isolated sandbox

As a harness maintainer, I want every `shell-runner` script executed with its own throwaway home
and temp state, so that installer and update tests can run in CI and locally without touching real
operator configuration.

### Acceptance Criteria

#### Happy Path

- Given a manifest with several `shell-runner` scripts that all exit 0, when `test/run_shell_tests.sh` runs, then it executes each listed script once, prints a pass line naming each script, and exits 0.
- Given a `shell-runner` script that writes under `$HOME`, `$TMPDIR`, and the XDG config, cache, and data directories, when the runner executes it, then those writes land in a run-scoped directory the runner created and the invoking user's real home is unchanged.
- Given a `shell-runner` script that runs `git config --global`, when the runner executes it, then the setting is written to a run-scoped global git config and the invoking user's global git config is unchanged.
- Given the runner has finished, whether scripts passed or failed, when the run exits, then every sandbox directory it created has been removed.

#### Negative Paths

- Given one `shell-runner` script exits non-zero among others that pass, when the runner runs, then it still executes the remaining scripts, names the failing script and its exit status in the output, and exits non-zero.
- Given a `shell-runner` script that exceeds the per-script timeout, when the runner runs, then the script is terminated, the output names the script as timed out, and the runner exits non-zero.
- Given `GH_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `CODEX_HOME` is set in the invoking environment, when the runner executes a script, then none of those variables is visible to the script.
- Given the manifest contains no `shell-runner` entries or cannot be read, when the runner starts, then it exits non-zero with a message naming the empty or unreadable manifest rather than reporting success.
- Given a script fails, when the runner cleans up, then sandbox removal does not mask the script's non-zero exit status.

### Done When

- [ ] `test/run_shell_tests.sh` exists and reads only the committed manifest's `shell-runner` entries.
- [ ] A test proves a script writing to `$HOME` and global git config leaves a planted real home and real global git config byte-for-byte unchanged.
- [ ] A test proves a failing script, a timed-out script, and an empty manifest each make the runner exit non-zero and name the cause.
- [ ] A test proves the listed credential variables are absent from a script's environment.

## Story 3: The shell-test job gates every non-docs pull request

As a harness maintainer, I want the shell-test runner to run as its own required CI job, so that a
broken shell test blocks merge just as a broken Vitest test does.

### Acceptance Criteria

#### Happy Path

- Given a pull request that changes non-documentation files, when CI runs, then a `shell-tests` job runs `test/run_shell_tests.sh` with `shellcheck` and `ripgrep` installed, and its result is included in the `ci-gate` job's evaluation.
- Given a docs-only pull request, when CI runs, then the `shell-tests` job is skipped by the existing docs-only predicate and its skipped result does not by itself fail `ci-gate`.

#### Negative Paths

- Given a pull request in which a manifest-listed shell test fails, when CI runs, then the `shell-tests` job fails and the `ci-gate` job fails, naming the shell-tests result in its summary.
- Given the `ripgrep` install step fails on all retries, when the `shell-tests` job runs, then the job fails instead of running scripts that would skip their coverage without `ripgrep`.

### Done When

- [ ] `.github/workflows/ci.yml` defines a `shell-tests` job gated on the `changes` docs-only output.
- [ ] The `ci-gate` job lists `shell-tests` in `needs`, and its result loop and summary include that result.
- [ ] A workflow-contract test proves the `shell-tests` job, its docs-only gating, and its `ci-gate` registration.

## Story 4: No shell test is left unexecuted, and every removal is accounted for

As a harness maintainer, I want every current orphan script either executed and passing, or
deleted with a recorded reason, so that the shell suite contains only tests that actually run and
pass.

### Acceptance Criteria

#### Happy Path

- Given the feature is complete, when the classification check runs on the delivered tree, then every top-level `test/*.sh` is classified and the check passes.
- Given the feature is complete, when `test/run_shell_tests.sh` runs on the delivered tree in CI, then every `shell-runner` script passes.
- Given an orphan script whose behavior is not covered elsewhere and which fails today, when it is triaged, then it is repaired to test current behavior and listed as `shell-runner` or under another executed class.
- Given an orphan script that is broken, obsolete, or duplicates existing coverage, when it is triaged, then it is deleted, and the triage record names either the test that covers its behavior or why the behavior no longer exists.

#### Negative Paths

- Given an orphan script that exits non-zero by design as a stale RED-phase specification, when it is triaged, then it is either repaired to pass against current behavior or deleted, and it is never listed as an expected failure.
- Given an orphan acceptance runner that invokes child scripts, when the runner is deleted, then each child is separately triaged and classified or deleted, so no child becomes unclassified.
- Given an orphan script that a non-orphan script sources or references, when it is triaged, then it is not deleted unless that reference is removed in the same change and the referencing script still passes.

### Done When

- [ ] The delivered tree's classification check passes with zero unclassified scripts.
- [ ] The delivered tree's `shell-tests` CI job passes with every `shell-runner` script executed.
- [ ] A committed triage record lists every script orphaned at the start of the feature with its disposition (kept, fixed, or deleted) and, for each deletion, the covering test or obsolescence reason.

## Story 5: Every smoke test declares a smoke capability, checked in the default suite

As a harness maintainer, I want the default test suite to fail when any smoke file lacks a valid
`smokeCapability` declaration, so that an ungated smoke file is caught on every pull request rather
than only when someone runs the smoke tier.

### Acceptance Criteria

#### Happy Path

- Given every file matched by the smoke globs (`test/smoke/**` and `**/*.smoke.test.ts` under `src/conductor`) declares a `smokeCapability` from the closed capability set, when the default `npm test` suite runs, then the structural smoke-declaration assertion passes.
- Given the structural assertion and the smoke runner both read declarations, when the same file is evaluated by each, then both use the same declaration parser and reach the same accepted or rejected result.

#### Negative Paths

- Given a smoke file with no `smokeCapability` declaration, when the default suite runs, then the structural assertion fails and names that file.
- Given a smoke file declaring a capability outside the closed set, when the default suite runs, then the structural assertion fails and names the file and the invalid capability.
- Given the smoke glob discovery returns zero files, when the default suite runs, then the structural assertion fails rather than passing on an empty set.

### Done When

- [ ] `src/conductor/test/structural/test-execution-policy.test.ts` contains the smoke-declaration assertion and runs in the default suite.
- [ ] The declaration parser used by `src/engine/smoke-runner.ts` is the one the assertion calls.
- [ ] A test proves a missing declaration, an invalid capability, and an empty discovery each fail the assertion, naming the cause.
