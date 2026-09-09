# Implementation Plan: A terminal step refusal routes instead of spending the retry budget

Stem: coverage-binding-retries-past-its-3-3-budget-when-
Track: technical
Tier: S

**Date:** 2026-09-07
**Stories:** `.docs/stories/coverage-binding-retries-past-its-3-3-budget-when-.md`
**Conflict check:** Not required at Tier S (no `.docs/conflicts/` artifact; no blocking overlap known)

## Summary

Eight tasks that route a typed terminal step refusal through the existing retry classifier before
the retry budget is consulted, so a `needs-human` refusal halts on its first attempt instead of
spending two more laps, and so the recorded reason is the refusal's own text rather than a
synthesized "produced no output" diagnostic.

## Technical Approach

**The defect is placement, not design.** `conductor.ts:10557` already owns the terminal refusal
halt; it sits *after* `while (attempt < stepMaxRetries)` (`conductor.ts:8688`), so a refusal that
has already concluded a human is required burns the whole budget first.
`adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` D2 already placed
`classifyRetryDecision` at the step-runner failure branch precisely to stop that, with
`retry_routing.enabled` as the kill switch (D4) and the `retry_decision` event as its telemetry
(D5, which names the `signal` vocabulary as the extension point). This plan adds one signal to that
classifier rather than standing up a second routing mechanism — the shape that ADR's Option D
rejected.

**Three files change.**

- `src/conductor/src/engine/artifacts.ts` — `classifyRetryDecision` gains an optional
  `terminalRefusal` input carrying the existing `'seal' | 'needs-human' | 'validation-verdict'`
  union, and its return `signal` union gains `'terminal-refusal'`. `needs-human` and
  `validation-verdict` route; `seal` does not. The function stays pure and LLM-free.
- `src/conductor/src/engine/conductor.ts` — the step-runner failure branch (around the existing
  `retryRoutingEnabled` block at `:9510`) consults the classifier when `result.refusal` is present,
  emits `retry_decision`, and `break`s on a route so the existing refusal halt at `:10557` owns the
  terminal outcome unchanged. This call is gated on `retryRoutingEnabled` only — **not** on
  `this.daemon` and **not** on `isVerdictStep`. Neither existing gated block is edited.
- `src/conductor/src/engine/step-runners.ts` — the `does-not-assert` return at `:2566` gains
  `output` set to its refusal `reason`, so `runnerOutput` at `conductor.ts:9490` is defined and the
  blank-output diagnostic is never synthesized for a refusal.

**Why `seal` is excluded.** `adr-2026-08-24-refused-step-status` D4 names "the seal
retries-exhausted path" as a deliberate stamp site, and `conductor.ts:8846` writes the seal HALT
only at `attempt >= 2`. Routing `seal` would silently retire that behavior, so Task 2 and Task 5
pin it in both directions.

**Reachability, stated so no task invents a fixture.** `StepRunResult.refusal.kind` is populated by
exactly two producers: `step-runners.ts:2566` (`needs-human`) and `conductor.ts:8846` (`seal`).
`validation-verdict` is stamped only by `recordGroupRefusal` (`conductor.ts:2189`) and never travels
on a `StepRunResult`. Task 2 therefore covers `validation-verdict` at the pure classifier only; no
task asserts it end-to-end through the loop.

**Local test pattern to follow.** This seam already has a two-layer convention and the new work
mirrors it exactly. Pure truth-table coverage of `classifyRetryDecision` lives in
`src/conductor/test/engine/artifacts.test.ts`; loop-level behavior is driven through a real
`Conductor.run()` with a fake `StepRunner`, asserting on the emitted
`retry_decision` / `step_retry` / `loop_halt` events and the on-disk HALT marker, in
`src/conductor/test/integration/retry-classify.test.ts` — whose header states this split explicitly.
Allowed variation: a new `describe` block in either file rather than extending an existing one.
Search hints: `classifyRetryDecision` in `test/engine/`, and `Conductor.run` plus `EventPersister`
in `test/integration/` and `test/conduct-state-refusal-event.test.ts` for the refusal-status
assertions.

