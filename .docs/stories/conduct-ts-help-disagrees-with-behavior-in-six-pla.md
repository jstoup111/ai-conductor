**Status:** Accepted

# Stories: CLI help matches CLI behavior (jstoup111/ai-conductor#1012)

Technical track. Governing decision: `adr-2026-10-14-commander-program-is-the-cli-catalog`
(Decisions 1-5). Scope boundary: `.docs/track/conduct-ts-help-disagrees-with-behavior-in-six-pla.md`.

## Story 1: Compose land and handoff help describe what each command does

**Requirement:** Issue #1012 item 1; ADR Decision 1

As an operator, I want `compose land` and `compose handoff` help to state what each one actually does, so that I know whether a spec is only committed locally or pushed with a PR open.

### Acceptance Criteria

#### Happy Path
- Given the compose help reference, when the operator runs `ai-conductor compose land --help`, then the text says land commits the authored `.docs/` set on the spec branch inside the worktree and does not say it pushes or opens a PR.
- Given the compose help reference, when the operator runs `ai-conductor compose handoff --help`, then the text says handoff pushes the spec branch, opens the spec PR or marks an existing draft spec PR ready for review (or records the local-commit fallback), and nudges the daemon.
- Given the compose help reference, when the operator runs `ai-conductor compose worktree --help`, then the flags line lists `--body` alongside `--project`, `--idea`, and `--source-ref`.

#### Negative Paths
- Given the corrected land help, when a test reads the land help text, then it fails if the text contains "push" or "opens a PR".
- Given the corrected handoff help, when a test reads the handoff help text, then it fails if the text omits the push or the PR.
- Given `compose worktree --body <text>` is still accepted by the worktree parser, when a test compares the parser's accepted flags with the flags named in the worktree help, then any accepted flag missing from the help fails the test.

### Done When
- [ ] `compose land --help` output names a commit inside the worktree and contains neither "push" nor "opens a PR".
- [ ] `compose handoff --help` output names the push, opening the spec PR, and marking an existing draft spec PR ready.
- [ ] `compose worktree --help` output names `--body`.

## Story 2: Declared defaults equal the runtime defaults

**Requirement:** Issue #1012 item 2; ADR Decision 4

As an operator, I want each flag's help-declared default to be the value the CLI actually uses when the flag is absent, so that help predicts behavior.

### Acceptance Criteria

#### Happy Path
- Given `ai-conductor daemon --help`, when the operator reads the `--idle-poll` line, then the shown default is 60.
- Given `ai-conductor daemon` started without `--idle-poll`, when the daemon idles in continuous mode, then it waits 60 seconds between polls, matching the declared default.
- Given every flag whose runtime fallback is supplied outside commander, when the defaults parity test runs, then each declared default equals its runtime fallback.

#### Negative Paths
- Given a future change sets the runtime `--idle-poll` fallback to a value other than the declared default, when the defaults parity test runs, then it fails naming `--idle-poll` and both values.
- Given `--idle-poll 5` passed explicitly, when the daemon idles, then it waits 5 seconds and the declared default does not override the explicit value.
- Given a flag declared with no default, when the parity test runs, then it does not report that flag as a mismatch.

### Done When
- [ ] `daemon --help` shows `(default: "60")` for `--idle-poll`.
- [ ] One exported constant supplies both the declared and the runtime `--idle-poll` default.
- [ ] A parity test fails when that constant and the runtime fallback diverge.

## Story 3: Operator-facing commands appear in help

**Requirement:** Issue #1012 item 3; ADR Decision 1

As an operator, I want every command the repository's rules tell me to run to appear in `ai-conductor --help`, so that I can find it without already knowing it exists.

### Acceptance Criteria

#### Happy Path
- Given `ai-conductor --help`, when the operator reads the command list, then it includes `shipped-record`, `kpi`, `memory`, `brain`, `intake-loop`, `render-diagrams`, `build-auth-status`, and `shipment-evidence`, each with a one-line description.
- Given `ai-conductor --help`, when the operator reads the full reference, then each of those commands has its own section listing its declared flags.
- Given `ai-conductor --help`, when the operator reads the `memory` section, then it lists the `setup` subcommand.

