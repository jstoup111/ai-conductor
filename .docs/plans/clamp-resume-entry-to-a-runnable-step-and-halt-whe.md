# Implementation Plan: Clamp the resume entry to a runnable step

**Date:** 2026-09-06
**Stories:** .docs/stories/clamp-resume-entry-to-a-runnable-step-and-halt-whe.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the approved verdict-aware-resume contract — a backward-only clamp on the local start index, no state mutation at resume, and `checkGate` as the loop's single entry predicate.

## Summary

Three bounded tasks deliver #1717 by reconciling the resume entry index against the loop's own entry gate on every resume instead of only when the verdict clamp moves it, and by failing closed with a named terminal halt when no dispatchable entry exists. Kickback restaging policy, the downstream-stale cascade, `--from-step` navigation, the in-loop tail selector, and operator recovery tooling are outside this slice.

## Technical Approach

The defect is a conditional, not a missing predicate. In `Conductor.run`'s resume branch the candidate index comes from `findResumeIndex`; the verdict clamp and the backward prerequisite walk then run only inside the `earliestGateIdx < startIndex` guard. When the earliest verdict-unsatisfied gate is not strictly before the candidate — the two predicates agree, or the verdict read threw and no clamp is available — the candidate is handed to the loop unreconciled. The loop's very next act is `checkGate` on that step; when an earlier prerequisite is `pending`, `failed`, or `in_progress` the gate refuses, and because the existing halt at that site fires only when no unsatisfied prerequisite is `pending`, the run returns with no DONE or HALT marker. The daemon backstop parks it, and every re-kick reproduces the identical exit because nothing about the derivation changed. The in-loop tail selector already avoids this by applying the same walk unconditionally to its selection.

Add one exported resolution helper beside the existing backward walk in the same engine module: given the resolved step list, the state, and a candidate index, it returns either a runnable entry index or a blocked outcome carrying the wanted step and each unsatisfied prerequisite paired with its recorded status. It introduces no third authority — it calls the existing bounded backward walk and then the existing entry-gate check, both of which read state only. A candidate past the last step is a terminal no-op resume and stays runnable, never blocked.

Rewire the resume branch to compute a single candidate — the verdict clamp's earliest unsatisfied gate when it is strictly earlier, otherwise the state-derived index — and pass that candidate through the resolver on every resume. A runnable result that differs from the state-derived index goes through the existing decide-entry disposition with the existing resume-clamp source gate and the verdict-derived satisfaction input, which preserves today's behavior exactly for the case the verdict clamp already handled and extends the same protection to entries the reconciliation alone moves; an empty verdict map is used when the verdict read failed. A blocked result writes the existing needs-human halt marker and emits the existing loop-halt event, then returns, so the resume ends with a terminal verdict naming the inconsistency instead of a markerless exit. Movement stays backward-only and bounded by the step count, so forward behavior — never entering a step ahead of an unsatisfied gate, and the unchanged fast-forward when every gate is satisfied — is untouched.

The blocked outcome is a fail-closed guard rather than an ordinary path: with the built-in registry every prerequisite precedes its dependent, so the bounded walk always terminates on a step whose gate passes. It becomes reachable when a resolved list cannot locate a prerequisite or resolves one in a cycle — the malformed-registry case the existing walk's own contract already anticipates by returning its candidate unchanged. Its proof therefore belongs at the resolver seam with a synthetic step list, while the dispatch behavior is proved through the real production entry point.

