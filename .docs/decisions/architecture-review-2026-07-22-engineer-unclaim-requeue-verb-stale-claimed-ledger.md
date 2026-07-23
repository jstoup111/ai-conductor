# Architecture Review: stale claim recovery (unclaim / requeue + auto-heal)

**Date:** 2026-07-22
**Tier:** M (lightweight review)
**Verdict:** APPROVED — proceed to stories.

## Scope reviewed

The PRD (12 FRs) for recovering stranded `claimed` intake entries: automatic reap at
claim time, a manual single-idea recovery verb, a manual bulk recovery verb with a
GitHub-issue liveness rule, FIFO preservation, and a re-entry counter.

## Feasibility

Low risk. Every surface is an extension of existing machinery:
- The automatic path is one added rule in the already-invoked `createDeliveryGuardedQueue`
  claim-time heal pass (`delivery-guard.ts`), which today heals delivered entries to `done`.
- The transition is a new `Ledger` operation alongside the existing `transition`/`reopen`.
- The verbs are two new cases in the `engineer` CLI subcommand switch, next to
  `claim`/`forget`/`resolve`.
- The liveness check reuses the same `gh` issue-state read the intake system already performs.

No new subsystem, data model, auth surface, or external dependency (GitHub is already used).

## Load-bearing decisions (see ADRs)

1. **Staleness window default** — the value that classifies a `claimed` entry as abandoned.
   Directly sets the #243 duplicate-processing risk window. See
   `adr-2026-07-22-stale-claim-staleness-window-default.md`.
2. **A dedicated `claimed → pending` transition**, distinct from `reopen`'s `done → pending`,
   preserving `capturedAt`. See `adr-2026-07-22-requeue-claimed-distinct-from-reopen.md`.
3. **Re-entry (`attempts`) counter semantics** on crash recovery. See
   `adr-2026-07-22-attempts-counter-on-crash-recovery.md`.
4. **Heartbeat/lease deferred** — accept a bounded duplicate-processing window now, closed
   fully later by a lease. See `adr-2026-07-22-heartbeat-lease-deferred.md`.

## Risks & mitigations

- **Duplicate processing (#243):** automatic reap cannot distinguish a dead session from a live
  long one (no heartbeat). Mitigated by a generous default window (ADR-1) and the manual override
  being the primary tool for known-dead sessions. Residual risk explicitly accepted (ADR-4).
- **Reaping a delivered entry:** avoided — the reap predicate targets only `claimed` (not
  `done`/`routed`/`deciding`); the delivered-entry heal (→ `done`) already runs first in the same
  pass and takes precedence.
- **Ordering regression:** FIFO preserved by carrying `capturedAt` through the transition (ADR-2);
  covered by a dedicated story.

## Architectural alignment

Aligns with the harness Design Principle ("deterministic machinery at the point of the mistake"):
the primary recovery is automatic and deterministic at the exact moment intake is pulled, not a
prose rule or a remedial operator ritual. The manual verbs are a safe explicit override, not the
primary mechanism.
