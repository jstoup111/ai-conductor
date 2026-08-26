# Implementation Plan: Explicit update-channel selection on a first-run install (#1711)

**Date:** 2026-08-18
**Stem:** first-run-install-silently-defaults-the-update-cha
**Track:** technical (no PRD)
**Tier:** S
**Stories:** `.docs/stories/first-run-install-silently-defaults-the-update-cha.md`
**Complexity:** `.docs/complexity/first-run-install-silently-defaults-the-update-cha.md`
**Conflict check:** N/A — skipped at Tier S (per `/engineer` tier rules)
**Architecture review:** N/A — skipped at Tier S (per `/engineer` tier rules)

## Summary

Give `bin/install` two explicit ways to supply the harness update channel on a first run — a
`--channel <stable|tagged|main>` flag and an `AI_CONDUCTOR_CHANNEL` environment variable — resolved
in the order **flag > env > interactive prompt > `stable` fallback**, with the resolved channel and
its source confirmed in the install output. An invalid value from either explicit source is rejected
by name before any global state is written. An already-configured channel is never re-prompted and
never overwritten.

Bash-only change to one installer function plus the existing pre-dispatch option loop, one new
acceptance test, three doc pages, and a release waiver. 10 tasks.

## Technical Approach

**Where the defect lives.** `configure_conductor` (`bin/install:920-...`) runs its first-run arm only
when `~/.ai-conductor/config.yml` is absent. That arm seeds `channel="stable"` unconditionally and
guards the prompt with `[ "$UPDATE_MODE" != true ] && [ -t 0 ]` (`bin/install:934-948`). Without a
TTY the guard is false, the prompt never runs, and `stable` is written with no caller input possible.

**The pattern to copy.** `--providers` already solves the same shape in this file: it is stripped
from `"$@"` inside the pre-dispatch `_filtered_args` loop (`bin/install:1483-1509`), supports both
`--providers X` and `--providers=X` spellings, and is then validated against a closed set *before*
the mode dispatch (`bin/install:1511-1529`), failing with a named error. `--channel` gets the exact
same treatment, so validation happens before `install()` writes anything.

**Precedence, resolved once.** Introduce a single module-level `CHANNEL_SELECTION` (mirroring
`PROVIDER_SELECTION`) plus a `CHANNEL_SOURCE` recording which input won. The env var is read in the
same pre-dispatch block so an invalid `AI_CONDUCTOR_CHANNEL` is rejected on the same code path as an
invalid flag. An empty/whitespace `AI_CONDUCTOR_CHANNEL` is treated as unset, matching how
`AI_CONDUCTOR_ENGINEER_DIR` and `AI_CONDUCTOR_ENGINE_STORE` treat empty values
(`docs/reference/environment.md:23-24`) — an unset variable is not an error, so an exported-but-empty
one must not be either.

`configure_conductor`'s first-run arm then becomes: if `CHANNEL_SELECTION` is non-empty use it
(source = flag or env, no prompt); else if the prompt is possible, prompt (source = prompt, bare
Enter still means `stable`); else use `stable` (source = fallback).

**Configured channels are untouched.** The `else` branch of `configure_conductor` (the
already-configured path) is not modified at all. Because `CHANNEL_SELECTION` is consulted only inside
the first-run arm, a supplied `--channel` on a configured machine is inert by construction — the plan
adds only an advisory line so the caller is told the flag was ignored rather than silently dropped.
Changing a configured channel remains `bin/update --set-channel`'s job (ADR
`adr-2026-07-05-standalone-bin-update.md`, APPROVED).

**Config-ownership constraint.** All writes stay on `conductor_cfg_set updateChannel`.
`test/check_update_flow_config_ownership.sh` scans every `bin/` script and fails the build if the
update flow reaches around `bin/lib/harness-common.sh` to touch configuration directly, so no task may
introduce a direct read or write of `~/.ai-conductor/config.yml`.

**Release-gate constraint (do not skip).** `classifyBreakingSurfaces` in
`src/conductor/src/engine/self-host/release-gate.ts:132` maps *any* touched `bin/install` path to the
canonical surface `skill symlink targets`. This change is purely additive and alters no symlink
target, so per CLAUDE.md §Release & Update Gates the correct artifact is a **waiver**, not an invented
migration block. Task 9 commits it in the same diff; omitting it HALTs the build at the release gate.

