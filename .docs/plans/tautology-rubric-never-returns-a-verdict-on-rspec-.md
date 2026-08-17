# Implementation Plan: Framework-agnostic tautology scoped-run classification (#1682)

**Date:** 2026-08-17
**Design:** .docs/decisions/adr-2026-08-17-framework-agnostic-tautology-scoped-run.md
**Stories:** .docs/stories/tautology-rubric-never-returns-a-verdict-on-rspec-.md
**Conflict check:** Clean as of 2026-08-17

## Summary

Delete the Vitest/pytest output-regex classifier from the Tautology counterfactual and classify the
scoped run by process outcome alone; narrow the result and infrastructure-reason unions to what the
engine can justify; relocate the deleted no-executed-test detection into the judging skill; and
retain an infrastructure-failed run's output on the existing event spine. 11 tasks.

## Technical Approach

- **The classifier is deleted, not extended (D1).** `classifyTautologyScopedFailure`
  (`step-runners.ts:191-204`) is removed with its export. `runScopedTautologyCommand`'s `close`
  handler (`:2113-2117`) maps the process outcome directly — signal, exit 0, else `nonzero-exit` —
  so no code path reads stdout or stderr to decide what happened.
- **The unions narrow together (D2).** `TautologyScopedRunResult` loses `no-tests` and
  `collection-failure`; `test-failure` becomes `nonzero-exit`. `scopedRunFailure` then covers only
  `launch-error`/`timeout`/`signal`, and the infrastructure `reason` union drops
  `scoped-run-no-tests` and `scoped-run-collection-failed` while retaining `scoped-run-failed` for
  the thrown-execution path. The scoped-run branch's exclusion
  (`build-review-tautology-preflight.ts:407`) simplifies to a single non-`nonzero-exit` test.
- **Evidence follows the union (D3).** `TautologyScopedRunEvidence.runKind` becomes
  `'passed' | 'nonzero-exit'`; the `runKind` assignment at `:421` needs no logic change once the
  union is narrowed. `failureExcerpt` on judged runs is untouched.
- **The judging skill absorbs the one interpretive question (D4).**
  `skills/build-review-tautology/SKILL.md` gains the no-executed-test rule in its Judgement section
  and its documented `runKind` values are corrected. Prose stays provider-neutral — no slash command,
  no host tool name, no model parameter — so `test/test_provider_skill_contracts.sh` passes.
- **The infrastructure excerpt rides the existing event (D5).** The `failure()` helper
  (`:261-268`) takes an optional excerpt; the scoped-run infrastructure branch passes
  `boundedHeadTailExcerpt` of the combined output. `preflightProjection`'s infrastructure branch
  (`build-review-coordinator.ts:129-141`) carries it, and the coordinator's emit at `:245` adds it to
  the `build_review_rubric_infrastructure_failure` event, whose variant in `types/events.ts:151`
  gains one optional field. No new event type, no sidecar, no ledger.
- **Order of operations.** Tasks 1–2 narrow the type surface and make the compiler name every call
  site; Task 3 deletes the classifier; Tasks 4–5 pin the surviving behavior; Tasks 6–8 add the
  excerpt; Tasks 9–10 land the skill and documentation; Task 11 verifies the whole boundary.

## Prerequisites

- `adr-2026-08-17-framework-agnostic-tautology-scoped-run` is APPROVED.
- Stories carry `Status: Accepted`; conflict-check has zero blocking conflicts.
- Tests follow `.agents/skills/write-tests/SKILL.md`: narrowest seam, injected boundaries, isolated
  temporary roots, awaited cleanup, and no real LLM, GitHub, registry, network, or test-runner calls.
  The scoped run is already an injected dependency (`TautologyPreflightDependencies.runScoped`), so
  every case below is driven through that seam with a fake.

## Tasks

### Task 1: Narrow the scoped-run result union to process outcomes
**Story:** Story 2 — happy path (the surviving members are exactly the observable process outcomes)
**Type:** infrastructure

