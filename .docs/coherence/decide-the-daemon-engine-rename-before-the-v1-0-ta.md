# Coherence Mapping: implement the daemon→Player and engineer→Composer rename

Technical track (no PRD, so no `fr` rows). Outcomes are the eight bullets in the committed
intake marker, including the operator amendment. Criterion quotes are verbatim normalized
substrings of cited plan-task bodies. Every criterion is decided by this feature's own diff.

| Row class | Cited id / criterion | Counterpart / task id(s) | Verdict | Notes / verbatim quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | The approved ADR selects Player and Composer and the stories implement that choice. |
| outcome | outcome-2 | story-1, story-2, story-3, story-4 | covered | The renamed CLI, skill, config, and state surfaces are implemented in this feature and sequenced with the v1 major. |
| outcome | outcome-3 | story-1 | covered | Conditional branch not taken: the approved ADR selected rename rather than re-defer. |
| outcome | outcome-4 | story-1, story-2, story-3, story-4 | covered | The complete rename is bound to this pre-v1 implementation spec and closes the originating decision. |
| outcome | outcome-5 | story-1, story-2, story-3, story-4 | covered | The replacement stories and plan build the rename rather than a later scoping-only feature. |
| outcome | outcome-6 | story-1, story-2 | covered | Player and Composer are canonical; Daemon and Engineer remain warning compatibility aliases. |
| outcome | outcome-7 | story-3, story-4 | covered | Legacy config normalization and guarded old-only state migration preserve existing behavior without overwriting ambiguity. |
| outcome | outcome-8 | story-1, story-2, story-3, story-4 | covered | All four stories are functional behavior; upkeep is not represented as a story or standalone task. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5, task-6, task-7, task-8, task-9, task-10 | covered | Tasks 1 through 10 cite Story 1 and implement Player CLI behavior. |
| story | story-2 | task-11, task-12, task-13, task-14, task-15, task-16, task-17, task-18, task-19 | covered | Tasks 11 through 19 cite Story 2 and implement Composer CLI and skill behavior. |
| story | story-3 | task-20, task-21, task-22, task-23, task-24, task-25 | covered | Tasks 20 through 25 cite Story 3 and implement config normalization. |
| story | story-4 | task-26, task-27, task-28, task-29, task-30, task-31, task-32, task-33, task-34, task-35, task-36, task-37, task-38 | covered | Tasks 26 through 38 cite Story 4 and implement state resolution and migration. |
| task | task-1 | story-1 | covered | Task 1 explicitly cites Story 1. |
| task | task-2 | story-1 | covered | Task 2 explicitly cites Story 1. |
| task | task-3 | story-1 | covered | Task 3 explicitly cites Story 1. |
| task | task-4 | story-1 | covered | Task 4 explicitly cites Story 1. |
| task | task-5 | story-1 | covered | Task 5 explicitly cites Story 1. |
| task | task-6 | story-1 | covered | Task 6 explicitly cites Story 1. |
| task | task-7 | story-1 | covered | Task 7 explicitly cites Story 1. |
| task | task-8 | story-1 | covered | Task 8 explicitly cites Story 1. |
| task | task-9 | story-1 | covered | Task 9 explicitly cites Story 1. |
| task | task-10 | story-1 | covered | Task 10 explicitly cites Story 1. |
| task | task-11 | story-2 | covered | Task 11 explicitly cites Story 2. |
| task | task-12 | story-2 | covered | Task 12 explicitly cites Story 2. |
| task | task-13 | story-2 | covered | Task 13 explicitly cites Story 2. |
| task | task-14 | story-2 | covered | Task 14 explicitly cites Story 2. |
| task | task-15 | story-2 | covered | Task 15 explicitly cites Story 2. |
| task | task-16 | story-2 | covered | Task 16 explicitly cites Story 2. |
| task | task-17 | story-2 | covered | Task 17 explicitly cites Story 2. |
| task | task-18 | story-2 | covered | Task 18 explicitly cites Story 2. |
| task | task-19 | story-2 | covered | Task 19 explicitly cites Story 2. |
| task | task-20 | story-3 | covered | Task 20 explicitly cites Story 3. |
| task | task-21 | story-3 | covered | Task 21 explicitly cites Story 3. |
| task | task-22 | story-3 | covered | Task 22 explicitly cites Story 3. |
| task | task-23 | story-3 | covered | Task 23 explicitly cites Story 3. |
| task | task-24 | story-3 | covered | Task 24 explicitly cites Story 3. |
| task | task-25 | story-3 | covered | Task 25 explicitly cites Story 3. |
| task | task-26 | story-4 | covered | Task 26 explicitly cites Story 4. |
| task | task-27 | story-4 | covered | Task 27 explicitly cites Story 4. |
| task | task-28 | story-4 | covered | Task 28 explicitly cites Story 4. |
| task | task-29 | story-4 | covered | Task 29 explicitly cites Story 4. |
| task | task-30 | story-4 | covered | Task 30 explicitly cites Story 4. |
| task | task-31 | story-4 | covered | Task 31 explicitly cites Story 4. |
| task | task-32 | story-4 | covered | Task 32 explicitly cites Story 4. |
| task | task-33 | story-4 | covered | Task 33 explicitly cites Story 4. |
| task | task-34 | story-4 | covered | Task 34 explicitly cites Story 4. |
| task | task-35 | story-4 | covered | Task 35 explicitly cites Story 4. |
| task | task-36 | story-4 | covered | Task 36 explicitly cites Story 4. |
| task | task-37 | story-4 | covered | Task 37 explicitly cites Story 4. |
| task | task-38 | story-4 | covered | Task 38 explicitly cites Story 4. |
| adr | adr-2026-08-26-music-vocabulary-player-composer-rename | story-1, story-2, story-3, story-4 | covered | All stories implement the approved ADR and its 2026-08-26 operator amendment. |
| criterion | Story 1 happy: Given any currently supported worker invocation (bare run, `status`, `logs`, `park`, `unpark`, `reclaim-worktree`, `start`, `stop`, `restart`, `pause`, `resume`, `connect`, or `debug`), when `player` is used as the command name, then it reaches the same typed dispatch and runtime behavior as the corresponding pre-rename invocation. | task-1, task-2, task-3, task-4 | covered | Bare `player` and supported run flags produce the existing worker-run descriptor. | diff-local |
| criterion | Story 1 happy: Given `conduct-ts player --help` or subcommand help, when help renders, then the full supported surface is present and operator-facing command names, headings, and examples use `player`. | task-5 | covered | The full supported surface is present in canonical Player help. | diff-local |
| criterion | Story 1 happy: Given a valid legacy `daemon` invocation, when it is dispatched, then it forwards through the Player compatibility boundary, behaves identically, and writes exactly one deprecation warning to stderr for that invocation. | task-8 | covered | A valid legacy Daemon invocation behaves identically to Player. | diff-local |
| criterion | Story 1 happy: Given a canonical `player` invocation, when it completes, then it emits no legacy-name deprecation warning. | task-8 | covered | canonical Player emits none. | diff-local |
| criterion | Story 1 negative: Given an unknown `player` subcommand or malformed Player arguments, when parsing fails, then the command exits non-zero with Player help and does not start, stop, or mutate worker state. | task-9 | covered | does not start, stop, or mutate worker state. | diff-local |
| criterion | Story 1 negative: Given an invalid legacy `daemon` invocation, when validation fails, then it returns the same validation failure as `player`, emits at most the single compatibility warning, and does not fall through to another command family. | task-9 | covered | emits at most one alias warning, and does not fall through. | diff-local |
| criterion | Story 1 negative: Given preboot help handling before the full command tree is initialized, when the first argument is `player`, then help is recognized rather than accidentally launching the worker. | task-7 | covered | Preboot `player` help is recognized rather than accidentally launching the worker. | diff-local |
| criterion | Story 1 negative: Given a valid Player subcommand that already prints an operational result, when invoked through the legacy alias, then the deprecation warning does not replace, duplicate, or alter that result. | task-10 | covered | The alias warning does not replace, duplicate, or alter the operational result. | diff-local |
| criterion | Story 2 happy: Given any currently supported idea-to-spec command (`projects`, `worktree`, `land`, `handoff`, `poll`, `claim`, `forget`, `unclaim`, `requeue`, `resolve`, or `migrate-issue-deps`), when `composer` is used as the command name, then it reaches the same typed dispatch, stores, and ledger behavior as the corresponding pre-rename invocation. | task-11, task-13 | covered | Every supported deterministic command parses under `composer`. | diff-local |
| criterion | Story 2 happy: Given `conduct-ts composer --help` or subcommand help, when help renders, then all supported deterministic commands are present and operator-facing command names, headings, and examples use `composer`. | task-12, task-14 | covered | All supported Composer help uses canonical vocabulary. | diff-local |
| criterion | Story 2 happy: Given the bare interactive Composer launcher on a host that supports it, when launched, then it invokes the canonical `/composer` workflow; the shipped Composer skill is discoverable as `/composer` for Claude and `$composer` for Codex. | task-15, task-16 | covered | The Composer skill is discoverable as `/composer` for Claude and `$composer` for Codex. | diff-local |
| criterion | Story 2 happy: Given a valid legacy `engineer` CLI invocation, when it is dispatched, then it forwards to the same Composer behavior and writes exactly one deprecation warning to stderr. | task-19 | covered | Engineer forwards to the same Composer behavior and writes exactly one deprecation warning. | diff-local |
| criterion | Story 2 happy: Given an installed legacy `engineer` skill entrypoint, when a host invokes it, then the compatibility skill identifies the deprecation and delegates to the canonical Composer workflow without creating a second implementation. | task-17 | covered | identifies the deprecation and delegates to Composer. | diff-local |
| criterion | Story 2 negative: Given an unknown Composer subcommand, malformed arguments, or help-only invocation, when parsing ends, then no claim, worktree, issue, ledger, or handoff mutation occurs. | task-14 | covered | perform no claim, worktree, issue, ledger, or handoff mutation. | diff-local |
| criterion | Story 2 negative: Given a host without the existing persistent interactive-launch capability, when bare Composer is requested, then the command preserves the current explicit unsupported-host behavior rather than inventing a new launcher. | task-15 | covered | Unsupported hosts retain explicit unsupported behavior; no new persistent launcher is invented. | diff-local |
| criterion | Story 2 negative: Given canonical Composer and legacy Engineer invocations for the same deterministic operation, when they run separately, then they address the same existing store and ledger rather than forking state by vocabulary. | task-19 | covered | Both names address the same existing store and ledger | diff-local |
| criterion | Story 2 negative: Given a canonical `composer` CLI or skill invocation, when it completes, then it emits no legacy-name deprecation warning. | task-17, task-19 | covered | Canonical Composer invocation emits no legacy-name deprecation. | diff-local |
| criterion | Story 3 happy: Given `player_verbose`, when configuration is loaded, then its existing boolean semantics control Player verbosity at every current `daemon_verbose` consumer. | task-21 | covered | `player_verbose` controls the existing boolean verbosity semantics at every current consumer. | diff-local |
| criterion | Story 3 happy: Given `player_auto_restart_on_stale_engine`, when configuration is loaded, then its existing boolean semantics control whether the Player restarts after detecting a stale internal Conductor engine identity. | task-23 | covered | The canonical key controls whether Player restarts after detecting stale internal engine identity. | diff-local |
| criterion | Story 3 happy: Given only legacy `daemon_verbose` or `auto_restart_on_stale_engine`, when configuration is normalized, then the equivalent canonical value is supplied and one existing `config_deprecated_key` event is emitted for each legacy key used. | task-22, task-24 | covered | Legacy-only config supplies the equivalent canonical value and emits one existing deprecation event. | diff-local |
| criterion | Story 3 happy: Given both canonical and corresponding legacy keys, when configuration is normalized, then the canonical value wins deterministically and legacy use still emits the existing deprecation event. | task-22, task-24 | covered | Canonical values win deterministically when both forms are present. | diff-local |
| criterion | Story 3 negative: Given an invalid canonical Player value, when validation runs, then it fails under the existing validation policy and is not rescued or overwritten by a valid legacy value. | task-25 | covered | An invalid canonical value is not rescued or overwritten by a valid legacy value. | diff-local |
| criterion | Story 3 negative: Given an unknown Player-like config key, when configuration is loaded, then it follows the existing unknown-key policy rather than being guessed or silently normalized. | task-25 | covered | Unknown keys are not guessed | diff-local |
| criterion | Story 3 negative: Given only canonical Player keys, when configuration is loaded, then no `config_deprecated_key` event is emitted for those keys. | task-25 | covered | canonical-only keys emit no deprecation event | diff-local |
| criterion | Story 3 negative: Given legacy config use, when deprecation is reported, then it uses the existing event spine and does not write an ad-hoc warning file, timestamp, or parallel telemetry record. | task-25 | covered | no parallel telemetry is written | diff-local |
| criterion | Story 4 happy: Given only a legacy `.daemon/` tree, when a mutating Player or legacy-alias command first needs state, then it atomically adopts that tree as `.player/`, preserves every child, and finalizes legacy `daemon.pid`, `daemon.log`, and `daemon.log.1` names to their Player equivalents before writing. | task-27, task-28 | covered | Mutating resolution preserves every legacy child while adopting the tree as `.player/`. | diff-local |
| criterion | Story 4 happy: Given only a legacy `.daemon/` tree, when read-only `status` or `logs` observes it, then it reads the legacy state without renaming, creating, or modifying either directory. | task-36 | covered | Old-only status/logs reads legacy state without renaming, creating, or modifying either directory. | diff-local |
| criterion | Story 4 happy: Given no prior state or canonical `.player/` state, when any Player path is resolved, then all new pid/log, grants, park/restore, processed/warned, blocked/gated, attribution, restart, eval, merge-watch, and registry-scaffold writes stay under `.player/`. | task-29, task-30, task-31, task-32, task-33, task-34, task-35, task-37, task-38 | covered | no direct `.daemon/` writer remains. | diff-local |
| criterion | Story 4 happy: Given a completed migration, when the same resolver runs again, then it selects `.player/` idempotently and does not recreate `.daemon/` or repeat inner-file renames. | task-28, task-38 | covered | repeated resolution is idempotent. | diff-local |
| criterion | Story 4 negative: Given both `.daemon/` and `.player/` exist, when any command resolves state, then it reports an explicit ambiguous-state error and overwrites, merges, or deletes neither tree. | task-26 | covered | Both-present state overwrites, merges, or deletes neither tree. | diff-local |
| criterion | Story 4 negative: Given a partially migrated tree with conflicting legacy and canonical pid/log filenames, when migration resumes, then it fails closed with the conflicting paths and overwrites neither file. | task-28 | covered | Conflicting legacy and canonical filenames fail closed with both paths preserved. | diff-local |
| criterion | Story 4 negative: Given an interrupted directory migration, when the next mutating invocation runs, then it either completes the one recoverable old-only→canonical transition or fails with actionable state, never creates a fresh empty tree over surviving state. | task-27, task-38 | covered | never creates a fresh empty tree over surviving state. | diff-local |
| criterion | Story 4 negative: Given read-only observation of ambiguous or absent state, when status or logs renders, then it reports ambiguity or the existing not-running/no-log result without performing repair writes. | task-36 | covered | without repair writes. | diff-local |
