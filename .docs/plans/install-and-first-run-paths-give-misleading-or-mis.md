# Implementation Plan: Install and first-run paths give misleading or missing signals

**Date:** 2026-08-08
**Stories:** .docs/stories/install-and-first-run-paths-give-misleading-or-mis.md
**Track:** technical (no PRD)
**Complexity:** S — conflict-check, architecture-diagram, architecture-review and coherence-check skipped
**Source:** jstoup111/ai-conductor#1020

## Summary

Fixes five verified install/first-run signal defects and removes an undeclared PyYAML dependency,
in 14 tasks. Four defects are localized corrections in `bin/install`; the fifth replaces four
Python YAML call sites with user-scoped `conduct-ts config` subcommands added for the purpose.

## Technical Approach

Per the operator-approved Approach B (`.memory/decisions/2026-08-07-remove-pyyaml-from-install-config-writes.md`),
PyYAML is **removed**, not probed. The engine side already exists — `user-config.ts` exports
`readUserConfig` (`:31`) and `writeUserConfig` (`:73`) over `~/.ai-conductor/config.yml` via
`js-yaml`, and `types/config.ts` already types `markdown_viewer` (`:415`) and `mermaid_renderer`
(`:417`) — so the new CLI verbs are thin wrappers over existing typed functions, registered as
**siblings under the existing `config` group** in `createProgram()` (`cli.ts:150`, group at
`:177-181`). No new top-level verb, and no second YAML implementation.

Sequencing is driven by one hard dependency: the subcommands (Tasks 5-7) must exist before
`bin/install` is rewired onto them (Tasks 8-12). Everything else is independent, so Tasks 1, 2,
3-4 and 13 can proceed in any order.

The one genuine risk is regression of the very failure being fixed. `build_conduct_ts` (`:1309`)
runs before the write paths (`:1374-1375`) but is invoked as `|| true` and can legitimately skip
(Node < 20.5, npm absent); the read paths live in `check_installation`, which runs in `--check`
mode where no build happens at all. Tasks 11 and 12 exist specifically to prove the
conduct-ts-unavailable case announces itself by name instead of degrading into the generic
`...incomplete — continuing` warning.

Shell tests follow `test/test_install_check_build_auth.sh`: run the **real** `bin/install` with a
stubbed `conduct-ts` on `PATH`, asserting against actual script output. TS tests use vitest under
`src/conductor`.

### Release-gate note (verified, corrects an earlier assumption)

`version-signal.ts:34-58` classifies breaking surfaces by **exact path**. Editing
`src/conductor/src/cli.ts` does **not** trigger `bin/conduct CLI` — that fires only on the literal
path `bin/conduct` (`:40`). What this work does trigger is **`skill symlink targets`**, because
`bin/install` is on that list (`:45-50`) and Tasks 1, 2, 3, 4, 8-12 all modify it. Task 14 writes
the waiver for exactly that surface. A waiver must cover **every** touched surface or the gate
HALTs naming the gap, so if any task ends up adding a file matching
`/(^|\/)settings(\.local)?\.json$/` (e.g. a test fixture), the waiver must be extended to include
`settings.json schema` as well.

## Prerequisites

- None. All engine functions the plan depends on already exist and are typed.

## Tasks

### Task 1: `--check` prints a terminal summary on a build-auth-only failure
**Story:** Story 1 — happy path (build-auth failure with all else clean)
**Type:** happy-path

**Steps:**
1. Write failing test: extend `test/test_install_check_build_auth.sh` with a case asserting that a
   stub `conduct-ts` exiting non-zero produces a terminal summary line naming build authentication,
   while `--check` still exits 2.
2. Verify test fails (RED).
3. Implement: in `check_installation`, replace the bare `return 2` at `:292-294` so a summary line
   naming build authentication prints before returning 2.
4. Verify test passes (GREEN).
5. Commit: "fix(install): --check states build-auth as the reason for exit 2"

