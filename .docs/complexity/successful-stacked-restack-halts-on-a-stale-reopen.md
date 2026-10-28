# Complexity: Successful stacked restack halts on a stale reopen of the gate it re-pended (#3469)

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None changed. No gate is re-pended differently; only the conductor's view of durable state and the batch conflict rule change |
| Event spine | None. Existing conflict diagnostics stay the failure surface |
| Story count | 4 |
| Files touched | 2 production: `filesystem-conduct-state-store.ts` (batch evaluation) and `conductor.ts` (one adoption helper, three call sites); tests in the store, conductor-baseline and stacked rebase suites |
| ADR work | None. The batch change makes the local adapter honor rule 2 (idempotent success) of the APPROVED `adr-2026-08-01-conduct-state-mutation-port`, which the batch path skips today. The adoption extends the conductor's existing rebind reloads (`restoreWholeFeatureState`, `activateChildRegionState`) to the remaining engine writer boundaries |

## Rationale

One invariant, enforced at existing boundaries: the conductor never computes a state write from a
value that engine code it just ran has already replaced on disk, and the store treats an
already-true field as success. No new module, layer, contract surface or architectural decision.
The intake's `size: S` label agrees. Not hotfix-eligible: the fix spans two production files with
more than 15 changed lines and needs more than two focused tests (three call sites plus the
fail-closed paths).
