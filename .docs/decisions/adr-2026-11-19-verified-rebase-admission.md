# ADR: Bind automatic resume to one verified rebase

**Date:** 2026-11-19  
**Status:** APPROVED

## Context

The rebase writer currently records a human-readable halt with class `needs-human`. Two attempts can produce the same message. The daemon already supports one-shot authorization for a specific kickback halt generation. Rebase recovery needs its own source of authority: evidence from the interrupted operation. [Rebase writer](../../src/conductor/src/engine/rebase.ts) · [Generation-bound recovery precedent](adr-2026-08-29-operator-authorized-kickback-budget-recovery.md)

## Decision

1. **Identify the attempt at its source.** Persist the pre-rebase feature tip, merge base, target, feature and execution child before replay. Only the rebase writer may emit `rebase-recovery`, bound to that attempt with a unique generation. Generic retries retain this class. Existing `needs-human` halts require operator resolution. Publish eligibility only after the evidence and halt agree. Legacy or partially written evidence leaves the halt intact.
2. **Verify the result against the captured inputs.** Reuse the applicable rebase guards, including replay intent and preservation checks. Require evidence for the actual completed revision. An active rebase, dirty checkout, or unverifiable conflict resolution retains the halt with its reason. A repeated commit subject or clean checkout alone cannot establish preservation. [Governing replay decision](adr-2026-08-01-rebase-full-replay-intent-validation.md)
3. **Reconcile under one owner.** Extend the daemon’s existing halted-feature maintenance pass. Serialize recovery with mutations to the same halt, park and execution ownership. Under that protection, recheck the generation, child, revision, park and independent blockers before applying the existing rebase transition. Persist the transition before conditionally clearing that exact halt. On restart, finish any pending transition for the same attempt once. The ordinary scheduler retains dispatch authority and rechecks eligibility. Publish recovery through the existing halt event spine. [Transition owner](../../src/conductor/src/engine/rebase-transition.ts) · [Daemon admission](../../src/conductor/src/engine/daemon.ts)

## Alternatives

Matching the halt text cannot distinguish a later occurrence. Reclassifying rebase halts as mechanically retryable would allow a generic retry to bypass the evidence check.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Ordinary daemon maintenance can examine halted features without an upstream advance. | verified | 99% | yes | Admission would need another entry point. See `consumeResumeAuthorizations` in `daemon.ts`. | — |
| A2 | The existing transition supports restart recovery of interrupted gate updates. | verified | 99% | yes | Recovery would require a separate gate transaction. See `completeInterruptedRebaseOperation` in `rebase-transition.ts`. | — |

## Consequences

A halt predating the recorded evidence may still need manual recovery. Conflicting or stale proof costs no build attempt. The implementation must exercise competing halt writes and restarts at the transition/clear boundary.
