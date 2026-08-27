# Implementation Plan: implement the daemon→Player and engineer→Composer rename

**Date:** 2026-08-26
**Stories:** .docs/stories/decide-the-daemon-engine-rename-before-the-v1-0-ta.md
**Conflict check:** Passed 2026-08-26; intentional legacy-name/path supersession resolved by the ADR
**Complexity:** Large; the operator approved the comprehensive scope and its 21–40-task warning

## Summary

Make `player` and `composer` the canonical public command/skill vocabulary while retaining
warning compatibility aliases, normalizing two legacy config keys through the existing event spine,
and moving durable worker state to a single-write `.player/` root without overwriting ambiguous or
partially migrated state. Internal Conductor `engine` and existing runtime implementation symbols
remain unchanged unless a boundary adapter requires otherwise.

## Technical Approach

- Normalize CLI vocabulary once at each root parser and reuse the current typed descriptors,
  command handlers, stores, and ledgers. Aliases never own a second implementation.
- Make Composer the canonical shipped skill; keep Engineer as a thin compatibility delegate for
  both supported host discovery mechanisms.
- Normalize legacy config keys before validation/consumption, with canonical precedence and the
  existing `config_deprecated_key` event.
- Introduce a mode-aware Player-state resolver. Read-only callers may observe an old-only tree;
  mutating callers atomically adopt it. Both-present or conflicting inner filenames fail closed.
- Use focused RED→GREEN tests in every task. Third-party boundaries remain faithful fakes.

## Prerequisites

- APPROVED adr-2026-08-26-music-vocabulary-player-composer-rename, including the implementation
  amendment.
- Human approval of the architecture-review marker for the High-impact durable-state transition.
- Rebase/sequence awareness for the advisory overlap on central CLI/config seams, especially the
  #226/#552 major-boundary work.

## Tasks

### Task 1: Parse canonical bare Player runs
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: add parser cases for bare `player` and Player run flags; prove they currently return no worker dispatch.
2. GREEN: let the worker root parser accept `player` and return the same typed bare-run descriptor as the corresponding pre-rename invocation.
3. Re-run the focused parser test.

**Done when:**
- Bare `player` and supported run flags produce the existing worker-run descriptor.
- No runtime worker implementation is copied or renamed.

**Files:** `src/conductor/test/engine/daemon-command.test.ts`, `src/conductor/src/engine/daemon-command.ts`
**Dependencies:** none

### Task 2: Parse canonical Player supervisor verbs
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: parameterize parser tests for `player start|stop|restart|pause|resume|connect|debug` and their current arguments.
2. GREEN: recognize the canonical root in the supervisor parser while preserving existing typed dispatches.
3. Re-run the focused parser test.

**Done when:**
- Every supervisor verb under `player` reaches the same typed dispatch as its pre-rename counterpart.
- Verb-specific argument validation is unchanged.

**Files:** `src/conductor/test/engine/daemon-command.test.ts`, `src/conductor/src/engine/daemon-command.ts`
**Dependencies:** Task 1

### Task 3: Parse canonical Player observer verbs
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: add `player status` and `player logs` parser cases, including supported filters/tail options.
2. GREEN: accept the canonical root in observer parsing and reuse the current observe descriptors.
3. Re-run the observer parser test.

**Done when:**
- `player status` and `player logs` preserve the existing typed observer behavior.
- Unsupported observer arguments still fail parsing.

**Files:** `src/conductor/test/engine/daemon-observe-cli.test.ts`, `src/conductor/src/engine/daemon-observe-cli.ts`
**Dependencies:** Task 1

### Task 4: Parse canonical Player park and reclaim verbs
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: add `player park`, `unpark`, and `reclaim-worktree` cases, including `--all` and slug validation.
2. GREEN: accept the canonical root and place every supported verb in the authoritative subcommand set.
3. Re-run park/reclaim parser tests.

**Done when:**
- Park, unpark, and reclaim reach their existing typed dispatches through `player`.
- Unknown or incomplete targets remain rejected.

**Files:** `src/conductor/test/engine/daemon-park-cli.test.ts`, `src/conductor/test/engine/daemon-park-cli-reclaim.test.ts`, `src/conductor/src/engine/daemon-park-cli.ts`, `src/conductor/src/engine/daemon-command.ts`
**Dependencies:** Task 1

