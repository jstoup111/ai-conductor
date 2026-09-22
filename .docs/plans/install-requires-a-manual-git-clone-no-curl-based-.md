# Implementation Plan: One-line installer (#1712)

**Date:** 2026-09-18
**Design:** .docs/specs/2026-09-18-install-requires-a-manual-git-clone-no-curl-based-.md
**Stories:** .docs/stories/install-requires-a-manual-git-clone-no-curl-based-.md
**Conflict check:** Not required at Tier S

## Summary

Add one self-contained POSIX shell bootstrap script, published by the documentation site and linked from `bin/`, that checks prerequisites, acquires the harness over anonymous HTTPS into `~/.ai-conductor/harness`, and hands off to the existing installer (first run) or the existing updater (re-run). Twelve TDD tasks; `bin/install` and `bin/update` are not modified.

## Technical Approach

- **One new file, `docs/install.sh`.** It is a real file under `docs/` because GitHub Pages builds this site from `stable:/docs`, so the published URL (`https://jstoup111.github.io/ai-conductor/install.sh`) can only ever serve released code. `bin/bootstrap` is a symlink to it for discoverability. The reverse direction is not viable: the site generator's safe mode drops symlinks that leave the site source (inferred ~80%, not tested; Task 12's checks hold either way because the real file is the one under `docs/`).
- **Shape of the script.** `#!/bin/sh`, `set -eu`, every statement inside a function, and a single final `main "$@"` line — a truncated download therefore defines functions at most and runs nothing. `main` order: `parse_args` → `check_prerequisites` → `classify_target` → (`fresh`: `resolve_ref` → `announce` → `acquire` → `run_installer`) or (`ours`: `run_updater`). Everything that can refuse runs before the first filesystem write.
- **Acquisition.** `git clone --branch <ref>` from `REPO_URL` (default `https://github.com/jstoup111/ai-conductor.git`; `AI_CONDUCTOR_REPO_URL` overrides it and is the test seam) into `harness.partial.$$`, renamed to `harness` only on success. An atomic `mkdir` lock directory serializes concurrent first runs. One `EXIT INT TERM` trap removes the explicitly named partial directory and a lock this process created — never a glob.
- **Channel → ref.** `stable`→branch `stable`, `main`→branch `main`, `tagged`→highest `vX.Y.Z` from `git ls-remote --tags`. The option beats `AI_CONDUCTOR_CHANNEL`, matching `bin/install`. With neither, the script acquires `stable` and forwards nothing, so the installer's own first-run rules (#1711) decide what is recorded.
- **Hand-off under a pipe.** In `curl … | sh` the script's stdin is the pipe, so `bin/install` and `bin/update` would see no terminal and `bin/update` would only print its manual hint. When `/dev/tty` can be opened, both are run with stdin redirected from it, which preserves their existing prompts; when it cannot, their existing non-terminal behavior applies unchanged.
- **Tests.** One new standalone script, `test/test_bootstrap_installer.sh`, in the style of the existing installer tests (temp root, isolated `HOME`, stub commands on a restricted `PATH`, a local `git init` stand-in repository with recording stub `bin/install`/`bin/update`). It is wired into `test/test_harness_integrity.sh`, which is what the `test_suite` gate runs.
- **Sequencing.** Task 1 creates both files. Tasks 2, 4, and 12 depend only on it. Task 3 (acquisition) unlocks 5, 7, 8, and 11, which are independent of each other; 6 follows 5, 9 follows 8 (it consumes `classify_target`), 10 follows 7 (it extends `cleanup`).

## Prerequisites

- None. #1711 shipped in PR #1720; the repository is public; no migration or dependency is added.

## Tasks

### Task 1: Option parsing rejects bad input before anything is touched

**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_bootstrap_installer.sh` (new file). Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network.
2. Cases: `--help` prints usage naming `--channel` and `--providers` and exits 0; an unknown option exits non-zero naming it; `--channel beta` exits non-zero naming `beta` and `stable, tagged, main`; `--providers gemini` exits non-zero naming `gemini` and `claude, codex`. Every case asserts `$HOME/.ai-conductor/harness` does not exist afterward and the stand-in repository's record file is empty.
3. Verify the tests fail (RED) — the script does not exist yet.
4. Implement `docs/install.sh` as a POSIX `#!/bin/sh` script (`set -eu`) whose entire body lives in functions and whose final line is `main "$@"`. Add `usage`, `fail`, and `parse_args`: accept `--channel <v>`, `--channel=<v>`, `--providers <v>`, `--providers=<v>`, `-h`/`--help`; validate channel against `stable, tagged, main` and each comma-separated provider against `claude, codex`. `parse_args` runs first in `main`, before any other function.
5. Wire the new test into `test/test_harness_integrity.sh` following the existing `test_release_pr_workflow.sh` block: assert the file exists, run it with `bash`, and `assert` on its exit status.
6. Verify GREEN, then commit: "feat(install): bootstrap script option parsing".

