# Implementation Plan: Update-check config single source of truth (#1400)

**Date:** 2026-08-09
**Stem:** update-check-config-single-source-of-truth
**Track:** technical (no PRD)
**Tier:** M
**Stories:** .docs/stories/update-check-config-single-source-of-truth.md
**Conflict check:** .docs/conflicts/update-check-config-single-source-of-truth.md — PASSED
**Complexity:** .docs/complexity/update-check-config-single-source-of-truth.md
**Design:** .docs/architecture/update-check-config-single-source-of-truth.md
**Architecture review:** .docs/decisions/review-2026-08-09-update-check-config-split-brain-1400.md — APPROVED, 3 conditions
**ADR:** .docs/decisions/adr-2026-08-09-conductor-block-single-source-of-truth.md — APPROVED
**ADR:** .docs/decisions/adr-2026-08-09-legacy-json-seed-migration-rule.md — APPROVED
**ADR:** .docs/decisions/adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md — APPROVED

## Summary

Make the schema-owned `conductor:` block in `~/.ai-conductor/config.yml` the only surface the
update-check flow reads or writes, seed it once from the live legacy JSON so no install loses its
version identity, reach it from bash through `conduct-ts config` so PyYAML never becomes
load-bearing, and add an integrity check so the split cannot silently return. 15 tasks: 3 for the
new CLI primitive, 3 for the bash accessors, 4 for the seed, 1 for `bin/install`, 2 guards, 2
documentation and release.

## Technical Approach

- **New CLI verb (TypeScript).** Add `conduct-ts config set <dotted.path> <value>` beside the
  existing `config read` / `config write` in `src/conductor/src/cli.ts`. `config write` keeps its
  positional viewer/renderer grammar untouched. `config set` runs `validateConductorBlock` against
  the prospective post-write `conductor` block before persisting and coerces `auto_check` to a real
  boolean, so an invalid value can never reach disk and trip the #1026 machine-wide failure. The
  write itself reuses `writeUserConfig`'s atomic temp-and-rename, which preserves every other
  top-level key.
- **Bash accessors (`bin/lib/harness-common.sh`).** `conductor_cfg_get` and `conductor_cfg_set` keep
  their existing two-argument signatures — so none of the ten call sites in `bin/update` and
  `bin/conduct` change — but resolve `conductor.<snake_case_key>` via `conduct-ts config read` /
  `conduct-ts config set`. A camelCase-to-snake_case map lives in one place. A failed read is
  reported and propagated, never silently replaced by the caller's default.
- **Seed (`bin/lib/harness-common.sh`).** `seed_conductor_config_from_legacy` replaces
  `migrate_legacy_conductor_config`, which is deleted from `bin/conduct`. It triggers on the presence
  of `~/.claude/ai-conductor.config.json`, translates the four keys, writes them over whatever the
  block currently holds, then renames the legacy file to `.migrated` — the rename is both the marker
  and the proof, so trigger and marker cannot disagree. It is invoked as a precondition inside both
  accessors under a process-scoped guard, making it structurally impossible to read or write the
  block before seeding.
- **`bin/install`.** `configure_conductor()` stops hand-rolling JSON at `:914-963` and writes through
  the accessors, matching what the same file already does for `markdown_viewer` and
  `mermaid_renderer` at `:264,278,712,809`.
- **Guards and cleanup.** A numbered `test/test_harness_integrity.sh` check fails closed on any
  reference to the legacy path under `bin/` outside the seed, and on any `conductor` key the schema
  does not allow. `readLegacyJson`, `legacyJsonPath`, and `LEGACY_JSON_FILE` are deleted with their
  tests.
- **Test isolation.** Every test drives the real internal flow against a temp `HOME`; no test touches
  the operator's actual `~/.ai-conductor/config.yml` or `~/.claude/`. No third-party calls are
  involved anywhere in this change.

## Prerequisites

