# Implementation Plan: Every bash test executes in CI or is removed (#1021)

**Date:** 2026-10-10
**Stories:** .docs/stories/30-of-33-bash-tests-never-execute-and-smoke-gating.md
**Conflict check:** Clean as of 2026-10-10

## Summary

Every top-level `test/*.sh` script is classified in a committed manifest that machinery verifies.
Manifest-listed scripts run in a sandboxed runner inside a new CI job. The 40 scripts nothing runs
today are each kept, fixed, or deleted. The default Vitest suite asserts that every smoke file
declares a `smokeCapability`. The plan has 14 tasks.

## Technical Approach

- **Orphan baseline (verified 2026-10-10).** 67 top-level `test/*.sh` scripts exist. 24 run from
  `test/test_harness_integrity.sh` (including itself and `lint_shell.sh`). Two more run through a
  fixture suite: `check_docs_navigation.sh` from `test_docs_navigation.sh`, and
  `docs_pages.smoke.test.sh` from `test_docs_pages_smoke.sh`. `test_helpers.sh` is sourced only.
  The remaining 40 are orphans, listed per batch in Tasks 8–13.
- **One manifest, one parser.** `test/shell_tests.manifest` holds one entry per line:
  `<basename> <class> [reason…]`. Blank lines and `#` lines are ignored. The class is one of
  `shell-runner`, `integrity`, `invoked-by:<parent-basename>` or `sourced-helper`. Every class except
  `shell-runner` needs a non-empty reason. The triage record lives in the same file as comment
  lines: `# triage: <name> <kept|fixed|deleted> — <evidence>`. The checker and runner both read the
  manifest only through functions in the sourced helper `test/shell_test_manifest.sh`.
- **Verification mechanism for "invokes" (decided here).** A parent invokes a child when the
  parent file contains the child's basename, at a name boundary (not preceded or followed by
  `[A-Za-z0-9_.-]`), on a line whose first non-blank character is not `#`. `integrity` means
  either the script is `test_harness_integrity.sh` itself, or that file invokes it under this
  rule. `invoked-by:<parent>` means the parent invokes the child and resolves to an executed
  class. The parent chain is followed until it reaches `shell-runner` or `integrity`. A chain that
  reaches an unlisted script, a `sourced-helper`, or a script already visited (a cycle) is
  unexecuted.
- **Checker.** `test/check_shell_test_classification.sh [--test-dir D] [--manifest F]
  [--integrity F]` defaults to the repository paths. It prints every violation, one per line,
  using the fixed prefixes `UNCLASSIFIED:`, `STALE ENTRY:`, `DUPLICATE ENTRY:`, `INVALID CLASS:`,
  `MISSING REASON:`, `UNVERIFIED integrity:`, `UNVERIFIED invoked-by:`, `EMPTY ENUMERATION`, and
  `UNREADABLE MANIFEST:`, then exits 1. When there are no violations it prints
  `shell-test classification: <N> scripts classified` and exits 0. Its fixture suite is
  `test/test_shell_test_classification.sh`.
- **Runner.** `test/run_shell_tests.sh [--manifest F] [--test-dir D] [--timeout S]` defaults to the
  repository paths and `SHELL_TEST_TIMEOUT` (600 s when unset). It makes one `mktemp -d` root under
  the invoking `TMPDIR`. Each script gets its own sandbox inside it (`home/`, `tmp/`,
  `xdg-config/`, `xdg-cache/`, `xdg-data/`, and a `gitconfig` file). The script runs as
  `env -u GH_TOKEN -u GITHUB_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY -u OPENAI_API_KEY
  -u CODEX_HOME HOME=… TMPDIR=… XDG_CONFIG_HOME=… XDG_CACHE_HOME=… XDG_DATA_HOME=…
  GIT_CONFIG_GLOBAL=… timeout --kill-after=10s <S> bash <script>`. `PATH`, `ASDF_DATA_DIR` and
  `MISE_DATA_DIR` are inherited, so tool shims still resolve. The runner prints `PASS <name>`,
  `FAIL <name> (exit N)` or `TIMEOUT <name> after <S>s` per script, then
  `shell tests: <P> passed, <F> failed`. It runs every script even after a failure, and an `EXIT`
  trap removes the root without changing the exit status. Its fixture suite is
  `test/test_run_shell_tests.sh`.
- **CI.** A new `shell-tests` job copies the integrity job's shape: the `changes` docs-only gate,
  the same three-attempt apt loop, now installing `shellcheck ripgrep`, then `setup-node` and
  `npm ci` for scripts that drive `bin/install`, then `bash test/run_shell_tests.sh`. `ci-gate`
  gains it in `needs`, env, summary, and the failure loop. A Vitest structural test owns the wiring
  contract. Open spec #3151 also edits `ci-gate`. That is a merge-order concern only (see the
  conflict report).
- **Smoke declarations.** `src/engine/smoke-runner.ts` gains an exported
  `parseSmokeCapabilityDeclarations(discovered)`. It maps every file through the existing private
  `parseSmokeCapabilityDeclaration`, then calls `assertSmokeDiscovery`. `runSmoke` switches to
  it, so production behavior and error messages are unchanged. The structural test feeds it
  `discoverSmokeFiles('vitest.smoke.config.ts')`.
- **Triage rule (Tasks 8–13).** Run each orphan alone under the runner.
  - It passes: keep it.
  - It fails because the test is stale against current intended behavior (for example an outdated
    RED-phase expectation) and its coverage is unique: repair the test.
  - It is broken, obsolete, or duplicates coverage that exists elsewhere: delete it and remove
    every reference to it outside `.docs/`.
  - It fails because of a genuine production defect: do **not** edit production code. Stop and HALT,
    naming the script and the defect, for an operator decision.
  - It is cited by an accepted story (`test_bin_update.sh`, `test_install_check_build_auth.sh`,
    `test_install_provider_readiness.sh`, `test_ai_conductor_launcher.sh`,
    `test_codex_skill_installation.sh`, `test_examples_common_*.sh`,
    `test_generate_model_table_wrapper.sh`): it defaults to kept or fixed.
  - It is an acceptance runner (`run_*_acceptance*.sh`): its children are triaged as individual
    scripts. A runner that only re-executes children that are now `shell-runner` is deleted as
    duplicate execution.
  - Batches run serially because every batch edits the manifest.
