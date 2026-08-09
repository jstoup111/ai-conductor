**Status:** Accepted

# Stories: Update-check config single source of truth (#1400)

**Track:** technical — no PRD; acceptance criteria live here.
**Design:** `.docs/architecture/update-check-config-single-source-of-truth.md`
**Architecture review:** `.docs/decisions/review-2026-08-09-update-check-config-split-brain-1400.md`

## Story ST-1400-1: Update-check state resolves to the schema-owned block

**Requirement:** Technical intent TI-1 — every read and write of update-check state resolves to
`conductor:` in `~/.ai-conductor/config.yml`, and the legacy JSON is never consulted outside the
one-time seed.

As an operator, I want the config location the documentation and schema describe to be the location
that actually drives update behavior, so that editing it changes what the harness does instead of
changing nothing.

### Acceptance Criteria

#### Happy Path

- Given a user config whose `conductor.update_channel` is `main`, when the update flow dispatches on
  channel, then it takes the `main` branch, regardless of any value present in the legacy JSON.
- Given a user config whose `conductor.auto_check` is `false`, when the auto entry point runs, then it
  is a silent no-op, regardless of any value present in the legacy JSON.
- Given the update flow records a new `current_version` and `last_checked_at`, when the user config is
  read back, then both appear under `conductor:` in snake_case, and the legacy JSON is byte-for-byte
  unchanged.
- Given a user config that also contains a `markdown_viewer` block, when any update-check key is
  written, then the `markdown_viewer` block and every other top-level key survive unchanged.

#### Negative Paths

- Given no user config file exists and no legacy JSON exists, when the update flow reads a key, then
  it receives the caller's stated default and does not create a legacy JSON.
- Given the user config exists but fails to parse, when the update flow reads a key, then it reports
  the parse error and declines to run the check, rather than substituting a default and proceeding.
- Given an operator edits `conductor.current_version` in the user config by hand, when the update
  flow next runs, then it observes the edited value.

### Done When

- [ ] `conductor_cfg_get` and `conductor_cfg_set` resolve `conductor.<snake_case_key>` and no longer
      read or write `~/.claude/ai-conductor.config.json`.
- [ ] All ten existing call sites in `bin/update` and `bin/conduct` are unchanged in signature.
- [ ] A test proves an unrelated top-level key survives a `conductor` write.

## Story ST-1400-2: Existing installs seed once and keep their update identity

**Requirement:** Technical intent TI-2 — the legacy JSON wins a single seed of the `conductor:`
block; the rename of the legacy file is the idempotence marker; the block is authoritative
thereafter.

As an operator upgrading an existing install, I want my current channel and installed-version
identity carried forward, so the upgrade does not silently revert my channel or disable update
checking.

### Acceptance Criteria

#### Happy Path

- Given a legacy JSON with `updateChannel: main`, `currentVersion: v0.100.0` and a user config whose
  `conductor:` block is stale with `update_channel: tagged`, `current_version: v0.99.12`, when the
  seed runs, then the block holds `main` and `v0.100.0` — the live JSON overwrites the stale block.
- Given a successful seed, when it completes, then the legacy JSON is renamed to
  `ai-conductor.config.json.migrated` and no longer exists at its original path.
- Given the seed has already run, when any later invocation reads or writes update-check state, then
  the seed is a no-op and the block's current values are preserved.
- Given no legacy JSON exists, when the seed runs, then it is a no-op and no marker is required.
- Given the seed runs twice in one shell invocation via two different accessor calls, when the second
  call occurs, then the seed body executes at most once.

#### Negative Paths

- Given a legacy JSON that is absent, empty, or malformed JSON, when the seed runs, then it writes
  nothing, leaves the block untouched, and does not rename anything.
- Given a legacy JSON missing `autoCheck`, when the seed runs, then `conductor.auto_check` is left
  unset so the reader's own default applies, rather than a value the operator never chose.
- Given a legacy JSON whose `updateChannel` is neither `tagged` nor `main`, when the seed runs, then
  that key is dropped with a warning and is not written, so the user config cannot be left in a state
  that fails merged validation.
- Given the rename fails, when the seed reports its result, then it reports failure and does not
  claim the seed succeeded, so a later idempotent re-seed remains possible.
- Given a caller invokes a write before any read, when the write executes, then the seed has already
  run as a precondition, so the fresh written value is not subsequently overwritten by older legacy
  data.

### Done When

- [ ] The seed lives in `bin/lib/harness-common.sh`, not `bin/conduct`, so #226 cannot delete it.
- [ ] The seed is invoked as a precondition inside both accessors, guarded by a process-scoped flag.
- [ ] A test covers the operator's real divergence case: stale block, live JSON, JSON wins.
- [ ] A test proves a fresh install path never re-seeds over a newer value.

## Story ST-1400-3: A validated scalar write verb exists for the user config

**Requirement:** Technical intent TI-3 — `conduct-ts config set <dotted.path> <value>` writes a
scalar to the user config, validating the `conductor` block before persisting.

As a shell caller, I want a scalar user-config write that refuses invalid values, so that bash never
needs a YAML parser and an invalid write cannot block every project on the machine.

### Acceptance Criteria

#### Happy Path

- Given a valid `conductor.update_channel` value of `tagged` or `main`, when `config set` runs, then
  the value is persisted under `conductor:` and the command exits zero.
- Given `conductor.auto_check` is set to `true` or `false`, when the value is persisted, then it is a
  YAML boolean, not the string `"true"`, so the schema's boolean check passes.
- Given a user config with existing unrelated top-level keys, when `config set` writes, then those
  keys are preserved and the write is atomic.
