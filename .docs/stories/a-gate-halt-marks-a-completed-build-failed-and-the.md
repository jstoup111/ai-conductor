**Status:** Accepted

# Stories: A gate halt marks a completed build failed, and the residue blocks every later resume

Source: jstoup111/ai-conductor#1753. Track: technical. Tier: M.
Scope boundary (binding): every pre-dispatch refusal — protected-artifact seal, missing-worktree preflight, self-host live boundary — is one typed refused outcome that never stamps the step `failed`; resume entry always lands on a step the prerequisite gate admits; a residual prerequisite-gate halt names the prerequisite and its status; genuine step failures keep `failed`. Excluded: seal/live-boundary detection rules, task-status counter desync, daemon re-kick policy.

Outcome ids used below: O1 refusal never records failed; O2 resume needs no hand-edit; O3 gate block names the prerequisite and its status; O4 genuine failure still fails and blocks.

## Story 1: A protected-artifact seal refusal leaves the step's status untouched

**Requirement:** O1

As an operator, I want a seal refusal on a BUILD/SHIP step to halt without recording that step as failed, so that a completed build is not rewritten as a failure by an environmental check.

### Acceptance Criteria

#### Happy Path
- Given `build` is `done` in `conduct-state.json` and the seal verdict for the next dispatch is `ok: false`, when the step is dispatched, then the run halts with the seal reason and `build` remains `done`
- Given `build` is `pending` and the seal verdict is `ok: false` on attempt 1, when the attempt ends, then `build` remains `pending` and no `step_failed` event is emitted
- Given the seal refuses on attempt 2 or later, when the attempt ends, then the HALT marker carries the `protected-artifact` class and the seal reason, exactly as today

#### Negative Paths
- Given the seal verdict is `ok: true`, when the step is dispatched, then the provider runs and the step's result is recorded exactly as before (no refused facet set)
- Given the dispatched build's own work fails on every retry, when retries are exhausted, then `build` is recorded `failed` and a `step_failed` event is emitted
- Given the seal refuses, when the refusal is recorded, then no `saveConductorStepStatus` call for that step occurs on the refusal path (asserted via the mutation-port spy)

### Done When
- [ ] A unit test dispatches a BUILD step with `build = done` and an `ok: false` seal verdict and asserts `conduct-state.json` still reads `build: done` and `events.jsonl` has no `step_failed` for `build`
- [ ] The refusal is carried as a typed facet on `StepRunResult` (no string match on `output`) and the existing seal HALT class and wording are unchanged

## Story 2: Missing-worktree and live-boundary refusals use the same typed refused outcome

**Requirement:** O1

As a maintainer, I want all three pre-dispatch refusals to terminate through one typed outcome, so that a future refusal site cannot fall into the failed stamp by omission.

### Acceptance Criteria

#### Happy Path
- Given the feature worktree directory is absent, when any step is dispatched, then the run halts with the missing-worktree reason and the step's prior status is unchanged
- Given a self-host live-boundary verdict of `ok: false` is pending at a dispatch boundary, when the boundary is reached, then the run halts with that reason and the completed step keeps its prior `done` status
- Given any of the three refusals fires, when the halt is written, then a `retry_decision` event with `decision: 'route'` and `signal: 'refused'` (or the equivalent persisted spine record chosen by the plan) is emitted for that step

#### Negative Paths
- Given the worktree directory exists and the live boundary is `ok: true`, when the step is dispatched, then no refused facet is set and the step runs normally
- Given a refusal fires, when the run halts, then the HALT class is one of the existing closed set (`needs-human`, `mechanical`, `protected-artifact`) and no new class value appears in `HALT.class`
- Given a refusal fires, when `events.jsonl` is read back, then the refusal record is on the engine's spine file and no sidecar or second ledger was written

### Done When
- [ ] One test per refusal site asserts: prior status unchanged, HALT written, spine event present, no `step_failed`
- [ ] `StepRunResult` exposes a single refused facet (or discriminated `kind`) shared by the three sites, and the three early-return shapes route through one handler

## Story 3: Resume after a cleared refusal halt lands on the first admitted step

