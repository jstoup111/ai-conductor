# Implementation Plan: Skills may bundle executable helpers

**Date:** 2026-09-28
**Stories:** .docs/stories/skills-may-bundle-executable-helpers.md
**Conflict check:** Clean as of 2026-09-28

## Summary

Move `intake-file` into the intake skill as the first bundled executable helper. The helper resolves the harness engine deterministically and runs it in the caller's repository, and the repository's shell-lint, syntax, and interpreter-source gates cover bundled helpers. Eight tasks.

## Technical Approach

- **Decision authority:** adr-2026-09-28-skills-may-bundle-executable-helpers (D1–D7), APPROVED. The architecture review is `.docs/decisions/architecture-review-2026-09-28-skills-may-bundle-executable-helpers.md`.
- **Helper shape:** `skills/intake/scripts/intake-file` is an extensionless bash wrapper. It resolves its own path with `readlink -f` and walks up its ancestors for the nearest directory holding both `src/conductor/src/intake-file-cli.ts` and an executable `src/conductor/node_modules/.bin/tsx`. If none qualifies, it falls back to `readlink -f` of `ai-conductor` on `PATH`, one level above its `bin/`. Otherwise it fails naming both attempts. It then `exec`s that `tsx` with `--tsconfig` and the entry point, with no `cd`, so the entry point's working-directory-relative repository discovery and `.pipeline/events.jsonl` write land in the caller's repository. Filing logic stays in TypeScript.
- **Local pattern:** `bin/ai-conductor` resolves `readlink -f "$0"` before deriving the engine directory (search hint: `REAL_PATH`/`BIN_DIR`). Keep that trait, and vary it only by walking ancestors instead of a fixed `..`.
- **Rename safety:** the helper is authored as a new file and `bin/intake-file` is deleted separately, so git rename detection never pairs them. A paired rename into `skills/` would fire the release gate's skill-surface rule.
- **Gates:** `test/lint_shell.sh` gains a `skills/*/scripts/` branch in `collect_scripts`, which integrity check 1 consumes through `--list`. The interpreter-source inventory gains the same directories through an exported inventory function. The GitHub boundary audit already scans extensionless skill files, so the helper text avoids literal GitHub CLI or push invocations.
- **Install:** unchanged. The whole-directory skill symlinks already carry `scripts/`. Task 8 proves that through the real `bin/install` in a temporary home, and proves the self-host provider-home copy keeps mode 0755.
- **Out of scope:** deleting `src/conductor/bin/` (a separate removal feature), migrating other `bin/` helpers, and any `bin/install` or `PATH` change.
- **Sequencing:** Task 1 creates the helper. Tasks 2, 3, 5, 7, and 8 build on it independently. Task 4 retires the old path after the real-entry-point proof (Task 3). Task 6 extends Task 5's fixture.

## Prerequisites

- None. `src/conductor/node_modules` is installed wherever the test suite runs.

## Tasks

### Task 1: Bundled intake helper resolves its harness by ancestor walk and runs the engine in the caller's directory
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/skills/bundled-helper-resolution.test.ts`. Build fixture harness trees in a temp directory: each holds `src/conductor/src/intake-file-cli.ts`, `src/conductor/tsconfig.json`, and an executable stub `src/conductor/node_modules/.bin/tsx` that appends its working directory and arguments to a record file and exits with a configurable status. Copy the real `skills/intake/scripts/intake-file` into the fixture's `skills/intake/scripts/`. Reach it through a symlinked skill directory from a separate temp repository, through a deep copy beneath the fixture (the self-host provider-home shape), and by a relative path from an unrelated directory.
2. Verify RED: the helper does not exist yet.
3. Implement `skills/intake/scripts/intake-file` as a NEW file (do not `git mv` `bin/intake-file`; see Task 4). Use a `#!/usr/bin/env bash` shebang and `set -euo pipefail`. Resolve its own path with `readlink -f`, then walk up its ancestors and take the nearest directory containing both `src/conductor/src/intake-file-cli.ts` and an executable `src/conductor/node_modules/.bin/tsx`. Then `exec` that `tsx` with `--tsconfig <root>/src/conductor/tsconfig.json <root>/src/conductor/src/intake-file-cli.ts "$@"`, with no `cd`. Follow the local pattern of `bin/ai-conductor` (search hint: its `REAL_PATH`/`BIN_DIR` lines): resolve symlinks physically before deriving a root. Allowed variation: an ancestor walk instead of a fixed `..`. Keep it a thin wrapper with no filing logic, and no literal `gh` or `git push` invocation text anywhere in the file, comments included (the GitHub boundary audit scans extensionless skill files in full).
4. Verify GREEN.
5. Commit: "feat(intake): bundle intake-file helper in the intake skill".

