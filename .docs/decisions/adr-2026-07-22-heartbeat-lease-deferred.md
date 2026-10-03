# ADR: Defer a claim heartbeat/lease; accept a bounded duplicate-processing window now

**Date:** 2026-07-22
**Status:** APPROVED

## Context

The only fully correct way to distinguish an abandoned `claimed` entry from one a live session
is actively working is a **liveness signal** — a heartbeat the live session refreshes, or a
lease with an owner id/PID the recovery path can check. Without it, automatic recovery relies on
elapsed time (`now − lastSeenAt`) and can, in the worst case, reap a live long session's entry,
allowing that idea to be processed twice (#243).

A lease is a larger change: it requires a session to register ownership on claim, refresh it
during DECIDE, and release it on exit — touching the session lifecycle, not just intake.

## Decision

- **Do not build a heartbeat/lease in this feature.** Ship time-based automatic recovery with a
  generous default window (`adr-2026-07-22-stale-claim-staleness-window-default.md`) plus the
  manual override as the primary tool for known-dead sessions.
- Record the duplicate-processing window as a **known, bounded, accepted** residual risk.
- A lease/heartbeat that closes the window entirely is explicitly noted as future work (it would
  let automatic recovery skip any entry whose lease is still live, eliminating the race).

> **Decision index (backfilled 2026-10-03, #2140).** Additive citable ids over the approved text above;
> no change of substance. Each id names a decision exactly as already stated above.
>
> **D1** — Do not build a heartbeat/lease in this feature; ship time-based automatic recovery with a generous default window plus the manual override as the primary tool for known-dead sessions. (above: "**Do not build a heartbeat/lease in this feature.**")
> **D2** — The duplicate-processing window is recorded as a known, bounded, accepted residual risk. (above: "Record the duplicate-processing window")
> **D3** — A lease/heartbeat that closes the window entirely is explicitly noted as future work. (above: "A lease/heartbeat that closes the window entirely")

## Consequences

- The feature is small and self-contained (no session-lifecycle changes), and solves the actual
  reported failure (permanently stranded ideas from dead sessions).
- The #243 duplicate-processing risk is reduced from "unbounded / latent" to "bounded by the
  staleness window and preventable via the manual path," but not eliminated. Eliminating it is a
  separate, additive future feature.