**Test approach.** `test/test_install_provider_readiness.sh` establishes the acceptance harness this
needs: a disposable checkout (`bin/`, `skills/`, `hooks/`, `HARNESS.md`, `VERSION` copied to a
tempdir), a `FAKE_HOME`, PATH stubs for `rtk`/`npm`/`node`/`claude`/`codex`/`uv`, a real `python3`
symlink, and pty-driven prompt assertions. The new `test/test_install_channel_selection.sh` adapts it.
No real operator state is touched by any test.

## Files

- `bin/install` — new `CHANNEL_SELECTION`/`CHANNEL_SOURCE` globals, `--channel` parsing + validation
  in the pre-dispatch loop, env read, first-run resolution in `configure_conductor`, help text.
- `test/test_install_channel_selection.sh` — new acceptance test (adapted from the provider one).
- `docs/reference/cli.md` — document the `--channel` flag on `bin/install`.
- `docs/reference/environment.md` — add the `AI_CONDUCTOR_CHANNEL` row (alphabetical placement).
- `docs/quickstart.md` — note how to choose a channel at install time alongside the existing
  `bin/update --set-channel` guidance (lines 294-301).
- `.docs/release-waivers/first-run-install-silently-defaults-the-update-cha.md` — new waiver.

## Non-goals

- Failing the install when no channel is supplied. The issue asked for this; the operator explicitly
  overrode it during `/explore` — `stable` remains the fallback and the install always exits zero on
  that path. See `.docs/track/first-run-install-silently-defaults-the-update-cha.md`.
- The markdown-viewer, mermaid-renderer, and provider first-run prompts, which skip under the same
  non-TTY condition. Untouched.
- Any `curl | sh` installer work.
- `bin/update --set-channel`, the update-mode refresh path, and existing `updateChannel` readers
  (`bin/update:322`, `bin/conduct:319`).
- `CHANGELOG.md` and `VERSION` — implementation branches never write either (CLAUDE.md §Release &
  Update Gates); the disposition is declared in the PR body instead (see Task 10).

## Tasks

### Task 1: RED — acceptance harness + `--channel` flag on a non-interactive first run
**Story:** Story 1, happy path
**Type:** happy-path

**Steps:**
1. Create `test/test_install_channel_selection.sh` by adapting the harness from
   `test/test_install_provider_readiness.sh` (disposable checkout, `FAKE_HOME`, PATH stubs, real
   `python3` symlink, `trap` cleanup).
2. Write failing assertions: with `FAKE_HOME` empty (no `~/.ai-conductor/config.yml`) and stdin not a
   TTY, run `bin/install --channel main`; assert the install exits zero and the written config
   records `updateChannel` as `main`. Repeat for `--channel=main`, `--channel stable`,
   `--channel tagged`.
3. Verify the test fails (RED — `--channel` is currently an unrecognized argument that falls through
   to the mode dispatch, and `stable` is written regardless).
4. Implement: nothing yet.
5. Commit: "test(install): RED for explicit --channel selection on a first-run install"

**Files likely touched:**
- `test/test_install_channel_selection.sh` — new file

**Dependencies:** none

### Task 2: GREEN — parse and validate `--channel` in the pre-dispatch option loop
**Story:** Story 1, happy path; Story 3, happy path
**Type:** implementation

**Steps:**
1. Add `CHANNEL_SELECTION=""` and `CHANNEL_SOURCE=""` globals near `PROVIDER_SELECTION`
   (`bin/install:33-36`) with a comment explaining they carry a *first-run* choice only.
2. Add `--channel` and `--channel=*` arms to the `_filtered_args` loop (`bin/install:1483-1509`),
   mirroring the `--providers` arms exactly, including the empty-value `fail` + `exit 1`.
3. After the loop, alongside the provider validation block (`bin/install:1511-1529`), validate
   `CHANNEL_SELECTION` against the closed set `stable|tagged|main`; on a miss, `fail` naming the
   rejected value and listing the supported channels, then `exit 1`. Set `CHANNEL_SOURCE="flag"` when
   a value was supplied.
4. Verify Task 1's assertions pass (GREEN) once Task 4 wires the resolution; until then assert only
   that the flag parses and validates without reaching the mode dispatch.
5. Commit: "feat(install): accept and validate an explicit --channel selection"

**Files likely touched:**
- `bin/install` — globals, option loop, validation block

**Dependencies:** Task 1

### Task 3: RED then GREEN — `AI_CONDUCTOR_CHANNEL` environment fallback
**Story:** Story 2, happy path; Story 2, negative path 2
**Type:** implementation

