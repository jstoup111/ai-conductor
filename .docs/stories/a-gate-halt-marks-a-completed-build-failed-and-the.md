**Status:** Accepted

# Stories: A gate halt marks a completed build failed, and the residue blocks every later resume

Source: jstoup111/ai-conductor#1753. Track: technical. Tier: M. Respec 2026-08-24 against
post-#1824 main per `adr-2026-08-24-refused-step-status.md` and
`architecture-review-2026-08-24-a-gate-halt-marks-a-completed-build-failed-and-the.md`.

Scope boundary (binding): a typed `refused` step status plus a `step_refused` spine event at the
three sites that still stamp `failed` — the protected-artifact seal retries-exhausted path, the
step-written needs-human halt sites, and the validation-group halt commit — and a
prerequisite-naming needs-human HALT on residual gate-blocked loop exits. Excluded: paths already
delivered on main (live-boundary deferral, missing-worktree preflight, finish-gate stale
restaging, resume runnable-prerequisite walk), retired build_review rubrics, genuine-failure
semantics, seal/live-boundary detection rules, daemon re-kick policy.

Outcome ids used below: O1 a refusal never records the step failed and completed steps keep their
verdicts; O2 clearing the halt is enough to resume with no hand-edit of pipeline state; O3 a
prerequisite-blocked exit halts naming the prerequisite and the status that caused it; O4 a
genuine failure still records failed and blocks dependents.

## Story 1: A protected-artifact seal refusal records refused, never failed

**Requirement:** O1

As an operator, I want a seal refusal on a BUILD/SHIP step to record a typed `refused` status and
halt, so that a completed build is never rewritten as a failure by an environmental check.

### Acceptance Criteria

#### Happy Path
- Given `build` is `done` in `conduct-state.json` and the seal verdict for the next step's dispatch is `ok: false`, when retries exhaust, then the run halts with the seal reason, `build` remains `done`, and the entered step reads `refused`
- Given the seal refuses a step, when the refusal is recorded, then the write goes through the `ConductStateStore` mutation port and no `failed` value is written for any step
- Given the seal refuses on attempt 2 or later, when the halt is written, then the HALT marker carries the `protected-artifact` class and the seal reason through the existing `writeHaltMarker` seam

#### Negative Paths
- Given the seal verdict is `ok: true`, when the step is dispatched, then the provider runs and the result is recorded exactly as before with no refused facet set
- Given the dispatched step's own work fails on every retry, when retries are exhausted, then the step is recorded `failed` and a `step_failed` event is emitted
- Given the seal refuses, when `events.jsonl` is read back, then no `step_failed` event exists for the refused step

### Done When
- [ ] A unit test with `build = done` and an `ok: false` seal verdict asserts `conduct-state.json` reads `build: done`, the entered step reads `refused`, and `events.jsonl` has no `step_failed` for it
- [ ] The refusal is carried as a typed facet on `StepRunResult` with no string match on output text

## Story 2: A step-written needs-human halt records refused, not failed

**Requirement:** O1

As an operator, I want a step that halts for human judgement to be recorded as `refused`, so that
"a human must decide" is mechanically distinguishable from "the work failed".

### Acceptance Criteria

#### Happy Path
- Given a step's run concludes with a needs-human halt, when the loop records the outcome, then the step reads `refused` in `conduct-state.json` and the HALT keeps its `needs-human` class and existing wording
- Given a needs-human halt is recorded as refused, when the committed halt record is written, then it is produced by the existing `writeHaltMarker` seam with no new machinery

#### Negative Paths
- Given a step's provider work errors terminally without writing a needs-human halt, when retries exhaust, then the step is recorded `failed`, not `refused`
- Given a needs-human refusal fires, when `HALT.class` is read, then its value is from the existing closed class set and no new class value appears

### Done When
- [ ] A unit test drives a step to a needs-human halt and asserts status `refused`, class `needs-human`, and no `step_failed` event
- [ ] Both step-written needs-human halt sites in the dispatch loop route through the same refusal handler

## Story 3: A validation-group halt records refused for the judging step

**Requirement:** O1

As an operator, I want a validation-group halt (including an as-built plan-gap awaiting a human)
to record the judging step as `refused`, so that a verdict awaiting judgement is not stored as a
failure of the step's work.

### Acceptance Criteria

#### Happy Path
- Given the as-built review returns a plan-gap verdict with the outcome undelivered, when the validation group halts, then the judging step reads `refused` and the HALT keeps its existing `plan-gap` classification and wording
- Given a validation-group member halts for a human, when the group outcome is committed, then completed sibling steps keep their own verdicts unchanged

#### Negative Paths
- Given a build_review raw verdict is FAIL, when post-join adjudication produces a valid newly
  actionable BUILD work order, then the routing, kickback counting, lap accounting, and absence of a
  refusal behave exactly as on current main for the one actual route
