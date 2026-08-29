# Coherence: v1.0 cutover — remove bin/conduct, make the TS CLI the only CLI (#226)

**Date:** 2026-08-29
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD).
**Outcome source:** derived Desired-outcome bullets staged from jstoup111/ai-conductor#226's
Scope section (the issue predates the intake template).

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-3 | covered | "The TS CLI is the only CLI." Story 1 swaps the entrypoint onto the TS launcher; Story 3 asserts the suites pass with the bash implementation gone. |
| outcome | outcome-2 | story-1 | covered | "install cannot succeed without a working TS engine." Story 1's build-failure negative pins the non-zero exit with no dangling entrypoint. |
| outcome | outcome-3 | story-3, story-2 | covered | "dedicated test scripts are removed with their still-relevant coverage preserved." Story 3 deletes them; Story 2 pins the surviving CLI surface TS-side. |
| outcome | outcome-4 | story-1 | covered | "re-running the installer" converges existing installs — Story 1's idempotent/stale-link/foreign-entry criteria. |
| outcome | outcome-5 | story-4 | covered | "references reflect the single-CLI reality" — Story 4's guard mechanically proves the swept scanned set and polices regressions. |
| adr | adr-2026-08-26-music-vocabulary-player-composer-rename | story-1 | covered | The 2026-08-29 amendment adds the `conduct` alias as the fourth compatibility seam; Story 1 implements exactly that seam (symlink onto the single launcher, invoked-name warning). |
| story | story-1 | task-1, task-2, task-3 | covered | Launcher warning, installer swap, uninstall completion. |
| story | story-2 | task-4, task-5, task-8, task-9 | covered | Memory-store port, rejection-surface pins, suites green post-deletion, bin/update flow unchanged. |
| story | story-3 | task-6, task-7, task-8, task-9 | covered | Integrity rework, dedicated-test deletion, bash CLI deletion, surviving-script cleanup. |
| story | story-4 | task-10, task-11 | covered | Guard extension and backend parity. |
| task | task-1 | story-1 | covered | Invoked-name warning for the conduct alias. |
| task | task-2 | story-1 | covered | Installer symlink swap with idempotent/stale/foreign/build-failure cases. |
| task | task-3 | story-1 | covered | Uninstall removes all installer-owned entrypoint links. |
| task | task-4 | story-2 | covered | TS run prelude invokes the idempotent memory-store setup. |
| task | task-5 | story-2 | covered | Verify-only pins of the guided --auto rejection, unknown options, bare-word guard. |
| task | task-6 | story-3 | covered | Single-sided bin/update tagged-update assertions replace the parity check. |
| task | task-7 | story-3 | covered | Deletes the two bash-dedicated test scripts and their runner references. |
| task | task-8 | story-3 | covered | Deletes the bash CLI with all suites green. |
| task | task-9 | story-3 | covered | Comment-only cleanup of surviving shell scripts. |
| task | task-10 | story-4 | covered | Guard pattern + allowlist + reference sweep to green. |
| task | task-11 | story-4 | covered | Backend parity for the new pattern. |
| criterion | Story 1 happy: Given a completed `bin/install` run, when the operator runs `readlink -f ~/.local/bin/conduct`, then it resolves to the harness checkout's `bin/ai-conductor` | task-2 | covered | "resolves to `bin/ai-conductor`" | diff-local |
| criterion | Story 1 happy: Given the swapped symlink, when the operator runs `conduct --help`, then the TS CLI's help output is printed and the exit code is 0 | task-8 | covered | "`conduct --help` through the swapped symlink exits 0" | diff-local |
| criterion | Story 1 happy: Given the swapped symlink, when the operator invokes `conduct`, then a one-line deprecation warning naming `ai-conductor` is printed once, matching the existing `conduct-ts` invoked-name warning pattern | task-1 | covered | "a one-line deprecation warning naming `ai-conductor` on stderr" | diff-local |
| criterion | Story 1 happy: Given a box whose `~/.local/bin/conduct` still points at the removed bash script, when `bin/install` runs, then the symlink is replaced to point at `bin/ai-conductor` and the installer reports the update | task-2 | covered | "a stale link pointing at the bash script is replaced with an update message" | diff-local |
| criterion | Story 1 negative: Given a `~/.local/bin/conduct` symlink already pointing at `bin/ai-conductor`, when `bin/install` runs again, then the installer reports it current and does not rewrite the link (idempotent) | task-2 | covered | "a link already pointing there is reported current and not rewritten" | diff-local |
| criterion | Story 1 negative: Given `~/.local/bin/conduct` is a foreign non-symlink file, when `bin/install` runs, then the installer warns and preserves the foreign entry instead of clobbering it | task-2 | covered | "foreign non-symlink entry is warned about and preserved" | diff-local |
| criterion | Story 1 negative: Given the TS dist bundle is absent and the build fails, when `bin/install` runs, then the install exits non-zero naming the build failure and no entrypoint is left pointing at a nonexistent target | task-2 | covered | "a failed build still exits non-zero via the existing CONDUCT_TS_FAILURE tail" | diff-local |
| criterion | Story 1 negative: Given the uninstall path runs, when it completes, then `~/.local/bin/conduct` created by the installer is removed along with `ai-conductor` and `conduct-ts` | task-3 | covered | "three installer-owned links removed, foreign entry preserved" | diff-local |
| criterion | Story 2 happy: Given a harness project, when the operator runs `conduct --status`, then the TS dashboard/status output renders and exits 0 | task-8 | covered | "the TS test suite pass with the file absent" | diff-local |
| criterion | Story 2 happy: Given a project with TS engine state, when the operator runs `conduct --reset` or `conduct --cleanup`, then the TS implementations execute against the engine's own state files | task-8 | covered | "the TS test suite pass with the file absent" | diff-local |
| criterion | Story 2 happy: Given the standalone update CLI, when the operator runs `bin/update --set-channel stable` followed by an update check, then channel selection and update flow work with no bash-conduct involvement | task-9 | covered | "`test/test_bin_update.sh` and `test/test_post_commit_derive_feedback.sh` pass unchanged" | diff-local |
| criterion | Story 2 happy: Given a project directory without a canonical memory store, when a TS pipeline run starts (inline or daemon dispatch), then the canonical memory-store setup (`memory setup` semantics, adr-2026-06-29-shared-memory-store-placement-and-durability) runs idempotently before any session touches `.memory/` | task-4 | covered | "setup performed when the canonical store is absent, no-op when present" | diff-local |
| criterion | Story 2 negative: Given the cutover is complete, when the operator invokes `conduct --auto`, then the CLI exits non-zero before any pipeline step with the existing guided rejection naming `daemon start` and the daemon guide (per the shipped remove-the-unattended-one-shot-inline-run spec; the flag runs nothing) | task-5 | covered | "exits non-zero before any pipeline step with the shipped guided rejection" | diff-local |
| criterion | Story 2 negative: Given the cutover is complete, when the operator invokes `conduct --step plan`, `conduct --log`, or `conduct --output`, then the CLI exits non-zero with an unknown-option error rather than silently starting a pipeline run | task-5 | covered | "each exit non-zero as unknown options" | diff-local |
| criterion | Story 2 negative: Given a bare single-word argument (e.g. `conduct deploy`), when the CLI parses it, then it exits non-zero identifying the unknown command instead of launching the SDLC loop | task-5 | covered | "exits non-zero identifying the unknown command" | diff-local |
| criterion | Story 3 happy: Given the removal diff, when `test/test_harness_integrity.sh` runs, then it passes with no assertion referencing the bash CLI's tagged-update decision block | task-6 | covered | "single-sided assertion that `bin/update` still contains the complete tagged-update decision block" | diff-local |
| criterion | Story 3 happy: Given the removal diff, when `test/lint_shell.sh` and `bash -n` sweeps run over `bin/` and `test/`, then they pass with the deleted scripts absent from the scanned set | task-7 | covered | "`test/lint_shell.sh` passes on the reduced set" | diff-local |
| criterion | Story 3 negative: Given `bin/update` loses its tagged-update decision block in some future edit, when the integrity suite runs, then the retained single-sided assertion on `bin/update` still fails loudly (removing the parity check must not remove update-flow coverage) | task-6 | covered | "retain a direct failing-capable assertion" | diff-local |
| criterion | Story 3 negative: Given `bin/lib/harness-common.sh` after its header rewrite, when a script sources it under `set -euo pipefail`, then all exported helpers behave identically (comment-only change; shellcheck passes) | task-9 | covered | "diffs touch comments/prose only" | diff-local |
| criterion | Story 4 happy: Given the swept tree, when `test/test_no_legacy_cli_references.sh` runs, then it passes with `bin/conduct` added to its policed patterns over its scanned set | task-10 | covered | "exits 0 on the swept tree" | diff-local |
| criterion | Story 4 happy: Given the guard's allowlist, when the scan encounters the documented alias/deprecation-window mentions (and the canonical breaking-surface contract strings excluded from this cutover's scope), then those exact entries pass while any other mention fails | task-10 | covered | "The allowlist is a closed enumeration" | diff-local |
| criterion | Story 4 negative: Given a new `bin/conduct` invocation added to a scanned path (e.g. a skill or hook), when the guard runs, then it exits non-zero naming the file and line | task-10 | covered | "exits non-zero naming file and line on a planted reference" | diff-local |
| criterion | Story 4 negative: Given both `rg` and `grep` are unavailable, when the guard runs, then it exits non-zero reporting the missing scanner rather than passing vacuously | task-10 | covered | "fails loudly when neither scanner backend exists" | diff-local |
| criterion | Story 4 negative: Given the guard's backend fallback, when it runs under plain `grep` (no `rg`), then the `bin/conduct` policing produces the same verdict as under `rg` (test_legacy_cli_guard_backends.sh extended) | task-11 | covered | "the same non-zero verdict under both backends" | diff-local |
