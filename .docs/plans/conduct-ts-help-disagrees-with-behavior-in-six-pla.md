# Implementation Plan: CLI help matches CLI behavior

**Date:** 2026-10-14
**Stories:** .docs/stories/conduct-ts-help-disagrees-with-behavior-in-six-pla.md
**Conflict check:** Clean as of 2026-10-14

## Summary

Eleven tasks make `ai-conductor --help` describe what the CLI actually does for jstoup111/ai-conductor#1012: correct compose help text, one source for the `--idle-poll` default, every pre-dispatched command declared in commander (visible or hidden), real flags declared, the `--auto`/`--interactive` exclusion stated, a per-command help router, and a coverage test that fails on undeclared intercepts.

## Technical Approach

- Governing decision: `adr-2026-10-14-commander-program-is-the-cli-catalog` D1-D5; review: `.docs/decisions/architecture-review-2026-10-14-conduct-ts-help-disagrees-with-behavior-in-six-pla.md`.
- The intercept chain is every `detect«Name»Command(...)` call made by `dispatchNonDispatchingCliCommand` and `dispatchCliCommand` in `src/conductor/src/index.ts`, plus `detectVersionCommand` and `monitorCli.detectMonitorCommand`. Dispatch logic in those blocks does not change.
- New module `src/conductor/src/cli-pre-dispatch.ts` exports `PRE_DISPATCH_COMMANDS`: one entry per detector identifier, carrying its top-level command path (for example `['memory', 'setup']`) and a help owner: `router`, `self` (`engineer`, `halt-issues`, `daemon`), or `passthrough` (`update`). It also exports `routeSubcommandHelp(argv, program)`, which returns the commander `helpInformation()` of the deepest declared command path named by argv when argv carries `--help` or `-h` and the entry's owner is `router`, and `null` otherwise.
- Local pattern (per-command help from commander): the existing `config --help` branch in `dispatchCliCommand` (search `command.name() === 'config'`) finds the declared command in `createProgram().commands` and writes its `helpInformation()`. Preserve that help text comes from the commander declaration, never a hand-written string; the allowed variation is one generic router over the registry and nested paths.
- `routeSubcommandHelp` is called first in `dispatchCliCommand`, before `dispatchNonDispatchingCliCommand`, so `register --help` never reaches `detectRegistryCommand`.
- Coverage test completeness mechanism: the test reads `src/conductor/src/index.ts` source text, collects every identifier matching `detect[A-Za-z]+Command(` inside the bodies of `dispatchNonDispatchingCliCommand` and `dispatchCliCommand`, and asserts set equality with the registry's detector identifiers (ADR assumption A3).
- New module `src/conductor/src/cli-defaults.ts` exports `DEFAULT_IDLE_POLL_SECONDS = 60`, used by the `--idle-poll` declaration in `cli.ts` and by `intFlag(argv, '--idle-poll', …)` in `engine/daemon-command.ts`.
- `renderFullHelp` and `renderDaemonHelp` skip commands whose `_hidden` is set (commander 15, `lib/command.js`).
- Declarations never add an `.action()` and never invent a `--names` flag (accepted story `expose-daemon-pause-resume-verbs`); all daemon verbs stay visible so `test/daemon-help-verb-drift.test.ts` keeps passing.
- `--auto` and `--interactive` are declared once in `applyPipelineOptions` in `cli.ts`, which both the root program and `inline` use, so one description edit covers both help surfaces.

## Prerequisites

- None.

## Tasks

