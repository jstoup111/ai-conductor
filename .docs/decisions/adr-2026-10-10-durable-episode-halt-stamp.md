# ADR: Episode-caused HALT stamps are durable per-worktree state

**Date:** 2026-10-10
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for jstoup111/ai-conductor#1023

## Context

`adr-2026-07-05-daemon-rate-limit-episode-coordinator` made the rate-limit episode an in-process
coordinator and accepted that "episode state is lost on daemon restart" because an episode is
transient and the daemon re-discovers its backlog on startup. Task 20 of that work later added
episode-caused HALT recovery: when the daemon parks a halted/error outcome during an active episode
it stamps the slug, and when the episode ends a sweep clears exactly those stamped HALTs through the
existing `clearMarker` rekick primitive.

The stamps live in an in-memory `Set` (`src/conductor/src/engine/episode-halt-tracker.ts`,
`createEpisodeHaltTracker`). The 2026-07-05 trade-off does not hold for them: re-discovery on
startup does **not** recover a HALTed feature — `isHalted` keeps it out of `pickEligible` until a
human or a sweep clears the marker. So a daemon restart (operator restart, stale-engine restart,
crash) silently converts every recoverable episode-caused HALT into operator work. Verified by
reading the tracker (in-memory only) and the sweep wiring in `daemon-cli.ts` (`sweepEpisodeHalts`
reads only the tracker), confidence 95%.

The HALT marker family already has durable per-worktree state with a defined lifecycle:
`.pipeline/HALT.class` (`adr-2026-07-28-total-halt-classification-legacy-boundary`). Its D4 makes the
shared writer `writeHaltMarker` remove the stale class sidecar *before* writing a new HALT body, and
`clearMarker` removes it when the HALT is cleared. Both behaviors verified in
`engine/halt-marker.ts` and `engine/daemon-rekick.ts`, confidence 95%.

Event-spine check (`.agents/skills/event-spine/SKILL.md`): "this HALT was caused by a rate-limit
episode" is a fact about a live marker that must be true *now* and read by name at recovery time —
exception C (durable state), the same category as `HALT.class`. The `loop_halt` and park occurrences
on `events.jsonl` are unchanged; nothing is reconstructed from them.

## Options Considered

### Option A: Durable `.pipeline/HALT.episode` sidecar with the HALT.class lifecycle
- **Pros:** survives restart; reuses the proven D4 sidecar lifecycle, so a stale stamp cannot outlive
  the HALT it describes; recovery reads state by name with no replay; small surface.
- **Cons:** one more sidecar in the HALT family; an operator `rm -f .pipeline/HALT` that skips the
  shared writer leaves an orphan stamp, which must be detected (see decision 3).

### Option B: Rebuild the tracker by replaying `events.jsonl` at startup
- **Pros:** no new file; rides the spine.
- **Cons:** reconstructs state from occurrences (the inverse misuse exception C warns about); must
  correlate each stamp to the current HALT across clears and re-halts or a stale stamp clears a later
  human HALT; per-worktree ledger scan on every startup.

### Option C: Encode episode causality as a `HALT.class` value
- **Pros:** no new file; the sweep already reads the class.
- **Cons:** collides with the halt's real disposition — a kickback-cap or needs-human HALT raised
  during an episode would have to choose one class, weakening `adr-2026-07-28` D1's closed writable set.

## Decision

Option A, because it makes the stamp exactly as durable and exactly as short-lived as the HALT it
describes, using a lifecycle the HALT family already enforces.

1. **The stamp is a per-worktree sidecar `.pipeline/HALT.episode`.** The daemon writes it when it
   parks a halted/error outcome while the episode is active (today's `onHaltWritten(slug, true)`
   point in `engine/daemon.ts`). It records the episode deadline observed at stamping and a digest
   of the HALT body it was written for. The in-memory `Set` is removed; the tracker reads and writes
   the sidecar. The rate-limit episode itself stays in-memory, unchanged from `adr-2026-07-05`.
2. **The sidecar follows the HALT.class lifecycle.** `writeHaltMarker` removes any existing
   `HALT.episode` before writing a new HALT body, alongside the class sidecar it already removes, and
   `clearMarker` removes it when it clears the HALT. Either path fails toward safety: a missing stamp
   means "not auto-recoverable" and leaves the HALT for a human.
3. **A stamp is valid only for the HALT it was written for.** At recovery a stamp whose digest does
   not match the current HALT body, or whose HALT is absent, is discarded and its HALT left alone.
   This covers an operator who clears a HALT by hand and a later HALT written outside the shared
   writer.
4. **Recovery runs whenever no episode is active, not only on the in-process episode-end edge.**
   The stamped-HALT recovery runs at daemon startup and on idle ticks while no episode is active,
   for stamps whose recorded deadline has passed. The in-process episode-end sweep is subsumed by
   this rule. If the limit persists after a post-restart recovery, the conductor's existing
   rate-limit branch re-enters the episode and waits rather than halting, per `adr-2026-07-05`.
5. **Operator precedence is kept, and an unclassified HALT is retained.** Operator park and
   operator-action HALT classes still outrank automatic recovery, as in today's
   `recoverEpisodeHalts`. In addition, an absent or unreadable `HALT.class` is retained rather than
   recovered, applying `adr-2026-07-28-total-halt-classification-legacy-boundary` D2/D4 (an
   unclassified HALT is operator-required) to episode recovery; today's episode path recovers it.
   A stamp never overrides any of these.

## Consequences

### Positive
- A daemon restart no longer turns recoverable episode-caused HALTs into operator work.
- The stamp can never outlive or mis-attach to a different HALT: lifecycle removal plus digest check.
- No new channel: state is read by name like `HALT.class`; `events.jsonl` is untouched.

### Negative
- One more sidecar for operators to know about; runbooks that say `rm -f HALT HALT.class` leave an
  orphan `HALT.episode`, which is harmless (discarded by decision 3) but visible.
- Idle-tick recovery reads one small file per halted worktree while no episode is active.

### Follow-up Actions
- [ ] Add the `HALT.episode` path constant beside `HALT_CLASS_MARKER` in `engine/halt-marker.ts`.
- [ ] Extend `writeHaltMarker` and `clearMarker` to remove the sidecar.
- [ ] Replace the in-memory tracker with the sidecar-backed store; wire it in `daemon-cli.ts`.
- [ ] Expose the episode deadline needed for the stamp from `RateLimitEpisode`.
- [ ] Run stamped-HALT recovery at `DaemonMaintenance.startup` and on idle ticks with no active episode.