**Steps:**
1. Write failing tests: (a) no flag, `AI_CONDUCTOR_CHANNEL=tagged`, no TTY → config records
   `tagged`; (b) no flag, `AI_CONDUCTOR_CHANNEL=` (empty), no TTY → install succeeds and records the
   `stable` fallback, with no error about an invalid channel.
2. Verify tests fail (RED — the variable is not read anywhere).
3. Implement: in the same pre-dispatch block, when `CHANNEL_SELECTION` is empty, read
   `AI_CONDUCTOR_CHANNEL`; treat an empty/whitespace-only value as unset; otherwise assign it and set
   `CHANNEL_SOURCE="env"`. The existing closed-set validation then covers it unchanged.
4. Verify tests pass (GREEN).
5. Commit: "feat(install): read AI_CONDUCTOR_CHANNEL as the channel fallback"

**Files likely touched:**
- `bin/install` — env read inside the pre-dispatch block
- `test/test_install_channel_selection.sh` — env-fallback cases

**Dependencies:** Task 2

### Task 4: GREEN — resolve the channel in `configure_conductor`'s first-run arm
**Story:** Story 1, negative path 1; Story 2, negative path 1
**Type:** implementation

**Steps:**
1. Write failing tests: with a pty so `[ -t 0 ]` is true, run `bin/install --channel tagged` and
   separately `AI_CONDUCTOR_CHANNEL=main bin/install`; assert the channel prompt text
   ("Harness update channel") does **not** appear in the output and the recorded channels are
   `tagged` and `main` respectively.
2. Verify tests fail (RED — the prompt still fires and the flag is ignored by `configure_conductor`).
3. Implement: in the first-run arm (`bin/install:934-948`), branch before the prompt — if
   `CHANNEL_SELECTION` is non-empty, use it and skip the prompt entirely; else keep the existing
   `[ "$UPDATE_MODE" != true ] && [ -t 0 ]` prompt (bare Enter still selects `stable`) and set
   `CHANNEL_SOURCE="prompt"`; else set `channel="stable"` and `CHANNEL_SOURCE="fallback"`.
4. Verify tests pass (GREEN), and that Task 1's non-interactive assertions now pass end-to-end.
5. Commit: "feat(install): resolve the first-run channel by flag, env, prompt, then fallback"

**Files likely touched:**
- `bin/install` — `configure_conductor` first-run arm
- `test/test_install_channel_selection.sh` — prompt-suppression cases

**Dependencies:** Task 3

### Task 5: Negative — an unsupported channel is rejected before any global state is written
**Story:** Story 3, happy path; Story 3, negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) `bin/install --channel bogus` exits non-zero, the message names `bogus`
   and lists `stable`, `tagged`, `main`, and `FAKE_HOME` still contains no `~/.ai-conductor/config.yml`
   and no `~/.claude/skills` symlinks; (b) `bin/install --channel` with no value exits non-zero naming
   the missing argument; (c) `--channel=` (empty) likewise; (d) `AI_CONDUCTOR_CHANNEL=bogus bin/install`
   exits non-zero, names the value, and writes nothing.
2. Verify the tests fail for any case Task 2/3 did not already cover.
3. Implement: adjust the validation message so it names the source (flag vs `AI_CONDUCTOR_CHANNEL`),
   satisfying Story 3's "names the rejected value and its source".
4. Verify tests pass — in particular assert the *no side effects* half by snapshotting `FAKE_HOME`
   before and after.
5. Commit: "feat(install): reject an unsupported channel before any global write"

**Files likely touched:**
- `bin/install` — validation message
- `test/test_install_channel_selection.sh` — rejection cases

**Dependencies:** Task 4

### Task 6: Negative — a configured channel is never re-prompted or overwritten
**Story:** Story 4, happy path; Story 4, negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests: seed `FAKE_HOME` with a config recording `updateChannel: main`, then
   (a) run `bin/install` under a pty with no flag → no prompt shown, channel still `main`;
   (b) run `bin/install --channel stable` → channel still `main` **and** the output states the
   supplied channel was ignored because one is already configured;
   (c) run `bin/install --update` → no prompt, channel unchanged.
2. Verify (b) fails (RED — today the flag would be silently inert with no message); (a) and (c) should
   already pass and serve as regression guards.
3. Implement: in `configure_conductor`'s already-configured `else` branch, when `CHANNEL_SELECTION` is
   non-empty emit an advisory line naming the configured channel, the ignored value, and
   `bin/update --set-channel` as the way to change it. Do not write `updateChannel`.
