# Implementation Plan: Provider-free step completions are not dispatches

**Date:** 2026-09-06
**Stories:** .docs/stories/stop-counting-provider-free-step-completions-as-un.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing metering contract — an invoked provider attempt stays authoritative, an unmeasured provider call stays visibly unmetered, and the persisted event schema, the cost-block format, and the exported instrument set are all unchanged.

## Summary

Three bounded tasks deliver #1906 by narrowing one decision inside the shared dispatch-metering projection: an unmatched step completion becomes a dispatch only when it carries provider evidence. Emitter payloads, the aggregate exclusion policy for partial features, and the reporting prose that renders these counts are outside this small slice.

## Technical Approach

`DispatchMeteringTracker.observe` currently returns an observation for every `step_completed` record that no earlier successful invoked attempt claimed. That fallback exists for ledgers written before provider-attempt metering, but it cannot tell a legacy provider dispatch from a step that never called a provider at all, so it counts both. Narrow it: after attempt matching, an unmatched completion is a dispatch only when it carries at least one of `tokenUsage`, `actualProvider`, `preferredProvider`, or `model`. A record with none of those four returns `undefined` and contributes to nothing — not the dispatch count, not the unmetered count, not the token or cost buckets, not the per-provider sub-rollup. Attempt handling is untouched: an invoked attempt is always returned, so a provider call with absent or unusable usage stays one explicitly unmetered dispatch.

The four evidence fields are the complete provider attribution a completion record ever carries, and all four originate in provider execution rather than in native step code, so the test is exact rather than heuristic in both directions. A legacy metered completion carries token usage and a model; a legacy unmeasured provider completion carries its resolved or preferred provider; a native step carries none of them.

Keep the change inside the projection. Both readers already call it and neither needs editing: the cost rollup turns each returned observation into a dispatch, and the observability visualizer passes the observation's presence to the metrics recorder as its record-dispatch flag, so the exported counter and the committed rollup stay in agreement by construction rather than by a second rule. That shared-projection property is exactly what the fix must not break, which is why one task owns proving it at the exporter boundary.

Follow the repository's existing metering test pattern: pure selection cases belong at unit level against the projection itself, and each reader's proof belongs in that reader's own existing test file, driving the real internal path with in-memory fakes at the third-party boundary. The ledger fixtures are hand-written JSON lines written to a temporary directory, matching the existing rollup tests; the exporter proof uses the in-memory span and metric exporters the existing metrics tests already construct. No real provider, collector, or network call is introduced. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, reader-side reclassification, the four-field evidence set, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/dispatch-metering.ts:22-58` suppresses a completion only on a step-plus-actual-provider match and otherwise returns it.
- Verified: `src/conductor/src/engine/cost-rollup.ts:226-241` converts each returned observation into a dispatch, and `cost-rollup.ts:129-150` increments the unmetered count from the record's own marking.
- Verified: `src/conductor/src/engine/conductor.ts:11412` marks a completion unmetered whenever the step result carries no token usage.
- Verified: `conductor.ts:2847-2878` returns only a success flag and a publication disposition for the finish step, `src/conductor/src/engine/step-runners.ts:2739-2761` returns only a success flag and output for the empty-scope review pass, and `conductor.ts:12333-12351` returns a bare success for a clean native rebase — none carries provider attribution.
- Verified: `src/conductor/src/engine/otel/otel-visualizer.ts:406-411` and `:506-517` pass the observation's presence to `MetricsRecorder.onStepClose`, whose `recordDispatch` parameter gates the dispatch counter at `src/conductor/src/engine/otel/metrics.ts:87-104`.
- Verified: `src/conductor/test/engine/cost-rollup.test.ts:625-638` currently asserts the superseded behavior for bare unmetered completions and is rewritten by this plan; the existing legacy case at `:402-433` carries token usage and keeps its result unchanged.
- Verified: `src/conductor/test/engine/otel/metrics.test.ts` already emits through a real visualizer with in-memory exporters and compares against `computeCostRollup`; no new harness is needed.
- Verified: PR #2063 (commit `36ef5ec38`) is the only change to the projection and reaches only completions bearing an actual provider, which none of the three step paths above emits.
- Scope check: consumer-facing engine measurement fix; no new skill; provider-agnostic. Event spine: no channel added, existing ledger readers only.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree. One assumption is recorded and accepted: a ledger written before provider-attempt metering whose provider completion carried none of the four evidence fields would no longer be counted; no such record exists in any observed ledger, and no reader can distinguish it from a native step, so the ambiguity is resolved toward not inventing a dispatch.