- Accepted stories and a clean conflict check are present.
- All three ADRs are APPROVED.
- No schema migration, external service, database, port, or fixture installation is required.

## Task Dependency Graph

```
T1 ─▶ T2 ─▶ T3 ─┐
                ├─▶ T4 ─▶ T5 ─▶ T6 ─┐
                                    ├─▶ T7 ─▶ T8 ─▶ T9 ─▶ T10 ─┐
                                                               ├─▶ T11 ─┐
                                                                        ├─▶ T12 ─▶ T13 ─▶ T14 ─▶ T15
```

T1–T3 (the CLI primitive) must land before T4–T6, which consume it. T7–T10 (the seed) depend on the
accessors existing. T11 (`bin/install`) depends on the accessors. T12–T13 (guards and deletion) must
follow every repoint, or the integrity check fails on code not yet moved. T14–T15 close documentation
and release and must be last.

## Tasks

### Task 1: RED — `config set` parses and rejects invalid conductor values
**Story:** ST-1400-3
**Type:** negative-path

**Steps:**
1. Write failing tests for a new `detectUserConfigSetCommand`: it recognizes
   `config set <dotted.path> <value>`, returns null for a missing path or value, and does not
   intercept the existing `config write` argument grammar.
2. Write failing tests for `userConfigSetCommand` covering rejection: `conductor.update_channel` set
   to something other than `tagged` or `main`, `conductor.auto_check` set to a non-boolean, an
   unknown key under `conductor`, an unparseable existing file, and an unwritable directory. Each
   must exit non-zero and leave the file unmodified.
3. Verify the tests fail because neither function exists.
4. Implement: nothing.
5. Commit: "test(cli): specify config set validation and rejection paths"

**Files likely touched:**
- `src/conductor/test/cli-config-user.test.ts` — new failing specs

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 2: GREEN — `config set` writes a validated scalar
**Story:** ST-1400-3
**Type:** happy-path

**Steps:**
1. Add happy-path tests: a valid `update_channel` persists; `auto_check` persists as a YAML boolean
   rather than the string `"true"`; an unrelated top-level key survives; a missing intermediate
   mapping is created.
2. Verify they fail.
3. Implement `detectUserConfigSetCommand` and `userConfigSetCommand` in `src/conductor/src/cli.ts`,
   validating the prospective `conductor` block with `validateConductorBlock` before calling
   `writeUserConfig`, and coercing `auto_check` to a boolean.
4. Verify all Task 1 and Task 2 tests pass.
5. Commit: "feat(cli): add conduct-ts config set with validated conductor writes"

**Files likely touched:**
- `src/conductor/src/cli.ts` — new detect + command functions
- `src/conductor/test/cli-config-user.test.ts` — happy-path specs

**Wired-into:** src/conductor/src/index.ts#main
**Dependencies:** Task 1

### Task 3: Wire `config set` into dispatch
**Story:** ST-1400-3
**Type:** happy-path

**Steps:**
1. Write a failing wiring test that drives the real argv dispatch path end to end for
   `config set conductor.update_channel main` against a temp `HOME`.
2. Verify it fails because dispatch does not reach the new command.
3. Register the detector in the pre-pipeline dispatch chain alongside `config read`/`config write`,
   and add the subcommand description next to the existing `config write` registration.
4. Verify the wiring test passes and the existing `config read`/`config write` tests still pass.
5. Commit: "feat(cli): dispatch config set through the pre-pipeline command chain"

**Files likely touched:**
- `src/conductor/src/index.ts` — dispatch registration in `main()`, alongside the existing `config read`/`config write` branches at `:561-567`
- `src/conductor/src/cli.ts` — export the new detector
- `src/conductor/test/cli-config-user.test.ts` — wiring spec

**Wired-into:** src/conductor/src/index.ts#main
**Dependencies:** Task 2

### Task 4: RED — accessors must resolve the schema-owned block
**Story:** ST-1400-1
**Type:** happy-path