### Task 5: Register the complete canonical Player command tree
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: assert `player --help` lists bare-run usage and every supported worker verb.
2. GREEN: register the Player Commander subtree and generate headings, descriptions, and examples with Player vocabulary.
3. Re-run focused CLI help tests.

**Done when:**
- The full supported surface is present in canonical Player help.
- Operator-facing canonical command names, headings, and examples use `player`.

**Files:** `src/conductor/test/cli/index.test.ts`, `src/conductor/test/daemon-help-verb-drift.test.ts`, `src/conductor/src/cli.ts`
**Dependencies:** Tasks 2, 3, 4

### Task 6: Dispatch canonical Player commands from the entrypoint
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: inject command handlers and show canonical Player descriptors are not dispatched.
2. GREEN: wire bare, supervisor, observer, park, and reclaim Player descriptors through the existing pre-Commander dispatch order.
3. Re-run entrypoint dispatch tests.

**Done when:**
- Every supported Player invocation reaches the same runtime handler as the corresponding pre-rename invocation.
- No Player descriptor falls through to an unrelated Commander action.

**Files:** `src/conductor/test/engine/player-cli-dispatch.test.ts`, `src/conductor/src/index.ts`
**Dependencies:** Tasks 2, 3, 4

### Task 7: Recognize Player preboot help safely
**Story:** 1
**Type:** negative-path

**Steps:**
1. RED: cover `player --help` before full initialization and assert the worker runner is not called.
2. GREEN: extend the preboot help discriminator and Player help renderer lookup.
3. Re-run preboot help tests.

**Done when:**
- Preboot `player` help is recognized rather than accidentally launching the worker.
- Help-only invocation performs no worker-state mutation.

**Files:** `src/conductor/test/engine/player-cli-dispatch.test.ts`, `src/conductor/test/cli/index.test.ts`, `src/conductor/src/index.ts`, `src/conductor/src/cli.ts`
**Dependencies:** Tasks 5, 6

### Task 8: Normalize the Daemon CLI alias once
**Story:** 1
**Type:** happy-path

**Steps:**
1. RED: compare Player and Daemon dispatch descriptors across every supported worker invocation and count stderr warnings.
2. GREEN: normalize `daemon` to Player at the CLI root and emit exactly one deprecation warning per legacy invocation.
3. Re-run alias-parity tests.

**Done when:**
- A valid legacy Daemon invocation behaves identically to Player.
- Exactly one deprecation warning is written to stderr; canonical Player emits none.

**Files:** `src/conductor/test/engine/daemon-command.test.ts`, `src/conductor/test/engine/player-cli-dispatch.test.ts`, `src/conductor/src/engine/daemon-command.ts`, `src/conductor/src/index.ts`
**Dependencies:** Task 6

### Task 9: Preserve Player validation and no-mutation failures
**Story:** 1
**Type:** negative-path

**Steps:**
1. RED: add unknown-subcommand and malformed-argument cases for both roots with mutation spies.
2. GREEN: route validation failures through canonical Player help/error handling without fallthrough.
3. Re-run parser and dispatch failure tests.

**Done when:**
- Invalid Player exits non-zero with Player help and does not start, stop, or mutate worker state.
- Invalid Daemon returns the same failure, emits at most one alias warning, and does not fall through.

**Files:** `src/conductor/test/engine/daemon-command.test.ts`, `src/conductor/test/engine/player-cli-dispatch.test.ts`, `src/conductor/src/engine/daemon-command.ts`, `src/conductor/src/index.ts`
**Dependencies:** Tasks 7, 8

### Task 10: Keep alias warnings separate from operational output
**Story:** 1
**Type:** negative-path

**Steps:**
1. RED: capture stdout/stderr for representative status, pause, and reclaim results through both roots.
2. GREEN: keep deprecation output on stderr at the normalization boundary.
3. Re-run output-channel assertions.

**Done when:**
- The alias warning does not replace, duplicate, or alter the operational result.
- Canonical and alias stdout remain behaviorally equivalent.

**Files:** `src/conductor/test/engine/player-cli-dispatch.test.ts`, `src/conductor/src/index.ts`
**Dependencies:** Tasks 8, 9

### Task 11: Parse the complete canonical Composer command set
**Story:** 2
**Type:** happy-path

**Steps:**
1. RED: parameterize canonical cases for `projects`, `worktree`, `land`, `handoff`, `poll`, `claim`, `forget`, `unclaim`, `requeue`, `resolve`, and `migrate-issue-deps`.
2. GREEN: accept `composer` at the idea-to-spec parser root and reuse every existing typed descriptor.
3. Re-run Engineer/Composer parser tests.