## Tasks

### Task 1: Require provider evidence before an unmatched completion is a dispatch
**Story:** Story 1
**Story:** Story 1 (negative path)
**Type:** happy-path
**Files:** src/conductor/src/engine/dispatch-metering.ts, src/conductor/test/engine/dispatch-metering.test.ts
**Dependencies:** none

**Steps:**
1. Create a focused unit test file for the projection and write table-driven cases: a completion with none of the four evidence fields and marked unmetered, the same completion unmarked, a completion carrying only token usage, only an actual provider, only a preferred provider, and only a model, a completion matched by an earlier successful invoked attempt, a second completion for the same step and provider with only one matching attempt, an invoked attempt with usage, an invoked attempt without usage, a failed invoked attempt, and a not-invoked attempt.
2. Run the scoped tests and establish RED on the evidence cases.
3. Implement the narrowing in the completion branch only: after the existing attempt-match suppression, return undefined when the record carries no token usage, no actual provider, no preferred provider and no model. Leave the attempt branch, the match bookkeeping, and the observation shape untouched.
4. Update the projection's own doc comment to state the evidence rule instead of an unconditional legacy fallback.
5. Run the scoped tests to GREEN, run the repository's typecheck target that covers test files, and commit the focused change.

**Done when:**
1. `observe` returns undefined for a step-completion record that no earlier successful invoked attempt matched and that carries no token usage, no actual provider, no preferred provider and no model, including when it is marked unmetered.
2. `observe` returns one observation for an unmatched step-completion record carrying any one of token usage, actual provider, preferred provider or model, and that observation preserves the record's unmetered marking.
3. `observe` still suppresses one step-completion record per earlier successful invoked attempt matched on step and actual provider, and still returns every invoked attempt including a failed one.

### Task 2: Hold the per-feature cost rollup to the corrected dispatch ledger
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/engine/cost-rollup.test.ts
**Dependencies:** 1

**Steps:**
1. Add a rollup case whose temporary ledger reproduces the reported shape: fourteen invoked successful attempts across two providers each carrying token usage and cost, plus nine completions carrying only a step name, a done status and an unmetered marking, spread across the finish, review, rebase and suite steps.
2. Assert the projected feature totals report fourteen dispatches, fourteen metered, zero unmetered, and assert the token and cost sums equal the sums of the fourteen attempts.
3. Rewrite the existing all-unmetered case so it keeps proving legacy retention: give each completion a resolved provider and no token usage, and assert one unmetered dispatch each. Add a sibling case whose completions carry no attribution at all and assert zero dispatches and zero unmetered dispatches.
4. Add a case for an invoked attempt whose usage is absent and one whose cost is unusable, asserting the first stays one unmetered dispatch and the second stays one cost-unmetered dispatch, so narrowing selection did not weaken either state.
5. Run the scoped rollup tests to GREEN and commit.

**Done when:**
1. A rollup over fourteen usage-bearing invoked attempts and nine attribution-free completions reports fourteen dispatches, fourteen metered dispatches and zero unmetered dispatches.
2. That fixture's input, output, cached-token and cost sums equal the sums carried by its fourteen attempts.
3. A rollup over attribution-free completions alone reports zero dispatches and zero unmetered dispatches.
4. A rollup over attribution-bearing completions with no matching attempts reports one unmetered dispatch for each completion.
5. An invoked attempt whose usage is absent or unusable still reports one dispatch counted as unmetered.