**Done when:**
- The `bundled-helper-resolution` Vitest test runs `skills/intake/scripts/intake-file` through a symlinked skill directory from a temporary non-harness repository and asserts the fixture harness's stub runner recorded that temporary repository as its working directory.
- The same test asserts the stub runner received `--tsconfig` with the fixture engine's `tsconfig.json`, then the fixture `intake-file-cli.ts` path, then the title, body, size, priority, and depends-on arguments verbatim and in their original order.
- A test places a copy of the helper several directories beneath a fixture harness with a stubbed entry point and runner and asserts that fixture's stub ran.
- A test sets the stub runner to exit 3 and asserts the helper exits 3, and a test invoking the helper by a relative path from an unrelated directory asserts the stub ran with that unrelated directory as its working directory.

**Files likely touched:**
- `skills/intake/scripts/intake-file`
- `src/conductor/test/skills/bundled-helper-resolution.test.ts`

**Dependencies:** none

### Task 2: Helper resolution skips unrunnable ancestors, falls back to ai-conductor on PATH, and fails by name
**Story:** 2
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/skills/bundled-helper-resolution.test.ts` with failing cases. (a) A nearer ancestor has the entry point but no `tsx`, and a further ancestor has both. (b) No qualifying ancestor, and a stub `ai-conductor` symlink sits in a bin directory outside any harness, first on a controlled `PATH`, pointing at a fixture harness's `bin/ai-conductor`. (c) No qualifying location anywhere. (d) No qualifying ancestor and no `ai-conductor` on `PATH`. Every case runs with a controlled `PATH` that contains only system directories plus the case's stub directory.
2. Verify RED.
3. Implement the fallback in `skills/intake/scripts/intake-file`. When no ancestor qualifies, run `command -v ai-conductor`, resolve it with `readlink -f`, take the directory one level above its `bin/`, and apply the same two-file qualification. Otherwise print to stderr a message naming the helper path it walked from and the `PATH` result (the resolved candidate, or the literal statement that no `ai-conductor` was found on `PATH`), then exit non-zero without exec.
4. Verify GREEN.
5. Commit: "feat(intake): PATH fallback and named failure for bundled helper resolution".

**Done when:**
- A test with a nearer ancestor lacking the runner and a further ancestor holding both asserts the further ancestor's stub ran and the nearer one's did not.
- A test with no qualifying ancestor and a stub `ai-conductor` symlink on `PATH`, placed in a bin directory outside the harness and pointing into a fixture harness, asserts that fixture's stub ran.
- A test with no qualifying location anywhere asserts a non-zero exit, stderr naming the helper path walked from and the `PATH` result, and that no stub ran.
- A test with no qualifying ancestor and no `ai-conductor` on `PATH` asserts a non-zero exit, stderr stating that no `ai-conductor` was found on `PATH`, and that no stub ran.

**Files likely touched:**
- `skills/intake/scripts/intake-file`
- `src/conductor/test/skills/bundled-helper-resolution.test.ts`

**Dependencies:** 1

### Task 3: Helper reaches the real intake entry point with the caller's repository
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/skills/intake-file-helper-entry.test.ts`. It runs the real `skills/intake/scripts/intake-file` from this checkout, so the real engine and `tsx` resolve through the ancestor walk. The working directory is a temporary directory, and `PATH` starts with a stub `gh`. The stub records its working directory and arguments. It answers `repo view --json nameWithOwner` with `{"nameWithOwner":"acme/consumer"}` and exits non-zero for every other call, so no issue can be created. Per this repository's test-process-isolation rule, first assert that the stub recorded a call, which proves the production path reached it, before asserting any refused-call outcome.
2. Verify RED: before Task 1 the helper is absent. The pre-change `bin/intake-file` changes into `src/conductor`, so the recorded directory would be the harness.
3. No production change is expected beyond Task 1. If the entry point needs one to honour the caller's directory, make it in `src/conductor/src/intake-file-cli.ts`.
4. Verify GREEN.
5. Commit: "test(intake): bundled helper files against the caller's repository".