**Steps:**
1. Write failing shell specs against a temp `HOME`: `conductor_cfg_set updateChannel main` then
   `conductor_cfg_get updateChannel` round-trips through `conductor.update_channel` in the YAML; a
   pre-existing `markdown_viewer` block survives the write; the legacy JSON is not created.
2. Verify they fail because the accessors still target the legacy JSON.
3. Implement: nothing.
4. n/a
5. Commit: "test(update): specify conductor accessors against the schema-owned block"

**Files likely touched:**
- `test/test_bin_update.sh` — new failing specs

**Wired-into:** none (no new production surface)
**Dependencies:** Task 3

### Task 5: GREEN — repoint the accessors at `conductor:`
**Story:** ST-1400-1
**Type:** happy-path

**Steps:**
1. Verify the Task 4 specs still fail.
2. Rewrite `conductor_cfg_get` and `conductor_cfg_set` to map the four camelCase field names to
   `conductor.<snake_case>` and delegate to `conduct-ts config read` / `conduct-ts config set`,
   keeping both signatures unchanged.
3. Remove the `CONDUCTOR_CONFIG` read/write coupling from these two functions.
4. Verify the Task 4 specs pass and `bash -n` plus `shellcheck --severity=error` are clean.
5. Commit: "fix(update): resolve update-check state through the schema-owned conductor block"

**Files likely touched:**
- `bin/lib/harness-common.sh` — accessor bodies and key map
- `test/test_bin_update.sh` — specs now passing

**Wired-into:** bin/lib/harness-common.sh#conductor_cfg_get, bin/lib/harness-common.sh#conductor_cfg_set
**Dependencies:** Task 4

### Task 6: A failed read degrades loudly, never to a default
**Story:** ST-1400-4
**Type:** negative-path

**Steps:**
1. Write failing specs: with `conduct-ts` absent from `PATH`, a read reports a named prerequisite
   failure and returns non-zero rather than echoing the caller's default; the update check then
   declines with a stated reason; the auto entry point still exits zero because it is advisory-only.
2. Verify they fail.
3. Implement the non-zero propagation in `conductor_cfg_get` and the decline path in `bin/update`,
   following the existing precedent in `bin/install` that names `conduct-ts` as the missing
   prerequisite on a config write.
4. Verify the specs pass and no PyYAML import remains anywhere in the update-check path.
5. Commit: "fix(update): name the missing prerequisite instead of defaulting silently"

**Files likely touched:**
- `bin/lib/harness-common.sh` — read failure propagation
- `bin/update` — decline path with a stated reason
- `test/test_bin_update.sh` — negative specs

**Wired-into:** same as Task 5
**Dependencies:** Task 5

### Task 7: RED — the seed carries the live JSON over a stale block
**Story:** ST-1400-2
**Type:** happy-path

**Steps:**
1. Write failing specs reproducing the operator's real divergence: a legacy JSON with
   `updateChannel: main` and `currentVersion: v0.100.0`, a stale block with `update_channel: tagged`
   and `current_version: v0.99.12`; after the seed the block holds `main` and `v0.100.0`.
2. Add specs for the rename marker: the legacy file no longer exists at its original path and
   `ai-conductor.config.json.migrated` does.
3. Add specs for idempotence: a second run is a no-op and does not disturb the block.
4. Verify all fail because the function does not exist.
5. Commit: "test(update): specify the legacy-wins seed and its rename marker"

**Files likely touched:**
- `test/test_bin_update.sh` — seed specs

**Wired-into:** none (no new production surface)
**Dependencies:** Task 6

### Task 8: RED — the seed refuses partial and invalid legacy data
**Story:** ST-1400-2
**Type:** negative-path

**Steps:**
1. Write failing specs: an absent, empty, or malformed legacy JSON writes nothing and renames
   nothing; a missing `autoCheck` leaves `conductor.auto_check` unset rather than defaulting; an
   `updateChannel` that is neither `tagged` nor `main` is dropped with a warning and not written; a
   failed rename reports failure rather than claiming success.