### Task 1: Pre-dispatch registry and detector set-equality test
**Story:** 8
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/cli/pre-dispatch-registry.test.ts`: (a) the set of `detect[A-Za-z]+Command(` identifiers in the bodies of `dispatchNonDispatchingCliCommand` and `dispatchCliCommand` in `src/conductor/src/index.ts` equals the set of `PRE_DISPATCH_COMMANDS` detector identifiers; (b) a fixture source string with one extra detector call fails the comparison naming that detector; (c) a fixture registry with an entry whose detector is not called fails naming the stale entry.
2. Verify they fail (RED): the module does not exist.
3. Implement `src/conductor/src/cli-pre-dispatch.ts` exporting `PRE_DISPATCH_COMMANDS` (detector identifier, command path, help owner) and a pure `diffDetectorSets(sourceText, registry)` returning `{ unregistered, stale }`, used by the test. Owners: `engineer` (command path `['engineer']`, the name commander declares; its router-match tokens are `engineer` and the alias `compose`), `halt-issues`, and `daemon` (answered by the existing `renderDaemonHelp` branch) are `self`, `update` is `passthrough`, all others `router`.
4. Verify they pass (GREEN).
5. Commit: "feat(cli): pre-dispatch command registry"

**Done when:**
- [test] `diffDetectorSets` over the real `src/conductor/src/index.ts` returns empty `unregistered` and `stale` sets for `PRE_DISPATCH_COMMANDS`, as asserted by the live-source registry test.
- [test] `diffDetectorSets` returns `unregistered` naming `detectExtraCommand` for a fixture source that adds a `detectExtraCommand(process.argv)` call, and the registry test fails naming that detector.
- [test] `diffDetectorSets` returns `stale` naming the entry for a fixture registry entry whose detector the source never calls, and the registry test fails naming that stale entry.
- `PRE_DISPATCH_COMMANDS` assigns help owner `self` to `engineer`, `halt-issues`, and `daemon`, `passthrough` to `update`, and `router` to every other entry.

**Files:** `src/conductor/src/cli-pre-dispatch.ts`, `src/conductor/test/cli/pre-dispatch-registry.test.ts`

### Task 2: Declare operator-facing commands as visible
**Story:** 3
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/cli/index.test.ts`: `renderCanonicalFullHelp()` top-level command list contains `shipped-record`, `kpi`, `memory`, `brain`, `intake-loop`, `render-diagrams`, `build-auth-status`, and `shipment-evidence`, each with a non-empty one-line description; each has a full-reference section listing its declared flags; the `memory` section lists `setup`; `kickback-budget` and `build-tail` remain in the top-level list; removing any one of the eight from a fixture program makes the listing assertion fail naming it.
2. Verify they fail (RED).
3. Implement in `createProgram()` in `src/conductor/src/cli.ts`: declare the eight commands with descriptions and the flags their detectors accept (`memory` with a `setup [dir]` subcommand). No `.action()`. Update existing help snapshot assertions in the same commit.
4. Verify they pass (GREEN), and the existing dispatch tests for these eight commands pass unchanged.
5. Commit: "feat(cli): list operator-facing commands in help"

**Done when:**
- [test] `renderCanonicalFullHelp()` top-level command list includes `shipped-record`, `kpi`, `memory`, `brain`, `intake-loop`, `render-diagrams`, `build-auth-status`, and `shipment-evidence`, each with a non-empty description, as asserted by the visible-commands help test.
- [test] `renderCanonicalFullHelp()` has a full-reference section for each of the eight commands listing its declared flags, and the `memory` section lists the `setup` subcommand, as asserted by the full-reference section test.
- [test] The visible-commands listing check fails naming the missing command for a fixture program lacking one of the eight, as asserted by the missing-command fixture test.
- [test] `kickback-budget` and `build-tail` remain in the `renderCanonicalFullHelp()` top-level command list, as asserted by the previously-visible commands test.
- Existing dispatch tests for the eight commands pass with no edits to their assertions (same exit codes and output).

**Files:** `src/conductor/src/cli.ts`, `src/conductor/test/cli/index.test.ts`

### Task 3: Declare engine-internal commands hidden and skip hidden commands in full help
**Story:** 4
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in `src/conductor/test/cli/index.test.ts`: in `createProgram()`, `test-suite`, `finish-record`, `manual-test-record`, and `derive-feedback` are declared with `_hidden === true`; every `PRE_DISPATCH_COMMANDS` top-level command that was undeclared before this change, other than the eight Task 2 operator-facing commands, is declared hidden; `renderCanonicalFullHelp()` contains none of the hidden names in its command list or as section headings; `renderDaemonHelp()` still lists every verb in the daemon supervisor dispatcher's accepted verb set and none of them is hidden.
2. Verify they fail (RED).
3. Implement: declare those commands with `{ hidden: true }` and no `.action()`; in `renderFullHelp` and `renderDaemonHelp` skip any `sub` whose `_hidden` is true.
4. Verify they pass (GREEN), plus `src/conductor/test/daemon-help-verb-drift.test.ts` and the existing dispatch tests for the hidden commands pass unchanged.
5. Commit: "feat(cli): declare internal commands hidden"

**Done when:**
- [test] `createProgram()` declares `test-suite`, `finish-record`, `manual-test-record`, and `derive-feedback` with commander hidden set, as asserted by the internal-commands-hidden test.
- [test] Every `PRE_DISPATCH_COMMANDS` top-level command not declared on main before this change, other than the eight Task 2 operator-facing commands, is declared in `createProgram()` with commander hidden set, and those eight are not hidden, as asserted by the newly-declared-hidden test.
- [test] `renderFullHelp` skips hidden commands so `renderCanonicalFullHelp()` contains no hidden command name in its command list and no full-reference section for one, as asserted by the hidden-absent-from-help test.
- [test] `renderDaemonHelp()` lists every verb in the daemon supervisor dispatcher's accepted verb set with none hidden, as asserted by `daemon-help-verb-drift.test.ts` passing unchanged.
- Existing dispatch tests for the hidden commands pass with no edits to their assertions, showing each still dispatches without `--help`.

**Files:** `src/conductor/src/cli.ts`, `src/conductor/test/cli/index.test.ts`

### Task 4: Registry commands must be declared in the CLI catalog
**Story:** 8
**Type:** negative-path
**Dependencies:** Tasks 1, 2, 3

**Steps:**
1. Write failing tests in `src/conductor/test/cli/pre-dispatch-registry.test.ts`: every `PRE_DISPATCH_COMMANDS` command path resolves to a declared command in `createProgram()` (visible or hidden); a fixture registry entry naming an undeclared command fails naming that command.
2. Verify the fixture case fails (RED) before the resolver exists.
3. Implement `undeclaredRegistryCommands(registry, program)` in `src/conductor/src/cli-pre-dispatch.ts`, walking command paths through `program.commands`.
4. Verify they pass (GREEN).
5. Commit: "test(cli): registry commands are declared"

**Done when:**
- [test] `undeclaredRegistryCommands(PRE_DISPATCH_COMMANDS, createProgram())` returns an empty list, as asserted by the live catalog coverage test.
- [test] `undeclaredRegistryCommands` returns the command name for a fixture entry naming an undeclared command, and the coverage test fails naming that command.

**Files:** `src/conductor/src/cli-pre-dispatch.ts`, `src/conductor/test/cli/pre-dispatch-registry.test.ts`

### Task 5: Route per-command --help to commander before the intercept chain
**Story:** 7
**Type:** happy-path
**Dependencies:** Tasks 1, 2, 3

**Steps:**
1. Write failing tests in `src/conductor/test/cli/help-router.test.ts`: `routeSubcommandHelp` returns `register`'s commander usage for `[node, bin, 'register', '--help']` and for `-h`; returns `create`'s own usage (not root help) for `create --help`; returns `memory setup`'s usage for `memory setup --help`; returns a hidden command's own help for `finish-record --help`, and through the dispatch entry with a mocked finish-record handler, `finish-record --help` writes that help and never calls the handler; `routeSubcommandHelp` finds command paths only through `PRE_DISPATCH_COMMANDS` (a fixture registry without `register` yields `null` for `register --help`). Add a subprocess test running the built CLI with `register --help` in a temporary non-git directory under a temporary `HOME`: exit 0, stdout contains `register`'s usage, output lacks `not a git repository`, the registry file `~/.ai-conductor/registry.json` is byte-identical before and after (or still absent); and `create --help` in a temporary directory: exit 0, no new directory created.
2. Verify they fail (RED).
3. Implement `routeSubcommandHelp` in `src/conductor/src/cli-pre-dispatch.ts` using the registry to find the command path and `createProgram()` to render it, following the local `config --help` pattern: help text comes from the commander declaration's `helpInformation()`. Call it at the start of `dispatchCliCommand` in `src/conductor/src/index.ts`, ahead of `dispatchNonDispatchingCliCommand`; on a non-null result write it to stdout and set exit code 0. Rewrite the comment above the top-level `--help` branch to say per-command help is answered by `routeSubcommandHelp` at the start of `dispatchCliCommand`, with `engineer`, `halt-issues`, `daemon`, and `update` owning their own help.
4. Verify they pass (GREEN).
5. Commit: "feat(cli): per-command --help prints that command's help"

**Done when:**
- [test] Running the CLI entry with `register --help` in a non-git temporary directory exits 0, prints `register`'s commander usage without `not a git repository`, and leaves the registry file byte-identical (or absent), as asserted by the register-help subprocess test.
- [test] Running the CLI entry with `create --help` exits 0, prints `create`'s own usage rather than root help, and creates no directory, as asserted by the create-help subprocess test.
- [test] `routeSubcommandHelp` resolves command paths only from `PRE_DISPATCH_COMMANDS` (returning `null` for `register --help` under a fixture registry lacking `register`); through the dispatch entry `memory setup --help` writes `memory setup`'s own usage and exits 0, and `-h` yields the same output and exit code as `--help` for `register`, `create`, and `memory setup`, as asserted by the router tests.
- [test] Through the dispatch entry, `finish-record --help` writes `finish-record`'s own help and the mocked finish-record handler is never called, as asserted by the hidden-command help test.
- `dispatchCliCommand` calls `routeSubcommandHelp` before `dispatchNonDispatchingCliCommand`, and the comment above the top-level help branch names `routeSubcommandHelp` as the per-command help path.

**Files:** `src/conductor/src/cli-pre-dispatch.ts`, `src/conductor/src/index.ts`, `src/conductor/test/cli/help-router.test.ts`

### Task 6: Router leaves self-owned, pass-through, and unknown commands alone
**Story:** 7
**Type:** negative-path
**Dependencies:** Task 5

**Steps:**
1. Write failing tests in `src/conductor/test/cli/help-router.test.ts`: `routeSubcommandHelp` returns `null` for `compose land --help`, `engineer land --help`, `daemon logs --help`, `halt-issues sweep --help`, `update --help`, and `no-such-command --help`. Through the dispatch entry with mocked handlers: `compose land --help` reaches the engineer help path; `halt-issues sweep --help` writes the halt-issues CLI's existing help text unchanged; `update --help` runs the resolved `bin/update` with args `['--help']` (its `-h|--help` branch only prints usage) and stdout contains its usage including `--set-channel`; `no-such-command --help` writes `renderCanonicalFullHelp()` output.
2. Verify they fail (RED) where the router over-matches.
3. Implement: in `routeSubcommandHelp`, return `null` when the matched entry's owner is `self` or `passthrough`, or when argv[2] matches no registry entry.
4. Verify they pass (GREEN).
5. Commit: "feat(cli): help router exemptions"

**Done when:**
- [test] `routeSubcommandHelp` returns `null` for `compose land --help` and for `daemon logs --help`, and the dispatch entry prints compose's existing land help and the existing `renderDaemonHelp()` subtree respectively, as asserted by the self-owned exemption tests.
- [test] `routeSubcommandHelp` returns `null` for `halt-issues sweep --help` and the dispatch entry writes the halt-issues CLI's existing help text, byte-identical to its pre-change output, as asserted by the halt-issues-exemption test.
- [test] `routeSubcommandHelp` returns `null` for `update --help`, and the dispatch entry runs the resolved `bin/update` with args exactly `['--help']` and its stdout contains `bin/update`'s full usage including `--set-channel`, as asserted by the update pass-through test.
- [test] `routeSubcommandHelp` returns `null` for `no-such-command --help` and the dispatch entry writes `renderCanonicalFullHelp()` output, as asserted by the unknown-command test.

**Files:** `src/conductor/src/cli-pre-dispatch.ts`, `src/conductor/test/cli/help-router.test.ts`

### Task 7: Correct compose land, handoff, and worktree help
**Story:** 1
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/cli-engineer.test.ts`: `SUBCOMMAND_HELP.land` names committing the authored `.docs/` set on the spec branch inside the worktree and contains neither `push` nor `opens a PR`/`open the spec PR`; `SUBCOMMAND_HELP.handoff` names pushing the spec branch, opening the spec PR, marking an existing draft spec PR ready for review, the local-commit fallback, and the daemon nudge; every flag in the exported `WORKTREE_ACCEPTED_FLAGS` appears in `SUBCOMMAND_HELP.worktree`; a fixture help string missing `--body` fails that comparison naming `--body`.
2. Verify they fail (RED).
3. Implement in `src/conductor/src/engine/engineer-cli.ts`: export `WORKTREE_ACCEPTED_FLAGS = ['--project', '--idea', '--source-ref', '--body']` and pass it to `findUnknownFlag` in the worktree arm; rewrite the `land` and `handoff` usage, description, and `Mutates:` lines; add `--body` to the worktree flags line.
4. Verify they pass (GREEN).
5. Commit: "fix(compose): land help no longer claims push and PR"

**Done when:**
- [test] `SUBCOMMAND_HELP.land` names a commit of the authored `.docs/` set on the spec branch inside the worktree and contains neither `push` nor `opens a PR`, as asserted by the land-help text test.
- [test] `SUBCOMMAND_HELP.handoff` names pushing the spec branch, opening the spec PR, marking an existing draft spec PR ready for review, the local-commit fallback, and nudging the daemon, as asserted by the handoff-help text test.
- [test] The `Flags:` line of `SUBCOMMAND_HELP.worktree` lists `--project`, `--idea`, `--source-ref`, and `--body`, every flag in `WORKTREE_ACCEPTED_FLAGS` appears on it, and a fixture help string lacking `--body` fails the comparison naming `--body`, as asserted by the worktree flag-parity test.
- The worktree arm of `detectEngineerCommand` passes `WORKTREE_ACCEPTED_FLAGS` to `findUnknownFlag`.

**Files:** `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/test/cli-engineer.test.ts`

### Task 8: One source for the --idle-poll default
**Story:** 2
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/cli/cli-defaults-parity.test.ts`: for each entry of the exported `RUNTIME_FALLBACK_FLAGS` table, the commander `daemon` option's `defaultValue` equals `String(entry.value)`; `detectDaemonCommand(['node','bin','daemon'])` returns `idlePollSeconds` equal to `DEFAULT_IDLE_POLL_SECONDS` (60); `renderDaemonHelp()` shows `(default: "60")` on the `--idle-poll` line; `detectDaemonCommand` with `--idle-poll 5` returns 5 and `buildDaemonModeOptions` then carries `idlePollSeconds` 5; `buildDaemonModeOptions` for a flagless `daemon` command returns options carrying `idlePollSeconds` 60, the value `runDaemonMode` converts to `idlePollMs` (seconds × 1000); the parity check over a fixture table where declared and runtime values differ fails naming `--idle-poll` and both values; a declared flag with no default (`--max-idle-polls`) is not reported.
2. Verify they fail (RED).
3. Implement `src/conductor/src/cli-defaults.ts` exporting `DEFAULT_IDLE_POLL_SECONDS = 60`, `RUNTIME_FALLBACK_FLAGS = [{ flag: '--idle-poll', value: DEFAULT_IDLE_POLL_SECONDS }]`, and `defaultMismatches(table, command)`. Use the constant in the `--idle-poll` declaration in `src/conductor/src/cli.ts` and in `intFlag(argv, '--idle-poll', …)` in `src/conductor/src/engine/daemon-command.ts`.
4. Verify they pass (GREEN).
5. Commit: "fix(daemon): --idle-poll declared default matches runtime"

**Done when:**
- [test] `renderDaemonHelp()` shows `(default: "60")` on the `--idle-poll` line, and for a flagless `daemon` command `detectDaemonCommand` returns `idlePollSeconds` 60 and `buildDaemonModeOptions` passes `idlePollSeconds` 60 into the `runDaemonMode` options, so the idle wait is 60 seconds, as asserted by the idle-poll default test.
- [test] `detectDaemonCommand` with `--idle-poll 5` returns `idlePollSeconds` 5 and `buildDaemonModeOptions` passes `idlePollSeconds` 5 into the `runDaemonMode` options, so the idle wait is 5 seconds and the declared default does not override it, as asserted by the explicit-value test.
- [test] `defaultMismatches` returns no mismatch for the live `RUNTIME_FALLBACK_FLAGS` table, reports `--idle-poll` with both values for a fixture whose values differ, and does not report `--max-idle-polls`, a flag declared with no default, as asserted by the parity tests.
- `DEFAULT_IDLE_POLL_SECONDS` is the only source of the `--idle-poll` default in both `cli.ts` and `daemon-command.ts`; neither file contains a literal `'5'` or `60` for that flag.

**Files:** `src/conductor/src/cli-defaults.ts`, `src/conductor/src/cli.ts`, `src/conductor/src/engine/daemon-command.ts`, `src/conductor/test/cli/cli-defaults-parity.test.ts`

### Task 9: Declare daemon run flags with a parser parity check
**Story:** 5
**Type:** happy-path
**Dependencies:** Task 8

**Steps:**
1. Write failing tests in `src/conductor/test/cli/index.test.ts`: `renderDaemonHelp()` run-flag section lists `--no-watch`, `--completed`, and `--all`, and the `--all` description says it includes completed features; every flag in the exported `DAEMON_RUN_FLAGS` is declared on the commander `daemon` command; a fixture flag list with an undeclared flag fails naming it.
2. Verify they fail (RED).
3. Implement: in `src/conductor/src/engine/daemon-command.ts` export `DAEMON_RUN_FLAGS` (exactly the value flags and boolean flags `detectDaemonCommand` already iterates, so its collected operator flag args are unchanged) and iterate it there; declare `--no-watch`, `--completed`, and `--all` on `daemon` in `src/conductor/src/cli.ts`.
4. Verify they pass (GREEN).
5. Commit: "feat(daemon): declare --no-watch, --completed, --all"

**Done when:**
- [test] `renderDaemonHelp()` lists `--no-watch`, `--completed`, and `--all`, with `--all` described as including completed features, as asserted by the daemon run-flags help test.
- [test] Every flag in `DAEMON_RUN_FLAGS` is declared on the commander `daemon` command, and a fixture list with an undeclared flag fails naming that flag, as asserted by the run-flag parity test.
- `detectDaemonCommand` iterates `DAEMON_RUN_FLAGS` when collecting operator flag args.

**Files:** `src/conductor/src/engine/daemon-command.ts`, `src/conductor/src/cli.ts`, `src/conductor/test/cli/index.test.ts`

### Task 10: Declare daemon logs flags and fleet selectors
**Story:** 5
**Type:** happy-path
**Dependencies:** Task 9

**Steps:**
1. Write failing tests in `src/conductor/test/cli/index.test.ts`: `renderDaemonHelp()` `logs` section lists `-f, --follow`, `-n, --lines <n>`, `--repo <path>` with `--repo=<path>` named in its description, and `--all`; the `pause`, `resume`, and `restart` sections show `[repos...]` usage, describe bare repo names as selecting a named subset, and describe `--all` as acting on every registered repo; none of these commands has an action handler and no `--names` flag exists. Add parser tests: `detectDaemonObserveCommand` returns the same `lines` for `logs -n 50` and `logs --lines 50`; `detectDaemonSupervisorCommand` for `daemon restart` with no selector returns the same result object as before (no `names`, no `all`).
2. Verify they fail (RED) for the help assertions.
3. Implement declarations in `src/conductor/src/cli.ts`: short aliases `-f` and `-n, --lines <n>` on `logs`; `[repos...]` argument and `--all` option on `pause`, `resume`, and `restart`. No `.action()`.
4. Verify they pass (GREEN), and `daemon-help-verb-drift.test.ts` passes unchanged.
5. Commit: "feat(daemon): declare logs and fleet selector flags"

**Done when:**
- [test] `renderDaemonHelp()` `logs` section lists `-f, --follow`, `-n, --lines <n>`, `--repo <path>` naming the `--repo=<path>` form, and `--all`, as asserted by the logs-flags help test.
- [test] `renderDaemonHelp()` `pause`, `resume`, and `restart` sections each show `[repos...]` described as a named subset and `--all` described as every registered repo, as asserted by the fleet-selector help test.
- [test] `detectDaemonObserveCommand` yields `lines` 50 for both `-n 50` and `--lines 50`, the same value `--lines 50` yielded before this change, as asserted by the logs short-flag parser test.
- [test] `detectDaemonSupervisorCommand` for `daemon restart` with no selector returns a result with neither `names` nor `all`, matching the pre-change result, as asserted by the restart-default parser test.
- The `pause`, `resume`, `restart`, and `logs` declarations have no action handler and no command declares a `--names` option.

**Files:** `src/conductor/src/cli.ts`, `src/conductor/test/cli/index.test.ts`

### Task 11: State the --auto and --interactive exclusion in help
**Story:** 6
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests in `src/conductor/test/cli/mode-derivation.test.ts`: root help and `inline --help` (both rendered from `createProgram()`) show `--auto` described as rejected in favor of `ai-conductor daemon start` and not combinable with `--interactive`; `--interactive` keeps `REPL mode` in its description and adds that it cannot be combined with `--auto`; `deriveMode({auto:true, interactive:true})` still prints `Error: --auto and --interactive are mutually exclusive` and exits 1; `deriveMode({auto:true, interactive:false})` still exits non-zero with the daemon rejection and prints no mutual-exclusion error; `deriveMode({auto:false, interactive:true})` prints no mutual-exclusion error.
2. Verify the help assertions fail (RED).
3. Implement: edit the `--auto` and `--interactive` descriptions in `applyPipelineOptions` in `src/conductor/src/cli.ts`.
4. Verify they pass (GREEN).
5. Commit: "docs(cli): state --auto/--interactive exclusion in help"

**Done when:**
- [test] Root help and `inline` help both describe `--auto` as rejected in favor of the daemon and not combinable with `--interactive`, as asserted by the auto-flag help test.
- [test] Root help and `inline` help both keep the REPL-mode description of `--interactive` and add that it cannot be combined with `--auto`, as asserted by the interactive-flag help test.
- [test] `deriveMode` with both flags prints `Error: --auto and --interactive are mutually exclusive` and exits 1, as asserted by the existing exclusion test.
- [test] `deriveMode` with `--auto` alone exits non-zero with the daemon rejection and no mutual-exclusion error, and with `--interactive` alone prints no mutual-exclusion error, as asserted by the single-flag tests.

**Files:** `src/conductor/src/cli.ts`, `src/conductor/test/cli/mode-derivation.test.ts`

## Task Dependency Graph

```
Task 1 ──┬─> Task 3 ──┬─> Task 4
         │            └─> Task 5 ──> Task 6
Task 2 ──┴────────────┴─> (Tasks 4, 5)
Task 7 (independent)
Task 8 ──> Task 9 ──> Task 10
Task 11 (independent)
```

## Integration Points

- After Task 5: `ai-conductor register --help` and `create --help` print their own help end to end.
- After Task 10: `ai-conductor daemon --help` shows every real daemon flag.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the compose help reference, when the operator runs `ai-conductor compose land --help`, then the text says land commits the authored `.docs/` set on the spec branch inside the worktree and does not say it pushes or opens a PR. | 7 | "`SUBCOMMAND_HELP.land` names a commit of the authored `.docs/` set on the spec branch inside the worktree and contains neither `push` nor `opens a PR`" | diff-local |
| Story 1 happy: Given the compose help reference, when the operator runs `ai-conductor compose handoff --help`, then the text says handoff pushes the spec branch, opens the spec PR or marks an existing draft spec PR ready for review (or records the local-commit fallback), and nudges the daemon. | 7 | "`SUBCOMMAND_HELP.handoff` names pushing the spec branch, opening the spec PR, marking an existing draft spec PR ready for review, the local-commit fallback, and nudging the daemon" | diff-local |
| Story 1 happy: Given the compose help reference, when the operator runs `ai-conductor compose worktree --help`, then the flags line lists `--body` alongside `--project`, `--idea`, and `--source-ref`. | 7 | "The `Flags:` line of `SUBCOMMAND_HELP.worktree` lists `--project`, `--idea`, `--source-ref`, and `--body`" | diff-local |
| Story 1 negative: Given the corrected land help, when a test reads the land help text, then it fails if the text contains "push" or "opens a PR". | 7 | "contains neither `push` nor `opens a PR`, as asserted by the land-help text test" | diff-local |
| Story 1 negative: Given the corrected handoff help, when a test reads the handoff help text, then it fails if the text omits the push or the PR. | 7 | "as asserted by the handoff-help text test" | diff-local |
| Story 1 negative: Given `compose worktree --body <text>` is still accepted by the worktree parser, when a test compares the parser's accepted flags with the flags named in the worktree help, then any accepted flag missing from the help fails the test. | 7 | "a fixture help string lacking `--body` fails the comparison naming `--body`" | diff-local |
| Story 2 happy: Given `ai-conductor daemon --help`, when the operator reads the `--idle-poll` line, then the shown default is 60. | 8 | "`renderDaemonHelp()` shows `(default: "60")` on the `--idle-poll` line" | diff-local |
| Story 2 happy: Given `ai-conductor daemon` started without `--idle-poll`, when the daemon idles in continuous mode, then it waits 60 seconds between polls, matching the declared default. | 8 | "`buildDaemonModeOptions` passes `idlePollSeconds` 60 into the `runDaemonMode` options, so the idle wait is 60 seconds" | diff-local |
| Story 2 happy: Given every flag whose runtime fallback is supplied outside commander, when the defaults parity test runs, then each declared default equals its runtime fallback. | 8 | "`defaultMismatches` returns no mismatch for the live `RUNTIME_FALLBACK_FLAGS` table" | diff-local |
| Story 2 negative: Given a future change sets the runtime `--idle-poll` fallback to a value other than the declared default, when the defaults parity test runs, then it fails naming `--idle-poll` and both values. | 8 | "reports `--idle-poll` with both values for a fixture whose values differ" | diff-local |
| Story 2 negative: Given `--idle-poll 5` passed explicitly, when the daemon idles, then it waits 5 seconds and the declared default does not override the explicit value. | 8 | "`detectDaemonCommand` with `--idle-poll 5` returns `idlePollSeconds` 5" | diff-local |
| Story 2 negative: Given a flag declared with no default, when the parity test runs, then it does not report that flag as a mismatch. | 8 | "does not report `--max-idle-polls`, a flag declared with no default" | diff-local |
| Story 3 happy: Given `ai-conductor --help`, when the operator reads the command list, then it includes `shipped-record`, `kpi`, `memory`, `brain`, `intake-loop`, `render-diagrams`, `build-auth-status`, and `shipment-evidence`, each with a one-line description. | 2 | "each with a non-empty description, as asserted by the visible-commands help test" | diff-local |
| Story 3 happy: Given `ai-conductor --help`, when the operator reads the full reference, then each of those commands has its own section listing its declared flags. | 2 | "has a full-reference section for each of the eight commands listing its declared flags" | diff-local |
| Story 3 happy: Given `ai-conductor --help`, when the operator reads the `memory` section, then it lists the `setup` subcommand. | 2 | "the `memory` section lists the `setup` subcommand" | diff-local |
| Story 3 negative: Given one of those eight commands is removed from the visible catalog, when the help listing test runs, then it fails naming the missing command. | 2 | "The visible-commands listing check fails naming the missing command for a fixture program lacking one of the eight" | diff-local |
| Story 3 negative: Given a visible command is listed, when its existing dispatch behavior is exercised without `--help`, then it behaves exactly as before this change (same exit code and output). | 2 | "Existing dispatch tests for the eight commands pass with no edits to their assertions (same exit codes and output)" | diff-local |
| Story 3 negative: Given commands that were already visible before this change, such as `kickback-budget` and `build-tail`, when help renders, then they remain visible. | 2 | "`kickback-budget` and `build-tail` remain in the `renderCanonicalFullHelp()` top-level command list" | diff-local |
| Story 4 happy: Given `test-suite`, `finish-record`, `manual-test-record`, and `derive-feedback`, when the CLI catalog is built, then each is declared and marked hidden. | 3 | "`createProgram()` declares `test-suite`, `finish-record`, `manual-test-record`, and `derive-feedback` with commander hidden set" | diff-local |
| Story 4 happy: Given any other intercepted command that was undeclared before this change and is not one of the operator-facing commands `shipped-record`, `kpi`, `memory`, `brain`, `intake-loop`, `render-diagrams`, `build-auth-status`, or `shipment-evidence` from Story 3, when the CLI catalog is built, then it is declared and marked hidden. | 3 | "Every `PRE_DISPATCH_COMMANDS` top-level command not declared on main before this change, other than the eight Task 2 operator-facing commands, is declared in `createProgram()` with commander hidden set" | diff-local |
| Story 4 happy: Given a hidden command, when the operator runs `ai-conductor --help`, then the command appears neither in the command list nor as a full-reference section. | 3 | "`renderCanonicalFullHelp()` contains no hidden command name in its command list and no full-reference section for one" | diff-local |
| Story 4 negative: Given a hidden command, when the operator runs `ai-conductor <hidden-command> --help`, then its own help prints and the command does not execute. | 5 | "`finish-record --help` writes `finish-record`'s own help and the mocked finish-record handler is never called" | diff-local |
| Story 4 negative: Given a hidden command, when it is invoked without `--help` by the engine or a hook, then it dispatches exactly as before this change. | 3 | "Existing dispatch tests for the hidden commands pass with no edits to their assertions, showing each still dispatches without `--help`" | diff-local |
| Story 4 negative: Given every verb the daemon supervisor dispatcher accepts, when `daemon --help` renders after this change, then each verb still appears as a declared subcommand in the daemon help output and none is hidden. | 3 | "`renderDaemonHelp()` lists every verb in the daemon supervisor dispatcher's accepted verb set with none hidden" | diff-local |
| Story 5 happy: Given `ai-conductor daemon --help`, when the operator reads the run flags, then `--no-watch`, `--completed`, and `--all` are listed, and `--all` is described as including completed features. | 9 | "`renderDaemonHelp()` lists `--no-watch`, `--completed`, and `--all`, with `--all` described as including completed features" | diff-local |
| Story 5 happy: Given `ai-conductor daemon logs --help`, when the operator reads its flags, then `-f`/`--follow`, `-n`/`--lines <n>`, `--repo <path>` (also accepted as `--repo=<path>`), and `--all` are listed. | 10 | "`renderDaemonHelp()` `logs` section lists `-f, --follow`, `-n, --lines <n>`, `--repo <path>` naming the `--repo=<path>` form, and `--all`" | diff-local |
| Story 5 happy: Given `ai-conductor daemon pause --help`, `resume --help`, or `restart --help`, when the operator reads the usage, then it shows the fleet selectors: `--all`, described as acting on every registered repo, and optional bare repo names selecting a named subset. | 10 | "`pause`, `resume`, and `restart` sections each show `[repos...]` described as a named subset and `--all` described as every registered repo" | diff-local |
| Story 5 negative: Given `daemon logs -n 50`, when it runs, then it behaves as `--lines 50` did before this change. | 10 | "`detectDaemonObserveCommand` yields `lines` 50 for both `-n 50` and `--lines 50`, the same value `--lines 50` yielded before this change" | diff-local |
| Story 5 negative: Given `daemon restart` with no selector, when it runs, then it selects the same target it selected before this change. | 10 | "`detectDaemonSupervisorCommand` for `daemon restart` with no selector returns a result with neither `names` nor `all`, matching the pre-change result" | diff-local |
| Story 5 negative: Given a daemon run flag that is not declared, when the declared-flags test compares the daemon run parser's accepted flags with the commander declaration, then the test fails naming the undeclared flag. | 9 | "a fixture list with an undeclared flag fails naming that flag" | diff-local |
| Story 6 happy: Given `ai-conductor --help`, when the operator reads the `--auto` line, then it states that `--auto` is rejected in favor of the daemon and cannot be combined with `--interactive`. | 11 | "Root help and `inline` help both describe `--auto` as rejected in favor of the daemon and not combinable with `--interactive`" | diff-local |
| Story 6 happy: Given `ai-conductor --help`, when the operator reads the `--interactive` line, then it keeps its existing REPL-mode description and adds that it cannot be combined with `--auto`. | 11 | "Root help and `inline` help both keep the REPL-mode description of `--interactive` and add that it cannot be combined with `--auto`" | diff-local |
| Story 6 happy: Given `ai-conductor inline --help`, when the operator reads the same flags, then each states the same exclusion. | 11 | "Root help and `inline` help both describe `--auto` as rejected in favor of the daemon" | diff-local |
| Story 6 negative: Given both flags passed together, when the CLI runs, then it still exits 1 with `Error: --auto and --interactive are mutually exclusive`. | 11 | "`deriveMode` with both flags prints `Error: --auto and --interactive are mutually exclusive` and exits 1" | diff-local |
| Story 6 negative: Given `--auto` alone, when the CLI runs, then it still exits non-zero with the existing daemon rejection and prints no mutual-exclusion error. | 11 | "`deriveMode` with `--auto` alone exits non-zero with the daemon rejection and no mutual-exclusion error" | diff-local |
| Story 6 negative: Given `--interactive` alone with a feature, when the CLI runs, then no mutual-exclusion error is printed. | 11 | "with `--interactive` alone prints no mutual-exclusion error" | diff-local |
| Story 7 happy: Given any directory, including one that is not a git repository, when the operator runs `ai-conductor register --help`, then `register`'s own usage prints, the process exits 0, and the registry file is unchanged. | 5 | "Running the CLI entry with `register --help` in a non-git temporary directory exits 0, prints `register`'s commander usage without `not a git repository`, and leaves the registry file byte-identical (or absent)" | diff-local |
| Story 7 happy: Given any directory, when the operator runs `ai-conductor create --help`, then `create`'s own usage prints (not the root help), the process exits 0, and no directory is created. | 5 | "Running the CLI entry with `create --help` exits 0, prints `create`'s own usage rather than root help, and creates no directory" | diff-local |
| Story 7 happy: Given a nested declared command such as `memory setup`, when the operator runs `ai-conductor memory setup --help`, then `memory setup`'s own usage prints and exits 0. | 5 | "through the dispatch entry `memory setup --help` writes `memory setup`'s own usage and exits 0" | diff-local |
| Story 7 happy: Given `-h` in place of `--help`, when any of the above runs, then the same output and exit code result. | 5 | "`-h` yields the same output and exit code as `--help` for `register`, `create`, and `memory setup`" | diff-local |
| Story 7 negative: Given `ai-conductor register --help` in `/tmp`, when it runs, then the output does not contain `not a git repository`. | 5 | "prints `register`'s commander usage without `not a git repository`" | diff-local |
| Story 7 negative: Given `ai-conductor compose land --help`, when it runs, then compose's existing per-subcommand help prints, unchanged by the router. | 6 | "`routeSubcommandHelp` returns `null` for `compose land --help` and for `daemon logs --help`" | diff-local |
| Story 7 negative: Given `ai-conductor daemon logs --help`, when it runs, then the existing daemon help subtree prints, unchanged by the router. | 6 | "`routeSubcommandHelp` returns `null` for `compose land --help` and for `daemon logs --help`" | diff-local |
| Story 7 negative: Given `ai-conductor halt-issues sweep --help`, when it runs, then halt-issues' existing help prints, unchanged by the router. | 6 | "`routeSubcommandHelp` returns `null` for `halt-issues sweep --help` and the dispatch entry writes the halt-issues CLI's existing help text" | diff-local |
| Story 7 negative: Given `ai-conductor update --help`, when it runs, then `--help` is passed through to `bin/update` and its full usage prints, unchanged by the router. | 6 | "the dispatch entry runs the resolved `bin/update` with args exactly `['--help']` and its stdout contains `bin/update`'s full usage including `--set-channel`" | diff-local |
| Story 7 negative: Given an undeclared token such as `ai-conductor no-such-command --help`, when it runs, then the root full help prints as before this change. | 6 | "`routeSubcommandHelp` returns `null` for `no-such-command --help` and the dispatch entry writes `renderCanonicalFullHelp()` output" | diff-local |
| Story 8 happy: Given the current intercept chain in the CLI dispatch entry, when the catalog coverage test runs, then every intercept detector maps to a top-level command declared in the CLI catalog and the test passes. | 1, 4 | "`undeclaredRegistryCommands(PRE_DISPATCH_COMMANDS, createProgram())` returns an empty list" | diff-local |
| Story 8 happy: Given the pre-dispatch registry, when the help router handles `--help`, then it resolves commands from that same registry. | 5 | "`routeSubcommandHelp` resolves command paths only from `PRE_DISPATCH_COMMANDS`" | diff-local |
| Story 8 negative: Given a new intercept detector call is added to the CLI dispatch entry with no registry entry, when the coverage test runs, then it fails naming the detector. | 1 | "`diffDetectorSets` returns `unregistered` naming `detectExtraCommand`" | diff-local |
| Story 8 negative: Given a registry entry whose command is not declared in the CLI catalog, when the coverage test runs, then it fails naming the command. | 4 | "`undeclaredRegistryCommands` returns the command name for a fixture entry naming an undeclared command, and the coverage test fails naming that command" | diff-local |
| Story 8 negative: Given a registry entry whose detector is no longer called by the CLI dispatch entry, when the coverage test runs, then it fails naming the stale entry. | 1 | "`diffDetectorSets` returns `stale` naming the entry for a fixture registry entry whose detector the source never calls" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-14-commander-program-is-the-cli-catalog#D1 | task | task-2, task-3 | declares `test-suite`, `finish-record`, `manual-test-record`, and `derive-feedback` with commander hidden set |
| adr-2026-10-14-commander-program-is-the-cli-catalog#D2 | task | task-5, task-6 | `dispatchCliCommand` calls `routeSubcommandHelp` before `dispatchNonDispatchingCliCommand` |
| adr-2026-10-14-commander-program-is-the-cli-catalog#D3 | task | task-1, task-4 | `undeclaredRegistryCommands(PRE_DISPATCH_COMMANDS, createProgram())` returns an empty list |
| adr-2026-10-14-commander-program-is-the-cli-catalog#D4 | task | task-8 | `DEFAULT_IDLE_POLL_SECONDS` is the only source of the `--idle-poll` default in both `cli.ts` and `daemon-command.ts` |
| adr-2026-10-14-commander-program-is-the-cli-catalog#D5 | task | task-3 | `renderFullHelp` skips hidden commands |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
