# Implementation Plan: Unrecognized remediation dispositions are reported, not dropped

**Date:** 2026-09-04
**Stories:** .docs/stories/an-unrecognized-remediation-disposition-is-dropped.md
**Conflict check:** not required (Tier S)

Stem: an-unrecognized-remediation-disposition-is-dropped
Track: technical
Tier: S
Source: https://github.com/jstoup111/ai-conductor/issues/2187

## Summary

Make `readRemediationPlan` return the dispositions it rejects instead of silently dropping them, put each rejection on the event spine, and halt with a message that names the rejected word, the gap, and the accepted vocabulary when nothing survives. 7 tasks.

## Technical Approach

- **Parser seam (`src/conductor/src/engine/artifacts.ts`).** `RemediationPlan` gains `rejected: RemediationDispositionRejection[]` where each entry is `{ gapId: string; disposition: string; accepted: readonly string[] }`. The `continue` at the vocabulary check becomes a push onto `rejected`. `gapId` is the gap's `id` when it is a string, else `#<index>` (1-based position in `dispositions`). `disposition` is the raw string, `<missing>` when the field is absent, or `JSON.stringify(value)` for a non-string. `accepted` is the same `valid` list already built in the function. The function returns non-null when `gaps`, `invalidTasklessBuild`, or `rejected` is non-empty. Every existing caller reads `gaps`/`invalidTasklessBuild` only, so a fully-recognized input produces `rejected: []` and identical routing.
- **Spine event (`src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/daemon-cli.ts`).** Add `{ type: 'remediation_disposition_rejected'; gapId; disposition; accepted: string[] }` to the `ConductorEvent` union next to `remediation_sealed_artifact_redirect`, register it in `EVENT_SINKS` as `render: true, persist: true, audit: true, otel: false`, and render it in `daemon-cli.ts`'s event switch as `✗ remediation gap <gapId> dropped — disposition "<word>" not in [<accepted>]`. Follow the existing `remediation_sealed_artifact_redirect` triple as the pattern (search hint: that literal in the three files).
- **Routing (`src/conductor/src/engine/conductor.ts`, `planRemediation`).** Immediately after `readRemediationPlan` returns non-null: emit one `remediation_disposition_rejected` per `plan.rejected` entry inside a `try/catch` that swallows emitter errors. Then, if `plan.gaps.length === 0 && !plan.invalidTasklessBuild`, return `{ kind: 'halt', haltClass: 'needs-human', detail: formatRejectedDispositionsHalt(plan.rejected) }` where the detail reads `remediation planner returned no recognized disposition: <gapId> → "<word>"[, …]; accepted dispositions are <accepted joined by ' | '>`. The existing `invalidTasklessBuild` halt and the per-gap `halt` category halt append the same `; dropped: <gapId> → "<word>"…` suffix when `plan.rejected` is non-empty. The `{ kind: 'route' }` result's `evidence` gets the same suffix. All nine `planRemediation` call sites already handle `kind: 'halt'`, so no caller changes.
- **Tests.** One new file `src/conductor/test/engine/remediation-disposition-rejection.test.ts` following `remediation-publication-disposition.test.ts` (temp dir, write `.pipeline/remediation.json`, call `readRemediationPlan` directly; drive `planRemediation` through a `Conductor` with a stub `StepRunner` and a `ConductorEventEmitter` whose emitted events are captured). Vitest, run with `npx vitest run src/conductor/test/engine/remediation-disposition-rejection.test.ts` from `src/conductor`.

## Prerequisites

- none

## Tasks

### Task 1: Parser returns rejected dispositions instead of dropping them

**Story:** Story 1 — happy path 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `readRemediationPlan` on a file whose two gaps carry `existing-task` returns non-null with `gaps: []` and `rejected` of length 2, each entry `{ gapId: 'AB-1' | 'AB-2', disposition: 'existing-task', accepted: [...the valid list] }`.
2. Verify test fails (RED) — today the function returns null.
3. Implement: add `RemediationDispositionRejection` and `rejected` to `RemediationPlan`; replace the vocabulary `continue` with a push; return non-null when `rejected` is non-empty.
4. Verify test passes (GREEN); run the existing `remediation-publication-disposition.test.ts` and `as-built-verdict.test.ts` to confirm fully-recognized inputs still return the same `gaps`.
5. Commit with message: "feat(remediate): parser returns rejected dispositions"