- **Local pattern basis.**
  - The checker and runner follow `test/lint_shell.sh`'s fail-closed enumeration: the file set is
    computed rather than hand-listed, an empty set is a failure, and every offending file is
    named. Search `collect_scripts` and the empty-enumeration exit in `test/lint_shell.sh`.
  - Fixture suites follow `test/test_skill_invocation_policy.sh`: temporary fixture trees, checker
    invoked with path overrides, and exit status and stdout asserted.
  - The integrity wiring follows the existing numbered `set +e … assert` blocks. Search
    `halt_writer_check` in `test/test_harness_integrity.sh`.
  - The workflow test follows `src/conductor/test/structural/release-workflow.test.ts`, which
    loads YAML with `js-yaml` and asserts `needs` and `if`.
  - Allowed variation: helper names, and fixture layout inside a temporary directory.

## Prerequisites

- None. No ADR is created or amended.
- Triage tasks run `bin/install`-driven scripts. They need network access to the npm and git
  hosts those scripts already use. A dispatch that cannot reach them HALTs rather than recording a
  script as broken.

## Tasks

### Task 1: Manifest, shared parser, and classification checker accept valid declarations
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: `test/test_shell_test_classification.sh` builds a temp fixture with a test dir of scripts, a manifest, and a fake integrity file. It covers: a script classed `integrity` referenced on a non-comment line; the integrity file itself classed `integrity`; a child classed `invoked-by:<parent>` whose parent is `integrity`; and a `sourced-helper` with a reason that nothing references. It runs `test/check_shell_test_classification.sh --test-dir --manifest --integrity` and asserts exit 0 and the count line.
2. Verify test fails (RED): the checker does not exist.
3. Implement `test/shell_test_manifest.sh`, sourced, with functions to list entries as `name class parent reason` and to test whether a parent invokes a child under the name-boundary, non-comment rule. Implement `test/check_shell_test_classification.sh` using only those functions. Follow `test/lint_shell.sh`'s computed enumeration: list top-level `*.sh` under the test dir and name every offender. Seed `test/shell_tests.manifest` with the 24 integrity-run scripts as `integrity`, `check_docs_navigation.sh` as `invoked-by:test_docs_navigation.sh`, `docs_pages.smoke.test.sh` as `invoked-by:test_docs_pages_smoke.sh`, and `test_helpers.sh` as `sourced-helper`, each with a reason.
4. Verify test passes (GREEN).
5. Commit: "test(shell): classify every shell test script in a verified manifest"

**Done when:**
- [test] `test/test_shell_test_classification.sh` runs the checker on a fixture where every script has a valid class and asserts exit 0 and the output line `shell-test classification: <N> scripts classified` with N equal to the fixture's `*.sh` count.
- [test] In that fixture the checker accepts a script classed `integrity` that the fixture integrity file names on a non-comment line, and accepts the integrity file itself classed `integrity`.
- [test] In that fixture the checker accepts a child classed `invoked-by:<parent>` whose parent names it on a non-comment line and is itself classed `integrity`.
- [test] In that fixture the checker accepts a script classed `sourced-helper` with a non-empty reason although no fixture file names it.
- `test/check_shell_test_classification.sh` reads manifest entries only through functions sourced from `test/shell_test_manifest.sh`, and `test/shell_tests.manifest` lists the 24 integrity-run scripts, the two fixture-invoked scripts, and `test_helpers.sh` with the classes named in Steps.

**Files likely touched:**
- `test/shell_test_manifest.sh` — new sourced manifest parser and invocation predicate
- `test/check_shell_test_classification.sh` — new checker
- `test/test_shell_test_classification.sh` — new fixture suite
- `test/shell_tests.manifest` — new manifest seeded with already-executed scripts

**Dependencies:** none

### Task 2: Checker rejects unlisted, stale, duplicate, invalid, and reasonless entries
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_shell_test_classification.sh`, one fixture each: an unlisted script; a manifest entry with no file; a script listed twice; a class `runs-sometimes`; and an entry with no reason for each of `integrity`, `invoked-by:<parent>` and `sourced-helper`.
2. Verify tests fail (RED).
3. Implement the checks in `test/check_shell_test_classification.sh`. Collect every violation before exiting, so one run names them all.
4. Verify tests pass (GREEN).
5. Commit: "test(shell): reject unlisted, stale, duplicate, invalid, and reasonless entries"

**Done when:**
- [test] A fixture script absent from the manifest makes the checker exit 1 and print `UNCLASSIFIED: <name>`.
- [test] A manifest entry naming a script with no file in the fixture test dir makes the checker exit 1 and print `STALE ENTRY: <name>`.
- [test] A script listed twice makes the checker exit 1 and print `DUPLICATE ENTRY: <name>`, and an entry with class `runs-sometimes` makes it exit 1 and print `INVALID CLASS: <name> runs-sometimes`.
- [test] An entry with an empty reason makes the checker exit 1 and print `MISSING REASON: <name>` in three fixtures, one each for `integrity`, `invoked-by:<parent>`, and `sourced-helper`.

**Files likely touched:**
- `test/check_shell_test_classification.sh` — entry-level validations
- `test/test_shell_test_classification.sh` — negative fixtures

**Dependencies:** Task 1

### Task 3: Checker rejects unverified invocations and empty or unreadable inputs
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_shell_test_classification.sh`:
   - an `integrity` script the fake integrity file names only on a `#` line;
   - an `invoked-by` child whose parent does not name it;
   - an `invoked-by` child whose parent is unlisted;
   - an `invoked-by` child whose parent is a `sourced-helper`;
   - two scripts that each name the other as parent;
   - an empty test dir;
   - a missing manifest path.
2. Verify tests fail (RED).
3. Implement the invocation predicate checks and the chain walk, which tracks visited names to catch cycles. Fail closed on an empty enumeration or an unreadable manifest before printing any success line.
4. Verify tests pass (GREEN).
5. Commit: "test(shell): verify declared invocations and fail closed on empty inputs"

