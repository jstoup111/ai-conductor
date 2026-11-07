**Status:** Accepted

# Stories: Daemon preempts lower-priority work at step boundaries

Technical track (no PRD). Source: jstoup111/ai-conductor#1929. Governing decision:
`adr-2026-11-07-daemon-step-boundary-preemption` (D1–D10). Scope boundary: Minimal, as set in
`.docs/track/daemon-cannot-switch-to-higher-priority-queued-wor.md`.

Preemption rank used below: critical above high above medium; medium, unlabeled and no-issue share
one rank; low ranks below them.

## Story 1: A full pool requests one yield when a strictly higher-ranked item is next

**Requirement:** ADR D1, D2, D3, D10

As the daemon operator, I want a full pool to make room for strictly higher-priority work so that
an urgent item does not wait for an unrelated running feature to reach DONE or HALT.

### Acceptance Criteria

#### Happy Path
- Given every slot holds a running feature, the lowest-ranked of which is low, when a busy-pool pass finds that the next eligible backlog item is critical, then the daemon requests exactly one yield, addressed to that low-ranked feature.
- Given two running features share the lowest rank, when a strictly higher-ranked item is next eligible on a full pool, then the yield is requested of the more recently dispatched of the two.
- Given a running feature whose resolver band is unlabeled and a next eligible item whose band is high that precedes it in backlog order, when the busy-pool pass runs on a full pool, then a yield is requested because unlabeled ranks as medium.

#### Negative Paths
- Given the lowest-ranked running feature is medium, when the next eligible item is unlabeled, no-issue or medium, then no yield is requested.
- Given the next eligible item ranks below every running feature, when the busy-pool pass runs, then no yield is requested.
- Given a free slot exists, when a higher-ranked item is next eligible, then no yield is requested and the item dispatches into the free slot as today.
- Given one yield request is already outstanding, when a later busy-pool pass sees another strictly higher-ranked eligible item, then no second yield is requested until the first victim's outcome has been collected.
- Given the backlog resolution mode is fallback or off so items carry no band, when a busy-pool pass runs on a full pool, then no yield is requested.
- Given every slot is held by repair workers, when a higher-ranked item is next eligible, then no yield is requested of any repair worker.
- Given the daemon runs without a yield-capable executor, when a higher-ranked item is next eligible on a full pool, then no yield is requested and dispatch behaves exactly as today.
- Given a running low feature and a next eligible unlabeled item that backlog order places behind it, when the busy-pool pass runs on a full pool, then no yield is requested even though unlabeled outranks low.
- Given a running critical feature and a next eligible no-issue item that backlog order places ahead of it, when the busy-pool pass runs on a full pool, then no yield is requested because no-issue ranks as medium.
- Given the next item in backlog order is operator-parked, halted or already claimed, when the busy-pool pass runs, then only the next item `pickEligible` would actually dispatch is compared, and a parked or halted item never triggers a yield.

### Done When
- [ ] A rank function over resolver bands returns the order critical, high, medium (shared with unlabeled and no-issue), low, and returns no rank for an unbanded item.
- [ ] A daemon test shows a strictly higher-ranked arrival ordered behind the running feature requests no yield.
- [ ] A daemon test on a full pool shows exactly one yield request with the chosen victim's slug for a strictly higher-ranked arrival, and none for each negative-path case above.

## Story 2: A yielding feature stops at its next safe boundary with a preempted termination

**Requirement:** ADR D4, D5, D6, D7

As the daemon operator, I want a yielded feature to stop only at a point where stopping is already
safe, so that preemption never corrupts or wastes settled work.

### Acceptance Criteria

#### Happy Path
- Given a yield has been requested of a running child executor, when the conductor next reaches a scheduling-unit boundary before a pending serial step or group, then it stops there with a preempted termination carrying the last settled unit.
- Given a yield has been requested during a serial step's provider attempt, when that attempt settles and the step would dispatch another attempt, then the conductor stops before the next attempt with a preempted termination naming the step and attempt.
- Given a yield has been requested while a parallel group is running, when its started members settle and the group joins, then the conductor stops with a preempted termination and no member is recorded as an exhausted branch.
- Given a yield stop, when the feature's state is read afterward, then the interrupted step is still in_progress, no escalation rung, retry budget or progress counter advanced, no HALT exists and committed task progress is unchanged.