**Done when:**
- `RemediationPlan` has a `rejected: RemediationDispositionRejection[]` field and `readRemediationPlan` returns non-null for an input whose every disposition is unrecognized.
- The new test asserts two rejection entries with the exact `gapId`, `disposition`, and `accepted` values above.
- `remediation-publication-disposition.test.ts` and `as-built-verdict.test.ts` pass unchanged.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Dependencies:** none

### Task 2: Parser names missing and non-string dispositions and id-less gaps

**Story:** Story 1 — negative paths 1 and 2
**Type:** negative-path

**Steps:**
1. Write failing table test: a gap with no `disposition` field yields `disposition: '<missing>'`; a gap with `disposition: 7` yields `disposition: '7'`; a gap with `disposition: { a: 1 }` yields `'{"a":1}'`; a gap with no `id` at array index 2 yields `gapId: '#3'`.
2. Verify test fails (RED).
3. Implement: compute `gapId` as `typeof o.id === 'string' ? o.id : '#' + (index + 1)` and `disposition` via the missing / `JSON.stringify` rule before the vocabulary check.
4. Verify test passes (GREEN).
5. Commit with message: "fix(remediate): render malformed disposition values in rejections"

**Done when:**
- All four table rows pass with the exact strings named in step 1.
- A gap that is not an object is still skipped without producing a rejection entry (existing behavior, asserted by one row).

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Dependencies:** Task 1

### Task 3: Add the `remediation_disposition_rejected` spine event

**Story:** Story 2 — happy path 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `EVENT_SINKS['remediation_disposition_rejected']` equals `{ render: true, persist: true, audit: true, otel: false }`, and a `ConductorEvent` literal of that type with `gapId`, `disposition`, `accepted` type-checks (compile-time assertion in the test file).
2. Verify test fails (RED) — the key is absent.
3. Implement: add the union member in `types/events.ts` beside `remediation_sealed_artifact_redirect`, register the sink, and add a `daemon-cli.ts` switch case rendering `✗ remediation gap <gapId> dropped — disposition "<word>" not in [<accepted>]`.
4. Verify test passes (GREEN) and `npm run typecheck` (or the repo's `tsc` script) passes.
5. Commit with message: "feat(events): remediation_disposition_rejected"

**Done when:**
- `EVENT_SINKS` contains the new key with exactly `render: true, persist: true, audit: true, otel: false`.
- `daemon-cli.ts` has a `case 'remediation_disposition_rejected'` that logs the gap id, the word, and the accepted list.
- The exhaustive-event tests already in the repo (if any enumerate sinks) pass.

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Dependencies:** none

### Task 4: `planRemediation` emits rejections and halts naming them when nothing survives

**Story:** Story 1 — happy path 1
**Type:** happy-path

**Steps:**
1. Write failing test: with a stub `StepRunner` and a remediation file whose gaps are `AB-1 → existing-task`, `AB-2 → existing-task`, `planRemediation` returns `{ kind: 'halt', haltClass: 'needs-human' }`; `detail` contains `AB-1`, `AB-2`, `existing-task`, every accepted word, and does not contain `verdict is BLOCKED`; the captured events contain exactly two `remediation_disposition_rejected` entries in gap order, and both precede any halt-shaped event.
2. Verify test fails (RED) — today the result is `{ kind: 'none' }` and no events are emitted.
3. Implement: after the non-null plan read, loop `plan.rejected` emitting the event; add a private `formatRejectedDispositions(rejected)` helper producing `<gapId> → "<word>"` joined by `, ` plus `; accepted dispositions are <list joined by ' | '>`; return the needs-human halt when `gaps` is empty and `invalidTasklessBuild` is false.
4. Verify test passes (GREEN).
5. Commit with message: "feat(remediate): halt names unrecognized dispositions"

**Done when:**
- For a zero-survivor plan `planRemediation` returns `kind: 'halt'` with `haltClass: 'needs-human'` and never `kind: 'none'`.
- `detail` contains each rejected gap id, each rejected word, and the full accepted vocabulary, and does not contain the substring `verdict is BLOCKED`.
- Exactly one `remediation_disposition_rejected` event per rejected gap is emitted, in array order.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Dependencies:** Task 1, Task 3

### Task 5: No events for recognized input; halt survives an emitter failure

**Story:** Story 2 — negative paths 1 and 2
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a plan with `AB-1 → build` (with one task) emits zero `remediation_disposition_rejected` events and returns the same `kind: 'route'` target as before this feature; (b) with an emitter whose `emit` throws for `remediation_disposition_rejected`, the zero-survivor plan still returns the Task 4 halt with the full `detail`.
2. Verify (b) fails (RED) — an uncaught emit rejects `planRemediation`; (a) must pass already and is kept as the regression guard.
3. Implement: wrap the per-rejection emit in `try/catch` that discards the error.
4. Verify both pass (GREEN).
5. Commit with message: "fix(remediate): rejection events never block the halt"

**Done when:**
- Test (a) asserts zero rejection events for a fully-recognized plan.
- Test (b) asserts the halt `detail` is identical with a throwing emitter and a capturing emitter.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Dependencies:** Task 4

### Task 6: Mixed output routes the recognized gap and reports the dropped one

**Story:** Story 3 — happy path 1
**Type:** happy-path

**Steps:**
1. Write failing test: gaps `AB-1 → build` (one task) and `AB-2 → existing-task`; `planRemediation` returns `{ kind: 'route', target: 'build' }`, `evidence` contains `AB-2` and `existing-task`, the plan file receives AB-1's task exactly as the existing append test proves, and exactly one rejection event is emitted for AB-2.
2. Verify test fails (RED) — `evidence` lacks the dropped gap today.
3. Implement: append `; dropped: <formatRejectedDispositions>` to the route result's `evidence` when `plan.rejected` is non-empty.
4. Verify test passes (GREEN); rerun Task 5 test (a) to confirm the suffix is absent when nothing is rejected.
5. Commit with message: "feat(remediate): route evidence names dropped dispositions"

**Done when:**
- The mixed-input test asserts `kind: 'route'`, `target: 'build'`, one rejection event for AB-2, and `evidence` containing `AB-2`.
- A fully-recognized input's `evidence` does not contain the substring `dropped:`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Dependencies:** Task 4

### Task 7: Existing taskless-build and category halts also list dropped dispositions

**Story:** Story 3 — negative paths 1 and 2
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) gaps `AB-1 → build` with no tasks (source not a build-stall) and `AB-2 → existing-task` return the existing "no dispatchable build work" halt whose `detail` also contains `AB-2` and `existing-task`; (b) gaps `AB-1 → halt` with category `product-scope` and `AB-2 → existing-task` return the existing category halt whose `detail` also contains `AB-2` and `existing-task`.
2. Verify both fail (RED).
3. Implement: append the `; dropped: …` suffix to those two halt `detail` strings when `plan.rejected` is non-empty.
4. Verify both pass (GREEN).
5. Commit with message: "fix(remediate): existing halts name dropped dispositions"