**Files likely touched:**
- `bin/install` — summary emitted before the build-auth `return 2`
- `test/test_install_check_build_auth.sh` — new case

**Wired-into:** none (no new production surface)
**Dependencies:** none

---

### Task 2: Preserve exit-code precedence and the conduct-ts-absent path
**Story:** Story 1 — happy path (drift outranks build auth), negative path (conduct-ts absent)
**Type:** negative-path

**Steps:**
1. Write failing test: assert that mixed install drift + build-auth failure still exits 1, and that
   with `conduct-ts` absent from `PATH` the run warns, prints its summary, and does not exit 2.
2. Verify test fails (RED) — or record as verified-existing if Cases 3-4 already assert it.
3. Implement: adjust the summary placement so neither precedence nor the skip path regresses.
4. Verify test passes (GREEN).
5. Commit: "test(install): pin --check exit precedence and conduct-ts-absent path"

**Files likely touched:**
- `bin/install` — summary placement relative to the drift branch
- `test/test_install_check_build_auth.sh` — precedence + absent-path cases

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

---

### Task 3: Document `--providers` in the usage block
**Story:** Story 2 — happy path
**Type:** happy-path

**Steps:**
1. Write failing test: assert `bin/install --help` output contains `--providers` with its
   description, and that `-h` output is identical to `--help`.
2. Verify test fails (RED).
3. Implement: add the `--providers` entry to the usage block at `:42-52`, describing the
   comma-separated Claude/Codex selection.
4. Verify test passes (GREEN).
5. Commit: "docs(install): list --providers in the usage block"

**Files likely touched:**
- `bin/install` — usage block
- `test/test_install_provider_readiness.sh` — help-output assertions

**Wired-into:** none (no new production surface)
**Dependencies:** none

---

### Task 4: `--providers` validation behavior is unchanged by the help edit
**Story:** Story 2 — negative path
**Type:** negative-path

**Steps:**
1. Write failing test: assert `bin/install --providers` with no value still exits non-zero with the
   existing message from `:1495`.
2. Verify test fails (RED) — or record as verified-existing.
3. Implement: no production change expected; confirm the parser at `:1492` is untouched.
4. Verify test passes (GREEN).
5. Commit: "test(install): pin --providers validation after help change"

**Files likely touched:**
- `test/test_install_provider_readiness.sh` — validation assertion

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

---

### Task 5: Capture the permission-write status before cleanup
**Story:** Story 3 — happy path
**Type:** happy-path

**Steps:**
1. Write failing test: assert that with a well-formed `settings.json`, `configure_permissions`
   returns 0, prints the added/already-set counts, writes the harness permission entries, and
   leaves no temp `$perms_file`.
2. Verify test fails (RED).
3. Implement: in `bin/install:378-392`, capture the Python write's exit status into a local
   **before** `rm -f "$perms_file"` at `:385`, then branch on the captured value rather than `$?`.
4. Verify test passes (GREEN).
5. Commit: "fix(install): report the permission write's status, not rm's"

**Files likely touched:**
- `bin/install` — `configure_permissions` status capture and cleanup ordering
- `test/test_install_update_engine_setup.sh` — permission-write assertions

**Wired-into:** none (no new production surface)
**Dependencies:** none

---

### Task 6: A failed permission write warns, returns non-zero, and still cleans up
**Story:** Story 3 — negative paths
**Type:** negative-path

**Steps:**
1. Write failing test: with a deliberately malformed `settings.json`, assert `configure_permissions`
   emits the automatic-configuration warning plus the manual-remediation hint naming the settings
   path, returns non-zero, removes the temp `$perms_file`, and that the caller guard at `:1352`
   fires its "Permissions configuration incomplete" warning.
2. Verify test fails (RED) — today the broken `$?` reports success and suppresses this entirely.
3. Implement: ensure the failure branch returns non-zero while cleanup still runs on both paths.
4. Verify test passes (GREEN).
5. Commit: "fix(install): surface permission-write failure to the caller guard"