### Task 3: Prove the exported dispatch counter selects the same dispatches
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/engine/otel/metrics.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing exporter fixture to emit one mixed sequence through the real visualizer while the real persister writes the same events: an invoked successful attempt with usage plus its matching completion, an invoked attempt without usage, and two completions carrying no attribution at all.
2. Compute the rollup from that persisted ledger and assert the exported dispatch-counter total equals the rollup's dispatch count for the same events.
3. Add a case asserting that the attribution-free step close still exports its duration data point while exporting no dispatch data point for that step.
4. Run the scoped exporter tests to GREEN, run the repository's typecheck target that covers test files, and commit.

**Done when:**
1. Over one mixed fixture the exported dispatch-counter total equals the dispatch count the rollup computes from the same persisted ledger.
2. A step closing with no provider attempt and no attribution on its completion exports one duration data point and no dispatch data point for that step.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a retained event ledger carrying fourteen invoked provider attempts that all report usage and nine step completions that carry no provider attribution, when the per-feature cost rollup is computed, then it reports fourteen dispatches, fourteen metered dispatches, zero unmetered dispatches, and the same token and cost totals as its fourteen attempts. | 2 | "A rollup over fourteen usage-bearing invoked attempts and nine attribution-free completions reports fourteen dispatches, fourteen metered dispatches and zero unmetered dispatches." | diff-local |
| Story 1 happy: Given a successful invoked provider attempt reporting usage followed by the completion of the same step by the same provider, when the rollup is computed, then that step contributes exactly one dispatch carrying that usage once. | 1 | "still suppresses one step-completion record per earlier successful invoked attempt matched on step and actual provider, and still returns every invoked attempt including a failed one." | diff-local |
| Story 1 negative: Given a step completion that has no matching provider attempt and carries no token usage, no actual provider, no preferred provider, and no model, when the rollup is computed, then it increases neither the dispatch count nor the unmetered-dispatch count, whether or not it is marked unmetered. | 1, 2 | "A rollup over attribution-free completions alone reports zero dispatches and zero unmetered dispatches." | diff-local |
| Story 1 negative: Given a provider attempt recorded as invoked whose usage is absent or unusable, when the rollup is computed, then it still contributes one dispatch and that dispatch is still counted as unmetered. | 2 | "An invoked attempt whose usage is absent or unusable still reports one dispatch counted as unmetered." | diff-local |
| Story 1 negative: Given a step completion with no matching provider attempt that carries provider or model attribution but no token usage, when the rollup is computed, then it still contributes one unmetered dispatch. | 1, 2 | "A rollup over attribution-bearing completions with no matching attempts reports one unmetered dispatch for each completion." | diff-local |
| Story 2 happy: Given one event sequence containing invoked provider attempts, matching completions, and provider-free completions, when that sequence is exported through the observability visualizer and rolled up from the same persisted ledger, then the exported dispatch-counter total equals the rollup's dispatch count. | 3 | "Over one mixed fixture the exported dispatch-counter total equals the dispatch count the rollup computes from the same persisted ledger." | diff-local |
| Story 2 negative: Given a step closes with no provider attempt and no provider attribution on its completion, when the visualizer records that step close, then it records the step's duration and records no dispatch data point for that step. | 3 | "A step closing with no provider attempt and no attribution on its completion exports one duration data point and no dispatch data point for that step." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: every one is decided by the projection's own rule and controlled fixtures inside this diff, and no commit outside the feature can change whether they hold. Task 1 owns the unit-level selection cases against the projection, which is the narrowest seam that owns the behavior. Task 2 owns the cost-rollup reader's integration, running the real rollup over real temporary ledger files. Task 3 owns the cross-boundary integration proof at the exporter: it is the one task that shows the application actually reaches the corrected projection on the observability path, asserting exported instrument data points rather than an internal call. Existing rollup and exporter tests supply the unchanged metered, cost-unmetered and legacy permutations; no new aggregate suite run, external service, or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