2. Verify they fail.
3. Implement: nothing.
4. n/a
5. Commit: "test(update): specify seed refusal on partial and invalid legacy data"

**Files likely touched:**
- `test/test_bin_update.sh` — seed negative specs

**Wired-into:** none (no new production surface)
**Dependencies:** Task 7

### Task 9: GREEN — implement the seed in the permanent home
**Story:** ST-1400-2
**Type:** happy-path

**Steps:**
1. Verify the Task 7 and Task 8 specs still fail.
2. Implement `seed_conductor_config_from_legacy` in `bin/lib/harness-common.sh`: parse the legacy
   JSON with `python3`'s stdlib `json`, translate the four keys, skip absent or type-invalid keys
   individually, write each through `conductor_cfg_set`, then rename the legacy file to `.migrated`,
   reporting failure if the rename fails.
3. Verify every Task 7 and Task 8 spec passes.
4. Verify `bash -n` and `shellcheck --severity=error` are clean.
5. Commit: "feat(update): seed the conductor block once from the legacy JSON"

**Files likely touched:**
- `bin/lib/harness-common.sh` — seed function

**Wired-into:** none (inert until bin/lib/harness-common.sh)
**Dependencies:** Task 8

### Task 10: The seed is a precondition, not a convention
**Story:** ST-1400-2
**Type:** negative-path

**Steps:**
1. Write a failing spec proving ordering safety: a caller that writes `current_version` before any
   read must not have that fresh value overwritten by older legacy data afterwards.
2. Write a failing spec proving the seed body executes at most once per shell invocation across two
   different accessor calls.
3. Verify both fail.
4. Invoke the seed as a precondition at the top of both `conductor_cfg_get` and `conductor_cfg_set`,
   guarded by a process-scoped flag.
5. Verify both specs pass, then commit: "fix(update): run the legacy seed as an accessor precondition"

**Files likely touched:**
- `bin/lib/harness-common.sh` — precondition guard
- `test/test_bin_update.sh` — ordering and once-only specs

**Wired-into:** bin/lib/harness-common.sh#conductor_cfg_get, bin/lib/harness-common.sh#conductor_cfg_set
**Dependencies:** Task 9

### Task 11: `bin/install` writes through the same surface
**Story:** ST-1400-1
**Type:** happy-path

**Steps:**
1. Write a failing spec: on a fresh temp `HOME`, `configure_conductor()` writes `conductor:` into the
   user config and creates no legacy JSON; in update mode it refreshes `current_version` and
   `last_checked_at` while preserving channel and `auto_check`.
2. Verify it fails because `bin/install:914-963` still hand-rolls JSON.
3. Replace that block's direct `python3` JSON writes with `conductor_cfg_set` calls, matching the
   delegation the same file already uses for `markdown_viewer` and `mermaid_renderer`.
4. Verify the spec passes, `--check` behavior is unchanged, and shell lint is clean.
5. Commit: "fix(install): write update-check state through the conductor accessors"

**Files likely touched:**
- `bin/install` — `configure_conductor()`
- `test/test_bin_update.sh` — install-path spec

**Wired-into:** same as Task 5
**Dependencies:** Task 10

### Task 12: The split cannot silently reappear
**Story:** ST-1400-5
**Type:** negative-path

**Steps:**
1. Write a failing spec for a new integrity check: it fails when a reference to
   `~/.claude/ai-conductor.config.json` is introduced under `bin/` outside the seed function, fails
   when the update flow names a `conductor` key absent from the schema's allowed set, fails closed
   when it cannot determine the allowed set, and passes on the current tree.
2. Verify it fails because the check does not exist.
3. Add the check as a numbered check in `test/test_harness_integrity.sh`, naming the offending file
   and line on failure.
