# Implementation Plan: Accept the documented unanswerable halt category

**Date:** 2026-09-06
**Stories:** .docs/stories/accept-the-documented-unanswerable-halt-category-a.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing remediation contract — the halt vocabulary the published skill already documents, the typed rejection record and rejection event already shipped for unrecognized dispositions, and the unchanged routing behavior of halt gaps.

## Summary

Four bounded tasks deliver #1076. The parser gains the third halt category its published contract already documents, and a halt category outside that vocabulary — or absent entirely — becomes a named rejection on the path unrecognized dispositions already travel, instead of a silent drop that makes the whole plan look missing or invalid. Halt-class policy, retry behavior, remediation routing targets, and the remediation skill's own text are outside this slice.

## Technical Approach

Widen `RemediationHaltCategory` in the engine's artifact reader to the three-member union the published remediation contract documents, and widen the category narrowing in `readRemediationPlan` to match. The two existing operator-facing detail strings in the conductor interpolate the category verbatim, and nothing switches on the union, so widening it changes no routing and adds no exhaustiveness obligation. Correct the step-type comment that still names only two accepted categories, so the two in-code statements of the vocabulary cannot drift apart again.

Replace the bare `continue` that drops a halt gap whose category did not survive narrowing. Push a record onto the same `rejected` array the parser already fills for unrecognized dispositions, carrying the gap id, the rejected value rendered the way an unrecognized disposition value is rendered today (including a missing-value marker when the field is absent), and the accepted category vocabulary. Distinguish the two rejection kinds with one additive field on the existing rejection record naming which field was rejected, defaulting to the disposition so every existing producer and consumer keeps its current meaning. This preserves the parser's existing tolerance contract: a rejected halt category degrades one gap, never the whole file, and an absent, stale, or unparseable file still returns null exactly as it does now.

Make the conductor's rejection formatter field-aware so the operator halt reads as a rejected category with the accepted category vocabulary, rather than borrowing the disposition wording. Add the same optional field to the existing rejection event variant in the event union — an additive optional field on a variant the bus already carries, not a new channel and not a new variant — and let the existing emit loop carry it. Teach the daemon renderer and the audit-trail mapper to use the field name in their message, defaulting to the disposition wording when the field is absent so every existing fixture and every already-persisted event renders unchanged.

Tests follow the repository's test-design rules. Parser cases are unit-level against a temporary directory, which is the boundary under test. Halt, event, and detail cases reuse the existing rejection test file's bounded conductor fixture, which injects its step runner and stops at the remediation outcome rather than running a lifecycle. Renderer cases reuse the existing daemon-render and audit-trail fixtures, which are pure functions over one event. No third party is contacted at any level. Tests may vary fixture builders and assertion grouping; they must preserve the observable boundary proof named in each task.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, both stories, and the direction of the vocabulary fix on 2026-09-06 (delegated); the issue already carries the operator's `size: S` label.
- Verified: `src/conductor/src/engine/artifacts.ts` declares `RemediationHaltCategory` as a two-member union, narrows `o.category` against those two literals, and then drops a halt gap with a null category using a bare `continue`.
- Verified: the same function already builds a typed `rejected` array for unrecognized dispositions, renders a missing value as an explicit marker, and returns a plan when gaps, that array, or the taskless-build flag is non-empty.
- Verified: `src/conductor/src/engine/conductor.ts` emits one rejection event per rejected disposition, formats them through a single helper, and folds that text into both the no-recognized-disposition halt and the halt-gap detail; its two halt-detail strings interpolate the gap category verbatim, and nothing else reads the category.
- Verified: `src/conductor/src/types/events.ts` declares the rejection event variant with gap id, disposition, and accepted list; `src/conductor/src/engine/event-sinks.ts` already routes it to render, persist, and audit.
- Verified: `src/conductor/src/daemon-cli.ts` and `src/conductor/src/engine/audit-trail.ts` each render that variant with the literal word "disposition"; `src/conductor/src/types/steps.ts` carries a comment naming only two accepted halt categories.
- Verified: the existing rejection test file exercises the parser directly and drives a bounded conductor fixture for the halt outcome, including a case where rejection-event persistence throws; the daemon-render and audit-trail fixtures each assert one rendered line for this variant.
- Verified: the published contract documents three halt categories in the remediate skill's disposition table and JSON field list, in the pipeline skill's halt description, and in the skills reference page; an existing acceptance test asserts that skill text, so no documentation update is owed by this change.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: extend the existing variant with an additive optional field; no new channel and no ADR obligation.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in this worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Accept the third documented halt category
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/src/types/steps.ts, src/conductor/test/engine/remediation-disposition-rejection.test.ts
**Dependencies:** none

