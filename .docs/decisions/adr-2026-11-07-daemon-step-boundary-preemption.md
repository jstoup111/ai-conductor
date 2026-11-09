# ADR: Daemon preempts lower-priority work at step boundaries

**Date:** 2026-11-07
**Status:** APPROVED
**Deciders:** James Stoup (operator), composer DECIDE for jstoup111/ai-conductor#1929

## Context

A dispatched feature owns its slot until it reaches DONE or HALT. When every slot is busy, a
higher-priority arrival waits behind whatever was dispatched first, which with kickback laps can be
hours. Concurrency is no longer clamped to 1 (#2075), but the same wait happens whenever the pool is
full. The only workaround is a manual park and a manual unpark later.

The pieces needed to stop at a safe point already exist:

- The busy pool rediscovers the backlog on every pass (`daemon.ts` busy-pool branch under
  `deps.onTick`, wired in `daemon-cli.ts`), so arrivals are visible mid-build.
- Discovered items carry the priority resolver's band (`BacklogItem.band`, set by `orderBacklog` in
  `backlog-priority.ts`), sourced through the backend-neutral `OrderingSource`.
- The conductor stops at operator-park boundaries before every scheduling unit and every provider
  attempt, and returns a typed termination without spending budget or writing a HALT
  (`adr-2026-07-29-operator-park-scheduling-unit-boundary` D3, D5, D11, D12).
- The live child executor has a supervisor-to-child IPC channel that already carries stop requests
  (`adr-2026-10-15-per-dispatch-engine-pinned-executor` D4, D5).

The in-process executor is being deleted by spec PR #3403 and is out of scope.

The operator chose Minimal breadth: yield, a distinct outcome and auto-resume. There is no
anti-thrash guard, config toggle, per-feature opt-out or dashboard count.

## Options Considered

### Option A: Yield-request marker file under `.daemon/`
- **Pros:** Mirrors the operator-park marker that the child already polls. An older child just
  ignores it.
- **Cons:** If the supervisor crashes before cleanup, the leftover marker makes the feature yield
  again as soon as it resumes. It also adds a second piece of on-disk coordination state.

### Option B: Yield request over the executor IPC channel
- **Pros:** Nothing on disk. The request dies with the dispatch, so it can never leak into a
  resume. It uses the supervisor-to-child channel that already carries stop requests.
- **Cons:** Adds a message kind to the protocol envelope. A yield sent just before the child ends
  is a no-op.

### Option C: Burst slot above `daemon_concurrency`
- **Pros:** No interruption and no resume path.
- **Cons:** The running feature never stops, which fails the issue's first two outcomes. It also
  raises provider spend and rebase kickbacks and bypasses the operator's configured width.

## Decision

Option B, chosen by the operator on 2026-11-07.

1. **Preemption rank is a pure function of the resolver band.** `critical` ranks above `high`,
   which ranks above `medium`. `medium`, `unlabeled` and `no-issue` share one rank, and `low` ranks
   below them. The function reads only the `PriorityBand` the backend-neutral priority resolver
   assigns, never tracker labels, so a future Jira ordering source participates without change. An
   item without a band (resolution mode `fallback` or `off`) has no rank and never preempts or
   gets preempted.
2. **The trigger is the busy-pool pass.** On each pass where every slot is held, the daemon takes
   the item `pickEligible` would dispatch next from the freshly discovered backlog. A running
   feature worker is a candidate victim only when both conditions hold: the arrival's preemption
   rank is strictly higher than the feature's, and the arrival comes before the feature in the
   current backlog order. The daemon then requests one yield. Requiring both keeps preemption from
   reversing the dispatcher's own ordering. That ordering places `no-issue` first and `unlabeled`
   last, while the preemption rank treats both as medium. Without the second condition, a
   [`low`, `unlabeled`] or [`no-issue`, `critical`] backlog would preempt the feature the
   dispatcher just chose (operator decision 2026-11-07, conflict check). An equal or lower rank, or
   an arrival ordered behind the feature, never triggers a yield. Repair workers are never victims.
3. **One victim, one request outstanding.** The victim is the lowest-ranked candidate; on a tie,
   the most recently dispatched one, which has the least sunk work. At most one yield request
   is outstanding at a time. It clears when the victim's outcome is collected, whatever that
   outcome is.
4. **The request travels over the executor IPC as a stop-class coordination request.** The
   supervisor sends the victim's child a `yield` message. This is a stop request in the sense of
   `adr-2026-10-15-per-dispatch-engine-pinned-executor` D4 ("shutdown and stop requests"), so that
   ADR is applied, not amended. The addition is backward-compatible, so
   `EXECUTOR_PROTOCOL_VERSION` is not bumped. An older pinned child parses the unknown kind as
   malformed, ignores it and runs to its natural end. A newer child under an older supervisor never
   receives one. No file or marker is written.
