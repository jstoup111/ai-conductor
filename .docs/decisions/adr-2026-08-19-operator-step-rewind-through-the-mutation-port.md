# ADR: Returning a feature to an earlier step is an operator verb over the mutation port

**Date:** 2026-08-19
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for ai-conductor#1729

## Context

Recovering the two features stranded on 2026-08-19 required hand-editing engine-internal state:
setting `test_suite`, `build_verification__test_suite`, and `build_review` to `pending` and
`last_step` to `wiring_check` in `.pipeline/conduct-state.json`; rewriting
`.pipeline/gates/test_suite.json`; and deleting `.pipeline/HALT`. The issue states plainly: "There is
no CLI for this."

Hand-editing is the failure, not the inconvenience. `.pipeline/conduct-state.json` is written through
`ConductStateStore` (`adr-2026-08-01-conduct-state-mutation-port`), which serializes writers under a
bounded cross-process lease and evaluates each mutation against the current snapshot. An operator
editing the file with a text editor bypasses that lease entirely, and can do so while a daemon
dispatch holds it — the exact concurrent-write the port exists to prevent. A recovery procedure that
requires corrupting the invariant is not a recovery procedure.

Two existing surfaces are adjacent and neither covers this:

- `conduct-ts --from <step>` sets the loop's start index and marks that one step
  `explicitlyTargeted`, exempting it from the `alreadyResolved` skip. It mutates no state, leaves
  every downstream `done`, does not touch gate verdicts, and does not clear `.pipeline/HALT`.
  `adr-2026-07-11` D3 additionally records that the daemon no longer uses `fromStep` for
  re-dispatch, so it is not reachable on the path that strands.
- `conduct-ts --reset` clears state wholesale. `adr-2026-08-01` classes whole-state replacement as a
  separate privileged operation for deliberate start-over, which is not what an operator recovering
  one gate wants.

`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` establishes the invariant this
discharges: a dispatch that ends in any state other than `done` must leave a marker an operator can
find and clear, and "the marker content names the failing stage and the operator action that resumes
it." Today the marker exists and the named action does not.

`reseal` and `decide-grant` are the established shape for an operator-authority verb in this CLI:
scoped, explicit, feature-named, and writing through engine machinery rather than around it.

## Options Considered

### Option A: A `rewind` verb writing through `ConductStateStore` (CHOSEN)

A named subcommand that returns one feature to a named earlier step by submitting authorized
mutations to the port, then clearing the derived records that would otherwise contradict the new
position.

- **Pros:** the port's lease, expected-value check, and conflict disposition all apply, so a rewind
  cannot race a live dispatch; `adr-2026-08-01` already defines the mutation shape for exactly this
  transition; joins an established verb family; the operation is observable rather than invisible.
- **Cons:** a new consumer-visible CLI surface, which the release gate's breaking-surface classifier
  will see; and it must decide the downstream set, which is a real design question rather than a
  parameter.

### Option B: Document the hand-edit in a runbook

- **Rejected.** It codifies the lease bypass rather than removing it, and it does not satisfy
  outcome-5, which asks for a supported command. The repository's own design principle prefers
  machinery where machinery can do the job, and here it plainly can.

### Option C: Extend `--from <step>` to also demote state

- **Rejected.** `--from` is a run-time navigation override on a run that is about to start;
  `adr-2026-07-11` D3 deliberately exempts it from the resume clamp as an operator override.
  Overloading it with a durable mutation would make a read-mostly flag write state as a side effect,
  and it is unreachable on the daemon path anyway.

### Option D: Auto-rewind on detecting the strand

- **Rejected as the answer to this outcome.** Automatic recovery for the *known* cause is the job of
  `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch`, and it is in scope. This verb exists
  for the residual case that machinery could not resolve, where `adr-2026-08-18` D5's reasoning
  applies: the run is waiting on a human judgement, and a lever the daemon operates itself is not a
  lever.

## Decision

Adopt **Option A**.

