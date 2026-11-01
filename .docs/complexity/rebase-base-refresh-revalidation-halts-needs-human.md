# Complexity: Rebase base-refresh revalidation halts needs-human at child BUILD entry

Tier: M

## Rationale

This is one bounded mechanism on existing seams. It adds a shared reconcile→consume admission helper
for the revalidation queue, and resume preflight (`restack/stack-preflight.ts`), the routed-exit
continuation (`conductor.ts`), and BUILD-region entry (`enterRoutedHostRegion` in `conductor.ts`)
all call it. It adds no new service, persisted format, CLI surface, or state machine. It reuses the
existing `consumeLowestQueued` result kinds, including the `busy` and `stalled` results that #3445
(PR #3521) introduced.

It is classified **Medium** rather than Small for three reasons:

- It changes when routed-repair queue consumption happens, which is recorded in the APPROVED
  `adr-2026-10-12-routed-whole-feature-repair`. Decision 14 (where consumption happens) and
  Decision 8 (region entry admits before treating a child as `revalidating`) need amendments, and
  Small's architecture-review skip cannot produce them.
- It touches the stacked-feature loop's BUILD-region entry. That makes the regression risk
  stack-wide, and the negative paths are correctness-critical: no duplicate revalidate rounds on
  resume, no admission past the round-admission fence, and a precise halt only on genuine
  unavailability.
- It spans three call sites that currently hold divergent copies of the sequence.

It stays below Large because it touches a single repository and adds no external integration, auth
surface, or new persisted schema. The operator confirmed Medium on 2026-10-29 and reconfirmed it on
2026-10-31. The plan stem must remain `rebase-base-refresh-revalidation-halts-needs-human`.
