# Implementation Plan: updating-the-harness-requires-cd-ing-to-its-checko

**Date:** 2026-09-19
**Stories:** .docs/stories/updating-the-harness-requires-cd-ing-to-its-checko.md
**Conflict check:** Not required (Tier S)

## Summary
Add an `ai-conductor update` subcommand that runs the harness checkout's own `bin/update` from any working directory, passing arguments, terminal, and exit status straight through. 3 tasks. Source: jstoup111/ai-conductor#2605.

## Technical Approach
- The installed CLI already knows where it lives: `resolveHarnessRoot()` (`src/conductor/src/engine/install-freshness.ts`) probes the bundle and source-tree depths for `bin/install`, and `spawnAutoUpdateCheck` (`src/conductor/src/engine/auto-update-check.ts`) already joins `bin/update` onto it. The new command reuses that resolution, so it updates the checkout the invoked CLI belongs to — hand-cloned or bootstrap-installed alike.
- New module `src/conductor/src/engine/update-cli.ts` holds `detectUpdateCommand`, `dispatchUpdateCommand`, and `realUpdateRunner`. The runner differs from `realAutoUpdateRunner` deliberately: `stdio: 'inherit'` (the attended updater prompts on stdin, including the typed-version confirmation for a major upgrade) and `reject: false` so the updater's exit status is returned, not thrown.
- Pre-spawn refusals, exit 1, each naming a path: unresolved root (names the probed candidates), missing `<root>/bin/update`, `<root>/.git` not a directory. The last one matters because `bin/update` itself exits 0 silently in that case, which from a bare command would read as "up to date"; it also keeps a CLI running out of a worktree dist from updating that worktree.
- Dispatch follows the `version` precedent: declared in `createProgram()` so `--help` lists it, detected and dispatched in `index.ts` before anything boots the pipeline. `--help` after `update` is passed through to the script, which owns its usage text.
- `bin/update`, `auto-update-check.ts`, and the `bin/ai-conductor` wrapper are untouched. No release migration block is needed: the change adds a CLI command and changes no existing CLI behavior; the implementation PR declares `Release-Disposition: note`, `Release-Category: Added`, `Release-Semver: minor`.

## Prerequisites
- none

## Tasks

### Task 1: `update` command passes through to the checkout's updater
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/update-cli.test.ts` (new file). Test pattern (repeat of `src/conductor/test/engine/auto-update-check.test.ts`): inject `harnessRoot` and a recording `runner` through the options object, never spawn a real process. Use a `mkdtemp` root containing an empty `bin/update` file and a `.git` directory. Cases: `detectUpdateCommand(['node','x','update'])` returns `{ args: [] }`, `detectUpdateCommand(['node','x','update','--set-channel','stable'])` returns `{ args: ['--set-channel','stable'] }`, and any argv whose third token is not `update` returns null; `dispatchUpdateCommand` calls the runner once with `join(root,'bin','update')` and the args verbatim and resolves to the runner's exit code 0
2. Verify tests fail (RED): module does not exist
3. Implement `src/conductor/src/engine/update-cli.ts`: `detectUpdateCommand(argv)`, `dispatchUpdateCommand(cmd, opts)` with `opts.harnessRoot` defaulting to `resolveHarnessRoot()` from `install-freshness.ts`, and `realUpdateRunner` using `execa(path, args, { stdio: 'inherit', reject: false })` returning `exitCode ?? 1`. Do not reuse `realAutoUpdateRunner`: it does not inherit stdin, and the attended updater prompts
4. Verify tests pass (GREEN)
5. Commit: "feat(cli): ai-conductor update runs the checkout's updater (ai-conductor#2605)"

**Done when:**
- `dispatchUpdateCommand` invokes the injected runner exactly once with `<root>/bin/update` and the arguments `['--set-channel','stable']` verbatim, and with `[]` for a bare `update`, asserted in `src/conductor/test/engine/update-cli.test.ts`
- `realUpdateRunner` passes `stdio: 'inherit'` so stdin reaches the updater's prompts, asserted in `src/conductor/test/engine/update-cli.test.ts` by a mocked `execa` receiving that option
- `detectUpdateCommand` returns null unless `argv[2]` is exactly `update`, asserted in `src/conductor/test/engine/update-cli.test.ts`

**Files likely touched:**
- src/conductor/src/engine/update-cli.ts — new detector, dispatcher, real runner
- src/conductor/test/engine/update-cli.test.ts — new tests

**Dependencies:** none

### Task 2: Updater status propagates and unusable roots refuse before spawning
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/update-cli.test.ts`: runner resolving 3 makes `dispatchUpdateCommand` resolve 3 with nothing written to the injected `log`; `realUpdateRunner` with a mocked `execa` result of `{ exitCode: undefined, signal: 'SIGINT' }` resolves 1; `harnessRoot: null` resolves 1 and logs a message containing both probed candidate directories; a root without `bin/update` resolves 1 and logs that absolute updater path; a root whose `.git` is a regular file (the worktree shape) or absent resolves 1 and logs that root with the words `not a git checkout`. In all three refusals assert the recording runner was never called
2. Verify tests fail (RED)
3. Implement the three pre-spawn checks in `src/conductor/src/engine/update-cli.ts` in that order; export the probe candidates from one helper so the message and the resolution cannot drift
4. Verify tests pass (GREEN)
5. Commit: "feat(cli): ai-conductor update refuses an unusable harness root"

