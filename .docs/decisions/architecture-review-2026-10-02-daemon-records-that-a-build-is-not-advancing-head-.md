# Architecture Review: Daemon records that a build is not advancing HEAD but never acts on it
**Date:** 2026-10-02
**Mode:** Lightweight (Medium tier): Technical Feasibility + Architectural Alignment
**Input:** explore decision (approach A, technical track, scope "classify + end the attempt", default
action `warn`), intake #2102, approved diagrams
`.docs/architecture/daemon-records-that-a-build-is-not-advancing-head-.md` and its sequence.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. execa `^9` (verified in `src/conductor/package.json`) supports `cancelSignal`. Aborting it sends SIGTERM, then SIGKILL after a 5s grace, and marks the error `isCanceled` (verified, execa docs). |
| Prerequisites | None. The `build_progress` config block, the watcher, the step heartbeat, and `provider-execution`'s `abortSignal` forwarding all exist (verified by reading source). |
| Integration surface | Watcher, build dispatch loop (`conductor.ts`), config parse/resolve, event union + sinks + daemon-log/TTY/OTel renderers, Claude and Codex adapters. One subsystem plus two adapter seams. |
| Data implications | No durable state. The episode clock is in memory and per attempt, like the existing quiet episode. |
| Performance | No new polling. Classification reuses the tick's existing HEAD probe and heartbeat read. |
| Worktree isolation | Per-attempt, per-worktree. No shared resources. |

**Verified facts the design rests on:**
- `build_no_progress` has no consumer with authority: sinks are render/persist/otel only (`event-sinks.ts`, verified ~95%).
- Heartbeats have no dispatch authority (`step-runners.ts` "former watchdog controls have no effect", verified ~95%).
- `provider-execution.ts` forwards `abortSignal` to the adapter and checks it before each candidate (verified ~90%).
- `claude-provider.ts` and `codex-provider.ts` never read `abortSignal`. Both spawn through execa (verified ~90%). Only `pi-provider.ts` honours it today.
- The watcher is constructed per build attempt and stopped in a `finally` (`conductor.ts`, verified ~90%).

## Alignment

- **adr-2026-07-10-intra-step-build-progress-events** governs the watcher, its config block and
  its events. It is amended additively (decisions 8 and 9), not superseded. Its decision 4 (breaker
  rules unchanged) still holds: the breaker's classifications are untouched and only gain a new
  stall reason.
- **adr-2026-07-30-provider-preparation-lifecycle-supervision** decision 4 bars output silence from
  termination authority. The design keeps that bar: a `quiet` tick never arms the bound. Termination
  requires *fresh* activity plus no HEAD or task movement. A mis-attributed heartbeat degrades to
  `quiet`, which means no action, the safe direction for the stale-attribution false kill that ADR
  cites.
- **adr-2026-07-23-commit-movement-liveness-floor** and **adr-2026-07-12-progress-aware-build-halt**:
  an ended attempt enters attempt-end classification unchanged. A second consecutive
  active-stall attempt with count and HEAD pinned is classified `no_task_progress` by the existing
  floor, so the action is bounded by existing budgets with no new counter.
- **Event spine:** one new `ConductorEvent` kind (`build_active_stall`) plus one field
  (`activity`). Both go through `ConductorEventEmitter` → `EventPersister` → `.pipeline/events.jsonl`,
  with no sidecar, watcher, or log of their own (event-spine skill: schema, not file).
- **Ownership boundary:** cancellation authority stays with the dispatcher that owns the attempt.
  The watcher only calls a callback (decision 9). It never signals a process.
- **State:** `activity` is a closed string union. `active_stall_action` is a closed union.
  No boolean flags.
- **Security:** no new inputs beyond two validated config keys.

## Wiring Surface

| New surface | Production caller (design-time) |
|---|---|
| `build_progress.active_stall_minutes`, `active_stall_action` | Parsed and validated in `engine/config.ts` alongside `quiet_minutes`. Resolved by `resolveBuildProgressConfig`, which the watcher constructor already calls. |
| `activity` field on `build_progress` / `build_no_progress` | Emitted by the watcher's existing tick. Rendered by `daemon-cli.ts` `renderDaemonEvent` and the TTY renderer. |
| `build_active_stall` event | Emitted by the watcher. Registered in the event union, `event-sinks.ts` and the persister type list. Rendered by the daemon-log and TTY renderers. Mapped in `OtelVisualizer` / span manager. |
| `endAttempt` callback option on `BuildProgressWatcher` | Supplied by the build dispatch loop in `conductor.ts` where the watcher is constructed. |
| Per-attempt `AbortController` for build | Created in the build dispatch loop. Its signal is passed through the build step runner into `executeProviderCandidates`. |
| Adapter cancellation | `claude-provider.ts` `runClaude` and `codex-provider.ts` `spawnCodex` pass `cancelSignal` from the invocation's `abortSignal` into their execa options. |
| Active-stall stall reason | Set in the attempt-end classification block of the build dispatch loop. Read by the existing `build_stall` emission and HALT reason. |

Overlap scan over these paths: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `end_attempt` kills a legitimately long, slow verification pass (e.g. at resolved = total) | Technical | Medium | Medium | Default action is `warn`. The bound is per-project configurable. Any HEAD/task movement clears the episode. |
| Aborted attempt falls through to a fallback provider candidate within the same attempt | Integration | Low | Medium | Decision 9 requires no further candidates after abort. `provider-execution` already checks the signal before each candidate. Covered by a story criterion. |
| A provider subprocess ignores SIGTERM | Technical | Low | Low | execa escalates to SIGKILL after its grace period. |
| An aborted attempt leaves a partial uncommitted worktree | Data | Medium | Low | Same state as today's provider crash or retry. The next attempt starts from the committed branch, and the existing protected-artifact checks run per attempt. |
| Heartbeat mis-attribution makes an active provider look quiet | Technical | Low | Low | Fails safe: no action. Visible in the `activity` field. |

No High-impact risk.

## ADRs Created

None. The structural change (watcher → dispatcher cancellation seam; adapter cancellation contract)
is owned by adr-2026-07-10-intra-step-build-progress-events, amended with decisions 8–9.

## Conditions

1. The default `active_stall_action` stays `warn`. No feature may flip the default without its own
   operator decision.
2. Stories must cover: a quiet tick never fires the bound; renewed movement clears the episode; an
   aborted attempt runs no further provider candidates; both the Claude and Codex adapters terminate
   their subprocess on abort.
3. Docs for the two new keys go in the existing configuration reference and the
   stalled-or-stuck runbook (where operators look today), not a new page.
