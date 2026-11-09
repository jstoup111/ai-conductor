**Status:** Accepted

# Stories: Queued revalidation is admitted at child BUILD entry

Track: technical. Source: jstoup111/ai-conductor#3477 (with #3473 folded in),
`architecture-review-rebase-base-refresh-revalidation-halts-needs-human` (APPROVED WITH CONDITIONS),
and the 2026-10-31 amendments to `adr-2026-10-12-routed-whole-feature-repair` decisions 7, 8 and 14.

Notation: `<slug>` is the stacked feature's slug and `r<n>` a routing round id.

## Story 1: An in-loop restack's queued child is revalidated in the same run

**Requirement:** TI-1 — when a restack applied inside the gate loop queues a closed child for revalidation, the same run re-enters that child's BUILD region and revalidates it without halting.

As the stacked gate loop, I want BUILD-region entry to admit a queued revalidation before refusing it so that a base refresh during the `rebase` step does not stall a nearly finished feature on an operator halt clear.

### Acceptance Criteria

#### Happy Path

- Given a stacked feature whose `rebase` step applied a `base-refresh` restack that queued child 1 for revalidation, with every route record closed and no repair marker, when the gate loop reaches the next BUILD-region step, then a new `revalidate` route record is created, the repair marker names host 1 and that round, child 1's region is entered as the routed host of that round, and no HALT is written.
- Given that admission, when the region step is dispatched, then the dispatched step is the first gate the queue entry invalidated for child 1 and runs on child 1's checked-out branch, not the leaf's.
- Given the revalidation queue holds children 1 and 2 after an in-loop restack, when child 1's revalidation exits through the routed exit, then child 2 is admitted into its own `revalidate` round and its BUILD region is entered in the same run without a HALT.

#### Negative Paths

- Given the queued child's admission is refused by the round-admission fence because another non-closed round blocks it, when BUILD-region entry runs admission, then no route record or repair marker is created and the run ends with a `mechanical` HALT whose reason names the blocking round.
- Given admission returns `busy` because a repair marker appeared after the cursor was resolved, when region entry re-resolves the execution child once, then a cursor that now resolves the marker's host as routed host is entered, and a cursor still resolving `revalidating` ends with a `mechanical` HALT naming the marker owner; no second route record is created in either case.
- Given reconciliation at region entry returns `resume-exit` or `navigate-leaf-to-build`, when region entry handles the result, then it runs no routed exit and no journal recovery itself and ends with a `mechanical` HALT naming that result, so the next dispatch's stack preflight acts on it.
- Given reconciliation at region entry returns `navigate-host` for an admitted host of an open round, when region entry handles the result, then it re-resolves and enters that host's region instead of consuming the queue, and the queued child stays queued.

### Done When

- [ ] A real-git conductor fixture reproducing the #3477 event shape (an in-loop `base-refresh` restack queuing child 1) reaches child 1's `acceptance_specs` dispatch with no `.pipeline/HALT` file and no `loop_halt` event.
- [ ] After that run, `refs/conductor/<slug>/repairing` names host 1 and a `revalidate` round whose `refs/conductor/<slug>/routes/r<n>` record is phase `open`.
- [ ] The fence-refusal fixture leaves the routing refs byte-identical to before the dispatch and writes a HALT class of `mechanical`.

## Story 2: The routed-exit fall-through admits the queued child instead of refusing it