**Done when:**
- [test] A script classed `integrity` that the fixture integrity file names only on a comment line makes the checker exit 1 and print `UNVERIFIED integrity: <name>`.
- [test] The checker exits 1 and prints `UNVERIFIED invoked-by: <child> parent <parent>` in each of four fixtures: the parent does not name the child, the parent is absent from the manifest, the parent is classed `sourced-helper`, and two scripts name each other as parent.
- [test] A fixture test dir with zero `*.sh` files makes the checker exit 1 and print `EMPTY ENUMERATION`, and a nonexistent `--manifest` path makes it exit 1 and print `UNREADABLE MANIFEST: <path>`, with no `scripts classified` line in either output.

**Files likely touched:**
- `test/check_shell_test_classification.sh` — invocation verification, chain walk, fail-closed inputs
- `test/test_shell_test_classification.sh` — negative fixtures

**Dependencies:** Task 1

### Task 4: Sandboxed runner executes every shell-runner entry
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/test_run_shell_tests.sh`. Invoke `test/run_shell_tests.sh --manifest --test-dir` with `HOME` set to a planted home containing a `.gitconfig`, and `TMPDIR` set to an empty directory the test owns. Fixtures:
   - three passing `shell-runner` scripts, each appending its name to a counter file passed by absolute path;
   - a script writing a marker under each of `$HOME`, `$TMPDIR`, `$XDG_CONFIG_HOME`, `$XDG_CACHE_HOME` and `$XDG_DATA_HOME`, then printing those paths;
   - a script running `git config --global fixture.key value` and then `git config --global --get fixture.key`.
2. Verify tests fail (RED).
3. Implement `test/run_shell_tests.sh` as described in Technical Approach. Read entries through `test/shell_test_manifest.sh` and select only the `shell-runner` class. Inherit `PATH`, `ASDF_DATA_DIR` and `MISE_DATA_DIR`. Remove the root in an `EXIT` trap.
4. Verify tests pass (GREEN).
5. Commit: "test(shell): run manifest-listed shell tests in per-script sandboxes"

**Done when:**
- [test] Over a fixture manifest of three passing `shell-runner` scripts, `test/run_shell_tests.sh` records each script name exactly once in the counter file, prints `PASS <name>` for each, and exits 0.
- [test] A fixture script's `$HOME`, `$TMPDIR`, `$XDG_CONFIG_HOME`, `$XDG_CACHE_HOME`, and `$XDG_DATA_HOME` all lie beneath a directory the runner created inside the test-supplied `TMPDIR`, and a recursive hash of the planted invoking `HOME` is identical before and after the run.
- [test] A fixture script running `git config --global fixture.key value` reads `value` back through `git config --global --get fixture.key`, while the planted invoking `HOME/.gitconfig` is byte-for-byte unchanged.
- [test] After a run where every script passes and after a run where one script fails, the test-supplied `TMPDIR` contains no entries.
- `test/run_shell_tests.sh` reads entries only through `test/shell_test_manifest.sh`, executes only entries classed `shell-runner`, and does not modify `PATH`, `ASDF_DATA_DIR`, or `MISE_DATA_DIR`.

**Files likely touched:**
- `test/run_shell_tests.sh` — new runner
- `test/test_run_shell_tests.sh` — new fixture suite

**Dependencies:** Task 1

### Task 5: Runner reports failures, timeouts, and empty manifests and withholds credentials
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_run_shell_tests.sh`:
   - a pass, fail (`exit 3`), pass manifest;
   - `--timeout 2` with a script that runs `sleep 30`;
   - a script that prints `set` or `unset` for each of the six credential variables, with all six exported to the runner;
   - a manifest with only non-`shell-runner` entries;
   - a nonexistent manifest path.
2. Verify tests fail (RED).
3. Implement the per-script status accounting, the `timeout` exit-124 mapping to `TIMEOUT`, the `env -u` list, and the empty or unreadable manifest refusal before any script runs. Keep the trap's `rm` from replacing `$?`.
4. Verify tests pass (GREEN).
5. Commit: "test(shell): runner fails loudly, times out, and withholds credentials"