**Done when:**
- Every supported deterministic command parses under `composer`.
- Argument validation and descriptor payloads remain identical to the pre-rename behavior.

**Files:** `src/conductor/test/engine/engineer/engineer-cli-help.test.ts`, `src/conductor/test/engine/engineer/engineer-cli-unknown-flag.test.ts`, `src/conductor/src/engine/engineer-cli.ts`
**Dependencies:** none

### Task 12: Register the complete canonical Composer command tree
**Story:** 2
**Type:** happy-path

**Steps:**
1. RED: assert Composer root help includes all eleven runtime-supported deterministic commands.
2. GREEN: register the Composer Commander subtree from the authoritative parser surface.
3. Re-run CLI command-tree tests.

**Done when:**
- Composer help exposes all supported deterministic commands, including `unclaim` and `requeue`.
- No runtime-supported command is absent from the public tree.

**Files:** `src/conductor/test/cli/index.test.ts`, `src/conductor/test/cli-engineer.test.ts`, `src/conductor/src/cli.ts`
**Dependencies:** Task 11

### Task 13: Dispatch canonical Composer commands
**Story:** 2
**Type:** happy-path

**Steps:**
1. RED: inject representative deterministic handlers and prove Composer descriptors are not dispatched.
2. GREEN: wire Composer detection before Commander fallback through the existing Engineer execution path.
3. Re-run entrypoint dispatch tests.

**Done when:**
- Composer reaches the same command handlers, stores, and ledgers as the corresponding pre-rename invocation.
- No alternate Composer state store is introduced.

**Files:** `src/conductor/test/engine/engineer/composer-cli-dispatch.test.ts`, `src/conductor/src/index.ts`
**Dependencies:** Tasks 11, 12

### Task 14: Render canonical Composer help without side effects
**Story:** 2
**Type:** negative-path

**Steps:**
1. RED: cover root/subcommand help, malformed flags, and unknown subcommands with claim/worktree/ledger spies.
2. GREEN: render Composer names, headings, and examples while preserving early help/error returns.
3. Re-run help and no-side-effect tests.

**Done when:**
- All supported Composer help uses canonical vocabulary.
- Unknown, malformed, and help-only invocations perform no claim, worktree, issue, ledger, or handoff mutation.

**Files:** `src/conductor/test/engine/engineer/engineer-cli-help.test.ts`, `src/conductor/test/engine/engineer/engineer-cli-unknown-flag.test.ts`, `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/src/cli.ts`
**Dependencies:** Tasks 12, 13

### Task 15: Launch the canonical Composer workflow
**Story:** 2
**Type:** happy-and-negative

**Steps:**
1. RED: assert bare Composer launches `/composer` on the supported host and preserves the current unsupported-host result elsewhere.
2. GREEN: change only the workflow entrypoint passed to the existing persistent launcher.
3. Re-run launcher tests with fake host adapters.

**Done when:**
- The supported host launches the canonical `/composer` workflow.
- Unsupported hosts retain explicit unsupported behavior; no new persistent launcher is invented.

**Files:** `src/conductor/test/engine/engineer/engineer-cli-launch-intake.test.ts`, `src/conductor/src/engine/engineer-cli.ts`
**Dependencies:** Task 13

### Task 16: Add the canonical Composer skill package
**Story:** 2
**Type:** happy-path

**Steps:**
1. RED: add skill-contract assertions for canonical name, workflow instructions, and Claude/Codex discovery metadata.
2. GREEN: create the Composer skill from the existing idea-to-spec workflow and register its provider metadata.
3. Re-run skill-contract tests.

**Done when:**
- The Composer skill is discoverable as `/composer` for Claude and `$composer` for Codex.
- Composer is the single full workflow implementation.

**Files:** `skills/composer/SKILL.md`, `skills/composer/agents/openai.yaml`, `src/conductor/test/skill-contracts.test.ts`, `test/test_provider_skill_contracts.sh`
**Dependencies:** none

### Task 17: Convert Engineer skill discovery to a compatibility delegate
**Story:** 2
**Type:** happy-and-negative

**Steps:**
1. RED: assert the legacy Engineer entrypoint declares deprecation and delegates without duplicating Composer workflow instructions.
2. GREEN: replace Engineer's full body/provider prompt with a thin compatibility handoff to Composer.
3. Re-run provider skill-contract tests.

