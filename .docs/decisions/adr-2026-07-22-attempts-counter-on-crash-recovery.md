# ADR: `attempts` counter increments on stale-claim recovery

**Date:** 2026-07-22
**Status:** APPROVED

## Context

FR-11 requires recovery to record that an idea re-entered the queue, for observability, without
disturbing capture-time ordering (FR-4). The entry already carries an `attempts` field, which
`reopen` increments on a `done → pending` re-eligibility. The question: should `claimed → pending`
crash recovery also increment `attempts`, or leave it untouched?

## Decision

- **Increment `attempts` on recovery** (both automatic and manual), consistent with `reopen`.
- `capturedAt` is left untouched, so FIFO ordering (FR-4) is unaffected — `attempts` is a churn
  counter, not an ordering key.
- A high `attempts` value on an entry that keeps getting stranded is a useful signal (an idea
  whose sessions repeatedly die may warrant operator attention or `needs-manual`), so counting
  crash re-entries the same as delivery-failure re-entries is desirable.

## Consequences

- `attempts` becomes a combined re-entry count across both crash recovery and delivery-failure
  re-eligibility. This is acceptable: both represent "this idea has churned through intake again."
- No separate counter is introduced (avoids schema growth); if the two causes ever need to be
  distinguished for reporting, that is a later, additive change.