**Done when:**
- [test] Over a pass, fail (`exit 3`), pass fixture manifest the runner executes all three scripts, prints `FAIL <name> (exit 3)` for the failing one and `PASS <name>` for the other two, and exits non-zero.
- [test] With `--timeout 2` and a fixture script running `sleep 30`, the runner prints `TIMEOUT <name> after 2s`, exits non-zero, and returns within 20 seconds.
- [test] With `GH_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `CODEX_HOME` exported to the runner, a fixture script prints `unset` for all six.
- [test] A manifest with no `shell-runner` entries makes the runner exit non-zero and print `EMPTY MANIFEST: <path>`, and a nonexistent manifest path makes it exit non-zero and print `UNREADABLE MANIFEST: <path>`, with no `PASS` line in either output.
- [test] In the pass, fail, pass fixture, the runner's exit status is non-zero and the test-supplied `TMPDIR` is empty afterwards, so sandbox removal did not mask the failure.

**Files likely touched:**
- `test/run_shell_tests.sh` — failure accounting, timeout, credential withholding, input refusal
- `test/test_run_shell_tests.sh` — negative fixtures

**Dependencies:** Task 4

### Task 6: CI runs the shell-tests job and gates merge on it
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test `src/conductor/test/structural/shell-tests-ci-wiring.test.ts`. Following `test/structural/release-workflow.test.ts`, load `.github/workflows/ci.yml` with `js-yaml` and assert the job, step, and `ci-gate` properties named in Done when.
2. Verify test fails (RED).
3. Implement the `shell-tests` job in `.github/workflows/ci.yml`:
   - `needs: changes`, `if: needs.changes.outputs.docs_only != 'true'`, `runs-on: ubuntu-latest`;
   - checkout, then the integrity job's three-attempt apt loop installing `shellcheck ripgrep` and ending `exit 1`;
   - `setup-node` and `npm ci` in `src/conductor`, then `run: bash test/run_shell_tests.sh`.
   Add `shell-tests` to `ci-gate`'s `needs`, add `SHELL_TESTS: ${{ needs.shell-tests.result }}`, and add `shell_tests=$SHELL_TESTS` to the summary and `"$SHELL_TESTS"` to the result loop.
4. Verify test passes (GREEN).
5. Commit: "ci: run the shell-test runner as a required job"

**Done when:**
- [test] `shell-tests-ci-wiring.test.ts` asserts `.github/workflows/ci.yml` has a `shell-tests` job whose `needs` includes `changes`, whose `if` is exactly `needs.changes.outputs.docs_only != 'true'`, and which has a step whose `run` is exactly `bash test/run_shell_tests.sh`.
- [test] The same test asserts the `shell-tests` job has a step running `install --yes shellcheck ripgrep` inside a three-attempt loop that ends with `exit 1`, and that no step in the job sets `continue-on-error`.
- [test] The same test asserts `ci-gate` lists `shell-tests` in `needs`, sets an env var to `${{ needs.shell-tests.result }}`, includes that variable in the loop that exits 1 on `failure` or `cancelled`, and writes `shell_tests=` into its summary line.
- [test] The same test asserts the `ci-gate` result loop exits only on `failure` or `cancelled`, so a `skipped` `shell-tests` result does not by itself fail `ci-gate`.

**Files likely touched:**
- `.github/workflows/ci.yml` — new `shell-tests` job and `ci-gate` registration
- `src/conductor/test/structural/shell-tests-ci-wiring.test.ts` — new workflow contract test

**Dependencies:** none

### Task 7: Default suite asserts every smoke file declares a capability through the runner's parser
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - In `src/conductor/test/structural/test-execution-policy.test.ts`: discover with `discoverSmokeFiles('vitest.smoke.config.ts')`, call `parseSmokeCapabilityDeclarations`, and assert a non-empty result whose capabilities are all in `SMOKE_CAPABILITIES`.
   - In `src/conductor/test/smoke-capability.test.ts`: synthetic inputs for an undeclared source, an out-of-set capability, and an empty list.
   - A same-input comparison: the undeclared source goes through both `parseSmokeCapabilityDeclarations` and `runSmokeCli` (with fake `discover`, `runVitest` and `emit`), as in the existing "rejects a discovered smoke file with no declaration before running an executor" test.
2. Verify tests fail (RED): the export does not exist.
3. Implement `export function parseSmokeCapabilityDeclarations(discovered)` in `src/engine/smoke-runner.ts`. It maps each entry through `parseSmokeCapabilityDeclaration`, then calls `assertSmokeDiscovery`. Replace `runSmoke`'s inline map and `assertSmokeDiscovery` call with it.
4. Verify tests pass (GREEN), including the existing smoke-capability tests unchanged.
5. Commit: "test(smoke): assert every smoke file declares a capability in the default suite"

**Done when:**
- [test] `test-execution-policy.test.ts` passes `discoverSmokeFiles('vitest.smoke.config.ts')` output to `parseSmokeCapabilityDeclarations` and asserts a non-empty result in which every capability is a member of `SMOKE_CAPABILITIES`.
- [test] `parseSmokeCapabilityDeclarations` throws `Smoke file <file> declares no capability` for an entry without a declaration and `Smoke file <file> declares invalid capability <value>` for an out-of-set value, naming the synthetic file in each message.
- [test] `parseSmokeCapabilityDeclarations([])` throws `Smoke discovery found no test files`.
- [test] The same undeclared synthetic source is rejected with the identical message by `parseSmokeCapabilityDeclarations` and by `runSmokeCli` with fake dependencies, and the fake `runVitest` is never called.
- `runSmoke` in `src/engine/smoke-runner.ts` obtains file capabilities only by calling `parseSmokeCapabilityDeclarations`, which is the only caller of `parseSmokeCapabilityDeclaration`.

**Files likely touched:**
- `src/conductor/src/engine/smoke-runner.ts` — export the declaration validator; `runSmoke` uses it
- `src/conductor/test/structural/test-execution-policy.test.ts` — real-discovery declaration assertion
- `src/conductor/test/smoke-capability.test.ts` — synthetic negative and same-parser tests

**Dependencies:** none

### Task 8: Triage the bin/migrate orphans
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Scripts: `test_bin_migrate_approval.sh`, `test_bin_migrate_blocks.sh`, `test_bin_migrate_exec.sh`, `test_bin_migrate_ledger.sh`, `test_bin_migrate_multi_version_jump.sh`, `test_bin_migrate_parse.sh`.
2. Run each alone through `bash test/run_shell_tests.sh --manifest <temp manifest listing only it as shell-runner>`, and record PASS, FAIL or TIMEOUT.
3. Apply the Technical Approach triage rule:
   - passing: keep it;
   - stale against intended current behavior, with unique coverage: repair the test so it passes against current behavior;
   - broken, obsolete or duplicated: delete it and remove every reference outside `.docs/`;
   - a genuine production defect: HALT naming the script and defect, with no production edit.
   No script is ever recorded as an expected failure.
4. For each script, add exactly one `# triage: <name> <kept|fixed|deleted> — <evidence>` line to `test/shell_tests.manifest`. A deleted line names a covering test path or an `obsolete:` reason. Add a `shell-runner` entry, or an `invoked-by:<parent>` entry with a reason, for each kept or fixed script.
5. Commit: "test(shell): triage bin/migrate shell tests"

**Done when:**
- Each of the six scripts listed in Steps has exactly one `# triage:` line in `test/shell_tests.manifest` recording `kept`, `fixed`, or `deleted`, and each `deleted` line names a covering test path or an `obsolete:` reason.
- Each listed script recorded `kept` or `fixed` has exactly one manifest entry classed `shell-runner` or `invoked-by:<parent>`, and each recorded `deleted` no longer exists under `test/`.
- [test] `bash test/run_shell_tests.sh --manifest <file>` over a manifest holding only this task's `shell-runner` entries exits 0 and prints a `PASS` line for each entry.
- `git grep -n` for each deleted script's basename outside `.docs/` returns no non-comment line, and every script that referenced a deleted script before this task still passes under its own executor.
- No `# triage:` line records an expected failure, and the diff edits no file outside `test/` except to remove references to deleted scripts.

