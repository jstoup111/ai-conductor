# Implementation Plan: Integrity suite checks fail closed (#1014)

**Date:** 2026-10-14
**Design:** `.docs/decisions/architecture-review-2026-10-14-integrity-suite-two-checks-cannot-fail-one-warns-p.md` (technical track; no PRD)
**Stories:** `.docs/stories/integrity-suite-two-checks-cannot-fail-one-warns-p.md`
**Conflict check:** Clean as of 2026-10-14 (`.docs/conflicts/2026-10-14-integrity-suite-two-checks-cannot-fail-one-warns-p.md`)

## Summary

Make checks 5, 5a, 5b, 5c, and 10 of `test/test_harness_integrity.sh` fail closed. Each changed
check moves into a standalone checker script with environment seams, paired with a fixture spec
that proves the checker still fails on the shapes it exists to catch. Five SKILL.md files gain
`model: opus` pins. 9 tasks.

## Technical Approach

- **Checker + fixture-spec split.** Follow the established pattern of check 22
  (`test/check_update_flow_config_ownership.sh` + `test/test_harness_integrity_update_flow.sh`).
  Each new checker reads its inputs through `HARNESS_INTEGRITY_*` environment seams, defaulting to
  the real tree. Its fixture spec drives it against disposable copies under `mktemp -d` and invokes
  the checker directly, never the suite, so nothing recurses. The suite runs each checker against
  the real tree and each fixture spec, and reports both through `assert` with an explicitly captured
  status (the check 29 reporting contract: never a raw `$?`). Every new script is registered in
  `test/shell_tests.manifest` with class `integrity`, as check 22's scripts are, so the orphan
  classification check passes.
  Search hints: `update_flow_checker`, `HARNESS_INTEGRITY_UPDATE_FLOW_BIN_DIR`,
  `check_update_flow_config_ownership.sh integrity integrity`.
- **Allowlists mirror check 4.** Check 4's `KNOWN_NON_SKILL_REFS` is the precedent: a bash array
  of named entries, each preceded by a comment carrying its reason. The new allowlists hold
  `name|reason` entries, so an empty reason is detectable mechanically rather than by reading
  comments.
- **Check 5 row resolution** (`test/check_model_table_presence.sh`). A skill passes when the
  model table has a row named exactly the skill. Otherwise it passes when a row-alias map names
  its rows; each alias entry is `skill|rows|reason`, and an entry with an empty reason fails: `tdd → tdd-red, tdd-green`, and `coverage-binding → coverage_binding`, the engine-step
  row `| coverage_binding (engine gate) |`. Otherwise it needs a `SKILL_NO_ROW_ALLOWLIST` entry with
  a non-empty reason. `engineer` is allowlisted, with a reason naming its pending removal. A stale
  entry (no `skills/<name>/`) fails. A row's name is its first table cell, trimmed, with one
  trailing parenthetical ` (…)` removed (so `| coverage_binding (engine gate) |` names
  `coverage_binding`); matching is exact equality on that name, never a prefix.
  Seams: `HARNESS_INTEGRITY_SKILLS_DIR`, `HARNESS_INTEGRITY_ARCHITECTURE_FILE`.
- **Check 5b both directions** (`test/check_skill_model_pins.sh`). The existing inline
  comparison moves here, keeping its seams `HARNESS_INTEGRITY_TEST_PINS_JSON` and
  `HARNESS_INTEGRITY_TEST_SKILLS_DIR`. It then also iterates the `--pins` entries. A non-exempt
  entry with an `expected` value must resolve to a `skills/<name>/SKILL.md` whose frontmatter pin
  equals it. A missing pin fails naming the skill and the expected model; a missing SKILL.md fails
  naming the unresolvable skill.
- **Prerequisites** (`test/check_integrity_prerequisites.sh <node|jq>`). This replaces the
  `warn_check` skips in 5a, 5b, and 5c. It exits non-zero with a message naming the missing
  `src/conductor/node_modules` and the `npm ci` remedy, or naming `jq`. Seams:
  `HARNESS_INTEGRITY_CONDUCTOR_DIR`, plus `PATH` for `jq`. The suite asserts the result and skips
  only that check's comparison, never the rest of the suite.
- **Check 5c on a copy** (`test/check_docs_guard_drift_fixture.sh`). The fixture copies
  `hooks/claude/docs-guard.sh` into a `mktemp -d` directory and corrupts the copy. It runs the
  generator with `GENERATE_DOCS_GUARD_HOOK_OUT` set to the copy and expects exit 1. The existing seam
  is read in `src/conductor/src/tools/generate-docs-guard-hook-main.ts`, so no generator change is
  needed. Seam `HARNESS_INTEGRITY_DOCS_GUARD_GENERATOR` (added in Task 7) substitutes a stub generator in fixtures. The
  `trap`/restore of the tracked hook is deleted, because nothing writes to the hook any more.