**Sequencing.** The classifier is pure and has no dependencies, so Tasks 1-2 land first and unblock
the conductor tasks. Tasks 4, 5, 7 and 8 are the negative/regression lanes and depend only on the
production edit they guard, so BUILD can fan them out.

## Prerequisites

- None. No migration, no new config key, no new event type, no dependency change.

## Tasks

### Task 1: Add the `terminal-refusal` route signal to the retry classifier
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing unit test in `src/conductor/test/engine/artifacts.test.ts` asserting that `classifyRetryDecision` called with `terminalRefusal: 'needs-human'`, `attempt: 1`, `completion: { done: false }` and `inputsUnchanged: false` returns `{ decision: 'route', signal: 'terminal-refusal' }`.
2. Verify the test fails (RED) — the current signature has no `terminalRefusal` input.
3. Add the optional `terminalRefusal?: 'seal' | 'needs-human' | 'validation-verdict'` input to `classifyRetryDecision` and `'terminal-refusal'` to its returned `signal` union at `artifacts.ts:5054`, returning the route decision for `needs-human`.
4. Verify the test passes (GREEN) and `tsc --noEmit` is clean.
5. Commit with message: "feat(retry-classifier): route a needs-human terminal refusal".

**Done when:**
- [ ] `classifyRetryDecision` called with `terminalRefusal: 'needs-human'` returns `{ decision: 'route', signal: 'terminal-refusal' }`.
- [ ] The returned `signal` union at `artifacts.ts:5054` includes `'terminal-refusal'` and `tsc --noEmit` exits zero.
- [ ] The new unit test in `src/conductor/test/engine/artifacts.test.ts` fails against the pre-change classifier and passes after the edit.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — classifier input, signal union, route rule
- `src/conductor/test/engine/artifacts.test.ts` — truth-table coverage

**Dependencies:** none

---

### Task 2: Pin the classifier's non-routing cases — `seal` reruns, absent input is inert
**Story:** 1
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/artifacts.test.ts` asserting that `terminalRefusal: 'seal'` does not yield `signal: 'terminal-refusal'`, that `terminalRefusal: 'validation-verdict'` does yield the route decision, and that omitting `terminalRefusal` leaves every existing signal fixture unchanged.
2. Verify the tests fail (RED) for the `seal` and `validation-verdict` cases.
3. Implement the kind discrimination so only `needs-human` and `validation-verdict` route; `seal` falls through to the pre-existing signal evaluation untouched.
4. Verify the tests pass (GREEN).
5. Commit with message: "test(retry-classifier): pin seal rerun and inert-absent classifier cases".

**Done when:**
- [ ] `classifyRetryDecision` with `terminalRefusal: 'seal'` returns a decision whose `signal` is not `'terminal-refusal'`.
- [ ] `classifyRetryDecision` with `terminalRefusal: 'validation-verdict'` returns `{ decision: 'route', signal: 'terminal-refusal' }`.
- [ ] `classifyRetryDecision` called with no `terminalRefusal` returns byte-identical results to the pre-change classifier for the existing signal fixtures.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — kind discrimination
- `src/conductor/test/engine/artifacts.test.ts` — negative and inert-path coverage

**Dependencies:** Task 1

---

### Task 3: Consult the classifier at the step-runner failure branch before the budget
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test in `src/conductor/test/integration/retry-classify.test.ts` driving a real `Conductor.run()` with a fake `StepRunner` that returns `{ success: false, refusal: { kind: 'needs-human', reason } }`, asserting the runner is invoked once under `max_retries: 3`, that a `retry_decision` with `signal: 'terminal-refusal'` is emitted, that no `step_retry` is emitted, and that the HALT marker, halt class and `conduct-state.json` status are unchanged from today's refusal outcome.
2. Add sibling cases constructed with `daemon: false` and with `max_retries: 1`, plus one driving `runCoverageBinding` with a single `does-not-assert` claim.
3. Verify the tests fail (RED) — today the runner is invoked three times.
4. In `conductor.ts`, immediately before the existing `retryRoutingEnabled`/`isVerdictStep` block near `:9510`, add a branch that fires when `result.refusal !== undefined` and `retryRoutingEnabled` is true: call `classifyRetryDecision` with `terminalRefusal: result.refusal.kind`, emit the `retry_decision` event, and `break` on `decision === 'route'`. Do not add a `this.daemon` condition and do not edit the existing `isVerdictStep` block.
5. Verify the tests pass (GREEN) and commit with message: "fix(conductor): route a terminal refusal before consuming the retry budget".

**Done when:**
- [ ] A `Conductor.run()` test with a fake runner returning a `needs-human` refusal asserts the runner is invoked exactly once despite `max_retries: 3`.
- [ ] The same test asserts the event stream contains a `retry_decision` with `signal: 'terminal-refusal'` and no `step_retry` for that step.
- [ ] The same test asserts the HALT marker text equals the refusal `reason`, its class is `needs-human`, and `conduct-state.json` records the step as `refused`.
- [ ] Equivalent tests with `daemon: false` and with `max_retries: 1` each assert the identical single-dispatch outcome.
- [ ] A test driving a `does-not-assert` claim asserts exactly one `coverage_binding` step dispatch and zero `step_retry` events for it.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — new classifier call at the step-runner failure branch
- `src/conductor/test/integration/retry-classify.test.ts` — loop-level routing coverage

**Dependencies:** Task 1

---

### Task 4: A non-refusal failure keeps its ordinary retry budget
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/integration/retry-classify.test.ts` driving `Conductor.run()` with a fake runner returning `{ success: false, output: 'provider exited 1' }` and no `refusal`, asserting three invocations under `max_retries: 3`, no `terminal-refusal` `retry_decision`, and the pre-existing generic retries-exhausted halt.
2. Add a case where the runner returns `{ success: true }` and assert no `terminal-refusal` `retry_decision` is emitted at all.
3. Verify the tests fail (RED) only if Task 3's branch is over-broad; otherwise confirm they pass and keep them as the guard.
4. Narrow Task 3's branch condition if either case fails, then verify GREEN.
5. Commit with message: "test(conductor): pin ordinary retry behavior for non-refusal results".