**Steps:**
1. Write a failing type-level and runtime test asserting the preflight accepts a `nonzero-exit`
   result and that `no-tests`/`collection-failure` are no longer constructible members.
2. Verify the focused preflight test fails (RED).
3. Replace `no-tests`, `collection-failure`, and `test-failure` in `TautologyScopedRunResult` with a
   single `nonzero-exit` member carrying `exitCode`, `stdout`, `stderr`; update the doc comments so
   they describe an exit code rather than an assertion.
4. Verify the focused preflight test passes (GREEN).
5. Commit with message: "refactor(build-review): narrow the tautology scoped-run union to process outcomes"

**Files likely touched:**
- src/conductor/src/engine/build-review-tautology-preflight.ts — result union + comments
- src/conductor/test/engine/build-review-tautology-preflight.test.ts — union cases

**Dependencies:** none

### Task 2: Drop the output-derived infrastructure reasons
**Story:** Story 2 — negative path (no removed reason remains reachable)
**Type:** negative-path

**Steps:**
1. Write a failing test asserting `scopedRunFailure` maps only launch/timeout/signal, and that a
   `nonzero-exit` result never produces an infrastructure reason.
2. Verify the focused test fails (RED).
3. Remove `scoped-run-no-tests` and `scoped-run-collection-failed` from the infrastructure `reason`
   union; reduce `scopedRunFailure`'s switch to the three process-level kinds; simplify the
   scoped-run branch's exclusion to a single non-`nonzero-exit` test and update its comment to state
   the exit-code contract and the retained `#1593` reasoning.
4. Verify the focused test passes (GREEN).
5. Commit with message: "fix(build-review): remove the output-derived tautology infrastructure reasons"

**Files likely touched:**
- src/conductor/src/engine/build-review-tautology-preflight.ts — reason union, `scopedRunFailure`, scoped-run branch
- src/conductor/test/engine/build-review-tautology-preflight.test.ts — reason mapping tests

**Dependencies:** 1

### Task 3: Delete the output classifier and classify by exit code
**Story:** Story 1 — happy path (RSpec, go test, JUnit, and unstructured output all classify alike)
**Type:** happy-path

**Steps:**
1. Write a failing table test driving real RSpec (`N examples, M failures`), `go test`, Vitest,
   pytest, and unstructured failure output through the scoped-run seam, asserting one identical
   `nonzero-exit` outcome for all five, plus exit 0 yielding the success variant.
2. Verify the table test fails (RED).
3. Delete `classifyTautologyScopedFailure` and its export; map `runScopedTautologyCommand`'s `close`
   handler directly — received signal to `signal`, code 0 to the success variant, otherwise
   `nonzero-exit` — and drop the now-unused import.
4. Verify the table test passes (GREEN).
5. Commit with message: "fix(build-review): classify the tautology counterfactual by exit code on every runner"

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts — classifier deletion, `close` handler, imports
- src/conductor/test/engine/build-review-tautology-preflight.test.ts — cross-runner table test

**Dependencies:** 2

### Task 4: Pin the surviving infrastructure paths
**Story:** Story 2 — happy path (launch, timeout, signal, and thrown execution each keep their reason)
**Type:** negative-path

**Steps:**
1. Write failing table tests producing each of `scoped-run-launch-failed`, `scoped-run-timeout`,
   `scoped-run-signaled`, and `scoped-run-failed`, and asserting each output-free infrastructure
   reason (no changed tests, no production changes, missing scoped configuration, materialization
   failure, missing merge-base file, abort, cleanup failure, cache read/write failure) is unchanged.
2. Verify the table fails (RED) where behavior drifted, and passes where it did not.
3. Make any correction the table exposes; no behavior change is expected here beyond the narrowed
   union.
4. Verify every table row passes (GREEN).
5. Commit with message: "test(build-review): pin the surviving tautology infrastructure reasons"

