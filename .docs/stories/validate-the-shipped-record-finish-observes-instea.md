**Status:** Accepted

# Stories: Validate the shipped record FINISH observes (#1647)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the FINISH publication observation of the shipped-record dimension: which record it reads, and whether that record is evidence for this shipment. The record's format, the premerge verifier and its refusal codes, backlog dedup, and the duplicate-record-commit defect are outside this slice.

## Story 1: Only a record that matches this shipment counts as publication evidence

As an operator whose daemon publishes unattended, I want FINISH to reject a shipped record that does not belong to this shipment so that a wrong record stops the run where a human can see it instead of being carried into the merge as proof of a completed ship.

### Acceptance Criteria

#### Happy Path

- Given the feature's plan resolves and its committed record carries this feature's slug and a spec hash equal to the hash of that plan and its stories bytes, when FINISH observes the shipped-record dimension, then the record counts as valid evidence and publication continues to readying the PR without dispatching another record write.
- Given no record exists for the resolved shipment, when FINISH observes the shipped-record dimension, then the record reads as missing and FINISH selects the write-shipped-record transition exactly as it does today.

#### Negative Paths

- Given a record whose recorded slug names a different feature, when FINISH observes the shipped-record dimension, then publication stops with the human-required invalid-record disposition instead of readying the PR.
- Given a record whose recorded spec hash disagrees with the hash of the feature's current plan and stories bytes, when FINISH observes the shipped-record dimension, then publication stops with the human-required invalid-record disposition and the existing record file is left byte-for-byte unchanged.
- Given a record whose content has no closed frontmatter block, or omits its slug or its spec hash, when FINISH observes the shipped-record dimension, then publication stops with the human-required invalid-record disposition rather than accepting the file's existence as evidence.

### Done When

- [ ] A production FINISH fixture whose committed record matches its resolved plan and stories reaches the ready-PR transition and dispatches no record write.
- [ ] Production FINISH fixtures for a foreign slug, a disagreeing spec hash, and an unparseable body each return the human-required disposition carrying the existing invalid-shipped-record reason.
- [ ] A production FINISH fixture with no record for the resolved shipment still selects the write-shipped-record transition.
- [ ] The record file present in each invalid fixture is unchanged after the disposition is returned.

## Story 2: The observation and the writer agree on which record is this shipment's

As an operator, I want the observation to resolve the same shipment identity the record writer resolves so that a record the run just committed is recognized on the next observation instead of being written again, and so an unresolvable identity degrades to today's behavior rather than to a halt.

### Acceptance Criteria

#### Happy Path

- Given a feature description carrying no date prefix and exactly one date-prefixed plan matching it, when FINISH observes the shipped-record dimension, then it reads the record at the same date-prefixed path the writer commits to, so a record written moments earlier reads as valid rather than missing.
- Given a plan that names its stories file through a stories reference rather than by matching stem, when FINISH computes the hash the record must match, then it resolves those stories bytes in the same reference-then-stem order the record writer uses and arrives at the writer's digest.

#### Negative Paths

- Given no plan resolves for the feature description, or more than one date-prefixed plan matches it, when FINISH observes the shipped-record dimension, then the observation reports only presence or absence at the undated record path and never reports the record invalid.
- Given the resolved record or its plan cannot be read for any reason other than absence, when FINISH observes the shipped-record dimension, then the dimension reads indeterminate rather than valid or invalid.

### Done When

- [ ] An observation fixture with an undated feature description and one date-prefixed plan reads the same record path the writer resolves for that description.
- [ ] An observation fixture whose plan carries a stories reference to a differently named stories file arrives at the digest the writer commits for that plan.
- [ ] Observation fixtures with no matching plan and with two date-prefixed candidates each report presence or absence only, and neither reports the record invalid.
- [ ] An observation fixture whose plan or record read fails with a non-absence error reports the unavailable observation.

## Negative-category review

Invalid input is covered three ways — a foreign slug, a drifted spec hash, and an unparseable body — because those are the three shapes the coordinator's own comment names for an invalid record. Ambiguity is covered by the two-candidate plan case, which degrades rather than guesses. Dependency unavailability is covered by the non-absence read failure, which reports indeterminate so a transient filesystem fault cannot manufacture either completion or a halt. Data integrity is covered by asserting the record file is untouched on every invalid path: this observation never repairs, overwrites, or deletes a record. Idempotency needs no separate scenario because the observation performs no write and is re-run on every publication snapshot; repeating it cannot change the record or the disposition. Auth and permission failures, timeouts, concurrent modification, resource exhaustion, partial failure and rollback, cascade deletion, queue and upload behavior, and network error are inapplicable: this boundary makes no network, GitHub, provider, or process call and mutates nothing. Record-content refusal permutations beyond slug and hash remain the strict premerge verifier's coverage and are deliberately not duplicated here.