5. **The child holds the request in memory and composes it into the boundary predicate once.** The
   child records the request in an in-memory flag and passes the conductor a daemon-only
   `preemptionRequested` predicate beside `operatorParkBoundary`. The conductor composes the two
   into its gate predicate at the single point where it stores the park predicate. Every existing
   gate site therefore observes a yield with no per-site code: pre-unit, serial attempt, self-host
   admission, and group member and redispatch. Interactive conduct gets neither predicate and is
   byte-for-byte unchanged.
6. **Operator park wins; the termination is classified at the one boundary primitive.** When a gate
   stops, the conductor's boundary primitive re-reads operator park first, treating a read error as
   parked. An active or indeterminate park returns the existing `operator-parked` termination with
   the existing event. Otherwise, if a yield was requested, it closes open executions, emits a new
   `preemption_boundary` `ConductorEvent` (feature slug plus the scheduling-unit boundary), and
   returns a typed `preempted` termination.
7. **A preempted stop spends nothing.** A preempted stop has the same semantics as a declined
   attempt under `adr-2026-07-29-operator-park-scheduling-unit-boundary` D12. It advances no
   escalation rung, counter or retry budget. It writes no HALT, leaves the step `in_progress`, and
   leaves committed task progress untouched. Natural halts, errors and kickbacks keep their
   authority (D8 of the same ADR).
8. **The pool releases the slot without parking.** The feature runner maps the `preempted`
   termination to a `preempted` feature status and keeps the worktree. It skips failure
   escalation, HALT creation, completion narration and shipped or processed side effects. The
   executor ledger records the dispatch as `terminated`. The daemon releases the claim without
   parking or completing the slug, registers no HALT watcher, and logs a distinct `preempted` line
   naming the arrival that caused it. Ordinary `pickEligible` then dispatches the higher-ranked
   arrival into the freed slot and resumes the preempted feature when backlog order next reaches
   it. No operator action is needed.
9. **Preemption is the one non-done outcome without an operator marker.** It is
   scheduler-intentional, and its resume condition is backlog order, not an operator action. This
   amends `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`'s invariant for this
   outcome only.
10. **Only the child executor supports preemption.** The daemon reaches the child through a
    `requestYield(slug)` dependency that the child executor serves. When the dependency is absent,
    no yield is ever requested.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | An older pinned child ignores a `yield` message: `parseExecutorMessage` returns malformed for an unknown kind (`executor-protocol.ts` default case) and the child's message handler acts only on `stop` (`executor-child.ts`) | verified | 95% | yes | An old child could crash on the message; decision 4 would need a protocol bump | n/a |
| A2 | Every conductor gate site reads the one park predicate stored at construction (`conductor.ts` constructor), and every gate-observed stop returns through the `stopAtOperatorParkBoundary` primitive, including group joins that call it with an already-observed boundary | inferred | 85% | yes | A site that bypasses the composed predicate or the primitive would ignore a yield or mislabel it as an operator park; that site would need its own wiring | APPROVED by operator 2026-11-07 |
| A3 | The busy pool rediscovers the backlog on every pass in production (`daemon.ts` busy-pool branch runs under `deps.onTick`, which `daemon-cli.ts` wires) | verified | 95% | yes | Arrivals would not be seen mid-build; the trigger would need its own discovery | n/a |
| A4 | In banded mode, discovered backlog items, including in-flight slugs, carry the resolver's `PriorityBand` in `BacklogItem.band` | inferred | 80% | yes | Running features would have no rank and could never be victims; the daemon would need to record the band at dispatch | APPROVED by operator 2026-11-07 |
| A5 | A preempted feature resumes correctly from its persisted `.pipeline/` state through the same re-dispatch path an unparked feature uses (`adr-2026-07-29-operator-park-scheduling-unit-boundary` D7, D12; operator-park boundary tests) | inferred | 90% | yes | Resume could redo or skip work; preemption would need its own resume handling | APPROVED by operator 2026-11-07 |

## Consequences

### Positive
- Higher-priority work reaches a slot at the running feature's next safe boundary instead of
  waiting for DONE or HALT, with no manual park or unpark.
- It reuses the proven park gates, the existing IPC stop channel and the resolver, and adds no new
  module or on-disk state.
- It is tracker-neutral by construction.

### Negative
- A preempted feature loses the in-progress attempt's work when that attempt was declined at its
  boundary. Work already settled is kept.
- Without an anti-thrash guard (excluded by the operator), a steady stream of higher-ranked
  arrivals can keep a low-ranked feature waiting indefinitely.
- An older pinned child ignores yield, and while it runs, the one outstanding request blocks any
  other preemption until that child ends.
- `preempted` adds a status that every consumer of the feature outcome union must handle.

### Follow-up Actions
- [ ] Implement decisions 1–10 under the spec for jstoup111/ai-conductor#1929.
