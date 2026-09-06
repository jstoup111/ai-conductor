**Status:** Accepted

# Stories: Prime priority labels when the resolver cache is cold (#2158)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the priority resolver's read cadence
for labels it has never read, and the fallback reporting that read owes when it fails. Relabel
freshness between refresh scans, the daemon's discovery cadence, and eligibility remain outside this
slice.

## Story 1: Band the backlog from labels that were actually read

As an operator whose daemon has just restarted with a queue of merged specs, I want the linked
issues' priority labels to decide dispatch order, so that a critical spec builds first instead of in
plan-file position.

### Acceptance Criteria

#### Happy Path

- Given a backlog of linked specs whose labels this process has never read, when a non-refresh discovery runs, then the returned order is banded by each spec's current priority label rather than plan-file order.
- Given every linked spec in the backlog has already had its labels read this process, when another non-refresh discovery runs, then the priority source is called zero further times and the previously read bands are reused.
- Given a linked spec becomes part of the resolved backlog only after earlier scans, when the next non-refresh discovery runs, then that spec's labels are read, the already-read specs are not re-read, and the new spec is placed in its labeled band.

#### Negative Paths

- Given a linked spec whose issue no longer exists, when a non-refresh discovery reads it, then it is banded as unlabeled and no further read is made for it on later non-refresh scans.

### Done When

- [ ] A first non-refresh discovery over a linked backlog returns the label-banded order, and the same fixture returns plan-file order before the change.
- [ ] A repeat non-refresh discovery over an unchanged backlog records no additional priority-source call.
- [ ] A backlog that gains a linked spec after earlier scans records exactly one further priority-source call, carrying only the new spec's reference.
- [ ] A reference the source reports as missing bands unlabeled and records no second read across two later non-refresh scans.

## Story 2: Never present unread labels as a banded order

As an operator watching the dashboard during a priority-source outage, I want the ordering to be
reported as fallback, so that I can tell a degraded scan from a genuinely unlabeled backlog.

### Acceptance Criteria

#### Happy Path

- Given the priority source recovered on a refresh scan after an outage, when a later non-refresh discovery runs, then banded ordering resumes from the labels that refresh read.

#### Negative Paths

- Given the priority source rejects the read attempted by a non-refresh discovery over a cold backlog, when that discovery completes, then it returns plan-file order in fallback mode with no band annotations and logs exactly one outage warning.
- Given that outage persists, when further non-refresh discoveries run, then each stays in fallback mode, makes no further call to the priority source, and adds no second warning.
- Given the dashboard renders the state of a non-refresh scan whose priority read failed, when it reports the ordering section, then it names the fallback mode rather than a banded order.

### Done When

- [ ] A cold non-refresh discovery whose read is rejected returns plan-file order, its items carry no band annotation, and exactly one warning is logged.
- [ ] Two further non-refresh discoveries during the same outage add no priority-source call and no second warning.
- [ ] A refresh discovery that succeeds after the outage restores the banded order on the following non-refresh discovery.
- [ ] The dashboard state built from a failed cold non-refresh scan reports fallback ordering and carries no band annotations.

## Negative-category review

Dependency unavailability and timeouts are the dominant category here and are covered by the
rejected-read criteria: the priority source is the only external dependency this change touches, and
its failure must degrade to fallback rather than to a confident-looking band map. Data integrity is
covered by the missing-issue criterion — absent data bands as unlabeled and is not retried into a
per-poll read storm. Resource exhaustion is covered by the zero-further-calls criteria, which bound
the new read to references never attempted rather than every poll. Idempotency is covered by the
repeat-scan criteria. Invalid input is inapplicable: the reference text is already parsed and
validated upstream by the existing reader, whose behavior this slice does not change. Auth failures
present as a rejected read and are covered by the same fallback criteria. Concurrency, partial
rollback, and cascade deletion are inapplicable: the resolver is process-local in-memory state
mutated inside one awaited call per scan, with no persistence and no dependents.