#### Negative Paths
- Given one of those eight commands is removed from the visible catalog, when the help listing test runs, then it fails naming the missing command.
- Given a visible command is listed, when its existing dispatch behavior is exercised without `--help`, then it behaves exactly as before this change (same exit code and output).
- Given commands that were already visible before this change, such as `kickback-budget` and `build-tail`, when help renders, then they remain visible.

### Done When
- [ ] `ai-conductor --help` lists all eight commands named above.
- [ ] `shipped-record` and `kpi` appear in the top-level command list, not only in a sub-reference.
- [ ] Existing dispatch tests for these commands pass unchanged.

## Story 4: Engine-internal commands are declared hidden

**Requirement:** Issue #1012 item 3; ADR Decisions 1 and 5

As an operator, I want engine-internal commands kept out of help while still being explicitly declared as internal, so that help stays readable and nothing is undeclared.

### Acceptance Criteria

#### Happy Path
- Given `test-suite`, `finish-record`, `manual-test-record`, and `derive-feedback`, when the CLI catalog is built, then each is declared and marked hidden.
- Given any other intercepted command that was undeclared before this change and is not one of the operator-facing commands `shipped-record`, `kpi`, `memory`, `brain`, `intake-loop`, `render-diagrams`, `build-auth-status`, or `shipment-evidence` from Story 3, when the CLI catalog is built, then it is declared and marked hidden.
- Given a hidden command, when the operator runs `ai-conductor --help`, then the command appears neither in the command list nor as a full-reference section.

#### Negative Paths
- Given a hidden command, when the operator runs `ai-conductor <hidden-command> --help`, then its own help prints and the command does not execute.
- Given a hidden command, when it is invoked without `--help` by the engine or a hook, then it dispatches exactly as before this change.
- Given every verb the daemon supervisor dispatcher accepts, when `daemon --help` renders after this change, then each verb still appears as a declared subcommand in the daemon help output and none is hidden.

### Done When
- [ ] The four named commands are declared hidden in the CLI catalog.
- [ ] `ai-conductor --help` output contains none of the hidden command names.
- [ ] Hidden commands still dispatch; their existing tests pass unchanged.

## Story 5: Real flags are declared

**Requirement:** Issue #1012 item 4; ADR Decision 1

As an operator, I want every flag the CLI accepts to be shown in that command's help, so that I can use flags without reading source.

### Acceptance Criteria

#### Happy Path
- Given `ai-conductor daemon --help`, when the operator reads the run flags, then `--no-watch`, `--completed`, and `--all` are listed, and `--all` is described as including completed features.
- Given `ai-conductor daemon logs --help`, when the operator reads its flags, then `-f`/`--follow`, `-n`/`--lines <n>`, `--repo <path>` (also accepted as `--repo=<path>`), and `--all` are listed.
- Given `ai-conductor daemon pause --help`, `resume --help`, or `restart --help`, when the operator reads the usage, then it shows the fleet selectors: `--all`, described as acting on every registered repo, and optional bare repo names selecting a named subset.

#### Negative Paths
- Given `daemon logs -n 50`, when it runs, then it behaves as `--lines 50` did before this change.
- Given `daemon restart` with no selector, when it runs, then it selects the same target it selected before this change.
- Given a daemon run flag that is not declared, when the declared-flags test compares the daemon run parser's accepted flags with the commander declaration, then the test fails naming the undeclared flag.

### Done When
- [ ] `daemon --help` lists `--no-watch`, `--completed`, and `--all`.
- [ ] `daemon logs --help` lists `-f`, `-n`/`--lines`, `--repo`, and `--all`.
- [ ] `daemon pause`, `daemon resume`, and `daemon restart` help usage each shows `[repos...]` and `--all`.

## Story 6: The --auto and --interactive exclusion is documented

**Requirement:** Issue #1012 item 5

As an operator, I want help to state that `--auto` and `--interactive` cannot be combined, so that I learn it before the run fails.

