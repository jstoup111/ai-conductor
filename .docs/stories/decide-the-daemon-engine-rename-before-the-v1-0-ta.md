# Stories: implement the daemon→Player and engineer→Composer rename

**Status:** Accepted

Technical track — no PRD. Derived from the approved
adr-2026-08-26-music-vocabulary-player-composer-rename and its 2026-08-26 operator amendment.
The feature implements the complete compatibility-preserving rename while retaining internal
Conductor `engine` terminology.

## Story 1: Player is the canonical worker CLI

**Requirement:** ADR decisions 1–4 and the operator amendment

As an operator, I want `conduct-ts player` to expose the complete autonomous-worker command
surface so that the public CLI uses the selected music vocabulary without breaking existing
automation immediately.

### Acceptance Criteria

#### Happy Path

- Given any currently supported worker invocation (bare run, `status`, `logs`, `park`, `unpark`, `reclaim-worktree`, `start`, `stop`, `restart`, `pause`, `resume`, `connect`, or `debug`), when `player` is used as the command name, then it reaches the same typed dispatch and runtime behavior as the corresponding pre-rename invocation.
- Given `conduct-ts player --help` or subcommand help, when help renders, then the full supported surface is present and operator-facing command names, headings, and examples use `player`.
- Given a valid legacy `daemon` invocation, when it is dispatched, then it forwards through the Player compatibility boundary, behaves identically, and writes exactly one deprecation warning to stderr for that invocation.
- Given a canonical `player` invocation, when it completes, then it emits no legacy-name deprecation warning.

#### Negative Paths

- Given an unknown `player` subcommand or malformed Player arguments, when parsing fails, then the command exits non-zero with Player help and does not start, stop, or mutate worker state.
- Given an invalid legacy `daemon` invocation, when validation fails, then it returns the same validation failure as `player`, emits at most the single compatibility warning, and does not fall through to another command family.
- Given preboot help handling before the full command tree is initialized, when the first argument is `player`, then help is recognized rather than accidentally launching the worker.
- Given a valid Player subcommand that already prints an operational result, when invoked through the legacy alias, then the deprecation warning does not replace, duplicate, or alter that result.

### Done When

- [ ] Every supported worker invocation is reachable through canonical `player` parsing, dispatch,
  and help.
- [ ] `daemon` remains behaviorally equivalent as a warning compatibility alias.
- [ ] Parser, dispatch, help, warning-count, and no-mutation failure tests pass.

## Story 2: Composer is the canonical idea-to-spec CLI and skill

**Requirement:** ADR decisions 1–4 and the operator amendment

As a contributor, I want `composer` to be the canonical name for both deterministic idea-to-spec
commands and supported-host skill entrypoints so that one vocabulary covers interactive and
scripted DECIDE workflows.

### Acceptance Criteria

#### Happy Path

- Given any currently supported idea-to-spec command (`projects`, `worktree`, `land`, `handoff`, `poll`, `claim`, `forget`, `unclaim`, `requeue`, `resolve`, or `migrate-issue-deps`), when `composer` is used as the command name, then it reaches the same typed dispatch, stores, and ledger behavior as the corresponding pre-rename invocation.
- Given `conduct-ts composer --help` or subcommand help, when help renders, then all supported deterministic commands are present and operator-facing command names, headings, and examples use `composer`.
- Given the bare interactive Composer launcher on a host that supports it, when launched, then it invokes the canonical `/composer` workflow; the shipped Composer skill is discoverable as `/composer` for Claude and `$composer` for Codex.
- Given a valid legacy `engineer` CLI invocation, when it is dispatched, then it forwards to the same Composer behavior and writes exactly one deprecation warning to stderr.
- Given an installed legacy `engineer` skill entrypoint, when a host invokes it, then the compatibility skill identifies the deprecation and delegates to the canonical Composer workflow without creating a second implementation.

#### Negative Paths

- Given an unknown Composer subcommand, malformed arguments, or help-only invocation, when parsing ends, then no claim, worktree, issue, ledger, or handoff mutation occurs.
- Given a host without the existing persistent interactive-launch capability, when bare Composer is requested, then the command preserves the current explicit unsupported-host behavior rather than inventing a new launcher.
- Given canonical Composer and legacy Engineer invocations for the same deterministic operation, when they run separately, then they address the same existing store and ledger rather than forking state by vocabulary.
- Given a canonical `composer` CLI or skill invocation, when it completes, then it emits no legacy-name deprecation warning.

