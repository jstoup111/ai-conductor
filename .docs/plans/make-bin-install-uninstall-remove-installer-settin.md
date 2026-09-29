# Implementation Plan: bin/install --uninstall removes installer settings and reports preserved state (#1004)

**Date:** 2026-09-28
**Stories:** .docs/stories/make-bin-install-uninstall-remove-installer-settin.md
**Conflict check:** Not required (Tier S)

## Summary

Extend `uninstall()` in `bin/install` so it removes the harness hook and permission entries from `~/.claude/settings.json`, removes the harness rate-card link, reports the `~/.ai-conductor/` state it keeps, and supports a guarded `--purge`. The work is nine TDD tasks in one script and one new shell test.

## Technical Approach

- **Settings removal is one inline python3 pass and the first step of `uninstall()`**, so every existing and new removal step runs after it. It takes the same shape as `configure_permissions` and `configure_hooks`: a heredoc script, the settings path as argv, and the permission list written to a temp file from the existing `HARNESS_PERMISSIONS` array. Install code does not change.
- **Ownership rule (operator-confirmed).** A hook command is harness-owned iff it starts with `${HARNESS_DIR}/hooks/claude/`. A permission is harness-owned iff it exactly equals an entry of `HARNESS_PERMISSIONS`. In each hook entry group, only owned commands are dropped. A group with no commands left is dropped, then an event array with no groups left, then the `hooks` object with no events left. The same applies to `permissions.allow` and the `permissions` object. A container is pruned only if it was non-empty before this pass and removal emptied it. The file is rewritten (`indent=2` plus a trailing newline, matching install) only when at least one entry was removed. Otherwise its bytes are untouched.
- **Failure accounting.** A new `UNINSTALL_FAILURE` flag (unset by default) is set when python3 is missing or the settings file cannot be parsed. Every later uninstall step still runs. When the flag is set, the tail prints `Uninstall incomplete` and returns 1 instead of `Uninstall complete.`.
- **Rate-card link.** Remove `~/.ai-conductor/rate-card.json` only when it is a symlink whose `readlink` equals `${HARNESS_DIR}/.ai-conductor/rate-card.json`. This is the exact ownership test `sync_global_rate_card` in `bin/lib/harness-common.sh` uses. A regular file or a foreign link is preserved with a warning.
- **Kept-state report and `--purge`.** The option loop in the Main section gains `--purge`, setting a new `PURGE=false` global declared next to `UPDATE_MODE`. When `PURGE` is set and the mode is not `--uninstall`, the script prints the usage text and exits 1 before any mode runs, so the help text moves into a `usage()` function shared by `-h` and this refusal. Under `--uninstall --purge`, `uninstall()` first refuses when `HOME` is empty. Unset `HOME` already aborts earlier under `set -u` at the top-level `CLAUDE_SKILLS_DIR="${HOME}/..."` assignment, with bash's `HOME: unbound variable` message. After the other steps, `uninstall()` deletes exactly `"${HOME}/.ai-conductor"`: `rm --` when it is a symlink, `rm -rf --` when it is a directory. This is one explicitly named path, never a glob. Without `--purge`, an existing `~/.ai-conductor` gets a kept-state info line.
- **Test pattern.** The new test `test/test_install_uninstall.sh` follows `test/test_codex_skill_installation.sh`: a `mktemp` root, a throwaway `HOME` per case, stub executables for `npm node claude codex rtk uv` on a restricted `PATH` with a real `python3` symlinked in, and `bin/install … --allow-worktree-root </dev/null` under `timeout`. Install exits non-zero under the stubbed build (conduct-ts incomplete), so tests never assert install's exit status. They assert only the state that install and uninstall leave behind. Seed fixtures from a real install into a template `HOME`, copied per case, so the harness entries are exactly the installer's own. Search hints: `run_install`, `STUBS`, `check '` in the existing installer tests. Compare parsed JSON with `python3 -c 'import json,sys; …'`. Compare exact bytes with `cmp`.

## Prerequisites

- None. No migration, dependency, or external service.

## Tasks