- **Check 10** (`test/check_task_status_writers.sh`). It scans `hooks/`, `bin/`, and `skills/`
  (`*.sh`, `*.ts`, `*.js`) with the existing write heuristic. It also scans `skills/*/SKILL.md`
  for lines that mention `task-status.json`, name an engine-only status (`completed` or
  `skipped`), and begin with an imperative write verb. The verb pattern is
  `^\s*([-*]|[0-9]+\.)?\s*(\*\*)?(reset|set|mark|write|update|edit|change|flip|append|rewrite|overwrite)\b`,
  case-insensitive. Advisory `pending`/`in_progress` writes are not flagged, because
  `adr-2026-07-05-engine-owned-task-status` D4 keeps them with the agent (the user-exit reset in
  `skills/tdd/SKILL.md` is one). On today's 20 SKILL.md mentions the rule flags none (verified by
  grep). A `PROSE_WRITE_ALLOWLIST` of `path|line-text|reason` entries covers any
  residual exception. Seam: `HARNESS_INTEGRITY_SCAN_ROOT`.
- **Sequencing.** The pins (Task 4) land before the both-directions check (Task 3) is wired, so
  the real tree passes at every task boundary.

## Prerequisites

- `src/conductor/node_modules` installed (`npm ci` in `src/conductor`) and `jq` on `PATH`; both are
  already true in CI and in dispatched build worktrees.

## Tasks

### Task 1: Check 5 resolves rows, aliases, and the no-row allowlist through a checker
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: in new `test/test_model_table_presence.sh`, build a disposable skills directory and architecture file. Assert that the checker passes for (a) a skill with an exact row, including a row written as `| name (engine gate) |`, (b) `tdd` with only `tdd-red`/`tdd-green` rows, and (c) an allowlisted row-less skill, with the output containing `allowlisted`. Also run the checker with default seams against the real tree and assert exit 0 with no `WARN` line.
2. Verify test fails (RED): the checker does not exist.
3. Implement `test/check_model_table_presence.sh` per Technical Approach: extract each row name as the first table cell, trimmed, with one trailing ` (…)` removed; then try an exact row match, then the `ROW_ALIASES` map, then `SKILL_NO_ROW_ALLOWLIST`. Its entries are `engineer|<reason naming its pending removal>` and the aliases `tdd|tdd-red,tdd-green|<reason: phase rows>` and `coverage-binding|coverage_binding|<reason: engine-step row spelling>`. Replace section 5 of `test/test_harness_integrity.sh` with invocations of the checker (real tree) and the spec, each reported through `assert` with a captured status. Register both scripts in `test/shell_tests.manifest` as `integrity`, following check 22's entries.
4. Verify test passes (GREEN).
5. Commit: "test(integrity): check 5 resolves model-table rows via checker with alias map and reasoned allowlist"

**Done when:**
- [test] `test/test_model_table_presence.sh` asserts `test/check_model_table_presence.sh` exits 0 for an exact-row skill, for `tdd` covered only by `tdd-red`/`tdd-green` rows, and for an allowlisted row-less skill whose output names it as allowlisted
- [test] The same spec runs the checker against the real tree and asserts exit 0 and no `WARN` line; on this tree `coverage-binding` passes through its `coverage_binding` alias row and `engineer` passes through an allowlist entry whose reason names its pending removal
- Check 5 proper (the `5. ARCHITECTURE.md model table` section, ending before the `5a.` header) of `test/test_harness_integrity.sh` contains no `warn_check` call and reports the checker and the spec each through `assert` with a captured exit status
- `test/shell_tests.manifest` lists `check_model_table_presence.sh` and `test_model_table_presence.sh` with class `integrity`

**Files likely touched:**
- `test/check_model_table_presence.sh` — new checker
- `test/test_model_table_presence.sh` — new fixture spec
- `test/test_harness_integrity.sh` — section 5 invokes checker and spec
- `test/shell_tests.manifest` — register both scripts

**Dependencies:** none

