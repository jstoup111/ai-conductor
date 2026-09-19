**Status:** Accepted

# Stories: Markerless no-verdict daemon exit is always classified needs-human (#1269)

Track: technical

Tier: S

Approved by the operator on 2026-09-18. Scope is bound by
`.docs/track/markerless-no-verdict-daemon-exit-is-always-classi.md`: only the gate-block return
path changes behavior, and only for the shape whose unsatisfied prerequisites include one that is
both `pending` and resolvable to an earlier index in the resolved step registry — the same
condition the resume clamp uses to decide it can move. The catch-all markerless classifier, the
four HALT read dispositions, the retry-decision seam, and the daemon's re-kick bounding are all
untouched.

## Story 1: A gate blocked by a prerequisite the next resume can reach parks as daemon-recoverable

**Requirement:** #1269 desired outcome, second bullet

As a daemon operator, I want a run that stops because a mid-run navigation stepped past a
prerequisite the next resume will walk back to, to park in a state the daemon's own sweep can
resume, so that the feature re-dispatches without a manual round-trip to read
`conduct-state.json` and clear the marker by hand.

### Acceptance Criteria

#### Happy Path

- Given a daemon run blocked by a `pending` prerequisite that sits at an earlier index in the resolved step registry, when the gate is evaluated, then the run parks with HALT class `mechanical`.
- Given that same run, when the gate is evaluated, then the HALT body names that prerequisite together with its `pending` state.
- Given that same run, when the gate is evaluated, then a loop-halt event carrying the same reason is emitted before the run returns.
- Given that same run, when the gate is evaluated, then the reason states that the daemon will re-dispatch rather than that operator action is required.
- Given a feature parked by this path, when the daemon's progress-gated re-kick sweep reads its halt disposition, then the disposition does not refuse the re-kick as requiring operator action.
- Given a run blocked by two unsatisfied prerequisites where only one is `pending` and resolvable to an earlier index, when the gate is evaluated, then the run still parks `mechanical` and the body names both prerequisites with their states.

#### Negative Paths

- Given a daemon run blocked by a `pending` prerequisite that the resolved step registry does not contain at all, when the gate is evaluated, then the run parks `needs-human` rather than `mechanical`, because no re-dispatch can reach it.
- Given a daemon run blocked by a `pending` prerequisite that sits at or after the blocked step's own index, when the gate is evaluated, then the run parks `needs-human` rather than `mechanical`.
- Given a recoverable gate block, when the HALT body write fails so no class sidecar is persisted, then no `mechanical` sidecar exists and the missing class is read as the fail-closed `unclassified` disposition rather than as recoverable.
- Given a recoverable gate block, when the class sidecar write fails after the body was written, then the resulting partial state carries no class and is read as `unclassified` rather than defaulting to `mechanical`.
- Given a feature repeatedly parked by this path, when the daemon's re-kick dispatch ceiling has already been reached for that slug, then the sweep stops re-kicking it instead of dispatching without bound.
- Given an interactive (non-daemon) run blocked by a resolvable `pending` prerequisite, when the gate is evaluated, then no HALT marker and no class sidecar are written at all.

### Done When

- [ ] A gate-block fixture whose `pending` prerequisite sits at an earlier registry index under a daemon run writes `.pipeline/HALT.class` containing exactly `mechanical`.
- [ ] That fixture produces a HALT body containing both the blocking prerequisite's name and its `pending` state, and not the string `Operator action is required`.
- [ ] That fixture emits exactly one loop-halt event whose reason matches the written HALT body's first line.
- [ ] A fixture whose `pending` prerequisite is absent from the resolved registry writes `needs-human`, and a second fixture whose `pending` prerequisite sits at or after the blocked step's index also writes `needs-human`.
- [ ] `isOperatorActionHalt('mechanical')` is asserted false, pinning that this class is the one the re-kick sweep will act on.
- [ ] A fixture whose marker write is forced to fail asserts that no `mechanical` class sidecar exists afterwards.
- [ ] A gate-block fixture with `daemon` false asserts that neither `.pipeline/HALT` nor `.pipeline/HALT.class` is created.
- [ ] The resolvability test used by the classification is the same exported helper the resume clamp uses, asserted by a direct unit test over the helper.

## Story 2: Every other blocked or markerless exit keeps its operator-required classification

**Requirement:** #1269 desired outcome, fourth bullet

As a daemon operator, I want conditions that genuinely need my judgement to keep parking as
`needs-human`, so that widening recoverability for one provable shape does not quietly convert
real blockers into an unbounded retry.

### Acceptance Criteria

#### Happy Path

- Given a daemon run whose unsatisfied prerequisites are all in non-`pending` states, when the gate is evaluated, then the run parks with HALT class `needs-human` and the body still states that operator action is required.
- Given a daemon run that exits without writing any terminal marker for a reason other than a gate block, when the loop tail's catch-all classifier runs, then the run parks with HALT class `needs-human` exactly as before this change.
- Given a daemon run whose unsatisfied prerequisites are all non-`pending`, when the gate is evaluated, then the HALT body names every unsatisfied prerequisite with its state, unchanged from current behavior.
- Given the existing registry fixture whose blocked step's only prerequisite is `failed` and absent from the resolved registry, when the gate is evaluated, then the run parks `needs-human` with its current body text, unchanged.

#### Negative Paths

- Given a daemon run blocked by prerequisites that are all `failed`, when the gate is evaluated, then the run does not park as `mechanical` and is therefore not auto-cleared by the re-kick sweep.
- Given a daemon run that already wrote a terminal DONE marker, when the loop tail's catch-all classifier runs, then it writes no HALT marker and does not overwrite the existing terminal state.
- Given a gate block under a daemon run, when the written class sidecar is read back, then its value is one of the four dispositions the read side already recognises and never a newly introduced fifth value.

### Done When

- [ ] A gate-block fixture whose prerequisites are all `failed` writes `.pipeline/HALT.class` containing exactly `needs-human`.
- [ ] A fixture driving a daemon loop to a non-gate-block markerless exit still produces a `needs-human` class, proving the catch-all default was not weakened.
- [ ] A fixture asserting that a run which wrote DONE reaches the catch-all without a HALT marker being created.
- [ ] Every class value written by the changed file is asserted to be a member of the existing `HaltClass` union, with no new union member added.

## Negative-category review

Invalid input, auth failures, timeouts, concurrency, resource exhaustion, cascade deletion, and
datastore integrity are inapplicable: the change is a classification decision over an in-memory
`GateResult` and the already-loaded `ConductState`, with no external call, no user-supplied input,
no shared mutable state, and no write other than the two-file HALT marker protocol the writer
already owns.

Partial failure is the dominant applicable category and is covered directly: the marker writer is
best-effort and can return `partial` (body written, sidecar not) or `failed`, and
`adr-2026-07-28` D4 makes that intermediate state `unclassified`, which is fail-closed. Both
branches have explicit scenarios asserting the absence of a `mechanical` sidecar rather than a
default to it.

Invariant side-effect on alternate branches applies and is covered: the existing `true` branch
pairs `writeHaltMarker` with `emitLoopHalt`, and the new branch is asserted to emit the same
loop-halt event rather than writing a marker silently.

Dependency unavailability reduces to the re-kick sweep declining to act, which the dispatch-ceiling
scenario covers; idempotency is inherent because the classification is a pure function of the gate
result and the step states it reads.