4. Verify tests pass (GREEN).
5. Commit: "feat(install): report an ignored --channel on an already-configured machine"

**Files likely touched:**
- `bin/install` — `configure_conductor` already-configured branch
- `test/test_install_channel_selection.sh` — configured-machine cases

**Dependencies:** Task 5

### Task 7: The resolved channel and its source are confirmed in the output
**Story:** Story 5, happy path; Story 5, negative paths
**Type:** happy-path

**Steps:**
1. Write failing tests: assert the first-run confirmation names both the channel and the source for
   each of the four sources (flag, env, prompt, fallback); assert the fallback message additionally
   names how to choose explicitly (`--channel`, `AI_CONDUCTOR_CHANNEL`, `bin/update --set-channel`)
   and that the install still exits zero; assert that when `conductor_cfg_set` fails no confirmation
   claiming a recorded channel is printed.
2. Verify tests fail (RED — the existing `ok "Created conductor configuration (channel: …)"` line
   names the channel but never the source, and there is no fallback guidance).
3. Implement: extend the existing `ok` line to include the source, and add the fallback-specific
   guidance line. Leave the existing `warn` failure path and its `return 1` untouched so no false
   success can print.
4. Verify tests pass (GREEN).
5. Commit: "feat(install): confirm the resolved channel and the source that chose it"

**Files likely touched:**
- `bin/install` — confirmation output in `configure_conductor`
- `test/test_install_channel_selection.sh` — confirmation cases

**Dependencies:** Task 6

### Task 8: Help text
**Story:** Story 1, happy path (discoverability of the supplied choice)
**Type:** implementation

**Steps:**
1. Write a failing assertion in the acceptance test: `bin/install --help` and `bin/install -h` are
   identical and both mention `--channel` and the supported channel names (mirroring the existing
   provider-help assertion).
2. Verify it fails (RED).
3. Implement: add `--channel` to the usage line and the option list in the `-h|--help` arm
   (`bin/install:1539-1550`), and mention `AI_CONDUCTOR_CHANNEL` as the environment equivalent.
4. Verify it passes (GREEN).
5. Commit: "docs(install): document --channel in the installer help"

**Files likely touched:**
- `bin/install` — help arm
- `test/test_install_channel_selection.sh` — help assertion

**Dependencies:** Task 7

### Task 9: Docs + release waiver
**Story:** repo convention (Documentation Upkeep, CLAUDE.md) and repo release gate (CLAUDE.md §Release & Update Gates)
**Type:** documentation

**Steps:**
1. `docs/reference/cli.md` — document `bin/install --channel <stable|tagged|main>`, its precedence
   over `AI_CONDUCTOR_CHANNEL`, that it applies to a first run only, and that changing a configured
   channel is `bin/update --set-channel`.
2. `docs/reference/environment.md` — add the `AI_CONDUCTOR_CHANNEL` row in alphabetical position
   (after `AI_CONDUCTOR_REGISTRY`), matching the existing column contract: value shape, default,
   consumer, effect, failure behavior (invalid value exits non-zero before installing; empty is
   treated as unset).
3. `docs/quickstart.md` — extend the channel paragraph (lines 294-301) with how to choose at install
   time, keeping the existing `bin/update --set-channel` guidance intact.
4. Create `.docs/release-waivers/first-run-install-silently-defaults-the-update-cha.md` with exactly
   `Waives: skill symlink targets` and a non-empty `Rationale:` explaining that the classifier flags
   the surface because `bin/install` was touched, while the edit only adds an option and changes no
   symlink target. The name must match `CANONICAL_BREAKING_SURFACES` verbatim.
5. Commit: "docs: document the install channel flag, env var, and release waiver"

**Files likely touched:**
- `docs/reference/cli.md`, `docs/reference/environment.md`, `docs/quickstart.md`
- `.docs/release-waivers/first-run-install-silently-defaults-the-update-cha.md`

**Dependencies:** Task 8

### Task 10: Full validation suite
**Story:** repo validation rules (CLAUDE.md §Validation Rules)
**Type:** verification

**Steps:**
1. Run `bash -n bin/install test/test_install_channel_selection.sh` and
   `shellcheck --severity=error` on both via `test/lint_shell.sh`.
2. Run `bash test/test_install_channel_selection.sh` and
   `bash test/test_install_provider_readiness.sh` (the adapted-from test must not regress).
3. Run `bash test/check_update_flow_config_ownership.sh` — proves no direct config access was
   introduced.
