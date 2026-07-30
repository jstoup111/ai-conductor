# Implementation Plan: Durable Provider-Time Attribution

**Status:** Approved
**Date:** 2026-07-29
**Design:** `.docs/specs/2026-07-29-durable-provider-time-attribution.md`
**Architecture:** `.docs/decisions/adr-2026-07-29-engine-observed-provider-time-partition.md`
**Stories:** `.docs/stories/durable-provider-time-attribution.md`
**Conflict check:** Clean as of 2026-07-29
**Priority:** Critical, v1

## Summary

This plan adds exact engine-observed provider-process intervals, preserves them through every result
boundary, partitions active feature execution with overlap-safe interval unions, and commits the
result to the shipped record for `conduct-ts kpi`. All 20 tasks are critical v1 scope; none is an
optional branch. Estimated build effort is 72–96 minutes. The feature claims no direct runtime
reduction: it is the measurement prerequisite that makes later ≥5-minute performance reductions
quantifiable and safely prioritizable.

## Technical Approach

- Add an `ObservedInterval` value object with `startedAtMs` and `durationMs`. Production observations
  use an epoch-anchored monotonic clock (`performance.timeOrigin + performance.now()`); tests inject a
  scripted clock. Intervals remain separate from `TokenUsage.durationMs`.
- Time the actual Claude and Codex invocation subprocess promises inside their adapters. Attach one
  interval for every started process outcome; readiness/cached skips that launch no model process
  attach none. Model fallback concatenates every model attempt.
- Propagate plural intervals through `InvokeResult`, provider attempt metadata, provider fallback,
  `StepRunResult`, scalar/provider-aware conversions, grouped paths, auxiliary graders, and existing
  event records. Duplicate evidence is safe because the rollup unions intervals.
- Extend `EventPersister` with an injected monotonic clock and a feature-local open-step map. It pairs
  serial `step_started` and group `parallel_started` events with the first matching terminal event and
  writes an explicit active interval beside the audit-only ISO `ts`. Unclosed starts remain detectable
  as partial evidence; parked gaps are outside all intervals.
- Add a pure timing rollup that validates intervals, unions active and provider occupancy, intersects
  provider occupancy with active execution, and emits `measured`, `partial`, or `unavailable`.
  Persist integer milliseconds with `no_provider_active_ms = active_ms - provider_active_ms` so the
  committed partition remains exact after rounding.
- Append a separate `## Time` section after existing frontmatter/Cost content. Compute Cost and Time
  independently on shipment, then parse and render Time independently in the existing KPI command.
  Historical, malformed, mixed-version, and future-additive records never become plausible zeroes.
- All tests use injected clocks and mocked provider/process adapters. No ordinary test invokes Claude,
  Codex, GitHub, a network service, or a full Conductor run when a narrower seam proves the behavior.

## Prerequisites

- The approved PRD, ADR, architecture review, stories, and clean conflict report listed above.
- Existing provider invocation, event persistence, shipped-record, and KPI surfaces on the branch.
- No OTel phase or external package is required.

## Tasks

### Task 1: Define the engine-observed interval contract
**Story:** Story 1 — shared timing semantics for FR-1 and FR-7; additive support for FR-10
**Type:** infrastructure
**Priority:** Critical (v1)
**Build estimate:** 4 minutes

**Steps:**
1. Write failing unit tests for an injected epoch-anchored monotonic clock, exact positive duration,
   fractional values, and a clock that cannot manufacture a negative interval.
2. Run `npx vitest run test/execution/observed-interval.test.ts --reporter=dot --silent` and verify RED.
3. Implement `ObservedInterval`, `IntervalClock`, the production perf-hooks clock, and an async
   observation helper without adding timing to `TokenUsage`.
4. Re-run the focused test and verify GREEN.
5. Commit with message: `feat: define observed execution interval contract`.

**Files:**
- `src/conductor/src/execution/observed-interval.ts`
- `src/conductor/test/execution/observed-interval.test.ts`

**Wired-into:** `src/conductor/src/execution/claude-provider.ts#ClaudeProvider.runClaude, src/conductor/src/execution/codex-provider.ts#CodexProvider.invoke, src/conductor/src/engine/event-persister.ts#EventPersister.persist`
**Dependencies:** none

