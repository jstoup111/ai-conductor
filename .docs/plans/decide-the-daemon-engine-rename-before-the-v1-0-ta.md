# Implementation Plan: revise the v1.0 rename — daemon stays, engineer→composer, ai-conductor CLI

**Date:** 2026-08-28
**Stories:** .docs/stories/decide-the-daemon-engine-rename-before-the-v1-0-ta.md
**Conflict check:** Clean as of 2026-08-28
**Complexity:** Medium (boundary aliasing over unchanged implementations; see .docs/complexity/)

## Summary

Ship the three compatibility seams from the rewritten ADR — canonical `compose` CLI verb,
canonical `composer` skill, canonical `ai-conductor` binary — with deprecated warning aliases
(`engineer`, `conduct-ts`) and the internal call-site repoint, in 12 tasks. Daemon vocabulary,
`.daemon/`, and config keys are untouched.

## Technical Approach

- **Verb boundary (Story 1):** `detectEngineerCommand` (`src/conductor/src/engine/engineer-cli.ts:111-114`)
  keys on `argv[2] === 'engineer'`. Accept `compose` as canonical at that single boundary and
  return the identical typed descriptors; when the matched token was `engineer`, the dispatch
  path writes exactly one deprecation line to **stderr** (stdout JSON contracts unchanged).
  No second implementation: alias resolution happens before descriptor construction.
- **Binary boundary (Story 2):** rename the launcher content to `bin/ai-conductor` (same dist
  resolution logic) and make `bin/conduct-ts` a git symlink to it. The launcher checks
  `basename "$0"` **before** `readlink -f` resolution; when invoked as `conduct-ts` it prints one
  deprecation line to stderr, then proceeds identically. `bin/install` gains the
  `~/.local/bin/ai-conductor` symlink using the same idempotent create/update pattern as the
  existing conduct-ts block (`bin/install:1349-1365`) and `--check` verifies `ai-conductor` on
  PATH alongside the existing conduct-ts check (`bin/install:251-265`).
- **Skill boundary (Story 3):** move the engineer loop instructions to `skills/composer/`
  (canonical, `compose` vocabulary); reduce `skills/engineer/SKILL.md` to a thin delegate that
  points at composer (no directory deletion, no content fork). The generic skill symlink loop in
  `bin/install:1273-1284` installs any `skills/*` directory, so composer is picked up without
  installer changes. Add the composer row to `model-table-metadata.ts` (opus tier — pin
  `model: opus` in frontmatter per validation check 5b), keep the engineer row as delegate, and
  regenerate the HARNESS.md table with `bin/generate-model-table`.