**Done when:**
- Invoking the legacy Engineer skill identifies the deprecation and delegates to Composer.
- Canonical Composer invocation emits no legacy-name deprecation.

**Files:** `skills/engineer/SKILL.md`, `skills/engineer/agents/openai.yaml`, `src/conductor/test/skill-contracts.test.ts`, `test/test_provider_skill_contracts.sh`
**Dependencies:** Task 16

### Task 18: Install and select Composer across supported providers
**Story:** 2
**Type:** happy-path

**Steps:**
1. RED: extend model-table and install-contract tests to require Composer and retain Engineer compatibility discovery.
2. GREEN: add Composer metadata and provider-neutral installer/catalog wiring, then regenerate machine-owned model selection output.
3. Re-run focused metadata and installation tests.

**Done when:**
- Both supported hosts install/discover canonical Composer and compatibility Engineer.
- Model selection resolves Composer without changing the underlying DECIDE workflow tier.

**Files:** `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/test/model-table-metadata.test.ts`, `src/conductor/test/generate-model-table.test.ts`, `test/test_codex_skill_installation.sh`, `HARNESS.md`
**Dependencies:** Tasks 16, 17

### Task 19: Normalize the Engineer CLI alias once
**Story:** 2
**Type:** happy-and-negative

**Steps:**
1. RED: compare Composer/Engineer descriptors and shared-store calls; count warnings for valid, invalid, and canonical invocations.
2. GREEN: normalize `engineer` at the CLI root and emit one stderr warning before using Composer dispatch.
3. Re-run alias, shared-state, and no-mutation tests.

**Done when:**
- Engineer forwards to the same Composer behavior and writes exactly one deprecation warning.
- Both names address the same existing store and ledger; canonical Composer emits no warning.

**Files:** `src/conductor/test/engine/engineer/engineer-cli-help.test.ts`, `src/conductor/test/engine/engineer/composer-cli-dispatch.test.ts`, `src/conductor/src/engine/engineer-cli.ts`, `src/conductor/src/index.ts`
**Dependencies:** Tasks 13, 14

### Task 20: Type and validate canonical Player config keys
**Story:** 3
**Type:** happy-path

**Steps:**
1. RED: add type/known-key/boolean validation cases for `player_verbose` and `player_auto_restart_on_stale_engine`.
2. GREEN: add both optional canonical keys to the config contract and validator.
3. Re-run type and validation tests.

**Done when:**
- Both canonical Player keys are typed and accepted as booleans.
- Invalid canonical types follow existing validation behavior.

**Files:** `src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`, `src/conductor/test/config-validation.test.ts`, `src/conductor/test/types/test-suite-config-type.test.ts`
**Dependencies:** none

### Task 21: Wire canonical Player verbosity
**Story:** 3
**Type:** happy-path

**Steps:**
1. RED: exercise representative setup/build and park consumers with only `player_verbose` enabled.
2. GREEN: feed the canonical value to every current verbosity consumer.
3. Re-run config-resolution and wiring tests.

**Done when:**
- `player_verbose` controls the existing boolean verbosity semantics at every current consumer.
- Canonical wiring no longer requires consumers to read `daemon_verbose` directly.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/daemon-park-cli.ts`, `src/conductor/src/engine/worktree-prepare.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/test/engine/daemon-cli-config-resolution.test.ts`, `src/conductor/test/engine/daemon-park-cli.test.ts`
**Dependencies:** Task 20

### Task 22: Normalize legacy Daemon verbosity with an event
**Story:** 3
**Type:** happy-and-negative

**Steps:**
1. RED: cover legacy-only, both-present, and canonical-only verbosity settings plus emitted events.
2. GREEN: normalize `daemon_verbose` to `player_verbose`, prefer canonical values, and reuse `config_deprecated_key`.
3. Re-run config event integration tests.

**Done when:**
- Legacy-only config supplies the equivalent canonical value and emits one existing deprecation event.
- Canonical wins when both forms exist; canonical-only emits no deprecation event.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`, `src/conductor/test/integration/config-deprecated-key-event.integration.test.ts`
**Dependencies:** Tasks 20, 21

### Task 23: Wire canonical Player stale-engine restart configuration
**Story:** 3
**Type:** happy-path