### Task 2: Check 5 fails on row-less, reasonless, stale, and prefix-only skills
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_model_table_presence.sh`. Each case is a disposable fixture asserting the checker's exit code and output: (a) an unlisted row-less skill fails, and the message names it; (b) an allowlist entry with an empty reason fails, and the message names the entry; (c) an allowlist entry naming a skill with no `skills/<name>/` fails, reporting the stale entry; (d) a fixture whose `tdd` has only a `tdd-review` row fails for `tdd`. The allowlist and alias map are overridden through the `HARNESS_INTEGRITY_MODEL_TABLE_ALLOWLIST` and `HARNESS_INTEGRITY_MODEL_TABLE_ALIASES` seams (newline-separated `name|value` entries).
2. Verify tests fail (RED): the empty-reason (allowlist and alias) and stale-entry validation, and the override seams, do not exist yet.
3. Implement: add the two override seams, the validation of allowlist entries (empty reason, stale entry), and the empty-reason validation of alias entries to `test/check_model_table_presence.sh`. Keep row matching exact, never by prefix.
4. Verify tests pass (GREEN).
5. Commit: "test(integrity): check 5 rejects row-less, reasonless, stale, and prefix-only skills"

**Done when:**
- [test] `test/test_model_table_presence.sh` asserts the checker exits non-zero naming the skill for a row-less skill with no alias and no allowlist entry
- [test] The spec asserts a non-zero exit naming the entry for an allowlist entry with an empty reason, and a non-zero exit reporting the stale entry for an allowlist entry whose `skills/<name>/` directory is absent
- [test] The spec asserts a non-zero exit naming `tdd` when the fixture table has a `tdd-review` row but no `tdd-red` or `tdd-green` row
- [test] The spec asserts a non-zero exit naming the alias when a `ROW_ALIASES` entry has an empty reason
- Because the suite reports the spec's exit through `assert`, if the checker ever stopped rejecting any of these cases the spec would exit non-zero and the integrity suite would fail

**Files likely touched:**
- `test/check_model_table_presence.sh` — allowlist validation and override seams
- `test/test_model_table_presence.sh` — negative cases

**Dependencies:** Task 1

### Task 3: Check 5b enforces pins in both directions through a checker
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in new `test/test_skill_model_pins.sh`. Drive the checker through `HARNESS_INTEGRITY_TEST_PINS_JSON` and `HARNESS_INTEGRITY_TEST_SKILLS_DIR`, asserting exit code and message per case. Pass cases: matching `opus` pin; exempt entry with no pin; skill with no entry and no pin. Fail cases: non-exempt `expected: opus` with no `model:` line (message names the skill and `opus`); non-exempt entry with no `skills/<name>/SKILL.md` (message names the skill); `sonnet` pin vs `opus` expected (disagreement); pin with no entry (unmapped); malformed JSON.
2. Verify tests fail (RED): the checker does not exist.
3. Implement `test/check_skill_model_pins.sh`. Move section 5b's comparison out of `test/test_harness_integrity.sh` unchanged, then add the second loop over `--pins` entries per Technical Approach. Replace section 5b with the checker (real tree) plus spec invocations, reported through `assert` with captured statuses. Register both scripts in `test/shell_tests.manifest` as `integrity`.
4. Verify tests pass (GREEN).
5. Commit: "test(integrity): check 5b enforces expected-model pins in both directions"

**Done when:**
- [test] `test/test_skill_model_pins.sh` asserts `test/check_skill_model_pins.sh` exits non-zero with a message naming the skill and the expected model `opus` for a non-exempt `--pins` entry whose SKILL.md has no `model:` line
- [test] The spec asserts a non-zero exit naming the skill for a non-exempt entry with no `skills/<name>/SKILL.md`, and non-zero exits for a `sonnet`-vs-`opus` disagreement, an unmapped pin, and malformed JSON
- [test] The spec asserts exit 0 for a matching `opus` pin, an exempt entry with no pin, and a skill with neither an entry nor a pin
- [test] The spec runs the checker against the real tree (real `bin/generate-model-table --pins`) and asserts exit 0, with output naming `architecture-review`, `explore`, `prd`, `rebase`, and `remediate` as passing
- Section 5b of `test/test_harness_integrity.sh` reports the checker and the spec through `assert` with captured statuses, and `test/shell_tests.manifest` lists both scripts with class `integrity`

**Files likely touched:**
- `test/check_skill_model_pins.sh` — new checker
- `test/test_skill_model_pins.sh` — new fixture spec
- `test/test_harness_integrity.sh` — section 5b invokes checker and spec
- `test/shell_tests.manifest` — register both scripts

**Dependencies:** Task 4

### Task 4: Pin the five opus-expected skills
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing test: `bash -c` over the five SKILL.md files, asserting each frontmatter (between the first two `---` lines) contains `model: opus`. The check passes once the pins are added; it lives as the real-tree case already specified in Task 3, so this task's own RED is the frontmatter grep.
2. Verify the grep fails (RED).
3. Implement: add `model: opus` to the frontmatter of `skills/architecture-review/SKILL.md`, `skills/explore/SKILL.md`, `skills/prd/SKILL.md`, `skills/rebase/SKILL.md`, and `skills/remediate/SKILL.md`, after the `description:` line. Change nothing else.
4. Verify the grep passes (GREEN), and `bin/generate-model-table --pins` still reports `opus` as expected for all five.
5. Commit: "chore(skills): pin opus on skills the engine expects on opus"

**Done when:**
- The frontmatter of each of `skills/architecture-review/SKILL.md`, `skills/explore/SKILL.md`, `skills/prd/SKILL.md`, `skills/rebase/SKILL.md`, and `skills/remediate/SKILL.md` contains the line `model: opus`
- `bin/generate-model-table --pins` reports `"expected":"opus"` for each of the five, so its pin equals the engine-expected value
- No other line of the five files changes (diff touches frontmatter only)

**Files likely touched:**
- `skills/architecture-review/SKILL.md` — add pin
- `skills/explore/SKILL.md` — add pin
- `skills/prd/SKILL.md` — add pin
- `skills/rebase/SKILL.md` — add pin
- `skills/remediate/SKILL.md` — add pin

**Dependencies:** none

### Task 5: Checks 5a, 5b, and 5c fail when node_modules or jq is missing
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in new `test/test_integrity_prerequisites.sh`, driving the new checker through `HARNESS_INTEGRITY_CONDUCTOR_DIR` and a restricted `PATH`. Cases: `node` with a conductor dir lacking `node_modules` exits non-zero, printing `src/conductor/node_modules` and `npm ci`; `jq` with a `PATH` that has no `jq` exits non-zero, printing `jq`; both with prerequisites present exit 0.
2. Verify tests fail (RED): the checker does not exist.
3. Implement `test/check_integrity_prerequisites.sh`. In `test/test_harness_integrity.sh`, replace the three `warn_check` skips: 5a and 5c call the checker with `node`; 5b calls it with `node` then `jq`. On a failure, the suite calls `assert "<message>" 1` with the captured status and skips only that check's comparison. The branch contains no `exit` or `return`, so later sections still run and the summary counts the failure. Run the spec from the suite through `assert` with a captured status, and register both scripts in `test/shell_tests.manifest` as `integrity`.
4. Verify tests pass (GREEN).
5. Commit: "test(integrity): missing node_modules or jq fails checks 5a/5b/5c instead of warn-skipping"

**Done when:**
- [test] `test/test_integrity_prerequisites.sh` asserts `test/check_integrity_prerequisites.sh node` exits non-zero and prints both `src/conductor/node_modules` and `npm ci` when `HARNESS_INTEGRITY_CONDUCTOR_DIR` has no `node_modules`
- [test] The spec asserts `test/check_integrity_prerequisites.sh jq` exits non-zero and prints `jq` when `PATH` lacks `jq`, while `node` with `node_modules` present still exits 0 (so 5a and 5c still execute)
- [test] The spec asserts both modes exit 0 when `node_modules` exists and `jq` is on `PATH`
- Sections 5a, 5b, and 5c of `test/test_harness_integrity.sh` contain no `warn_check` call; each reports a prerequisite failure via `assert … 1` with a captured status, with no `exit` or `return` in that branch, so later sections still run and the failed count includes it
- `test/shell_tests.manifest` lists `check_integrity_prerequisites.sh` and `test_integrity_prerequisites.sh` with class `integrity`

**Files likely touched:**
- `test/check_integrity_prerequisites.sh` — new checker
- `test/test_integrity_prerequisites.sh` — new fixture spec
- `test/test_harness_integrity.sh` — sections 5a/5b/5c call the checker
- `test/shell_tests.manifest` — register both scripts

**Dependencies:** Task 3

### Task 6: Check 5c runs its drift fixture on a temporary copy
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in new `test/test_docs_guard_drift_fixture.sh`. Record `sha256sum hooks/claude/docs-guard.sh` and run the new checker with the real generator. Assert exit 0 (the generator reported drift, exit 1, against the corrupted copy). Assert the tracked hook's hash is unchanged and `git status --porcelain hooks/claude/docs-guard.sh` is empty.
2. Verify tests fail (RED): the checker does not exist.
3. Implement `test/check_docs_guard_drift_fixture.sh`. Copy the hook into a `mktemp -d` directory and append the corruption line to the copy. Run `bin/generate-docs-guard-hook --check` with `GENERATE_DOCS_GUARD_HOOK_OUT=<copy>`. Exit 0 only when the generator exits 1, and remove the temp directory on exit. In section 5c of `test/test_harness_integrity.sh`, delete the backup, corrupt, `trap`, and restore block. Keep the no-drift `--check` against the tracked path, and report the checker and spec through `assert` with captured statuses. Register both scripts in `test/shell_tests.manifest` as `integrity`.
4. Verify tests pass (GREEN).
5. Commit: "test(integrity): check 5c drift fixture corrupts a temporary copy, never the tracked hook"

**Done when:**
- [test] `test/test_docs_guard_drift_fixture.sh` asserts `test/check_docs_guard_drift_fixture.sh` exits 0 because the generator's `--check` exits 1 against the corrupted temporary copy passed through `GENERATE_DOCS_GUARD_HOOK_OUT`
- [test] The spec asserts the `sha256sum` of `hooks/claude/docs-guard.sh` is identical before and after the checker runs, and `git status --porcelain hooks/claude/docs-guard.sh` is empty
- Section 5c of `test/test_harness_integrity.sh` and `test/check_docs_guard_drift_fixture.sh` contain no write, append, `cp`, or redirection whose destination is `hooks/claude/docs-guard.sh`, and no `trap` restoring it
- Section 5c still asserts `bin/generate-docs-guard-hook --check` passes against the tracked hook (no-drift assertion) through `assert` with a captured status
- Running the full `bash test/test_harness_integrity.sh` to completion from a clean checkout leaves `sha256sum hooks/claude/docs-guard.sh` byte-identical to its pre-run value and `git status --porcelain hooks/claude/docs-guard.sh` empty

**Files likely touched:**
- `test/check_docs_guard_drift_fixture.sh` — new checker
- `test/test_docs_guard_drift_fixture.sh` — new fixture spec
- `test/test_harness_integrity.sh` — section 5c rewired
- `test/shell_tests.manifest` — register both scripts

**Dependencies:** Task 5

### Task 7: Check 5c fixture survives interruption and fails on a broken override or temp failure
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_docs_guard_drift_fixture.sh`, each asserting exit code and output. (a) Start the checker with a stub generator (via `HARNESS_INTEGRITY_DOCS_GUARD_GENERATOR`) that sleeps, send SIGKILL, then assert the tracked hook's hash is unchanged. Repeat with SIGINT. (b) A stub generator that ignores `GENERATE_DOCS_GUARD_HOOK_OUT` and checks the clean tracked hook (exit 0): assert the checker exits non-zero. (c) `TMPDIR` set to a nonexistent directory: assert the checker exits non-zero with a message naming the temporary-copy failure, and the tracked hook's hash is unchanged.
2. Verify tests fail (RED): the stub-generator seam and the explicit temp-failure handling do not exist yet.
3. Implement: honor `HARNESS_INTEGRITY_DOCS_GUARD_GENERATOR` in `test/check_docs_guard_drift_fixture.sh`. Fail with a named message when `mktemp` or the copy fails, without ever falling back to the tracked path.
4. Verify tests pass (GREEN).
5. Commit: "test(integrity): check 5c fixture fails closed on a broken override or temp-copy failure"