**Done when:**
- [ ] A `Conductor.run()` test with a runner returning `{ success: false, output: 'provider exited 1' }` and no `refusal` asserts the runner is invoked three times under `max_retries: 3`.
- [ ] The same test asserts no `retry_decision` carrying `signal: 'terminal-refusal'` is emitted, and a sibling case asserts the same for a `{ success: true }` result.
- [ ] The terminal outcome of that test is the pre-existing generic retries-exhausted halt, not a refusal halt.

**Files likely touched:**
- `src/conductor/test/integration/retry-classify.test.ts` — non-refusal guard coverage
- `src/conductor/src/engine/conductor.ts` — branch condition narrowing only if a guard fails

**Dependencies:** Task 3

---

### Task 5: A `seal` refusal keeps its full budget and its protected-artifact halt
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/integration/retry-classify.test.ts` driving `Conductor.run()` with a persistent `seal` refusal under `max_retries: 3`, asserting three runner invocations and a terminal HALT carrying the protected-artifact halt class.
2. Add a case asserting the pre-existing `attempt >= 2` seal HALT escalation still writes its marker, and a case where the `seal` refusal clears on attempt 2.
3. Verify the tests fail (RED) if Task 3's branch routes `seal`; otherwise confirm they pass and keep them as the regression guard.
4. Correct the kind discrimination if any case fails, then verify GREEN.
5. Commit with message: "test(conductor): pin seal refusal retryability against terminal-refusal routing".

**Done when:**
- [ ] A `Conductor.run()` test with a persistent `seal` refusal under `max_retries: 3` asserts the runner is invoked three times.
- [ ] The same test asserts the resulting HALT carries the protected-artifact halt class and never `needs-human`.
- [ ] A test where the `seal` refusal clears on attempt 2 asserts the step completes `done` with no HALT marker written.
- [ ] The pre-existing `attempt >= 2` seal HALT escalation still fires, asserted by a test inspecting the marker after attempt 2.

**Files likely touched:**
- `src/conductor/test/integration/retry-classify.test.ts` — seal regression coverage
- `src/conductor/src/engine/artifacts.ts` — kind discrimination correction only if a guard fails

**Dependencies:** Task 3

---

### Task 6: The coverage-binding refusal carries its reason as `output`
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing unit test asserting `runCoverageBinding`'s `does-not-assert` result has a non-empty `output` string equal to its `refusal.reason`.
2. Write a failing conductor test asserting that for a refusal-carrying result the recorded `lastError` matches the refusal reason and does not match `/produced no output/`.
3. Verify both fail (RED).
4. At `step-runners.ts:2566`, add `output` to the returned refusal result, set to the same `reason` string already passed to `refusal.reason`. Change nothing else about the return.
5. Verify GREEN and commit with message: "fix(coverage-binding): carry the refusal reason as step output".

**Done when:**
- [ ] `runCoverageBinding`'s `does-not-assert` result carries a non-empty `output` string equal to its `refusal.reason`.
- [ ] A conductor test asserts the recorded `lastError` for a refusal-carrying result matches the refusal reason and does not match `/produced no output/`.
- [ ] `tsc --noEmit` exits zero and the existing coverage-binding unit suite passes unchanged.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — `output` on the refusal return
- `src/conductor/test/integration/retry-classify.test.ts` — `lastError` assertion

**Dependencies:** none

---

### Task 7: Preserve the blank-output diagnostic and the payload-error precedence
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test asserting a step result with `output: '   '` and no `refusal` still yields a `lastError` matching `/produced no output/`, preserving #814's masking fix.
2. Write a failing test asserting a `coverage_binding` result carrying a `CoverageBindingPayloadError` still yields a `lastError` matching `/coverage-binding judge infrastructure failure/`.
3. Verify both fail (RED) only if Task 6's edit widened beyond the refusal return; otherwise confirm they pass and keep them as guards.
4. Narrow Task 6's edit if either case fails, then verify GREEN.
5. Commit with message: "test(conductor): pin blank-output and payload-error diagnostics".

**Done when:**
- [ ] A conductor test asserts a result with `output: '   '` and no `refusal` still yields a `lastError` matching `/produced no output/`.
- [ ] A conductor test asserts a `CoverageBindingPayloadError` result still yields a `lastError` matching `/coverage-binding judge infrastructure failure/`.
- [ ] Both assertions fail if the refusal `output` assignment from Task 6 is widened to overwrite a non-refusal or payload-error reason.

**Files likely touched:**
- `src/conductor/test/integration/retry-classify.test.ts` — diagnostic-preservation coverage
- `src/conductor/src/engine/step-runners.ts` — narrowing only if a guard fails

**Dependencies:** Task 6

---

### Task 8: `retry_routing.enabled: false` reverts the new routing exactly
**Story:** 3
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/integration/retry-classify.test.ts` driving `Conductor.run()` with `retry_routing: { enabled: false }` and a persistent `needs-human` refusal under `max_retries: 3`, asserting three runner invocations, no `terminal-refusal` `retry_decision`, and an unchanged terminal refusal halt.
2. Assert each emitted `step_retry` reason carries the refusal text rather than the no-output diagnostic, which is the observable Task 6 delivers on this path.
3. Add a case with `retry_routing` omitted entirely, asserting the single-dispatch routing outcome of Task 3, since `RETRY_ROUTING_DEFAULTS.enabled` is `true` at `config.ts:2132`.
4. Verify the tests fail (RED) if the new branch ignores the kill switch, then confirm the branch reads `retryRoutingEnabled` and verify GREEN.
5. Commit with message: "test(conductor): pin the retry_routing kill switch over terminal-refusal routing".