**Files likely touched:**
- `test/shell_tests.manifest` — entries and triage lines for this batch
- `test/test_bin_migrate_approval.sh`, `test/test_bin_migrate_blocks.sh`, `test/test_bin_migrate_exec.sh`, `test/test_bin_migrate_ledger.sh`, `test/test_bin_migrate_multi_version_jump.sh`, `test/test_bin_migrate_parse.sh` — repaired or deleted

**Dependencies:** Task 5

### Task 9: Triage the first install orphans
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Scripts: `test_install_channel_selection.sh`, `test_install_check_build_auth.sh`, `test_install_docs_guard_wiring.sh`, `test_install_literal_configuration.sh`, `test_install_node_guard.sh`.
2. Follow Steps 2–4 of Task 8 for these scripts. Repeat the triage rule exactly: keep a passing script; repair a stale one with unique coverage; delete a broken, obsolete or duplicate one with its references; HALT on a genuine production defect without a production edit; never record an expected failure. `test_install_check_build_auth.sh` is cited by an accepted story, so it defaults to kept or fixed.
3. Commit: "test(shell): triage first install shell tests"

**Done when:**
- Each of the five scripts listed in Steps has exactly one `# triage:` line in `test/shell_tests.manifest` recording `kept`, `fixed`, or `deleted`, and each `deleted` line names a covering test path or an `obsolete:` reason.
- Each listed script recorded `kept` or `fixed` has exactly one manifest entry classed `shell-runner` or `invoked-by:<parent>`, and each recorded `deleted` no longer exists under `test/`.
- [test] `bash test/run_shell_tests.sh --manifest <file>` over a manifest holding only this task's `shell-runner` entries exits 0 and prints a `PASS` line for each entry.
- `git grep -n` for each deleted script's basename outside `.docs/` returns no non-comment line, and every script that referenced a deleted script before this task still passes under its own executor.
- No `# triage:` line records an expected failure, and the diff edits no file outside `test/` except to remove references to deleted scripts.

**Files likely touched:**
- `test/shell_tests.manifest` — entries and triage lines for this batch
- `test/test_install_channel_selection.sh`, `test/test_install_check_build_auth.sh`, `test/test_install_docs_guard_wiring.sh`, `test/test_install_literal_configuration.sh`, `test/test_install_node_guard.sh` — repaired or deleted

**Dependencies:** Task 8

### Task 10: Triage the remaining install, update, and RED-phase orphans
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Scripts: `test_install_provider_readiness.sh`, `test_install_uninstall.sh`, `test_install_update_engine_setup.sh`, `test_install_worktree_guard.sh`, `test_rtk_hook_reinit.sh`, `test_bin_update.sh`, `test_bin_setup_failure_propagation.sh`.
2. Follow Steps 2–4 of Task 8 for these scripts. Repeat the triage rule exactly: keep a passing script; repair a stale one with unique coverage; delete a broken, obsolete or duplicate one with its references; HALT on a genuine production defect without a production edit; never record an expected failure.
   - `test_rtk_hook_reinit.sh` is a self-described RED-phase specification. Repair its expectations to the shipped behavior, or delete it if it is covered elsewhere.
   - `test_bin_update.sh` and `test_install_provider_readiness.sh` are cited by accepted stories, so they default to kept or fixed.
3. Commit: "test(shell): triage install, update, and RED-phase shell tests"

**Done when:**
- Each of the seven scripts listed in Steps has exactly one `# triage:` line in `test/shell_tests.manifest` recording `kept`, `fixed`, or `deleted`, and each `deleted` line names a covering test path or an `obsolete:` reason.
- Each listed script recorded `kept` or `fixed` has exactly one manifest entry classed `shell-runner` or `invoked-by:<parent>`, and each recorded `deleted` no longer exists under `test/`.
- [test] `bash test/run_shell_tests.sh --manifest <file>` over a manifest holding only this task's `shell-runner` entries exits 0 and prints a `PASS` line for each entry, including `test_rtk_hook_reinit.sh` if it is kept or fixed.
- `git grep -n` for each deleted script's basename outside `.docs/` returns no non-comment line, and every script that referenced a deleted script before this task still passes under its own executor.
- No `# triage:` line records an expected failure, and the diff edits no file outside `test/` except to remove references to deleted scripts.

**Files likely touched:**
- `test/shell_tests.manifest` — entries and triage lines for this batch
- `test/test_install_provider_readiness.sh`, `test/test_install_uninstall.sh`, `test/test_install_update_engine_setup.sh`, `test/test_install_worktree_guard.sh`, `test/test_rtk_hook_reinit.sh`, `test/test_bin_update.sh`, `test/test_bin_setup_failure_propagation.sh` — repaired or deleted

**Dependencies:** Task 9

### Task 11: Triage the examples acceptance runner and its children
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Scripts: `run_examples_acceptance_specs.sh` and the scripts it runs or that share its fixtures: `test_examples_common_prompt.sh`, `test_examples_common_sandbox.sh`, `test_examples_common_timeout.sh`, `test_examples_daemon.sh`, `test_examples_engineer.sh`, `test_examples_intake_loop.sh`, `test_examples_interactive.sh`, `test_examples_prompt_fixtures.sh`, `test_examples_readme_and_usage.sh`.
2. Follow Steps 2–4 of Task 8 for these scripts. Repeat the triage rule exactly: keep a passing script; repair a stale one with unique coverage; delete a broken, obsolete or duplicate one with its references; HALT on a genuine production defect without a production edit; never record an expected failure.
   - Triage each child individually. Delete the runner if it only re-executes children that are now `shell-runner`.
   - The `test_examples_common_*.sh` scripts are cited by an accepted story, so they default to kept or fixed.
   - `test_helpers.sh` keeps its `sourced-helper` entry unless no remaining script sources it, in which case it is deleted with a triage line.
3. Commit: "test(shell): triage examples shell tests"

