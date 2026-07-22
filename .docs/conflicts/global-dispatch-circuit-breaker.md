# Conflict-check: Global dispatch circuit-breaker

Checked the new stories/design against existing daemon behaviors that also
observe dispatch outcomes, park features, or bound retries. Result: **no blocking
conflicts.** Two overlaps require ordering discipline (captured as plan
constraints), not redesign.

## Contradictions — none

- The breaker never *unparks* or *re-dispatches* anything; it only *adds* an
  exclusion. It cannot contradict a gate that keeps a feature running.

## Overlaps (coordinate, do not duplicate)

1. **`build_progress_halt` also parks via `.daemon/parked/<slug>`.**
   - Overlap: both may write the same auto-park marker for the same slug.
   - Resolution: `writeAutoPark` is idempotent (`wx` exclusive create) — the
     first writer wins, the second is a silent no-op. No coordination code
     needed; the breaker must simply reuse `writeAutoPark` (not a bespoke
     marker) so the invariant holds. Reasons may differ; that is acceptable
     (whichever parked it first explains it).

2. **`onHaltWritten` / episode-caused HALT recovery also runs in `collectOne`.**
   - Overlap: the breaker counts in the same choke point where `onHaltWritten`
     records episode causality and `parked.add(slug)` runs.
   - Resolution: counting is additive and ordering-independent of
     `onHaltWritten`. The breaker's increment/reset should run **after**
     `parked.add`/`onHaltWritten` in `collectOne` so the outcome is fully
     recorded first. No shared mutable state between them.

3. **Rate-limit episode fallback.** Dispatches suppressed while an episode is
   active are *not dispatched at all*, so they produce no outcome and cannot
   increment the counter — a rate-limit storm cannot false-trip the breaker.
   No change needed; note as an invariant to preserve in tests.

## State conflicts — none

- New state is a single in-memory `Map` local to `runDaemon`, disjoint from
  `parked`/`started`/`progressReKickCounts`. No shared-write hazard.
- The durable trip marker is the existing `.daemon/parked/<slug>` — already the
  single source of truth for parks (`park-marker.ts`). No new persistent key.

## Resource contention — none

- No new files polled per tick, no new git/network calls on the hot path. The
  progress check reuses the already-read TaskEvidence sidecar signal.

## Config-surface conflict — none

- `circuit_breaker` is a new top-level block; it does not overlap
  `build_progress_halt`, `retry_routing`, or `defaults.max_retries`. Validation
  is independent. (Unlike `build_progress_halt.attempt_ceiling`, the breaker
  ceiling has **no** `max_retries` floor coupling — it counts whole dispatches,
  not in-step retries — so no cross-field validation constraint is introduced.)

## Ordering constraints exported to the plan

- Reuse `writeAutoPark` for the trip (overlap 1).
- Count after outcome recording in `collectOne` (overlap 2).
- Do not count suppressed/episode-gated non-dispatches (overlap 3).
