# Implementation Plan: bin/conduct unknown-subcommand guard

**Date:** 2026-07-03
**Design:** technical track — no PRD; approach recorded in `.memory/decisions/bin-conduct-unknown-subcommand-guard.md`
**Stories:** `.docs/stories/bin-conduct-unknown-subcommand-guard.md` (TECH-1..TECH-4, Status: Accepted)
**Conflict check:** skipped — Tier S (`.docs/complexity/bin-conduct-unknown-subcommand-guard.md`)
**Source:** jstoup111/ai-conductor#178

## Summary

Add a minimal fail-loudly guard to `bin/conduct`'s argument loop so unknown options, unknown bare
words, and `conduct-ts`-only subcommands can never be silently coerced into `FEATURE_DESC` and
launch a pipeline. 12 tasks, one new bash test file.

## Technical Approach

All changes live in `bin/conduct` (plus tests/docs). `bin/conduct` is condemned by the v1.0
cutover (#228), so this is deliberately the smallest protective guard, not a dispatch rewrite:

- **Forwarding gate (top of arg handling, extends line 2805).** Replace the single
  `daemon` special-case with a small first-token gate: if `$1` is one of the `conduct-ts`-owned
  verbs — `daemon`, `render-diagrams`, `register`, `create`, `engineer`, `inline`, `help` — then
  require `conduct-ts` on PATH (`command -v`; if missing, print an error naming `conduct-ts` and
  `exit 127`) and `exec conduct-ts "$@"`. `exec` preserves argv and exit status by construction.
- **Unknown-option branch.** In the `while/case` loop, insert `-*)` before the `*)` catch-all:
  print `Unknown option: <token>` + a pointer to `conduct --help` on stderr, `exit 1`. Because a
  dash-leading token can never reach `*)`, quoted strings like `"--weird feature name"` are also
  rejected (TECH-4 negative path).
- **Bare-word guard in `*)`.** Before assigning `FEATURE_DESC`, test the token for whitespace
  (`case "$1" in *[[:space:]]*)`). Tokens with whitespace assign `FEATURE_DESC` exactly as today;
  a single bare word prints `Unknown command: <word>` + the hint to quote a multi-word feature
  description, `exit 1`.
- **Ordering caveat:** the option loop `shift`s through all args, so the rejection branches fire
  regardless of position — matching TECH-1's "unknown option after a valid description still
  fails" criterion with no extra code.
- **Tests** go in a new `test/test_conduct_arg_guard.sh` following `test_conduct_worktree.sh`
  conventions (temp git repos, PASS/FAIL counters, no Claude invocation). Forwarding is tested
  with a fake `conduct-ts` shim prepended to PATH that records argv and returns a chosen exit
  code, plus one real-binary smoke (per the injected-runner rule). "No pipeline started" is
  asserted as: no `.pipeline/` state/session/log files created in the temp repo.
- **Docs & release gates:** update `usage()` in `bin/conduct` and README; CHANGELOG gets an
  `[Unreleased]` **Fixed** entry AND a `## Migration` section with a runnable ```bash migration```
  block (required because this changes `bin/conduct` CLI behavior — the block is advisory: it
  echoes the new unknown-command contract; there is no state to migrate).

## Prerequisites

- None — single-file bash change; test harness pattern already exists in `test/`.

## Tasks

### Task 1: Scaffold test/test_conduct_arg_guard.sh
**Story:** infrastructure for TECH-1..TECH-4
**Type:** infrastructure

**Steps:**
1. Create `test/test_conduct_arg_guard.sh` copying the conventions of `test/test_conduct_worktree.sh`: `set -euo pipefail`, SCRIPT_DIR/HARNESS_DIR/CONDUCT resolution, PASS/FAIL/TOTAL counters, `make_temp_repo` helper (git init + minimal harness markers), cleanup trap.
2. Add helpers: `make_conduct_ts_shim <exit_code>` (writes an executable fake `conduct-ts` into a temp dir that dumps `"$@"` to a capture file and exits with the given code) and `assert_no_pipeline_state <repo>` (asserts `.pipeline/` has no state/session/log files).
3. Add a trivial self-test (helper creates shim, shim is executable) so the file runs green standalone.
4. Verify: `bash -n test/test_conduct_arg_guard.sh` and a run of the file pass.
5. Commit: "test(conduct): scaffold arg-guard test harness"

**Files likely touched:**
- `test/test_conduct_arg_guard.sh` — new

**Dependencies:** none

### Task 2: RED — unknown option is rejected (TECH-1 happy)
**Story:** TECH-1 — both happy-path criteria
**Type:** happy-path

**Steps:**
1. Write failing tests: `conduct --frobnicate` in a temp repo (a) exits non-zero, (b) stderr contains `Unknown option: --frobnicate` and mentions `--help`, (c) `assert_no_pipeline_state` passes.
2. Verify tests fail (RED) — today the token becomes `FEATURE_DESC`. Use a guard (e.g. `CONDUCT_TEST_NO_CLAUDE=1`-style env or timeout) consistent with existing tests so RED doesn't actually launch a pipeline.
3. No implementation in this task.

**Files likely touched:**
- `test/test_conduct_arg_guard.sh` — add tests

**Dependencies:** Task 1

### Task 3: GREEN — add `-*)` unknown-option branch
**Story:** TECH-1 — happy paths
**Type:** happy-path

**Steps:**
1. Implement: in the `while [[ $# -gt 0 ]]` case at bin/conduct:2808, insert before `*)`:
   `-*) echo "Unknown option: $1" >&2; echo "Run 'conduct --help' for usage." >&2; exit 1 ;;`
2. Verify Task 2 tests pass (GREEN); `bash -n bin/conduct` passes.
3. Commit: "fix(conduct): reject unknown options instead of coercing into FEATURE_DESC"

**Files likely touched:**
- `bin/conduct` — arg loop

**Dependencies:** Task 2

### Task 4: Negative-path tests — existing options unaffected; late unknown option still fails (TECH-1 negatives)
**Story:** TECH-1 — both negative paths
**Type:** negative-path

**Steps:**
1. Write tests: (a) `conduct --help` still exits 0 and prints usage; (b) `conduct --status` in a temp repo exits 0 (parses, shows dashboard); (c) `conduct "add login form" --frobnicate` exits non-zero with `Unknown option: --frobnicate` and no pipeline state.
2. Verify all pass against Task 3's implementation (they should — characterization); if any fails, fix the branch ordering, not the test.
3. Commit: "test(conduct): unknown-option guard preserves existing flags, rejects late unknowns"

**Files likely touched:**
- `test/test_conduct_arg_guard.sh`

**Dependencies:** Task 3

### Task 5: RED — conduct-ts verbs forward with identical argv (TECH-2 happy)
**Story:** TECH-2 — happy paths (forwarding + daemon regression)
**Type:** happy-path

**Steps:**
1. Write failing tests using the shim: (a) `conduct render-diagrams --check X` with shim on PATH → capture file contains exactly `render-diagrams --check X`, exit code equals shim's (test with 0 and 3); (b) `conduct daemon status` still reaches the shim with argv `daemon status` (regression for the existing forwarding).
2. Verify RED: today `render-diagrams` falls through to the pipeline path (assert with no-launch guard).
3. No implementation in this task.

**Files likely touched:**
- `test/test_conduct_arg_guard.sh`

**Dependencies:** Task 1 (shim helper); independent of Tasks 2-4

### Task 6: GREEN — forwarding gate for conduct-ts verbs
**Story:** TECH-2 — happy paths
**Type:** happy-path

**Steps:**
1. Implement: replace the `daemon` line at bin/conduct:2805 with a first-token case over `daemon|render-diagrams|register|create|engineer|inline|help`: if matched and `command -v conduct-ts` succeeds → `exec conduct-ts "$@"`; if matched and missing → stderr error naming `conduct-ts` (install hint) and `exit 127`.
2. Verify Task 5 tests pass (GREEN).
3. Commit: "fix(conduct): forward conduct-ts-only subcommands instead of launching the pipeline"

**Files likely touched:**
- `bin/conduct` — forwarding gate

**Dependencies:** Task 5

### Task 7: Negative path — conduct-ts missing from PATH (TECH-2 negative)
**Story:** TECH-2 — negative path
**Type:** negative-path

**Steps:**
1. Write failing-first test: run `conduct render-diagrams --check X` with a PATH stripped of any real or shim `conduct-ts` → exits non-zero (127), stderr names `conduct-ts`, `assert_no_pipeline_state` passes.
2. Verify it passes against Task 6's implementation; if Task 6 forgot the missing-binary branch this is the RED that forces it.
3. Commit: "test(conduct): missing conduct-ts fails loudly, never falls through to pipeline"

**Files likely touched:**
- `test/test_conduct_arg_guard.sh`

**Dependencies:** Task 6

### Task 8: Real-binary smoke — render-diagrams --check end-to-end (TECH-2 Done When)
**Story:** TECH-2 — "real-binary smoke" done-when
**Type:** happy-path

**Steps:**
1. Add a smoke test gated on `command -v conduct-ts` (skip with a warning when absent): create a valid one-block Mermaid file in the temp repo, run the real `conduct render-diagrams --check <file>`, assert exit 0 and no `.pipeline/` state.
2. Verify it passes with the real installed conduct-ts.
3. Commit: "test(conduct): real-binary smoke for render-diagrams forwarding"

**Files likely touched:**
- `test/test_conduct_arg_guard.sh`

**Dependencies:** Task 6

### Task 9: RED+GREEN — bare single word rejected with hint (TECH-3)
**Story:** TECH-3 — happy paths + negative path (single-word idea also rejected)
**Type:** happy-path + negative-path

**Steps:**
1. Write failing tests: (a) `conduct rendr-diagrams` → non-zero, stderr has `Unknown command: rendr-diagrams` and the quote-a-multi-word-description hint; (b) `assert_no_pipeline_state`; (c) `conduct auth` → same rejection + hint (deliberate trade-off).
2. Verify RED.
3. Implement: in the `*)` branch, whitespace test — `case "$1" in *[[:space:]]*) FEATURE_DESC="$1" ;; *) echo "Unknown command: $1" >&2; echo 'Feature descriptions must be quoted multi-word strings, e.g. conduct "add user login"' >&2; exit 1 ;; esac`.
4. Verify GREEN.
5. Commit: "fix(conduct): reject bare single-word tokens with a hint instead of running the pipeline"

**Files likely touched:**
- `bin/conduct` — `*)` branch
- `test/test_conduct_arg_guard.sh`

**Dependencies:** Task 3 (final `*)` shape builds on the `-*)` split)

### Task 10: Characterization — multi-word descriptions and flag combos unchanged (TECH-4)
**Story:** TECH-4 — happy paths + dash-leading-string negative
**Type:** negative-path

**Steps:**
1. Write tests: (a) `conduct "add user login"` proceeds past parsing (reaches pipeline startup under the no-launch guard, or assert via `--status`-style observable that FEATURE_DESC was accepted — mirror how existing tests introspect state); (b) `conduct --auto "add user login"` parses both; (c) `conduct "--weird feature name"` → rejected as `Unknown option` (dash-leading token), non-zero, no pipeline state.
2. Verify all pass against the implemented guard.
3. Commit: "test(conduct): multi-word feature descriptions and flag combos are unchanged"

**Files likely touched:**
- `test/test_conduct_arg_guard.sh`

**Dependencies:** Tasks 3, 9

### Task 11: Docs — usage(), README, hint discoverability (TECH-3/TECH-4 Done When)
**Story:** TECH-3 "hint in --help", TECH-4 "docs updated"
**Type:** infrastructure

**Steps:**
1. Update `usage()` in `bin/conduct`: document that unknown options/commands fail loudly, list the forwarded conduct-ts verbs, and show the quoted multi-word feature-description contract.
2. Update `README.md` (bin/conduct CLI section) with the same contract.
3. Add test asserting `conduct --help` output contains the multi-word hint (TECH-3 Done When).
4. Commit: "docs(conduct): document unknown-command rejection and conduct-ts forwarding"

**Files likely touched:**
- `bin/conduct` — `usage()`
- `README.md`
- `test/test_conduct_arg_guard.sh`

**Dependencies:** Tasks 3, 6, 9

### Task 12: CHANGELOG + Migration block + full validation
**Story:** repo release gates (CLAUDE.md rules 1-2)
**Type:** infrastructure

**Steps:**
1. Add to `CHANGELOG.md` `## [Unreleased]` → **Fixed**: unknown `bin/conduct` subcommands/options now fail loudly (or forward to conduct-ts) instead of silently launching the SDLC pipeline (#178).
2. Add a `## Migration` section with a runnable ```bash migration``` block (advisory echo of the new contract: previously-silent invocations like `conduct render-diagrams` now forward or error; single-word feature descriptions must be quoted multi-word strings). Required because this changes `bin/conduct` CLI behavior.
3. Run `bash -n bin/conduct`, `./test/test_conduct_arg_guard.sh`, `./test/test_conduct_worktree.sh`, and `./test/test_harness_integrity.sh` — all green.
4. Commit: "docs(changelog): unknown-subcommand guard entry + migration block"

**Files likely touched:**
- `CHANGELOG.md`

**Dependencies:** Tasks 1-11

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2 ─▶ Task 3 ─┬─▶ Task 4
        │                     ├─▶ Task 9 ─▶ Task 10 (also needs 3)
        └─▶ Task 5 ─▶ Task 6 ─┬─▶ Task 7
                              └─▶ Task 8
Tasks 3,6,9 ─▶ Task 11 ─▶ Task 12 (needs 1-11)
```

## Integration Points

- After Task 3: any `-*` typo is already safe end-to-end (`conduct --frobnicate` can be run by hand).
- After Task 6: the original #178 repro (`conduct render-diagrams --check <file>`) forwards correctly — re-run the issue's reproduction as a manual check.
- After Task 9: all three guard rules are live; the full contract is testable.

## Verification

- [ ] All happy path criteria covered: TECH-1 (Tasks 2-3), TECH-2 (Tasks 5-6, 8), TECH-3 (Task 9), TECH-4 (Task 10)
- [ ] All negative path criteria covered: TECH-1 (Task 4), TECH-2 (Task 7), TECH-3 (Task 9c), TECH-4 (Task 10c)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Release gates carried: CHANGELOG Unreleased + Migration block (Task 12), docs in same PR (Task 11), integrity suite green (Task 12)