**Done when:**
- Each of the ten scripts listed in Steps has exactly one `# triage:` line in `test/shell_tests.manifest` recording `kept`, `fixed`, or `deleted`, and each `deleted` line names a covering test path or an `obsolete:` reason.
- Each listed script recorded `kept` or `fixed` has exactly one manifest entry classed `shell-runner` or `invoked-by:<parent>`, each recorded `deleted` no longer exists under `test/`, and each child of a deleted runner carries its own entry or `deleted` triage line.
- [test] `bash test/run_shell_tests.sh --manifest <file>` over a manifest holding only this task's `shell-runner` entries exits 0 and prints a `PASS` line for each entry.
- `git grep -n` for each deleted script's basename outside `.docs/` returns no non-comment line, and every script that referenced a deleted script before this task still passes under its own executor.
- No `# triage:` line records an expected failure, and the diff edits no file outside `test/` except to remove references to deleted scripts.

**Files likely touched:**
- `test/shell_tests.manifest` — entries and triage lines for this batch
- `test/run_examples_acceptance_specs.sh`, `test/test_examples_common_prompt.sh`, `test/test_examples_common_sandbox.sh`, `test/test_examples_common_timeout.sh`, `test/test_examples_daemon.sh`, `test/test_examples_engineer.sh`, `test/test_examples_intake_loop.sh`, `test/test_examples_interactive.sh`, `test/test_examples_prompt_fixtures.sh`, `test/test_examples_readme_and_usage.sh`, `test/test_helpers.sh` — repaired or deleted

**Dependencies:** Task 10

### Task 12: Triage the codex and documentation acceptance runners and their children
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Scripts: `run_first_class_codex_harness_parity_904_acceptance.sh`, `test_codex_guidance_contract.sh`, `test_codex_skill_installation.sh`, `run_browsable_documentation_site_acceptance.sh`.
2. Follow Steps 2–4 of Task 8 for these scripts. Repeat the triage rule exactly: keep a passing script; repair a stale one with unique coverage; delete a broken, obsolete or duplicate one with its references; HALT on a genuine production defect without a production edit; never record an expected failure.
   - Each runner's children that are already classified (`test_provider_skill_contracts.sh`, `test_docs_navigation.sh`, `test_docs_pages_smoke.sh`) keep their existing `integrity` entries.
   - A runner that only re-executes classified children is deleted as duplicate execution.
   - `test_codex_skill_installation.sh` is cited by an accepted story, so it defaults to kept or fixed.
3. Commit: "test(shell): triage codex and documentation acceptance runners"

**Done when:**
- Each of the four scripts listed in Steps has exactly one `# triage:` line in `test/shell_tests.manifest` recording `kept`, `fixed`, or `deleted`, and each `deleted` line names a covering test path or an `obsolete:` reason.
- Each listed script recorded `kept` or `fixed` has exactly one manifest entry classed `shell-runner` or `invoked-by:<parent>`, each recorded `deleted` no longer exists under `test/`, and each child of a deleted runner carries its own entry or `deleted` triage line.
- [test] `bash test/run_shell_tests.sh --manifest <file>` over a manifest holding only this task's `shell-runner` entries exits 0 and prints a `PASS` line for each entry.
- `git grep -n` for each deleted script's basename outside `.docs/` returns no non-comment line, and every script that referenced a deleted script before this task still passes under its own executor.
- No `# triage:` line records an expected failure, and the diff edits no file outside `test/` except to remove references to deleted scripts.

**Files likely touched:**
- `test/shell_tests.manifest` — entries and triage lines for this batch
- `test/run_first_class_codex_harness_parity_904_acceptance.sh`, `test/test_codex_guidance_contract.sh`, `test/test_codex_skill_installation.sh`, `test/run_browsable_documentation_site_acceptance.sh` — repaired or deleted

**Dependencies:** Task 11

### Task 13: Triage the launcher, hook, and release orphans
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Scripts: `test_ai_conductor_launcher.sh`, `test_conduct_ts_launcher.sh`, `test_generate_model_table_wrapper.sh`, `test_post_commit_derive_feedback.sh`, `test_rate_limit_wait.sh`, `test_release_unreleased_state.sh`, `test_session_start_summary.sh`, `test_skill_pipeline_contract.sh`.
2. Follow Steps 2–4 of Task 8 for these scripts. Repeat the triage rule exactly: keep a passing script; repair a stale one with unique coverage; delete a broken, obsolete or duplicate one with its references; HALT on a genuine production defect without a production edit; never record an expected failure. `test_ai_conductor_launcher.sh` and `test_generate_model_table_wrapper.sh` are cited by accepted stories, so they default to kept or fixed.
3. Commit: "test(shell): triage launcher, hook, and release shell tests"

**Done when:**
- Each of the eight scripts listed in Steps has exactly one `# triage:` line in `test/shell_tests.manifest` recording `kept`, `fixed`, or `deleted`, and each `deleted` line names a covering test path or an `obsolete:` reason.
- Each listed script recorded `kept` or `fixed` has exactly one manifest entry classed `shell-runner` or `invoked-by:<parent>`, and each recorded `deleted` no longer exists under `test/`.
- [test] `bash test/run_shell_tests.sh --manifest <file>` over a manifest holding only this task's `shell-runner` entries exits 0 and prints a `PASS` line for each entry.
- `git grep -n` for each deleted script's basename outside `.docs/` returns no non-comment line, and every script that referenced a deleted script before this task still passes under its own executor.
- No `# triage:` line records an expected failure, and the diff edits no file outside `test/` except to remove references to deleted scripts.

**Files likely touched:**
- `test/shell_tests.manifest` — entries and triage lines for this batch
- `test/test_ai_conductor_launcher.sh`, `test/test_conduct_ts_launcher.sh`, `test/test_generate_model_table_wrapper.sh`, `test/test_post_commit_derive_feedback.sh`, `test/test_rate_limit_wait.sh`, `test/test_release_unreleased_state.sh`, `test/test_session_start_summary.sh`, `test/test_skill_pipeline_contract.sh` — repaired or deleted

**Dependencies:** Task 12

### Task 14: Integrity runs the classification check and the delivered tree is fully classified
**Story:** 1
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Add manifest entries with reasons:
   - `check_shell_test_classification.sh`, `test_shell_test_classification.sh` and `test_run_shell_tests.sh` as `integrity`;
   - `run_shell_tests.sh` as `invoked-by:test_run_shell_tests.sh`;
   - `shell_test_manifest.sh` as `sourced-helper`.
