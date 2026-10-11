# Implementation Plan: Accepted remediation commands and durable episode-HALT recovery (#1023)

**Date:** 2026-10-10
**Design:** `.docs/decisions/architecture-review-2026-10-10-diagnostic-surfaces-mislead-printed-commands-the-c.md` (technical track; no PRD)
**Stories:** .docs/stories/diagnostic-surfaces-mislead-printed-commands-the-c.md
**Conflict check:** Clean as of 2026-10-10 (`.docs/conflicts/diagnostic-surfaces-mislead-printed-commands-the-c.md`)

## Summary

Two independent fixes in 11 tasks: (1) every command the conductor CLI's `index.ts` guidance prints comes from one closed-set builder whose outputs are proven to parse, with a source check that rejects hand-written command literals; (2) episode-caused HALT stamps move from an in-memory `Set` to a durable `.pipeline/HALT.episode` sidecar so recovery survives a daemon restart (`adr-2026-10-10-durable-episode-halt-stamp`).

## Technical Approach

**Item 1 — remediation commands.**
- New module `src/conductor/src/remediation-commands.ts` owns a closed union of remediation commands (`inline-run`, `inline-reset`, `inline-status`, `inline-fresh`), each formatted as `ai-conductor inline …`. A feature argument is double-quoted when present and omitted entirely when absent or empty, so no command ever carries an empty `""` argument. The module also exports `remediationArgv(command)` (the argv tokens after the binary name) and `REMEDIATION_COMMAND_FIXTURES` (one instance of every kind, with and without a feature), which the parse test enumerates.
- New module `src/conductor/src/remediation-guidance.ts` holds the four guidance-text formatters that `index.ts` prints today inline (orphaned-state reset hint, orphaned worktree-missing refusal, SHIP-evidence gap instructions, recovery-declined instructions). Each obtains its command(s) from the builder. `index.ts` calls them instead of interpolating command text.
- The parse proof runs the real grammar: `detectInline` from `src/conductor/src/cli.ts` must report `isInline: true` for the full argv, and `parseArgs` on its `rest` must not throw. This is the same decision the bare-form guard in `index.ts` makes before exit 1.
- The source check parses `src/conductor/src/index.ts` with the TypeScript compiler API and fails when any string literal or template literal (other than the search-pattern argument of `.replace`/`.replaceAll`) contains `ai-conductor ` or `conduct ` followed by a flag or a quoted argument; command text in `index.ts` must come from the builder or guidance formatters. The existing accepted forms printed by the bare-form guard itself and the `--auto` deprecation are moved into the builder's closed set or the guidance module so the check has no exception list.
- Pre-guard subcommand commands (such as `ai-conductor daemon start`) are kept in a separate `PRE_GUARD_COMMAND_FIXTURES` set proven by their own subcommand argv parser; `REMEDIATION_COMMAND_FIXTURES` holds only inline commands.
- Entry-point proof follows the real-binary pattern in `src/conductor/test/integration/registry-cli.test.ts`: rebuild `dist/index.js` from current source in `beforeAll`, spawn `node dist/index.js …` against a temporary git repo fixture with a per-spawn kill timeout, capture stdout/stderr, then feed every captured `ai-conductor …` command through the parse proof.

**Item 3 — durable episode stamp.**
- `src/conductor/src/engine/halt-marker.ts` gains `HALT_EPISODE_MARKER = '.pipeline/HALT.episode'` beside `HALT_CLASS_MARKER`, plus `writeEpisodeStamp(root, deadlineMs)`, `readEpisodeStamp(root)`, and `removeEpisodeStamp(root)`. Keeping them in `halt-marker.ts` satisfies `adr-2026-07-28` D5 (no HALT-family writes outside this module). The stamp is JSON `{ "deadlineMs": <number>, "haltDigest": "<sha256 of the HALT body at stamping>" }`, written to a temp file and renamed into place. `readEpisodeStamp` returns a closed result: `{ kind: 'valid', deadlineMs }` or `{ kind: 'invalid', reason: 'absent' | 'malformed' | 'halt-absent' | 'digest-mismatch' }`. It never throws. `writeEpisodeStamp` returns `{ status: 'written' } | { status: 'failed', reason }` and never throws.
- `writeHaltMarker` unlinks `HALT.episode` in the same pre-body step that already unlinks `HALT.class` (D4 lifecycle). `clearMarker` in `engine/daemon-rekick.ts` removes it beside `HALT.class`.
- `RateLimitEpisode` (`engine/rate-limit-episode.ts`) gains a read-only `deadline(): number | null` accessor over its existing private `deadline`.
- `engine/episode-halt-tracker.ts` is rewritten as a sidecar-backed store constructed with the worktree base and a log sink. `onHaltWritten(slug, episodeCaused, deadlineMs)` writes a stamp only when the HALT is episode-caused. `listRecoverable(nowMs)` reads the stamps under the worktree base, discards (removes) invalid stamps, and returns the slugs whose stamp is valid and whose deadline is at or before `nowMs`. The in-memory `Set` is removed.
- Recovery trigger (ADR decision 4): `DaemonMaintenance` runs the episode recovery at `startup` and on every `afterIdlePoll` tick while no episode is active, instead of only on the was-active→inactive edge. `recoverEpisodeHalts` keeps operator-park precedence first, then calls `resolveHaltRetention` with `{ retainUnclassified: true }`, so an absent or unreadable `HALT.class` is retained (operator decision 2026-10-10, aligning with `adr-2026-07-28` D2/D4 and `refuse-daemon-auto-resume-of-an-operator-action-ha` Story 2). Each slug's evaluation is isolated in its own try/catch.
- Production wiring: `engine/daemon.ts` passes `rateLimitEpisode.deadline()` into `onHaltWritten` at the existing park-collection point; `daemon-cli.ts` constructs the durable tracker with `worktreeBase` where it constructs `createEpisodeHaltTracker()` today and threads `listRecoverable` into the existing `recoverEpisodeHalts` wiring.