### Done When

- [ ] All deterministic idea-to-spec commands parse and dispatch under `composer`.
- [ ] Canonical Composer and compatibility Engineer skills are installed for both supported hosts.
- [ ] CLI/skill aliasing, help, launcher, shared-state, warning-count, and no-mutation tests pass.

## Story 3: Player configuration normalizes legacy keys once

**Requirement:** ADR decision 2, decision 3, and the operator amendment

As an operator with existing settings, I want Player-named canonical configuration plus deterministic
legacy-key normalization so that upgrades preserve behavior and expose a machine-readable migration
signal.

### Acceptance Criteria

#### Happy Path

- Given `player_verbose`, when configuration is loaded, then its existing boolean semantics control Player verbosity at every current `daemon_verbose` consumer.
- Given `player_auto_restart_on_stale_engine`, when configuration is loaded, then its existing boolean semantics control whether the Player restarts after detecting a stale internal Conductor engine identity.
- Given only legacy `daemon_verbose` or `auto_restart_on_stale_engine`, when configuration is normalized, then the equivalent canonical value is supplied and one existing `config_deprecated_key` event is emitted for each legacy key used.
- Given both canonical and corresponding legacy keys, when configuration is normalized, then the canonical value wins deterministically and legacy use still emits the existing deprecation event.

#### Negative Paths

- Given an invalid canonical Player value, when validation runs, then it fails under the existing validation policy and is not rescued or overwritten by a valid legacy value.
- Given an unknown Player-like config key, when configuration is loaded, then it follows the existing unknown-key policy rather than being guessed or silently normalized.
- Given only canonical Player keys, when configuration is loaded, then no `config_deprecated_key` event is emitted for those keys.
- Given legacy config use, when deprecation is reported, then it uses the existing event spine and does not write an ad-hoc warning file, timestamp, or parallel telemetry record.

### Done When

- [ ] Canonical Player keys are typed, validated, and wired to existing behavior.
- [ ] Legacy keys normalize with canonical precedence and existing event-spine deprecation events.
- [ ] Invalid, unknown, canonical-only, and no-parallel-channel tests pass.

## Story 4: Player state migrates without overwriting ambiguity

**Requirement:** ADR decisions 2–4 and the operator amendment

As an operator with live autonomous-worker state, I want `.player/` to become the sole write target
through a guarded compatibility boundary so that the vocabulary change neither loses state nor
silently splits ownership.

### Acceptance Criteria

#### Happy Path

- Given only a legacy `.daemon/` tree, when a mutating Player or legacy-alias command first needs state, then it atomically adopts that tree as `.player/`, preserves every child, and finalizes legacy `daemon.pid`, `daemon.log`, and `daemon.log.1` names to their Player equivalents before writing.
- Given only a legacy `.daemon/` tree, when read-only `status` or `logs` observes it, then it reads the legacy state without renaming, creating, or modifying either directory.
- Given no prior state or canonical `.player/` state, when any Player path is resolved, then all new pid/log, grants, park/restore, processed/warned, blocked/gated, attribution, restart, eval, merge-watch, and registry-scaffold writes stay under `.player/`.
- Given a completed migration, when the same resolver runs again, then it selects `.player/` idempotently and does not recreate `.daemon/` or repeat inner-file renames.

#### Negative Paths

- Given both `.daemon/` and `.player/` exist, when any command resolves state, then it reports an explicit ambiguous-state error and overwrites, merges, or deletes neither tree.
- Given a partially migrated tree with conflicting legacy and canonical pid/log filenames, when migration resumes, then it fails closed with the conflicting paths and overwrites neither file.
- Given an interrupted directory migration, when the next mutating invocation runs, then it either completes the one recoverable old-only→canonical transition or fails with actionable state, never creates a fresh empty tree over surviving state.
- Given read-only observation of ambiguous or absent state, when status or logs renders, then it reports ambiguity or the existing not-running/no-log result without performing repair writes.

### Done When

- [ ] One state resolver governs canonical writes, old-only migration, observer fallback, and
  ambiguity detection.
- [ ] Every production `.daemon/` write site and registry scaffold uses the resolver or canonical
  `.player/` path.
- [ ] Migration preservation, idempotence, ambiguity, partial-migration, and read-only tests pass.
