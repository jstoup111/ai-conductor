# Implementation Plan: conduct daemon --help omits the supported pause and resume verbs

**Date:** 2026-08-25
**Stories:** .docs/stories/conduct-daemon-help-omits-the-supported-pause-and-.md
**Conflict check:** Skipped (tier S)

## Summary
Add `pause`/`resume` declarations to the daemon commander subtree so `conduct daemon --help` lists them, and add a drift test deriving the verb set from `daemon-command.ts` so a dispatcher verb can never ship unlisted. 4 tasks.

## Technical Approach

The daemon help is a hand-maintained commander subtree in `src/conductor/src/cli.ts` (`createProgram()`, daemon section ~lines 700-757); the dispatcher's accepted verbs live as module-private consts `MANAGEMENT_VERBS` (includes `pause`, `resume`) and `DAEMON_SUBVERBS` in `src/conductor/src/engine/daemon-command.ts`. The two enumerations drifted. Fix: (1) export the two verb sets from `daemon-command.ts` (pure additive `export const`, no behavior change); (2) a unit test renders `renderDaemonHelp()` and asserts every exported verb (minus the bare-run case) appears as a declared subcommand — written first so it fails RED naming `pause` and `resume`; (3) declare `pause`/`resume` in the commander subtree, documentation-only like the existing `start`/`stop`/`restart` declarations (commander never dispatches them — `index.ts` routes management verbs pre-boot via `detectDaemonSupervisorCommand`), turning the test GREEN. Descriptions follow the existing verb-declaration wording style and must not instruct manual `.daemon/` edits. Test pattern: follow the existing `src/conductor/test/daemon-cli-*-wiring.test.ts` unit-test style (vitest, no external services); search hint: `renderDaemonHelp` usages and `daemon-command` tests.

## Prerequisites
- None (no migrations, no new dependencies).

## Tasks

### Task 1: Export the daemon verb enumerations
**Story:** Story 2 — drift test derives the verb set from the dispatcher's module
**Type:** infrastructure

**Steps:**
1. In `src/conductor/src/engine/daemon-command.ts`, change `const MANAGEMENT_VERBS` and `const DAEMON_SUBVERBS` to `export const` (keep values and all call sites unchanged).
2. Run the existing daemon-command tests to confirm no behavior change.
3. Commit.

**Done when:**
- [ ] `MANAGEMENT_VERBS` and `DAEMON_SUBVERBS` are exported from `src/conductor/src/engine/daemon-command.ts` with unchanged contents
- [ ] Existing test suite for daemon-command passes unchanged

**Files likely touched:**
- src/conductor/src/engine/daemon-command.ts — add `export` to the two verb-set consts

**Dependencies:** none

### Task 2: Drift test — help must name every dispatcher verb (RED)
**Story:** Story 2, happy path + negative path (test fails naming any missing verb)
**Type:** negative-path

**Steps:**
1. Add `src/conductor/test/daemon-help-verb-drift.test.ts` (vitest, unit, default suite): import `renderDaemonHelp` from `../src/cli.js` and `MANAGEMENT_VERBS`, `DAEMON_SUBVERBS` from `../src/engine/daemon-command.js`.
2. For each verb in `DAEMON_SUBVERBS` (which is a superset of `MANAGEMENT_VERBS`), assert the rendered daemon help declares it as a subcommand (match the verb as a command name at line start in the daemon Commands listing); build the failure message so it names each missing verb.
3. Run the test and verify it FAILS, with a message naming exactly `pause` and `resume` (RED — proves the pre-fix drift and the naming behavior).
4. Commit the failing-test-plus-Task-3 fix together only if the repo's TDD hooks require green commits; otherwise commit RED per repo convention.

**Done when:**
- [ ] `src/conductor/test/daemon-help-verb-drift.test.ts` exists, derives its expected verb set only from the `daemon-command.ts` exports (no hand-copied verb list)
- [ ] Pre-fix (before Task 3) the test fails and its failure output names `pause` and `resume`
- [ ] The test uses no external services and runs in the default suite

**Files likely touched:**
- src/conductor/test/daemon-help-verb-drift.test.ts — new unit test

**Dependencies:** 1

### Task 3: Declare pause and resume in the daemon help subtree (GREEN)
**Story:** Story 1, happy paths
**Type:** happy-path

**Steps:**
1. In `src/conductor/src/cli.ts`, in the management-verb declaration block (after `restart`), add `daemon.command('pause')` with description `Pause dispatch for this repo's daemon (writes the pause marker; running build finishes)` and `daemon.command('resume')` with description `Resume dispatch for this repo's daemon (clears the pause marker)` — wording may be adjusted to match runbook phrasing, but each stays one line and never instructs a manual `.daemon/` edit.
2. Extend the comment noting these are documentation-only declarations dispatched pre-boot by `detectDaemonSupervisorCommand`.
3. Run the Task 2 drift test — verify GREEN.
4. Commit.

**Done when:**
- [ ] `conduct daemon --help` output lists `pause` and `resume`, each with a non-empty one-line description containing no instruction to edit `.daemon/` files by hand
- [ ] The Task 2 drift test passes
- [ ] `renderDaemonHelp()` output contains per-verb sections `conduct daemon pause` and `conduct daemon resume` (same pattern as `start`/`stop`)

**Files likely touched:**
- src/conductor/src/cli.ts — two `.command()` declarations in the daemon subtree

**Dependencies:** 2

### Task 4: Dispatch precedence unchanged for pause and resume
**Story:** Story 1, negative path (help declarations must not capture dispatch)
**Type:** negative-path

**Steps:**
1. In `src/conductor/test/daemon-help-verb-drift.test.ts` (or the existing daemon-command test file if more idiomatic), assert `detectDaemonSupervisorCommand(['node','entry','daemon','pause'])` and `...'resume'` each return a command with the matching `verb` — proving the pre-boot dispatcher still claims both verbs ahead of commander.
2. If an equivalent assertion already exists in the daemon-command tests, record that coverage in the test file comment instead of duplicating it.
3. Run the suite; commit.

**Done when:**
- [ ] A default-suite test asserts `detectDaemonSupervisorCommand` returns `{ verb: 'pause' }` / `{ verb: 'resume' }`-shaped commands for `daemon pause` / `daemon resume` argv (new assertion, or a comment citing the existing named test that already asserts it)
- [ ] Full daemon-command + cli test files pass

**Files likely touched:**
- src/conductor/test/daemon-help-verb-drift.test.ts — dispatch-precedence assertions

**Dependencies:** 3

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3 → Task 4
```

## Integration Points
- After Task 3: `conduct daemon --help` end-to-end shows the full verb set; drift test green.

## Verification
- [ ] All happy path criteria covered (Task 3; Task 2 happy path)
- [ ] All negative path criteria covered (Tasks 2 and 4)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable Done when block
- [ ] Dependencies are explicit and acyclic
