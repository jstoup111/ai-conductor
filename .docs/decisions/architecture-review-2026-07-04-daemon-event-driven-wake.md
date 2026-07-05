# Architecture Review: Daemon Event-Driven Wake for Parked (HALTED) Features

**Date:** 2026-07-04
**Mode:** lightweight (Tier M) — feasibility + alignment
**Input reviewed:** intake issue jstoup111/ai-conductor#111 (full pre-researched design),
approved diagram `.docs/architecture/daemon-event-driven-wake-for-parked-halted-feature.md`
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ TypeScript/Node; chokidar is a new runtime dep of `src/conductor` (flagged, ADR'd). tsup build present; if chokidar v3 is used, optional `fsevents` must be marked external in `tsup.config.ts`. |
| Prerequisites | ✅ All seams already exist: injectable `sleep` (`daemon.ts` DaemonDeps), optional `isHalted?` dep pattern, `pickEligible` gate, `discoverBacklog({refresh})`. Issue's line numbers have drifted (e.g. idle sleep is now `daemon.ts:394`, park at `:291`, unpark at `:264`) — the plan must cite symbols, not the issue's stale line numbers. |
| Integration surface | ✅ Contained to `src/conductor/src/engine/` (daemon, daemon-deps, daemon-command, daemon-backlog) + `daemon-cli.ts`. No external APIs. |
| Data implications | ✅ None. No schema, no new files; watches an existing marker path. |
| Performance risk | ✅ Net win: 5s `git fetch` storm → 60s backstop + event wake. Wake arm does a local-only scan (no network on unpark). |
| Worktree isolation | ✅ Watchers are per-slug paths under the daemon's own `worktreeBase`; no ports/DBs/queues; two daemons on different repos share nothing. |

## Alignment

- **ADR-001 keystone / dispatch gate:** watch is an optimization, never authority.
  `isHalted()` + `inFlight`/`started`/`parked` remain the only re-dispatch gate; a spurious
  wake is a no-op iteration. No new or parallel dispatch path is created.
- **HALT reconciliation (adr-013, PR #124/#109):** the rekick path renames
  `HALT` → `HALT.cleared`, which emits `unlink` on the watched HALT path — the watcher
  covers operator `rm` and rekick uniformly, feeding the *existing* un-park path.
- **Pattern consistency:** `watchHaltCleared?` mirrors the established optional-dep pattern
  (`isHalted?`, `sleep?`) in `DaemonDeps`; pure-core default (dep absent ⇒ polling only)
  matches the existing pure-core stance.
- **Test contract preservation:** the injected `sleep` is still awaited once per idle cycle
  (race, not replacement), keeping existing sleep/poll-count tests byte-identical.
- **State management:** the Waker is a latched single-shot — wakes between waits are held,
  duplicate wakes coalesce; no boolean-flag soup.
- **Docs/CHANGELOG:** new flag + default change carry README (root + src/conductor) and
  CHANGELOG Added/Changed obligations in the same PR (repo CLAUDE.md rule).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| FS events not delivered (network/virtualized FS, some WSL2 mounts) | Technical | Medium | Low | 60s poll backstop always recovers; `--no-watch --idle-poll 5` restores old behavior |
| Watcher leak on re-dispatch/exit (handle keeps process alive or watches a torn-down worktree) | Technical | Medium | Medium | Explicit dispose lifecycle (on re-dispatch before teardown; all on exit); tests assert disposal |
| Event burst / spurious wake double-dispatch | Technical | Low | High | Latch coalesces; dispatch still requires `!inFlight` + `isHalted()===false`; test covers wake-while-still-halted |
| New-spec discovery latency rises ≤5s → ≤60s | Technical | Certain | Low | Documented behavior change; `--idle-poll` remains configurable |
| chokidar dep enlarges bundle / fsevents build friction | Integration | Low | Low | Prefer chokidar v4 (1 dep); else mark fsevents external in tsup |

## ADRs Created

- `adr-2026-07-04-event-driven-halt-clear-wake.md` — chokidar seam, watch-never-authority,
  waker latch, 60s single-timer backstop, `--no-watch`, transition-only logging.
  (DRAFT → operator approval required before land.)

## Conditions

None — APPROVED. The plan must cite seams by symbol (current line refs), not the intake
issue's stale line numbers.
