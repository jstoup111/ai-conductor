**Status:** Accepted

# Stories: Retry a lease whose owner vanished before its metadata read (#2172)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the conduct-state lease's first owner-metadata read and the acquire loop's retry for an absent owner. Stale recovery claims, claim-pid liveness, and the full-suite lock remain outside this slice.

## Story 1: Stop refusing a lease whose owner released it before the metadata read

### Acceptance Criteria

#### Happy Path

- Given a lease owner removes its lease directory between a contender's already-held error and that contender's owner-metadata read, when the contender acquires the lease, then it acquires the lease normally instead of failing with a recovery-refused result.

#### Negative Paths

- Given the owner-metadata read fails for a reason other than the metadata being absent, when the contender acquires the lease, then it fails with the existing recovery-refused result naming unavailable owner metadata and reports the ownership-changed recovery diagnostic.
- Given the owner metadata is present but corrupt or ambiguous, when the contender acquires the lease, then it still fails with the existing recovery-refused result naming invalid or ambiguous owner metadata.

### Done When

- [ ] A fixture that releases the held lease during the contender's owner-metadata read acquires successfully and emits no recovery diagnostic.
- [ ] An injected non-absence read error still returns the recovery-refused failure and its ownership-changed diagnostic.
- [ ] The existing corrupt and ambiguous owner-metadata refusals keep their message, failure kind, and diagnostic reason.

## Story 2: Bound the retry for a lease directory that never gains owner metadata

### Acceptance Criteria

#### Happy Path

- Given a lease directory that exists with no owner metadata, when the contender retries within its wait budget, then each attempt waits the configured retry delay rather than retrying immediately.

#### Negative Paths

- Given the owner metadata is still absent when the wait budget is exhausted, when the contender's acquire attempt ends, then it fails with the timeout failure kind and a message that names no live owner.

### Done When

- [ ] An injected clock and wait function show one wait per absent-owner attempt and a total elapsed time within the configured wait budget.
- [ ] A permanently owner-less lease directory ends the acquire attempt with the timeout failure kind rather than a recovery-refused result.
- [ ] The timeout message omits the live-owner clause when no live owner was ever observed.

## Negative-category review

Input-integrity failures are covered by the corrupt and ambiguous owner-metadata criteria, which must keep refusing. Permission, device, and other non-absence read failures are covered by the injected read-error criterion, which proves the fix narrows only the absence case. Resource exhaustion and liveness are covered by the bounded-retry and timeout criteria, which prove a permanently owner-less directory cannot spin the acquire loop or fail as a recovery refusal. Idempotency is inherent: the retry re-attempts the same atomic directory creation, and a successful acquisition still writes owner metadata exclusively. No deletion, queue, datastore, upload, network, or transaction boundary is introduced, so those categories are inapplicable; the existing recovery, quarantine, and release paths are unchanged and keep their current coverage.