- **Repoint (Story 4):** internal `conduct-ts` references are message strings/comments in
  `src/conductor/src/` (verified: no engine spawns-by-PATH; hooks already use the repo-relative
  `$HARNESS_DIR/bin/conduct-ts` with an env override) plus hook/skill text. Repoint them to
  `ai-conductor` / `bin/ai-conductor`, guarded by a new shell test that greps the production
  tree and fails on non-allowlisted `conduct-ts` references (allowlist: the `bin/conduct-ts`
  alias symlink itself, the launcher's warning text, deprecation-window mentions).
- **Sequencing:** parser first (pure TS, fastest feedback), then launcher/installer (shell),
  then skill catalog, then the repoint + guard last so the guard's allowlist is final.
  Test layers: vitest for the parser (`src/conductor/test/`), bash test scripts under `test/`
  for launcher/installer/guard, consistent with `test/lint_shell.sh` coverage.

## Prerequisites

- APPROVED adr-2026-08-26-music-vocabulary-player-composer-rename (rewritten 2026-08-28).
- Accepted stories and clean conflict check (this stem), 2026-08-28.

## Tasks

### Task 1: Parse canonical `compose` for every engineer subcommand
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: parameterize the existing detect/dispatch tests over `['engineer','compose']` and prove `compose <sub>` currently returns null for every subcommand in `ENGINEER_SUBCOMMANDS`, bare launch, `--help`, and unknown-flag rejection.
2. GREEN: normalize the verb once at the top of `detectEngineerCommand` (accept `compose` and `engineer`), leaving descriptor construction untouched.
3. Re-run the focused test.

**Done when:**
- The parameterized test proves every subcommand, bare launch, help, and unknown-flag/unknown-subcommand case yields identical typed descriptors under both verbs.
- `ENGINEER_SUBCOMMANDS` and each subcommand's flag validation are not duplicated or forked.

**Files:** `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/test/cli-engineer.test.ts`
**Dependencies:** none

### Task 2: `engineer` verb warns once on stderr, stdout unchanged
**Story:** 1
**Type:** negative-path

**Steps:**
1. RED: test that dispatching a subcommand detected via `engineer` writes exactly one warning line naming `compose` to stderr and that stdout is byte-identical to the `compose` dispatch; also that `compose` dispatch writes no warning.
2. GREEN: record the matched verb on the dispatch descriptor; emit the single stderr warning in `dispatchEngineer` when the verb was `engineer`.
3. Re-run the focused test.

**Done when:**
- A test captures stderr/stdout for both verbs and asserts: one warning line under `engineer`, zero under `compose`, byte-identical stdout (JSON contract preserved).
- The warning text names `compose` as the replacement and is emitted at most once per process invocation.

**Files:** `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/test/cli-engineer.test.ts`
**Dependencies:** Task 1

### Task 3: Help/usage names `compose` canonical, `engineer` deprecated
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: extend the engineer help tests to require `compose` in the usage/help output as the verb, with `engineer` marked deprecated.
2. GREEN: update the help/usage strings in the engineer CLI help and the root usage listing.
3. Re-run the focused help tests.

**Done when:**
- Help output for the loop's subcommands and the root usage listing show `compose` as canonical and mark `engineer` as a deprecated alias, asserted by test.
- `compose <sub> --help` resolves the same help topic as `engineer <sub> --help`.

**Files:** `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/src/index.ts`, `src/conductor/test/engine/engineer/engineer-cli-help.test.ts`
**Dependencies:** Task 1

### Task 4: `bin/ai-conductor` launcher with invoked-name deprecation warning
**Story:** 2
**Type:** happy-path

**Steps:**
1. RED: add `test/test_ai_conductor_launcher.sh` asserting (against a stubbed dist entrypoint): invocation as `ai-conductor` dispatches with no warning; invocation as `conduct-ts` dispatches identically with exactly one stderr warning naming `ai-conductor`; broken/missing dist errors identically (non-zero, stderr) under both names; no warning text ever appears on stdout.
2. GREEN: move the launcher content to `bin/ai-conductor`, add the `basename "$0"` check (before `readlink -f` resolution) that prints the single stderr warning when invoked as `conduct-ts`, and replace `bin/conduct-ts` with a symlink to `bin/ai-conductor`.
3. Run the new shell test plus `bash -n` and `test/lint_shell.sh` on the changed scripts.

**Done when:**
- `test/test_ai_conductor_launcher.sh` passes, covering: both-name dispatch, warning presence/absence and stderr-only placement, and broken-dist failure under both names.
- `bin/conduct-ts` is a symlink to `bin/ai-conductor`; `readlink -f` resolution still pins the real dist path from either name.
- `bash -n` and `test/lint_shell.sh` pass on `bin/ai-conductor` and the new test.

**Files:** `bin/ai-conductor`, `bin/conduct-ts`, `test/test_ai_conductor_launcher.sh`
**Dependencies:** none

### Task 5: `bin/install` creates and checks the `ai-conductor` symlink
**Story:** 2
**Type:** happy-path

**Steps:**
1. RED: extend the launcher shell test (or a focused install test) to run the install symlink function against a temp `LOCAL_BIN` and assert `ai-conductor` is created pointing at `bin/ai-conductor`, updated in place when stale, and reported; and that the `--check` path fails when `ai-conductor` is absent from PATH.
2. GREEN: add the `ai-conductor` symlink create/update block beside the existing conduct-ts block and extend the `--check` doctor section to verify `ai-conductor` on PATH.
3. Run the shell test, `bash -n`, and `test/lint_shell.sh`.

**Done when:**
- Install against a temp `LOCAL_BIN` produces both `ai-conductor` and `conduct-ts` symlinks; a stale `ai-conductor` symlink is updated in place and reported.
- `bin/install --check` fails with a clear message when `ai-conductor` is not on PATH and passes when it is.
- `bash -n` and `test/lint_shell.sh` pass on `bin/install`.

**Files:** `bin/install`, `test/test_ai_conductor_launcher.sh`
**Dependencies:** Task 4

### Task 6: `skills/composer` canonical skill; `skills/engineer` becomes a delegate
**Story:** 3
**Type:** happy-path

**Steps:**
1. RED: extend `test/test_provider_skill_contracts.sh` to require `skills/composer/SKILL.md` (full loop content, `compose` CLI vocabulary, required frontmatter incl. `model: opus`) and to require `skills/engineer/SKILL.md` to be a thin delegate that names composer and contains no second copy of the loop instructions.
2. GREEN: move the loop content to `skills/composer/` (SKILL.md + agents), rewriting CLI examples to `ai-conductor compose …`; rewrite `skills/engineer/SKILL.md` as the delegate (frontmatter intact, body defers to composer). No directory is deleted.
3. Run the contract test and the frontmatter/cross-reference checks of `test/test_harness_integrity.sh`.

**Done when:**
- `skills/composer/SKILL.md` exists with complete frontmatter (`name`, `description`, `enforcement`, `phase`, `model: opus`) and carries the loop instructions in `compose`/`ai-conductor` vocabulary.
- `skills/engineer/SKILL.md` is a delegate with valid frontmatter and no duplicated loop content, asserted by the contract test.
- The provider-neutrality, Claude-only-launcher, and issue-759 contract assertions now hold against `skills/composer/SKILL.md`.

**Files:** `skills/composer/SKILL.md`, `skills/engineer/SKILL.md`, `test/test_provider_skill_contracts.sh`
**Dependencies:** Task 3

### Task 7: Model table gains the composer row
**Story:** 3
**Type:** happy-path

**Steps:**
1. RED: extend the model-table tests to require a `composer` entry (opus tier) and an `engineer` entry marked as the compatibility delegate.
2. GREEN: add the composer entry to `model-table-metadata.ts`, update the engineer entry's `why` to name its delegate role, and regenerate the HARNESS.md model-selection table with `bin/generate-model-table`.
3. Run the model-table tests and validation checks 5/5a/5b.

**Done when:**
- `bin/generate-model-table` output matches the committed HARNESS.md section (check 5a) with composer and engineer rows present.
- Composer is opus-tier in the table and pins `model: opus` in its SKILL.md frontmatter (check 5b agreement in both directions).

**Files:** `src/conductor/src/engine/model-table-metadata.ts`, `HARNESS.md`, `src/conductor/test/model-table-metadata.test.ts`, `src/conductor/test/generate-model-table.test.ts`
**Dependencies:** Task 6

### Task 8: Both-host installation resolves composer and the engineer delegate
**Story:** 3
**Type:** negative-path

**Steps:**
1. RED: extend `test/test_codex_skill_installation.sh` so both hosts' installation paths must resolve `composer` (canonical) and `engineer` (delegate) — a delegate that no longer resolves fails.
2. GREEN: adjust host installation assertions/fixtures as needed; the generic `bin/install` skill symlink loop requires no code change unless the test proves otherwise.
3. Run both host installation test scripts.

**Done when:**
- `test/test_codex_skill_installation.sh` and `test/test_provider_skill_contracts.sh` pass with composer canonical and engineer delegate resolvable on both supported hosts.
- No installer special-case is added unless a failing test demanded it (the diff shows which).

**Files:** `test/test_codex_skill_installation.sh`, `test/test_provider_skill_contracts.sh`
**Dependencies:** Task 6

### Task 9: Grep guard test for legacy CLI references
**Story:** 4
**Type:** negative-path

**Steps:**
1. RED: add `test/test_no_legacy_cli_references.sh` that greps `src/conductor/src/`, `hooks/`, and `skills/` for `conduct-ts` and fails on any hit outside the closed allowlist: the `bin/conduct-ts` symlink path itself, the launcher's own warning text, and lines explicitly documenting the deprecated alias.
2. GREEN: the repoints from Tasks 10–11 are already landed (declared dependencies), so the guard passes against the current tree; finalize the allowlist entries with a one-line reason comment each. Demonstrate RED once by locally reverting one repointed hook path and observing the failure.
3. Wire the new script into the test suite the sibling shell tests use.

**Done when:**
- `test/test_no_legacy_cli_references.sh` exists, uses a closed inline allowlist (each entry commented with its reason), and passes against the repointed tree.
- Reverting any single repoint (e.g. one hook path) makes the guard fail — demonstrated once during development.
- `bash -n` and `test/lint_shell.sh` pass on the new script.

**Files:** `test/test_no_legacy_cli_references.sh`
**Dependencies:** Task 10, Task 11

### Task 10: Repoint `src/conductor/src/` message strings and comments
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: extend existing focused tests where operator-facing strings are asserted (e.g. auto-park failure messages in daemon-runner tests) to require `ai-conductor daemon …` wording; prove they fail against current `conduct-ts …` strings.
2. GREEN: sweep the ~10 `src/conductor/src/` files, updating operator-facing message strings to `ai-conductor` and comments to the canonical name; no behavior change.
3. Re-run the touched test files.

**Done when:**
- Every operator-facing message string in `src/conductor/src/` that names the CLI says `ai-conductor`, with at least the daemon-runner park/unpark guidance asserted by test.
- `grep -rn 'conduct-ts' src/conductor/src/` returns only allowlisted lines (deprecation-warning text, alias documentation).

**Files:** `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/src/execution/daemon-session.ts`, `src/conductor/src/engine/project-prelude.ts`, `src/conductor/src/engine/session-hook-assets.ts`, `src/conductor/src/cli.ts`, `src/conductor/src/index.ts`, `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/execution/claude-provider.ts`, `src/conductor/src/intake-loop-cli.ts`, `src/conductor/src/engine/test-suite-cli.ts`, `src/conductor/test/engine/daemon-cli.test.ts`
**Dependencies:** Task 2

### Task 11: Repoint hooks and skill text to `ai-conductor`
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: where a hook's launcher path is asserted by test, require the `bin/ai-conductor` default; otherwise rely on the Task 9 guard as the failing check for this sweep.
2. GREEN: update hook defaults (e.g. `engine_bin` fallback in `hooks/claude/post-commit-derive-feedback.sh` to `$HARNESS_DIR/bin/ai-conductor`) and sweep the 11 hook/skill files' text to `ai-conductor` / `compose` vocabulary.
3. Run `bash -n`, `test/lint_shell.sh`, and the hook's own test if present.

**Done when:**
- Hook launcher defaults reference `bin/ai-conductor`; env overrides are preserved unchanged.
- Skill text under `skills/` invokes `ai-conductor` (and `compose` where the loop is referenced); no non-allowlisted `conduct-ts` remains in `hooks/` or `skills/`.
- `bash -n` and `test/lint_shell.sh` pass on every changed script.

**Files:** `hooks/claude/post-commit-derive-feedback.sh`, `skills/conduct/SKILL.md`, `skills/pipeline/SKILL.md`, `skills/bootstrap/SKILL.md`, `skills/daemon-triage/SKILL.md`, `skills/composer/SKILL.md`
**Dependencies:** Task 6

### Task 12: Root CLI usage and error text speak `ai-conductor`
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: extend the root CLI usage tests to require `ai-conductor` as the program name in usage/help/error banners (including the daemon-session refusal message).
2. GREEN: update the usage/program-name strings in `index.ts`/`cli.ts` and the daemon-session refusal text.
3. Re-run the focused CLI tests.

**Done when:**
- Root usage/help output and the daemon-session refusal message name `ai-conductor`, asserted by test.
- No stdout contract (JSON output of subcommands) changed — only usage/error text.

**Files:** `src/conductor/src/index.ts`, `src/conductor/src/cli.ts`, `src/conductor/src/execution/daemon-session.ts`, `src/conductor/test/cli/index.test.ts`
**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 ──> Task 2 ──> Task 10 ──> Task 12
   └─────> Task 3 ──> Task 6 ──> Task 7
                        ├──────> Task 8
                        └──────> Task 11
Task 4 ──> Task 5
Task 10, Task 11 ──> Task 9
```

## Integration Points

- After Task 5: full binary-alias behavior testable end-to-end (`ai-conductor`/`conduct-ts` + install + doctor).
- After Task 8: skill catalog complete on both hosts; validation suite green.
- After Task 9: repoint proven closed by the guard; warnings originate only at the two alias entrypoints.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
