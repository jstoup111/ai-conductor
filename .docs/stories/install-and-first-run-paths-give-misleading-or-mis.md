**Status:** Accepted

# Stories: Install and first-run paths give misleading or missing signals

Technical track (no PRD) — acceptance criteria live here. Source: `jstoup111/ai-conductor#1020`.
Complexity tier **S**, so negative paths are required **per story** (at least one), targeting the
highest-risk failure for each.

Requirement tags reference the originating issue's bullets rather than PRD `FR-N` ids, since the
technical track authors no PRD.

Existing test convention for these paths: `test/test_install_check_build_auth.sh` runs the **real**
`bin/install --check` with a stubbed `conduct-ts` on `PATH`, asserting against actual script output
rather than a sourced fragment. New tests follow that shape.

---

## Story 1: `--check` states why it exited non-zero

**Requirement:** #1020 — bullet 2

As an operator running `bin/install --check`, I want the run to end with a summary that names the
reason it failed, so that I can act on the exit code without reading back through the whole log.

Today `check_installation` prints `fail "${build_auth_line}"` at `:251` when build auth is bad, but
the terminal `return 2` at `:292-294` fires **before** the summary block. When build auth is the
only problem, the run ends with no summary line at all and nothing connects exit 2 to build auth.

### Acceptance Criteria

#### Happy Path
- Given `conduct-ts build-auth-status` exits non-zero and every other check is clean, when the
  operator runs `bin/install --check`, then a terminal summary line naming build authentication as
  the failing check is printed before the command exits, and the exit code is still 2.
- Given every check including build auth is clean, when the operator runs `bin/install --check`,
  then `All checks passed.` is printed and the exit code is 0 (unchanged from today).
- Given install drift **and** a build-auth failure are both present, when the operator runs
  `bin/install --check`, then the drift summary lines print and the exit code is 1, preserving the
  existing precedence in which install drift outranks build auth.

#### Negative Paths
- Given `conduct-ts` is absent from `PATH` entirely, when the operator runs `bin/install --check`,
  then the run warns that the build-auth check was skipped, prints its normal summary, and does not
  exit 2 on account of a check it never performed.

### Done When
- [ ] Running the real `bin/install --check` against a stub `conduct-ts` that exits non-zero prints
      a summary line naming build authentication, and `echo $?` reports 2.
- [ ] The same run's stdout contains a summary line after the last individual check line — the
      output does not end on a bare check result.
- [ ] `test/test_install_check_build_auth.sh` Cases 1-4 still pass unchanged.
- [ ] A new case asserts the summary line is present in the build-auth-only failure path.

---

## Story 2: `--providers` is discoverable in `--help`

**Requirement:** #1020 — bullet 3

As an operator, I want every flag `bin/install` accepts to appear in its help output, so that I can
discover `--providers` without reading the script.

`--providers` is parsed at `:1492` but the usage block at `:42-52` never mentions it.

### Acceptance Criteria

#### Happy Path
- Given the operator runs `bin/install --help`, when the usage block prints, then `--providers`
  appears with a one-line description stating it takes a comma-separated selection of Claude and/or
  Codex.
- Given the operator runs `bin/install -h`, when the usage block prints, then it is byte-identical
  to the `--help` output.

#### Negative Paths
- Given the operator runs `bin/install --providers` with no value, when argument parsing reaches
  `:1495`, then the existing failure message stating that `--providers` requires a comma-separated
  selection of Claude and/or Codex is emitted and the command exits non-zero — the help-text change
  does not alter validation behavior.

### Done When
- [ ] `bin/install --help | grep -- --providers` matches.
- [ ] The usage line at `:42` enumerating modes and the option list below it are mutually
      consistent — every flag the parser accepts is listed.
- [ ] `bin/install --providers` with no value still exits non-zero with the existing message.

---

## Story 3: Permission-write success reflects the write, not the cleanup

**Requirement:** #1020 — bullet 4

As an operator, I want `bin/install` to report the permission write's real outcome, so that a failed
write is never reported as success while hooks and permissions are silently absent.

`configure_permissions` reads `$?` at `:387` **after** `rm -f "$perms_file"` at `:385`, so it
captures the `rm`'s status. Because `rm -f` essentially always succeeds, the write is reported as
successful regardless. This also disables the caller's guard at `:1352`
(`configure_permissions ... || warn "incomplete — continuing"`), which can never fire — so the one
warning path that existed is suppressed too.

This is the highest-severity defect in the set: the failure is silent and leaves the operator with
an install that reports success while `settings.json` was never updated.

### Acceptance Criteria

#### Happy Path
- Given a well-formed `settings.json`, when `configure_permissions` runs, then the Python write's
  exit status is captured **before** the temp file is removed, the success line reports the added /
  already-set counts, and the function returns 0.
- Given a well-formed `settings.json`, when `configure_permissions` completes successfully, then the
  temp `$perms_file` no longer exists on disk — cleanup still happens, it is merely reordered
  relative to the status capture.