**Done when:**
- [ ] A `Conductor.run()` test with `retry_routing: { enabled: false }` and a persistent `needs-human` refusal under `max_retries: 3` asserts the runner is invoked three times.
- [ ] The same test asserts the terminal HALT still carries the refusal reason with class `needs-human`.
- [ ] The same test asserts no emitted `retry_decision` carries `signal: 'terminal-refusal'` for any attempt.
- [ ] The same test asserts each `step_retry` reason carries the refusal text rather than the no-output diagnostic.
- [ ] A test with `retry_routing` omitted entirely asserts the single-dispatch routing outcome of Task 3.

**Files likely touched:**
- `src/conductor/test/integration/retry-classify.test.ts` — kill-switch and default coverage
- `src/conductor/src/engine/conductor.ts` — kill-switch condition only if a guard fails

**Dependencies:** Task 3; Task 6

---

## Task Dependency Graph

```
Task 1 ──┬── Task 2
         └── Task 3 ──┬── Task 4
                      ├── Task 5
                      └── Task 8
Task 6 ──┬── Task 7
         └── Task 8
```

Tasks 1 and 6 are independent roots. Tasks 2, 4, 5 and 7 are leaves that can run concurrently once
their single parent lands. Task 8 joins the two roots' lines.

## Integration Points