### Acceptance Criteria

#### Happy Path
- Given `ai-conductor --help`, when the operator reads the `--auto` line, then it states that `--auto` is rejected in favor of the daemon and cannot be combined with `--interactive`.
- Given `ai-conductor --help`, when the operator reads the `--interactive` line, then it keeps its existing REPL-mode description and adds that it cannot be combined with `--auto`.
- Given `ai-conductor inline --help`, when the operator reads the same flags, then each states the same exclusion.

#### Negative Paths
- Given both flags passed together, when the CLI runs, then it still exits 1 with `Error: --auto and --interactive are mutually exclusive`.
- Given `--auto` alone, when the CLI runs, then it still exits non-zero with the existing daemon rejection and prints no mutual-exclusion error.
- Given `--interactive` alone with a feature, when the CLI runs, then no mutual-exclusion error is printed.

### Done When
- [ ] Both flag descriptions in root and `inline` help name the exclusion.
- [ ] The combined invocation still exits 1 with the existing error message.

## Story 7: Per-command --help prints that command's help without executing it

**Requirement:** Issue #1012 item 6; ADR Decision 2

As an operator, I want `ai-conductor <command> --help` to print that command's own help, so that asking for help never runs the command.

### Acceptance Criteria

#### Happy Path
- Given any directory, including one that is not a git repository, when the operator runs `ai-conductor register --help`, then `register`'s own usage prints, the process exits 0, and the registry file is unchanged.
- Given any directory, when the operator runs `ai-conductor create --help`, then `create`'s own usage prints (not the root help), the process exits 0, and no directory is created.
- Given a nested declared command such as `memory setup`, when the operator runs `ai-conductor memory setup --help`, then `memory setup`'s own usage prints and exits 0.
- Given `-h` in place of `--help`, when any of the above runs, then the same output and exit code result.

#### Negative Paths
- Given `ai-conductor register --help` in `/tmp`, when it runs, then the output does not contain `not a git repository`.
- Given `ai-conductor compose land --help`, when it runs, then compose's existing per-subcommand help prints, unchanged by the router.
- Given `ai-conductor daemon logs --help`, when it runs, then the existing daemon help subtree prints, unchanged by the router.
- Given `ai-conductor halt-issues sweep --help`, when it runs, then halt-issues' existing help prints, unchanged by the router.
- Given `ai-conductor update --help`, when it runs, then `--help` is passed through to `bin/update` and its full usage prints, unchanged by the router.
- Given an undeclared token such as `ai-conductor no-such-command --help`, when it runs, then the root full help prints as before this change.

### Done When
- [ ] `register --help` and `create --help` print their own usage, exit 0, and cause no side effects.
- [ ] Every declared top-level command answers `--help` and `-h` with its own help.
- [ ] The comment above the top-level help branch in `index.ts` describes the new routing accurately.

## Story 8: Undeclared intercepts fail the build

**Requirement:** Issue #1012 desired outcome (drift guard); ADR Decision 3

As a harness maintainer, I want adding a pre-dispatched command without declaring it to fail a test, so that help cannot silently drift from dispatch again.

### Acceptance Criteria

#### Happy Path
- Given the current intercept chain in the CLI dispatch entry, when the catalog coverage test runs, then every intercept detector maps to a top-level command declared in the CLI catalog and the test passes.
- Given the pre-dispatch registry, when the help router handles `--help`, then it resolves commands from that same registry.

#### Negative Paths
- Given a new intercept detector call is added to the CLI dispatch entry with no registry entry, when the coverage test runs, then it fails naming the detector.
- Given a registry entry whose command is not declared in the CLI catalog, when the coverage test runs, then it fails naming the command.
- Given a registry entry whose detector is no longer called by the CLI dispatch entry, when the coverage test runs, then it fails naming the stale entry.

### Done When
- [ ] A coverage test asserts set equality between intercept detectors called by the CLI dispatch entry and registry entries.
- [ ] The same test asserts every registry command is declared in the CLI catalog.
- [ ] The help router imports the registry in production code.