- Given a dotted path whose intermediate mapping does not yet exist, when `config set` runs, then the
  intermediate mapping is created.
- Given `config write` is invoked with its existing viewer or renderer arguments, when it runs, then
  its behavior and argument grammar are unchanged by the addition of `config set`.

#### Negative Paths

- Given `conductor.update_channel` is set to a value other than `tagged` or `main`, when `config set`
  runs, then it exits non-zero with the validator's own per-key message and the file is not modified.
- Given `conductor.auto_check` is set to a non-boolean value, when `config set` runs, then it exits
  non-zero and the file is not modified.
- Given an unknown key under `conductor`, when `config set` runs, then it is rejected, because
  `validateConductorBlock` rejects unknown keys and a persisted unknown key would fail every
  subsequent merged load.
- Given the existing user config fails to parse, when `config set` runs, then it exits non-zero
  reporting the path and parse error, and does not overwrite the unparseable file.
- Given the config directory is unwritable, when `config set` runs, then it exits non-zero with the
  failure reason and leaves no partial or temp file behind.

### Done When

- [ ] `config set` is additive; `config read` and `config write` keep their current contracts.
- [ ] Validation runs against the prospective post-write block, before persisting.
- [ ] `docs/reference/cli.md` documents the new verb in the same change.

## Story ST-1400-4: Bash degrades loudly, never to a silent default

**Requirement:** Technical intent TI-4 — no update-check read may substitute a default when the
underlying read failed, and no path in the update flow may depend on PyYAML.

As an operator, I want a failed config read to say so, because a silently disabled update check is
indistinguishable from a healthy one and is the failure this issue was filed about.

### Acceptance Criteria

#### Happy Path

- Given `conduct-ts` is available and the user config is readable, when the update flow reads a key,
  then it receives the persisted value.
- Given the update flow runs on a machine without PyYAML installed, when it reads and writes
  update-check state, then it succeeds, because no path in the flow imports `yaml` in Python.

#### Negative Paths

- Given `conduct-ts` is missing or unbuilt, when the update flow attempts a read, then it warns with
  a stated reason and declines to run the update check, rather than proceeding on a default.
- Given a read fails for any reason, when `current_version` is unavailable, then the flow must not
  present the caller's default as though it were a persisted value.
- Given the auto entry point encounters any of the above, when it exits, then it exits without
  failing its caller, since it is spawned advisory-only.

### Done When

- [ ] No file in the update-check path imports PyYAML.
- [ ] A read failure is distinguishable from a legitimately absent value at every call site that acts
      on the result.

## Story ST-1400-5: The split cannot silently reappear

**Requirement:** Technical intent TI-5 — a validation check fails closed if the update flow reads or
writes a config surface the schema does not own.

As a maintainer, I want the repository to reject a reintroduction of the legacy surface mechanically,
so the fix does not depend on future authors remembering it.

### Acceptance Criteria

#### Happy Path

- Given the repository after this change, when the integrity suite runs, then the new check passes.
- Given the seed function, when the check runs, then its single reference to the legacy path is the
  one permitted reference and does not fail the check.

#### Negative Paths

- Given a new reference to `~/.claude/ai-conductor.config.json` is added anywhere under `bin/` outside
  the seed, when the integrity suite runs, then the check fails and names the offending file and line.
- Given the update flow references a `conductor` key that `validateConductorBlock` does not allow,
  when the integrity suite runs, then the check fails and names the unknown key.
- Given the check itself cannot determine the schema's allowed key set, when it runs, then it fails
  closed rather than passing silently.

### Done When

- [ ] The check is a numbered check in `test/test_harness_integrity.sh`.
- [ ] `docs/contributing/validation.md` documents what makes it fail and how to fix it.
- [ ] A deliberate violation is shown to fail the check.

## Story ST-1400-6: Legacy translation residue is removed and the documentation stops lying

**Requirement:** Technical intent TI-6 — dead legacy readers are deleted and the affected reference
documentation is corrected in the same change.

As a future reader, I want no exported legacy translator and no documentation describing the old
split, so the next person does not wire something to a surface that no longer exists.

### Acceptance Criteria

#### Happy Path

- Given the change is complete, when `readLegacyJson` and `legacyJsonPath` are searched for, then
  they no longer exist and no caller references them.
- Given `docs/reference/configuration.md`, when the config-surface table is read, then it describes
  the `conductor:` block as the sole update-check surface and the legacy JSON as a one-time seed
  input that is renamed after migration.
- Given `docs/reference/cli.md`, when the config commands are read, then `config set` is documented
  alongside `config read` and `config write`.
- Given the full validation suite, when it runs after these deletions, then it passes with no
  dangling references.

#### Negative Paths

- Given the tests that covered `readLegacyJson`, when it is deleted, then those tests are removed
  with it rather than left asserting on absent behavior.
- Given `bin/conduct` retains its duplicated update block until #226, when it runs, then it resolves
  update-check state through the same shared accessors, so the two CLIs cannot diverge in the interim.
- Given the migration is user-visible, when the PR is opened, then it carries a runnable migration
  fence in a `## Migration` section rather than a waiver, because the change relocates a real
  operator-facing config surface.

### Done When

- [ ] `readLegacyJson`, `legacyJsonPath`, and `LEGACY_JSON_FILE` are gone along with their tests.
- [ ] `migrate_legacy_conductor_config` no longer exists in `bin/conduct`; the seed is its replacement.
- [ ] `docs/reference/configuration.md` and `docs/reference/cli.md` are updated in the same PR.