**Local pattern context.** The new sidecar mirrors `HALT.class`: removed before a new HALT body is written, removed on clear, absence fails safe (not auto-recoverable). Search hints: `HALT_CLASS_MARKER`, `writeHaltMarker`, `clearMarker`, `readRawHaltClass`. Allowed variation: the content is structured JSON rather than a class token. Real-worktree sweep fixtures follow `src/conductor/test/engine/daemon-cli-episode-halt-wiring.test.ts` (temporary worktree dirs with `.pipeline/HALT` and `HALT.class`, captured log lines).

**Sequencing.** Item 1 (Tasks 1–5) and item 3 (Tasks 6–11) share no files and can run in parallel. Within item 3, the stamp helpers come first, then the tracker, then the trigger, then production wiring.

## Prerequisites

- None. No dependency, migration, or config change.

## Tasks

### Task 1: Closed-set remediation command builder with a CLI parse proof
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/remediation-commands.test.ts`: for every entry of `REMEDIATION_COMMAND_FIXTURES`, `formatRemediationCommand` starts with `ai-conductor inline`; a shared helper `assertAcceptedByCli(commandText)` tokenizes the text, runs `detectInline(['node', 'ai-conductor', ...tokens])` and requires `isInline === true`, then runs `parseArgs(rest)` and requires no throw; it throws an error whose message contains the full command text when either check fails.
2. Add a test that `assertAcceptedByCli('ai-conductor --reset')` throws with a message containing `ai-conductor --reset` (the rejected-form case).
3. Add tests that `inline-run` and `inline-fresh` with `feature` undefined or `''` format to `ai-conductor inline` and `ai-conductor inline --fresh` with no `""` token, and with `feature: 'add login'` format to `ai-conductor inline "add login"` and `ai-conductor inline --fresh "add login"`.
4. Verify RED, implement `src/conductor/src/remediation-commands.ts` (closed union, `formatRemediationCommand`, `remediationArgv`, `REMEDIATION_COMMAND_FIXTURES`), verify GREEN, commit.

**Done when:**
- [test] The fixture-enumeration test in `remediation-commands.test.ts` passes `assertAcceptedByCli` (detectInline reports inline and parseArgs does not throw) for every member of `REMEDIATION_COMMAND_FIXTURES`, covering all four kinds with and without a feature.
- [test] `assertAcceptedByCli('ai-conductor --reset')` throws an error whose message contains the text `ai-conductor --reset`, so a closed-set member changed to that form fails the enumeration test naming the command.
- [test] `formatRemediationCommand` returns exactly `ai-conductor inline` and `ai-conductor inline --fresh` (no `""` token) for an absent or empty feature, and each is accepted by `assertAcceptedByCli`.
- [test] `formatRemediationCommand` returns `ai-conductor inline --reset` for `inline-reset` and `ai-conductor inline --status` for `inline-status`.

**Files likely touched:**
- `src/conductor/src/remediation-commands.ts` — new closed-set builder
- `src/conductor/test/remediation-commands.test.ts` — builder and parse-proof tests

**Dependencies:** none

### Task 2: Guidance formatters obtain every command from the builder
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/remediation-guidance.test.ts` for four formatters in `src/conductor/src/remediation-guidance.ts`: `formatOrphanedStateResetHint(stateFilePath)`, `formatOrphanedWorktreeMissing({ featureDesc, stateFilePath, expectedLocations })`, `formatShipEvidenceGapInstructions(featureDesc?)`, `formatRecoveryDeclinedInstructions(featureDesc?)`.
2. Each test extracts every `ai-conductor …` command from the returned text (a line-anchored regex over backtick-free command spans) and passes each through `assertAcceptedByCli` from Task 1; each test also asserts the text contains no bare form matching `/ai-conductor (--reset|--status|--fresh|")/`.
3. Verify RED, implement the formatters by calling `formatRemediationCommand` (keep the surrounding prose of today's messages), verify GREEN, commit.

**Done when:**
- [test] `formatOrphanedStateResetHint` text contains `ai-conductor inline --reset` and every command extracted from it passes `assertAcceptedByCli`.
- [test] `formatOrphanedWorktreeMissing` text's option 2 contains `ai-conductor inline --reset` and every command extracted from it passes `assertAcceptedByCli`.
- [test] `formatShipEvidenceGapInstructions('feat x')` contains `ai-conductor inline "feat x"` and `ai-conductor inline --status`; with no feature it contains `ai-conductor inline` and no `""` token; all extracted commands pass `assertAcceptedByCli`.
- [test] `formatRecoveryDeclinedInstructions('feat x')` contains `ai-conductor inline --status` and `ai-conductor inline --fresh "feat x"`; with no feature it contains `ai-conductor inline --fresh` with no trailing `""`; all extracted commands pass `assertAcceptedByCli`.
- [test] None of the four formatters' outputs, with or without a feature, matches the bare-form regex `/ai-conductor (--reset|--status|--fresh|")/`.

**Files likely touched:**
- `src/conductor/src/remediation-guidance.ts` — new guidance formatters
- `src/conductor/test/remediation-guidance.test.ts` — formatter tests

**Dependencies:** Task 1

### Task 3: Orphaned-state guidance prints accepted commands through the real CLI
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing real-binary tests in `src/conductor/test/integration/remediation-guidance-cli.test.ts` following the `registry-cli.test.ts` pattern (rebuild `dist/index.js` in `beforeAll`, spawn `node dist/index.js` with a kill timeout, temp git repo fixture).
2. Fixture A: root `.pipeline/conduct-state.json` marked past the worktree step for feature `orph` with no worktree; spawn `inline --diagnose "orph"`; capture stderr.
3. Fixture B: same state; spawn `inline "orph"` (the auto-resume path that refuses with the numbered options); capture stderr.
4. For each, extract the printed commands, assert the expected text, run each through `assertAcceptedByCli`, then spawn the printed reset command's argv (`inline --reset`) against the fixture and assert stderr does not contain `the inline SDLC pipeline now runs under the` and exit code is not the bare-form refusal.
5. Verify RED, replace the two orphaned-state message literals in `src/conductor/src/index.ts` with `formatOrphanedStateResetHint` and `formatOrphanedWorktreeMissing`, verify GREEN, commit.

**Done when:**
- [test] Spawning `node dist/index.js inline --diagnose "orph"` on fixture A prints `ai-conductor inline --reset`, and spawning the printed command's argv on the fixture produces no bare-form guard refusal text.
- [test] Spawning `node dist/index.js inline "orph"` on fixture B prints option 2 with `ai-conductor inline --reset`, and spawning that printed command's argv produces no bare-form guard refusal text.
- [test] The captured output of both spawns contains no match for the bare-form regex `/ai-conductor (--reset|--status|--fresh|")/`.
- `src/conductor/src/index.ts` prints both orphaned-state messages by calling `formatOrphanedStateResetHint` and `formatOrphanedWorktreeMissing` from `remediation-guidance.ts`.

**Files likely touched:**
- `src/conductor/src/index.ts` — orphaned-state messages call the guidance formatters
- `src/conductor/test/integration/remediation-guidance-cli.test.ts` — real-binary orphaned-state tests

**Dependencies:** Task 2

### Task 4: SHIP-gap and recovery-declined guidance print accepted commands through the real CLI
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Extend `src/conductor/test/integration/remediation-guidance-cli.test.ts` with fixture C: a feature worktree whose `conduct-state.json` claims SHIP complete while SHIP evidence is missing (so `verifyCompleteState` fails); spawn `inline --diagnose "shipx"` and, separately, `inline --diagnose` from inside that worktree with no feature argument.
2. Fixture D: the same complete-but-gapped state; spawn `inline "shipx"` with stdin `n\n` to decline the recovery prompt; and a variant whose recorded state has no feature description, spawned so the declined message renders with no feature.
3. Assert the expected texts, run every captured command through `assertAcceptedByCli`, assert no bare-form match and no `""` token.
4. Verify RED, replace the SHIP-gap and recovery-declined literals in `src/conductor/src/index.ts` with `formatShipEvidenceGapInstructions` and `formatRecoveryDeclinedInstructions`, verify GREEN, commit.

**Done when:**
- [test] Spawning `inline --diagnose "shipx"` on fixture C prints `ai-conductor inline "shipx"` and `ai-conductor inline --status`, and both pass `assertAcceptedByCli`.
- [test] Spawning `inline --diagnose` with no feature on fixture C prints a roll-back command containing `ai-conductor inline` with no `""` token, and it passes `assertAcceptedByCli`.
- [test] Spawning `inline "shipx"` with stdin `n` on fixture D prints `ai-conductor inline --status` and `ai-conductor inline --fresh "shipx"`; the no-feature variant prints `ai-conductor inline --fresh` with no trailing `""`; every printed command passes `assertAcceptedByCli`.
- [test] The captured output of every spawn in fixtures C and D contains no match for the bare-form regex `/ai-conductor (--reset|--status|--fresh|")/`.
- `src/conductor/src/index.ts` prints the SHIP-gap and recovery-declined instructions by calling `formatShipEvidenceGapInstructions` and `formatRecoveryDeclinedInstructions`.

**Files likely touched:**
- `src/conductor/src/index.ts` — SHIP-gap and recovery-declined messages call the guidance formatters
- `src/conductor/test/integration/remediation-guidance-cli.test.ts` — real-binary SHIP-gap and declined tests

**Dependencies:** Task 2

### Task 5: Source check rejects hand-written guidance commands in index.ts
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/remediation-guidance-source.test.ts` with a pure scanner `findHandWrittenCommands(sourceText)` built on the TypeScript compiler API (`typescript` is already a dependency): it visits every string literal and template literal (including each template span and `+` concatenation operand) anywhere in the file — console arguments, variable initializers, thrown `Error` messages, `process.stderr.write` arguments, and helper return values alike — skipping only the first (search-pattern) argument of a `.replace(...)` or `.replaceAll(...)` call — the replacement argument is scanned like any other literal — and returns `{ line, text }` for each literal containing `ai-conductor ` or `conduct ` followed by `-`, `"`, or a lowercase subcommand word that is itself followed by whitespace, a backtick, or the end of the literal. The search-pattern skip covers `'ai-conductor engineer'` in the help-text rename `replaceAll('ai-conductor engineer', 'ai-conductor compose')`; its replacement `'ai-conductor compose'` is scanned, so Step 4 routes it through the builder, and an error prefix such as `conduct daemon: unknown subcommand` does not match because `daemon` is followed by `:`.
2. Assert the scanner reports a fixture source containing `` `Run ai-conductor --reset to clear` `` and one containing `'conduct daemon park x'`, each with its line number, and reports nothing for a fixture that only calls `formatRemediationCommand`.
3. Assert `findHandWrittenCommands(readFileSync('src/conductor/src/index.ts'))` returns an empty list, and on failure the assertion message names each offending line number and text.
4. Verify RED (the bare-form guard guidance and `--auto` deprecation in `index.ts` still hand-write commands). Render the bare-form guard guidance through a new `formatInlineGuardGuidance()` in `remediation-guidance.ts`: its run line uses `inline-run` with the literal placeholder `<feature description>`, its state-ops synopsis is built from inline kinds (`inline-status`, plus new `inline-resume`, `inline-report`, and `inline-diagnose` kinds), and its all-commands pointer is `ai-conductor --help` held in `PRE_GUARD_COMMAND_FIXTURES` and proven by an exported `isTopLevelHelpRequest(argv)` extracted from the existing top-level `--help`/`-h` check in `index.ts` (which `index.ts` then calls). Change the help-text rename to `.replaceAll('ai-conductor engineer', formatPreGuardCommand('compose'))`, holding `ai-conductor compose` in `PRE_GUARD_COMMAND_FIXTURES` and proving it with `detectEngineerCommand` in `src/conductor/src/engine/engineer-cli.ts`. Move inline commands into `REMEDIATION_COMMAND_FIXTURES`-covered builder kinds and move any pre-guard subcommand command (for example `ai-conductor daemon start` in the `--auto` deprecation) into a separate exported `PRE_GUARD_COMMAND_FIXTURES` set in `remediation-commands.ts`, never into `REMEDIATION_COMMAND_FIXTURES`, so Task 1's inline-only enumeration is unaffected; add a test that each `PRE_GUARD_COMMAND_FIXTURES` entry is accepted by its subcommand's own argv parser (non-null, not `invalidArgs`; for `daemon start`, the parsers in `src/conductor/src/engine/daemon-command.ts`); verify GREEN, commit.

**Done when:**
- [test] `findHandWrittenCommands` reports a `console.error` fixture literal containing `ai-conductor --reset` and one containing `conduct daemon park x`, each with its line number and text, and reports nothing for the builder-only fixture, for the search-pattern (first) argument of a `.replaceAll(...)` call, or for the `conduct daemon: unknown subcommand` prefix; it does report a hand-written `ai-conductor --reset` used as a `.replaceAll(...)` replacement (second) argument.
- [test] `findHandWrittenCommands` also reports a hand-written `ai-conductor --status` in a variable initializer later logged, in a `new Error(...)` message, and in a `process.stderr.write(...)` argument, each with its line number and text.
- [test] `findHandWrittenCommands` over the current `src/conductor/src/index.ts` returns an empty list, so every guidance command there is obtained from `remediation-commands.ts` or `remediation-guidance.ts`; when it is non-empty the test's failure message lists each offending line number and text.
- [test] `formatInlineGuardGuidance()` output contains `ai-conductor inline "<feature description>"`, the inline state-ops flags, and `ai-conductor --help`, and `isTopLevelHelpRequest` returns true for `ai-conductor --help`.
- [test] Every inline kind added in this task (`inline-resume`, `inline-report`, `inline-diagnose`) is in `REMEDIATION_COMMAND_FIXTURES` and passes `assertAcceptedByCli`; every pre-guard subcommand command is only in `PRE_GUARD_COMMAND_FIXTURES` and is accepted by that subcommand's own argv parser, which returns a parsed command that is neither `null` nor `invalidArgs` (for `ai-conductor daemon start`, `detectDaemonSupervisorCommand` or `detectDaemonCommand` in `src/conductor/src/engine/daemon-command.ts`; for `ai-conductor compose`, `detectEngineerCommand` in `src/conductor/src/engine/engineer-cli.ts`).

**Files likely touched:**
- `src/conductor/test/remediation-guidance-source.test.ts` — source scanner and index.ts check
- `src/conductor/src/index.ts` — remaining guidance commands come from the builder/guidance module
- `src/conductor/src/remediation-commands.ts` — any additional closed-set kinds
- `src/conductor/src/remediation-guidance.ts` — guard and deprecation guidance text
- `src/conductor/test/remediation-commands.test.ts` — fixture coverage for added kinds

**Dependencies:** Tasks 3, 4

### Task 6: Episode stamp helpers and the shared HALT writer lifecycle
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-episode-stamp.test.ts` over a temp worktree root.
2. `writeEpisodeStamp(root, deadlineMs)` with a HALT present writes `.pipeline/HALT.episode` JSON containing `deadlineMs` and the sha256 hex digest of the current HALT body, and returns `{ status: 'written' }`; with an unwritable `.pipeline/` it returns `{ status: 'failed' }` without throwing.
3. `readEpisodeStamp(root)` returns `valid` with `deadlineMs` for a matching body; `invalid/digest-mismatch` after the HALT body is replaced; `invalid/halt-absent` when HALT is gone; `invalid/malformed` for empty or non-JSON content; `invalid/absent` with no stamp; it never throws.
4. `writeHaltMarker(root, body, 'mechanical')` on a root that already has `HALT.episode` leaves no `HALT.episode` after it returns, and the unlink happens before the new HALT body is written (assert by making the body write fail and observing the stamp already removed).
5. Verify RED, implement in `src/conductor/src/engine/halt-marker.ts` (`HALT_EPISODE_MARKER`, the three helpers, the extra unlink in `writeHaltMarker`'s pre-body step), verify GREEN, commit.

**Done when:**
- [test] `writeEpisodeStamp` writes `.pipeline/HALT.episode` holding `deadlineMs` and the sha256 digest of the current HALT body and returns `written`; on a write failure it returns `failed` and does not throw.
- [test] `readEpisodeStamp` returns `valid` for a matching body and `invalid` with reasons `digest-mismatch`, `halt-absent`, `malformed`, and `absent` for a replaced body, a missing HALT, empty or non-JSON content, and no stamp, never throwing.
- [test] `writeHaltMarker` removes an existing `HALT.episode` before writing the new HALT body: after a successful write no stamp exists, and when the body write is forced to fail the stamp is already gone.
- `HALT_EPISODE_MARKER` and all three stamp helpers are defined in `src/conductor/src/engine/halt-marker.ts`.

**Files likely touched:**
- `src/conductor/src/engine/halt-marker.ts` — stamp constant, helpers, writer unlink
- `src/conductor/test/engine/halt-episode-stamp.test.ts` — helper and writer-lifecycle tests

**Dependencies:** none

### Task 7: Clearing a HALT removes its episode stamp on every daemon clear path
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/halt-episode-stamp-clear.test.ts`: `clearMarker(root)` on a worktree with `HALT`, `HALT.class`, and `HALT.episode` leaves `HALT.cleared` and `REKICK`, and no `HALT`, `HALT.class`, or `HALT.episode`; on a worktree without a stamp it produces the same `HALT.cleared` + `REKICK` result as today and does not throw.
2. Add tests that drive the three daemon clear paths with real temp worktrees and the real `clearMarker`: `recoverEpisodeHalts` (episode recovery), `rekickSweep` (base-advance re-kick), and the operator rekick/authorized-resume path in `daemon-rekick.ts` that calls `deps.clearMarker(deps.worktreePath)`; each leaves no `HALT.episode`.
3. Verify RED, add `rm(join(worktreePath, HALT_EPISODE_MARKER), { force: true })` beside the class-sidecar removal in `clearMarker` (`src/conductor/src/engine/daemon-rekick.ts`), verify GREEN, commit.

**Done when:**
- [test] `clearMarker` on a stamped worktree leaves `HALT.cleared` and `REKICK` and removes `HALT`, `HALT.class`, and `HALT.episode`.
- [test] `clearMarker` on a worktree with no `HALT.episode` produces `HALT.cleared` and `REKICK` and removes `HALT` and `HALT.class` exactly as before, without throwing.
- [test] Episode recovery (`recoverEpisodeHalts`), the base-advance `rekickSweep`, and the operator rekick clear path each leave no `HALT.episode` in a stamped worktree they clear.

**Files likely touched:**
- `src/conductor/src/engine/daemon-rekick.ts` — `clearMarker` removes the stamp
- `src/conductor/test/engine/halt-episode-stamp-clear.test.ts` — clear-path tests

**Dependencies:** Task 6

### Task 8: Expose the rate-limit episode deadline read-only
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write failing tests in the existing rate-limit episode test file: `deadline()` returns `null` before `enter`, the entered `untilMs` while active, the later deadline after a later `enter`, and `null` after the deadline passes.
2. Verify RED, add `deadline(nowMs?)` to the `RateLimitEpisode` interface and implementation in `src/conductor/src/engine/rate-limit-episode.ts`, verify GREEN, commit.

**Done when:**
- [test] `RateLimitEpisode.deadline()` returns `null` before `enter`, the entered `untilMs` while active, and the later value after a later-deadline `enter`.
- [test] `RateLimitEpisode.deadline()` returns `null` once `nowMs` is at or past the deadline, matching `active()` returning false.

**Files likely touched:**
- `src/conductor/src/engine/rate-limit-episode.ts` — read-only deadline accessor
- `src/conductor/test/engine/rate-limit-episode.test.ts` — accessor tests

**Dependencies:** none

### Task 9: Durable sidecar-backed episode HALT tracker
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/episode-halt-tracker.test.ts` over a temp worktree base with real worktree dirs.
2. `onHaltWritten(slug, true, deadlineMs)` writes a valid stamp for that slug; `onHaltWritten(slug, false, deadlineMs)` writes no stamp; when `writeEpisodeStamp` returns `failed`, `onHaltWritten` logs the failure, resolves without throwing, and the slug is never returned by `listRecoverable`.
3. `listRecoverable(nowMs)` returns a slug whose stamp is valid and whose `deadlineMs <= nowMs`; does not return a slug whose deadline is in the future (and keeps its stamp); for a replaced HALT body, a missing HALT, and a malformed stamp, does not return the slug, removes the stamp, and leaves `HALT` untouched; the hand-clear sequence (stamp → `rm -f HALT HALT.class` → a different HALT body written by a non-shared writer) is not returned and the new HALT is unchanged.
4. A new tracker instance constructed over the same worktree base (simulated restart) returns the same recoverable slugs.
5. Verify RED, rewrite `src/conductor/src/engine/episode-halt-tracker.ts` as the sidecar-backed store (remove the in-memory `Set`), verify GREEN, commit.

**Done when:**
- [test] `onHaltWritten(slug, true, d)` writes a valid `HALT.episode` for the slug, `onHaltWritten(slug, false, d)` writes none, and a `failed` stamp write is logged, does not throw, and the slug is never returned by `listRecoverable`.
- [test] `listRecoverable(now)` returns a valid-stamp slug once its deadline is at or before `now`, and omits it while the deadline is in the future without removing its stamp.
- [test] `listRecoverable` omits and removes the stamp for a replaced HALT body, a missing HALT, and a malformed stamp, and leaves each worktree's `HALT` file byte-identical.
- [test] After stamping, `rm -f HALT HALT.class`, and writing a different HALT body, `listRecoverable` omits the slug, removes the stamp, and the new HALT is byte-identical.
- [test] A second tracker instance over the same worktree base returns the same recoverable slugs as the first, proving no in-memory state is required.

**Files likely touched:**
- `src/conductor/src/engine/episode-halt-tracker.ts` — sidecar-backed tracker
- `src/conductor/test/engine/episode-halt-tracker.test.ts` — tracker tests

**Dependencies:** Task 6

### Task 10: Recover stamped HALTs at startup and idle ticks with operator precedence
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-maintenance.test.ts`: `startup` invokes the episode recovery callback once; `afterIdlePoll` invokes it on every tick while `isEpisodeActive()` is false and never while it is true.
2. Write failing tests in `src/conductor/test/engine/episode-halt-recovery.test.ts` over real temp worktrees using `recoverEpisodeHalts` with the real `clearMarker` and `readRawHaltClass`: a `mechanical` class is cleared and logs `episode-end sweep: re-kicked <slug> (episode-caused HALT cleared)`; an operator-parked slug is left and logs the existing operator-parked line; a `needs-human` class is left and logs `retained — halt disposition needs-human`; an absent `HALT.class` and an unreadable one (a directory at that path) are each left and log `retained — halt disposition unclassified`.
3. Add a test wiring `stampedHalts` to a real durable tracker (Task 9) over a stamped worktree whose `HALT` was deleted: assert no `REKICK`, no `HALT.cleared`, and no stamp remain.
4. Add a test where the first of three stamped slugs throws from `readHaltClass`: the error is logged naming the slug, that HALT stays, and the other two are still evaluated (one cleared, one retained).
5. Verify RED; in `src/conductor/src/engine/daemon-rekick.ts` pass `{ retainUnclassified: true }` to `resolveHaltRetention` in `recoverEpisodeHalts` and wrap each slug in try/catch; in `src/conductor/src/engine/daemon-maintenance.ts` run the episode recovery at `startup` and on each idle tick while no episode is active; verify GREEN, commit.

**Done when:**
- [test] `DaemonMaintenance.startup` invokes the episode recovery callback once, and `afterIdlePoll` invokes it on every tick where `isEpisodeActive()` is false and on no tick where it is true.
- [test] `recoverEpisodeHalts` clears a `mechanical`-classed stamped HALT through `clearMarker` and logs the re-kick line naming the slug.
- [test] `recoverEpisodeHalts` makes no `clearMarker` call for an operator-parked slug (logging `operator-parked — left for a human`), a `needs-human` class (logging `retained — halt disposition needs-human`), and an absent or unreadable class (logging `retained — halt disposition unclassified`).
- [test] When evaluating one stamped slug throws, `recoverEpisodeHalts` logs an error naming that slug, leaves its HALT in place, and still evaluates every remaining stamped slug.
- [test] A recovery pass whose `stampedHalts` is the durable tracker's `listRecoverable` over a stamped worktree whose `HALT` is absent writes no `REKICK` and no `HALT.cleared`, makes no `clearMarker` call, and removes the stamp.

**Files likely touched:**
- `src/conductor/src/engine/daemon-rekick.ts` — retain unclassified; per-slug isolation
- `src/conductor/src/engine/daemon-maintenance.ts` — startup and idle-tick recovery trigger
- `src/conductor/test/engine/daemon-maintenance.test.ts` — trigger tests
- `src/conductor/test/engine/episode-halt-recovery.test.ts` — precedence and isolation tests

**Dependencies:** Task 9

### Task 11: Wire durable episode recovery into the daemon and prove it across a restart
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing daemon-level tests in `src/conductor/test/engine/daemon-episode-restart.test.ts` using `runDaemon` with real temp worktrees, vitest fake timers (`vi.useFakeTimers()` / `vi.setSystemTime`) controlling `Date.now` so the clock reaches both the episode and `listRecoverable`, and the production `daemon-cli.ts` tracker factory: (a) a feature returns `halted` while an injected episode is active with deadline D; (b) assert `HALT.episode` exists with `deadlineMs: D`; (c) discard the daemon, tracker, and episode; start a new `runDaemon` with now > D and assert after startup that `HALT.cleared` and `REKICK` exist and the slug is picked by `pickEligible` on the next iteration.
2. Variant: force the stamp write to fail (unwritable stamp path); assert the feature is parked, not re-dispatched, `HALT`/`HALT.class` unchanged, and the daemon loop continues.
3. Variant: restart with now < D; assert the HALT is unchanged after startup; advance the system time past D with `vi.setSystemTime` and run one idle tick with no episode active; assert `HALT.cleared` and `REKICK`.
4. Variant: no restart; the episode ends in-process; assert the HALT is recovered on the next idle tick (today's behavior preserved).
5. Variant: a feature halts while no episode is active; after restart past any deadline the HALT is unchanged and no stamp exists.
6. Update `src/conductor/test/engine/daemon-cli-episode-halt-wiring.test.ts` to assert `daemon-cli.ts` constructs the durable tracker with `worktreeBase` and threads `listRecoverable` into `recoverEpisodeHalts`.
7. Verify RED; in `src/conductor/src/engine/daemon.ts` pass `deps.rateLimitEpisode?.deadline?.()` into `onHaltWritten` at the park-collection point; in `src/conductor/src/daemon-cli.ts` construct the durable tracker with `worktreeBase` and log sink and supply `stampedHalts: () => tracker.listRecoverable(Date.now())`; verify GREEN, commit.

**Done when:**
- [test] After a feature halts during an active episode with deadline D, `runDaemon` leaves `.pipeline/HALT.episode` with `deadlineMs` equal to D in that worktree; when the stamp write is forced to fail, the feature is still parked (not re-dispatched), its `HALT` and `HALT.class` are byte-identical, and the daemon keeps running.
- [test] A fresh `runDaemon` started after D clears that HALT at startup through `clearMarker` (`HALT.cleared` and `REKICK` present, `HALT` absent) and the slug is eligible for re-dispatch on the next iteration.
- [test] A fresh `runDaemon` started before D leaves the HALT byte-identical after startup, then clears it through `clearMarker` on the first idle tick after D with no episode active.
- [test] Without a restart, an in-process episode end recovers the stamped HALT through `clearMarker` (`HALT.cleared` and `REKICK` present, `HALT` absent) on the first idle tick after the episode ends, the same tick today's episode-end sweep runs; a HALT written with no episode active has no stamp and is byte-identical after a restart past every deadline.
- [test] `daemon-cli-episode-halt-wiring.test.ts` asserts `daemon-cli.ts` builds the durable tracker over `worktreeBase` and passes its `listRecoverable` result as `stampedHalts` to `recoverEpisodeHalts`.

**Files likely touched:**
- `src/conductor/src/engine/daemon.ts` — pass episode deadline into `onHaltWritten`
- `src/conductor/src/daemon-cli.ts` — construct durable tracker; wire `listRecoverable`
- `src/conductor/test/engine/daemon-episode-restart.test.ts` — restart integration tests
- `src/conductor/test/engine/daemon-cli-episode-halt-wiring.test.ts` — wiring assertions

**Dependencies:** Tasks 7, 8, 10

## Task Dependency Graph

```
Item 1:  Task 1 → Task 2 → Task 3 ─┐
                         └→ Task 4 ─┴→ Task 5
Item 3:  Task 6 → Task 7 ───────────────┐
         Task 6 → Task 9 → Task 10 ─────┼→ Task 11
         Task 8 ────────────────────────┘
```

## Integration Points

- After Task 3: the orphaned-state guidance is observable end-to-end through the real binary.
- After Task 4: every guidance path in `index.ts` is proven through the real binary.
- After Task 11: episode-caused HALT recovery is observable across a daemon restart through `runDaemon` with the production tracker wiring.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a worktree with orphaned conductor state, when the operator runs `ai-conductor inline --diagnose`, then the printed reset instruction is `ai-conductor inline --reset` and running that exact command is not refused by the bare-form guard. | 3 | "prints `ai-conductor inline --reset`, and spawning the printed command's argv on the fixture produces no bare-form guard refusal text" | diff-local |
| Story 1 happy: Given orphaned state whose recorded worktree is missing, when the conductor refuses to continue, then its numbered option 2 instructs `ai-conductor inline --reset` and that exact command is not refused by the bare-form guard. | 3 | "prints option 2 with `ai-conductor inline --reset`, and spawning that printed command's argv produces no bare-form guard refusal text" | diff-local |
| Story 1 happy: Given a SHIP-phase evidence gap for a named feature, when the gap report prints its roll-back and inspect instructions, then they read `ai-conductor inline "<feature>"` and `ai-conductor inline --status` and both are accepted by the CLI. | 4 | "prints `ai-conductor inline "shipx"` and `ai-conductor inline --status`, and both pass `assertAcceptedByCli`" | diff-local |
| Story 1 happy: Given the operator declines the recovery prompt, when the conductor prints its inspect and start-over instructions, then they read `ai-conductor inline --status` and `ai-conductor inline --fresh "<feature>"` and both are accepted by the CLI. | 4 | "prints `ai-conductor inline --status` and `ai-conductor inline --fresh "shipx"`" | diff-local |
| Story 1 negative: Given any of the four guidance paths above, when its output is captured, then it contains no bare `ai-conductor --reset`, `ai-conductor --status`, `ai-conductor --fresh`, or `ai-conductor "<feature>"` form that the bare-form guard rejects. | 3, 4 | "contains no match for the bare-form regex" | diff-local |
| Story 1 negative: Given a SHIP-phase evidence gap with no named feature, when the gap report prints its roll-back instruction, then the command still includes the `inline` subcommand and contains no empty quoted argument. | 4 | "prints a roll-back command containing `ai-conductor inline` with no `""` token, and it passes `assertAcceptedByCli`" | diff-local |
| Story 1 negative: Given the operator declines the recovery prompt with no feature description recorded, when the start-over instruction prints, then it reads `ai-conductor inline --fresh` with no trailing empty quoted argument and is accepted by the CLI. | 4 | "the no-feature variant prints `ai-conductor inline --fresh` with no trailing `""`; every printed command passes `assertAcceptedByCli`" | diff-local |
| Story 2 happy: Given the closed set of remediation commands the CLI's guidance may print, when the default test tier runs, then every command in the set is proven accepted by the same grammar the operator's invocation takes (`detectInline` then `parseArgs` for inline commands, or the dispatching subcommand's own parser for commands dispatched before the guard). | 1, 5 | "passes `assertAcceptedByCli` (detectInline reports inline and parseArgs does not throw) for every member of `REMEDIATION_COMMAND_FIXTURES`" | diff-local |
| Story 2 happy: Given every guidance site in `index.ts` obtains its command from that closed set, when the default test tier runs, then the guidance-literal source check passes. | 5 | "over the current `src/conductor/src/index.ts` returns an empty list" | diff-local |
| Story 2 negative: Given a member of the closed set is changed to a form the bare-form guard rejects (for example `ai-conductor --reset`), when the default test tier runs, then the parse test fails naming that command. | 1 | "throws an error whose message contains the text `ai-conductor --reset`, so a closed-set member changed to that form fails the enumeration test naming the command" | diff-local |
| Story 2 negative: Given a guidance string in `index.ts` hand-writes an `ai-conductor …` or `conduct …` command instead of obtaining it from the closed set, when the default test tier runs, then the source check fails naming the offending line. | 5 | "reports a `console.error` fixture literal containing `ai-conductor --reset` and one containing `conduct daemon park x`, each with its line number and text" | diff-local |
| Story 2 negative: Given a member of the closed set requires an argument (for example a feature description), when it is produced without one, then the result either omits the argument cleanly or is rejected at production time; it never yields a command the CLI refuses. | 1 | "returns exactly `ai-conductor inline` and `ai-conductor inline --fresh` (no `""` token) for an absent or empty feature, and each is accepted by `assertAcceptedByCli`" | diff-local |
| Story 3 happy: Given a feature was parked with a HALT while a rate-limit episode was active and the daemon then restarted, when the restarted daemon starts after the recorded episode deadline has passed, then that feature's HALT is cleared through the existing rekick path (HALT preserved to `HALT.cleared`, `REKICK` sentinel written) and the feature becomes eligible for re-dispatch. | 11 | "started after D clears that HALT at startup through `clearMarker` (`HALT.cleared` and `REKICK` present, `HALT` absent) and the slug is eligible for re-dispatch on the next iteration" | diff-local |
| Story 3 happy: Given a feature was parked with an episode-caused HALT and the daemon restarted before the recorded deadline, when an idle tick occurs after the deadline has passed with no episode active, then that HALT is cleared through the existing rekick path. | 11 | "then clears it through `clearMarker` on the first idle tick after D with no episode active" | diff-local |
| Story 3 happy: Given a feature was parked with an episode-caused HALT whose stamp was written and whose `HALT.class` disposition the shared halt-retention rule does not retain, and the daemon did not restart, when the episode ends, then that HALT is recovered through the existing rekick path (HALT preserved to `HALT.cleared`, `REKICK` sentinel written) on the first idle tick after the episode ends. | 11 | "Without a restart, an in-process episode end recovers the stamped HALT through `clearMarker` (`HALT.cleared` and `REKICK` present, `HALT` absent) on the first idle tick after the episode ends, the same tick today's episode-end sweep runs" | diff-local |
| Story 3 negative: Given a restarted daemon and a stamped HALT whose recorded deadline has not yet passed, when startup recovery runs, then the HALT is left in place and is not re-kicked. | 11, 9 | "started before D leaves the HALT byte-identical after startup" | diff-local |
| Story 3 negative: Given a stamped HALT and an episode that is active in the current process, when an idle tick occurs, then the HALT is left in place until no episode is active. | 10 | "on no tick where it is true" | diff-local |
| Story 3 negative: Given a feature halted while no rate-limit episode was active, when the daemon restarts and recovery runs, then that HALT is not cleared. | 11, 9 | "a HALT written with no episode active has no stamp and is byte-identical after a restart past every deadline" | diff-local |
| Story 3 negative: Given recovery of one stamped worktree fails (for example its stamp is unreadable), when recovery runs over several stamped worktrees, then the failure is logged, that HALT is left in place, and the remaining stamped HALTs are still evaluated. | 10 | "When evaluating one stamped slug throws, `recoverEpisodeHalts` logs an error naming that slug, leaves its HALT in place, and still evaluates every remaining stamped slug" | diff-local |
| Story 4 happy: Given a stamped HALT whose body is unchanged since it was stamped, when recovery runs past the deadline with no episode active, then the HALT is recovered. | 9, 10 | "returns a valid-stamp slug once its deadline is at or before `now`" | diff-local |
| Story 4 negative: Given an operator cleared a stamped HALT by hand (`rm -f .pipeline/HALT .pipeline/HALT.class`) and a different HALT was later written in that worktree, when recovery runs, then the later HALT is left in place and the leftover stamp is discarded. | 9 | "After stamping, `rm -f HALT HALT.class`, and writing a different HALT body, `listRecoverable` omits the slug, removes the stamp, and the new HALT is byte-identical" | diff-local |
| Story 4 negative: Given a stamped HALT whose body was replaced by a different body, when recovery runs, then the HALT is left in place and the stamp is discarded. | 9 | "omits and removes the stamp for a replaced HALT body, a missing HALT, and a malformed stamp, and leaves each worktree's `HALT` file byte-identical" | diff-local |
| Story 4 negative: Given a stamp whose HALT no longer exists, when recovery runs, then nothing is cleared, no `REKICK` sentinel is written, and the stamp is discarded. | 10, 9 | "over a stamped worktree whose `HALT` is absent writes no `REKICK` and no `HALT.cleared`, makes no `clearMarker` call, and removes the stamp" | diff-local |
| Story 4 negative: Given a stamp file that is empty or malformed, when recovery runs, then the HALT is left in place for a human and no exception escapes the recovery pass. | 9, 6 | "omits and removes the stamp for a replaced HALT body, a missing HALT, and a malformed stamp, and leaves each worktree's `HALT` file byte-identical" | diff-local |
| Story 5 happy: Given a stamped HALT on a feature that is not operator-parked and whose `HALT.class` disposition the shared halt-retention rule does not retain, when recovery runs past the deadline with no episode active, then the HALT is recovered and the daemon log records the re-kick. | 10 | "clears a `mechanical`-classed stamped HALT through `clearMarker` and logs the re-kick line naming the slug" | diff-local |
| Story 5 negative: Given a stamped HALT on an operator-parked feature, when startup or idle recovery runs, then the HALT is left in place and the daemon log records that the feature is operator-parked and left for a human. | 10 | "makes no `clearMarker` call for an operator-parked slug (logging `operator-parked — left for a human`)" | diff-local |
| Story 5 negative: Given a stamped HALT whose `HALT.class` is an operator-action class (for example needs-human), when startup or idle recovery runs, then the HALT is left in place and the daemon log names the disposition that blocked the clear. | 10 | "a `needs-human` class (logging `retained — halt disposition needs-human`)" | diff-local |
| Story 5 negative: Given a stamped HALT whose `HALT.class` is missing or unreadable, when startup or idle recovery runs, then the HALT is left in place and the daemon log names the disposition that blocked the clear. | 10 | "an absent or unreadable class (logging `retained — halt disposition unclassified`)" | diff-local |
| Story 6 happy: Given a feature parked during an active episode, when the park completes, then its worktree carries a stamp recording the episode deadline and identifying the current HALT. | 11, 9 | "leaves `.pipeline/HALT.episode` with `deadlineMs` equal to D in that worktree" | diff-local |
| Story 6 happy: Given a stamped HALT, when it is cleared by any daemon path that clears HALTs (episode recovery, base-advance rekick, operator rekick), then the stamp is removed together with `HALT` and `HALT.class`. | 7 | "Episode recovery (`recoverEpisodeHalts`), the base-advance `rekickSweep`, and the operator rekick clear path each leave no `HALT.episode`" | diff-local |
| Story 6 happy: Given a stamped worktree, when the shared HALT writer writes a new HALT there, then the old stamp is removed before the new HALT body is written. | 6 | "removes an existing `HALT.episode` before writing the new HALT body" | diff-local |
| Story 6 negative: Given a feature parked while no episode is active, when the park completes, then no stamp is written. | 9 | "`onHaltWritten(slug, false, d)` writes none" | diff-local |
| Story 6 negative: Given writing the stamp fails, when the park completes, then the park and HALT are unaffected, the failure does not crash the daemon, and the HALT is treated as not auto-recoverable. | 11, 9 | "when the stamp write is forced to fail, the feature is still parked (not re-dispatched), its `HALT` and `HALT.class` are byte-identical, and the daemon keeps running" | diff-local |
| Story 6 negative: Given clearing a HALT whose worktree has no stamp, when the clear runs, then it succeeds exactly as it does today. | 7 | "on a worktree with no `HALT.episode` produces `HALT.cleared` and `REKICK` and removes `HALT` and `HALT.class` exactly as before, without throwing" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-10-durable-episode-halt-stamp#D1 | task | task-6, task-9, task-11 | `writeEpisodeStamp` writes `.pipeline/HALT.episode` holding `deadlineMs` and the sha256 digest of the current HALT body and returns `written` |
| adr-2026-10-10-durable-episode-halt-stamp#D2 | task | task-6, task-7 | `writeHaltMarker` removes an existing `HALT.episode` before writing the new HALT body |
| adr-2026-10-10-durable-episode-halt-stamp#D3 | task | task-9 | `listRecoverable` omits and removes the stamp for a replaced HALT body, a missing HALT, and a malformed stamp |
| adr-2026-10-10-durable-episode-halt-stamp#D4 | task | task-10, task-11 | `DaemonMaintenance.startup` invokes the episode recovery callback once, and `afterIdlePoll` invokes it on every tick where `isEpisodeActive()` is false |
| adr-2026-10-10-durable-episode-halt-stamp#D5 | task | task-10 | `recoverEpisodeHalts` makes no `clearMarker` call for an operator-parked slug |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
