# ADR 2026-07-22 — Dispatch circuit-breaker: in-memory counter, durable park

- **Status: APPROVED**
- Date: 2026-07-22
- Feature: Global dispatch circuit-breaker (issue jstoup111/ai-conductor#714)
- Deciders: engineer (operator delegate)

## Context

The daemon can re-attempt a deterministically-failing dispatch/resume forever
(observed: 256 `git worktree add … exit 128` retries over 4h07m, ~5s apart, no
cap). We are adding a per-feature circuit-breaker: **N consecutive failed,
no-progress dispatch outcomes → park the feature**.

This requires two pieces of state:

1. **The trip result** — the fact that a feature is parked by the breaker.
2. **The consecutive-failure counter** — how many no-progress failures a feature
   has accrued in a row.

For each we must decide: **in-memory (per daemon run) or durable (survives
restart)?** The #286 precedent — `lastRekickSha` resetting on restart caused a
real bug — makes this load-bearing, so it is settled here rather than implicitly.

## Decision

1. **Trip result = DURABLE.** The trip writes the existing
   `.daemon/parked/<slug>` auto-park marker (`writeAutoPark`, `park-marker.ts`).
   It survives daemon restart and is honored by every existing dispatch gate
   (`isParked`/`isOperatorParked` in `pickEligible` + `guardedDispatch`). Once
   tripped, a feature stays parked across restarts until an operator un-parks it.

2. **Counter = IN-MEMORY, per run.** The consecutive-failure counter is a
   `Map<string, number>` local to `runDaemon` (same lifetime as `parked`,
   `started`, `progressReKickCounts`). It resets to zero on daemon restart.

3. **Counter resets on forward progress or `done`** (not only on `done`), using
   the resolved-task-count signal the existing progress-gated re-kick already
   consults — so a legitimately-recovering attach never trips.

## Rationale

- The **observed failure is entirely within one continuous run** (4h07m of a
  single day's daemon). An in-memory counter fully bounds that: the counter
  climbs to the ceiling within the run and trips. No durable counter is needed to
  stop the observed spin.
- A **durable counter re-introduces the #286 hazard**: any durable "N attempts so
  far" state must define reset-on-restart semantics, and getting them wrong is
  exactly the class of bug #286 was. The marginal benefit — catching a daemon
  that *crash-restarts* between each of <N attempts — addresses a **different
  failure mode** (a crashing daemon, #681-class), not the dispatch-spin this
  issue targets.
- Because the **trip result is durable**, the "spin forever even across restarts"
  hole is already closed: the first time any run trips the breaker, the park
  persists. The only thing an in-memory counter "loses" on restart is partial
  accumulation (a feature at N-1 failures resets to 0), which grants the feature
  a fresh N attempts after an operator-initiated or stale-engine restart — an
  acceptable, even desirable, second chance.

## Consequences

- **Accepted gap (documented):** a daemon that restarts more often than every N
  consecutive failures for the same slug would never accumulate to a trip. This
  is out of scope (it is a crash-loop failure mode, tracked separately) and is
  called out in the stories' negative-path section.
- No new persistent schema, no migration. Reuses `.daemon/parked/<slug>`.
- Recovery is an explicit operator un-park; a base-advance `rekickSweep` does not
  auto-clear a breaker park (it skips `isOperatorParked` slugs), which is correct
  for a deterministic failure.
- The breaker park is indistinguishable in *storage* from other auto-parks
  (both `auto-parked: …`); the **reason string** carries the circuit-breaker
  provenance (`circuit-breaker: N consecutive failed dispatch/resume attempts —
  last: <reason>`) so the dashboard/log disambiguates.

## Alternatives considered

- **Durable counter** (rejected): #286 reset-semantics hazard; benefit addresses
  a different failure mode.
- **Exponential backoff instead of a hard park** (rejected as primary): slows but
  never stops the spin; #714 asks for a hard stop. May compose later.
- **Daemon-wide global failure budget** (rejected): would let one wedged feature
  park healthy ones; the issue scopes the bound to "the same feature".
