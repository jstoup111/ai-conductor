# Stories: daemon-rekick play-forward routes conflicts through the gated /rebase loop

**Issue:** #300
**Track:** technical
**Complexity:** Small

## Context

`resumeRebaseFirst` (`daemon-rekick.ts`) — the FR-12 re-kick play-forward path — calls
`performRebase` directly and, on `conflict_halt`, immediately writes a human HALT. The
finish-time step `runRebaseStep` (`conductor.ts`) instead routes a `conflict_halt` through a
bounded, gated `/rebase` resolution sub-loop (cap from `rebase_resolution_attempts`) before
parking. A feature that reaches a conflict via the daemon's own re-kick sweep therefore gets
a single bare attempt while the same conflict on the finish path gets up to N automated
resolution attempts. Fix: share one gated-resolution helper across both call sites.

## Story 1 — Re-kick play-forward auto-resolves a conflict (happy path)

**Given** a re-kicked worktree whose branch re-conflicts when rebased onto the advanced base,
and the daemon wires a resolver plus a positive attempt cap,
**When** `resumeRebaseFirst` runs,
**Then** the conflict is dispatched through the same bounded `/rebase` resolution loop, the
rebase completes, no `.pipeline/HALT` is written, and the result is `rebased`.

### Negative path 1a — resolver exhausts the cap
**Given** the same conflict but a resolver that never completes the rebase within the cap,
**When** `resumeRebaseFirst` runs,
**Then** after the bounded attempts a human `.pipeline/HALT` is written and the result is
`halted` — the rebase left paused (identical to today's terminal outcome, only reached after
the attempts, not before them).

### Negative path 1b — no resolver / cap 0 wired (backward compatible)
**Given** a conflict but `resolveAttempts` unset (or 0) or no resolver passed,
**When** `resumeRebaseFirst` runs,
**Then** behavior is byte-identical to today: immediate HALT, result `halted`, no attempts,
no resolution events emitted.

## Story 2 — Shared helper preserves finish-time behavior

**Given** `runRebaseStep`'s existing gated sub-loop is refactored onto the shared helper,
**When** the finish-time rebase conflicts (resolver resolves / cap 0 / resolver throws),
**Then** every existing `rebase-resolution-wiring` outcome and event
(`rebase_resolution_attempt` `{index, cap}`, `succeeded`, `exhausted`) is unchanged.

### Negative path 2a — resolver throws
**Given** the resolver throws mid-attempt on either call site,
**When** the helper runs,
**Then** the throw degrades to a failed attempt (never propagates), ending in HALT once the
cap is exhausted — no crash.