**Steps:**
1. RED: exercise stale-engine startup and runtime wiring with only `player_auto_restart_on_stale_engine` enabled.
2. GREEN: consume the canonical value at both current restart decision points.
3. Re-run stale-engine configuration tests.

**Done when:**
- The canonical key controls whether Player restarts after detecting stale internal engine identity.
- Internal engine terminology and identity behavior remain unchanged.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/stale-engine-init.ts`, `src/conductor/test/engine/daemon-cli-probe-engine-staleness-wiring.test.ts`, `src/conductor/test/engine/daemon-cli-config-resolution.test.ts`
**Dependencies:** Task 20

### Task 24: Normalize the legacy stale-engine restart key
**Story:** 3
**Type:** happy-path

**Steps:**
1. RED: cover legacy-only, both-present, and canonical-only auto-restart settings and event counts.
2. GREEN: normalize `auto_restart_on_stale_engine`, prefer the canonical Player key, and reuse `config_deprecated_key`.
3. Re-run config normalization/event tests.

**Done when:**
- Legacy-only auto-restart preserves the equivalent canonical behavior with one deprecation event.
- Canonical values win deterministically when both forms are present.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`, `src/conductor/test/integration/config-deprecated-key-event.integration.test.ts`
**Dependencies:** Tasks 20, 23

### Task 25: Fail invalid or unknown Player configuration without fallback
**Story:** 3
**Type:** negative-path

**Steps:**
1. RED: add invalid-canonical-plus-valid-legacy, unknown Player-like key, and canonical-only event cases.
2. GREEN: make validation precede legacy fallback for an explicitly supplied canonical key and retain unknown-key policy.
3. Re-run validation and event tests.

**Done when:**
- An invalid canonical value is not rescued or overwritten by a valid legacy value.
- Unknown keys are not guessed; canonical-only keys emit no deprecation event; no parallel telemetry is written.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/config-validation.test.ts`, `src/conductor/test/integration/config-deprecated-key-event.integration.test.ts`
**Dependencies:** Tasks 22, 24

### Task 26: Classify canonical, legacy, absent, and ambiguous state roots
**Story:** 4
**Type:** happy-and-negative

**Steps:**
1. RED: add resolver cases for no tree, `.player/` only, `.daemon/` only, and both trees in read-only/mutating modes.
2. GREEN: introduce a side-effect-free classification API and explicit ambiguous-state error.
3. Re-run resolver unit tests.

**Done when:**
- One resolver chooses canonical, legacy-observe, migrate, absent, or ambiguous state explicitly.
- Both-present state overwrites, merges, or deletes neither tree.

**Files:** `src/conductor/src/engine/player-state-paths.ts`, `src/conductor/test/engine/player-state-paths.test.ts`
**Dependencies:** none

### Task 27: Atomically adopt an old-only state directory
**Story:** 4
**Type:** happy-and-negative

**Steps:**
1. RED: create nested legacy fixtures and interrupted/precondition-change cases for mutating resolution.
2. GREEN: atomically rename an old-only `.daemon/` tree to `.player/` before returning a write root.
3. Re-run resolver migration tests.

**Done when:**
- Mutating resolution preserves every legacy child while adopting the tree as `.player/`.
- A changed or ambiguous precondition fails without creating a fresh empty tree over surviving state.

**Files:** `src/conductor/src/engine/player-state-paths.ts`, `src/conductor/test/engine/player-state-paths.test.ts`
**Dependencies:** Task 26

### Task 28: Finalize legacy pid and log filenames safely
**Story:** 4
**Type:** happy-and-negative

**Steps:**
1. RED: cover old-only `daemon.pid`, `daemon.log`, `daemon.log.1`, completed canonical names, and conflicting old/new inner files.
2. GREEN: finalize old-only inner names to Player equivalents during mutating migration; reject conflicts without overwrite.
3. Re-run inner-file migration and repeat-run tests.

**Done when:**
- Migration finalizes legacy pid/log names before writes and is idempotent after completion.
- Conflicting legacy and canonical filenames fail closed with both paths preserved.

**Files:** `src/conductor/src/engine/player-state-paths.ts`, `src/conductor/test/engine/player-state-paths.test.ts`
**Dependencies:** Task 27

### Task 29: Route process lock and log paths through Player state
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: assert new lock/log writes resolve to `player.pid`, `player.log`, and `player.log.1` under `.player/`.
2. GREEN: inject resolved paths into lock, logger, runner, and top-level worker lifecycle wiring.
3. Re-run lock/log/lifecycle tests.

**Done when:**
- New pid/log writes stay under `.player/` with Player inner filenames.
- Lock exclusivity, rotation, and shutdown semantics remain unchanged.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/daemon-lock.ts`, `src/conductor/src/engine/daemon-log.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/daemon-cli.test.ts`, `src/conductor/test/engine/daemon-cli-tail.test.ts`
**Dependencies:** Task 28