**Done when:**
- `dispatchUpdateCommand` resolves to the runner's non-zero exit code 3 and writes nothing to `log`, asserted in `src/conductor/test/engine/update-cli.test.ts`
- an unresolved root, a missing `bin/update`, and a root whose `.git` is not a directory each resolve 1 with a `log` message naming the probed locations, the updater path, or the root respectively, asserted in `src/conductor/test/engine/update-cli.test.ts`
- the recording runner has zero calls in every refusal case, asserted in `src/conductor/test/engine/update-cli.test.ts`
- `realUpdateRunner` maps an `execa` result with no exit code (signal termination) to exit code 1, asserted in `src/conductor/test/engine/update-cli.test.ts`

**Files likely touched:**
- src/conductor/src/engine/update-cli.ts — pre-spawn checks
- src/conductor/test/engine/update-cli.test.ts — negative tests

**Dependencies:** Task 1

### Task 3: Wire `update` into the CLI entry point and the help surface
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/update-cli.test.ts` assert `createProgram().commands` contains a command named `update` with a non-empty description and that `renderCanonicalFullHelp()` output contains a line starting with `update` (pattern: the `CLI surface` block of `src/conductor/test/cli/version-report.test.ts`). In `src/conductor/test/cli/index.test.ts` add the entry-point proof next to `names a bare unknown command while preserving bare-feature guidance`, reusing its `execa('node', ['--import','tsx', join(process.cwd(),'src','index.ts'), ...args], { reject: false })` invoker: `update --help` must produce output containing neither `unknown command` nor the inline-subcommand guidance text `Run:        conduct inline`, and must either exit 0 or exit 1 with stderr containing `not a git checkout`. Both outcomes are legitimate and both prove dispatch: the source-tree harness root is the repository itself, whose `.git` is a directory in a primary checkout (the updater prints its usage, exit 0) and a regular file in a build worktree (the pre-spawn refusal, exit 1). `--help` is the only argument used because the updater's usage branch performs no fetch and no write
2. Verify tests fail (RED)
3. Implement: declare `.command('update [args...]')` with `.allowUnknownOption()` and a one-line description in `createProgram()` (`src/conductor/src/cli.ts`), next to `version`, with the same dispatched-in-index.ts comment; in `src/conductor/src/index.ts` add, directly after the version dispatch and before any handler that boots the pipeline, `const updateCmd = detectUpdateCommand(process.argv); if (updateCmd) { process.exitCode = await dispatchUpdateCommand(updateCmd); return; }`
4. Verify tests pass (GREEN)
5. Commit: "feat(cli): dispatch and document the update command"

**Done when:**
- `createProgram()` declares an `update` command and `renderCanonicalFullHelp()` lists it, asserted in `src/conductor/test/engine/update-cli.test.ts`
- `src/conductor/src/index.ts` dispatches `detectUpdateCommand` before the inline guard: spawning the real entry point with `update --help` yields no `unknown command` text and no inline-subcommand guidance, and exits 0 or exits 1 with `not a git checkout` on stderr, asserted in `src/conductor/test/cli/index.test.ts`
- `git diff --stat` for the feature lists no change to `bin/update` or `src/conductor/src/engine/auto-update-check.ts`, and `src/conductor/test/engine/auto-update-check.test.ts` passes unchanged

**Files likely touched:**
- src/conductor/src/cli.ts — command declaration
- src/conductor/src/index.ts — dispatch
- src/conductor/test/engine/update-cli.test.ts — help-surface test
- src/conductor/test/cli/index.test.ts — entry-point dispatch test

**Dependencies:** Task 1

## Task Dependency Graph
Task 1 → Task 2
Task 1 → Task 3

## Integration Points
- After Task 3: `ai-conductor update` works end to end from any directory.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an installed CLI whose harness root is a git checkout containing `bin/update`, when `ai-conductor update` runs from a directory outside that checkout, then the checkout's `bin/update` is executed with no arguments, with stdin, stdout, and stderr inherited from the terminal, and the command exits 0 when the updater exits 0 | 1 | "`dispatchUpdateCommand` invokes the injected runner exactly once with `<root>/bin/update` and the arguments `['--set-channel','stable']` verbatim, and with `[]` for a bare `update`, asserted in `src/conductor/test/engine/update-cli.test.ts`" | diff-local |
| Story 1 happy: Given the same installation, when `ai-conductor update --set-channel stable` runs from any directory, then the checkout's `bin/update` receives exactly `--set-channel stable` and the command exits with the updater's status | 1 | "`dispatchUpdateCommand` invokes the injected runner exactly once with `<root>/bin/update` and the arguments `['--set-channel','stable']` verbatim, and with `[]` for a bare `update`, asserted in `src/conductor/test/engine/update-cli.test.ts`" | diff-local |
| Story 1 happy: Given the installed CLI, when `ai-conductor --help` runs, then the output lists an `update` command with a one-line description | 3 | "`createProgram()` declares an `update` command and `renderCanonicalFullHelp()` lists it, asserted in `src/conductor/test/engine/update-cli.test.ts`" | diff-local |
| Story 1 negative: Given an updater that exits 3, when `ai-conductor update` runs, then the command exits 3 and prints no error of its own | 2 | "`dispatchUpdateCommand` resolves to the runner's non-zero exit code 3 and writes nothing to `log`, asserted in `src/conductor/test/engine/update-cli.test.ts`" | diff-local |
| Story 1 negative: Given an updater terminated by a signal before it exits, such as the operator pressing Ctrl-C at a confirmation prompt, when `ai-conductor update` returns, then the command exits non-zero | 2 | "`realUpdateRunner` maps an `execa` result with no exit code (signal termination) to exit code 1, asserted in `src/conductor/test/engine/update-cli.test.ts`" | diff-local |
| Story 1 negative: Given a CLI whose harness root cannot be resolved, when `ai-conductor update` runs, then it exits 1, stderr names the locations it probed, and no updater process is started | 2 | "an unresolved root, a missing `bin/update`, and a root whose `.git` is not a directory each resolve 1 with a `log` message naming the probed locations, the updater path, or the root respectively, asserted in `src/conductor/test/engine/update-cli.test.ts`" | diff-local |
| Story 1 negative: Given a harness root with no `bin/update`, when `ai-conductor update` runs, then it exits 1, stderr names the missing updater path, and no updater process is started | 2 | "an unresolved root, a missing `bin/update`, and a root whose `.git` is not a directory each resolve 1 with a `log` message naming the probed locations, the updater path, or the root respectively, asserted in `src/conductor/test/engine/update-cli.test.ts`" | diff-local |
| Story 1 negative: Given a harness root whose `.git` is not a directory, when `ai-conductor update` runs, then it exits 1, stderr names that root as not a git checkout, and no updater process is started | 2 | "an unresolved root, a missing `bin/update`, and a root whose `.git` is not a directory each resolve 1 with a `log` message naming the probed locations, the updater path, or the root respectively, asserted in `src/conductor/test/engine/update-cli.test.ts`" | diff-local |
| Story 1 negative: Given the shipped change, when `ai-conductor inline` starts, then the startup check still runs `bin/update --auto` and swallows its failures exactly as before, and `bin/update` itself is byte-for-byte unchanged | 3 | "`git diff --stat` for the feature lists no change to `bin/update` or `src/conductor/src/engine/auto-update-check.ts`, and `src/conductor/test/engine/auto-update-check.test.ts` passes unchanged" | diff-local |


## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
