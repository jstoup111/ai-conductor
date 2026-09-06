**Status:** Accepted

# Stories: Let an operator park settle without a needs-human halt (#1803)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the conductor's markerless-exit backstop, the resulting worktree marker state, the selection path an unparked feature takes, and the daemon status view of a feature still held by a halt. Park dispatch semantics, halt-class taxonomy, and the park record gap the issue reports for one earlier occurrence remain outside this slice.

## Story 1: A boundary-settled park ends the loop with a park verdict

**Requirement:** Desired outcome 1

As an operator, I want a park that settles cleanly at a step boundary to end the loop as a park so that the run is not also recorded as owing me a decision.

### Acceptance Criteria

#### Happy Path
- Given a daemon-mode run whose operator park boundary is active, when the loop settles at a scheduling-unit boundary, then the run returns the typed operator-parked termination and its project root carries neither a halt marker nor a halt-class sidecar.
- Given the operator park boundary read is indeterminate and the run fails toward a park at the pre-first-unit boundary, when the loop stops there, then it still returns the typed operator-parked termination and still writes no halt marker.

#### Negative Paths
- Given a daemon-mode run with no operator park boundary behind it, when the loop exits with neither a completion marker nor a halt marker, then it writes the needs-human halt whose reason names the resolved last step, the last emitted event, and the exit index.
- Given a daemon-mode run whose park boundary check reports that no park was requested, when the loop exits without a terminal marker, then the needs-human halt is still written and the run returns no park termination.

### Done When
- [ ] A park-terminated daemon run leaves no halt marker and no halt-class sidecar under its project root.
- [ ] The unchanged backstop reason wording and needs-human class are still asserted for a markerless exit with no park behind it.
- [ ] The park exemption is keyed on the run's own park termination, not on the presence of any marker or log text.

## Story 2: An unparked feature returns to normal dispatch

**Requirement:** Desired outcome 2, desired outcome 3

As an operator, I want an unparked feature to become dispatchable again on its own so that I never have to delete markers by hand to resume work I intentionally paused.

### Acceptance Criteria

#### Happy Path
- Given a worktree left behind by a boundary-settled park and a claim already parked for that slug, when the daemon selects work after an explicit unpark, then that slug is returned as eligible without any marker being deleted by hand.

#### Negative Paths
- Given a worktree carrying a needs-human halt from a genuinely markerless exit and a claim already parked for that slug, when the daemon selects work after an explicit unpark, then no item is returned for that slug and the re-kick sweep still refuses it by its halt disposition.

### Done When
- [ ] An acceptance case drives a real daemon-mode conductor run to a park termination and then obtains an eligible selection for that slug through the real worktree halt reader.
- [ ] The same selection path returns nothing for a slug whose worktree carries a needs-human halt, and the re-kick sweep logs its halt-disposition refusal for that slug.

## Story 3: A feature still held by a halt stays visible in daemon status

**Requirement:** Desired outcome 4

As an operator, I want a feature that is unparked but still held by a halt to appear in daemon status so that an undispatchable feature is never reported as neither gated nor blocked.

### Acceptance Criteria

#### Happy Path
- Given a slug that is not operator-parked and whose worktree carries a live halt, when the daemon status dashboard renders, then that slug appears in the halted group with its halt reason and the remedy that clears it.

#### Negative Paths
- Given the same slug while it is still operator-parked, when the daemon status dashboard renders, then it appears only in the parked group and is not also counted or listed as a halted row.

### Done When
- [ ] A dashboard case renders the halted group containing that slug with its reason and remedy text.
- [ ] The same input with the slug operator-parked renders it only under the parked group, with the halted count unchanged by it.

## Negative-category review

Invalid and indeterminate input is covered by the indeterminate park-boundary read, which fails toward a park, and by the no-park-requested case, which must not take the exemption. Partial failure is covered by the markerless abnormal exit that must still halt: the exemption must not swallow a real unmarked failure. Dependency unavailability is covered by an unreadable halt-class sidecar, which existing halt-marker behavior resolves to an unclassified disposition that the re-kick sweep still refuses; this slice does not change that path. Data integrity is covered by asserting both the halt marker and its class sidecar are absent after a park, since a marker without its sidecar would leave a differently misclassified feature. Concurrency, resource exhaustion, authorization, cascade deletion, immutability, exception-hierarchy, and dedup categories are inapplicable: the change adds no shared mutable state, no new deletion, no protected resource, no exception taxonomy, and no idempotency key. No queue, datastore, upload, or transaction is introduced.