**Done when:**
- [test] `test/test_docs_guard_drift_fixture.sh` asserts the `sha256sum` of `hooks/claude/docs-guard.sh` is unchanged after the checker is killed with SIGKILL, and again with SIGINT, while its stub generator is running
- [test] The spec asserts the checker exits non-zero when the stub generator ignores `GENERATE_DOCS_GUARD_HOOK_OUT` and exits 0 against the clean tracked hook
- [test] The spec asserts the checker exits non-zero with a message naming the temporary-copy failure when `TMPDIR` points at a nonexistent directory, and that the tracked hook's hash is unchanged

**Files likely touched:**
- `test/check_docs_guard_drift_fixture.sh` — stub seam and temp-failure handling
- `test/test_docs_guard_drift_fixture.sh` — negative cases

**Dependencies:** Task 6

### Task 8: Check 10 scans skills scripts through a checker
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in new `test/test_task_status_writers.sh` against a disposable scan root (`HARNESS_INTEGRITY_SCAN_ROOT`). (a) `skills/x/run.sh` containing `echo '{}' > .pipeline/task-status.json` fails, naming `skills/x/run.sh` and its line. (b) The same write under `hooks/` fails, and under `bin/` fails. (c) A clean tree passes. (d) The real tree, with default seams, passes.
2. Verify tests fail (RED): the checker does not exist.
3. Implement `test/check_task_status_writers.sh`. Move section 10's grep and write heuristic out of `test/test_harness_integrity.sh` unchanged, add `skills` to the scanned roots, and rewrite the check's comment so it names the roots (`hooks/`, `bin/`, `skills/`) and file kinds (`*.sh`, `*.ts`, `*.js`) it scans. Replace section 10 with the checker plus spec invocations, reported through `assert` with captured statuses. Register both scripts in `test/shell_tests.manifest` as `integrity`.
4. Verify tests pass (GREEN).
5. Commit: "test(integrity): check 10 audits skills/ scripts for task-status writers"