### Task 30: Route pause and restart state through Player state
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: assert pause, restart intent, restart pending, and stale-engine restart markers use the resolved root.
2. GREEN: replace direct root construction with resolver-derived marker paths.
3. Re-run pause/restart tests.

**Done when:**
- Pause and restart marker writes stay under `.player/`.
- Existing pause/resume and stale-engine recovery behavior is preserved.

**Files:** `src/conductor/src/engine/pause-marker.ts`, `src/conductor/src/engine/restart-marker.ts`, `src/conductor/src/engine/restart-intent.ts`, `src/conductor/src/engine/stale-engine-init.ts`, `src/conductor/test/engine/daemon-cli-restart-lifecycle.test.ts`, `src/conductor/test/engine/daemon-cli-restart-requester.test.ts`
**Dependencies:** Task 27

### Task 31: Route park and restore state through Player state
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: assert manual/automatic park markers and restore/reconciliation paths use the resolved root in main and fixture repos.
2. GREEN: thread Player state paths through park, auto-park, and reconciliation code.
3. Re-run park/reconciliation tests.

**Done when:**
- Park/restore writes stay under `.player/` and preserve marker provenance/ownership semantics.
- No worktree-local legacy state root is recreated.

**Files:** `src/conductor/src/engine/park-marker.ts`, `src/conductor/src/engine/daemon-auto-park.ts`, `src/conductor/src/engine/park-reconciliation.ts`, `src/conductor/src/engine/daemon-park-cli.ts`, `src/conductor/test/engine/daemon-park-cli.test.ts`, `src/conductor/test/engine/daemon-cli-parked-reconciliation-wiring.test.ts`
**Dependencies:** Task 27

### Task 32: Route grants and processed/warned ledgers through Player state
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: assert grants, processed markers, and warning-dedup ledgers use the canonical resolved root.
2. GREEN: pass Player-state paths into backlog, permissions/grants, and warning writers/readers.
3. Re-run backlog and state-ledger tests.

**Done when:**
- Grants, processed, and warned writes stay under `.player/`.
- Existing deduplication and ownership behavior remains intact.

**Files:** `src/conductor/src/engine/daemon-backlog.ts`, `src/conductor/src/engine/daemon-deps.ts`, `src/conductor/src/engine/daemon-waiting-announce.ts`, `src/conductor/test/engine/daemon-cli.test.ts`
**Dependencies:** Task 27

### Task 33: Route blocked, gated, and attribution state through Player state
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: assert blocked/gated snapshots, attribution audit, and halt-class migration state use the canonical root.
2. GREEN: replace direct legacy-root joins with resolver-derived paths.
3. Re-run focused snapshot/attribution/migration tests.

**Done when:**
- Blocked, gated, attribution, and migration bookkeeping writes stay under `.player/`.
- Existing snapshot and reconciliation semantics remain unchanged.

**Files:** `src/conductor/src/engine/gated-snapshot.ts`, `src/conductor/src/engine/attribution-audit.ts`, `src/conductor/src/engine/halt-class-migration.ts`, `src/conductor/src/engine/halt-issues/resolution.ts`, `src/conductor/test/engine/gated-snapshot.test.ts`, `src/conductor/test/engine/attribution-audit.test.ts`
**Dependencies:** Task 27

### Task 34: Route eval and restart diagnostics through Player state
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: assert eval artifacts, provider diagnostics, and restart diagnostic records resolve beneath `.player/`.
2. GREEN: inject canonical state paths into their existing writers/readers.
3. Re-run focused diagnostics/eval tests.

**Done when:**
- Eval and restart-diagnostic writes stay under `.player/`.
- Record formats and retention behavior remain unchanged.

**Files:** `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/execution/provider-diagnostics.ts`, `src/conductor/src/engine/restart-marker.ts`, `src/conductor/test/event-sink-registry.test.ts`
**Dependencies:** Task 27

### Task 35: Route merge-watch and base-sha state through Player state
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: assert mergeable-watch registry, last-base-sha, and waiting-announcement state use `.player/`.
2. GREEN: thread resolver-derived paths through merge sweep, SHA, and announcement code.
3. Re-run merge/re-kick/waiting tests.