### Task 1: Remove harness-owned hooks and permissions from settings.json

**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/test_install_uninstall.sh`, using the harness pattern from the Technical Approach (template install into a throwaway `HOME`, copied per case). Case A adds an operator hook (`/opt/mine/hook.sh` under `PreToolUse` with matcher `Bash`), an operator permission (`Bash(make:*)`) and a top-level key (`"theme": "dark"`), runs `--uninstall`, and asserts that no hook command starts with `$CHECKOUT/hooks/claude/`, no allow entry equals an installer permission, and the three operator values parse unchanged. Case B uses settings holding only installer entries and asserts that `hooks` and `permissions` are both absent afterwards. Case C adds an operator command inside the same `PreToolUse` group as `block-destructive-git.sh` and asserts that the group survives with its matcher and only the operator command. Case D uses a hook command `/elsewhere/hooks/claude/docs-guard.sh` and a permission `Read(/elsewhere/**)` and asserts that both survive. Case E starts with pre-existing `"hooks": {}` and `"permissions": {"allow": []}` and no harness entries, and asserts that both empty containers remain. Every case asserts the output line `Settings: removed <H> harness hook commands and <P> permissions from <file>` with the counts actually removed.
2. Verify RED: today's `uninstall()` leaves every harness entry in place.
3. Implement the python3 settings pass as the first step of `uninstall()`, as specified in the Technical Approach: prefix ownership for hooks, exact-match ownership for `HARNESS_PERMISSIONS`, pruning only containers that removal emptied, and a rewrite in install's `indent=2` format.
4. Verify GREEN.
5. Commit: `fix(install): remove harness hooks and permissions on uninstall`.

**Done when:**
- Case A: after `bin/install --uninstall`, no hook command in the settings file starts with `$CHECKOUT/hooks/claude/` and no `permissions.allow` entry equals an installer permission, while the operator hook, the operator permission, and the `theme` key parse to their pre-uninstall values.
- Case B: after the settings pass empties them, the event arrays, the `hooks` object, the `allow` list, and the `permissions` object are absent from the parsed settings rather than present and empty.
- Case C: the mixed `PreToolUse` group survives with matcher `Bash` and exactly one command, the operator's, after the harness command is removed from it.
- Case D preserves the `/elsewhere/hooks/claude/docs-guard.sh` hook entry and the `Read(/elsewhere/**)` permission unchanged, and Case E preserves the pre-existing empty `hooks` object and empty `allow` list.
- Uninstall output contains `Settings: removed <H> harness hook commands and <P> permissions from <file>`, naming the settings file path and the counts removed in that case.

**Files likely touched:**
- `bin/install` — settings pass in `uninstall()`
- `test/test_install_uninstall.sh` — new test file with cases A–E

**Dependencies:** none

### Task 2: Leave settings untouched when there is nothing to remove

**Story:** Story 1; Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests. In one case the throwaway `HOME` has no `~/.claude/settings.json`. Run `--uninstall` and assert that the file still does not exist, that output contains `Settings: no settings entries to remove (<file> not found)`, and that the exit status is 0. In another case, run `--uninstall` twice on an installed `HOME`, `cp` the settings file after the first run, and assert that the second run exits 0, prints `Settings: no harness settings entries found to remove in <file>`, and leaves the file `cmp`-identical.
2. Verify RED: the missing-file case must not create a file, and the second run must not rewrite the file.
3. Implement: in the settings pass, exit early with the not-found message when the file is absent, and skip the write with the found-none message when zero entries were removed.
4. Verify GREEN.
5. Commit: `fix(install): uninstall leaves settings untouched when nothing is owned`.

**Done when:**
- With no settings file present, `bin/install --uninstall` creates no `~/.claude/settings.json`, prints `Settings: no settings entries to remove (<file> not found)`, and exits 0.
- A second `bin/install --uninstall` exits 0, prints `Settings: no harness settings entries found to remove in <file>`, and leaves the settings file `cmp`-identical to its state after the first uninstall.

**Files likely touched:**
- `bin/install` — early-exit and no-write paths in the settings pass
- `test/test_install_uninstall.sh` — missing-file and second-run cases

**Dependencies:** Task 1

### Task 3: Report an incomplete uninstall when settings cannot be cleaned

**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests. Case M: an installed `HOME` has `~/.claude/settings.json` overwritten with `{"hooks": [` (malformed). Case P: an installed `HOME` runs uninstall on a `PATH` with no `python3`. Both cases also seed `$HOME/.local/bin/conduct`, `conduct-ts` and `ai-conductor` as symlinks to `$CHECKOUT/bin/ai-conductor`, because the stubbed build does not create them. For both, snapshot the settings file and assert that after `--uninstall` it is `cmp`-identical and that the warning names the settings file path. Assert that every step after the settings pass still ran: the skill symlinks under `$HOME/.claude/skills` are gone, the three seeded launcher links are gone, the harness rate-card link is gone, and the `Kept` line is printed. that output contains `Uninstall incomplete` and not `Uninstall complete.`, and that the exit status is non-zero. Case M's warning is `Could not remove harness settings from <file>`. Case P's warning is `python3 not found — harness hooks and permissions remain in <file>`.
2. Verify RED.
3. Implement: set `UNINSTALL_FAILURE` from the python3-missing branch and from a non-zero exit of the settings pass (the python script exits non-zero on a JSON decode error before writing). Replace the unconditional `Uninstall complete.` tail with a branch that prints `Uninstall incomplete` plus the recorded reason and returns 1 when the flag is set.
4. Verify GREEN.
5. Commit: `fix(install): fail uninstall visibly when settings cannot be cleaned`.

**Done when:**
- Case M leaves the malformed settings file `cmp`-identical, prints `Could not remove harness settings from <file>`, still runs every later uninstall step (harness skill symlinks, the three seeded `$HOME/.local/bin` launcher links, and the harness rate-card link all removed, and the `Kept` line printed), prints `Uninstall incomplete` without `Uninstall complete.`, and exits non-zero.
- Case P, with no `python3` on `PATH`, leaves the settings file `cmp`-identical, prints `python3 not found — harness hooks and permissions remain in <file>`, still runs every later uninstall step (harness skill symlinks, the three seeded `$HOME/.local/bin` launcher links, and the harness rate-card link all removed, and the `Kept` line printed), prints `Uninstall incomplete`, and exits non-zero.

**Files likely touched:**
- `bin/install` — `UNINSTALL_FAILURE` flag and uninstall tail
- `test/test_install_uninstall.sh` — malformed-JSON and no-python3 cases

**Dependencies:** Task 5

### Task 4: Remove the harness rate-card link and preserve foreign rate cards

**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests. Case R1 is an installed `HOME` whose `~/.ai-conductor/rate-card.json` links to `$CHECKOUT/.ai-conductor/rate-card.json`. Case R2 replaces it with a regular file. Case R3 replaces it with a symlink to `/elsewhere/rate-card.json`. After `--uninstall`, assert that R1's link is gone and output has `Removed global rate card link <path>`, that R2's file is `cmp`-identical and output has `is not a harness link`, and that R3's link still reads `/elsewhere/rate-card.json` and output has `points elsewhere`.
2. Verify RED.
3. Implement the rate-card step in `uninstall()` with the `readlink` equality test from `sync_global_rate_card`.
4. Verify GREEN.
5. Commit: `fix(install): remove the harness rate-card link on uninstall`.

**Done when:**
- Case R1: after uninstall, `$HOME/.ai-conductor/rate-card.json` does not exist and output contains `Removed global rate card link` with that path.
- Case R2: the regular-file rate card is `cmp`-identical after uninstall and output contains a warning with `is not a harness link`.
- Case R3: the foreign symlink still resolves via `readlink` to `/elsewhere/rate-card.json` after uninstall and output contains a warning with `points elsewhere`.

**Files likely touched:**
- `bin/install` — rate-card step in `uninstall()`
- `test/test_install_uninstall.sh` — cases R1–R3

**Dependencies:** Task 2

### Task 5: Report the kept ~/.ai-conductor state after uninstall

**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests. Case K1 is an installed `HOME` that also has `~/.ai-conductor/registry.json` and `~/.ai-conductor/memory/note.md`. After `--uninstall`, assert that both files are `cmp`-identical, and that output contains the kept line naming `$HOME/.ai-conductor`, the words `project registry` and `memory`, and `--purge`. Case K2 is a `HOME` with no `~/.ai-conductor`. Assert that uninstall exits 0, that `$HOME/.ai-conductor` still does not exist, and that output has no `Kept` line.
2. Verify RED.
3. Implement: after the rate-card step, when `PURGE` is false and `${HOME}/.ai-conductor` exists, print `Kept <dir>: operator configuration and runtime data (project registry, memory). Re-run with --uninstall --purge to remove it.`
4. Verify GREEN.
5. Commit: `fix(install): report preserved harness state on uninstall`.

**Done when:**
- Case K1: after uninstall, `registry.json` and `memory/note.md` under `$HOME/.ai-conductor` are `cmp`-identical, and output contains the exact line `Kept $HOME/.ai-conductor: operator configuration and runtime data (project registry, memory). Re-run with --uninstall --purge to remove it.`.
- Case K2: uninstall exits 0, `$HOME/.ai-conductor` still does not exist afterwards, and output contains no `Kept` line.

**Files likely touched:**
- `bin/install` — kept-state report in `uninstall()`
- `test/test_install_uninstall.sh` — cases K1–K2

**Dependencies:** Task 4

### Task 6: Add --purge to delete the harness state directory

**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests. Case U1 is an installed `HOME` with a populated `~/.ai-conductor` and the three `$HOME/.local/bin` launcher links seeded as in Task 3. After `--uninstall --purge`, assert that `$HOME/.ai-conductor` does not exist, that output contains `Purged <dir>`, and that the same settings, skill-link and rate-card removals as plain uninstall happened. Case U2 makes `$HOME/.ai-conductor` a symlink to `$TMP_ROOT/state` holding `keep.txt`. Assert that the symlink is gone and `$TMP_ROOT/state/keep.txt` is `cmp`-identical. Case U3 is a `HOME` without `~/.ai-conductor`. Assert that output contains `Nothing to purge` and the exit status is 0. Also assert that `bin/install --help` output contains `--purge`.
2. Verify RED.
3. Implement: add `PURGE=false`, add a `--purge` case in the option loop, and move the help text into a `usage()` function that lists `--purge`. In `uninstall()`, when `PURGE` is true, delete exactly `"${HOME}/.ai-conductor"`: `rm --` when it is a symlink, `rm -rf --` when it is a directory. Otherwise print the nothing-to-purge line.
4. Verify GREEN.
5. Commit: `feat(install): add --purge to uninstall`.

**Done when:**
- Case U1: after `bin/install --uninstall --purge`, `$HOME/.ai-conductor` does not exist, output contains `Purged`, and every plain-uninstall removal also happened: the settings file has no harness hooks or permissions, the harness skill symlinks are gone, the harness rate-card link is gone, and the three seeded `$HOME/.local/bin` launcher links are gone.
- Case U2: the `$HOME/.ai-conductor` symlink is removed and `$TMP_ROOT/state/keep.txt` is `cmp`-identical afterwards.
- Case U3: with no `$HOME/.ai-conductor`, `--uninstall --purge` prints `Nothing to purge` and exits 0.
- `bin/install --help` output lists `--purge` alongside `--uninstall`.

**Files likely touched:**
- `bin/install` — `PURGE` global, option loop, `usage()`, purge step in `uninstall()`
- `test/test_install_uninstall.sh` — cases U1–U3 and the help assertion

**Dependencies:** Task 3

### Task 7: Refuse unsafe or misplaced --purge

**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests. Case X1 runs `bin/install --purge` on an installed `HOME`. Snapshot the `HOME` tree first with `find "$HOME" -printf '%p %y %s %l\n' | sort` plus checksums of regular files, then assert that the command exits 1, prints the usage text, and leaves the snapshot identical. Case X2 runs `HOME= bin/install --uninstall --purge` with a sentinel `$TMP_ROOT/.ai-conductor` that must survive. Assert a non-zero exit, output containing `Refusing --purge: HOME is unset or empty`, and the sentinel intact. Case X3 runs `env -u HOME bin/install --uninstall --purge`. Assert a non-zero exit, output containing `HOME`, and the sentinel intact.
2. Verify RED.
3. Implement: after the mode dispatch reads `$1`, if `PURGE` is true and `$1` is not `--uninstall`, call `usage` and `exit 1` before any mode runs. At the top of `uninstall()`, when `PURGE` is true and `HOME` is empty, `fail` with the refusal message and return 1 before any removal. Unset `HOME` needs no new code, because `set -u` aborts at the top-level `HOME` expansion. The test pins that behavior.
4. Verify GREEN.
5. Commit: `fix(install): refuse --purge without --uninstall or a resolvable HOME`.

**Done when:**
- Case X1: `bin/install --purge` exits 1, prints the `usage()` text, and the sorted `find` listing plus file checksums of the test `HOME` are identical before and after.
- Case X2: with `HOME` empty, `bin/install --uninstall --purge` exits non-zero, prints `Refusing --purge: HOME is unset or empty` before any removal, and the sentinel `.ai-conductor` directory still exists.
- Case X3: with `HOME` unset, `bin/install --uninstall --purge` exits non-zero with output naming `HOME`, and no directory is deleted.

**Files likely touched:**
- `bin/install` — purge-mode guard in Main dispatch, empty-HOME refusal in `uninstall()`
- `test/test_install_uninstall.sh` — cases X1–X3

**Dependencies:** Task 6

### Task 8: Pin the install → uninstall round trip

**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write the round-trip tests. Each case starts from a fresh throwaway `HOME` with no installed harness. Case T1 seeds `~/.claude/settings.json` with an operator hook, an operator permission and a `theme` key, saves the parsed JSON, and runs `bin/install` and then `bin/install --uninstall --purge`. It asserts that the settings parse to the saved value, that `$HOME/.claude/skills`, `$HOME/.agents/skills` and `$HOME/.local/bin` contain no symlink resolving under `$CHECKOUT`, and that `$HOME/.ai-conductor` does not exist. Case T2 is the same but runs plain `--uninstall`. It asserts the same settings and link results, that `$HOME/.ai-conductor` still exists, and that output has the `Kept` line. Case T3 starts with no settings file and asserts that after install then uninstall the settings file parses to `{}`.
2. Verify RED against the pre-change uninstall: materialize the merge-base `bin/install` via `git show <merge-base>:bin/install` into a temp checkout copy and confirm T1 fails there. Do not use `git stash`.
3. No production change is expected. If a case fails against the current `bin/install`, fix the defect inside the owning step of `uninstall()`.
4. Verify GREEN.
5. Commit: `test(install): pin the install-uninstall round trip`.

**Done when:**
- Case T1: after `bin/install` then `bin/install --uninstall --purge`, the settings file parses to the same JSON value saved before install, the skill directories and `$HOME/.local/bin` hold no symlink resolving under `$CHECKOUT`, and `$HOME/.ai-conductor` does not exist.
- Case T2: after `bin/install` then plain `bin/install --uninstall`, the settings and link assertions of T1 hold, `$HOME/.ai-conductor` still exists, and output contains the `Kept` line.
- Case T3: starting with no settings file, after install then uninstall the settings file contains no harness hooks or permissions and parses to `{}`.
- Case T1 fails when run against the merge-base `bin/install`, as recorded in the task's RED evidence.

**Files likely touched:**
- `test/test_install_uninstall.sh` — round-trip cases T1–T3

**Dependencies:** Task 1, Task 4, Task 6

### Task 9: Leave the symlink target untouched, including its rate-card link, under --purge

**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test. Case U4 is an installed `HOME` whose `$HOME/.ai-conductor` is a symlink to `$TMP_ROOT/state-u4`, a directory holding `keep.txt` and `rate-card.json`, a symlink whose `readlink` equals `$CHECKOUT/.ai-conductor/rate-card.json` (the harness-owned link). Snapshot the target with `find "$TMP_ROOT/state-u4" -printf '%p %y %s %l\n' | sort` plus checksums of its regular files. Run `bin/install --uninstall --purge` and assert that `$HOME/.ai-conductor` no longer exists, that `$TMP_ROOT/state-u4/rate-card.json` is still a symlink whose `readlink` equals `$CHECKOUT/.ai-conductor/rate-card.json`, that `keep.txt` is `cmp`-identical, and that the snapshot is identical.
2. Verify RED: today the rate-card step at `bin/install` (the `rate_card="${HOME}/.ai-conductor/rate-card.json"` block) removes the link through the `~/.ai-conductor` symlink before the purge step unlinks it, so the target directory loses `rate-card.json`.
3. Implement: in `uninstall()`, when `PURGE` is true and `"${HOME}/.ai-conductor"` is a symlink, skip the rate-card removal (print an info line that the rate card inside the symlinked state directory is left in place) so that nothing inside the symlink target is changed; the purge step then removes only the symlink. Plain uninstall (no `--purge`) and a real-directory `~/.ai-conductor` keep their existing rate-card behavior.
4. Verify GREEN, and confirm cases R1, U1 and U2 still pass.
5. Commit: `fix(install): purge leaves a symlinked state directory's target untouched`.

**Done when:**
- Case U4: after `bin/install --uninstall --purge` with `$HOME/.ai-conductor` a symlink to `$TMP_ROOT/state-u4`, the `$HOME/.ai-conductor` symlink is removed and `$TMP_ROOT/state-u4/rate-card.json` is still a symlink whose `readlink` equals `$CHECKOUT/.ai-conductor/rate-card.json`.
- Case U4: the sorted `find` listing plus file checksums of `$TMP_ROOT/state-u4` are identical before and after, and `$TMP_ROOT/state-u4/keep.txt` is `cmp`-identical.
- Cases R1, U1 and U2 still pass unchanged after this task.

**Files likely touched:**
- `bin/install` — symlinked-state guard on the rate-card step in `uninstall()`
- `test/test_install_uninstall.sh` — case U4

**Dependencies:** Task 7

## Task Dependency Graph

```
Task 1 → Task 2 → Task 4 → Task 5 → Task 3 → Task 6 → Task 7 → Task 9
Task 1, Task 4, Task 6 → Task 8
```

The chain is serial because every task edits `uninstall()` and the shared test file.

## Integration Points

- After Task 1, `bin/install --uninstall` on a real installed `HOME` removes the harness settings entries end to end.
- Task 8 owns the CLI-level install → uninstall round trip.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a settings file holding every harness hook entry and harness permission alongside an operator-authored hook, an operator-authored permission, and an unrelated top-level key, when `bin/install --uninstall` runs, then every hook command under this checkout's `hooks/claude/` directory and every exact-match harness permission is gone, and the operator-authored hook, permission, and unrelated key are unchanged. | 1 | "no hook command in the settings file starts with `$CHECKOUT/hooks/claude/` and no `permissions.allow` entry equals an installer permission, while the operator hook, the operator permission, and the `theme` key parse to their pre-uninstall values" | diff-local |
| Story 1 happy: Given a hook event array and a permissions allow list that contain only harness entries, when uninstall removes them, then the emptied event array, the emptied `hooks` object, the emptied `allow` list, and the emptied `permissions` object are removed rather than left empty. | 1 | "the event arrays, the `hooks` object, the `allow` list, and the `permissions` object are absent from the parsed settings rather than present and empty" | diff-local |
| Story 1 happy: Given one hook entry group that holds both a harness hook command and an operator-authored hook command, when uninstall runs, then the harness command is removed from that group and the group survives with the operator-authored command and its matcher intact. | 1 | "the mixed `PreToolUse` group survives with matcher `Bash` and exactly one command, the operator's, after the harness command is removed from it" | diff-local |
| Story 1 happy: Given uninstall has removed settings entries, when it reports, then its output names the settings file and the number of hook commands and permissions it removed. | 1 | "naming the settings file path and the counts removed in that case" | diff-local |
| Story 1 negative: Given a hook command that points at a `hooks/claude/` script with a harness script name but under a different directory than this checkout, when uninstall runs, then that hook entry is preserved unchanged. | 1 | "Case D preserves the `/elsewhere/hooks/claude/docs-guard.sh` hook entry" | diff-local |
| Story 1 negative: Given an operator-authored permission that differs from a harness permission only by its path or pattern, when uninstall runs, then that permission is preserved unchanged. | 1 | "the `Read(/elsewhere/**)` permission unchanged" | diff-local |
| Story 1 negative: Given a settings file that already held an empty `hooks` object or an empty `allow` list before uninstall, when uninstall runs, then that pre-existing empty container is preserved. | 1 | "Case E preserves the pre-existing empty `hooks` object and empty `allow` list" | diff-local |
| Story 1 negative: Given no `~/.claude/settings.json` exists, when uninstall runs, then no settings file is created and uninstall reports that there were no settings entries to remove. | 2 | "creates no `~/.claude/settings.json`, prints `Settings: no settings entries to remove (<file> not found)`, and exits 0" | diff-local |
| Story 1 negative: Given `~/.claude/settings.json` holds malformed JSON, when uninstall runs, then the file is left byte-for-byte unchanged, uninstall warns that it could not remove harness settings from that file, the remaining uninstall steps still run, and uninstall ends with the `Uninstall incomplete` summary and a non-zero exit status. | 3 | "Case M leaves the malformed settings file `cmp`-identical, prints `Could not remove harness settings from <file>`, still runs every later uninstall step (harness skill symlinks, the three seeded `$HOME/.local/bin` launcher links, and the harness rate-card link all removed, and the `Kept` line printed), prints `Uninstall incomplete` without `Uninstall complete.`, and exits non-zero" | diff-local |
| Story 1 negative: Given `python3` is not available, when uninstall runs, then the settings file is left byte-for-byte unchanged, uninstall warns that harness hooks and permissions remain in that file, the remaining uninstall steps still run, and uninstall exits non-zero with the `Uninstall incomplete` summary. | 3 | "leaves the settings file `cmp`-identical, prints `python3 not found — harness hooks and permissions remain in <file>`, still runs every later uninstall step (harness skill symlinks, the three seeded `$HOME/.local/bin` launcher links, and the harness rate-card link all removed, and the `Kept` line printed), prints `Uninstall incomplete`, and exits non-zero" | diff-local |
| Story 2 happy: Given `~/.ai-conductor/rate-card.json` is a symlink to this checkout's committed rate card, when `bin/install --uninstall` runs, then the link is removed and the output reports its removal. | 4 | "after uninstall, `$HOME/.ai-conductor/rate-card.json` does not exist and output contains `Removed global rate card link` with that path" | diff-local |
| Story 2 happy: Given `~/.ai-conductor/` exists and still holds content after the rate-card link is removed, when uninstall finishes, then `~/.ai-conductor/` and its contents are left in place, and the output names the directory, says it holds operator configuration and runtime data such as the project registry and memory, and says that `--purge` removes it. | 5 | "after uninstall, `registry.json` and `memory/note.md` under `$HOME/.ai-conductor` are `cmp`-identical, and output contains the exact line `Kept $HOME/.ai-conductor: operator configuration and runtime data (project registry, memory). Re-run with --uninstall --purge to remove it.`" | diff-local |
| Story 2 negative: Given `~/.ai-conductor/rate-card.json` is a regular file, when uninstall runs, then the file is preserved and uninstall warns that the rate card is not a harness link. | 4 | "the regular-file rate card is `cmp`-identical after uninstall and output contains a warning with `is not a harness link`" | diff-local |
| Story 2 negative: Given `~/.ai-conductor/rate-card.json` is a symlink to a path outside this checkout, when uninstall runs, then the link is preserved and uninstall warns that it points elsewhere. | 4 | "the foreign symlink still resolves via `readlink` to `/elsewhere/rate-card.json` after uninstall and output contains a warning with `points elsewhere`" | diff-local |
| Story 2 negative: Given `~/.ai-conductor/` does not exist, when uninstall runs, then uninstall creates nothing there, prints no kept-state line for it, and still exits 0. | 5 | "uninstall exits 0, `$HOME/.ai-conductor` still does not exist afterwards, and output contains no `Kept` line" | diff-local |
| Story 3 happy: Given an installed harness with a populated `~/.ai-conductor/`, when `bin/install --uninstall --purge` runs, then everything plain uninstall removes is removed, `~/.ai-conductor/` no longer exists, and the output reports that it was purged. | 6 | "after `bin/install --uninstall --purge`, `$HOME/.ai-conductor` does not exist, output contains `Purged`, and every plain-uninstall removal also happened: the settings file has no harness hooks or permissions, the harness skill symlinks are gone, the harness rate-card link is gone, and the three seeded `$HOME/.local/bin` launcher links are gone" | diff-local |
| Story 3 happy: Given `~/.ai-conductor` is a symlink to a directory, when `--uninstall --purge` runs, then the symlink is removed and the directory it points to is left unchanged. | 9 | "the `$HOME/.ai-conductor` symlink is removed and `$TMP_ROOT/state-u4/rate-card.json` is still a symlink whose `readlink` equals `$CHECKOUT/.ai-conductor/rate-card.json`" | diff-local |
| Story 3 negative: Given `--purge` is passed without `--uninstall`, when `bin/install` runs, then it prints the usage text, exits 1, and changes nothing on disk. | 7 | "`bin/install --purge` exits 1, prints the `usage()` text, and the sorted `find` listing plus file checksums of the test `HOME` are identical before and after" | diff-local |
| Story 3 negative: Given `HOME` is unset or empty, when `bin/install --uninstall --purge` runs, then no directory is deleted, the purge is refused with a message naming the unresolved home directory, and the command exits non-zero. | 7 | "with `HOME` empty, `bin/install --uninstall --purge` exits non-zero, prints `Refusing --purge: HOME is unset or empty` before any removal, and the sentinel `.ai-conductor` directory still exists" | diff-local |
| Story 3 negative: Given `~/.ai-conductor/` does not exist, when `--uninstall --purge` runs, then uninstall reports that there is nothing to purge and exits 0. | 6 | "with no `$HOME/.ai-conductor`, `--uninstall --purge` prints `Nothing to purge` and exits 0" | diff-local |
| Story 4 happy: Given a fresh `HOME` whose `~/.claude/settings.json` holds operator-authored hooks, permissions, and other keys, when `bin/install` and then `bin/install --uninstall --purge` run, then the settings file parses to the same JSON value as before install, the Claude and Codex skill directories and `~/.local/bin` hold no harness entries, and `~/.ai-conductor/` does not exist. | 8 | "the settings file parses to the same JSON value saved before install, the skill directories and `$HOME/.local/bin` hold no symlink resolving under `$CHECKOUT`, and `$HOME/.ai-conductor` does not exist" | diff-local |
| Story 4 happy: Given the same fresh `HOME`, when `bin/install` and then `bin/install --uninstall` run without `--purge`, then the result matches the purged round trip except that `~/.ai-conductor/` remains, and the output reports it as kept. | 8 | "the settings and link assertions of T1 hold, `$HOME/.ai-conductor` still exists, and output contains the `Kept` line" | diff-local |
| Story 4 negative: Given uninstall has already completed, when `bin/install --uninstall` runs a second time, then it exits 0, reports that no harness settings entries were found to remove, and leaves `~/.claude/settings.json` byte-for-byte unchanged. | 2 | "A second `bin/install --uninstall` exits 0, prints `Settings: no harness settings entries found to remove in <file>`, and leaves the settings file `cmp`-identical to its state after the first uninstall" | diff-local |
| Story 4 negative: Given a fresh `HOME` with no `~/.claude/settings.json`, when install then uninstall run, then the settings file that install created contains no harness hooks or permissions afterwards and parses to an empty JSON object. | 8 | "starting with no settings file, after install then uninstall the settings file contains no harness hooks or permissions and parses to `{}`" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