**Done when:**
- [test] `test/test_task_status_writers.sh` asserts `test/check_task_status_writers.sh` exits non-zero and prints `skills/x/run.sh` with its line number for a skills script that redirects into `.pipeline/task-status.json`
- [test] The spec asserts non-zero exits for the same write placed under `hooks/` and under `bin/`, and exit 0 for a clean fixture tree and for the real tree
- The checker's header comment names the scan roots `hooks/`, `bin/`, and `skills/` and the file kinds `*.sh`, `*.ts`, `*.js`, and claims no root it does not scan; section 10 of `test/test_harness_integrity.sh` reports the checker and spec through `assert` with captured statuses
- `test/shell_tests.manifest` lists `check_task_status_writers.sh` and `test_task_status_writers.sh` with class `integrity`

**Files likely touched:**
- `test/check_task_status_writers.sh` — new checker
- `test/test_task_status_writers.sh` — new fixture spec
- `test/test_harness_integrity.sh` — section 10 invokes checker and spec
- `test/shell_tests.manifest` — register both scripts

**Dependencies:** none

### Task 9: Check 10 flags SKILL.md instructions to write engine-only statuses
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_task_status_writers.sh` using fixture SKILL.md files. The checker must fail, naming file and line, for `Mark the task `completed` in `.pipeline/task-status.json`.` and for `Set the row to `skipped` in `.pipeline/task-status.json`.`. It must pass for `2. **Reset the task to `pending`** in `.pipeline/task-status.json` if you marked it `in_progress`.`, for the descriptive line `` `task-9`) flips that row to `in_progress` in `.pipeline/task-status.json` and writes ``, and for the read-only line `Then read `.pipeline/task-status.json` and confirm the row reads `completed`.`. It must pass for a flagged line covered by a `PROSE_WRITE_ALLOWLIST` entry with a reason (set through `HARNESS_INTEGRITY_TASK_STATUS_PROSE_ALLOWLIST`), and fail, naming the entry, when that entry's reason is empty. Finally, it must pass against the real tree with the prose scan enabled.
2. Verify tests fail (RED): the prose scan does not exist.
3. Implement: in `test/check_task_status_writers.sh`, scan `skills/*/SKILL.md` lines that contain `task-status.json`, contain `completed` or `skipped`, and match the case-insensitive imperative verb pattern `^\s*([-*]|[0-9]+\.)?\s*(\*\*)?(reset|set|mark|write|update|edit|change|flip|append|rewrite|overwrite)\b` (a line opening with `Check`, `read`, `Then read`, or a table pipe does not match). Advisory `pending`/`in_progress` instructions stay legal per `adr-2026-07-05-engine-owned-task-status` D4. Add `PROSE_WRITE_ALLOWLIST` (`path|line-text|reason`, empty by default) with the override seam and empty-reason validation. Extend the header comment to name the SKILL.md prose rule.
4. Verify tests pass (GREEN).
5. Commit: "test(integrity): check 10 flags SKILL.md instructions to write completed/skipped task status"

**Done when:**
- [test] `test/test_task_status_writers.sh` asserts `test/check_task_status_writers.sh` exits non-zero naming the fixture file and line for a SKILL.md line instructing a `completed` write and for one instructing a `skipped` write to `.pipeline/task-status.json`
- [test] The spec asserts exit 0 for a fixture containing only the `pending`-reset line (`Reset the task to `pending``), the descriptive hook line (`flips that row to `in_progress``), and the read-only `confirm the row reads `completed`` line
- [test] The spec asserts exit 0 when a flagged line is covered by a `PROSE_WRITE_ALLOWLIST` entry with a non-empty reason, and a non-zero exit naming the entry when that entry's reason is empty
- [test] The spec runs the checker with the prose scan enabled against the real tree and asserts exit 0
- The header comment of `test/check_task_status_writers.sh` names everything it scans: `*.sh`, `*.ts`, `*.js` under `hooks/`, `bin/`, `skills/`, plus `completed`/`skipped` write-instruction prose in `skills/*/SKILL.md`

**Files likely touched:**
- `test/check_task_status_writers.sh` — prose scan and allowlist
- `test/test_task_status_writers.sh` — prose cases

**Dependencies:** Task 8

## Task Dependency Graph

```
Task 1 ──▶ Task 2
Task 4 ──▶ Task 3 ──▶ Task 5 ──▶ Task 6 ──▶ Task 7
Task 8 ──▶ Task 9
```

Tasks 3, 5, and 6 are chained because each rewrites adjacent sections (5a–5c) of
`test/test_harness_integrity.sh`.

## Integration Points

- After Task 1: `test/test_harness_integrity.sh` runs the first extracted checker and its spec end to end.
- After Task 5: every 5a/5b/5c prerequisite path reports into the suite's counters.
- After Task 9: a full suite run exercises every changed check against the real tree.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a skill directory whose name has its own row in the `ARCHITECTURE.md` model table, when check 5 runs, then that skill passes | 1 | "exits 0 for an exact-row skill" | diff-local |
| Story 1 happy: Given the `tdd` skill directory and model-table rows `tdd-red` and `tdd-green` but no `tdd` row, when check 5 runs, then `tdd` passes because its phase rows cover it | 1 | "for `tdd` covered only by `tdd-red`/`tdd-green` rows" | diff-local |
| Story 1 happy: Given a skill with no row that appears on check 5's no-row allowlist with a non-empty reason, when check 5 runs, then that skill passes and the output names it as allowlisted | 1 | "for an allowlisted row-less skill whose output names it as allowlisted" | diff-local |
| Story 1 happy: Given the repository as delivered by this change, when check 5 runs, then every skill passes and check 5 emits no WARN line | 1 | "runs the checker against the real tree and asserts exit 0 and no `WARN` line" | diff-local |
| Story 1 negative: Given a skill directory with no model-table row, no phase rows, and no allowlist entry, when check 5 runs, then check 5 fails with a message naming that skill | 2 | "exits non-zero naming the skill for a row-less skill with no alias and no allowlist entry" | diff-local |
| Story 1 negative: Given an allowlist entry whose reason is empty, when check 5 runs, then check 5 fails naming the entry instead of treating it as exempt | 2 | "a non-zero exit naming the entry for an allowlist entry with an empty reason" | diff-local |
| Story 1 negative: Given an allowlist entry naming a skill that has no `skills/<name>/` directory, when check 5 runs, then check 5 fails reporting the stale entry | 2 | "a non-zero exit reporting the stale entry for an allowlist entry whose `skills/<name>/` directory is absent" | diff-local |
| Story 1 negative: Given a model-table row `tdd-review` (a `tdd-` prefix that is not one of the skill's phase rows) but no `tdd-red` or `tdd-green` row, when check 5 runs, then `tdd` is not satisfied by prefix alone and fails unless allowlisted | 2 | "a non-zero exit naming `tdd` when the fixture table has a `tdd-review` row but no `tdd-red` or `tdd-green` row" | diff-local |
| Story 2 happy: Given a non-exempt `--pins` entry expecting `opus` and a SKILL.md pinning `model: opus`, when check 5b runs, then that skill passes | 3 | "asserts exit 0 for a matching `opus` pin" | diff-local |
| Story 2 happy: Given a `--pins` entry marked exempt and a SKILL.md with no pin, when check 5b runs, then that skill passes as exempt | 3 | "an exempt entry with no pin" | diff-local |
| Story 2 happy: Given a skill with no `--pins` entry and no `model:` pin, when check 5b runs, then that skill passes without comparison | 3 | "a skill with neither an entry nor a pin" | diff-local |
| Story 2 happy: Given the repository as delivered by this change, when check 5b runs, then `architecture-review`, `explore`, `prd`, `rebase`, and `remediate` each pin `model: opus` and pass | 3, 4 | "with output naming `architecture-review`, `explore`, `prd`, `rebase`, and `remediate` as passing" | diff-local |
| Story 2 negative: Given a non-exempt `--pins` entry expecting `opus` and a SKILL.md with no `model:` line, when check 5b runs, then check 5b fails naming the skill and the expected model | 3 | "exits non-zero with a message naming the skill and the expected model `opus`" | diff-local |
| Story 2 negative: Given a non-exempt `--pins` entry naming a skill that has no `skills/<name>/SKILL.md`, when check 5b runs, then check 5b fails naming the unresolvable skill rather than skipping it | 3 | "a non-zero exit naming the skill for a non-exempt entry with no `skills/<name>/SKILL.md`" | diff-local |
| Story 2 negative: Given a SKILL.md pinning `model: sonnet` where `--pins` expects `opus`, when check 5b runs, then check 5b still fails as a disagreement (existing direction unchanged) | 3 | "non-zero exits for a `sonnet`-vs-`opus` disagreement" | diff-local |
| Story 2 negative: Given a SKILL.md pin with no `--pins` entry, when check 5b runs, then check 5b still fails as unmapped (existing direction unchanged) | 3 | "an unmapped pin" | diff-local |
| Story 3 happy: Given a clean checkout, when the full integrity suite runs to completion, then `hooks/claude/docs-guard.sh` is byte-identical to its pre-run content and `git status` shows it unmodified | 6 | "Running the full `bash test/test_harness_integrity.sh` to completion from a clean checkout leaves `sha256sum hooks/claude/docs-guard.sh` byte-identical to its pre-run value and `git status --porcelain hooks/claude/docs-guard.sh` empty" | diff-local |
| Story 3 happy: Given the drift fixture, when check 5c runs it, then the generator's `--check` reports drift (exit 1) against a corrupted temporary copy and check 5c passes the fixture assertion | 6 | "exits 0 because the generator's `--check` exits 1 against the corrupted temporary copy passed through `GENERATE_DOCS_GUARD_HOOK_OUT`" | diff-local |
| Story 3 happy: Given the committed hook matches the generator source, when check 5c runs, then the no-drift assertion passes against the tracked path | 6 | "Section 5c still asserts `bin/generate-docs-guard-hook --check` passes against the tracked hook (no-drift assertion)" | diff-local |
| Story 3 negative: Given check 5c is interrupted (SIGINT or SIGKILL) while its fixture is running, when the working tree is inspected afterward, then `hooks/claude/docs-guard.sh` is unmodified, because the fixture never wrote to it | 7, 6 | "is unchanged after the checker is killed with SIGKILL, and again with SIGINT" | diff-local |
| Story 3 negative: Given the generator ignores the target-path override and checks the tracked hook instead, when the fixture runs, then the fixture assertion fails (the clean tracked hook yields exit 0, not 1) rather than passing silently | 7 | "exits non-zero when the stub generator ignores `GENERATE_DOCS_GUARD_HOOK_OUT` and exits 0 against the clean tracked hook" | diff-local |
| Story 3 negative: Given the temporary copy cannot be created, when check 5c runs, then the fixture assertion fails with a message naming the failure rather than falling back to writing the tracked hook | 7 | "exits non-zero with a message naming the temporary-copy failure when `TMPDIR` points at a nonexistent directory, and that the tracked hook's hash is unchanged" | diff-local |
| Story 4 happy: Given `src/conductor/node_modules` exists and `jq` is on `PATH`, when the suite runs, then checks 5a, 5b, and 5c execute their comparisons and emit no WARN-skip line | 5 | "asserts both modes exit 0 when `node_modules` exists and `jq` is on `PATH`" | diff-local |
| Story 4 negative: Given `src/conductor/node_modules` is absent, when the suite runs, then checks 5a, 5b, and 5c fail with a message naming the missing directory and the `npm ci` remedy in `src/conductor`, and the suite exits non-zero | 5 | "prints both `src/conductor/node_modules` and `npm ci` when `HARNESS_INTEGRITY_CONDUCTOR_DIR` has no `node_modules`" | diff-local |
| Story 4 negative: Given `node_modules` is present but `jq` is not on `PATH`, when the suite runs, then check 5b fails with a message naming `jq` as missing, and checks 5a and 5c still execute | 5 | "exits non-zero and prints `jq` when `PATH` lacks `jq`, while `node` with `node_modules` present still exits 0 (so 5a and 5c still execute)" | diff-local |
| Story 4 negative: Given `node_modules` is absent, when the suite runs, then later checks after 5c still run and the summary counts every failure (the run does not abort) | 5 | "with no `exit` or `return` in that branch, so later sections still run and the failed count includes it" | diff-local |
| Story 5 happy: Given a SKILL.md line that only describes engine or hook behavior (for example, a hook "flips that row to `in_progress` in `.pipeline/task-status.json`"), when check 10 runs, then the line is not flagged | 9 | "the descriptive hook line (`flips that row to `in_progress``)" | diff-local |
| Story 5 happy: Given a SKILL.md line that only reads the file (for example, "read `.pipeline/task-status.json` and confirm the row reads `completed`"), when check 10 runs, then the line is not flagged | 9 | "the read-only `confirm the row reads `completed`` line" | diff-local |
| Story 5 happy: Given a SKILL.md line instructing an advisory scheduling write (for example, "Reset the task to `pending` in `.pipeline/task-status.json`"), when check 10 runs, then the line is not flagged | 9 | "asserts exit 0 for a fixture containing only the `pending`-reset line (`Reset the task to `pending``)" | diff-local |
| Story 5 happy: Given a SKILL.md line on check 10's prose allowlist with a non-empty reason, when check 10 runs, then the line is not flagged | 9 | "asserts exit 0 when a flagged line is covered by a `PROSE_WRITE_ALLOWLIST` entry with a non-empty reason" | diff-local |
| Story 5 happy: Given the repository as delivered by this change, when check 10 runs, then it passes | 8, 9 | "runs the checker with the prose scan enabled against the real tree and asserts exit 0" | diff-local |
| Story 5 negative: Given a script under `skills/` that writes `.pipeline/task-status.json` (for example, `echo '{}' > .pipeline/task-status.json` in a `.sh` file), when check 10 runs, then check 10 fails naming the file and line | 8 | "exits non-zero and prints `skills/x/run.sh` with its line number" | diff-local |
| Story 5 negative: Given a SKILL.md line instructing an agent to write an engine-only status (for example, "Mark the task `completed` in `.pipeline/task-status.json`"), when check 10 runs, then check 10 fails naming the file and line | 9 | "exits non-zero naming the fixture file and line for a SKILL.md line instructing a `completed` write" | diff-local |
| Story 5 negative: Given a SKILL.md line instructing a `skipped` write (for example, "Set the row to `skipped` in `.pipeline/task-status.json`"), when check 10 runs, then check 10 fails naming the file and line | 9 | "and for one instructing a `skipped` write to `.pipeline/task-status.json`" | diff-local |
| Story 5 negative: Given a prose allowlist entry with an empty reason, when check 10 runs, then check 10 fails naming the entry | 9 | "a non-zero exit naming the entry when that entry's reason is empty" | diff-local |
| Story 5 negative: Given a write to `.pipeline/task-status.json` under `hooks/` or `bin/`, when check 10 runs, then check 10 still fails (existing coverage unchanged) | 8 | "asserts non-zero exits for the same write placed under `hooks/` and under `bin/`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-03-generated-model-table-single-source#D1 | existing | none | `src/conductor/src/engine/model-table-metadata.ts` exports the typed step rationale, extra rows, `SKILL_STEP_MAP`, and `PIN_EXEMPT_SKILLS` consumed by `bin/generate-model-table --pins`; this feature reads that output and does not change the metadata |
| adr-2026-07-03-generated-model-table-single-source#D2 | existing | none | `bin/generate-model-table` runs the TypeScript tool through `src/conductor/node_modules/.bin/tsx`; the new prerequisite checker only verifies that installation exists before 5a/5b run |
| adr-2026-07-03-generated-model-table-single-source#D3 | existing | none | `ARCHITECTURE.md` carries the `<!-- BEGIN GENERATED: model-selection-table -->` region (per the ADR's 2026-10-05 amendment); check 5 reads rows from it and this feature does not regenerate or edit it |
| adr-2026-07-03-generated-model-table-single-source#D4 | task | task-1, task-2, task-3, task-5 | Sections 5a, 5b, and 5c of `test/test_harness_integrity.sh` contain no `warn_check` call |
| adr-2026-07-03-generated-model-table-single-source#D5 | no-change | none | Table shape (per-step rows, tier-override suffixes, explicit `complexity` and `architecture_review_as_built` rows) is generator output this feature does not alter; check 5 reads only each row's first cell, trimmed with one trailing ` (…)` removed |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
