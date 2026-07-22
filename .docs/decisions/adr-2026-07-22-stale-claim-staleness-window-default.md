# ADR: Staleness window default for automatic stale-claim recovery

**Date:** 2026-07-22
**Status:** APPROVED

## Context

Automatic recovery (FR-2) reaps a `claimed` entry back to `pending` when its age past
checkout exceeds a **staleness window**. The age signal is `now − lastSeenAt`, and
`lastSeenAt` is stamped when the entry became `claimed`; no heartbeat refreshes it during a
live DECIDE session. Therefore a live session still working an idea and a dead session that
abandoned one look identical after enough elapsed time. Too short a window reaps live work
(the #243 duplicate-processing hazard); too long a window leaves intake starved longer.

The engineer is phone-drivable and interactive — an operator can legitimately hold a claim
open across a long DECIDE (explore → prd → architecture → stories → conflict → plan) and may
step away mid-idea.

## Decision

- The automatic-reap staleness window is **configurable**, with a **default of 24 hours**.
- 24h is deliberately conservative: it makes reaping a still-live session's claim effectively
  impossible (no plausible single active session holds a claim a full day without any intervening
  lifecycle transition), at the cost of a crashed session's idea sitting stranded up to a day
  before *automatic* recovery. The manual path recovers such an idea immediately, so the
  automatic window is tuned to minimize the #243 duplicate-processing risk rather than to
  minimize stranding latency.
- The manual bulk path accepts an explicit tighter age bound so an operator who *knows* sessions
  are dead can recover sooner without waiting for the default; the manual single-idea path has
  no age gate at all (the operator asserts the session is dead).
- The default lives in engine configuration (resolved the same way other engine tunables are),
  not hard-coded at the call site.

## Consequences

- The #243 duplicate-processing window is bounded to the configured value; a live session that
  outlives it and is then re-claimed elsewhere could be processed twice. This residual risk is
  explicitly accepted (see `adr-2026-07-22-heartbeat-lease-deferred.md`) and is why the manual
  override, not the automatic path, is the primary tool for known-dead sessions.
- Operators with unusually long or unusually short session patterns can tune the window.