- After Task 3: the production boundary is exercised end-to-end — a real `Conductor.run()` reaches
  the step-runner failure branch, routes on the refusal, and produces the observable operator
  outcome (one dispatch, a `retry_decision` on `.pipeline/events.jsonl`, and the refusal HALT
  marker). Task 3 is the single integration-owning task for this change; Tasks 1-2 are unit-scoped
  edits to a pure function that Task 3's entry point reaches.
- After Task 6: `.daemon/daemon.log` and the `step_retry` reason field carry the refusal text on
  the kill-switch-off path, verified through the same entry point in Task 8.

## Coverage Check

Every extracted story criterion, its owning task, and an exact fragment of that task's
`Done when` block. All dispositions are `diff-local`: no criterion here can be made true or false
by a commit outside this feature's diff.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `retry_routing.enabled` is true and a step's runner returns `{ success: false, refusal: { kind: 'needs-human', reason } }` on attempt 1, when the step-runner failure branch runs, then `classifyRetryDecision` returns `{ decision: 'route', signal: 'terminal-refusal' }` and the retry loop exits without a second dispatch. | 1 | "returns `{ decision: 'route', signal: 'terminal-refusal' }`" | diff-local |
| Story 1 happy: Given the same conditions, when the loop exits, then a `retry_decision` event is emitted carrying `step`, `attempt: 1`, `decision: 'route'` and `signal: 'terminal-refusal'`, so the spine records why the budget was not spent. | 3 | "contains a `retry_decision` with `signal: 'terminal-refusal'` and no `step_retry` for that step" | diff-local |
| Story 1 happy: Given the same conditions, when the loop exits, then the pre-existing refusal halt at `conductor.ts:10557` still owns the outcome: the HALT marker carries the refusal's own `reason` verbatim with class `needs-human`, and the step is stamped `refused` (not `failed`) per `adr-2026-08-24` D1. | 3 | "the HALT marker text equals the refusal `reason`, its class is `needs-human`, and `conduct-state.json` records the step as `refused`" | diff-local |
| Story 1 happy: Given the run is interactive rather than daemon-dispatched (`this.daemon` is false), when a `needs-human` refusal is returned, then it routes identically — the new signal is not gated on daemon mode. | 3 | "Equivalent tests with `daemon: false` and with `max_retries: 1` each assert the identical single-dispatch outcome" | diff-local |
| Story 1 happy: Given a `coverage_binding` step whose judge returns `does-not-assert` for at least one claim, when the step runs under a default configuration, then exactly one `coverage_binding` step dispatch occurs for that lap and no `step_retry` event is emitted for it. | 3 | "exactly one `coverage_binding` step dispatch and zero `step_retry` events for it" | diff-local |
| Story 1 negative: Given a step's runner returns `{ success: false, output: 'provider exited 1' }` with **no** `refusal` field, when the step-runner failure branch runs, then no `terminal-refusal` route is taken and the step retries under its ordinary budget, so genuine work failures keep their retries. | 4 | "asserts the runner is invoked three times under `max_retries: 3`" | diff-local |
| Story 1 negative: Given a step's runner returns `{ success: true }`, when the step completes, then `classifyRetryDecision` is not consulted for `terminal-refusal` and no `retry_decision` event carrying that signal is emitted. | 2 | "returns byte-identical results to the pre-change classifier for the existing signal fixtures" | diff-local |
| Story 1 negative: Given a `needs-human` refusal on a step configured `max_retries: 1`, when the branch runs, then the outcome is identical to the multi-retry case — one dispatch, a routed decision, and the refusal halt — so the fix does not depend on a budget greater than one. | 3 | "Equivalent tests with `daemon: false` and with `max_retries: 1` each assert the identical single-dispatch outcome" | diff-local |
| Story 2 happy: Given `retry_routing.enabled` is true and the protected-artifact seal produces `{ success: false, output: dispatchIssue, refusal: { kind: 'seal', reason: dispatchIssue } }` on attempt 1, when the step-runner failure branch runs, then `classifyRetryDecision` returns a `rerun` decision and the step retries under its ordinary budget. | 2 | "returns a decision whose `signal` is not `'terminal-refusal'`" | diff-local |
| Story 2 happy: Given a `seal` refusal that persists, when attempt 2 is reached, then the pre-existing `attempt >= 2` escalation still writes the HALT marker with the protected-artifact halt class, unchanged. | 5 | "The pre-existing `attempt >= 2` seal HALT escalation still fires" | diff-local |
| Story 2 happy: Given a `seal` refusal that clears before the budget is exhausted, when the next attempt succeeds, then the step completes normally and no refusal halt is written. | 5 | "the step completes `done` with no HALT marker written" | diff-local |
| Story 2 negative: Given a `seal` refusal on every attempt, when the budget is exhausted, then the terminal outcome is the pre-existing protected-artifact halt — never a `needs-human` halt and never a `terminal-refusal`-signalled `retry_decision`. | 5 | "the resulting HALT carries the protected-artifact halt class and never `needs-human`" | diff-local |
| Story 3 happy: Given `coverage_binding` refuses with `does-not-assert`, when the result is constructed, then it carries a non-empty `output` equal to its refusal `reason`, so `runnerOutput` at `conductor.ts:9490` is defined and the synthesized "produced no output" text is never reached for a refusal. | 6 | "carries a non-empty `output` string equal to its `refusal.reason`" | diff-local |
| Story 3 happy: Given any refusal-carrying result reaches the step-runner failure branch, when `lastError` is assigned, then it holds the refusal reason text and contains neither `produced no output` nor `the grader/subprocess likely failed to start`. | 6 | "matches the refusal reason and does not match `/produced no output/`" | diff-local |
| Story 3 happy: Given `retry_routing.enabled` is false and a `needs-human` refusal therefore retries, when each `step_retry` event is emitted, then its `reason` carries the refusal text rather than the no-output diagnostic. | 8 | "each `step_retry` reason carries the refusal text rather than the no-output diagnostic" | diff-local |
| Story 3 negative: Given a non-refusal step result whose `output` is genuinely absent or whitespace-only, when the branch runs, then the existing `produced no output` diagnostic is still synthesized verbatim, so #814's masking fix is preserved. | 7 | "still yields a `lastError` matching `/produced no output/`" | diff-local |
| Story 3 negative: Given a `coverage_binding` result carrying a `CoverageBindingPayloadError` infrastructure failure, when `lastError` is assigned, then it still renders `coverage-binding judge infrastructure failure: <reason>`, so the typed payload diagnostic is not displaced by the refusal text. | 7 | "still yields a `lastError` matching `/coverage-binding judge infrastructure failure/`" | diff-local |
| Story 4 happy: Given `retry_routing.enabled: false` and a step returning a `needs-human` refusal, when the branch runs, then the classifier is not consulted for the new signal and the step retries under its ordinary budget, matching pre-change behavior. | 8 | "asserts the runner is invoked three times" | diff-local |
| Story 4 happy: Given `retry_routing` is absent from the config entirely, when the branch runs, then the new routing is active, because `RETRY_ROUTING_DEFAULTS.enabled` is `true` (`config.ts:2132`). | 8 | "A test with `retry_routing` omitted entirely asserts the single-dispatch routing outcome of Task 3" | diff-local |
| Story 4 happy: Given `retry_routing.enabled: false`, when the retry budget is exhausted on a `needs-human` refusal, then the terminal outcome is still the refusal halt at `conductor.ts:10557` with the refusal's reason and class — only the timing changes, never the verdict. | 8 | "the terminal HALT still carries the refusal reason with class `needs-human`" | diff-local |
| Story 4 negative: Given `retry_routing.enabled: false`, when a `needs-human` refusal retries, then no `retry_decision` event carrying `signal: 'terminal-refusal'` is emitted for any attempt. | 8 | "no emitted `retry_decision` carries `signal: 'terminal-refusal'` for any attempt" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left
      without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-rem-adr-001: src/conductor/test/integration/retry-classify.test.ts — add a failing test in the Task 5 seal block asserting that a `seal` refusal on the `build` step emits ZERO `retry_decision` events of any decision (today it emits `decision: 'rerun'`), while re-asserting the same three runner dispatches and protected-artifact HALT class that the existing Task 5 tests at :349-381 already pin; verify RED before any production edit
