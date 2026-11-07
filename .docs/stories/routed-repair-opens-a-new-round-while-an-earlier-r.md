# Stories: Routed repair opens a new round while an earlier round is still open

**Status:** Accepted

Source: intake jstoup111/ai-conductor#3445. Technical track, no PRD. Governing design:
`adr-2026-10-12-routed-whole-feature-repair` decisions 6, 7 and 13 as amended by #3445, and
`.docs/decisions/architecture-review-2026-10-26-routed-repair-opens-a-new-round-while-an-earlier-r.md`.
Depends on #3446 (spec PR #3458) for the stack preflight's stop path. A `mechanical` HALT is the retryable stop: the daemon's episode-end sweep clears and re-kicks it without an operator.

## Story 1: A routed host exit always continues its round

**Requirement:** #3445 desired outcome 3; adr-2026-10-12 decisions 6 and 13 (amended by #3445)

As the operator of a stacked feature, I want every routed host exit to admit the round's next host
before execution leaves the routed region, so that a halt and resume can never strand a round's
unadmitted hosts and let a later audit open a second round.

### Acceptance Criteria

#### Happy Path
- Given an audit round whose host 1 is `built` and holds the repair marker and whose host 2 is `pending`, when the feature resumes after a halt and the stack preflight completes host 1's exit restack, then in that same resume host 2 is marked `admitted`, the repair marker names host 2 of that round, and the run enters host 2's BUILD region instead of the plain stack cursor.
- Given an audit round whose host 1 is `built` and whose only other host is the pending leaf host, when the resumed exit of host 1 applies and the revalidation queue is empty, then the leaf host is admitted with the repair marker and the run enters the leaf's BUILD region.
- Given an audit round whose host 1 is `built` and whose every other host is already `restacked`, `done` or `rerouted`, when the resumed exit applies with an empty revalidation queue and no other non-closed round, then the round records its leaf return, closes, and the whole-feature gates from `manual_test` onward are pending.
- Given an audit round whose child hosts are settled after host 1's exit and whose revalidation queue holds an entry, when the exit applies on either the in-loop or the resume path, then the lowest queued child's `revalidate` round is admitted before the leaf host.
- Given identical route records, marker and queue, when host 1's exit applies once through the in-loop BUILD-region exit and once through the resume preflight, then both select the same next routed step and leave identical route records and marker.

#### Negative Paths
- Given a resumed exit of a `built` host whose exit restack is refused or rolled back, when the preflight stops, then the host stays `built`, the repair marker is unchanged, no other host is admitted, and no route record is created.
- Given a resumed exit whose restack applied but whose next-host admission compare-and-swap is contested, when the preflight stops, then the run ends with a `mechanical` HALT whose first line names the round and the host it could not admit, and the next resume admits that host.
- Given a resumed exit whose restack applied but whose route record cannot be reread afterwards, when the preflight stops, then it admits no host, opens no round, and ends with a `mechanical` HALT whose first line names the unreadable round.
- Given the resume preflight completed a host's exit, when the resume continues, then the preflight never reports `repaired` while that round still has a `pending` host and no repair marker.

### Done When
- [ ] A real-git test reproduces the r1 to r2 sequence (host 1 `built`, halt, resume) and asserts host 2 is admitted with the marker in the resume that completes host 1's exit, with no `remediation_routed` event for a new round.
- [ ] A test drives the same refs through the in-loop exit and through the resume preflight and asserts both leave byte-identical route record blobs and marker.
- [ ] A structural test asserts that no production module other than `routing/round-admission.ts` imports `requestRoutedExit`.

## Story 2: A new routed round opens only when no other round needs to run first

**Requirement:** #3445 desired outcome 1 (narrowed by operator decision 2026-10-26 to a kind-aware fence); adr-2026-10-12 decision 7 (amended by #3445)