### Task 2: Capture successful Claude subprocess intervals
**Story:** Story 1 — first provider happy path
**Type:** happy-path
**Priority:** Critical (v1)
**Build estimate:** 4 minutes

**Steps:**
1. Add a mocked-execa, scripted-clock test proving `ClaudeProvider.invoke` returns one interval from
   spawn boundary through process resolution while preserving output and usage.
2. Run the focused Claude provider test and verify RED on the missing interval.
3. Inject the interval clock into `ClaudeProvider`, observe `runClaude`, and attach the interval to the
   returned `InvokeResult` after subprocess completion.
4. Re-run the focused test and verify GREEN.
5. Commit with message: `feat: time claude provider subprocesses`.

**Files:**
- `src/conductor/src/execution/llm-provider.ts`
- `src/conductor/src/execution/claude-provider.ts`
- `src/conductor/test/execution/claude-provider.test.ts`

**Wired-into:** `src/conductor/src/execution/claude-provider.ts#ClaudeProvider.invoke`
**Dependencies:** Task 1

### Task 3: Preserve Claude timing on interactive and unsuccessful outcomes
**Story:** Story 1 — interactive/failure paths and negative invariants
**Type:** negative-path
**Priority:** Critical (v1)
**Build estimate:** 4 minutes

**Steps:**
1. Add failing tests for interactive completion and non-zero exit, asserting each started process has
   one interval while success, recovery classification, provider-reported duration, and output remain
   unchanged.
2. Run the focused Claude tests and verify RED.
3. Route the observed interval through both `invokeInteractive` and every `classifyCompletion` return
   without changing rate-limit, auth, model-unavailable, session, or token-usage semantics.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `feat: retain claude timing on all outcomes`.

**Files:**
- `src/conductor/src/execution/claude-provider.ts`
- `src/conductor/test/execution/claude-provider.test.ts`
- `src/conductor/test/execution/claude-provider-token-usage.test.ts`

**Wired-into:** `src/conductor/src/execution/claude-provider.ts#ClaudeProvider.invokeInteractive, src/conductor/src/execution/claude-provider.ts#ClaudeProvider.classifyCompletion`
**Dependencies:** Task 2

### Task 4: Capture successful Codex and self-host subprocess intervals
**Story:** Story 1 — second provider and self-host happy paths
**Type:** happy-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add mocked-execa, scripted-clock tests for ordinary and self-host executable selection, asserting
   one interval and unchanged Codex JSONL usage/output.
2. Run the focused Codex provider test and verify RED.
3. Inject the interval clock into `CodexProvider` and observe the `exec` subprocess in `invoke`, using
   the same interval contract as Claude without timing the readiness doctor call.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `feat: time codex provider subprocesses`.

**Files:**
- `src/conductor/src/execution/codex-provider.ts`
- `src/conductor/test/execution/codex-provider.test.ts`

**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invoke`
**Dependencies:** Task 1

### Task 5: Preserve Codex timing on interactive, failure, and skip paths
**Story:** Story 1 — Codex negative paths
**Type:** negative-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing tests for interactive completion, non-zero exit, permission/auth/rate classifications,
   and readiness failure; assert started processes retain intervals and readiness rejection starts no
   model-process interval.
2. Run the focused Codex tests and verify RED.
3. Route intervals through `invokeInteractive` and `classifyCompletion`, leaving readiness, automatic
   permission review, JSONL usage, and all recovery decisions unchanged.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `feat: retain codex timing on all outcomes`.

**Files:**
- `src/conductor/src/execution/codex-provider.ts`
- `src/conductor/test/execution/codex-provider.test.ts`

**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invokeInteractive, src/conductor/src/execution/codex-provider.ts#CodexProvider.classifyCompletion`
**Dependencies:** Task 4

### Task 6: Accumulate every model-ladder interval
**Story:** Story 1 — failed/retried model fallback path
**Type:** happy-path
**Priority:** Critical (v1)
**Build estimate:** 4 minutes

**Steps:**
1. Add a failing model-availability test where two unavailable models precede success and assert the
   terminal result contains all three ordered intervals; add recovery/no-ladder cases that retain only
   the process actually started.
2. Run the model-availability test and verify RED.
3. Concatenate prior attempt intervals into the recursively resolved result without changing model
   dead-set, warning, auth, rate-limit, or session precedence.