4. Verify the check passes on the current tree and fails on a deliberately introduced violation.
5. Commit: "test(integrity): fail closed when the update flow leaves the schema-owned surface"

**Files likely touched:**
- `test/test_harness_integrity.sh` — new numbered check
- `test/lint_shell.sh` — no change expected; confirm clean

**Wired-into:** none (no new production surface)
**Dependencies:** Task 11

### Task 13: Delete the legacy translation residue
**Story:** ST-1400-6
**Type:** happy-path

**Steps:**
1. Confirm by search that `readLegacyJson`, `legacyJsonPath`, and `LEGACY_JSON_FILE` have no
   remaining production callers, and that `migrate_legacy_conductor_config` is superseded.
2. Delete all three from `src/conductor/src/engine/user-config.ts` and remove their tests rather than
   leaving assertions on absent behavior.
3. Delete `migrate_legacy_conductor_config` and its invocation from `bin/conduct`.
4. Verify the full test suite and the integrity suite pass with no dangling references.
5. Commit: "refactor: remove the superseded legacy config translators"

**Files likely touched:**
- `src/conductor/src/engine/user-config.ts` — deletions
- `src/conductor/test/engine/user-config.test.ts` — test removals
- `bin/conduct` — remove the superseded migration and its call site

**Wired-into:** none (no new production surface)
**Dependencies:** Task 12

### Task 14: Correct the documentation this change invalidates
**Story:** ST-1400-6
**Type:** happy-path

**Steps:**
1. Update `docs/reference/configuration.md`: the config-surface table's "Legacy user JSON" row now
   describes a one-time seed input that is renamed after migration, and the `conductor` section
   states that this block is the sole update-check surface with the documented seed precedence rule.
2. Update `docs/reference/cli.md` to document `conduct-ts config set`, including its validation
   behavior and its non-zero exits.
3. Update `docs/contributing/validation.md` with the new numbered check: what makes it fail and how
   to fix it.
4. Verify the docs navigation and docs-page smoke checks pass.
5. Commit: "docs: describe the conductor block as the sole update-check surface"

**Files likely touched:**
- `docs/reference/configuration.md`
- `docs/reference/cli.md`
- `docs/contributing/validation.md`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 13

### Task 15: Carry the migration and release metadata
**Story:** ST-1400-6
**Type:** happy-path

**Steps:**
1. Author a runnable ```` ```bash migration ```` fence inside a `## Migration` section of the PR body
   that performs the same seed for a consumer updating past this release, and is a safe no-op when
   the legacy file is already renamed or absent.
2. Verify the migration block passes `test/check_migration_block_authoring.sh`.
3. Set the release metadata to `Release-Disposition: note`, `Release-Category: Fixed`,
   `Release-Semver: patch`, with a reader-facing note describing the config relocation and the
   automatic migration.
4. Run the full validation suite and confirm it is green; neither `VERSION` nor `CHANGELOG.md` is
   touched by this branch.
5. Commit: "docs(release): declare the update-check config relocation and its migration"

**Files likely touched:**
- PR body — `## Migration` section and release metadata (no repository file)

**Wired-into:** none (no new production surface)
**Dependencies:** Task 14

## Verification

- [ ] Editing `conductor.update_channel` in `~/.ai-conductor/config.yml` changes which branch the
      update flow takes.
- [ ] An install carrying the operator's real divergence keeps `main` and `v0.100.0` after upgrade.
- [ ] No file in the update-check path imports PyYAML.
- [ ] A deliberate reintroduction of the legacy path under `bin/` fails the integrity suite.
- [ ] `readLegacyJson`, `legacyJsonPath`, `LEGACY_JSON_FILE`, and `migrate_legacy_conductor_config`
      no longer exist.
- [ ] `test/test_harness_integrity.sh` passes in full.
- [ ] The PR carries a runnable migration fence and a `note` / `Fixed` / `patch` disposition.