### D1 — The verb names a target step and one feature, and refuses anything ambiguous

`rewind --to <step>` against one feature's worktree. The step is validated against the **resolved**
step registry (`buildStepRegistry(config)`), so config-declared custom steps are valid targets and a
typo fails by name rather than resolving to `findIndex`'s not-found sentinel — the defect
`validateFromStep` (`steps.ts`) exists to close and `adr-2026-08-04-unresolved-step-command-fails-by-name`
generalizes. A target at or after the feature's current position is refused: this verb only goes
backward.

### D2 — Every state change is an authorized port mutation, never a file write

Each demotion is submitted to `ConductStateStore` with the current value as the expected value and an
intent naming the operator rewind, taking `adr-2026-08-01`'s decision verbatim: "Explicit invalidation
such as `done` to `stale` is expressed as an authorized mutation with the current expected value,
rather than treated as a lower-priority overwrite." A refused mutation aborts the rewind and reports
the field, expected value, and current value; it never falls back to a direct write.

`stale` is the target status, not `pending`: `stepSatisfied` counts `stale` as satisfied for
*prerequisite* purposes while `gateSatisfied` treats it as unsatisfied for *gate* purposes
(`selector.ts:59`, `state.ts:203`), which is exactly "this must re-run, and its dependents are not
thereby invalid". The hand-edit used `pending` because it had no way to express the distinction.

### D3 — The demotion set is the target and its downstream, computed from the resolved registry

Rewinding to a step demotes that step and every non-skipped step after it in the resolved list. A
rewind that left a downstream `done` would reproduce this issue's defect in the operator's own hands.
Steps already `skipped` by tier, track, or bootstrap mode keep that status — a rewind is not a
re-decision of what applies to the feature.

### D4 — Derived records that would contradict the new position are cleared in the same operation

Gate verdicts for the demoted steps, and `.pipeline/HALT` with its class sidecar, are cleared as part
of the rewind. Leaving them is what makes today's recovery a three-part ritual, and a half-applied
rewind is worse than none. Halt clearing follows
`adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`'s atomicity rule rather than inventing a
second clearing path. The order is: acquire, mutate state, clear verdicts, clear halt — so a failure
at any point leaves the feature halted rather than running from a partially-rewound position.

### D5 — The occurrence rides the existing event spine

The rewind emits on `ConductorEvent`, naming the operator, the target step, and the demoted set. Per
the event-spine skill a durable state change with no corresponding event is the parallel channel the
principle forbids, and `.pipeline/conduct-state.json` mutating with no spine record is exactly that.
No new ledger and no sidecar file.

### D6 — Authority is the operator, and the verb refuses to be a harness capability

The verb is operator-invoked only. It is not called by the conductor, the daemon, or any step runner,
and no skill instructs an agent to run it. This is the boundary `adr-2026-08-13`'s authority gate
draws for finding acceptance and that `reseal` draws for protected artifacts: a harness process that
could rewind its own gates could launder any failure into a fresh start.

## Consequences

### Positive

- Outcome-5 is met with a supported command, and the recovery stops requiring a lease bypass.
- `adr-2026-08-05`'s "the marker names the action that resumes it" becomes satisfiable, because there
  is now an action to name.
- The rewind is observable on the spine, so a feature that shipped after an operator rewind carries
  that fact in its own history.

### Negative

- A new consumer-visible CLI surface. It is additive — no existing invocation changes meaning — but
  the release gate's path-based classifier may still flag the CLI surface, in which case the correct
  response is the `adr-2026-07-06-migration-gate-waiver` waiver for an additive verb, not an invented
  empty migration block.
- An operator can now rewind a healthy feature and discard correct work. That is true of `--reset`
  today and is the accepted cost of an operator lever; D1's backward-only rule and D3's explicit
  demotion report bound the surprise.
- The verb must stay in step with the registry. A future step whose completion is recorded somewhere
  other than `conduct-state.json` plus its gate verdict would need D4 extended, or a rewind past it
  would be partial.
