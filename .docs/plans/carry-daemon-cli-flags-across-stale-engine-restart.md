# Implementation Plan: Carry daemon CLI flags across stale-engine restart

**Date:** 2026-09-28
**Stories:** .docs/stories/carry-daemon-cli-flags-across-stale-engine-restart.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change is confined to the daemon argv parser and the session-hosted self-restart closure, and leaves the operator restart verbs, bare-run exit, and config-sourced command construction unchanged.

## Summary

Two bounded tasks deliver #2366. Task 1 makes the daemon argv parser record the operator's recognized run-flag tokens. Task 2 makes the stale-engine self-restart closure append those tokens, shell-quoted, to the config-resolved foreground command before it is wrapped and respawned. The respawned process receives the flags on its own argv, so it re-captures and re-replays them at its next restart, keeping them in force for the lineage and keeping concurrency provenance at source flag. Operator `daemon start`/`daemon restart` verbs, bare-run restarts, persisted settings, and new flags are outside this slice.

## Technical Approach

Add an optional `operatorFlagArgs?: string[]` field to `DaemonCommandOptions` in daemon-command.ts, and populate it in `detectDaemonCommand` from the argv it already receives. Capture uses a fixed, closed table in this order: value flags `--concurrency`, `--max-items`, `--max-cost`, `--max-runtime`, `--idle-poll`, `--max-idle-polls`; then boolean flags `--no-watch`, `--completed`, `--all`. For a value flag present in argv, emit the flag followed by the raw token the existing `flagValue` helper returns; when `flagValue` returns null (flag present but no value), emit the bare flag so the respawned parser reaches the same result (for `--concurrency` that preserves `concurrencyExplicit`). For a boolean flag present in argv, emit the flag. Each flag is emitted at most once. `--continuous` is not captured because the canonical foreground command already carries it. Tokens outside the table are never captured. Replaying raw tokens rather than re-serializing parsed numbers keeps the respawned parse identical to the original, including the parser's own fallback for an unparseable value.

In index.ts `buildDaemonModeOptions`, the `triggerSelfRestart` closure appends `daemonCmd.operatorFlagArgs`, each token passed through the existing `shellQuote` from canonical-launcher.ts and joined with single spaces, to the command returned by `resolveDaemonForegroundCommand`, then hands the result to `buildDaemonExitWitnessCommand` and `respawnPane` exactly as today. An empty or absent list leaves the command byte-for-byte unchanged. The mechanism that makes metacharacter injection impossible is `shellQuote`, which single-quotes every token and escapes embedded single quotes.

No event, log line, or channel is added (event-spine: not applicable). The existing scan line already reports the source, and it now reports source flag after a restart because the replayed argv sets `concurrencyExplicit`.

Tests follow the write-tests skill. Task 1 is unit-level over the pure parser and resolver. Task 2 extends the existing index.ts wiring describe block in daemon-restart-wiring.test.ts, injecting `sessionNameForRepo`, `hasSession`, `respawnPane`, `resolveDaemonForegroundCommand`, and `buildDaemonExitWitnessCommand` fakes; no tmux, process, or network is touched.

## Preconditions and claim ledger

- Operator approved Small scope, argv replay over pid-record persistence, technical track, and both stories on 2026-09-28 (delegated).
- Verified: `src/conductor/src/engine/daemon-command.ts` defines `DaemonCommandOptions`, `flagValue`, `intFlag`, `resolveDaemonCommandConcurrency`, and `detectDaemonCommand`, which reads exactly the flags in the capture table plus `--continuous`; the module currently has no imports.
- Verified: `src/conductor/src/index.ts` `buildDaemonModeOptions` builds `triggerSelfRestart` from `resolveDaemonForegroundCommand(projectRoot)`, `buildDaemonExitWitnessCommand`, and `respawnPane`, and ignores `daemonCmd` inside the closure; `main` calls it with `detectDaemonCommand(process.argv)`.
- Verified: `buildDaemonForegroundCommand` in `src/conductor/src/engine/daemon-tmux.ts` ends with `daemon --continuous` and carries no other flag.
- Verified: `shellQuote` is exported from `src/conductor/src/engine/canonical-launcher.ts` and single-quotes one value with embedded-quote escaping.
- Verified: `src/conductor/test/engine/daemon-command.test.ts` has an exact `toEqual` on `detectDaemonCommand(argv('daemon'))` that must gain `operatorFlagArgs: []`; `src/conductor/test/engine/daemon-restart-wiring.test.ts` holds the `buildDaemonModeOptions` wiring describe block with injected fakes.
- Verified: `daemon-cli.ts` resolves concurrency via `resolveDaemonCommandConcurrency(opts, config?.daemon_concurrency)`, so provenance follows `concurrencyExplicit` on the respawned argv.
- Scope check: consumer-facing engine code only; no skill; provider-agnostic; no CLI flag, hook, settings schema, or symlink change, so no migration block.
- Verify-claims verdict: CLEAR. No pending product or scope assumption.

## Tasks

### Task 1: Capture recognized daemon run flags in the parsed options
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/daemon-command.ts, src/conductor/test/engine/daemon-command.test.ts
**Dependencies:** none

**Steps:**
1. Write RED unit cases in daemon-command.test.ts: all eight recognized run flags captured in table order; replayed argv resolving concurrency 3 source flag against configured 2; flag-free argv giving an empty list and source config; an unrecognized flag and positional token excluded. Update the existing exact `toEqual` for bare `daemon` to include an empty `operatorFlagArgs`.
2. Add the optional `operatorFlagArgs` field and populate it in `detectDaemonCommand` using the closed capture table and the existing `flagValue` helper as described in the Technical Approach.
3. Run the focused file through ai-conductor scoped-run to GREEN, run the typecheck that covers tests, and commit.