Tests follow the local test-design rules and the acceptance file that already owns this seam: resume selection itself is the subject, so driving `Conductor.run` with resume is correct there, with an injected tracking step runner, injected step statuses and gate verdicts under a temporary root, and no real provider, network, or process. Pure resolution cases — pass-through, backward movement, blocked, past-the-end — belong at unit level against hand-built step lists. Each resume fixture pre-resolves the steps it does not exercise and terminates at the first dispatch observation. No exact-copy pattern declaration applies; the existing fixtures in that acceptance file are the semantic pattern for state seeding, verdict seeding, and the tracking runner.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/conductor.ts:5789` derives the resume candidate from `findResumeIndex`, whose branches are first `in_progress` and otherwise last-done + 1.
- Verified: `src/conductor/src/engine/conductor.ts:5852` guards the verdict clamp, the backward walk, and the decide-entry disposition behind `resumeClamp.earliestGateIdx < startIndex`, and the verdict read at that site swallows its errors and leaves the clamp undefined.
- Verified: `clampToRunnablePrerequisite` at `src/conductor/src/engine/conductor.ts:12743` is exported, backward-only, bounded by the step count, consumes `checkGate`, and returns its candidate unchanged when no earlier unsatisfied prerequisite can be located; the tail selector applies it unconditionally at line 12117.
- Verified: `stepSatisfied` in `src/conductor/src/engine/state.ts:222` treats `done`, `skipped`, and `stale` as satisfied, so an entry gate refuses only on a `pending`, `failed`, or `in_progress` prerequisite; `getStepStatus` at line 207 defaults an absent key to `pending`.
- Verified: the loop's gate refusal at `src/conductor/src/engine/conductor.ts:7844` emits `gate_blocked` and writes a halt only when every unsatisfied prerequisite is non-pending, and otherwise returns with no terminal marker.
- Verified: `checkGate` in `src/conductor/src/engine/gates.ts` accepts a step definition directly and returns the unsatisfied prerequisite names, so a synthetic step list needs no registry entry.
- Verified: `writeHaltMarker` with the needs-human class and `emitLoopHalt` are existing private members used by the neighboring halt paths; `readAllVerdicts` is exported from the gate-verdict module and `StepStatus` from the shared step types.
- Verified: `src/conductor/test/engine/resume-verdict-clamp.test.ts` already drives `Conductor.run` with resume against a temporary root, seeds step statuses and verdicts directly, and asserts first-dispatch and halt-marker text.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no new channel — the existing halt marker and loop-halt event carry the outcome.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in this worktree; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Resolve a resume entry against the loop's entry gate
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests against hand-built step lists for four cases: a candidate whose gate passes is returned unchanged; a candidate refused by an earlier dispatchable prerequisite returns that prerequisite's index; a candidate whose unsatisfied prerequisite is absent from the list or sits at or after it returns a blocked outcome carrying the wanted step name and each unsatisfied prerequisite paired with its recorded status; a candidate past the last index returns a runnable no-op.
2. Verify the new cases fail (RED).
3. Implement an exported entry resolver beside the existing backward walk in the engine module. Call the existing bounded backward walk first, then the existing entry-gate check on the resulting step, and map the refusal's unsatisfied prerequisite names to their recorded statuses. Add no new satisfaction predicate and read no files.
4. Verify the new cases pass (GREEN), then run the repository's narrowest invocation for this test file plus the typecheck target that covers test files, and commit.

**Done when:**
1. The entry resolver returns the candidate unchanged when its gate passes, and returns the earliest dispatchable earlier prerequisite when the gate refuses.
2. The entry resolver returns a blocked outcome naming the wanted step and each unsatisfied prerequisite with its recorded status when no earlier prerequisite can resolve the gate.
3. The entry resolver treats a candidate past the last step as a runnable no-op rather than a blocked outcome.
4. The resolver introduces no satisfaction predicate of its own: it consumes only the existing bounded backward walk and the existing entry-gate check.

### Task 2: Reconcile every resume entry, not only clamped ones
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing acceptance cases driving the real conductor entry point with resume against a temporary root: a state whose last resolved step sits after a re-opened earlier gate so the derived entry is refused while an earlier prerequisite is dispatchable, asserting the earlier prerequisite is the first dispatched step and that the run does not end with zero dispatches; the same shape with an unreadable verdict directory; a fully satisfied fixture asserting the entry is unchanged and no earlier resolved step re-runs; a daemon fixture whose reconciliation lands on an ungranted DECIDE-phase step, asserting the existing decide-entry halt text and no dispatch.
2. Verify the new cases fail (RED).
3. In the resume branch, compute one candidate — the verdict clamp's earliest unsatisfied gate when it is strictly before the state-derived index, otherwise that index — and pass it through the Task 1 resolver unconditionally. Keep the existing decide-entry disposition call for a runnable result that differs from the state-derived index, passing the verdict-derived satisfaction input and an empty verdict map when the verdict read failed, and keep the existing tree-attesting re-check ahead of it.
4. Verify the new cases pass (GREEN), then run the repository's narrowest invocation for this test file and the neighboring resume and terminal-marker acceptance files together, plus the typecheck target that covers test files, and commit.

**Done when:**
1. A resume whose derived entry gate is refused while an earlier prerequisite is dispatchable dispatches that prerequisite as its first step.
2. A resume fixture whose re-opened build sits behind a later step still recorded resolved dispatches build as its first step.
3. A resume whose derived entry gate already passes enters that same index and re-runs no earlier resolved step.
4. A resume whose verdict directory cannot be read reconciles from step state alone and dispatches a step instead of ending with zero dispatches.
5. A daemon resume reconciled onto an ungranted DECIDE-phase step ends on the existing decide-entry halt text with no step dispatched.

### Task 3: Halt with the named blockage when no entry can be dispatched
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing tests for the halt path: invoke the resume branch's blocked handling with a blocked resolution and assert the halt marker file names the wanted step and each blocking prerequisite with its recorded status, that the needs-human class is used, that the loop-halt event carries the same reason, and that no step is dispatched; add assertions to a dispatchable resume fixture and to a past-the-end converged fixture that no halt marker file exists afterward.
2. Verify the new cases fail (RED).
3. Implement the blocked branch in the resume entry: render one reason sentence naming the step the resume wanted and each unsatisfied prerequisite with its recorded status, write it through the existing needs-human halt marker helper, emit it through the existing loop-halt event, and return before the loop starts. Reuse the neighboring halt paths' shape; add no new event type, marker file, or state field.
4. Verify the new cases pass (GREEN), then run the repository's narrowest invocation for this test file plus the typecheck target that covers test files, and commit.

**Done when:**
1. A blocked entry resolution writes a needs-human halt marker naming the wanted step and each blocking prerequisite with its recorded status.
2. A blocked entry resolution dispatches no step and ends the run through that halt rather than through a return that leaves no terminal marker.
3. A dispatchable resume fixture and a past-the-end converged resume fixture each leave no halt marker behind.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a resumed feature whose state-derived entry step is refused by its own entry gate while an earlier prerequisite is itself dispatchable, when the conductor resumes, then it dispatches that earlier prerequisite rather than ending the run with nothing dispatched. | 1, 2 | "A resume whose derived entry gate is refused while an earlier prerequisite is dispatchable dispatches that prerequisite as its first step." | diff-local |
| Story 1 happy: Given a resumed feature whose re-opened build sits behind later steps still recorded resolved, when the conductor resumes, then the first dispatched step is build. | 2 | "A resume fixture whose re-opened build sits behind a later step still recorded resolved dispatches build as its first step." | diff-local |
| Story 1 happy: Given a resumed feature whose state-derived entry step's own gate already passes, when the conductor resumes, then it enters that same step and re-runs no earlier resolved step. | 1, 2 | "A resume whose derived entry gate already passes enters that same index and re-runs no earlier resolved step." | diff-local |
| Story 1 negative: Given a resumed feature with no readable gate verdicts and an entry step its gate refuses, when the conductor resumes, then it reconciles the entry from step state alone and dispatches a step whose gate passes. | 2 | "A resume whose verdict directory cannot be read reconciles from step state alone and dispatches a step instead of ending with zero dispatches." | diff-local |
| Story 1 negative: Given a daemon resume whose reconciliation moves the entry back onto a DECIDE-phase step with no operator grant, when the conductor resumes, then it halts through the existing decide-entry disposition and dispatches nothing. | 2 | "A daemon resume reconciled onto an ungranted DECIDE-phase step ends on the existing decide-entry halt text with no step dispatched." | diff-local |
| Story 2 happy: Given a resume whose entry gate is still unsatisfied after backward reconciliation, when the conductor resumes, then it writes a terminal needs-human halt whose text names the step it wanted and every unsatisfied prerequisite with that prerequisite's recorded status. | 1, 3 | "A blocked entry resolution writes a needs-human halt marker naming the wanted step and each blocking prerequisite with its recorded status." | diff-local |
| Story 2 happy: Given that same resume, when the conductor resumes, then it dispatches no step and ends through that halt rather than through a return that leaves no terminal marker. | 3 | "A blocked entry resolution dispatches no step and ends the run through that halt rather than through a return that leaves no terminal marker." | diff-local |
| Story 2 negative: Given a resume whose reconciled entry gate passes, when the conductor resumes, then no halt marker is written for the entry decision. | 3 | "A dispatchable resume fixture and a past-the-end converged resume fixture each leave no halt marker behind." | diff-local |
| Story 2 negative: Given a resume whose derived entry is past the last step because the feature already converged, when the conductor resumes, then no halt marker is written and no step is dispatched. | 1, 3 | "A dispatchable resume fixture and a past-the-end converged resume fixture each leave no halt marker behind." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: every fixture seeds its own temporary project root, step statuses, and gate verdicts, and no criterion depends on a commit outside this diff. Task 1 owns the pure resolution cases at unit level against hand-built step lists, including the blocked outcome, which the built-in step registry cannot produce because every built-in prerequisite precedes its dependent. Task 2 owns the cross-boundary integration proof through the real production resume entry point, observing the first dispatched step and the absence of a zero-dispatch run. Task 3 owns the halt outcome at the same resume seam plus the no-false-halt assertions on the Task 2 fixtures. The existing acceptance file supplies the unchanged verdict-clamp, fast-forward, and tail-selection coverage; no new aggregate, end-to-end, or external-service test is added, and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