2. Add a numbered check to `test/test_harness_integrity.sh` in the existing `set +e … assert` shape (search `halt_writer_check`). It runs `test/check_shell_test_classification.sh` with default paths and both fixture suites, and asserts each exit status, printing the checker output on failure.
3. Run `bash test/test_harness_integrity.sh` and `bash test/run_shell_tests.sh` on the delivered tree.
4. Commit: "test(shell): run shell-test classification from integrity"

**Done when:**
- `bash test/test_harness_integrity.sh` on the delivered tree prints a passing assertion for the classification check, and the checker output reads `shell-test classification: <N> scripts classified` with N equal to the number of top-level `test/*.sh` files.
- `test/test_harness_integrity.sh` invokes `test/check_shell_test_classification.sh`, `test/test_shell_test_classification.sh`, and `test/test_run_shell_tests.sh`, and records a failing assertion that includes the checker's output whenever any of them exits non-zero.
- `bash test/run_shell_tests.sh` with its default manifest on the delivered tree exits 0, printing a `PASS` line for every `shell-runner` entry and `shell tests: <P> passed, 0 failed`.
- `test/shell_tests.manifest` classifies `run_shell_tests.sh` as `invoked-by:test_run_shell_tests.sh`, `shell_test_manifest.sh` as `sourced-helper`, and the other three new scripts as `integrity`, and holds one `# triage:` line for each of the 40 scripts orphaned at the start of the feature.

**Files likely touched:**
- `test/test_harness_integrity.sh` — new numbered classification check
- `test/shell_tests.manifest` — entries for the new scripts

**Dependencies:** Tasks 2, 3, 5, 13

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ─────────────────────────────────────────┐
        ├─ Task 3 ─────────────────────────────────────────┤
        └─ Task 4 ─ Task 5 ─┬──────────────────────────────┤
                            └─ Task 8 ─ 9 ─ 10 ─ 11 ─ 12 ─ 13 ─┴─ Task 14