#### Negative Paths
- Given a malformed `settings.json` that makes the Python write exit non-zero, when
  `configure_permissions` runs, then the warning that permissions could not be configured
  automatically is emitted, the manual-remediation hint naming the settings file path is printed,
  the function returns non-zero, and the caller's `|| warn "Permissions configuration incomplete"`
  guard at `:1352` fires.
- Given the Python write exits non-zero, when `configure_permissions` returns, then the temp
  `$perms_file` is still removed — a failed write must not leak the temp file.

### Done When
- [ ] Running `configure_permissions` against a deliberately malformed `settings.json` produces the
      warning, and the function's return code is non-zero.
- [ ] The same run leaves no `$perms_file` temp file behind.
- [ ] Running against a well-formed `settings.json` produces the success line with accurate counts
      and returns 0, and `settings.json` actually contains the harness permission entries afterward.
- [ ] A test asserts the caller-level `|| warn` at `:1352` fires on the failure path — proving the
      suppressed guard is restored, not just the inner status.

---

## Story 4: User-scoped config read/write is available from `conduct-ts config`

**Requirement:** #1020 — bullet 5 (enabling surface for the approved PyYAML removal)

As `bin/install`, I want to read and write the user-scoped harness config through `conduct-ts`, so
that shell code does not need its own YAML implementation.

`conduct-ts config` today exposes only `init`, which is **project**-scoped
(`.ai-conductor/config.yml`). The install paths need **user** scope
(`~/.ai-conductor/config.yml`). The engine already implements both directions —
`user-config.ts` exports `readUserConfig` (`:31`) and `writeUserConfig` (`:73`) over `js-yaml`, and
`types/config.ts` already types `markdown_viewer` (`:415`) and `mermaid_renderer` (`:417`) — so this
is a thin CLI wrapper over existing typed functions.

Per the operator-confirmed CLI shape, the new verbs are **siblings under the existing `config`
group**, not a new top-level command.

### Acceptance Criteria

#### Happy Path
- Given no `~/.ai-conductor/config.yml` exists, when the markdown-viewer section is written via the
  new user-scoped subcommand with preset, command, args and mode, then the file is created with
  those values under `markdown_viewer:` and the command exits 0.
- Given a `~/.ai-conductor/config.yml` that already contains unrelated top-level keys, when the
  mermaid-renderer section is written, then `mermaid_renderer:` is set and every pre-existing
  unrelated key is preserved byte-for-byte in the rewritten file.
- Given a config containing a `markdown_viewer.command` value, when it is read via the new
  user-scoped read subcommand, then that value is printed on stdout and the command exits 0.
- Given the operator runs `conduct-ts config --help`, when the subcommand list prints, then the new
  user-scoped verbs appear alongside `init`, and their descriptions distinguish user scope from
  `init`'s project scope.

#### Negative Paths
- Given a `~/.ai-conductor/config.yml` whose contents are not parseable YAML, when a read is
  attempted, then the command exits non-zero with a message naming the config file path and the
  parse failure — it does not print an empty value that a caller would misread as "unset".
- Given a requested section or field is absent from an otherwise valid config, when a read is
  attempted, then an empty value is printed and the command exits 0, so callers can distinguish
  "absent" (exit 0, empty) from "broken" (non-zero).
- Given the config file's directory is not writable, when a write is attempted, then the command
  exits non-zero with a message naming the path, and any pre-existing config file is left unmodified
  — a failed write never truncates the existing config.

### Done When
- [ ] `conduct-ts config --help` lists the new user-scoped subcommands next to `init`.
- [ ] Writing each of `markdown_viewer` and `mermaid_renderer` into a temp `HOME` produces a config
      whose parsed contents match the values passed.
- [ ] A write into a config holding unrelated keys preserves those keys — asserted by parsing the
      result, not by string match.
- [ ] Reading an absent field exits 0 with empty output; reading from malformed YAML exits non-zero
      with the path in the message.
- [ ] The subcommands call `readUserConfig` / `writeUserConfig` — no second YAML implementation is
      introduced.

---

## Story 5: `bin/install` configures the viewer and renderer without PyYAML

**Requirement:** #1020 — bullet 5

As an operator on a machine without PyYAML, I want install's viewer and renderer configuration to
work, or to tell me exactly what is wrong, so that I am never left with a silent partial install.

PyYAML is an undeclared hard dependency at four sites: reads at `:262` and `:273-274`, writes at
`:706` and `:812`. The reads swallow failure with `2>/dev/null || true`, yielding an empty value the
caller misreports as "configured but not on PATH". The writes have no guard around `import yaml`, so
an `ImportError` exits non-zero into `|| warn "...incomplete — continuing"` (`:1374-1375`), which
never names PyYAML. Per the approved approach these four sites move to the Story 4 subcommands.

`build_conduct_ts` (`:1309`) runs **before** `configure_md_viewer` / `configure_mermaid_renderer`
(`:1374-1375`), so conduct-ts is available on the write path. It is invoked as `|| true` and can
legitimately skip (Node < 20.5, npm absent) — and the **read** path in `check_installation` runs in
`--check` mode where no build happens at all. Both cases must announce themselves.