**Files likely touched:**
- src/conductor/test/engine/build-review-tautology-preflight.test.ts — infrastructure reason table
- src/conductor/src/engine/build-review-tautology-preflight.ts — corrections only if the table exposes drift

**Dependencies:** 3

### Task 5: Narrow the projected runKind value set
**Story:** Story 1 — happy path (evidence carries `nonzero-exit`/`passed`)
**Type:** happy-path

**Steps:**
1. Write a failing test asserting `TautologyScopedRunEvidence.runKind` is `passed` on a green
   counterfactual and `nonzero-exit` on a failing one, and that the failing case carries a non-empty
   bounded `failureExcerpt` while the green case carries an empty one.
2. Verify the focused test fails (RED).
3. Narrow `runKind` to `'passed' | 'nonzero-exit'`.
4. Verify the focused test passes (GREEN).
5. Commit with message: "refactor(build-review): narrow tautology runKind to the exit-code contract"

**Files likely touched:**
- src/conductor/src/engine/build-review-tautology-preflight.ts — evidence interface
- src/conductor/test/engine/build-review-tautology-preflight.test.ts — evidence shape tests

**Dependencies:** 4

### Task 6: Carry a bounded excerpt on scoped-run infrastructure failures
**Story:** Story 4 — happy path (launch, timeout, and signal results retain their output)
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a launch, timeout, and signal infrastructure result each carry a
   bounded head+tail `failureExcerpt` of the combined stdout and stderr, truncated with the explicit
   marker when over the cap.
2. Verify the focused test fails (RED).
3. Add the optional `failureExcerpt` to the infrastructure-failure result; give `failure()` an
   optional excerpt parameter; pass `boundedHeadTailExcerpt` of the combined output from the
   scoped-run infrastructure branch.
4. Verify the focused test passes (GREEN).
5. Commit with message: "feat(build-review): retain scoped-run output on tautology infrastructure failures"

**Files likely touched:**
- src/conductor/src/engine/build-review-tautology-preflight.ts — result type, `failure()`, scoped-run branch
- src/conductor/test/engine/build-review-tautology-preflight.test.ts — excerpt retention tests

**Dependencies:** 5

### Task 7: Fabricate no excerpt for output-free infrastructure reasons
**Story:** Story 4 — negative path (nothing is invented where no runner ran)
**Type:** negative-path

**Steps:**
1. Write failing table tests asserting the excerpt field is absent for no-changed-tests,
   no-production-changes, missing-scoped-configuration, materialization-failed,
   missing-merge-base-file, aborted, cleanup-failed, cache-read-failed, and cache-write-failed.
2. Verify the table fails (RED).
3. Ensure `failure()` omits the field entirely rather than emitting an empty string when no excerpt
   is supplied.
4. Verify every table row passes (GREEN).
5. Commit with message: "fix(build-review): omit the excerpt where no scoped run produced output"

**Files likely touched:**
- src/conductor/src/engine/build-review-tautology-preflight.ts — `failure()` omission semantics
- src/conductor/test/engine/build-review-tautology-preflight.test.ts — absence table

**Dependencies:** 6

### Task 8: Emit the excerpt on the existing spine event
**Story:** Story 4 — happy path (the excerpt reaches `.pipeline/events.jsonl`)
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the coordinator's `build_review_rubric_infrastructure_failure`
   emission for a preflight infrastructure failure carries the excerpt alongside rubric, lap, and
   reason, and that an event without one still parses.
2. Verify the focused coordinator test fails (RED).
3. Add the optional `excerpt` field to the event variant in the `ConductorEvent` union; thread it
   through `preflightProjection`'s infrastructure branch and the coordinator's emit call.
4. Verify the focused coordinator test passes (GREEN).
5. Commit with message: "feat(build-review): carry the tautology infrastructure excerpt on the event spine"