4. Re-run the focused test and verify GREEN.
5. Commit with message: `feat: retain model fallback timing intervals`.

**Files:**
- `src/conductor/src/engine/model-availability.ts`
- `src/conductor/test/engine/model-availability.test.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.runAutonomous, src/conductor/src/engine/provider-execution.ts#invokeProviderCandidate`
**Dependencies:** Task 3, Task 5

### Task 7: Attribute intervals across provider candidates and skips
**Story:** Story 1 — provider fallback, retry, and cached-skip evidence
**Type:** happy-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing provider-execution tests for failed preferred provider plus successful fallback, model
   fallback within one candidate, retry metadata, and cached skipped candidates.
2. Run the provider-execution test and verify RED.
3. Add plural intervals to `ProviderAttemptMetadata`; copy all invoked result intervals at
   `buildProviderAttemptMetadata`, aggregate every attempt into `ProviderExecutionResult`, and attach
   none when `providerInvocationSkipped` is true.
4. Re-run the focused test and verify GREEN.
5. Commit with message: `feat: attribute provider attempt timing`.

**Files:**
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/test/engine/provider-execution.test.ts`

**Wired-into:** `src/conductor/src/engine/provider-execution.ts#executeProviderCandidates, src/conductor/src/daemon-cli.ts#beginFeatureRun`
**Dependencies:** Task 6

### Task 8: Preserve intervals in primary step-result conversions
**Story:** Story 1 — scalar and provider-aware propagation matrix
**Type:** infrastructure
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing table-driven tests for autonomous scalar, provider-aware success, provider-aware
   failure, and streaming conversion, with a sentinel interval at each input.
2. Run the step-runner tests and verify RED at every conversion that drops the sentinel.
3. Add intervals to `StepRunResult`, `providerAttribution`, `toStepRunResult`, streaming runtimes, and
   normal return adapters without re-deriving or mutating them.
4. Re-run the focused tests and verify GREEN across the table.
5. Commit with message: `feat: propagate timing through step results`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/step-runners.test.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#DefaultStepRunner.toStepRunResult, src/conductor/src/engine/conductor.ts#Conductor.run`
**Dependencies:** Task 7

### Task 9: Close grouped and auxiliary propagation gaps
**Story:** Story 1 — grouped and auxiliary conversion matrix
**Type:** negative-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing sentinel tests for build-review one-shot, grouped validation, retry/resume, and auxiliary
   verifier paths, including failure returns that previously rebuilt `StepRunResult` scalars.
2. Run the focused step-runner/conductor tests and verify RED at any dropped boundary.
3. Thread existing interval lists through the named wrappers and terminal failure result; do not add
   provider calls or change branch/retry outcomes.
4. Re-run the focused tests and verify GREEN for the complete propagation matrix.
5. Commit with message: `fix: close provider timing propagation gaps`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/src/engine/group-core.ts`
- `src/conductor/test/engine/step-runners.test.ts`
- `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run, src/conductor/src/engine/group-core.ts#runGroupBranch`
**Dependencies:** Task 8

### Task 10: Persist provider intervals on existing feature events
**Story:** Story 1 — durable transient evidence and skipped negative path
**Type:** infrastructure
**Priority:** Critical (v1)
**Build estimate:** 4 minutes

**Steps:**
1. Add failing event-schema and feature-persistence tests asserting provider attempts and scalar
   terminal events retain plural intervals, while cached skips omit them.
2. Run the focused event and daemon-provider persistence tests and verify RED.
3. Extend existing `provider_attempt`, `step_completed`, and applicable `step_failed` payloads; emit
   the already-observed lists through existing feature-scoped persistence without a new sink or I/O.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `feat: persist provider timing evidence`.

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/event-persister.test.ts`
- `src/conductor/test/integration/daemon-provider-event-persistence.integration.test.ts`

**Wired-into:** `src/conductor/src/engine/event-persister.ts#EventPersister.persist`
**Dependencies:** Task 9

### Task 11: Record explicit serial active-step intervals
**Story:** Story 3 — serial happy path and parked-gap negative path
**Type:** happy-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing EventPersister tests with an injected clock for start→complete, start→fail, sequential
   steps separated by a large idle gap, and a persistence timestamp that differs from interval time.