- Given a build_review raw verdict is FAIL but every valid case is deferred, rejected, merged, or
  already operator-resolved, when the effective outcome settles, then no BUILD kickback is recorded
  and the judging step is not mislabeled `refused`
- Given a validation step's runner itself crashes, when retries exhaust, then that step is recorded `failed`, not `refused`

### Done When
- [ ] A unit test drives an as-built plan-gap halt and asserts the judging step reads `refused`, the HALT class is unchanged, and sibling statuses are untouched
- [ ] A regression test asserts a newly actionable build_review outcome still routes to build with
      unchanged per-route kickback-ledger counts; a handled non-action outcome records no route and no
      refusal

## Story 4: Refusals are visible on the event spine and in operator rendering

**Requirement:** O1

As an operator, I want every refusal emitted as a `step_refused` event and rendered distinctly,
so that telemetry and status displays tell refusals apart from failures.

### Acceptance Criteria

#### Happy Path
- Given any of the three refusal sites fires, when the halt is written, then a `step_refused` event with the step name, a refusal kind, and the reason is persisted to `.pipeline/events.jsonl`
- Given a `step_refused` event exists, when the event sink registry is compiled, then the member declares render, persist, and audit sinks exhaustively
- Given a step is `refused`, when `conduct daemon status` or the report renderer displays the feature, then the step is shown as refused, not failed

#### Negative Paths
- Given a refusal fires, when the spine is inspected, then no sidecar file, ad-hoc log, or second ledger carries the refusal record
- Given an event sink registry entry for `step_refused` is removed, when the engine compiles, then compilation fails (exhaustiveness holds)

### Done When
- [ ] `step_refused` is a member of the `ConductorEvent` union with a complete sink-registry row, proven by a compile-time exhaustiveness test
- [ ] A renderer test asserts a refused step displays distinctly from a failed step

## Story 5: Clearing a refusal halt is enough to resume

**Requirement:** O2

As an operator, I want the feature to resume to the refused step after I clear the halt, so that
I never hand-edit `conduct-state.json`.

### Acceptance Criteria

#### Happy Path
- Given a step reads `refused` and its HALT markers are removed, when the conductor re-runs, then the resume entry admits that step and dispatches it with no state hand-edit
- Given earlier steps are `done` and one step is `refused`, when prerequisites are evaluated, then `refused` does not satisfy the prerequisite predicate and the refused step re-runs

#### Negative Paths
- Given a step reads `refused`, when resume entry derivation runs, then no status is mutated by the resume path itself
- Given `--from-step` names a later step, when the operator forces entry there, then the existing `--from-step` exemption behaves exactly as on current main

### Done When
- [ ] An integration test refuses a step, clears the HALT files, re-runs the conductor with the same state, and asserts the refused step is dispatched without any state edit
- [ ] `stepSatisfied` counts exactly `done | skipped | stale` before and after the change

## Story 6: A residual gate-blocked exit halts naming the prerequisite and its status

**Requirement:** O3

As an operator, I want a run that exits because a prerequisite is unsatisfied to halt telling me
which prerequisite and what status caused it, so that I can act without reading the event log.

### Acceptance Criteria

#### Happy Path
- Given a step's prerequisite is unsatisfied and no runnable prerequisite exists to dispatch, when the loop exits, then a `needs-human` HALT is written whose reason names each unsatisfied prerequisite and that prerequisite's recorded status
- Given such a halt is written, when the persisted spine is read, then the `loop_halt` event carries the same step and the `gate_blocked` event precedes it

#### Negative Paths
- Given an unsatisfied prerequisite is itself runnable, when the loop evaluates it, then the loop dispatches the prerequisite as on current main and writes no gate-blocked HALT
- Given the loop exits for a reason other than a blocked gate, when the backstop HALT is written, then its wording is unchanged from current main

### Done When
- [ ] A unit test blocks a step on a `failed` prerequisite with no runnable predecessor and asserts the HALT text contains the prerequisite name and the word naming its status
- [ ] The generic "loop exited without a terminal verdict" wording no longer appears for gate-blocked exits

## Story 7: A genuine failure still fails and blocks dependents

**Requirement:** O4

As a maintainer, I want real failures untouched, so that the refusal lane cannot mask a broken
build.

### Acceptance Criteria

#### Happy Path
- Given a step's provider work fails on every retry with no refusal condition present, when retries exhaust, then the step is recorded `failed`, a `step_failed` event is emitted, and its dependents remain blocked
- Given a step is `failed`, when a dependent's gate is checked, then the gate refuses entry exactly as on current main

#### Negative Paths
- Given provider output text contains the word "refused", when the outcome is classified, then classification uses only the typed facet and the step is recorded `failed`
- Given a refusal facet and a work failure cannot both be true for one attempt, when the handler receives a result, then exactly one of `refused` or `failed` is recorded

### Done When
- [ ] Existing retry/escalation tests pass unchanged
- [ ] A test feeds refusal-like provider output text through the failure path and asserts status `failed` with no `step_refused` event