**Requirement:** TI-2 — when a routed exit leaves a queued child and no repair marker, the run admits that child and enters its BUILD region instead of halting at region entry (the #3473 trigger path).

As the routed-repair loop, I want the routed-exit path to reach the same admission as resume preflight so that a feature-repair restack that invalidates a child above the host continues without an operator halt clear.

### Acceptance Criteria

#### Happy Path

- Given a `revalidate` round r4 in phase `open` with hosts `{1: restacked}`, no repair marker, and a queue generation holding child 2, when the routed-exit continuation hands control to BUILD-region entry, then child 2 is admitted into a new `revalidate` round with a repair marker naming host 2 and that round, and child 2 enters BUILD in the same run.
- Given that same starting ref state, when it is instead reached by a daemon resume, then the round kind, marker host and entered child are the same as on the in-loop path.

#### Negative Paths

- Given the open round still holds a host in `admitted`, `repairing` or `built` state, when region entry runs admission, then it does not admit child 2 and either enters that host through `navigate-host` or ends with the fence's `mechanical` HALT naming that round.
- Given the routed exit's restack reported a halt, when the continuation stops, then it keeps its existing HALT reason and region-entry admission does not run.

### Done When

- [ ] A real-git fixture with the #3473 ref shape (r4 open with hosts `{1: restacked}`, queue holding child 2, no marker) reaches child 2's first BUILD-region dispatch with no HALT file.
- [ ] The same ref shape driven through resume preflight produces the same `refs/conductor/<slug>/repairing` host and the same new round kind as the in-loop fixture.

## Story 3: A child that cannot be admitted halts with the blocking queue and round state named

**Requirement:** TI-3 — when revalidation is truly impossible, the run still halts, and the halt names the queue and round state that blocked it, not only "no matching repair marker".

As an operator reading a halted stacked feature, I want the HALT to name the queued child, the open rounds and the marker owner so that I can tell at a glance why the child could not enter revalidation.

### Acceptance Criteria

#### Happy Path

- Given a refused admission at BUILD-region entry, when the HALT is written, then its first line begins `child BUILD region refused:` and names the queued child, the queue generation, every non-closed round with its unsettled hosts, and the marker owner or `none`.
- Given a fence refusal or a routing stall at region entry, when it is the third consecutive identical stop with no intervening routing progress, then the HALT class is `needs-human`, and the first two identical stops are `mechanical`.

#### Negative Paths

- Given the `refs/conductor/<slug>/revalidate` ref is unreadable, when region entry runs admission, then no route record or marker is written and the run ends with a `needs-human` HALT whose reason names the unreadable queue ref.
- Given the repair marker ref or a route record ref is unreadable, when region entry runs admission, then no queue entry is consumed and the run ends with a `needs-human` HALT whose reason names the unreadable ref.
- Given routing is not eligible for the feature (the stacked routing flag is off) while the cursor resolves `revalidating`, when BUILD-region entry is reached, then it reads or writes no route record, marker or queue generation and ends with a `needs-human` HALT naming the queued child, the queue generation and routing ineligibility.
- Given any refused admission, when the HALT reason is rendered, then it does not contain the text `has no matching repair marker`.

### Done When

- [ ] A fixture with an unreadable queue ref produces a HALT file whose first line names the queue ref, with `.pipeline/HALT.class` reading `needs-human`.
- [ ] A fence-refusal fixture's HALT first line names the queued child, the generation, the blocking round with its unsettled hosts, and the marker owner.
- [ ] A routing-ineligible fixture leaves `refs/conductor/<slug>/` unchanged and writes a `needs-human` HALT.

## Story 4: A queued head is admitted exactly once across in-loop and resume paths

**Requirement:** TI-4 — a queued revalidation is handled the same way whether it is reached in-loop or on resume, and a resume after a stop admits the queued child exactly once with no duplicate revalidate rounds.

As the routing state machine, I want one admission per queue head so that a crash, halt or re-kick between admission and dispatch never opens a second `revalidate` round for the same child.

### Acceptance Criteria

#### Happy Path

- Given region entry admitted child 1 into round r5 and the process stopped before child 1's first gate was dispatched, when the daemon resumes the feature, then the stack preflight continues r5 for child 1 and `refs/conductor/<slug>/routes/` gains no further `revalidate` round for child 1.
- Given a region-entry stop for a queued child (such as a fence refusal), when the next dispatch's preflight runs after the blocking round closes, then it admits the queued child exactly once and that child enters BUILD.

#### Negative Paths

- Given a second writer created a repair marker between region entry's marker read and its queue consumption, when consumption runs, then it creates no route record, and the run either enters the marker's host or ends with a `mechanical` HALT naming the marker owner.
- Given a route-record compare-and-swap is lost while admission creates the round, when admission reports the loss, then no repair marker is written for the losing round, and the queue entry stays queued for the next admission.
- Given admission succeeded and re-resolving the execution child does not yield the admitted child as routed host, when region entry checks the re-resolved child, then it does not dispatch any region step and ends with a `needs-human` HALT naming the admitted round and the resolved source.

### Done When

- [ ] A fixture that stops after in-loop admission and then runs resume preflight shows exactly one `revalidate` route record covering child 1 under `refs/conductor/<slug>/routes/`.
- [ ] A fixture simulating the concurrent marker write shows the route-record count unchanged across the consumption call.

## Story 5: A restack that queues nothing leaves the loop unchanged

**Requirement:** TI-5 — when a restack queues nothing, behavior is unchanged and the run proceeds to whole-feature gates.

As a stacked or flat feature whose restack invalidated no closed child, I want region entry and the routed exit to behave exactly as today so that the new admission adds no routing work or refs where none is needed.

### Acceptance Criteria

#### Happy Path

- Given a stacked feature whose in-loop `base-refresh` restack invalidated no closed child, when the loop continues, then the cursor never resolves `revalidating`, no route record or repair marker is created, and the run proceeds to the whole-feature gates.
- Given a flat feature with no durable child state, when any BUILD-region step is entered, then no routing ref under `refs/conductor/<slug>/` is read or written by admission.

#### Negative Paths

- Given only closed route records remain and the queue generation has no entries, when region entry or the routed exit runs, then admission reports nothing to admit, no route record is created, and the routed exit returns to `manual_test` as today.
- Given the queue ref is absent entirely, when the routed exit completes a leaf return, then no route record or marker is created and whole-feature state is restored as today.

### Done When

- [ ] A stacked fixture with an empty restack invalidation set reaches its first whole-feature gate with `refs/conductor/<slug>/routes/` and `refs/conductor/<slug>/repairing` unchanged.
- [ ] The existing flat-feature (N=1) golden parity suite passes unchanged.

## Story 6: Resume preflight and routed exit keep their outcomes through the shared admission

**Requirement:** TI-6 — the preflight and routed-exit callers adopt the shared admission without changing their observable outcomes.

As the engine's existing recovery paths, I want resume preflight and the routed-exit continuation to produce the same results they produce today so that unifying the admission sequence introduces no regression in either path.

### Acceptance Criteria

#### Happy Path

- Given a resume with a queued child, no marker and no open round, when the stack preflight runs, then it returns `navigate-host` with the admitted round id and host, exactly as before the change.
- Given a routed exit whose reconciliation reports `leaf-returned` with an empty queue and no open round, when the continuation runs, then it restores whole-feature state and returns to `manual_test`, exactly as before the change.

#### Negative Paths

- Given queue consumption reports `stalled` in the preflight, when the preflight handles it, then it re-reconciles and records the bounded routing stall exactly as before the change.
- Given queue consumption reports `unavailable` in the preflight, when the preflight returns, then its result is `unavailable` with the detail `cannot consume revalidation queue`, unchanged.
- Given queue consumption reports `unavailable` in the routed-exit continuation, when it halts, then the HALT reason is `child BUILD region refused: cannot consume routed revalidation queue`, unchanged.

### Done When

- [ ] The existing stack-preflight and routed-exit behavior tests pass with their expected values unedited.
- [ ] Exactly one production definition of the reconcile→consume admission sequence exists, and resume preflight, the routed-exit continuation and BUILD-region entry each call it.
