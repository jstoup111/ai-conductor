# Implementation Plan: Skip a provider candidate whose preparation fails

**Date:** 2026-09-06
**Stories:** .docs/stories/skip-a-provider-candidate-whose-preparation-fails-.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing provider contract and the existing candidate-advancement contract: advancement still requires explicit provider or model unavailability, an ordinary dispatch failure still ends the step, and no verdict, budget, or routing authority changes.

## Summary

Four bounded tasks deliver #1285. The shared candidate executor stops letting a failed pre-dispatch
preparation hook escape as an exception, classifies that candidate as unavailable for the attempt,
and advances to the next declared entry; the skip is recorded through the attempt metadata and the
fallback warning the loop already emits. The step-level retry budget once every candidate is
exhausted, the preparation hook's own capability checks, and run-wide provider disabling are outside
this slice.

## Technical Approach

`executeProviderCandidates` builds one `invoke()` closure per candidate. That closure awaits the
optional preparation hook, then the provider invocation, inside a single `try` whose `finally` tears
down the prepared context and closes the candidate stream observer. A rejection from the preparation
hook therefore unwinds the whole executor: the classifier never runs, the attempt is never recorded,
and the remaining declared candidates are unreachable. That is the entire defect — the reported
Codex isolation error is one thrower among several on the self-host preparation path, and the fix
belongs at the boundary that owns candidate selection, not at any individual thrower.

Add a pure result constructor beside the existing unsupported-capability constructor, mirroring its
shape exactly: a failed result carrying run-scoped provider unavailability, an explicit
invocation-skipped marker, and a reason naming the provider, the underlying preparation failure, and
a recovery action. Reusing that shape is what makes the rest of the machinery work unchanged — the
existing classifier already advances on run-scoped unavailability, the existing attempt-metadata
builder already renders an invocation-skipped result as an uninvoked `unavailable` attempt with a
redacted reason, and the existing fallback warning already names the failed provider and the next
one. No new event, event field, diagnostic sink, or configuration key is introduced; the skip
becomes observable on the spine that already carries every other candidate transition.

Wrap only the preparation await in its own `catch`, returning that constructed result. Returning
from inside the existing `try` still runs its `finally`, so teardown and observer close keep their
current behavior, and a rejection from the provider invocation itself keeps propagating exactly as
today. Classification is deliberately not conditioned on the thrown error's type: any candidate that
cannot be prepared cannot run, so treating every preparation failure as candidate-scoped
unavailability keeps the loop fail-closed — with no usable candidate left, the executor still
returns the existing all-candidates-unavailable failure naming each reason. The synthetic result
never reaches `invokeRuntimeResolved`, which is the only writer of the run-wide unavailable marker,
so a transient preparation failure does not durably disable that provider for a later attempt.

