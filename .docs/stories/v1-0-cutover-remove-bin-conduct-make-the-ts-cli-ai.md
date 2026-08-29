**Status:** Accepted

# Stories: v1.0 cutover — remove bin/conduct, make the TS CLI the only CLI

**Source:** jstoup111/ai-conductor#226 (technical track — criteria derived from the technical
intent + adr-2026-08-26-music-vocabulary-player-composer-rename as amended 2026-08-29)

## Story 1: The conduct command resolves to the TS CLI

As an operator, I want `conduct` to invoke the canonical TS launcher so that one implementation
serves every entrypoint name.

### Acceptance Criteria

#### Happy Path
- Given a completed `bin/install` run, when the operator runs `readlink -f ~/.local/bin/conduct`, then it resolves to the harness checkout's `bin/ai-conductor`
- Given the swapped symlink, when the operator runs `conduct --help`, then the TS CLI's help output is printed and the exit code is 0
- Given the swapped symlink, when the operator invokes `conduct`, then a one-line deprecation warning naming `ai-conductor` is printed once, matching the existing `conduct-ts` invoked-name warning pattern
- Given a box whose `~/.local/bin/conduct` still points at the removed bash script, when `bin/install` runs, then the symlink is replaced to point at `bin/ai-conductor` and the installer reports the update

#### Negative Paths
- Given a `~/.local/bin/conduct` symlink already pointing at `bin/ai-conductor`, when `bin/install` runs again, then the installer reports it current and does not rewrite the link (idempotent)
- Given `~/.local/bin/conduct` is a foreign non-symlink file, when `bin/install` runs, then the installer warns and preserves the foreign entry instead of clobbering it
- Given the TS dist bundle is absent and the build fails, when `bin/install` runs, then the install exits non-zero naming the build failure and no entrypoint is left pointing at a nonexistent target
- Given the uninstall path runs, when it completes, then `~/.local/bin/conduct` created by the installer is removed along with `ai-conductor` and `conduct-ts`

### Done When
- [ ] `bin/install` contains no symlink step targeting `bin/conduct`; the `conduct` target is `bin/ai-conductor`
- [ ] `bin/ai-conductor` prints its deprecation warning when `basename "$0"` is `conduct`
- [ ] A launcher test (test_ai_conductor_launcher.sh or successor) asserts the `conduct` alias warning and resolution behavior and passes

## Story 2: The surviving CLI serves the retained operator surface

As an operator, I want every still-relevant operation of the removed bash CLI to work through the
TS CLI so that the removal loses no needed capability.

### Acceptance Criteria

#### Happy Path
- Given a harness project, when the operator runs `conduct --status`, then the TS dashboard/status output renders and exits 0
- Given a project with TS engine state, when the operator runs `conduct --reset` or `conduct --cleanup`, then the TS implementations execute against the engine's own state files
- Given the standalone update CLI, when the operator runs `bin/update --set-channel stable` followed by an update check, then channel selection and update flow work with no bash-conduct involvement
- Given a project directory without a canonical memory store, when a TS pipeline run starts (inline or daemon dispatch), then the canonical memory-store setup (`memory setup` semantics, adr-2026-06-29-shared-memory-store-placement-and-durability) runs idempotently before any session touches `.memory/`

#### Negative Paths
- Given the cutover is complete, when the operator invokes `conduct --auto`, then the CLI exits non-zero before any pipeline step with the existing guided rejection naming `daemon start` and the daemon guide (per the shipped remove-the-unattended-one-shot-inline-run spec; the flag runs nothing)
- Given the cutover is complete, when the operator invokes `conduct --step plan`, `conduct --log`, or `conduct --output`, then the CLI exits non-zero with an unknown-option error rather than silently starting a pipeline run
- Given a bare single-word argument (e.g. `conduct deploy`), when the CLI parses it, then it exits non-zero identifying the unknown command instead of launching the SDLC loop

### Done When
- [ ] A CLI test asserts `--auto`'s guided non-zero rejection and unknown-option failures for `--step`, `--log`, `--output`
- [ ] Existing TS tests for `--status`, `--reset`, `--cleanup`, and unknown-argument guarding pass unchanged or extended
- [ ] `bin/update` channel flow tests (test_bin_update.sh) pass with no bin/conduct present
- [ ] A test proves the TS run path invokes the idempotent memory-store setup (setup performed when absent, no-op when present, non-zero setup never aborts the run)

## Story 3: The validation suite passes without the legacy CLI

As a maintainer, I want the harness integrity and shell suites green after the removal so that CI
protects the cutover.

### Acceptance Criteria

#### Happy Path
- Given the removal diff, when `test/test_harness_integrity.sh` runs, then it passes with no assertion referencing the bash CLI's tagged-update decision block
- Given the removal diff, when `test/lint_shell.sh` and `bash -n` sweeps run over `bin/` and `test/`, then they pass with the deleted scripts absent from the scanned set

#### Negative Paths
- Given `bin/update` loses its tagged-update decision block in some future edit, when the integrity suite runs, then the retained single-sided assertion on `bin/update` still fails loudly (removing the parity check must not remove update-flow coverage)
- Given `bin/lib/harness-common.sh` after its header rewrite, when a script sources it under `set -euo pipefail`, then all exported helpers behave identically (comment-only change; shellcheck passes)

### Done When
- [ ] `test_harness_integrity.sh` carries no `bin/conduct` path expectations and passes end-to-end
- [ ] `test/test_conduct_worktree.sh` and `test/test_conduct_arg_guard.sh` are deleted and no suite or CI workflow references them
- [ ] `bin/update`'s tagged-update behavior retains a direct assertion in the integrity suite

## Story 4: The legacy-reference guard polices the removed CLI

As a maintainer, I want reintroduced references to the removed bash CLI to fail CI so that the
deletion stays dead.

### Acceptance Criteria

#### Happy Path
- Given the swept tree, when `test/test_no_legacy_cli_references.sh` runs, then it passes with `bin/conduct` added to its policed patterns over its scanned set
- Given the guard's allowlist, when the scan encounters the documented alias/deprecation-window mentions (and the canonical breaking-surface contract strings excluded from this cutover's scope), then those exact entries pass while any other mention fails

#### Negative Paths
- Given a new `bin/conduct` invocation added to a scanned path (e.g. a skill or hook), when the guard runs, then it exits non-zero naming the file and line
- Given both `rg` and `grep` are unavailable, when the guard runs, then it exits non-zero reporting the missing scanner rather than passing vacuously
- Given the guard's backend fallback, when it runs under plain `grep` (no `rg`), then the `bin/conduct` policing produces the same verdict as under `rg` (test_legacy_cli_guard_backends.sh extended)

### Done When
- [ ] `test_no_legacy_cli_references.sh` fails on a planted `bin/conduct` reference in its scanned set and passes on the swept tree
- [ ] `test_legacy_cli_guard_backends.sh` covers the new pattern under both scanner backends
- [ ] Forward-facing docs/skills in the guard's scanned set carry no live `bin/conduct` instructions (mechanically proven by the guard passing)