#### Negative Paths
- Given both an active operator park and a yield request for the same feature, when the conductor reaches a boundary, then it returns the operator-parked termination and emits the operator park boundary event, not a preempted termination.
- Given the operator park read fails at a boundary where a yield is also requested, when the conductor classifies the stop, then it treats the feature as operator-parked.
- Given a yield request, when the current provider attempt is in flight, then that attempt is not cancelled and runs to its own result before the conductor stops.
- Given an older pinned child that does not understand the yield message, when the supervisor sends it, then the child neither crashes nor stops and runs to its natural DONE or HALT.
- Given a yield is requested after the child has already produced its final outcome, when the outcome is collected, then that outcome stands unchanged and the outstanding request clears.
- Given an interactive conduct run with no daemon, when it reaches any boundary, then no preemption check runs and behavior is unchanged.

### Done When
- [ ] Conductor tests show a preempted termination at a pre-unit boundary, at a serial attempt boundary and at a parallel group join, each with an untouched retry budget and no HALT.
- [ ] A test with both an operator park and a yield set returns operator-parked.
- [ ] A test sends the yield message to a child parser that predates it and shows the message is ignored without error.

## Story 3: A preempted feature releases its slot and resumes later by backlog order

**Requirement:** ADR D8, D9

As the daemon operator, I want a preempted feature to come back automatically so that preemption
costs me no unpark or cleanup.

### Acceptance Criteria

#### Happy Path
- Given a feature ends with a preempted termination and no repair is queued, when the daemon collects its outcome and next fills the pool, then its status is preempted, its worktree is kept, its claim is released and the freed slot dispatches the higher-ranked item that caused the yield.
- Given a feature ends preempted while a repair is queued, when the daemon next fills the pool, then the freed slot goes to the queued repair under the existing repairs-first rule and the higher-ranked item dispatches at the next free slot.
- Given a preempted feature whose worktree and persisted state remain, when backlog order next makes it the first eligible item with a free slot, then it is re-dispatched and resumes at the interrupted step without redoing settled steps or committed tasks.

#### Negative Paths
- Given a feature ends preempted, when its outcome is collected, then no operator park marker, no HALT marker and no HALT watcher is created, and the slug is neither completed nor parked in the pool.
- Given a feature ends preempted, when its outcome is collected, then no shipped record, processed-ledger entry, completion narration or failure escalation is produced.
- Given a preempted feature and an operator who parks it before it is re-dispatched, when the backlog is scanned, then the feature stays parked until an explicit unpark.
- Given a feature ends preempted, when the executor ledger records the dispatch, then it is recorded as terminated, not halted or complete.

### Done When
- [ ] A daemon test shows a preempted outcome releasing the slot to the higher-ranked arrival, with no park marker, HALT or processed entry written.
- [ ] A resume test shows the preempted feature re-dispatched from its kept worktree, continuing at the step that was in_progress.

## Story 4: A preemption is distinguishable from an operator park

**Requirement:** ADR D6, D8

As the daemon operator, I want to see when the daemon moved a feature aside on its own, so that I
never mistake a preemption for my own park or for a failure.

### Acceptance Criteria

#### Happy Path
- Given a feature stops for preemption, when the boundary is reached, then a preemption boundary event naming the feature slug and the boundary is recorded in the feature's event ledger.
- Given a feature's preempted outcome is collected, when the daemon logs it, then the feature's daemon log line says preempted and names the higher-ranked item that caused it.

#### Negative Paths
- Given a feature stops for preemption, when its events and log lines are read, then no operator park boundary event and no "intentional operator stop" log line is produced for that stop.
- Given an operator parks a feature with no yield requested, when it stops, then the existing operator park event and log line are produced unchanged and no preemption event appears.

### Done When
- [ ] The event union contains a preemption boundary variant carrying the feature slug and boundary, emitted on preempted stops only.
- [ ] A daemon log test shows the preempted line naming the causing item, distinct from the parked line.