**Files likely touched:**
- `bin/install` — failure branch and cleanup ordering
- `test/test_install_update_engine_setup.sh` — malformed-settings case

**Wired-into:** none (no new production surface)
**Dependencies:** Task 5

---

### Task 7: Add the user-scoped config read subcommand
**Story:** Story 4 — happy path (read), `config --help` listing
**Type:** infrastructure

**Steps:**
1. Write failing test: vitest asserting the new read subcommand prints a configured
   `markdown_viewer.command` from a temp-`HOME` config and exits 0, and that `config --help` lists
   it beside `init` with user scope distinguished from `init`'s project scope.
2. Verify test fails (RED).
3. Implement: register the read subcommand under the existing `config` group in `createProgram()`,
   delegating to `readUserConfig`.
4. Verify test passes (GREEN).
5. Commit: "feat(cli): add user-scoped config read subcommand"

**Files likely touched:**
- `src/conductor/src/cli.ts` — new subcommand under the `config` group
- `src/conductor/test/cli-config-user.test.ts` — read cases

**Wired-into:** `src/conductor/src/cli.ts#createProgram`
**Dependencies:** none

---

### Task 8: Add the user-scoped config write subcommand
**Story:** Story 4 — happy path (write, key preservation)
**Type:** infrastructure

**Steps:**
1. Write failing test: vitest asserting a write of `markdown_viewer` creates the config with the
   passed values, and that a write into a config holding unrelated top-level keys preserves those
   keys (asserted by parsing the result, not string match).
2. Verify test fails (RED).
3. Implement: register the write subcommand under the `config` group, delegating to
   `writeUserConfig` with the `markdown_viewer` / `mermaid_renderer` shapes from `types/config.ts`.
4. Verify test passes (GREEN).
5. Commit: "feat(cli): add user-scoped config write subcommand"

**Files likely touched:**
- `src/conductor/src/cli.ts` — new subcommand under the `config` group
- `src/conductor/test/cli-config-user.test.ts` — write + preservation cases

**Wired-into:** same as Task 7
**Dependencies:** Task 7

---

### Task 9: Config subcommand failure modes are distinguishable
**Story:** Story 4 — negative paths
**Type:** negative-path

**Steps:**
1. Write failing test: assert (a) reading malformed YAML exits non-zero with the config path in the
   message; (b) reading an absent field exits 0 with empty output, so "absent" and "broken" are
   distinguishable; (c) writing into a non-writable directory exits non-zero naming the path and
   leaves any pre-existing config unmodified.
2. Verify test fails (RED).
3. Implement: add the error handling that produces those three outcomes.
4. Verify test passes (GREEN).
5. Commit: "feat(cli): distinguish absent from unreadable user config"

**Files likely touched:**
- `src/conductor/src/cli.ts` — error handling for both subcommands
- `src/conductor/test/cli-config-user.test.ts` — negative cases

**Wired-into:** same as Task 7
**Dependencies:** Task 8

---

### Task 10: Rewire the viewer and renderer writes off PyYAML
**Story:** Story 5 — happy path (writes)
**Type:** happy-path

**Steps:**
1. Write failing test: with a stub `conduct-ts` on `PATH`, assert completing the viewer prompt
   writes the expected `markdown_viewer` section to a temp-`HOME` config, and likewise for
   `mermaid_renderer`.
2. Verify test fails (RED).
3. Implement: replace the Python heredocs in `write_md_viewer_config` (`:706`) and
   `write_mermaid_renderer_config` (`:812`) with calls to the Task 8 subcommand.
4. Verify test passes (GREEN).
5. Commit: "refactor(install): write viewer/renderer config via conduct-ts"

**Files likely touched:**
- `bin/install` — `write_md_viewer_config`, `write_mermaid_renderer_config`
- `test/test_install_update_engine_setup.sh` — config-write assertions

**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

---