**Steps:**
1. Add a failing parser case asserting that a halt gap carrying the documented unanswerable category is retained with that category, and keep companion cases for the two categories already accepted.
2. Establish RED, then widen the halt-category union and the category narrowing in the plan reader to the three documented values. Change nothing else about the gap's construction.
3. Correct the step-type comment that names the accepted halt categories so it states the same three values.
4. Run the focused test file and the typecheck target that covers test files, then commit the focused change.

**Done when:**
1. The parser retains a halt gap whose category is the documented unanswerable value, alongside the two categories it already accepts.
2. Fixtures for the two previously accepted categories return their existing results, and the in-code comment naming the accepted halt categories states the same three values as the parser.

### Task 2: Reject an unaccepted or missing halt category by name
**Story:** Story 1 (negative path)
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/test/engine/remediation-disposition-rejection.test.ts
**Dependencies:** 1

**Steps:**
1. Add failing parser cases for a halt gap whose category is an unaccepted string, a halt gap whose category field is absent, and a halt gap whose category is a non-string value. Assert each becomes a rejection record carrying the gap id, the rendered rejected value, the accepted category vocabulary, and the marker naming the rejected field.
2. Add a failing case asserting a plan whose only gap is the documented unanswerable halt yields a halt outcome through the existing bounded conductor fixture and never the missing-or-invalid plan wording.
3. Add failing cases pinning the boundary: an absent plan file, a plan file predating the session, and a file whose contents are not parseable JSON each return the outcome they return today and produce no rejection record.
4. Establish RED, then add the field marker to the rejection record with the disposition as its default, and replace the bare drop of a null-category halt gap with a rejection push that reuses the existing value-rendering helper logic. Leave the taskless-build and existing-task guards untouched.
5. Run the focused test file and the typecheck target that covers test files, then commit.

**Done when:**
1. A plan whose only gap is the documented unanswerable halt produces a halt naming that gap, and its detail carries no missing-or-invalid plan wording.
2. The parser returns a rejection carrying the gap id, the rejected category value, the accepted category vocabulary, and a marker identifying the rejected field as the category.
3. A halt gap carrying no category yields a rejection whose rendered value marks the category as missing rather than being dropped in silence.
4. Absent, stale, and unparseable plan fixtures return the outcome they return today and produce no rejection record.

### Task 3: Name the rejected category in the operator halt and on the event spine
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/src/types/events.ts, src/conductor/test/engine/remediation-disposition-rejection.test.ts
**Dependencies:** 2

**Steps:**
1. Add failing cases through the existing bounded conductor fixture: a plan whose only gap is a rejected-category halt, and a plan mixing one accepted halt gap with one rejected-category halt gap. Assert the halt detail names the gap id, the rejected category value, and the accepted category vocabulary, and that the mixed case still halts on the accepted gap.
2. Add a failing case asserting the emitter observes one rejection event per rejected category carrying the field marker, so a rejected category is distinguishable from a rejected disposition.
3. Establish RED, then add the optional field to the existing rejection event variant and pass it through the existing emit loop, leaving every other field and the sink routing untouched.
4. Make the rejection formatter field-aware so a rejected category reads as a category with the accepted category vocabulary, while a rejected disposition keeps its current text byte-for-byte.
5. Run the focused test file and the typecheck target that covers test files, then commit.

**Done when:**
1. The operator halt for a plan whose only gap is a rejected-category halt names the gap id, the rejected category value, and the accepted category vocabulary.
2. A rejection event is observed at the emitter for each rejected category and carries the field marker that distinguishes it from a rejected disposition.
3. A fixture mixing one accepted halt gap with one rejected-category halt gap halts on the accepted gap and names the rejected category in the same detail.
4. Existing rejected-disposition halt and event assertions pass unchanged.