**Done when:**
- The `intake-file-helper-entry` Vitest test runs the helper against this checkout's real engine from a temporary repository with a stub `gh` first on `PATH`, and asserts the stub recorded a `repo view` call whose working directory is the temporary repository, not the harness repository.
- The same test runs the helper with no `--title` and asserts its exit status equals the status of running the entry point directly with the same arguments, both non-zero, with the entry point's `Usage: intake-file` error on stderr and no stub `gh` invocation recorded for that run.

**Files likely touched:**
- `src/conductor/test/skills/intake-file-helper-entry.test.ts`

**Dependencies:** 1

### Task 4: Intake skill invokes its bundled helper and bin/intake-file is retired
**Story:** 1
**Type:** refactor

**Steps:**
1. Edit `skills/intake/SKILL.md` §9 so the filing command is `<this skill's directory>/scripts/intake-file`. Say how each supported host supplies that directory: Claude's injected base directory for the loaded skill, and the directory of the `SKILL.md` path Codex lists. Update the §7 wording and the verification checklist line that name `bin/intake-file`.
2. Delete `bin/intake-file` in its own step; the helper was authored as a new file in Task 1. Confirm `git diff -M --name-status` pairs no rename. If it does, rewrite the helper's comments rather than copying the old header.
3. Update the comments that name `bin/intake-file` in `src/conductor/src/intake-file-cli.ts`, `src/conductor/src/engine/engineer/intake/label-sync.ts`, `src/conductor/scripts/intake-label-sync-apply.mts`, and `.github/workflows/intake-label-sync.yml` so they name the bundled helper.
4. Leave `src/conductor/bin/intake-file` and its directory on disk: its deletion is a separate removal feature.
5. Commit: "refactor(intake): point the intake skill at its bundled helper; retire bin/intake-file".

**Done when:**
- `skills/intake/SKILL.md` §9 invokes `scripts/intake-file` relative to the skill's own directory and names how each supported host supplies that directory (Claude's injected base directory, the directory of the `SKILL.md` path Codex lists).
- `git grep -n "bin/intake-file" -- skills src .github` returns matches only inside `src/conductor/bin/`, so no skill, engine comment, or workflow comment directs anyone to `bin/intake-file`.
- `git diff -M --name-status` against the merge base lists `bin/intake-file` as `D` and `skills/intake/scripts/intake-file` as `A`, with no `R` entry pairing them.

**Files likely touched:**
- `skills/intake/SKILL.md`
- `bin/intake-file`
- `src/conductor/src/intake-file-cli.ts`
- `src/conductor/src/engine/engineer/intake/label-sync.ts`
- `src/conductor/scripts/intake-label-sync-apply.mts`
- `.github/workflows/intake-label-sync.yml`

**Dependencies:** 1, 3

### Task 5: Shell-lint enumeration includes bundled skill helpers
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Extend `test/test_lint_shell_enumeration.sh` with a failing fixture assertion: using the existing `fixture_root` helper, place a bash-shebang file at `skills/demo/scripts/tool` and assert `lint_shell.sh --list` lists it. Keep every existing `bin/`, `hooks/`, `test/`, and `.github/scripts/` assertion.
2. Verify RED against the current `lint_shell.sh`.
3. Extend `collect_scripts` in `test/lint_shell.sh` to walk `skills/*/scripts/` and keep files whose first line matches its existing bash/sh shebang test, applying `print_unless_excluded` like the `bin/` branch. Update the header comment's surface list.
4. Verify GREEN, and confirm the real `test/lint_shell.sh --list` includes `skills/intake/scripts/intake-file`.
5. Commit: "test(lint): enumerate bundled skill helpers in the shell gates".

