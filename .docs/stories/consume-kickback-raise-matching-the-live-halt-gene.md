**Status:** Accepted

# Stories: Consume the kickback raise that matches the live halt (#2595)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is gate selection in the daemon's resume-authorization sweep, a daemon-log notice for stale authorizations, and resume-authorization state in `kickback-budget inspect`. Expiring stale authorizations, the missing halt-record path, and a plan-growth raise path remain outside this slice.

## Story 1: The sweep consumes the authorization bound to the live halt

### Acceptance Criteria

#### Happy Path

- Given a feature whose ledger holds an unconsumed stale prd_audit authorization ahead of an unconsumed architecture_review_as_built authorization bound to the live cap halt generation, when the daemon's resume-authorization sweep runs, then the architecture_review_as_built authorization is consumed, the halt is cleared, and the prd_audit authorization stays unconsumed.

#### Negative Paths

- Given the only authorization bound to the live halt generation belongs to a gate whose recoverable cap halt class differs from the live halt class, when the sweep runs, then no halt is cleared and every authorization stays unconsumed.
- Given no unconsumed authorization is bound to the live halt generation, when the sweep runs, then the halt is retained and no authorization is consumed.

### Done When

- [ ] A sweep unit fixture with a stale first gate and a matching second gate clears the halt and consumes only the matching gate's authorization.
- [ ] Sweep unit fixtures with a class mismatch or no matching generation never invoke the clear and leave every authorization unconsumed.

## Story 2: A stale or pending raise is visible without reading source

### Acceptance Criteria

#### Happy Path

- Given an unconsumed authorization whose halt generation differs from the live halt generation, when the sweep runs, then the daemon log names that feature and gate and says the authorization is stale and was not consumed.
- Given an unconsumed authorization whose halt generation differs from the live halt generation, when the operator runs kickback-budget inspect, then the human and JSON output report that gate's resume authorization as stale with its bound and live halt generations.
- Given an unconsumed authorization bound to the live halt generation, when the operator runs kickback-budget inspect, then the output reports that gate's resume authorization as awaiting the daemon sweep.

#### Negative Paths

- Given a feature with no live HALT marker and an unconsumed authorization, when the operator runs kickback-budget inspect, then the authorization is reported as stale with no live halt generation and the ledger is left byte-for-byte unchanged.

### Done When

- [ ] A sweep unit fixture captures a log line naming the stale gate while the matching gate is still consumed.
- [ ] View unit cases render stale, awaiting-sweep, consumed, and absent resume-authorization states in both human and JSON shapes.
- [ ] An inspect CLI fixture reads the live HALT generation, reports the stale gate, and leaves the ledger unchanged.

## Negative-category review

Class mismatch and absent generation match cover the "no unrelated halt is cleared" invariant. A missing HALT marker covers absent input for inspect. Inspect remains read-only, which covers idempotency. Unreadable ledgers and malformed sibling gates keep their existing refusal and isolation behavior and are not changed. No deletion, queue, datastore, network, upload, or permission surface is introduced; those categories are inapplicable. Concurrency is unchanged: consumption still goes through the existing leased consumption primitive keyed by adjustment id.