2. Run the focused EventPersister test and verify RED.
3. Track open serial step starts inside the feature-local persister and append one explicit active
   interval to the first matching terminal record; keep `ts` audit-only and omit idle gaps.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `feat: persist serial active step intervals`.

**Files:**
- `src/conductor/src/engine/event-persister.ts`
- `src/conductor/test/engine/event-persister.test.ts`

**Wired-into:** `src/conductor/src/engine/event-persister.ts#startFeatureEventPersistence`
**Dependencies:** Task 1

### Task 12: Record concurrent-group active intervals and incomplete evidence
**Story:** Story 3 — concurrent happy path and incomplete-step negatives
**Type:** negative-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing persistence tests for `parallel_started`→completed, multi-failure groups, overlapping
   serial/group records, duplicate terminals, and a start with no terminal event.
2. Run the EventPersister and parallel integration tests and verify RED.
3. Pair group lifecycle events on the same injected clock, close a group once, preserve unmatched
   starts as detectable evidence, and avoid serializing or cancelling branches.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `feat: persist concurrent active intervals`.

**Files:**
- `src/conductor/src/engine/event-persister.ts`
- `src/conductor/test/engine/event-persister.test.ts`
- `src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts`

**Wired-into:** `same as Task 11`
**Dependencies:** Task 11

### Task 13: Implement deterministic interval union
**Story:** Story 2 — all happy and malformed interval corpus paths
**Type:** infrastructure
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Write a failing pure unit corpus for disjoint, overlapping, nested, adjacent, duplicate, reversed,
   non-finite, and shuffled intervals with exact expected unions.
2. Run `npx vitest run test/engine/timing-rollup.test.ts --reporter=dot --silent` and verify RED.
3. Implement validation, deterministic sorting/merging, union duration, and interval intersection as
   pure helpers; invalid inputs are reported rather than inflating totals.
4. Re-run the focused test and verify GREEN.
5. Commit with message: `feat: add overlap-safe interval union`.

**Files:**
- `src/conductor/src/engine/timing-rollup.ts`
- `src/conductor/test/engine/timing-rollup.test.ts`

**Wired-into:** `src/conductor/src/engine/timing-rollup.ts#computeTimingRollup`
**Dependencies:** Task 1

### Task 14: Compute a measured feature-time partition
**Story:** Story 3 — measured happy paths
**Type:** happy-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing ledger fixtures with overlapping provider processes and overlapping active steps; assert
   exact integer `active = provider-active + no-provider-active` and failed/retry occupancy inclusion.
2. Run the timing-rollup test and verify RED.
3. Implement `computeTimingRollup` over feature events, union active intervals, union provider
   intervals, intersect provider time with active time, round once, and derive the residual by
   subtraction with `state: measured`.
4. Re-run the focused test and verify GREEN.
5. Commit with message: `feat: compute feature timing partition`.

**Files:**
- `src/conductor/src/engine/timing-rollup.ts`
- `src/conductor/test/engine/timing-rollup.test.ts`

**Wired-into:** `src/conductor/src/engine/shipped-record-cli.ts#dispatchShippedRecord`
**Dependencies:** Task 10, Task 12, Task 13

### Task 15: Classify partial and unavailable timing honestly
**Story:** Story 3 — evidence-state negative paths, with Story 5 mixed-version compatibility
**Type:** negative-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing fixtures for malformed JSON/intervals, invoked attempts missing intervals, unmatched
   starts, provider intervals outside active execution, provider-only evidence, no evidence, and
   mixed-version ledgers.
2. Run the timing-rollup test and verify RED.
3. Implement fail-soft `partial`/`unavailable` classification, never emit negative or fabricated-zero
   components, and keep valid evidence visible only when its meaning remains trustworthy.
4. Re-run the focused test and verify GREEN.
5. Commit with message: `feat: classify incomplete timing evidence`.

**Files:**
- `src/conductor/src/engine/timing-rollup.ts`
- `src/conductor/test/engine/timing-rollup.test.ts`

**Wired-into:** `same as Task 14`
**Dependencies:** Task 14

### Task 16: Render an additive shipment Time section
**Story:** Story 4 — durable shipment rendering, with Story 5 additive compatibility
**Type:** happy-path
**Priority:** Critical (v1)
**Build estimate:** 4 minutes