**Done when:**
- `collect_scripts` in `test/lint_shell.sh` enumerates files under `skills/*/scripts/` whose first line is a bash or sh shebang, and `test/lint_shell.sh --list` output includes `skills/intake/scripts/intake-file` alongside the existing `bin/`, `hooks/`, `test/`, and `.github/scripts/` entries.
- `test/test_lint_shell_enumeration.sh` builds a fixture root with a shebang helper at `skills/demo/scripts/tool`, asserts it is listed, and fails against the pre-change `lint_shell.sh`.
- The enumeration test's existing assertions for `bin/`, `hooks/`, `test/`, and `.github/scripts/` entries pass unchanged.

**Files likely touched:**
- `test/lint_shell.sh`
- `test/test_lint_shell_enumeration.sh`

**Dependencies:** 1

### Task 6: Syntax-broken skill helpers fail the shared syntax check; non-helpers and exclusions stay unlisted
**Story:** 3
**Type:** negative-path

**Steps:**
1. Add failing fixture cases to `test/test_lint_shell_enumeration.sh`: a syntax-broken bash helper `skills/demo/scripts/broken`; `skills/demo/SKILL.md`, `skills/demo/references/notes.md`, and `skills/demo/agents/openai.yaml`; a shebang-less `skills/demo/scripts/data`; and a bash helper `skills/demo/scripts/excluded` named in the fixture copy's `DECLARED_EXCLUSIONS`.
2. Verify RED where the Task 5 enumeration would misbehave. If Task 5 already satisfies a case, record it in the commit body with `Evidence: satisfied-by <sha>`.
3. Add a `--syntax` mode to `test/lint_shell.sh` that runs `bash -n` over the same enumerated list, prints each failing path, and exits non-zero when any file fails. Rewrite integrity check 1 in `test/test_harness_integrity.sh` to run its syntax check through `lint_shell.sh --syntax`, keeping its per-file assert output and its empty-enumeration guard. Update `assert_integrity_uses_shared_list` in the enumeration test so it accepts the `--syntax` call. Adjust the enumeration only if a case fails.
4. Commit: "test(lint): skill-file negatives for the shell enumeration".

**Done when:**
- `test/lint_shell.sh --syntax` runs `bash -n` over every listed file and exits non-zero naming each failing path, integrity check 1 runs its syntax check through `lint_shell.sh --syntax`, and the fixture test runs that integrity check 1 syntax step over a fixture root containing `skills/demo/scripts/broken` and asserts it exits non-zero with output naming `skills/demo/scripts/broken`.
- The fixture test asserts `skills/demo/SKILL.md`, `skills/demo/references/notes.md`, `skills/demo/agents/openai.yaml`, and the shebang-less `skills/demo/scripts/data` are all absent from the list.
- The fixture test declares `skills/demo/scripts/excluded` in `DECLARED_EXCLUSIONS` and asserts it is absent from the list.

**Files likely touched:**
- `test/test_lint_shell_enumeration.sh`
- `test/lint_shell.sh`
- `test/test_harness_integrity.sh`

**Dependencies:** 5

### Task 7: Interpreter-source inventory includes bundled skill helpers
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing cases in `src/conductor/test/scripts/interpreter-source-inventory.test.ts`. (a) An exported inventory function over the repository root includes `skills/intake/scripts/intake-file` and every `bin/` and `hooks/` shell asset it listed before. (b) A fixture root with `skills/demo/scripts/tool` containing an interpreter form that `checkInterpreterSource` rejects yields a finding for that path. (c) A fixture root with no `skills/` directory still succeeds.
2. Verify RED.
3. In `src/conductor/scripts/check-interpreter-source.mts`, export an inventory function that unions `shellFiles(root, 'bin')`, `shellFiles(root, 'hooks')`, and `shellFiles` over each `skills/*/scripts/` directory that exists. Have `checkInventory` use it. Keep the empty-inventory error.
4. Verify GREEN.
5. Commit: "feat(lint): interpreter-source inventory covers bundled skill helpers".