**Gate:** as-built
**Rationale:** Conforming implementation drift, not an architectural question: the approved boundary (adr-2026-08-19 D6, restating adr-2026-07-13's non-goal that the `build` step is never passed to the classifier) remains applicable and authoritative, and the shipped code already carries the matching intent as a comment at src/conductor/src/engine/conductor.ts:9505-9507 ("Keep `build` outside this classifier") while the branch condition at src/conductor/src/engine/conductor.ts:9509-9518 omits the step predicate, so a `seal` refusal constructed for `build` at src/conductor/src/engine/conductor.ts:8838-8846 reaches classifyRetryDecision. The fix must be at the call site, not inside the classifier: the terminalRefusal early return at src/conductor/src/engine/artifacts.ts:5091-5093 deliberately precedes the RETRY_CLASSIFY_STEPS check because `coverage_binding` is not in that set either, so moving the refusal check below it would kill the feature's own route. Sibling-site sweep: the only other classifyRetryDecision call sites are src/conductor/src/engine/conductor.ts:9535 and src/conductor/src/engine/conductor.ts:9869, both already gated on `isVerdictStep`, which excludes `build`; no third site exists and nothing is orphaned by this change. Found and deliberately excluded: the diagram statement at architecture doc `rebase-invalidated-test-suite-proof-halts-build-re` line 121 becomes true again once the guard lands and needs no edit, and it is another feature's sealed artifact that this feature must not amend. No regression: the guard preserves plan Task 5's delivered coverage verbatim (three dispatches, protected-artifact HALT class, attempt>=2 escalation, and the clears-on-attempt-2 case at test/integration/retry-classify.test.ts:349-448), because a `seal` refusal already classified as `rerun`, so excluding `build` changes no observable outcome those assertions pin; plan Task 3's single-dispatch coverage_binding routing is untouched because `coverage_binding` is not `build`. Confidence: high (95%) — every claim read directly from current worktree source.
**Governing clause:** adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D6
**Done when:**
- adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D6 is satisfied by this task.

### Task rem-as-built-rem-adr-002: src/conductor/src/engine/conductor.ts:9509 — add `step.name !== 'build'` to the new refusal branch condition (`result.refusal !== undefined && retryRoutingEnabled`) so the classifier is never invoked for `build`, matching the branch's own comment at :9505-9507 and adr-2026-08-19 D6; do not touch the `isVerdictStep` blocks at :9528-9545 or :9830-9869, and do not move the `terminalRefusal` early return in artifacts.ts (that would break the coverage_binding route)
**Gate:** as-built
**Rationale:** Conforming implementation drift, not an architectural question: the approved boundary (adr-2026-08-19 D6, restating adr-2026-07-13's non-goal that the `build` step is never passed to the classifier) remains applicable and authoritative, and the shipped code already carries the matching intent as a comment at src/conductor/src/engine/conductor.ts:9505-9507 ("Keep `build` outside this classifier") while the branch condition at src/conductor/src/engine/conductor.ts:9509-9518 omits the step predicate, so a `seal` refusal constructed for `build` at src/conductor/src/engine/conductor.ts:8838-8846 reaches classifyRetryDecision. The fix must be at the call site, not inside the classifier: the terminalRefusal early return at src/conductor/src/engine/artifacts.ts:5091-5093 deliberately precedes the RETRY_CLASSIFY_STEPS check because `coverage_binding` is not in that set either, so moving the refusal check below it would kill the feature's own route. Sibling-site sweep: the only other classifyRetryDecision call sites are src/conductor/src/engine/conductor.ts:9535 and src/conductor/src/engine/conductor.ts:9869, both already gated on `isVerdictStep`, which excludes `build`; no third site exists and nothing is orphaned by this change. Found and deliberately excluded: the diagram statement at architecture doc `rebase-invalidated-test-suite-proof-halts-build-re` line 121 becomes true again once the guard lands and needs no edit, and it is another feature's sealed artifact that this feature must not amend. No regression: the guard preserves plan Task 5's delivered coverage verbatim (three dispatches, protected-artifact HALT class, attempt>=2 escalation, and the clears-on-attempt-2 case at test/integration/retry-classify.test.ts:349-448), because a `seal` refusal already classified as `rerun`, so excluding `build` changes no observable outcome those assertions pin; plan Task 3's single-dispatch coverage_binding routing is untouched because `coverage_binding` is not `build`. Confidence: high (95%) — every claim read directly from current worktree source.
**Governing clause:** adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D6
**Done when:**
- adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D6 is satisfied by this task.

### Task rem-as-built-rem-adr-003: src/conductor/src/engine/artifacts.ts:5065-5075 — update the classifyRetryDecision docblock, the matched counterpart of the RETRY_CLASSIFY_STEPS set, whose sentence "Out of scope steps (e.g. `build`) always rerun" is falsified by the `terminalRefusal` early return at :5091-5093: state that a terminal refusal is classified ahead of the step-set check and that keeping `build` out is the caller's obligation; then verify GREEN on rem-adr-001 plus the full test/integration/retry-classify.test.ts and test/engine/artifacts.test.ts suites, and `tsc --noEmit` clean
**Gate:** as-built
**Rationale:** Conforming implementation drift, not an architectural question: the approved boundary (adr-2026-08-19 D6, restating adr-2026-07-13's non-goal that the `build` step is never passed to the classifier) remains applicable and authoritative, and the shipped code already carries the matching intent as a comment at src/conductor/src/engine/conductor.ts:9505-9507 ("Keep `build` outside this classifier") while the branch condition at src/conductor/src/engine/conductor.ts:9509-9518 omits the step predicate, so a `seal` refusal constructed for `build` at src/conductor/src/engine/conductor.ts:8838-8846 reaches classifyRetryDecision. The fix must be at the call site, not inside the classifier: the terminalRefusal early return at src/conductor/src/engine/artifacts.ts:5091-5093 deliberately precedes the RETRY_CLASSIFY_STEPS check because `coverage_binding` is not in that set either, so moving the refusal check below it would kill the feature's own route. Sibling-site sweep: the only other classifyRetryDecision call sites are src/conductor/src/engine/conductor.ts:9535 and src/conductor/src/engine/conductor.ts:9869, both already gated on `isVerdictStep`, which excludes `build`; no third site exists and nothing is orphaned by this change. Found and deliberately excluded: the diagram statement at architecture doc `rebase-invalidated-test-suite-proof-halts-build-re` line 121 becomes true again once the guard lands and needs no edit, and it is another feature's sealed artifact that this feature must not amend. No regression: the guard preserves plan Task 5's delivered coverage verbatim (three dispatches, protected-artifact HALT class, attempt>=2 escalation, and the clears-on-attempt-2 case at test/integration/retry-classify.test.ts:349-448), because a `seal` refusal already classified as `rerun`, so excluding `build` changes no observable outcome those assertions pin; plan Task 3's single-dispatch coverage_binding routing is untouched because `coverage_binding` is not `build`. Confidence: high (95%) — every claim read directly from current worktree source.
**Governing clause:** adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D6
**Done when:**
- adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D6 is satisfied by this task.
