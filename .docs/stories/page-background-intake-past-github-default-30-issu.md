**Status:** Accepted

# Stories: Bounded assigned-issue capture for background intake (#1133)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the assigned-issue result window at the tracker seam and the incompleteness signal the intake poll reports when it cannot prove it read the whole eligible set. Operator approval on 2026-09-11 also covers atomic conduct-state lease ownership publication, with the required regression proof in Story 3. Every other capture rule — ledger dedup, handled-label skip, empty-issue skip, per-repo failure isolation, write-back — is unchanged.

## Story 1: Capture assigned issues beyond the CLI's default result window

**Requirement:** A poll requests up to 1,000 open assigned issues per registered repository, captures every eligible issue returned within that window, and reports possible incompleteness when the returned count reaches 1,000. Issues outside that window are not guaranteed to be discovered.

As an operator running background intake, I want a poll to inspect up to 1,000 open issues assigned to me per registered repository so that work beyond the default 30-result window is captured and a saturated listing is visible.

### Acceptance Criteria

#### Happy Path

- Given a registered repository whose issue listing would return only its first 30 results without an explicit maximum, when background intake polls it, then the poll requests an explicit maximum of 1,000 and captures every eligible issue returned within that limit.
- Given a registered repository holding 45 open assigned issues, when background intake polls it, then it produces 45 pending envelopes, one per issue, each carrying that issue's source reference.

#### Negative Paths

- Given a registered repository holding more than 30 open assigned issues that a first poll already captured, when a second consecutive poll runs, then it produces no envelopes and records no duplicate entry for any issue.
- Given the issue listing for one registered repository fails while another succeeds, when the poll runs, then the failing repository is isolated with a logged failure and the succeeding repository still produces its envelopes.

### Done When

- [ ] The assigned-issue listing argv carries an explicit maximum whose value is 1,000, exceeding the GitHub CLI's documented 30-result default.
- [ ] An intake poll over a repository of 45 open assigned issues returns 45 pending envelopes with 45 distinct source references.
- [ ] An immediately repeated poll over that same repository returns zero envelopes.

## Story 2: Report a result set whose completeness cannot be proven

**Requirement:** Intake reports a repository failure or an explicit possible-incompleteness signal when its bounded listing reaches the requested maximum.

As an operator running background intake, I want a loud signal whenever a poll's issue listing came back at exactly the maximum it asked for so that a truncated read is visible instead of being mistaken for a complete one.

### Acceptance Criteria

#### Happy Path

- Given a registered repository whose issue listing returns fewer issues than the maximum the poll requested, when the poll completes, then it reports no incompleteness signal and captures every returned issue.

#### Negative Paths

- Given a registered repository whose issue listing returns exactly the maximum the poll requested, when the poll completes, then intake reports one explicit incompleteness signal naming that repository and the requested maximum, and still returns one envelope for each issue it did read.

### Done When

- [ ] A poll whose issue listing returns exactly the requested maximum reports one incompleteness message that names the repository and the requested maximum.
- [ ] A poll whose issue listing returns fewer than the requested maximum reports no incompleteness message.
- [ ] The saturated poll still returns one pending envelope per issue it read, and the poll does not throw.

## Negative-category review

Dependency unavailability and timeouts are covered by the retained per-repository isolation criterion: an issue listing that rejects is logged and skipped without failing the sweep. Idempotency and data integrity are covered by the repeated-poll criterion, which exercises the existing ledger dedup across a result set larger than the old window. Resource exhaustion is covered by the saturation criterion, which is exactly the case where the requested maximum is the binding constraint; the response is a loud signal plus partial capture, never a silent full-looking result. For the intake result-window change, invalid input, authorization, concurrency, and cascade-deletion categories are inapplicable: the change adds one numeric argv element to a read-only listing, introduces no user-supplied input, no new permission surface, no shared mutable state, and no deletion. Partial-failure rollback is inapplicable because capture is per issue and the ledger already records each one independently.

## Story 3: Publish lease ownership safely under contention

As an operator, I want concurrent state writers to see complete ownership metadata while preserving exclusive lease ownership.

### Acceptance Criteria

#### Happy Path
- Given a lease owner record is being published while another acquisition inspects it, when the contender reads the owner path, then it observes either initialization or the complete owner record, never a partially written record.

#### Negative Paths
- Given one live process holds a conduct-state lease, when another acquisition contends during owner publication, then the contender cannot acquire that same lease until ownership is released under the existing lease rules.
- Given publishing the owner record fails, when acquisition returns failure, then the failure is reported and temporary publication files are cleaned up without replacing another live owner.

### Done When
- [ ] A controlled contention test exercises the production owner-publication path and observes only initialization or complete owner metadata.
- [ ] A contender cannot enter the protected operation while the original live owner holds the lease, including the publication window.
- [ ] An injected publication failure is reported, cleans its temporary file, and does not overwrite another live owner.

Concurrency and publication failure are covered through controlled filesystem boundaries in the lease tests; no real provider or remote service is involved.