Tests inject provider runtimes and a preparation hook at the existing seams and exercise the real
executor; the file's existing candidate fixtures are the pattern to extend, including the teardown
fixture that already declares two candidates and the fallback-ordering fixture that already captures
transition warnings. One existing test asserts today's rejection behavior and is updated in the task
that changes it, keeping its observer-close and zero-invocation assertions. No test may reach a real
provider, network, or subprocess.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the classification of every preparation failure as candidate unavailability, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/provider-execution.ts:610-656` awaits the optional preparation hook inside the per-candidate `invoke()` closure, whose `finally` tears down the prepared context and closes the candidate stream observer; a rejection there leaves the executor entirely.
- Verified: `src/conductor/src/engine/provider-execution.ts:294-309` advances candidates only for run-scoped provider unavailability and, after the native ladder, model unavailability, and returns nothing when auth, rate-limit, or session-expiry recovery precedence applies.
- Verified: `src/conductor/src/engine/provider-execution.ts:260-271` already constructs a failed, run-scoped, invocation-skipped unavailable result for a provider that cannot honor a required capability, naming the provider and a recovery action.
- Verified: `src/conductor/src/engine/provider-execution.ts:503-505` derives the attempt's invoked flag from the invocation-skipped marker and redacts the failure reason; `:516-527` sets the outcome to `unavailable` and attaches a fallback reason when a next candidate exists.
- Verified: `src/conductor/src/engine/provider-execution.ts:735-760` returns the all-candidates-unavailable failure when no next candidate exists and otherwise emits the provider-fallback transition warning naming the failed provider, the redacted reason, and the next provider.
- Verified: `src/conductor/src/engine/provider-execution.ts:325-349` writes the run-wide unavailable marker only from an attempt that reached the runtime, so a synthetic preparation result cannot durably disable a provider.
- Verified: `src/conductor/src/engine/conductor.ts:5231-5236` throws when the resolved runtime lacks `prepareSelfHostAuth`, `resolveSelfHostExecutable`, or `provisionProviderHome`, and `:5154` installs that hook on the provider-execution context, so it is the reported thrower reaching the closure above.
- Verified: `src/conductor/test/engine/provider-execution.test.ts:479-503` currently asserts the executor rejects when preparation throws, and asserts the observer closes once with no provider invocation; it is the one existing assertion this change inverts.
- Verified: `src/conductor/test/engine/provider-execution.test.ts:661-673` declares two candidates with a preparation hook and asserts teardown order, and `:1442-1500` captures provider-fallback transition warnings; both are the fixture patterns the new cases extend.
- Verified: the approved provider-preparation-supervision ADR requires a provider lacking a required capability to fail closed before invocation, naming the provider and a recovery action, and the approved provider-aware step execution ADR limits advancement to explicit provider or model unavailability; this change satisfies both, so no ADR amendment is in this change set.
- Scope check: consumer-facing engine behavior in the shared candidate executor; no new skill; provider-agnostic because the classification forks on no provider name and reads only the shared invoke-result contract. Event spine: no new channel, no new variant, no new field — the existing attempt callback and fallback warning carry the skip.
- Verify-claims verdict: CLEAR. One bounded assumption is recorded rather than asserted: the only production installer of the preparation hook today is this repository's self-host dispatch, so the corrected fallthrough is exercised in production there first; the executor and its hook are shipped engine surface, which is why the fix is placed at the executor rather than at the self-host thrower.

## Tasks

### Task 1: Construct a preparation-failure unavailability result
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/provider-execution.ts, src/conductor/test/engine/provider-execution.test.ts
**Dependencies:** none

**Steps:**
1. Write unit tests for a pure constructor taking a candidate provider key and a thrown value and returning an invoke result. Cover an `Error` with a message, and a thrown value that is not an `Error`.
2. Assert in those tests that the existing candidate-failure classifier treats the returned result as advancing, rather than re-deriving the classification rules in the assertion.
3. Establish RED, then implement the constructor beside the existing unsupported-capability constructor, mirroring its field shape: failed result, run-scoped provider unavailability, unavailability reason, and the invocation-skipped marker.
4. Compose the reason from the provider key, the underlying failure text, and a recovery action; keep the constructor pure, with no filesystem access, no configuration read, and no provider-name branching.
5. Run the focused unit tests and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. The constructed result is classified by the existing candidate-failure classifier as run-scoped provider unavailability.
2. The reason names the candidate provider key, contains the underlying preparation failure text, and states a recovery action.
3. A thrown value that is not an `Error` yields a reason with no `undefined`, `null`, or `[object Object]` fragment, and the result still reports the invocation as skipped.

### Task 2: Advance the candidate loop when preparation fails
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/provider-execution.ts, src/conductor/test/engine/provider-execution.test.ts
**Dependencies:** 1

**Steps:**
1. Add a fixture declaring two candidates whose injected preparation hook throws for the first and succeeds for the second, asserting per-provider invocation counts and the returned output.
2. Update the existing test that asserts the executor rejects when preparation throws so it asserts the returned unavailable result, keeping its observer-close and zero-invocation assertions unchanged.
3. Establish RED, then catch a preparation failure around the preparation await only, returning the Task 1 result from the closure so the enclosing teardown and observer-close path still runs.
4. Leave the provider invocation await outside the new catch, so an invocation rejection keeps propagating as it does today.
5. Run the focused unit tests and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. A two-candidate fixture whose first preparation throws records zero invocations against the first provider, exactly one against the second, and returns the second provider's output as the step result.
2. The catch encloses only the preparation await, so a candidate whose preparation succeeds still reaches its provider through the unchanged invocation path.
3. Every existing candidate fixture whose preparation succeeds keeps its current invocation count, returned output, and teardown order.
4. The updated preparation-rejection test asserts a returned unavailable result rather than a rejection, and still asserts one observer close and zero provider invocations.

### Task 3: Record the skipped candidate on the existing telemetry
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/engine/provider-execution.test.ts
**Dependencies:** 2

**Steps:**
1. Extend the two-candidate preparation-failure fixture with the attempt callback and the warning callback the executor already accepts.
2. Assert the skipped candidate's attempt metadata: an unavailable outcome, the invocation reported as not performed, a failure reason carrying the preparation failure, and a fallback reason.
3. Assert exactly one provider-fallback transition warning for the skip, naming the failed provider, the reason, and the next provider, ignoring unrelated session-policy warnings the way the existing fallback fixture does.
4. Establish RED against the pre-Task-2 behavior if either assertion does not already hold, then confirm GREEN with no production change beyond Task 2; add no event, field, or sink.
5. Run the focused unit tests and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. The skipped candidate's attempt metadata reports an unavailable outcome, reports the invocation as not performed, carries the preparation failure as its reason, and carries a fallback reason.
2. Exactly one provider-fallback transition warning is emitted for the skip, and its failed provider, reason, and next provider match the skipped attempt and the following declared candidate.
3. The assertions read only the existing attempt callback and warning callback; the diff adds no event type, no event field, and no diagnostic sink.

### Task 4: Prove the failure-closed and containment edges
**Story:** Story 1 (negative path)
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/provider-execution.test.ts
**Dependencies:** 2

**Steps:**
1. Add a fixture declaring a single candidate whose preparation throws, asserting the executor resolves to a failed result whose output names that provider and carries the preparation failure text.
2. Add a fixture whose preparation succeeds and whose injected provider invocation rejects, asserting the executor still rejects with that error and invokes no further candidate.
3. Add a fixture supplying a candidate stream observer whose preparation throws, asserting one observer close and zero invocations of the skipped candidate's provider.
4. Add a fixture whose preparation failure message embeds a canary matching the safety redactor, asserting the canary is absent from every attempt reason, every warning, and the returned output.
5. Run the focused unit tests and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. A single-candidate fixture whose preparation throws resolves to a failed result naming that provider and containing the preparation failure text, and never rejects.
2. A fixture whose preparation succeeds and whose provider invocation rejects still rejects with that invocation error, and no further candidate is invoked.
3. A fixture with a stream observer whose preparation throws closes that observer exactly once and never invokes the skipped candidate's provider.
4. A fixture whose preparation failure message contains a canary shows that canary in no attempt reason, no warning, and no returned output.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a step declares two provider candidates and preparation for the first one throws, when the candidate executor runs the step, then the second candidate is invoked and its result is returned as the step result. | 1, 2 | "A two-candidate fixture whose first preparation throws records zero invocations against the first provider, exactly one against the second, and returns the second provider's output as the step result." | diff-local |
| Story 1 happy: Given preparation for the selected candidate succeeds, when the candidate executor runs the step, then that candidate is invoked exactly once and its result is returned unchanged. | 2 | "Every existing candidate fixture whose preparation succeeds keeps its current invocation count, returned output, and teardown order." | diff-local |
| Story 1 negative: Given a step declares one provider candidate and preparation for it throws, when the candidate executor runs the step, then the executor returns a failed result whose output names that candidate and the preparation failure instead of propagating the preparation error to its caller. | 1, 4 | "A single-candidate fixture whose preparation throws resolves to a failed result naming that provider and containing the preparation failure text, and never rejects." | diff-local |
| Story 1 negative: Given preparation for a candidate succeeds and that candidate's provider invocation then throws, when the candidate executor runs the step, then the invocation error still propagates to the caller and no further candidate is invoked. | 4 | "A fixture whose preparation succeeds and whose provider invocation rejects still rejects with that invocation error, and no further candidate is invoked." | diff-local |
| Story 2 happy: Given preparation for a candidate throws and another candidate is declared, when the executor records that attempt, then the attempt metadata reports an unavailable outcome, reports that no invocation occurred, and carries the preparation failure as both its failure reason and its fallback reason. | 3 | "The skipped candidate's attempt metadata reports an unavailable outcome, reports the invocation as not performed, carries the preparation failure as its reason, and carries a fallback reason." | diff-local |
| Story 2 happy: Given preparation for a candidate throws and another candidate is declared, when the executor announces the transition, then it emits a provider-fallback warning naming the failed candidate, the preparation failure reason, and the next candidate. | 3 | "Exactly one provider-fallback transition warning is emitted for the skip, and its failed provider, reason, and next provider match the skipped attempt and the following declared candidate." | diff-local |
| Story 2 negative: Given preparation for a candidate throws after that candidate's stream observer was created, when the executor advances to the next candidate, then the observer is closed exactly once and the skipped candidate's provider is never invoked. | 4 | "A fixture with a stream observer whose preparation throws closes that observer exactly once and never invokes the skipped candidate's provider." | diff-local |
| Story 2 negative: Given the preparation failure message contains text the safety redactor removes, when the attempt metadata, the fallback warning, and the all-candidates-unavailable output are produced, then none of them contains that text. | 4 | "A fixture whose preparation failure message contains a canary shows that canary in no attempt reason, no warning, and no returned output." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures with injected provider runtimes and an
injected preparation hook. Task 1 owns the pure constructor cases. Task 2 owns the changed
production boundary and its integration proof: its assertions run the exported candidate executor
end to end, so they prove the executor — not a private helper — advances and returns the surviving
candidate's result. Task 3 owns the observability cases at the executor's existing attempt and
warning callbacks. Task 4 owns the failure-closed, propagation, containment, and redaction edges.
The file's existing fallback, teardown, model-ladder, and safety fixtures supply the unchanged
permutations; no new aggregate, conductor, or external-service test is required, and no terminal
validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 2 -> Task 4