### Task 11: Rewire the `--check` reads off PyYAML
**Story:** Story 5 — happy path (unchanged success output)
**Type:** happy-path

**Steps:**
1. Write failing test: assert that for a configured viewer whose command is on `PATH`,
   `bin/install --check` still prints `markdown viewer: <cmd> (artifact review)` — output for the
   already-working case is unchanged — and likewise for the renderer.
2. Verify test fails (RED).
3. Implement: replace the Python one-liners at `:262` and `:273-274` with calls to the Task 7
   subcommand.
4. Verify test passes (GREEN).
5. Commit: "refactor(install): read viewer/renderer config via conduct-ts"

**Files likely touched:**
- `bin/install` — `check_installation` read sites
- `test/test_install_check_build_auth.sh` — viewer/renderer read assertions

**Wired-into:** none (no new production surface)
**Dependencies:** Task 7

---

### Task 12: Name conduct-ts when it is unavailable on the write paths
**Story:** Story 5 — primary negative path
**Type:** negative-path

**Steps:**
1. Write failing test: with `conduct-ts` removed from `PATH`, assert `configure_md_viewer` and
   `configure_mermaid_renderer` emit a message containing "conduct-ts" and its remediation, and
   that neither reports success — not the generic `...incomplete — continuing` warning from
   `:1374-1375`.
2. Verify test fails (RED).
3. Implement: detect conduct-ts availability at the write paths and emit the named message.
4. Verify test passes (GREEN).
5. Commit: "fix(install): name conduct-ts as the missing prerequisite on config write"

**Files likely touched:**
- `bin/install` — `configure_md_viewer`, `configure_mermaid_renderer` availability guard
- `test/test_install_update_engine_setup.sh` — conduct-ts-absent case

**Wired-into:** none (no new production surface)
**Dependencies:** Task 10

---

### Task 13: `--check` never claims a configured viewer is unconfigured
**Story:** Story 5 — negative paths (read side)
**Type:** negative-path

**Steps:**
1. Write failing test: with `conduct-ts` absent from `PATH` and a viewer that **is** configured,
   assert `bin/install --check` does not print "not configured" and instead reports that the value
   could not be read because conduct-ts is unavailable; and that a malformed config is named as
   unreadable rather than degrading to "unset".
2. Verify test fails (RED).
3. Implement: distinguish unreadable from unconfigured at the read sites.
4. Verify test passes (GREEN).
5. Commit: "fix(install): distinguish unreadable config from unconfigured in --check"

**Files likely touched:**
- `bin/install` — `check_installation` read-failure branches
- `test/test_install_check_build_auth.sh` — unreadable-vs-unconfigured cases

**Wired-into:** none (no new production surface)
**Dependencies:** Task 11

---

### Task 14: Remove the stray root lockfile
**Story:** Story 6 — happy and negative paths
**Type:** infrastructure

**Steps:**
1. Write failing test: assert no `package-lock.json` exists at the repository root, and that
   `grep -rn "package-lock" .github/ test/ bin/ src/conductor/src/` yields only
   `src/conductor/package-lock.json` references.
2. Verify test fails (RED).
3. Implement: delete the root `package-lock.json`.
4. Verify test passes (GREEN) and confirm `cd src/conductor && npm ci && npm run build` still
   succeeds, proving the real lockfile is untouched.
5. Commit: "chore: remove stray empty root package-lock.json"

**Files likely touched:**
- `package-lock.json` — deleted
- `test/test_harness_integrity.sh` — root-lockfile absence check

**Wired-into:** none (no new production surface)
**Dependencies:** none

---

### Task 15: Commit the release waiver for the touched breaking surface
**Story:** none — land-gate requirement (self-host release gate)
**Type:** infrastructure

**Steps:**
1. Confirm the change set's touched surfaces by re-reading `version-signal.ts:34-58` against the
   final diff — `bin/install` maps to `skill symlink targets`; verify nothing in the diff matches
   `/(^|\/)settings(\.local)?\.json$/`, `hooks/`, or the literal path `bin/conduct`.