**Requirement:** O2

As an operator, I want clearing a refusal halt to be enough for the feature to resume to its next step, so that I never hand-edit `conduct-state.json`.

### Acceptance Criteria

#### Happy Path
- Given `build = done`, `build_review = stale`, `test_suite = stale` and the HALT markers are removed, when the daemon re-dispatches, then the run enters `test_suite` (or the earliest non-done step its gate admits) and dispatches it
- Given `build = failed` and every downstream step is `stale` or `pending`, when the run resumes without a verdict clamp firing, then the start index is walked backward to `build` and `build` is dispatched rather than `test_suite` being gate-blocked
- Given `--from-step` is supplied, when the run starts, then the walk-back is not applied and the requested step is targeted exactly as today

#### Negative Paths
- Given the walk-back runs, when resume entry completes, then `conduct-state.json` has the same bytes as before entry (resume never mutates state)
- Given the candidate index already passes its gate, when the walk-back runs, then the index is unchanged (the walk never moves forward)
- Given a pinning test for the unclamped resume path passes on the unmodified engine, when the story is implemented, then the resume-entry change is omitted and an intake issue records the unexplained observed jump (the ~60% hypothesis in the review is not baked in)

### Done When
- [ ] A test reproduces the issue's state (`build: failed`, downstream `stale`, no clamp) on the unmodified engine and fails with a `gate_blocked` on `test_suite`; the same test passes after the change with `build` dispatched
- [ ] `checkGate`, `stepSatisfied`, and `gateSatisfied` are byte-for-byte unchanged

## Story 4: A residual prerequisite-gate halt names the prerequisite and the status that blocked it

**Requirement:** O3

As an operator, I want the halt that follows a blocked prerequisite gate to say which prerequisite was unsatisfied and what its status was, so that the operator-visible output points at the real cause.

### Acceptance Criteria

#### Happy Path
- Given `test_suite` is selected, `build = failed`, and `build` itself is not runnable because its own prerequisite is unsatisfied (so the walk-back has no admitted step), when the gate blocks, then the HALT text contains `test_suite`, `build`, and `failed` in a single reason line
- Given a gate blocks on two prerequisites, when the HALT is written, then every unsatisfied prerequisite is named with its status
- Given the gate-blocked HALT is written, when the daemon classifies it, then `HALT.class` reads `needs-human`

#### Negative Paths
- Given the selected step has an unsatisfied prerequisite that is runnable, when selection happens, then the prerequisite is dispatched and no gate-blocked HALT is written (the common path is unchanged)
- Given the breadcrumb or state is unreadable when the backstop assembles the reason, when the HALT is written, then it still contains a classifiable reason and the marker is present
- Given the finally-backstop fires for a reason other than a blocked gate, when the HALT is written, then the existing "loop exited without a terminal verdict" wording is preserved

### Done When
- [ ] A test drives the markerless `gate_blocked` return and asserts the HALT body matches `/Prerequisite .*build.* \(status: failed\)/` and `HALT.class` is `needs-human`

## Story 5: A genuinely failed build still records failed and blocks its dependents

**Requirement:** O4

As a maintainer, I want the refused outcome to be impossible to reach from a provider failure, so that real failures keep their gating semantics.

### Acceptance Criteria

#### Happy Path
- Given the seal is `ok: true` and the build provider returns `success: false` on every attempt, when retries are exhausted, then `build = failed`, a `step_failed` event is emitted, and the build-outcome record carries `terminalOutcome: 'failed'`
- Given `build = failed` from a genuine failure, when `test_suite` is selected, then its gate does not admit it until `build` is re-run

#### Negative Paths
- Given a provider result whose `output` text contains the literal seal reason string, when the result is handled, then it is treated as an ordinary failure (the refused facet is never derived from output text)
- Given the build provider throws, when the exception is caught, then the existing catch path stamps `failed` and writes its HALT exactly as before

### Done When
- [ ] Existing retry/escalation and build-outcome tests pass unchanged
- [ ] A test feeds a provider `success: false` result whose output equals a seal reason and asserts `build: failed` and `step_failed` emitted