**Done when:**
- Test (a) asserts the taskless-build halt detail still starts with its current text and contains `AB-2`.
- Test (b) asserts the category halt detail still contains the category and rationale and contains `AB-2`.
- Both halts are unchanged in text when `plan.rejected` is empty (asserted by reusing Task 5 test (a)'s fixture with the existing halt cases).

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Dependencies:** Task 4

## Task Dependency Graph

```
Task 1 ─┬─ Task 2
        └─ Task 4 ─┬─ Task 5
Task 3 ─┘          ├─ Task 6
                   └─ Task 7
```

## Integration Points

- After Task 4: a hand-written `.pipeline/remediation.json` with an unknown word produces the named halt and two spine events in a local `conduct` run.
- After Task 6: the #2119 worktree's actual `remediation.json` (three `existing-task` gaps) reproduces the named halt end to end.

## Coverage

| Criterion | Task |
|---|---|
| Story 1 happy 1 (named halt) | 4 |
| Story 1 happy 2 (no generic BLOCKED text) | 4 |
| Story 1 negative 1 (missing/non-string disposition) | 2 |
| Story 1 negative 2 (missing id → position) | 2 |
| Story 2 happy 1 (event per rejection, persisted + rendered) | 3, 4 |
| Story 2 happy 2 (events precede halt, agree with detail) | 4 |
| Story 2 negative 1 (recognized input emits none) | 5 |
| Story 2 negative 2 (emitter throw does not block halt) | 5 |
| Story 3 happy 1 (mixed routes + evidence names dropped) | 6 |
| Story 3 happy 2 (fully recognized unchanged) | 1, 5, 6 |
| Story 3 negative 1 (taskless build halt names dropped) | 7 |
| Story 3 negative 2 (category halt names dropped) | 7 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