**Steps:**
1. Add failing renderer tests for measured, partial, and unavailable Time blocks plus byte-stable
   frontmatter and semantically unchanged Cost/provider-duration fixtures.
2. Run the shipped-record tests and verify RED.
3. Add a separate `## Time` renderer with explicit state and optional integer fields after existing
   body content; leave `parseShippedRecord` frontmatter and `## Cost` rendering unchanged.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `feat: render durable shipment timing`.

**Files:**
- `src/conductor/src/engine/shipped-record.ts`
- `src/conductor/test/engine/shipped-record.test.ts`

**Wired-into:** `src/conductor/src/engine/shipped-record-cli.ts#dispatchShippedRecord`
**Dependencies:** Task 15

### Task 17: Wire timing into shipped-record creation without blocking ship
**Story:** Story 4 — writer integration and failure negative path
**Type:** infrastructure
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing shipped-record CLI tests proving Cost and Time are computed independently, committed
   together, and a missing/corrupt ledger or timing-rollup exception never blocks shipment.
2. Run the shipped-record CLI and existing cost acceptance tests and verify RED only on missing Time.
3. Invoke `computeTimingRollup` beside `computeCostRollup`, append the Time section to whichever safe
   base record is available, and retain existing idempotent git/dedup behavior.
4. Re-run the focused tests and verify GREEN with Cost/frontmatter regressions intact.
5. Commit with message: `feat: commit timing with shipped records`.

**Files:**
- `src/conductor/src/engine/shipped-record-cli.ts`
- `src/conductor/src/engine/shipped-record.ts`
- `src/conductor/test/engine/shipped-record.test.ts`
- `src/conductor/test/acceptance/per-feature-cost-rollup-committed-at-ship.acceptance.test.ts`

**Wired-into:** `src/conductor/src/engine/shipped-record-cli.ts#dispatchShippedRecord`
**Dependencies:** Task 16

### Task 18: Parse and report measured timing in conduct kpi
**Story:** Story 4 — durable report happy path
**Type:** happy-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing KPI tests for a measured Time section, per-feature active/provider/no-provider output,
   and measured-only aggregate counts/averages with an exact displayed partition.
2. Run the KPI report test and verify RED.
3. Implement a Time parser independent of Cost parsing; extend feature rows and the aggregate/trend
   section while preserving the existing command, exit code, token, and cost output.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `feat: report provider timing in kpi`.

**Files:**
- `src/conductor/src/engine/kpi-report.ts`
- `src/conductor/test/engine/kpi-report.test.ts`

**Wired-into:** `src/conductor/src/engine/kpi-cli.ts#dispatchKpi`
**Dependencies:** Task 16

### Task 19: Make timing reports historical and corruption tolerant
**Story:** Story 5 — all reader negative paths
**Type:** negative-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add failing KPI fixtures for no Time section, partial/unavailable sections, malformed numerics,
   missing fields, mixed-version data, and unknown future fields beside a valid record.
2. Run the KPI report test and verify RED.
3. Return explicit unavailable/partial states, exclude them from measured averages, ignore unknown
   additive fields, and continue rendering all other feature and Cost data without throwing.
4. Re-run the focused tests and verify GREEN.
5. Commit with message: `fix: tolerate incomplete shipment timing`.

**Files:**
- `src/conductor/src/engine/kpi-report.ts`
- `src/conductor/test/engine/kpi-report.test.ts`

**Wired-into:** `same as Task 18`
**Dependencies:** Task 18

### Task 20: Prove ship-to-report durability after workspace removal
**Story:** Story 4 — end-to-end durability, with Story 5 history/additive compatibility
**Type:** negative-path
**Priority:** Critical (v1)
**Build estimate:** 5 minutes

**Steps:**
1. Add a failing acceptance flow using a temp local Git repo, faithful provider/event fixtures, and an
   injected clock: ship a measured feature, retain only its committed record, remove the transient
   workspace, and render KPI beside historical/malformed/future-additive records.
2. Run the new acceptance test and verify RED at the first missing end-to-end timing boundary.
3. Fix only the uncovered internal wiring; keep provider/process/GitHub boundaries fake, cleanup
   awaited, Cost/provider-duration/frontmatter unchanged, and shipment non-blocking.