As the operator, I want round admission to refuse while an earlier round still has work to run, so
that a feature never holds two competing audit rounds, while revalidation rounds still nest inside an
audit round that is waiting on the queue.

### Acceptance Criteria

#### Happy Path
- Given every route record is `closed`, no repair marker exists and the revalidation queue is empty, when the whole-feature audit routes fixes, then a new `audit` round is created and its first host is admitted as before.
- Given an open audit round whose child hosts are all settled, whose leaf host is `pending`, which holds no marker and whose revalidation queue has an entry, when the queue is consumed, then a `revalidate` round is admitted while the audit round stays open.
- Given a revalidate round closed inside an open audit round whose leaf host is `pending`, when reconciliation runs, then the audit round's leaf host is admitted next.

#### Negative Paths
- Given an open audit round with a `pending` host and no repair marker, when the whole-feature audit would route new fixes, then no route record is created, no marker is written, no `remediation_routed` event is emitted, and the run ends with a `mechanical` HALT whose first line names the open round.
- Given an open audit round with an `admitted`, `repairing` or `built` host, when revalidation queue consumption attempts admission, then no revalidate round is created and the queue entry remains unchanged.
- Given an open audit round whose next selection is a pending child host rather than the queue, when a revalidate admission is attempted, then the admission is refused and the queue entry remains unchanged.
- Given another non-closed round whose route record cannot be read, when an audit or revalidate admission is attempted, then the admission is refused and the HALT's first line names the unreadable round.
- Given the admission's marker transaction loses to a marker another writer already created for a different round, when the fence itself passed, then the feature still halts needs-human naming both rounds as before.
- Given a stale `prepared` route record with no marker left by a crash, when the next resume runs, then reconciliation aborts the prepared record before any admission, and a later audit admission is not refused because of it.

### Done When
- [ ] A test with an open audit round holding a pending host asserts the audit routing path creates no `refs/conductor/«slug»/routes/«roundId»` ref and emits no `remediation_routed` event.
- [ ] A real-git test drives child hosts, then the queue, then the leaf host, and asserts the nested revalidate round is admitted and the audit round's leaf host runs after it closes.
- [ ] A test asserts a fence-refused admission writes `.pipeline/HALT.class` `mechanical`, and a lost marker race still writes `needs-human`.

## Story 3: A feature already holding two open rounds drains them without hand repair

**Requirement:** #3445 desired outcomes 2 and 3 (operator decision 2026-10-26: self-heal, no needs-human HALT); adr-2026-10-12 decision 7 (amended by #3445)

As the operator of a feature whose durable routing state already holds two open rounds, I want resume
to finish the round that owns the repair marker and then run the older round's unadmitted hosts, so
that the feature recovers on its own instead of failing `round advance cas-failed` on every resume.

### Acceptance Criteria

#### Happy Path
- Given round r3 with host 1 `restacked` and host 2 `pending`, and round r4 with host 1 `built` holding the repair marker and host 2 `pending`, when the feature resumes, then r4 host 1's exit completes first, then r3 host 2 is admitted and run, then r4 host 2 is admitted and run, and finally the leaf return is recorded and every round is `closed`.
- Given the r3 and r4 state above, when each resume of the drain runs, then no resume ends with `round advance cas-failed` and none ends with `loop ended without DONE or HALT marker`.
- Given round r3 closes after its last host while round r4 remains open with a `pending` host and no marker, when reconciliation runs, then it continues to r4 in the same call and admits r4's next host instead of returning control to the plain stack cursor.

#### Negative Paths
- Given two open rounds where the repair marker names a round whose record cannot be read, when the feature resumes, then no route ref or marker is changed and the run ends with a `mechanical` HALT whose first line names both rounds.
- Given two open rounds where the marker-owning round's host exit is refused, when the feature resumes, then the older round is not advanced, its pending hosts stay `pending`, and the marker still names the marker-owning round.
- Given an older open round whose pending host is admitted during the drain, when that host's region fails its gates, then the failure stays inside that host's region under its existing caps and the newer round's hosts are not admitted until the older host exits.