**Done when:**
- `checkInventory` in `check-interpreter-source.mts` builds its shell-asset inventory from `bin`, `hooks`, and every `skills/*/scripts/` directory through an exported inventory function, and a test asserts that function's result for the repository root includes `skills/intake/scripts/intake-file` and every `bin/` and `hooks/` shell asset it listed before.
- A fixture test places `skills/demo/scripts/tool` containing an interpreter form `checkInterpreterSource` rejects and asserts `checkInventory` returns a finding whose path is `skills/demo/scripts/tool`.
- A fixture test with no `skills/` directory asserts `checkInventory` still succeeds on `bin/` and `hooks/` assets alone.

**Files likely touched:**
- `src/conductor/scripts/check-interpreter-source.mts`
- `src/conductor/test/scripts/interpreter-source-inventory.test.ts`

**Dependencies:** 1

### Task 8: Installed and self-host copies keep the bundled helper executable
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing Vitest test `src/conductor/test/skills/bundled-helper-install.test.ts`. It runs the real `bin/install --update --providers claude,codex --allow-worktree-root` into a temporary `HOME`, with a stub directory first on `PATH` for external tools. Follow the local pattern of `run_install` in `test/test_codex_skill_installation.sh` (search hint: `HOME="$fake_home" PATH="$STUBS:/usr/bin:/bin"`): a fake home, stubbed tools, and a bounded timeout. Allowed variation: spawn from Vitest instead of bash. It then runs `--check` against the same home.
2. Extend `src/conductor/test/engine/self-host/provider-home.test.ts`: materialize a home from a fixture worktree whose `skills/intake/scripts/intake-file` has mode 0755. Assert the copy keeps mode 0755 and survives operator-only pruning.
3. Verify RED: the install assertions fail before Task 1's helper exists.
4. Correct the provider-home module's comment on the `skills` copy so it no longer calls the asset markdown-only. It now carries bundled executable helpers.
5. Commit: "test(install): bundled helpers stay executable through install and self-host copies".

**Done when:**
- The `bundled-helper-install` Vitest test runs the real `bin/install --update --providers claude,codex` into a temporary `HOME` and asserts `scripts/intake-file` is executable through both `~/.claude/skills/intake` and `~/.agents/skills/intake`.
- The same test then runs `bin/install --check --providers claude,codex` against that home and asserts exit status 0 with no stale or drift line naming the intake skill.
- A `provider-home` test materializes a home from a fixture worktree whose `skills/intake/scripts/intake-file` has mode 0755 and asserts the copied helper exists with mode 0755 after operator-only pruning.
- The comment on the `skills` copy in `provider-home.ts` no longer describes the asset as markdown-only.

**Files likely touched:**
- `src/conductor/test/skills/bundled-helper-install.test.ts`
- `src/conductor/test/engine/self-host/provider-home.test.ts`
- `src/conductor/src/engine/self-host/provider-home.ts`

**Dependencies:** 1

## Task Dependency Graph

```text
Task 1 ─┬─> Task 2
        ├─> Task 3 ─> Task 4
        ├─> Task 5 ─> Task 6
        ├─> Task 7
        └─> Task 8
```

## Integration Points