**Done when:**
- `parse_args` in `docs/install.sh` exits non-zero and prints the offending token for an unknown option, and the unknown-option test asserts both the token in stderr and an absent `$HOME/.ai-conductor/harness`.
- `parse_args` rejects a channel outside `stable, tagged, main` with a message containing the bad value and all three accepted values, asserted by the invalid-channel test together with an empty stand-in record file.
- `parse_args` rejects a provider outside `claude, codex` with a message containing the bad value and both accepted values, asserted by the invalid-provider test together with an empty stand-in record file.
- `usage` prints both option names and `main` exits 0 on `--help` without reaching acquisition, asserted by the help test's empty record file and absent harness directory.
- `test/test_harness_integrity.sh` runs `test/test_bootstrap_installer.sh` and fails when that script exits non-zero.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`; `test/test_harness_integrity.sh`

**Dependencies:** none

### Task 2: Prerequisite check names everything missing in one pass

**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network. Build a restricted `PATH` directory of symlinks/stubs so individual tools can be withheld.
2. Cases: all of `git gh node npm tmux python3` present with an importable `yaml` module → no prerequisite output and the run continues; `tmux` and `gh` withheld → non-zero exit and ONE message containing both names; `python3` replaced by a stub that exits non-zero for `-c 'import yaml'` → message names `PyYAML`. Failing cases assert the harness directory is absent and the record file is empty.
3. Verify RED.
4. Implement `check_prerequisites` in `docs/install.sh`: loop `command -v` over the six tools accumulating misses in one variable, then probe `python3 -c 'import yaml'` when python3 exists and append `PyYAML` on failure; if the accumulator is non-empty call `fail` once with the full list. `main` calls it immediately after `parse_args` and before any filesystem write.
5. Verify GREEN, then commit: "feat(install): bootstrap prerequisite check".

**Done when:**
- `check_prerequisites` accumulates every absent tool and calls `fail` exactly once, asserted by the two-missing test finding both `tmux` and `gh` in a single stderr message with a non-zero exit and an absent harness directory.
- `check_prerequisites` probes `python3 -c 'import yaml'` and reports `PyYAML` when the import fails, asserted by the PyYAML test together with an empty stand-in record file.
- `check_prerequisites` prints nothing and returns 0 when all six tools and the `yaml` import are present, asserted by the all-present test observing no prerequisite text and a continuing run.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 1

### Task 3: Fresh install acquires over HTTPS and runs the existing installer

**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network.
2. Case: isolated `HOME` with no `.ai-conductor/harness`, no SSH agent or credential helper in the environment, stdin not a terminal. Run the script. Assert exit 0; `$HOME/.ai-conductor/harness/.git` exists; the stub installer's record shows its working directory / `$0` resolved inside `$HOME/.ai-conductor/harness`; stdout, before the first clone output, contains the canonical location and the channel name.
3. Verify RED.
4. Implement in `docs/install.sh`: constants `REPO_URL=${AI_CONDUCTOR_REPO_URL:-https://github.com/jstoup111/ai-conductor.git}` and `TARGET="$HOME/.ai-conductor/harness"`; `announce` prints target, channel, and source URL; `acquire` runs `git clone` of the resolved ref into `TARGET`; `run_installer` executes `"$TARGET/bin/install"` with the collected pass-through arguments. When `/dev/tty` can be opened, `run_installer` redirects the installer's stdin from it so the existing first-run prompts still work under a pipe; otherwise stdin is left as-is and the installer's own non-terminal rules apply. `main` order: `parse_args`, `check_prerequisites`, `announce`, `acquire`, `run_installer`; the script exits with the installer's status.
5. This task owns the cross-boundary integration proof: the test drives the real script file through `sh` exactly as the piped one-liner does (`sh -s -- <args> < docs/install.sh`).
6. Verify GREEN, then commit: "feat(install): bootstrap fresh acquisition and installer hand-off".

**Done when:**
- `acquire` clones the default `https://` `REPO_URL` (overridable only through `AI_CONDUCTOR_REPO_URL`) into `$HOME/.ai-conductor/harness`, asserted by the fresh-install test finding a `.git` directory there and exit 0 when the script is fed to `sh -s` on stdin with no credentials in the environment.
- `run_installer` executes `bin/install` from inside `$HOME/.ai-conductor/harness` and the script exits with its status, asserted by the stub installer's record naming that directory and by the script mirroring a stub exit code.
- `announce` prints the canonical location and the channel before `acquire` runs, asserted by the fresh-install test checking both strings appear in stdout ahead of the first clone output.
- The resulting machine state matches what a manual install on the same channel produces, asserted by the manual-parity test running the one-liner in one isolated `HOME` and a direct manual `git clone --branch <ref>` plus `bin/install` in a second isolated `HOME` on the same channel, then finding the stub installer's recorded arguments and working directory (relative to each `HOME`), the checked-out HEAD commit and branch, and `git status --porcelain` identical between the two.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 2

### Task 4: A truncated download never runs a partial install

**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network.
2. Case: for byte offsets at 25%, 50%, 75%, and (length − 2) of the script, feed `head -c <n>` of it to `sh` with the usual fixture environment. For every offset assert the harness directory is absent and the stand-in record file is empty (a non-zero or zero exit are both acceptable; what matters is that no step ran).
3. Verify RED if Task 1's layout regressed, otherwise confirm the test passes against the function-only layout and would fail if any top-level command preceded `main "$@"` (temporarily add one to prove it, then remove it).
4. Implement: keep `docs/install.sh` free of top-level commands other than function definitions, `set -eu`, and the single final `main "$@"` line with a trailing newline.
5. Verify GREEN, then commit: "test(install): bootstrap truncation safety".

**Done when:**
- `docs/install.sh` defers all work to the final `main "$@"` line, asserted by the truncation test feeding four truncated prefixes to `sh` and finding an absent harness directory and an empty record file each time.
- The truncation test fails when a top-level `git` or `mkdir` command is placed above the function definitions, demonstrated once during RED and recorded in the commit message.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 1

### Task 5: Channel selects the released ref and options reach the installer

**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network. Give the stand-in repository a `stable` branch, a `main` branch with one extra commit, and tags `v0.1.0` and `v0.2.0` (plus a non-semver tag `nightly`).
2. Cases: no channel, no terminal → checkout HEAD equals `stable` and the installer record shows no `--channel` argument and no `AI_CONDUCTOR_CHANNEL` (the installer's own stable fallback applies); `--channel main` → HEAD equals `main` and the record shows `--channel main`; `AI_CONDUCTOR_CHANNEL=tagged` → HEAD equals tag `v0.2.0` and the record shows the variable; `--channel stable` with `AI_CONDUCTOR_CHANNEL=main` → HEAD equals `stable` and the record shows `--channel stable`; `--providers claude,codex` → the record shows exactly `--providers claude,codex`.
3. Verify RED.
4. Implement `resolve_ref` in `docs/install.sh`: effective channel is the option, else `AI_CONDUCTOR_CHANNEL`, else `stable` for acquisition only; `stable`→branch `stable`, `main`→branch `main`, `tagged`→the highest `vX.Y.Z` from `git ls-remote --tags --refs "$REPO_URL"` sorted numerically by field. `acquire` clones with `--branch <ref>`. `run_installer` forwards `--channel` only when the option was given, leaves the environment variable untouched for the installer to read, and forwards `--providers` verbatim when given. Validate the environment variable's value in `parse_args` with the same accepted set.
5. Verify GREEN, then commit: "feat(install): bootstrap channel ref resolution and pass-through".

**Done when:**
- `resolve_ref` maps no channel to the `stable` branch and `run_installer` forwards no channel argument, asserted by the default-channel test comparing the checkout HEAD to `stable` and finding no `--channel` in the stub installer's record.
- `resolve_ref` maps `stable`, `main`, and `tagged` to the `stable` branch, the `main` branch, and the highest `vX.Y.Z` tag respectively for both the option and `AI_CONDUCTOR_CHANNEL` forms, asserted by three tests comparing checkout HEAD to the expected ref and finding the channel in the stub installer's record.
- `run_installer` forwards `--providers` verbatim, asserted by the providers test finding exactly `--providers claude,codex` in the stub installer's record.
- `resolve_ref` prefers the `--channel` option over `AI_CONDUCTOR_CHANNEL`, asserted by the precedence test finding HEAD at `stable` and `--channel stable` in the record while the variable says `main`.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 3

### Task 6: Tagged channel with no semver tag fails cleanly

**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network. Use a stand-in repository whose only tag is `nightly`.
2. Case: `--channel tagged` → non-zero exit, stderr says no `vX.Y.Z` release tag was found at the source URL, the harness directory is absent, and the installer record is empty.
3. Verify RED.
4. Implement: `resolve_ref` in `docs/install.sh` calls `fail` when the filtered tag list is empty; it runs before `acquire` creates anything.
5. Verify GREEN, then commit: "feat(install): bootstrap refuses tagged channel without a release tag".

**Done when:**
- `resolve_ref` calls `fail` naming the missing `vX.Y.Z` tag when `git ls-remote --tags` yields no semver tag, asserted by the no-tag test observing a non-zero exit and that message.
- `resolve_ref` runs before `acquire`, asserted by the no-tag test finding `$HOME/.ai-conductor/harness` absent and the installer record empty.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 5

### Task 7: Acquisition failure leaves no installation behind

**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network.
2. Cases: `AI_CONDUCTOR_REPO_URL` pointing at a nonexistent path → non-zero exit, stderr contains that URL, `$HOME/.ai-conductor/harness` absent, and no `harness.partial.*` sibling remains; a `git` wrapper on `PATH` that creates the partial directory, writes a file, then exits 1 (simulating an interrupted clone) → same assertions; then re-run with a good URL → exit 0 and a `.git` directory at the canonical location.
3. Verify RED.
4. Implement in `docs/install.sh`: `acquire` clones into `$HOME/.ai-conductor/harness.partial.$$`, and only after a zero exit renames it to `TARGET`; a `cleanup` function registered with `trap ... EXIT INT TERM` removes that one explicitly named partial path; on clone failure `fail` names `REPO_URL`.
5. Verify GREEN, then commit: "feat(install): bootstrap stages acquisition and cleans up on failure".

**Done when:**
- `acquire` clones into `harness.partial.$$` and renames to the canonical location only after `git clone` exits 0, asserted by the unreachable-source test finding neither the canonical location nor any `harness.partial.*` sibling after a non-zero exit whose stderr contains the source URL.
- `cleanup` runs from the `EXIT INT TERM` trap and removes the partial directory, asserted by the interrupted-clone test that leaves a populated partial directory mid-clone and finds it gone afterward.
- A run after a failed run performs a fresh install, asserted by the retry test exiting 0 with a `.git` directory at the canonical location.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 3

### Task 8: A directory that is not ours is refused untouched

**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network.
2. Cases: `$HOME/.ai-conductor/config.yml` pre-exists and the harness directory does not → install succeeds and the config file's checksum is unchanged at the moment the stub installer starts (the stub records it); `$HOME/.ai-conductor/harness` is a plain directory with two files → non-zero exit naming the path, and `find … -type f -exec cksum` output is identical before and after; the directory is a git checkout whose `origin` is a different URL → non-zero exit naming the path and that origin, listing identical before and after.
3. Verify RED.
4. Implement `classify_target` in `docs/install.sh`: absent → `fresh`; has `.git` and `git -C "$TARGET" remote get-url origin` equals `REPO_URL` or the canonical `https://github.com/jstoup111/ai-conductor(.git)` / `git@github.com:jstoup111/ai-conductor(.git)` forms → `ours`; anything else → `fail` with the path (and the origin when there is one). `main` calls it after `check_prerequisites` and before `announce`/`acquire`.
5. Verify GREEN, then commit: "feat(install): bootstrap refuses a foreign target directory".

**Done when:**
- `classify_target` returns `fresh` when only the parent `.ai-conductor` directory exists, asserted by the pre-existing-config test observing a successful install and an unchanged `config.yml` checksum recorded at installer start.
- `classify_target` calls `fail` naming `$HOME/.ai-conductor/harness` for a non-git directory, asserted by the plain-directory test comparing per-file `cksum` listings before and after and finding them identical.
- `classify_target` calls `fail` naming the path and the unexpected `origin` URL for a checkout of another repository, asserted by the foreign-origin test with identical before/after listings and an unchanged HEAD.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 3

### Task 9: Re-running hands off to the existing updater

**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network.
2. Cases: run the script twice against an unchanged stand-in → second run exits 0, the stub updater's record gains one entry whose directory is the canonical location, HEAD is unchanged, the stub installer's record gains no entry, and the updater's own status line is visible in stdout; advance the stand-in's `stable` branch between runs → the second run still invokes the stub updater and performs no `git clone` (a `git` wrapper records subcommands); stub updater exits 7 with a message → the script exits 7 and the message appears.
3. Verify RED.
4. Implement in `docs/install.sh`: when `classify_target` returns `ours`, `main` skips `acquire` and calls `run_updater`, which executes `"$TARGET/bin/update"` (stdin from `/dev/tty` when it can be opened, same rule as `run_installer`, so the updater's existing confirmation prompts work under a pipe) and exits with its status. No second acquisition path exists.
5. Verify GREEN, then commit: "feat(install): bootstrap re-run delegates to the updater".

**Done when:**
- `main` routes an `ours` target to `run_updater` and never to `acquire`, asserted by the second-run test finding one new stub-updater record at the canonical location, no `clone` in the recorded git subcommands, exit 0, the updater's status line in stdout, and an unchanged HEAD.
- `run_updater` executes the checkout's own `bin/update` when the channel has advanced, asserted by the behind-channel test finding the stub-updater record and no new stub-installer record.
- `run_updater` propagates the updater's exit status and output, asserted by the failing-updater test observing exit 7 and the stub's message.
- When the canonical location holds a checkout that is already current, the one-liner reports that the installation is current, exits 0, and leaves the checkout's commit unchanged, asserted by the already-current test finding the text `installation is current` in stdout, exit 0, and the same `git rev-parse HEAD` before and after the run.
- When the existing updater fails, the checkout is left exactly as the updater left it, asserted by the failing-updater test whose stub updater writes a marker file and records the checkout's HEAD and `git status --porcelain` as its last act, and finding both values and the marker identical after the one-liner exits 7.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 8

### Task 10: Two simultaneous first runs produce one installation

**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network.
2. Case: pre-create the lock directory `$HOME/.ai-conductor/harness.lock` (simulating a run in flight), run the script → non-zero exit with a message naming the lock path and saying another install is in progress; harness directory absent; the pre-created lock still exists (a run never removes a lock it did not create). Second case: two background runs started together, `wait` for both → exactly one `.git` at the canonical location, `git -C … fsck` clean, no `harness.partial.*` or lock left behind, and at most one run exited non-zero.
3. Verify RED.
4. Implement in `docs/install.sh`: `acquire` takes the lock with `mkdir "$HOME/.ai-conductor/harness.lock"` (atomic; create the parent first with `mkdir -p`) before cloning; failure to take it calls `fail`. `cleanup` removes the lock only when a `LOCK_HELD` flag was set by this process.
5. Verify GREEN, then commit: "feat(install): bootstrap serializes concurrent first runs".

**Done when:**
- `acquire` takes `harness.lock` with an atomic `mkdir` and calls `fail` naming the lock when it already exists, asserted by the held-lock test observing a non-zero exit, an absent harness directory, and the foreign lock still present.
- `cleanup` removes the lock only when this process set `LOCK_HELD`, asserted by the two-runs test finding exactly one checkout that passes `git fsck`, no leftover lock or partial directory, and at most one non-zero exit.
- A losing concurrent run that does not exit non-zero hands off to the update path and never clones a second time, asserted by the two-runs test requiring every run that exited 0 without creating the checkout to have left exactly one stub-updater record at the canonical location and no stub-installer record, and by the lost-race test, which creates a complete checkout while the run waits on the lock, observing exit 0 with a stub-updater record.

**Files:** `docs/install.sh`; `test/test_bootstrap_installer.sh`

**Dependencies:** Task 7

### Task 11: Hand-fetched installations are left alone

**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing test in `test/test_bootstrap_installer.sh`. Test pattern (repeat of the repo's installer tests, e.g. `test/test_install_channel_selection.sh`): a standalone `bash` script with `set -euo pipefail`, a `mktemp -d` root removed by an EXIT trap, an isolated `HOME` under that root, and fakes only at external command boundaries. The harness source is a local stand-in repository created with `git init` under the temp root, carrying stub `bin/install` and `bin/update` that append their working directory, arguments, and `AI_CONDUCTOR_CHANNEL` to a record file; the script is pointed at it through the `AI_CONDUCTOR_REPO_URL` override. Never touch the real `$HOME` or the network.
2. Case: clone the stand-in to `$HOME/code/ai-conductor` (a hand-fetched checkout), record its HEAD, `git status --porcelain`, and a per-file `cksum` listing; run the script; assert all three are identical afterward and that the canonical location now holds its own separate checkout.
3. Verify RED only if the script searches for other checkouts; otherwise prove the test is live by temporarily pointing `TARGET` at the hand-fetched path and watching it fail, then revert.
4. Implement: `docs/install.sh` derives every path it writes from `$HOME/.ai-conductor/` alone and never searches for other checkouts. This feature's diff leaves `bin/install` and `bin/update` unmodified.
5. Verify GREEN, then commit: "test(install): bootstrap leaves hand-fetched checkouts untouched".

**Done when:**
- This feature's diff contains no change to `bin/install` or `bin/update`, checked with `git diff --stat <merge-base>..HEAD -- bin/install bin/update` printing nothing, so a hand-fetched checkout's installer and updater behave exactly as before.
- `docs/install.sh` writes only under `$HOME/.ai-conductor/`, asserted by the hand-fetched test finding the other checkout's HEAD, `git status --porcelain`, and per-file `cksum` listing identical before and after while the canonical location gains its own checkout.

**Files:** `test/test_bootstrap_installer.sh`; `docs/install.sh`

**Dependencies:** Task 3

### Task 12: One published script file, reachable from bin/, published verbatim

**Story:** 9
**Type:** infrastructure

**Steps:**
1. Write failing assertions in a new block of `test/test_harness_integrity.sh` (it already hosts the repo-shape checks).
2. Assertions: `docs/install.sh` is a regular file (not a symlink) whose first line is `#!/bin/sh` — so it carries no `---` site-generator front matter and is copied verbatim; `bin/bootstrap` is a symbolic link whose target text is `../docs/install.sh` and `readlink -f` of both paths is equal; `docs/_config.yml` has no `exclude:` entry matching `install.sh` or `*.sh`.
3. Verify RED (the link does not exist yet).
4. Implement: `ln -s ../docs/install.sh bin/bootstrap`, commit the link (git stores it as mode 120000), and mark `docs/install.sh` executable. The real file lives under `docs/` because the site generator's safe mode drops symlinks that leave the site source; the reverse link direction is therefore not an option.
5. Verify GREEN, then commit: "feat(install): publish bootstrap script and link it from bin/".

**Done when:**
- The integrity block asserts `docs/_config.yml` contains no `exclude` pattern matching `docs/install.sh`, so the site configuration publishes the script from the documentation tree.
- The integrity block asserts `bin/bootstrap` is a symbolic link with target `../docs/install.sh` and that both paths resolve to the same file via `readlink -f`.
- The integrity block asserts `docs/install.sh` is a regular non-symlink file whose first line is `#!/bin/sh`, and fails when a `---` front-matter line is placed at the top.
- An automated check fails when the documentation site's build would transform or drop the script, asserted by the integrity block building the site from `docs/` into a temporary directory with `jekyll build` when `jekyll` is on `PATH`, and otherwise checking only the build's static-file rule (no front matter, no `exclude` match, no `defaults` layout, no path segment starting with `_` or `.`) and recording the byte-identical comparison as a WARN that names `jekyll` as absent, never as a PASS; the block is shown failing for a front-matter line and for an `exclude` entry during RED.

**Files:** `test/test_harness_integrity.sh`; `bin/bootstrap`; `docs/install.sh`

**Dependencies:** Task 1

## Task Dependency Graph

```
1 ─┬─ 2 ── 3 ─┬─ 5 ── 6
   │          ├─ 7 ── 10
   │          ├─ 8 ── 9
   │          └─ 11
   ├─ 4
   └─ 12
```

## Integration Points

- After Task 3: the script can be fed to `sh -s` and performs a complete fresh install against the stand-in repository — Task 3 owns the cross-boundary proof.
- After Task 9: the full first-run / re-run lifecycle is exercisable.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a machine with every prerequisite, no harness at the canonical location, and no code-host credentials, when the one-liner runs, then a complete harness checkout exists at the canonical location, acquired over anonymous HTTPS, and the run exits 0. | 3 | "`acquire` clones the default `https://` `REPO_URL` (overridable only through `AI_CONDUCTOR_REPO_URL`) into `$HOME/.ai-conductor/harness`, asserted by the fresh-install test finding a `.git` directory there and exit 0 when the script is fed to `sh -s` on stdin with no credentials in the environment." | diff-local |
| Story 1 happy: Given the same machine, when the one-liner runs, then the existing installer is run from the canonical location and the resulting machine state matches what a manual install on the same channel produces. | 3 | "`run_installer` executes `bin/install` from inside `$HOME/.ai-conductor/harness` and the script exits with its status, asserted by the stub installer's record naming that directory and by the script mirroring a stub exit code." | diff-local |
| Story 1 happy: Given the same machine, when the one-liner runs, then before acquiring anything it prints the canonical location and the channel it will install. | 3 | "`announce` prints the canonical location and the channel before `acquire` runs, asserted by the fresh-install test checking both strings appear in stdout ahead of the first clone output." | diff-local |
| Story 1 negative: Given the one-liner's own download is cut off part-way through, when the shell receives the truncated text, then nothing is acquired and nothing is installed. | 4 | "`docs/install.sh` defers all work to the final `main "$@"` line, asserted by the truncation test feeding four truncated prefixes to `sh` and finding an absent harness directory and an empty record file each time." | diff-local |
| Story 2 happy: Given no channel is supplied and no terminal is attached, when the one-liner runs, then the stable channel is acquired and the existing installer records its documented stable fallback. | 5 | "`resolve_ref` maps no channel to the `stable` branch and `run_installer` forwards no channel argument, asserted by the default-channel test comparing the checkout HEAD to `stable` and finding no `--channel` in the stub installer's record." | diff-local |
| Story 2 happy: Given a channel is supplied either as an option after the shell's argument separator or through the existing channel environment variable, when the one-liner runs, then the harness is acquired at that channel's released ref (stable branch for stable, main branch for main, newest semver tag for tagged) and the existing installer records that channel. | 5 | "`resolve_ref` maps `stable`, `main`, and `tagged` to the `stable` branch, the `main` branch, and the highest `vX.Y.Z` tag respectively for both the option and `AI_CONDUCTOR_CHANNEL` forms, asserted by three tests comparing checkout HEAD to the expected ref and finding the channel in the stub installer's record." | diff-local |
| Story 2 happy: Given providers are supplied, when the one-liner runs, then the existing installer receives exactly that provider selection. | 5 | "`run_installer` forwards `--providers` verbatim, asserted by the providers test finding exactly `--providers claude,codex` in the stub installer's record." | diff-local |
| Story 2 happy: Given both an option and the environment variable name a channel, when the one-liner runs, then the option wins, matching the existing installer's precedence. | 5 | "`resolve_ref` prefers the `--channel` option over `AI_CONDUCTOR_CHANNEL`, asserted by the precedence test finding HEAD at `stable` and `--channel stable` in the record while the variable says `main`." | diff-local |
| Story 2 negative: Given the tagged channel is chosen and the repository has no semver tag reachable, when the one-liner runs, then it exits non-zero naming the missing tag and leaves the canonical location absent. | 6 | "`resolve_ref` calls `fail` naming the missing `vX.Y.Z` tag when `git ls-remote --tags` yields no semver tag, asserted by the no-tag test observing a non-zero exit and that message." | diff-local |
| Story 3 happy: Given a help option, when the one-liner runs, then usage listing the channel and provider options is printed and the run exits 0 without acquiring anything. | 1 | "`usage` prints both option names and `main` exits 0 on `--help` without reaching acquisition, asserted by the help test's empty record file and absent harness directory." | diff-local |
| Story 3 negative: Given an unrecognized option, when the one-liner runs, then it exits non-zero naming the option, and nothing is acquired or changed. | 1 | "`parse_args` in `docs/install.sh` exits non-zero and prints the offending token for an unknown option, and the unknown-option test asserts both the token in stderr and an absent `$HOME/.ai-conductor/harness`." | diff-local |
| Story 3 negative: Given a channel value other than stable, tagged, or main, when the one-liner runs, then it exits non-zero naming the bad value and the three accepted ones, and nothing is acquired or changed. | 1 | "`parse_args` rejects a channel outside `stable, tagged, main` with a message containing the bad value and all three accepted values, asserted by the invalid-channel test together with an empty stand-in record file." | diff-local |
| Story 3 negative: Given a provider value the existing installer does not accept, when the one-liner runs, then it exits non-zero naming the bad value and the accepted ones, and nothing is acquired or changed. | 1 | "`parse_args` rejects a provider outside `claude, codex` with a message containing the bad value and both accepted values, asserted by the invalid-provider test together with an empty stand-in record file." | diff-local |
| Story 4 happy: Given every documented prerequisite (git, the GitHub CLI, Node.js, npm, tmux, and python3 with PyYAML) is present, when the one-liner runs, then the prerequisite check passes silently and the install proceeds. | 2 | "`check_prerequisites` prints nothing and returns 0 when all six tools and the `yaml` import are present, asserted by the all-present test observing no prerequisite text and a continuing run." | diff-local |
| Story 4 negative: Given two prerequisites are missing, when the one-liner runs, then it exits non-zero with one message naming both, and the canonical location does not exist afterward. | 2 | "`check_prerequisites` accumulates every absent tool and calls `fail` exactly once, asserted by the two-missing test finding both `tmux` and `gh` in a single stderr message with a non-zero exit and an absent harness directory." | diff-local |
| Story 4 negative: Given python3 is present but PyYAML is not importable, when the one-liner runs, then PyYAML is named as missing and nothing is acquired. | 2 | "`check_prerequisites` probes `python3 -c 'import yaml'` and reports `PyYAML` when the import fails, asserted by the PyYAML test together with an empty stand-in record file." | diff-local |
| Story 5 happy: Given the canonical location holds a harness checkout that is already current, when the one-liner runs, then it reports that the installation is current, exits 0, and the checkout's commit is unchanged. | 9 | "`main` routes an `ours` target to `run_updater` and never to `acquire`, asserted by the second-run test finding one new stub-updater record at the canonical location, no `clone` in the recorded git subcommands, exit 0, the updater's status line in stdout, and an unchanged HEAD." | diff-local |
| Story 5 happy: Given the canonical location holds a harness checkout that is behind its channel, when the one-liner runs, then the existing updater is invoked from that checkout and no new acquisition happens. | 9 | "`run_updater` executes the checkout's own `bin/update` when the channel has advanced, asserted by the behind-channel test finding the stub-updater record and no new stub-installer record." | diff-local |
| Story 5 negative: Given the existing updater fails, when the one-liner runs, then the one-liner exits with the updater's non-zero status and its message, and the checkout is left as the updater left it. | 9 | "`run_updater` propagates the updater's exit status and output, asserted by the failing-updater test observing exit 7 and the stub's message." | diff-local |
| Story 5 negative: Given two runs of the one-liner start at the same moment on a fresh machine, when both reach acquisition, then exactly one checkout results and the losing run exits non-zero or hands off to the update path — never a corrupted or duplicated installation. | 10 | "`cleanup` removes the lock only when this process set `LOCK_HELD`, asserted by the two-runs test finding exactly one checkout that passes `git fsck`, no leftover lock or partial directory, and at most one non-zero exit." | diff-local |
| Story 6 happy: Given the canonical location does not exist but its parent already holds the harness's user configuration, when the one-liner runs, then the install proceeds and the existing configuration file is byte-for-byte unchanged by acquisition. | 8 | "`classify_target` returns `fresh` when only the parent `.ai-conductor` directory exists, asserted by the pre-existing-config test observing a successful install and an unchanged `config.yml` checksum recorded at installer start." | diff-local |
| Story 6 negative: Given the canonical location exists and is not a git checkout, when the one-liner runs, then it exits non-zero naming the location, and the directory's contents are byte-for-byte unchanged. | 8 | "`classify_target` calls `fail` naming `$HOME/.ai-conductor/harness` for a non-git directory, asserted by the plain-directory test comparing per-file `cksum` listings before and after and finding them identical." | diff-local |
| Story 6 negative: Given the canonical location is a git checkout whose origin is some other repository, when the one-liner runs, then it exits non-zero naming the location and the unexpected origin, and nothing is changed. | 8 | "`classify_target` calls `fail` naming the path and the unexpected `origin` URL for a checkout of another repository, asserted by the foreign-origin test with identical before/after listings and an unchanged HEAD." | diff-local |
| Story 7 happy: Given a previous run failed during acquisition, when the one-liner runs again with the network restored, then it performs a fresh install and exits 0. | 7 | "A run after a failed run performs a fresh install, asserted by the retry test exiting 0 with a `.git` directory at the canonical location." | diff-local |
| Story 7 negative: Given the repository cannot be reached, when the one-liner runs, then it exits non-zero with a message naming the address it could not reach, and the canonical location does not exist afterward. | 7 | "`acquire` clones into `harness.partial.$$` and renames to the canonical location only after `git clone` exits 0, asserted by the unreachable-source test finding neither the canonical location nor any `harness.partial.*` sibling after a non-zero exit whose stderr contains the source URL." | diff-local |
| Story 7 negative: Given acquisition is interrupted part-way, when the run ends, then no directory remains at the canonical location that a later run would treat as an installation. | 7 | "`cleanup` runs from the `EXIT INT TERM` trap and removes the partial directory, asserted by the interrupted-clone test that leaves a populated partial directory mid-clone and finds it gone afterward." | diff-local |
| Story 8 happy: Given a hand-fetched checkout at some other location and no use of the one-liner, when its existing installer and updater are run, then they behave exactly as before this feature. | 11 | "This feature's diff contains no change to `bin/install` or `bin/update`, checked with `git diff --stat <merge-base>..HEAD -- bin/install bin/update` printing nothing, so a hand-fetched checkout's installer and updater behave exactly as before." | diff-local |
| Story 8 negative: Given a hand-fetched checkout at some other location, when the one-liner runs, then that checkout's files and git state are byte-for-byte unchanged, and the one-liner installs to the canonical location only. | 11 | "`docs/install.sh` writes only under `$HOME/.ai-conductor/`, asserted by the hand-fetched test finding the other checkout's HEAD, `git status --porcelain`, and per-file `cksum` listing identical before and after while the canonical location gains its own checkout." | diff-local |
| Story 9 happy: Given the documentation site publishes its documentation tree from the released branch, when the site configuration is inspected, then the install script sits inside that tree and is not excluded from publication. | 12 | "The integrity block asserts `docs/_config.yml` contains no `exclude` pattern matching `docs/install.sh`, so the site configuration publishes the script from the documentation tree." | diff-local |
| Story 9 happy: Given the script is also reachable inside a checkout at a second, conventional path, when the two paths are compared, then they resolve to the same single file, so they can never drift. | 12 | "The integrity block asserts `bin/bootstrap` is a symbolic link with target `../docs/install.sh` and that both paths resolve to the same file via `readlink -f`." | diff-local |
| Story 9 negative: Given the documentation site's build would transform or drop the script, when the site is built, then an automated check fails — the script must be published verbatim as a plain file. | 12 | "The integrity block asserts `docs/install.sh` is a regular non-symlink file whose first line is `#!/bin/sh`, and fails when a `---` front-matter line is placed at the top." | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of falsifiable checks naming its mechanism
- [x] Dependencies are explicit and acyclic
- [x] No terminal catch-all validation task
