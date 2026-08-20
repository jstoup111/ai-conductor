**Status:** Accepted

# Stories: One build_review PASS clears the convergence cap

**Feature:** ai-conductor#1694 — technical track, Tier M
**Authoritative design:** `.docs/decisions/adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md` (APPROVED)
**Binding conditions:** `.docs/decisions/architecture-review-2026-08-18-one-build-review-pass-clears-the-convergence-cap-s.md` (APPROVED WITH CONDITIONS)

Technical track: there is no PRD, so `**Requirement:**` cites the desired outcome from
`.pipeline/intake-outcomes.md` that the story delivers.

Documentation updates are deliberately **not** stories — they accompany functional work and belong
outside the acceptance criteria. `docs/reference/configuration.md:974-975` currently states "A
passing `build_review` resets the counter", which this feature makes false; correcting it is a plan
task, not a story.

**What this feature is not.** It adds no detector, no counter, and no threshold. The early trip is
`adr-2026-08-17`'s per-rubric bound, which measured 5 of 5 on spinning features; this feature exists
so that bound and `adr-2026-08-12`'s cap cannot be returned to zero by an intervening PASS. An
implementation that introduces a new bound or re-tunes an existing cap is out of scope and must fail
review.

---

## Story 1: Convergence laps survive a build_review PASS

**Requirement:** outcome-1

As the engine, I want a `build_review` PASS to leave the gate's convergence counters untouched, so
that a feature which intermittently passes still accumulates toward a bounded terminal state instead
of resetting to zero on every pass.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `build_review` gate has consumed three kickbacks, when `build_review`
  completes with a PASS, then the gate's cumulative lap count still reads 3.
- Given that feature is later re-opened by a downstream kickback and `build_review` FAILs again, when
  the kickback is consumed, then the cumulative count reads 4 rather than 1.
- Given a feature accumulates consumed kickbacks past `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` with
  PASSes interleaved among them, when the cap is exceeded, then the run takes the existing
  `needs-human` halt naming the cumulative count and the cap.

#### Negative Path
- Given the gate's per-tree `count` budget and its reset rule, when a `build_review` PASS occurs,
  then `count` behaves exactly as it does today — this story changes only the convergence counters.
- Given a genuinely fresh feature session, when the session begins, then every counter is cleared as
  it is today, by the existing whole-ledger clear.
- Given a ledger entry written before this change that carries no convergence fields, when it is
  read, then it is accepted and folded to an empty budget rather than rejected, and no halt is
  produced for a feature that was in flight when this shipped.

---

## Story 2: A rebase that invalidates build_review refunds its laps

**Requirement:** outcome-2

As a feature whose approved `build_review` verdict was invalidated by a rebase, I want the laps I
spent before that verdict credited back, so that I am not halted for churn I did not earn — the
property `adr-2026-08-12` D2 was written to protect.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `build_review` gate has consumed four kickbacks and then passed, when a
  file-changing rebase invalidates that gate and re-opens it, then the gate's convergence counters
  are credited back to their empty state before it is re-dispatched.
- Given that feature then FAILs `build_review` twice after the rebase, when the second kickback is
  consumed, then the cumulative count reads 2 and no cap halt is produced.
- Given a rebase invalidates several gates at once, when the re-open loop runs, then only
  `build_review`'s ledger entry is credited.

#### Negative Path
- Given a file-changing rebase whose delta misses `build_review`'s judged surface so the gate's prior
  verdict is preserved, when the rebase path runs, then no credit is issued and the accumulated laps
  stand.
- Given one rebase invalidated `build_review` and the credit was applied, when the feature FAILs
  `build_review` on later laps, then no further credit is issued for that same rebase and the counts
  accumulate normally.
- Given a `build_review` PASS with no rebase involved, when the step completes, then no credit is
  issued — a PASS is not a refund trigger.
- Given the rebase path cannot compute its delta or feature surface and falls back to invalidating
  every gate, when `build_review` is re-opened by that fallback, then the credit is issued — the
  budget fails open, never toward a spurious halt.

---

## Story 3: The credit is legible from persisted state

**Requirement:** outcome-3

As an operator asking after the fact why a convergence bound did not fire, I want each credit
recorded on the persisted event spine with the gate it applied to, so that the answer is readable
from the ledger rather than reconstructed by hand.

### Acceptance Criteria

