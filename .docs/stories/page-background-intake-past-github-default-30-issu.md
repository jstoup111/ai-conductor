**Status:** Accepted

# Stories: Complete assigned-issue capture for background intake (#1133)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the assigned-issue result window at the tracker seam and the incompleteness signal the intake poll reports when it cannot prove it read the whole eligible set. Every other capture rule — ledger dedup, handled-label skip, empty-issue skip, per-repo failure isolation, write-back — is unchanged.

## Story 1: Capture assigned issues beyond the CLI's default result window

**Requirement:** Every eligible assigned issue in a registered repository is discoverable regardless of its age or position in the result set.

As an operator running background intake, I want a poll to see every open issue assigned to me in a registered repository so that older assigned work is routed instead of silently disappearing behind the GitHub CLI's default result window.

### Acceptance Criteria

#### Happy Path

- Given a registered repository whose issue listing would return only its first 30 results without an explicit maximum, when background intake polls it, then the poll requests an explicit maximum larger than 30 and captures every open assigned issue the repository holds.
- Given a registered repository holding 45 open assigned issues, when background intake polls it, then it produces 45 pending envelopes, one per issue, each carrying that issue's source reference.

#### Negative Paths

- Given a registered repository holding more than 30 open assigned issues that a first poll already captured, when a second consecutive poll runs, then it produces no envelopes and records no duplicate entry for any issue.
- Given the issue listing for one registered repository fails while another succeeds, when the poll runs, then the failing repository is isolated with a logged failure and the succeeding repository still produces its envelopes.

### Done When

- [ ] The assigned-issue listing argv carries an explicit maximum whose value exceeds the GitHub CLI's documented 30-result default.
- [ ] An intake poll over a repository of 45 open assigned issues returns 45 pending envelopes with 45 distinct source references.
- [ ] An immediately repeated poll over that same repository returns zero envelopes.

## Story 2: Report a result set whose completeness cannot be proven

**Requirement:** Intake reports an explicit failure or incompleteness signal if the complete eligible set cannot be read.

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

Dependency unavailability and timeouts are covered by the retained per-repository isolation criterion: an issue listing that rejects is logged and skipped without failing the sweep. Idempotency and data integrity are covered by the repeated-poll criterion, which exercises the existing ledger dedup across a result set larger than the old window. Resource exhaustion is covered by the saturation criterion, which is exactly the case where the requested maximum is the binding constraint; the response is a loud signal plus partial capture, never a silent full-looking result. Invalid input, authorization, concurrency, and cascade-deletion categories are inapplicable: the change adds one numeric argv element to a read-only listing, introduces no user-supplied input, no new permission surface, no shared mutable state, and no deletion. Partial-failure rollback is inapplicable because capture is per issue and the ledger already records each one independently.
