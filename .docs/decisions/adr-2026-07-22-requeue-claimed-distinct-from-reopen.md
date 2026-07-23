# ADR: A dedicated `claimed → pending` recovery transition, distinct from `reopen`

**Date:** 2026-07-22
**Status:** APPROVED

## Context

The `Ledger` already has `reopen`, which moves a `done` entry back to `pending` (used when a
spec PR closes unmerged, FR-39/40) and **increments `attempts`**. Stale-claim recovery needs
`claimed → pending`. It is tempting to reuse `reopen`.

But the two lifecycles differ: `reopen` recovers a *delivered-then-reverted* idea; stale-claim
recovery recovers a *never-delivered, abandoned* idea. Recovery must preserve `capturedAt`
(FR-4, FIFO), and it must not accidentally act on a `done`/`routed`/`deciding` entry.

## Decision

- Add a dedicated ledger operation for `claimed → pending` recovery (working name
  `requeueClaimed`), separate from `reopen`.
- It transitions **only** an entry currently in `claimed`; it is a no-op (or a reported refusal
  for the single-idea verb) for any other status. This keeps the delivered-entry heal (→ `done`)
  and the reverted-entry `reopen` (`done → pending`) from entangling with crash recovery.
- It preserves `capturedAt` unchanged so recovered ideas keep their queue position.

## Consequences

- Three explicit, non-overlapping lifecycle recoveries exist: delivered → `done` (delivery-guard),
  reverted `done → pending` (`reopen`), abandoned `claimed → pending` (`requeueClaimed`). Each is
  independently testable and reviewable.
- The single-idea manual verb's refuse-on-terminal behavior (FR-6) falls out naturally: the verb
  refuses any ref whose current status is not `claimed`.