4. Run `bash test/test_harness_integrity.sh` (full suite) and fix any failure before committing.
5. Commit any fixes: "chore: satisfy harness validation for the install channel selection"

**Note on release metadata:** the PR body declares
`Release-Disposition: note`, `Release-Category: Added`, `Release-Semver: minor`, and a
`Release-Note` naming the `--channel` flag and `AI_CONDUCTOR_CHANNEL`. `CHANGELOG.md` and `VERSION`
are **not** edited on this branch.

**Files likely touched:**
- whatever validation flags

**Dependencies:** Task 9

## Task Dependency Graph

```text
Task 1 (RED: harness + flag)
  └─ Task 2 (GREEN: parse + validate --channel)
       └─ Task 3 (env fallback)
            └─ Task 4 (resolve in configure_conductor, suppress prompt)
                 └─ Task 5 (negative: reject before any write)
                      └─ Task 6 (negative: configured channel untouched)
                           └─ Task 7 (confirm channel + source in output)
                                └─ Task 8 (help text)
                                     └─ Task 9 (docs + release waiver)
                                          └─ Task 10 (full validation)
```

Strictly linear: every task after Task 1 edits the same two files (`bin/install` and the single
acceptance test), so parallelism would only create conflicts at no wall-clock gain on a Tier S change.

## Integration Points

- `bin/lib/harness-common.sh` — `conductor_cfg_set updateChannel` remains the sole write path; guarded
  by `test/check_update_flow_config_ownership.sh`.
- `bin/update:322` and `bin/conduct:319` — existing `updateChannel` readers. Unchanged; the recorded
  value shape (`stable|tagged|main`) is identical to what they already consume.
- `src/conductor/src/engine/self-host/release-gate.ts:132` — classifies the `bin/install` edit as
  `skill symlink targets`; satisfied by the Task 9 waiver.
- `test/test_install_provider_readiness.sh` — source of the acceptance harness; must continue to pass.

## Verification

- [ ] `bin/install --channel <stable|tagged|main>` records that channel on a first run with no TTY
- [ ] `--channel=<value>` spelling works identically to `--channel <value>`
- [ ] `AI_CONDUCTOR_CHANNEL` is honored when no flag is passed; the flag wins when both are set
- [ ] An empty `AI_CONDUCTOR_CHANNEL` is treated as unset, not as an invalid value
- [ ] An invalid value from either source exits non-zero, names the value and its source, and writes
      nothing to the fake home
- [ ] A supplied channel suppresses the interactive prompt
- [ ] With nothing supplied and no TTY, the install still exits zero recording `stable`, reported as a
      fallback with guidance on choosing explicitly
- [ ] An already-configured channel is never re-prompted and never overwritten; a supplied flag is
      reported as ignored
- [ ] `bin/install --update` behavior is unchanged
- [ ] `--help` and `-h` are identical and both document `--channel`
- [ ] `docs/reference/cli.md`, `docs/reference/environment.md`, `docs/quickstart.md` updated
- [ ] `.docs/release-waivers/<stem>.md` committed in the same diff, waiving `skill symlink targets`
- [ ] `test/test_harness_integrity.sh`, `test/lint_shell.sh`, and
      `test/check_update_flow_config_ownership.sh` all pass
- [ ] No `CHANGELOG.md` or `VERSION` edit on the branch
### Task rem-br-finish-fixture-1: src/conductor/test/acceptance/finish-publication-non-advancing-transition.acceptance.test.ts:436-442 — remove the added boundary comments, restore daemon: true, and rerun the affected acceptance test plus Task 10 validation
### Task rem-br-task7-confirmation-1: test/test_install_channel_selection.sh:117 — replace the generic stable-fallback substring check with an assertion for the bin/install:963 guidance line naming --channel, AI_CONDUCTOR_CHANNEL, and bin/update --set-channel
### Task rem-br-task7-confirmation-2: test/test_install_channel_selection.sh:171 — add a first-run PTY case with no flag or environment selection, choose a prompt option, and assert the recorded channel plus source: interactive prompt
### Task rem-br-task5-rejection-1: test/test_install_channel_selection.sh:125-144 — make the bogus flag and environment cases assert bogus and their respective sources, --channel flag and AI_CONDUCTOR_CHANNEL environment variable, while retaining the supported-channel assertion
### Task rem-br-task5-rejection-2: test/test_install_channel_selection.sh:125-144 — snapshot each invalid case's complete FAKE_HOME before and after, assert the snapshots are identical, and explicitly assert no ~/.claude/skills symlinks and no conductor config were created