4. Re-run the acceptance test plus affected neighboring provider, event, shipped-record, cost, and KPI
   files; verify GREEN and no leaked worker or temp state.
5. Commit with message: `test: prove durable provider timing flow`.

**Files:**
- `src/conductor/test/acceptance/durable-provider-time-attribution.acceptance.test.ts`
- `src/conductor/src/engine/shipped-record-cli.ts`
- `src/conductor/src/engine/kpi-report.ts`

**Wired-into:** `none (no new production surface)`
**Dependencies:** Task 17, Task 19

## Task Dependency Graph

```text
Task 1
├── Task 2 → Task 3 ┐
├── Task 4 → Task 5 ├→ Task 6 → Task 7 → Task 8 → Task 9 → Task 10 ┐
├── Task 11 → Task 12 ─────────────────────────────────────────────┤
└── Task 13 ───────────────────────────────────────────────────────┤
                                                                  ↓
              Task 14 → Task 15 → Task 16 ─┬→ Task 17 ────────────┐
                                            └→ Task 18 → Task 19 ─┴→ Task 20
```

The graph is acyclic. Tasks 2–5, 11–12, and 13 may be implemented in parallel only after their named
dependencies; the provider and active-step branches join at Task 14. Writer Task 17 and reader Tasks
18–19 are one v1 delivery unit and must be present before Task 20 or deployment.

## Integration Points

- After Task 7: both built-in adapters, model fallback, and provider fallback expose complete plural
  intervals without changing provider outcomes.
- After Task 10: every provider interval reaches the feature-local event ledger across scalar,
  provider-aware, grouped, retry, and auxiliary paths.
- After Task 15: a feature ledger deterministically yields measured, partial, or unavailable timing;
  concurrent intervals cannot double-count elapsed time.
- After Tasks 17 and 19: shipment writer and KPI reader share a backward-compatible Time contract.
- After Task 20: the full committed-record path remains reportable after transient workspace removal.

## Acceptance-Criterion Coverage

| Story criterion | Task coverage |
|---|---|
| Claude and Codex successful processes produce positive engine intervals | 1, 2, 4 |
| Failed, retried, model-fallback, and provider-fallback processes all contribute | 3, 5, 6, 7, 10, 14 |
| Interactive and self-host paths use the same semantics | 3, 4, 5 |
| Cached/readiness skips that start no model process contribute no interval | 5, 7, 10 |
| Timing never changes provider outcome or recovery decisions | 3, 5, 6, 7, 9, 20 |
| Provider-reported duration and Cost remain unchanged | 3, 5, 16, 17, 20 |
| Overlapping/nested/adjacent/duplicate/shuffled provider intervals union once | 13, 14 |
| Malformed intervals cannot inflate totals and force partial evidence | 13, 15 |
| Active steps union and exactly partition provider/no-provider elapsed time | 11, 12, 14 |
| Concurrent active steps count once | 12, 14 |
| Parked/idle gaps are excluded | 11, 14 |
| Out-of-bounds provider evidence and missing terminals are partial | 12, 15 |
| No trustworthy active timing is unavailable, never measured zero | 15, 19 |
| Measured timing is committed in the shipped record | 16, 17, 20 |
| Reporting survives workspace removal | 18, 20 |
| Partial/unavailable shipment does not block ship | 15, 17, 20 |
| Malformed timing does not suppress other features | 19, 20 |
| Historical no-Time records remain readable and excluded from measured averages | 19, 20 |
| Unknown future fields and mixed-version evidence remain additive/tolerant | 15, 19, 20 |

## Verification

- [ ] Every happy-path criterion maps to at least one task.
- [ ] Every negative-path criterion maps to an explicit negative-path or named fixture task.
- [ ] Every production task starts with a narrow failing test and uses injected clocks/fake providers.
- [ ] No ordinary test can invoke a real LLM or third-party service.
- [ ] No task exceeds five minutes of estimated implementation work.
- [ ] Dependencies are explicit, acyclic, and preserve the writer/reader atomic delivery unit.
- [ ] All new production surfaces have architecture-derived `Wired-into:` call sites.
- [ ] Focused tests, `npm run typecheck:test`, `npm run lint`, `npm test`, and
      `test/test_harness_integrity.sh` pass before implementation is committed.