### Task 4: Render the rejected field in daemon output and the audit trail
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/src/engine/audit-trail.ts, src/conductor/test/engine/daemon-render.test.ts, src/conductor/test/integration/audit-trail-completeness.integration.test.ts
**Dependencies:** 3

**Steps:**
1. Add a failing daemon-render case for a rejection event carrying the category field marker, asserting the rendered line names the category as the rejected field, and keep the existing rejected-disposition line assertion unchanged.
2. Add a failing audit-trail case for the same event, asserting the recorded reason uses the same field wording, and keep the existing event fixture for a rejected disposition so the completeness sweep still covers the variant.
3. Establish RED, then derive the field word in both renderers from the event's optional marker, defaulting to the disposition wording so already-persisted events and every existing fixture render exactly as before.
4. Run the two focused test files and the typecheck target that covers test files, then commit.

**Done when:**
1. The daemon render fixture for a rejected category names the category as the rejected field rather than labelling it a disposition.
2. The audit-trail fixture for a rejected category records the same field wording, and existing rejected-disposition fixtures render unchanged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a remediation plan whose only gap is a halt carrying the documented unanswerable category, when the engine reads that plan, then the gap is retained and the resulting halt names the gap id, its category, and its rationale. | 1 | "The parser retains a halt gap whose category is the documented unanswerable value, alongside the two categories it already accepts." | diff-local |
| Story 1 happy: Given halt gaps carrying the two categories the parser already accepts, when the engine reads that plan, then those gaps are retained and reported exactly as they are today. | 1 | "Fixtures for the two previously accepted categories return their existing results, and the in-code comment naming the accepted halt categories states the same three values as the parser." | diff-local |
| Story 1 negative: Given a remediation plan whose only gap is a halt carrying the documented unanswerable category, when remediation planning completes, then the operator is never told the plan was missing or invalid. | 2 | "A plan whose only gap is the documented unanswerable halt produces a halt naming that gap, and its detail carries no missing-or-invalid plan wording." | diff-local |
| Story 2 happy: Given a halt gap whose category is a value the engine does not accept, when the engine reads that plan, then that gap becomes a rejection naming the gap id, the rejected category value, and the accepted category vocabulary. | 2, 3 | "The parser returns a rejection carrying the gap id, the rejected category value, the accepted category vocabulary, and a marker identifying the rejected field as the category." | diff-local |
| Story 2 happy: Given a plan carrying one accepted halt gap and one rejected-category halt gap, when remediation planning completes, then the accepted gap still drives the halt and the rejected category is named in the same operator detail. | 3 | "A fixture mixing one accepted halt gap with one rejected-category halt gap halts on the accepted gap and names the rejected category in the same detail." | diff-local |
| Story 2 happy: Given a rejected halt category reaches daemon output and the audit trail, when each renders that rejection, then it names the category as the rejected field rather than labelling it a disposition. | 4 | "The daemon render fixture for a rejected category names the category as the rejected field rather than labelling it a disposition." | diff-local |
| Story 2 negative: Given a halt gap that carries no category at all, when the engine reads that plan, then the gap is rejected rather than routed, and the operator-visible text marks its category as missing. | 2 | "A halt gap carrying no category yields a rejection whose rendered value marks the category as missing rather than being dropped in silence." | diff-local |
| Story 2 negative: Given the remediation plan file is absent, stale, or not parseable as JSON, when remediation planning runs, then the outcome is unchanged from today and no category rejection is invented. | 2 | "Absent, stale, and unparseable plan fixtures return the outcome they return today and produce no rejection record." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled fixtures. Task 1 and Task 2 own the parser cases at unit level against a temporary directory, which is the boundary under test. Task 2 and Task 3 own the remediation-outcome cases through the existing bounded conductor fixture, which injects its step runner, supplies its own plan file, and stops at the remediation outcome rather than running a lifecycle. Task 3 owns the emitter observation for the rejection event. Task 4 owns the two renderer fixtures, each a pure function over one event. The existing rejected-disposition cases, including the event-persistence-throws case, remain authoritative for the disposition path and are not duplicated. No third-party boundary is reached at any level, and no terminal catch-all validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3 -> Task 4