2. Write `.docs/release-waivers/install-and-first-run-paths-give-misleading-or-mis.md` with a
   `Waives:` line naming every touched canonical surface (expected: `skill symlink targets`) and a
   non-empty `Rationale:` explaining that the `bin/install` edits are internal signal-reporting
   corrections and a PyYAML removal with no consumer-visible CLI, hook, or schema behavior change,
   so a migration block would be empty.
3. Verify the file parses under `parseWaiver` (`release-gate.ts:161`) — a `Waives:` line, a
   non-empty rationale, and only canonical surface names.
4. Commit: "chore(release): waive skill-symlink-targets surface for internal install fixes"

**Files likely touched:**
- `.docs/release-waivers/install-and-first-run-paths-give-misleading-or-mis.md` — new waiver

**Wired-into:** none (no new production surface)
**Dependencies:** Task 13, Task 14

---

## Task Dependency Graph

```
Task 1 ──▶ Task 2                     (Story 1: --check summary)

Task 3 ──▶ Task 4                     (Story 2: --providers help)

Task 5 ──▶ Task 6                     (Story 3: permission-write status)

Task 7 ──┬─▶ Task 8 ──▶ Task 9        (Story 4: config subcommands)
         │       │
         │       └─────▶ Task 10 ──▶ Task 12    (Story 5: writes)
         │
         └─────────────▶ Task 11 ──▶ Task 13    (Story 5: reads)

Task 14                               (Story 6: lockfile, independent)

Task 13, Task 14 ──▶ Task 15          (release waiver, last)
```

Independent roots: Tasks 1, 3, 5, 7, 14 — startable in any order.

## Integration Points

- **After Task 9:** the user-scoped config subcommands are usable standalone; `conduct-ts config`
  can read and write `~/.ai-conductor/config.yml` end to end.
- **After Task 13:** `bin/install` no longer references PyYAML on any path; `grep -n "import yaml"
  bin/install` returns no matches.
- **After Task 15:** the change set satisfies the self-host release gate.

## Validation (per CLAUDE.md, before every commit)

- `test/test_harness_integrity.sh`
- For TS changes (Tasks 7-9): `cd src/conductor && npm run typecheck && npm test -- --run`
- `test/lint_shell.sh` for the `bin/install` edits

## Coverage Mapping

| Story | Criterion group | Task(s) |
|---|---|---|
| 1 | Happy: summary on build-auth failure | 1 |
| 1 | Happy: clean run exits 0; drift outranks build auth | 2 |
| 1 | Negative: conduct-ts absent → warn, no exit 2 | 2 |
| 2 | Happy: `--providers` in help; `-h` identical | 3 |
| 2 | Negative: missing value still rejected | 4 |
| 3 | Happy: status captured before cleanup; temp file removed | 5 |
| 3 | Negative: malformed settings → warn, non-zero, caller guard fires, temp removed | 6 |
| 4 | Happy: read; `config --help` listing | 7 |
| 4 | Happy: write; unrelated keys preserved | 8 |
| 4 | Negative: malformed YAML, absent field, unwritable dir | 9 |
| 5 | Happy: writes persist; PyYAML unused | 10 |
| 5 | Happy: `--check` success output unchanged | 11 |
| 5 | Negative: conduct-ts absent on write → named message | 12 |
| 5 | Negative: `--check` unreadable ≠ unconfigured; malformed named | 13 |
| 6 | Happy + negative: root lockfile gone, CI unaffected | 14 |

Every acceptance criterion in the stories file maps to at least one task.

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic
- [x] Every task carries a `**Dependencies:**` line and the plan has a Task Dependency Graph
- [x] Every task carries a `**Wired-into:**` line
- [x] No terminal catch-all validation task
- [x] No plan task for ordinary project documentation (the repo's `maintain-documentation`
      custom step owns `docs/reference/cli.md`)
- [x] No task names another feature's sealed `.docs/` artifact
