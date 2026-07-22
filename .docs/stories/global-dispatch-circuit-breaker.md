# Stories: Global dispatch circuit-breaker

Status: Accepted

Feature: issue jstoup111/ai-conductor#714 — a hard per-feature circuit-breaker on
consecutive failed dispatch/resume attempts, so the daemon cannot spin
indefinitely on a failing attach.

Terminology: **ceiling** = `circuit_breaker.consecutive_failure_ceiling`
(resolved config, default 5). **Trip** = write the durable `.daemon/parked/<slug>`
auto-park marker with a circuit-breaker reason.

---

## S1 — Trip on N consecutive no-progress failures (happy path of the guard)

**As** the daemon
**I want** to stop re-dispatching a feature after N consecutive failed,
no-progress attempts
**So that** one wedged feature cannot consume the whole run.

- **Given** a feature whose dispatch fails with the same error every attempt
  (e.g. `createWorktree` exits 128) and makes no forward progress,
- **And** `circuit_breaker.enabled` is true with `consecutive_failure_ceiling = N`,
- **When** the feature has produced `N` consecutive non-`done`, no-progress
  outcomes,
- **Then** the daemon writes a `.daemon/parked/<slug>` auto-park marker whose
  reason names the circuit-breaker and the last failure reason,
- **And** the feature is not dispatched again for the rest of the run,
- **And** no further attempts for that slug occur (the ~5s re-dispatch loop
  stops).

## S2 — The trip catches a pre-build failure that writes no HALT marker

**As** the daemon
**I want** the breaker to fire even when the failure happens before a worktree
exists
**So that** the exact #714 loop (no worktree ⇒ no HALT marker ⇒ re-dispatched
every poll) is bounded.

- **Given** a feature whose `createWorktree` throws before any worktree/HALT
  marker is created,
- **When** it returns `{status:'error'}` and is re-selected by `pickEligible`
  (because `isHalted` is false — no marker),
- **Then** each such outcome increments the slug's consecutive-failure counter,
- **And** on reaching the ceiling the breaker trips and parks the slug,
- **And** the trip does **not** depend on any `.pipeline/HALT` marker being
  present.

## S3 — Forward progress resets the counter (no false-trip on a recovering attach)

**As** a feature that is genuinely making progress across dispatches
**I want** my failure counter reset when I advance
**So that** a slow-but-recovering attach is never parked by the breaker.

- **Given** a feature that has accrued `k < N` consecutive failures,
- **When** a subsequent dispatch makes forward progress (its resolved-task count
  increases per the TaskEvidence sidecar) — even if the outcome is still
  `halted`/`error` for an unrelated reason,
- **Then** the counter is reset to zero,
- **And** the feature is not parked by the breaker,
- **And** it must accrue `N` *consecutive* no-progress failures again before any
  trip.

## S4 — `done` resets the counter

- **Given** a feature that failed `k < N` times consecutively,
- **When** a later dispatch completes `done` (verified ship),
- **Then** the counter is cleared,
- **And** the breaker never parks a shipped feature.

## S5 — Trip result is durable across daemon restart; counter is not

**As** the operator
**I want** a tripped feature to stay parked after a restart
**So that** the daemon does not resume the spin on reboot.

- **Given** the breaker has tripped and written `.daemon/parked/<slug>`,
- **When** the daemon restarts,
- **Then** the feature remains excluded from dispatch (existing
  `isParked`/`isOperatorParked` gate) until an operator un-parks it,
- **And** the in-memory consecutive-failure counter starts at zero after the
  restart (per ADR-2026-07-22), so a feature that had reached only `N-1` before
  the restart gets a fresh `N` attempts.

## S6 — Config: knob validated, defaulted, and honored

- **Given** `circuit_breaker` is absent from config,
- **Then** the resolved config is `{ enabled: true, consecutive_failure_ceiling: 5 }`.
- **Given** `circuit_breaker.consecutive_failure_ceiling` is set to a positive
  integer, **then** the daemon trips at that value.
- **Given** it is set to a non-positive or non-integer value, **then** config
  validation fails with a clear message (mirrors `build_progress_halt`
  validation).
- **Given** `circuit_breaker.enabled` is false, **then** the counter is never
  consulted and no breaker park is ever written (pre-feature behavior; other
  bounds unchanged).

## S7 — Operator can see and recover a breaker-parked feature

- **Given** a feature parked by the breaker,
- **When** the startup dashboard renders,
- **Then** the feature appears as an **auto-park** with the circuit-breaker
  reason extracted from the marker body,
- **And** an operator un-park (removing `.daemon/parked/<slug>`) makes the
  feature eligible again, at which point its counter begins again from zero.

---

## Negative / boundary paths (explicit)

- **N-1 must NOT trip.** A feature with exactly `N-1` consecutive no-progress
  failures is still dispatched; only the `N`-th crosses the threshold. (S1
  boundary.)
- **Interleaved progress must NOT trip.** Failures separated by any
  forward-progress dispatch never accumulate to `N` consecutive. (S3.)
- **A normal human-park (HALT marker) must NOT be double-counted into a spin.**
  A feature that halts with a `.pipeline/HALT` marker is already gated by
  `isHalted` and is not re-dispatched, so its counter does not climb; the breaker
  is a backstop for the *unbounded re-dispatch* case, not a replacement for the
  HALT gate. (Alignment with existing behavior.)
- **Breaker park must NOT be auto-cleared by a base advance.** `rekickSweep`
  skips `isOperatorParked` slugs, so a breaker park survives base advances;
  recovery is explicit operator un-park (correct for a deterministic failure).
- **Idempotent trip.** Re-entering the trip path for an already-parked slug
  (e.g. a race) is a no-op — `writeAutoPark` uses exclusive-create; the counter
  stays pinned at the ceiling and does not re-write.
- **Disabled breaker is inert.** With `enabled:false` no counter is kept and no
  park is written — verifiably identical to today's behavior.
- **Accepted out-of-scope gap:** a daemon that *crash-restarts* between each of
  fewer-than-`N` attempts never accumulates a trip (in-memory counter resets).
  This is a distinct crash-loop failure mode (#681-class), documented in the ADR,
  not addressed here.