Task 6 (independent)
Task 7 (independent)
```

## Integration Points

- After Task 5: the runner can execute any manifest. Triage tasks use it as their executor.
- After Task 6: CI runs the runner on every non-docs PR. It stays red until the triage tasks land
  the kept scripts' entries.
- After Task 14: integrity enforces classification, so any new unclassified `test/*.sh` fails CI.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given every top-level `test/*.sh` script appears exactly once in the committed shell-test manifest with a valid class, when `test/test_harness_integrity.sh` runs, then the classification check passes and reports the number of scripts it classified. | 1, 14 | "prints a passing assertion for the classification check" | diff-local |
| Story 1 happy: Given a script declared with class `integrity`, when the classification check runs and `test/test_harness_integrity.sh` invokes that script, then the check accepts the declaration. | 1 | "accepts a script classed `integrity` that the fixture integrity file names on a non-comment line" | diff-local |
| Story 1 happy: Given a script declared with class `invoked-by` naming a parent script, when the classification check runs, the parent references the child, and the parent is itself classified as executed, then the check accepts the declaration. | 1 | "accepts a child classed `invoked-by:<parent>` whose parent names it on a non-comment line" | diff-local |
| Story 1 happy: Given a script declared with class `sourced-helper` and a non-empty reason, when the classification check runs, then the check accepts the declaration without requiring the script to be executed. | 1 | "accepts a script classed `sourced-helper` with a non-empty reason" | diff-local |
| Story 1 negative: Given a new `test/*.sh` script that is not listed in the manifest, when the classification check runs, then the check fails and the failure output names that script as unclassified. | 2 | "makes the checker exit 1 and print `UNCLASSIFIED: <name>`" | diff-local |
| Story 1 negative: Given a manifest entry naming a script that does not exist under `test/`, when the classification check runs, then the check fails and names the stale manifest entry. | 2 | "makes the checker exit 1 and print `STALE ENTRY: <name>`" | diff-local |
| Story 1 negative: Given a script declared with class `integrity` that `test/test_harness_integrity.sh` does not invoke, when the classification check runs, then the check fails and names the script and the unverified class. | 3 | "makes the checker exit 1 and print `UNVERIFIED integrity: <name>`" | diff-local |
| Story 1 negative: Given a script declared `invoked-by` a parent that does not reference it, or whose parent is itself unclassified or unexecuted, when the classification check runs, then the check fails and names both the child and the parent. | 3 | "prints `UNVERIFIED invoked-by: <child> parent <parent>` in each of four fixtures" | diff-local |
| Story 1 negative: Given a script listed twice in the manifest, or listed with a class outside the closed set `shell-runner`, `integrity`, `invoked-by`, `sourced-helper`, when the classification check runs, then the check fails and names the duplicate or invalid entry. | 2 | "print `DUPLICATE ENTRY: <name>`" | diff-local |
| Story 1 negative: Given a manifest entry with class `integrity`, `invoked-by`, or `sourced-helper` and an empty reason, when the classification check runs, then the check fails and names the entry missing its reason. | 2 | "print `MISSING REASON: <name>` in three fixtures" | diff-local |
| Story 1 negative: Given the script enumeration under `test/` returns zero scripts or the manifest cannot be read, when the classification check runs, then the check fails rather than reporting success on an empty set. | 3 | "print `EMPTY ENUMERATION`" | diff-local |
| Story 2 happy: Given a manifest with several `shell-runner` scripts that all exit 0, when `test/run_shell_tests.sh` runs, then it executes each listed script once, prints a pass line naming each script, and exits 0. | 4 | "records each script name exactly once in the counter file" | diff-local |
| Story 2 happy: Given a `shell-runner` script that writes under `$HOME`, `$TMPDIR`, and the XDG config, cache, and data directories, when the runner executes it, then those writes land in a run-scoped directory the runner created and the invoking user's real home is unchanged. | 4 | "a recursive hash of the planted invoking `HOME` is identical before and after the run" | diff-local |
| Story 2 happy: Given a `shell-runner` script that runs `git config --global`, when the runner executes it, then the setting is written to a run-scoped global git config and the invoking user's global git config is unchanged. | 4 | "the planted invoking `HOME/.gitconfig` is byte-for-byte unchanged" | diff-local |
| Story 2 happy: Given the runner has finished, whether scripts passed or failed, when the run exits, then every sandbox directory it created has been removed. | 4 | "the test-supplied `TMPDIR` contains no entries" | diff-local |
| Story 2 negative: Given one `shell-runner` script exits non-zero among others that pass, when the runner runs, then it still executes the remaining scripts, names the failing script and its exit status in the output, and exits non-zero. | 5 | "prints `FAIL <name> (exit 3)` for the failing one" | diff-local |
| Story 2 negative: Given a `shell-runner` script that exceeds the per-script timeout, when the runner runs, then the script is terminated, the output names the script as timed out, and the runner exits non-zero. | 5 | "prints `TIMEOUT <name> after 2s`" | diff-local |
| Story 2 negative: Given `GH_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `CODEX_HOME` is set in the invoking environment, when the runner executes a script, then none of those variables is visible to the script. | 5 | "a fixture script prints `unset` for all six" | diff-local |
| Story 2 negative: Given the manifest contains no `shell-runner` entries or cannot be read, when the runner starts, then it exits non-zero with a message naming the empty or unreadable manifest rather than reporting success. | 5 | "print `EMPTY MANIFEST: <path>`" | diff-local |
| Story 2 negative: Given a script fails, when the runner cleans up, then sandbox removal does not mask the script's non-zero exit status. | 5 | "so sandbox removal did not mask the failure" | diff-local |
| Story 3 happy: Given a pull request that changes non-documentation files, when CI runs, then a `shell-tests` job runs `test/run_shell_tests.sh` with `shellcheck` and `ripgrep` installed, and its result is included in the `ci-gate` job's evaluation. | 6 | "has a step whose `run` is exactly `bash test/run_shell_tests.sh`" | diff-local |
| Story 3 happy: Given a docs-only pull request, when CI runs, then the `shell-tests` job is skipped by the existing docs-only predicate and its skipped result does not by itself fail `ci-gate`. | 6 | "a `skipped` `shell-tests` result does not by itself fail `ci-gate`" | diff-local |
| Story 3 negative: Given a pull request in which a manifest-listed shell test fails, when CI runs, then the `shell-tests` job fails and the `ci-gate` job fails, naming the shell-tests result in its summary. | 6, 5 | "includes that variable in the loop that exits 1 on `failure` or `cancelled`" | diff-local |
| Story 3 negative: Given the `ripgrep` install step fails on all retries, when the `shell-tests` job runs, then the job fails instead of running scripts that would skip their coverage without `ripgrep`. | 6 | "inside a three-attempt loop that ends with `exit 1`" | diff-local |
| Story 4 happy: Given the feature is complete, when the classification check runs on the delivered tree, then every top-level `test/*.sh` is classified and the check passes. | 14 | "with N equal to the number of top-level `test/*.sh` files" | diff-local |
| Story 4 happy: Given the feature is complete, when `test/run_shell_tests.sh` runs on the delivered tree in CI, then every `shell-runner` script passes. | 14 | "printing a `PASS` line for every `shell-runner` entry" | diff-local |
| Story 4 happy: Given an orphan script whose behavior is not covered elsewhere and which fails today, when it is triaged, then it is repaired to test current behavior and listed as `shell-runner` or under another executed class. | 8, 9, 10, 11, 12, 13 | "over a manifest holding only this task's `shell-runner` entries exits 0" | diff-local |
| Story 4 happy: Given an orphan script that is broken, obsolete, or duplicates existing coverage, when it is triaged, then it is deleted, and the triage record names either the test that covers its behavior or why the behavior no longer exists. | 8, 9, 10, 11, 12, 13 | "each `deleted` line names a covering test path or an `obsolete:` reason" | diff-local |
| Story 4 negative: Given an orphan script that exits non-zero by design as a stale RED-phase specification, when it is triaged, then it is either repaired to pass against current behavior or deleted, and it is never listed as an expected failure. | 8, 9, 10, 11, 12, 13 | "No `# triage:` line records an expected failure" | diff-local |
| Story 4 negative: Given an orphan acceptance runner that invokes child scripts, when the runner is deleted, then each child is separately triaged and classified or deleted, so no child becomes unclassified. | 11, 12 | "each child of a deleted runner carries its own entry or `deleted` triage line" | diff-local |
| Story 4 negative: Given an orphan script that a non-orphan script sources or references, when it is triaged, then it is not deleted unless that reference is removed in the same change and the referencing script still passes. | 8, 9, 10, 11, 12, 13 | "every script that referenced a deleted script before this task still passes under its own executor" | diff-local |
| Story 5 happy: Given every file matched by the smoke globs (`test/smoke/**` and `**/*.smoke.test.ts` under `src/conductor`) declares a `smokeCapability` from the closed capability set, when the default `npm test` suite runs, then the structural smoke-declaration assertion passes. | 7 | "asserts a non-empty result in which every capability is a member of `SMOKE_CAPABILITIES`" | diff-local |
| Story 5 happy: Given the structural assertion and the smoke runner both read declarations, when the same file is evaluated by each, then both use the same declaration parser and reach the same accepted or rejected result. | 7 | "is rejected with the identical message by `parseSmokeCapabilityDeclarations` and by `runSmokeCli`" | diff-local |
| Story 5 negative: Given a smoke file with no `smokeCapability` declaration, when the default suite runs, then the structural assertion fails and names that file. | 7 | "throws `Smoke file <file> declares no capability` for an entry without a declaration" | diff-local |
| Story 5 negative: Given a smoke file declaring a capability outside the closed set, when the default suite runs, then the structural assertion fails and names the file and the invalid capability. | 7 | "`Smoke file <file> declares invalid capability <value>` for an out-of-set value" | diff-local |
| Story 5 negative: Given the smoke glob discovery returns zero files, when the default suite runs, then the structural assertion fails rather than passing on an empty set. | 7 | "`parseSmokeCapabilityDeclarations([])` throws `Smoke discovery found no test files`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