**Done when:**
- Merge-watch, last-base-sha, and waiting writes stay under `.player/`.
- Existing sweep/dedup behavior remains intact.

**Files:** `src/conductor/src/engine/mergeable-sweep.ts`, `src/conductor/src/engine/daemon-sha.ts`, `src/conductor/src/engine/daemon-waiting-announce.ts`, `src/conductor/test/engine/daemon-cli-progress-rekick-wiring.test.ts`, `src/conductor/test/engine/daemon-cli.test.ts`
**Dependencies:** Task 27

### Task 36: Keep status and logs read-only across legacy state
**Story:** 4
**Type:** happy-and-negative

**Steps:**
1. RED: cover canonical-only, legacy-only, both-present, and absent roots while snapshotting filesystem writes.
2. GREEN: use read-only resolver mode for status/dashboard/log observation and render ambiguity explicitly.
3. Re-run observer integration tests.

**Done when:**
- Old-only status/logs reads legacy state without renaming, creating, or modifying either directory.
- Ambiguous or absent state reports the correct error/not-running result without repair writes.

**Files:** `src/conductor/src/engine/daemon-observe-cli.ts`, `src/conductor/src/engine/daemon-dashboard.ts`, `src/conductor/src/engine/daemon-log.ts`, `src/conductor/test/engine/daemon-observe-cli.test.ts`, `src/conductor/test/engine/daemon-observe-session.test.ts`
**Dependencies:** Tasks 26, 29

### Task 37: Make startup and registry scaffolds canonical-only writers
**Story:** 4
**Type:** happy-path

**Steps:**
1. RED: assert worker startup resolves state before any write and new registry scaffolds ignore `.player/` rather than `.daemon/`.
2. GREEN: resolve mutating state at startup and update scaffold generation to the canonical state root.
3. Re-run startup and registry integration tests.

**Done when:**
- Startup never writes before old-only migration or ambiguity rejection.
- Fresh registry scaffolds and all new worker state target `.player/`.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/registry.ts`, `src/conductor/src/engine/registry-cli.ts`, `src/conductor/test/engine/daemon-cli-startup-init.test.ts`, `src/conductor/test/integration/registry-cli.test.ts`
**Dependencies:** Tasks 27, 28

### Task 38: Prove state migration across real command boundaries
**Story:** 4
**Type:** happy-and-negative

**Steps:**
1. RED: add acceptance fixtures for old-only mutating alias/canonical commands, repeated resolution, both-present state, conflicting pid/log names, and interrupted migration.
2. GREEN: close any remaining resolver wiring gaps exposed by the command-level flow; do not add per-command fallback logic.
3. Re-run the focused acceptance flow and audit production path literals for unresolved `.daemon/` writes.

**Done when:**
- Old-only mutating commands complete the recoverable transition and repeated resolution is idempotent.
- Ambiguous, conflicting, or unrecoverable partial state fails with actionable paths and no data loss.
- Every production legacy path literal is either a resolver compatibility read/classifier or explicitly non-state fixture text; no direct `.daemon/` writer remains.

**Files:** `src/conductor/test/acceptance/player-state-migration.acceptance.test.ts`, `src/conductor/src/engine/player-state-paths.ts`, production `.daemon/` path consumers identified by the task audit
**Dependencies:** Tasks 29–37

## Task Dependency Graph

```text
Player CLI:   1 → {2,3,4} → {5,6} → 7 → 8 → 9 → 10
Composer:    11 → {12,13} → {14,15,19}; 16 → 17 → 18
Config:      20 → {21,23}; 21 → 22; 23 → 24; {22,24} → 25
State:       26 → 27 → 28; 27 → {30,31,32,33,34,35}; 28 → 29;
             {26,29} → 36; {27,28} → 37; {29–37} → 38
```

## Integration Points

- After Task 10, canonical and legacy worker CLI roots share one dispatch surface with distinct
  warning behavior.
- After Task 19, canonical and legacy idea-to-spec CLI/skill entrypoints share one workflow and
  state owner across supported hosts.
- After Task 25, only canonical Player keys reach consumers while legacy use remains observable on
  the existing event spine.
- After Task 38, every durable worker state writer uses `.player/`, observers remain read-only, and
  migration ambiguity is fail-closed at real command boundaries.