#### Happy Path
- Given a rebase invalidates `build_review` and its convergence laps are credited, when the gate is
  re-opened, then the emitted kickback record carries the credit and names the gate it applied to.
- Given a persisted event ledger for a feature that took a credit, when it is read back, then the
  credit and the kickback that carried it are both present, with no separate file consulted.

#### Negative Path
- Given a rebase that preserves `build_review` and issues no credit, when the gate's events are read,
  then no credit is reported.
- Given a consumer that does not know the credit field, when it reads a kickback record, then it
  parses unchanged — the field is additive and optional.
- Given the change ships, when the event union's sink declarations are inspected, then no new event
  type was added and no sink declaration changed.

---

## Story 4: The removed reset leaves no reachable caller

**Requirement:** outcome-1

As a maintainer, I want the PASS-reset path removed rather than merely bypassed, so that a later
change cannot reintroduce the defect by calling a function that still exists.

### Acceptance Criteria

#### Happy Path
- Given the change has landed, when the engine source is searched for the cumulative-reset helper,
  then it has no remaining production callers and is gone from the ledger module's exported surface.
- Given the `build_review` step-completion path, when a PASS is recorded, then it performs the same
  status write it does today and nothing else.

#### Negative Path
- Given a test that asserted a PASS zeroes the cumulative count, when the suite runs, then that
  assertion has been updated to the new contract rather than deleted, and it fails against the
  pre-change behavior.

---

## Story 5: The reset rule belongs to the entry, not to one counter

**Requirement:** outcome-1

As the engine, I want the clear and the credit to operate on every lap-counting field the gate's
ledger entry carries, so that this feature is correct on today's base, after `adr-2026-08-17`'s
per-rubric tally lands, and after #1629's mechanical-fault allowance lands — in any order, without a
further change to the PASS path.

### Acceptance Criteria

#### Happy Path
- Given a ledger entry that carries only the cumulative lap count, when a credit is issued, then that
  count is credited and no error is raised for the fields that are absent.
- Given a ledger entry that also carries a per-rubric tally, when a credit is issued, then both the
  cumulative count and the per-rubric tally are credited together.
- Given a ledger entry that also carries a bounded mechanical-fault allowance, when a credit is
  issued, then that allowance is credited with the others.
- Given any lap-counting field on the entry, when `build_review` completes with a PASS, then none of
  them is cleared.

#### Negative Path
- Given `adr-2026-08-17`'s tally or #1629's allowance has not been implemented, when a `build_review`
  PASS occurs, then nothing attempts to clear a field that does not exist.
- Given either of those features lands after this one, when its counter is added, then it inherits
  this feature's reset semantics without a further change to the PASS path, and no new PASS reset is
  introduced anywhere on this entry.
- Given the gate's per-tree `count` field, when a credit is issued, then it is NOT credited — `count`
  is a no-op detector with its own approved reset rule, not a lap counter.

---

## Notes for the plan

**The design rests on one ratio, and the plan should re-derive it in-tree.** Across the 15 features
with `build_review` kickback history in `.daemon/evals-raw`, there are 95 consumed `build_review`
kickbacks and **1** rebase-origin invalidation of `build_review`. That is why re-keying the exemption
onto the invalidation cannot re-open the hole the PASS reset created. If a re-run of that count comes
back materially different, the ADR's approval basis has changed and the plan should stop rather than
proceed.

**Do not re-derive the invalidated set.** Story 2's condition must be the same verdict predicate the
existing re-open loop uses. `adr-2026-07-20-post-rebase-delta-aware-invalidation` owns the
preserve/invalidate partition; a second implementation of it at the refund site is the failure
condition §4.1 of the review names.

**No new event type.** `adr-2026-07-26-event-sink-registry-exhaustiveness` makes `EVENT_SINKS` total
over the union, so a new member forces a sink declaration. Story 3 is an additive optional field on
the kickback member, the shape `adr-2026-08-12` D5 and `adr-2026-08-17` D8 already established.

**Story 5 is the entry-wide rule, and it has a precondition outside this repository's code.** Per
ADR D6 the rule binds #1629's unmerged allowance design, whose plan task-6 currently instructs its
build to add a PASS reset "beside the existing cumulative reset". That instruction must be amended
before #1629 builds. The precondition is recorded in
`.docs/conflicts/one-build-review-pass-clears-the-convergence-cap-s.md`; this feature does not edit
another feature's spec.