**Done when:**
1. A unit case parsing argv with all eight recognized run flags asserts operatorFlagArgs equals the exact expected token list, with each flag once and each value-taking flag followed by its value.
2. A unit case parses `daemon --continuous` plus the captured operatorFlagArgs and asserts resolveDaemonCommandConcurrency with configured 2 returns concurrency 3 and source flag.
3. A unit case for argv `daemon --continuous` asserts operatorFlagArgs is an empty array and resolveDaemonCommandConcurrency with configured 2 returns concurrency 2 and source config.
4. A unit case with an unrecognized `--bogus` flag and a stray positional token asserts neither token is in operatorFlagArgs.

### Task 2: Replay captured flags on the stale-engine respawn command
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/index.ts, src/conductor/test/engine/daemon-restart-wiring.test.ts
**Dependencies:** 1

**Steps:**
1. Write RED wiring cases in the existing buildDaemonModeOptions describe block with a recording exit-witness builder fake: captured `--concurrency 3 --max-runtime 3600`; empty list; absent field; a `1;touch pwned` value.
2. In the `triggerSelfRestart` closure, append the shell-quoted `daemonCmd.operatorFlagArgs` tokens to the resolved foreground command before wrapping, leaving the command untouched when the list is empty or absent.
3. Run the focused file through ai-conductor scoped-run to GREEN, run the typecheck that covers tests, and commit.

**Done when:**
1. A wiring test with operatorFlagArgs `--concurrency 3 --max-runtime 3600` asserts the exit-witness builder receives the resolved foreground command followed by the four single-quoted tokens and respawnPane receives the builder output.
2. Wiring tests with an empty operatorFlagArgs and with the field absent assert the exit-witness builder receives the resolved foreground command byte-for-byte.
3. A wiring test with a captured value `1;touch pwned` asserts the command contains `'1;touch pwned'` as one single-quoted word and no unquoted `;touch`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given daemon argv containing `--concurrency 3`, `--max-items 5`, `--max-cost 50000`, `--max-runtime 3600`, `--idle-poll 30`, `--max-idle-polls 4`, `--no-watch`, and `--completed`, when detectDaemonCommand parses it, then the parsed options carry an operator flag list holding each of those flags exactly once, with every value-taking flag immediately followed by its value. | 1 | "A unit case parsing argv with all eight recognized run flags asserts operatorFlagArgs equals the exact expected token list, with each flag once and each value-taking flag followed by its value." | diff-local |
| Story 1 happy: Given the argv formed by appending the captured operator flag list to `daemon --continuous`, when detectDaemonCommand parses it and concurrency is resolved against a configured value of 2, then the resolution is concurrency 3 with source flag. | 1 | "A unit case parses `daemon --continuous` plus the captured operatorFlagArgs and asserts resolveDaemonCommandConcurrency with configured 2 returns concurrency 3 and source flag." | diff-local |
| Story 1 negative: Given daemon argv with no run flags other than `--continuous`, when detectDaemonCommand parses it, then the operator flag list is empty and concurrency resolved against a configured value of 2 is concurrency 2 with source config. | 1 | "A unit case for argv `daemon --continuous` asserts operatorFlagArgs is an empty array and resolveDaemonCommandConcurrency with configured 2 returns concurrency 2 and source config." | diff-local |
| Story 1 negative: Given daemon argv that also contains an unrecognized flag and a stray positional token, when detectDaemonCommand parses it, then neither token appears in the operator flag list. | 1 | "A unit case with an unrecognized `--bogus` flag and a stray positional token asserts neither token is in operatorFlagArgs." | diff-local |
| Story 2 happy: Given a session-hosted daemon whose parsed options carry the operator flags `--concurrency 3` and `--max-runtime 3600`, when its triggerSelfRestart fires, then the command handed to the exit-witness builder is the resolved foreground command followed by those flags and values, and respawnPane receives the wrapped result. | 2 | "A wiring test with operatorFlagArgs `--concurrency 3 --max-runtime 3600` asserts the exit-witness builder receives the resolved foreground command followed by the four single-quoted tokens and respawnPane receives the builder output." | diff-local |
| Story 2 negative: Given a session-hosted daemon whose operator flag list is empty or absent, when its triggerSelfRestart fires, then the command handed to the exit-witness builder is the resolved foreground command byte-for-byte. | 2 | "Wiring tests with an empty operatorFlagArgs and with the field absent assert the exit-witness builder receives the resolved foreground command byte-for-byte." | diff-local |
| Story 2 negative: Given a captured flag value containing shell metacharacters such as `1;touch pwned`, when triggerSelfRestart fires, then that value appears in the command as one single-quoted shell word. | 2 | "A wiring test with a captured value `1;touch pwned` asserts the command contains `'1;touch pwned'` as one single-quoted word and no unquoted `;touch`." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the pure parser and concurrency-resolution unit cases, including the replayed-argv lineage case that proves source flag survives a restart. Task 2 owns the index.ts self-restart wiring through injected tmux, config, and witness fakes, including the unchanged-command and quoting cases. No real tmux, process, provider, or network boundary is reached, and no aggregate or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2

Small tier: architecture, conflict-check, and coherence artifacts are skipped. No ADR is created or amended.