- After Task 3: the bundled helper files through the real engine entry point from a foreign repository (the production path the intake skill invokes).
- After Task 4: the intake skill directs agents to the bundled helper, and `bin/intake-file` no longer exists.
- After Tasks 5 and 7: the aggregate `test_suite` (`npm test` plus `test/test_harness_integrity.sh`) exercises the helper through shellcheck, `bash -n`, and the interpreter-source check.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a working directory that is a repository other than the harness and the intake skill installed through a whole-directory symlink, when the helper is run by its path inside that installed skill directory, then the engine's intake-file entry point runs with that same working directory. | 1 | "The `bundled-helper-resolution` Vitest test runs `skills/intake/scripts/intake-file` through a symlinked skill directory from a temporary non-harness repository and asserts the fixture harness's stub runner recorded that temporary repository as its working directory." | diff-local |
| Story 1 happy: Given the helper is run from a foreign working directory without an explicit repository argument, when the entry point resolves the filing repository, then it resolves the repository of the caller's working directory rather than the harness repository. | 3 | "The `intake-file-helper-entry` Vitest test runs the helper against this checkout's real engine from a temporary repository with a stub `gh` first on `PATH`, and asserts the stub recorded a `repo view` call whose working directory is the temporary repository, not the harness repository." | diff-local |
| Story 1 happy: Given the helper is run with a title, a body, a size, a priority, and a dependency argument, when it hands off to the entry point, then every argument arrives unchanged and in the original order. | 1 | "The same test asserts the stub runner received `--tsconfig` with the fixture engine's `tsconfig.json`, then the fixture `intake-file-cli.ts` path, then the title, body, size, priority, and depends-on arguments verbatim and in their original order." | diff-local |
| Story 1 negative: Given the helper is run without the required title argument, when the entry point rejects the arguments, then the helper exits with the entry point's non-zero status and prints the entry point's own error, and no issue is filed. | 3 | "The same test runs the helper with no `--title` and asserts its exit status equals the status of running the entry point directly with the same arguments, both non-zero, with the entry point's `Usage: intake-file` error on stderr and no stub `gh` invocation recorded for that run." | diff-local |
| Story 1 negative: Given the entry point exits non-zero after an issue-create failure, when the helper returns, then its exit status equals the entry point's status rather than zero. | 1 | "A test sets the stub runner to exit 3 and asserts the helper exits 3, and a test invoking the helper by a relative path from an unrelated directory asserts the stub ran with that unrelated directory as its working directory." | diff-local |
| Story 1 negative: Given the helper is invoked through a relative path from a directory that is neither the harness nor the skill directory, when it starts, then it still locates the engine and does not change the caller's working directory. | 1 | "A test sets the stub runner to exit 3 and asserts the helper exits 3, and a test invoking the helper by a relative path from an unrelated directory asserts the stub ran with that unrelated directory as its working directory." | diff-local |
| Story 2 happy: Given the helper is reached through a symlinked skill directory whose target is inside a harness checkout with the engine entry point and its installed runner, when it resolves the harness root, then it uses that checkout. | 1 | "The `bundled-helper-resolution` Vitest test runs `skills/intake/scripts/intake-file` through a symlinked skill directory from a temporary non-harness repository and asserts the fixture harness's stub runner recorded that temporary repository as its working directory." | diff-local |
| Story 2 happy: Given a copy of the skill directory sits several levels beneath a harness checkout that has the engine entry point and its installed runner (as a self-host provider-home copy sits beneath its worktree), when the helper resolves the harness root, then it uses that nearest qualifying ancestor. | 1 | "A test places a copy of the helper several directories beneath a fixture harness with a stubbed entry point and runner and asserts that fixture's stub ran." | diff-local |
| Story 2 happy: Given the helper's physical location has no qualifying ancestor and an `ai-conductor` on `PATH` whose physical location is inside a qualifying harness checkout, when it resolves the harness root, then it uses that checkout. | 2 | "A test with no qualifying ancestor and a stub `ai-conductor` symlink on `PATH`, placed in a bin directory outside the harness and pointing into a fixture harness, asserts that fixture's stub ran." | diff-local |
| Story 2 negative: Given no ancestor of the helper qualifies and no `ai-conductor` on `PATH` leads to a qualifying checkout, when the helper runs, then it exits non-zero with a message naming the path it walked from and the `PATH` result, and no engine code runs. | 2 | "A test with no qualifying location anywhere asserts a non-zero exit, stderr naming the helper path walked from and the `PATH` result, and that no stub ran." | diff-local |
| Story 2 negative: Given no ancestor of the helper qualifies and no `ai-conductor` is on `PATH`, when the helper runs, then it exits non-zero with a message stating that no `ai-conductor` was found on `PATH`, and no engine code runs. | 2 | "A test with no qualifying ancestor and no `ai-conductor` on `PATH` asserts a non-zero exit, stderr stating that no `ai-conductor` was found on `PATH`, and that no stub ran." | diff-local |
| Story 2 negative: Given the nearest ancestor holds the engine entry point but no installed runner (as a worktree without dependencies does) and a further ancestor holds both, when the helper resolves the harness root, then it skips the nearer one and uses the further ancestor. | 2 | "A test with a nearer ancestor lacking the runner and a further ancestor holding both asserts the further ancestor's stub ran and the nearer one's did not." | diff-local |
| Story 2 negative: Given the `ai-conductor` on `PATH` is itself a symlink in a bin directory outside the harness, when the fallback resolves it, then it follows the link to the physical harness location rather than treating the bin directory's parent as the harness root. | 2 | "A test with no qualifying ancestor and a stub `ai-conductor` symlink on `PATH`, placed in a bin directory outside the harness and pointing into a fixture harness, asserts that fixture's stub ran." | diff-local |
| Story 3 happy: Given the repository contains `skills/intake/scripts/intake-file` with a bash shebang, when the shell-lint enumeration is listed, then that path appears in the list. | 5 | "`collect_scripts` in `test/lint_shell.sh` enumerates files under `skills/*/scripts/` whose first line is a bash or sh shebang, and `test/lint_shell.sh --list` output includes `skills/intake/scripts/intake-file` alongside the existing `bin/`, `hooks/`, `test/`, and `.github/scripts/` entries." | diff-local |
| Story 3 happy: Given a bash-shebang file exists under any `skills/<name>/scripts/` directory, when the shell-lint enumeration is listed, then it appears alongside the existing `bin/`, `hooks/`, `test/`, and `.github/scripts/` entries, all of which are still present. | 5 | "`collect_scripts` in `test/lint_shell.sh` enumerates files under `skills/*/scripts/` whose first line is a bash or sh shebang, and `test/lint_shell.sh --list` output includes `skills/intake/scripts/intake-file` alongside the existing `bin/`, `hooks/`, `test/`, and `.github/scripts/` entries." | diff-local |
| Story 3 happy: Given the enumeration-pinning test runs against the repository, when it compares the listed surface, then it asserts the `skills/*/scripts/` surface is included. | 5 | "`test/test_lint_shell_enumeration.sh` builds a fixture root with a shebang helper at `skills/demo/scripts/tool`, asserts it is listed, and fails against the pre-change `lint_shell.sh`." | diff-local |
| Story 3 happy: Given the repository contains `skills/intake/scripts/intake-file`, when the interpreter-source inventory is built, then that path is among the checked shell assets alongside every `bin/` and `hooks/` shell file. | 7 | "`checkInventory` in `check-interpreter-source.mts` builds its shell-asset inventory from `bin`, `hooks`, and every `skills/*/scripts/` directory through an exported inventory function, and a test asserts that function's result for the repository root includes `skills/intake/scripts/intake-file` and every `bin/` and `hooks/` shell asset it listed before." | diff-local |
| Story 3 negative: Given a file under `skills/<name>/scripts/` contains a bash syntax error, when integrity check 1 runs over the enumerated list, then that check fails and names the file. | 6 | "`test/lint_shell.sh --syntax` runs `bash -n` over every listed file and exits non-zero naming each failing path, integrity check 1 runs its syntax check through `lint_shell.sh --syntax`, and the fixture test runs that integrity check 1 syntax step over a fixture root containing `skills/demo/scripts/broken` and asserts it exits non-zero with output naming `skills/demo/scripts/broken`." | diff-local |
| Story 3 negative: Given a skill directory contains Markdown or YAML files outside `scripts/`, such as `SKILL.md`, `references/*.md`, or `agents/openai.yaml`, when the enumeration is listed, then none of those files appear. | 6 | "The fixture test asserts `skills/demo/SKILL.md`, `skills/demo/references/notes.md`, `skills/demo/agents/openai.yaml`, and the shebang-less `skills/demo/scripts/data` are all absent from the list." | diff-local |
| Story 3 negative: Given a file under `skills/<name>/scripts/` has no bash or sh shebang, when the enumeration is listed, then it does not appear. | 6 | "The fixture test asserts `skills/demo/SKILL.md`, `skills/demo/references/notes.md`, `skills/demo/agents/openai.yaml`, and the shebang-less `skills/demo/scripts/data` are all absent from the list." | diff-local |
| Story 3 negative: Given a bundled helper path is listed as a declared exclusion, when the enumeration is listed, then it does not appear, as with any other declared exclusion. | 6 | "The fixture test declares `skills/demo/scripts/excluded` in `DECLARED_EXCLUSIONS` and asserts it is absent from the list." | diff-local |
| Story 3 negative: Given a bundled helper under `skills/<name>/scripts/` invokes an interpreter in a form the interpreter-source check rejects, when that check runs, then it reports a finding naming the helper's path. | 7 | "A fixture test places `skills/demo/scripts/tool` containing an interpreter form `checkInterpreterSource` rejects and asserts `checkInventory` returns a finding whose path is `skills/demo/scripts/tool`." | diff-local |
| Story 4 happy: Given the harness is installed into a temporary home, when the installed intake skill directory is inspected in both the Claude and the Codex discovery homes, then `scripts/intake-file` is present through the link and executable. | 8 | "The `bundled-helper-install` Vitest test runs the real `bin/install --update --providers claude,codex` into a temporary `HOME` and asserts `scripts/intake-file` is executable through both `~/.claude/skills/intake` and `~/.agents/skills/intake`." | diff-local |
| Story 4 happy: Given a self-host provider home is materialized from a worktree containing the bundled helper, when the copied skills are inspected, then `intake/scripts/intake-file` is present with its executable mode preserved. | 8 | "A `provider-home` test materializes a home from a fixture worktree whose `skills/intake/scripts/intake-file` has mode 0755 and asserts the copied helper exists with mode 0755 after operator-only pruning." | diff-local |
| Story 4 negative: Given the harness is installed with the bundled helper present, when install freshness is checked, then the intake skill is not reported as stale or drifted because of its `scripts/` contents. | 8 | "The same test then runs `bin/install --check --providers claude,codex` against that home and asserts exit status 0 with no stale or drift line naming the intake skill." | diff-local |
| Story 4 negative: Given a self-host provider home prunes operator-only skills from its copy, when the copied skills are inspected, then the intake skill and its helper are not pruned. | 8 | "A `provider-home` test materializes a home from a fixture worktree whose `skills/intake/scripts/intake-file` has mode 0755 and asserts the copied helper exists with mode 0755 after operator-only pruning." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D1 | task | task-8 | asserts `scripts/intake-file` is executable through both `~/.claude/skills/intake` and `~/.agents/skills/intake` |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D2 | task | task-1 | then the fixture `intake-file-cli.ts` path, then the title, body, size, priority, and depends-on arguments verbatim |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D3 | task | task-4 | invokes `scripts/intake-file` relative to the skill's own directory |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D4 | task | task-2 | asserts a non-zero exit, stderr naming the helper path walked from and the `PATH` result, and that no stub ran |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D5 | task | task-1 | asserts the fixture harness's stub runner recorded that temporary repository as its working directory |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D6 | task | task-5 | `test/lint_shell.sh --list` output includes `skills/intake/scripts/intake-file` |
| adr-2026-09-28-skills-may-bundle-executable-helpers#D7 | task | task-4 | lists `bin/intake-file` as `D` and `skills/intake/scripts/intake-file` as `A` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