### Acceptance Criteria

#### Happy Path
- Given conduct-ts is built and on `PATH`, when the operator completes the markdown-viewer prompt,
  then the selection is persisted to `~/.ai-conductor/config.yml` and a success line confirms it.
- Given conduct-ts is built and on `PATH`, when the operator completes the mermaid-renderer prompt,
  then the selection is persisted and a success line confirms it.
- Given a config with a configured markdown viewer whose command is on `PATH`, when the operator
  runs `bin/install --check`, then the existing `markdown viewer: <cmd> (artifact review)` success
  line is printed — output for the already-working case is unchanged.
- Given PyYAML is **not** installed and conduct-ts is available, when either configuration path
  runs, then it succeeds — PyYAML is no longer consulted by any install path.

#### Negative Paths
- Given conduct-ts failed to build or is not on `PATH`, when `configure_md_viewer` or
  `configure_mermaid_renderer` runs, then the emitted message explicitly names conduct-ts as the
  missing prerequisite and states the remediation, rather than the generic
  `...incomplete — continuing` warning. **This is the criterion that prevents reintroducing the
  silent swallow this work exists to remove.**
- Given conduct-ts is not on `PATH`, when `bin/install --check` reaches the viewer and renderer read
  sites, then it reports that the configured value could not be read because conduct-ts is
  unavailable — it does **not** claim the viewer is "not configured", which would be false.
- Given `~/.ai-conductor/config.yml` is malformed, when `bin/install --check` reads it, then the
  output names the config file as unreadable rather than silently degrading to "unset".
- Given no `python3` is on `PATH` at all, when the viewer and renderer configuration paths run, then
  they still succeed — no install path retains a Python dependency for YAML handling.

### Done When
- [ ] `grep -n "import yaml" bin/install` returns no matches.
- [ ] `grep -rn "yaml" bin/install` returns no Python-YAML invocation — any remaining hits are prose
      or unrelated.
- [ ] With a stub `conduct-ts` on `PATH`, completing the viewer prompt writes the expected
      `markdown_viewer` section to a temp-`HOME` config.
- [ ] With `conduct-ts` removed from `PATH`, both configuration paths emit a message containing
      "conduct-ts", and neither reports success.
- [ ] With `conduct-ts` removed from `PATH`, `bin/install --check` does not print "not configured"
      for a viewer that is in fact configured.
- [ ] The full install path completes on a machine with no PyYAML installed.

---

## Story 6: The stray root lockfile is removed

**Requirement:** #1020 — bullet 6

As a contributor, I want the repository root to contain no lockfile that describes nothing, so that
tooling and readers are not misled about where this repo's Node dependencies live.

The root `package-lock.json` declares `lockfileVersion: 3` with **zero** packages, has no
accompanying root `package.json`, and its `name` is a leaked feature slug
(`conductor-test-suite-leaks-a-real-pipeline-halt-in`). Every CI workflow and test references
`src/conductor/package-lock.json` instead; nothing references the root file. It is an artifact of a
stray `npm install` in a feature worktree.

### Acceptance Criteria

#### Happy Path
- Given the repository root, when the change lands, then `package-lock.json` no longer exists at the
  root.
- Given the repository root after removal, when `git status` runs, then the tree is clean — no
  tooling regenerates the file as a side effect of an ordinary build.

#### Negative Paths
- Given the root lockfile has been removed, when the full validation suite and the CI workflows run,
  then every job that resolves `cache-dependency-path: src/conductor/package-lock.json` still finds
  its lockfile and succeeds — removal of the root file affects no build.
- Given the root lockfile has been removed, when `bin/install` runs end to end, then it completes
  without attempting to read a root lockfile or `package.json`.

### Done When
- [ ] `test -e package-lock.json` at the repository root is false.
- [ ] `grep -rn "package-lock" .github/ test/ bin/ src/conductor/src/` yields only
      `src/conductor/package-lock.json` references.
- [ ] `test/test_harness_integrity.sh` passes.
- [ ] `cd src/conductor && npm ci && npm run build` succeeds, confirming the real lockfile is
      untouched.

---

## Out of scope for stories

Two land-gate deliverables travel with this work but are deliberately **not** stories, per the
stories skill's documentation boundary (no stories for ordinary documentation, and documentation
accompanying functional work is omitted rather than split out). Both are carried as plan tasks:

- `docs/reference/cli.md` updated for the Story 4 subcommands (Documentation Upkeep rule).
- `.docs/release-waivers/install-and-first-run-paths-give-misleading-or-mis.md` naming the canonical
  surface `bin/conduct CLI`. Story 4's addition is purely additive, so a migration block would be
  empty — per `adr-2026-07-06-migration-gate-waiver` that is the waiver case, not an invented
  migration.

A sixth defect from #1020 — `config.ts` naming `bin/migrate` as the remediation for a missing config
— was verified already fixed at `config.ts:182` (now `Run conduct-ts config init to create it.`) and
is out of scope by operator decision.