### Done When
- [ ] A real-git test reconstructs the observed r3/r4 refs and drives resumes to completion, asserting the admission order r4 host 1 exit, r3 host 2, r4 host 2, leaf return.
- [ ] The same test asserts every route record ends `closed` and no resume returns an `unavailable` preflight result.

## Story 4: Reconciliation that cannot advance halts mechanically, then escalates under a cap

**Requirement:** #3445 desired outcome 2 (operator decisions 2026-10-26: mechanical HALT, escalate after 3); adr-2026-10-12 decision 7 (amended by #3445)

As the operator, I want a routing state that reconciliation cannot advance to stop with a reason that
names every open round, to retry automatically, and to need me only after repeated identical stops,
so that transient contention clears itself and a real wedge is never silent.

### Acceptance Criteria

#### Happy Path
- Given reconciliation cannot advance any non-closed round, when the stack preflight stops for the first time, then `.pipeline/HALT` is written with class `mechanical` and a first line naming every non-closed round id with its unsettled hosts, and `events.jsonl` gains a `loop_halt` event carrying the same text.
- Given the same first stuck stop, when the daemon records the run's outcome, then the outcome reason carries the same text as the HALT, not `loop ended without DONE or HALT marker`, and the daemon's halt retention does not retain the HALT for an operator.
- Given two consecutive identical stuck stops followed by a resume in which any round advances, when a later stuck stop occurs, then it counts as the first and its HALT class is `mechanical`.

#### Negative Paths
- Given a third consecutive identical stuck stop with no routing progress between them, when the preflight stops, then `.pipeline/HALT` is written with class `needs-human` and a first line naming every non-closed round, and a `loop_halt` event carries the same text.
- Given consecutive stuck stops whose sets of non-closed rounds differ, when the preflight stops, then they are not counted as identical and the count restarts at one.
- Given a live `.pipeline/HALT` already exists when the escalating stop occurs, when the preflight stops, then the existing HALT content is left unchanged.
- Given a stuck stop, when the escalation count is recorded, then no new ref namespace and no new sidecar file are created.

### Done When
- [ ] A test asserts the first and second identical stuck stops each write a `mechanical` HALT naming the open rounds, and `resolveHaltRetention` does not retain them.
- [ ] A test asserts the third identical stop writes a needs-human HALT naming the rounds, and that intervening routing progress resets the count.

## Story 5: A deferred base refresh still continues the open round

**Requirement:** #3445 desired outcome 3; adr-2026-10-12 decision 7 (amended by #3445)

As the operator, I want a due base refresh that must wait for routing to still let the open round
advance, so that a resume between two hosts never runs the plain stack cursor.

### Acceptance Criteria

#### Happy Path
- Given a due base refresh and an open audit round whose host 1 is `restacked`, whose host 2 is `pending` and which holds no marker, when the stack preflight runs, then the base refresh is deferred with a `restack_refused` event of reason `deferred-base-refresh`, no closure ref moves, and host 2 is admitted in the same preflight.
- Given a due base refresh and an admitted host holding the repair marker, when the stack preflight runs, then the base refresh is deferred and the run navigates to that host's BUILD region.

#### Negative Paths
- Given a due base refresh, every route record `closed` and an empty revalidation queue, when the stack preflight runs, then the base refresh runs and no round is admitted.
- Given a due base refresh and an open round that reconciliation cannot advance, when the stack preflight runs, then no closure ref moves and the run ends with the stuck-rounds `mechanical` HALT of Story 4.

### Done When
- [ ] A test with a due base refresh between two hosts asserts the `deferred-base-refresh` event, unchanged closure refs, and host 2 admitted with the marker in one preflight call.
- [ ] A test asserts a due base refresh with every round closed still moves the refs as before.