**Files likely touched:**
- src/conductor/src/types/events.ts — one additive optional field
- src/conductor/src/engine/build-review-coordinator.ts — projection branch + emit
- src/conductor/test/engine/build-review-coordinator.test.ts — emission tests

**Dependencies:** 7

### Task 9: State the no-executed-test rule in the judging skill
**Story:** Story 3 — happy path (a run that executed nothing yields a finding, not silent evidence)
**Type:** happy-path

**Steps:**
1. Write a failing contract assertion that the skill states the no-executed-test rule, names its
   outcome as a finding rather than an infrastructure result, and documents `runKind` as
   `passed`/`nonzero-exit`.
2. Verify the assertion fails (RED).
3. Edit `skills/build-review-tautology/SKILL.md`: add the rule to the Judgement section, scoped so it
   never overrides the four closed exceptions and never manufactures a finding from an ambiguous
   excerpt; correct the input-projection paragraph's `runKind` description. Keep the prose
   provider-neutral.
4. Verify the assertion passes (GREEN) and `test/test_provider_skill_contracts.sh` passes.
5. Commit with message: "feat(build-review): judge a counterfactual that executed no test"

**Files likely touched:**
- skills/build-review-tautology/SKILL.md — Judgement section + input projection paragraph
- src/conductor/test/engine/build-review-skill-contract.test.ts — contract assertion

**Dependencies:** 8

### Task 10: Record the exit-code contract in the gate documentation
**Story:** Story 1 — happy path (the documented contract matches the shipped behavior)
**Type:** documentation

**Steps:**
1. Read `docs/explanation/gates.md`'s `build_review` section to place the change beside the existing
   rubric and infrastructure-failure prose.
2. Document that the Tautology counterfactual is classified by exit code with no runner-output
   parsing, that the surviving infrastructure conditions are launch, timeout, and signal, that a
   run which executed no test is a judged finding, and that an infrastructure failure now carries a
   bounded output excerpt on `.pipeline/events.jsonl`.
3. Verify no other page states the removed behavior — re-grep `docs/` for the removed reason strings.
4. Commit with message: "docs: record the exit-code tautology counterfactual contract"

**Files likely touched:**
- docs/explanation/gates.md — build_review gate prose

**Dependencies:** 9

### Task 11: Verify the boundary and the removed surface
**Story:** Story 2 — negative path (no removed string survives anywhere)
**Type:** verification

**Steps:**
1. Run a repository-wide search for `classifyTautologyScopedFailure`, `collection-failure`,
   `no-tests`, `scoped-run-no-tests`, `scoped-run-collection-failed`, and `test-failure` across
   `src/`, `skills/`, `docs/`, and `.agents/`; assert no occurrence remains outside historical
   `.docs/` records.
2. Run the conductor test suite and `test/test_harness_integrity.sh` in full.
3. Confirm the preflight invokes `runScoped` exactly once per materialization, so the accepted
   single-execution contract is preserved.
4. Commit with message: "test: verify the tautology classifier surface is fully removed"

**Files likely touched:**
- none expected — verification only; corrections land in the task that owns the surface

**Verify-only:** yes

**Dependencies:** 10

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 3 ─▶ Task 4 ─▶ Task 5 ─▶ Task 6 ─▶ Task 7 ─▶ Task 8 ─▶ Task 9 ─▶ Task 10 ─▶ Task 11
```

## Integration Points

- After Task 3: the classifier is gone and every runner classifies identically; the cross-runner
  table test is the proof and can be run in isolation.
- After Task 5: the evidence shape the judging skill consumes is final, so the projection and the
  skill can be exercised against a stable contract.
- After Task 8: the evidence-retention half is complete end to end — result, projection, event,
  persisted ledger.
- After Task 11: the removed surface is proven absent and the full gate boundary is exercised.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No second `test_suite` invocation is introduced
- [ ] Default tests fake every third-party boundary; no real test runner, LLM, GitHub, or network
      call is added
