# Implementation Plan: Render build_review rubric events in the daemon log

**Date:** 2026-09-06
**Stories:** .docs/stories/render-build-review-rubric-events-in-the-daemon-lo.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the slice adds cases to one existing renderer switch, reads only fields the current union already declares, and changes no emitter, so it cannot interact with in-flight work except by ordinary textual merge in that one file.

## Summary

Five bounded tasks deliver #1592 by adding daemon-log renderer cases for the six build_review rubric events that already ride the event spine. The union, the emitters, the persisted ledger, the TTY dashboard, and the operator viewer question owned by #1585 are outside this slice.

## Technical Approach

The whole change lives in `renderDaemonEventUnsafe` in `src/conductor/src/daemon-cli.ts`. That switch already renders `build_review_cache_discarded`, `build_review_base`, and `build_review_stale_mirage_regrade`, and ends in `default: break;`, which is why the six rubric events are silently dropped today. New cases are added next to the existing build_review cases and follow the conventions those cases already establish: a leading dimmed `·`, an optional glyph, and a message whose first token names the step. `renderDaemonEvent` wraps the switch in a try/catch, so a formatting fault degrades to one dropped line; nothing in this slice weakens that.

Attribution is delivered by adjacency, not by enriching the provider event. `build_review_rubric_started` is emitted for each cache miss before the fan-out dispatches, so a labeled start line lands immediately before the `build_review via <provider>` line the operator already sees, and the set of start lines with no matching settle line is exactly the outstanding set. Changing `provider_attempt` to carry a rubric would be a union change, which the stories' machine-consumer criterion forbids.

Every rubric event carries `lapId`. Each rendered rubric line carries a short lap tag — the first eight characters of `lapId` — so two laps interleaved in one log file stay separable. This matters because a rejected rubric discards a whole lap and a stale aggregate can replay settled findings, and diagnosing that starts with knowing which lap a line belongs to. The tag is derived at render time from a field already on the event; nothing is stamped anywhere.

Line shapes, all rendered with the step name first so existing `grep build_review` habits keep working: a start line marks the rubric started; a cache-hit line marks it served from cache; a result line states `PASS` or `FAIL` as judged; a skip line states `skipped` with the event's reason; an infrastructure-failure line states `infrastructure failure` with the event's reason and, when present, its excerpt — deliberately different wording from the judged `FAIL` line so the two never read alike; and the outer-verdict line states the effective verdict, adds the raw verdict only when it differs, and appends the deterministic reason and the unresolved-marker count when the event supplies them. `reason`, `excerpt`, and `unresolvedMarkers` are optional in the union, so each is read defensively and omitted from the line when absent.

Tests follow the local renderer pattern established by `src/conductor/test/daemon-render-provider-attempt.test.ts`: mock `execa` at module scope so importing the daemon module pulls no process dependency, import `renderDaemonEvent`, set `chalk.level = 0` in `beforeEach` and restore it in `afterEach`, and collect lines through an injected `log` callback. Search for sibling `daemon-render-*` test files when a comparable assertion shape is needed. These are unit tests over a pure synchronous formatter: no Conductor run, no provider, no filesystem, no network. Allowed variation is the fixture-builder shape and the grouping of cases into `describe` blocks; what must not vary is that the subject is the exported renderer and the observation is the collected line text. No exact-copy pattern declaration applies.

All five tasks edit the same switch and the same new test file, so they are genuinely serialized rather than merely narratively ordered.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the rendering-only boundary, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/daemon-cli.ts` exports `renderDaemonEvent`, which calls `renderDaemonEventUnsafe` inside a try/catch whose comment states a throwing formatter must degrade to a dropped line, not a crash.
- Verified: that switch's final clause is `default: break;`, and it contains no case for any of the six rubric events; its existing build_review cases are `build_review_cache_discarded`, `build_review_base`, and `build_review_stale_mirage_regrade`.
- Verified: `src/conductor/src/types/events.ts` declares all six variants — `build_review_rubric_started`, `build_review_rubric_result` (`verdict: 'PASS' | 'FAIL'`), `build_review_rubric_skipped` (`reason`), `build_review_cache_hit`, `build_review_rubric_infrastructure_failure` (`reason`, optional `excerpt`), and `build_review_outer_verdict` (`rawVerdict`, `effectiveVerdict`, optional `reason`, optional `unresolvedMarkers`) — and every one of them carries `lapId`.
- Verified: `src/conductor/src/engine/build-review-coordinator.ts` emits the started, result, skipped, cache-hit, infrastructure-failure, and outer-verdict events on live paths, and `src/conductor/src/engine/step-runners.ts` emits the outer verdict, so no rendered case is dead code.
- Verified: the rubric registry currently enables exactly one rubric, so a lap's fan-out is width one today; labeling remains required because the log still shows two unattributed provider lines per lap and no per-rubric verdict at all.
- Verified: the live daemon log renders a settled lap as `build_review via claude (opus)` provider lines followed by `build_review ✓ done`, with no rubric name and no per-rubric outcome.
- Verified: `src/conductor/test/daemon-render-provider-attempt.test.ts` mocks `execa`, imports `renderDaemonEvent`, and neutralizes color by setting `chalk.level = 0`; it is the pattern this slice reuses.
- Verified: the repository's authoring commands are `npm test -- test/<path>.test.ts` for one file and `npm run typecheck:test` for the typecheck target that covers the test directory, both run from the engine package directory.
- Scope check: consumer-facing engine behavior; no skill addition; provider-agnostic. Event spine: no new channel, existing union consumed only.
- Verify-claims verdict: CLEAR. No unconfirmed assumption remains that would change the approach or the task breakdown.

## Tasks

### Task 1: Label a rubric branch when it starts and when it is cached
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-build-review-rubrics.test.ts
**Dependencies:** none

**Steps:**
1. Create the new renderer unit-test file, following the local pattern: mock `execa` at module scope, import the exported `renderDaemonEvent`, set `chalk.level = 0` in `beforeEach` and restore the original level in `afterEach`, and collect lines through an injected callback. Search the sibling `daemon-render-*` test files for a comparable fixture shape rather than inventing one.
2. Write failing cases asserting that a rubric start event renders one line naming the step, naming the rubric, marking it started, and carrying a short lap tag, and that a cache-hit event for the same rubric renders a line marking it served from cache.
3. Verify both fail (RED) against the current `default: break;` fall-through.
4. Add the two cases to the switch beside the existing build_review cases, deriving the lap tag from the first eight characters of the event's lap identifier, and reusing the file's existing dimmed-dot and glyph conventions.
5. Verify both pass (GREEN), run the file's narrow test invocation and the typecheck target that covers the test directory, and commit.

**Done when:**
1. A rendered start line contains the step name, the rubric name, and a started marker.
2. A rendered cache-hit line for the same rubric is textually distinguishable from the start line.
3. Both new lines contain no serialized JSON object.
4. The narrow test invocation for the new file passes and the test-inclusive typecheck target reports no error.

### Task 2: Keep two laps' rubric lines separable
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-build-review-rubrics.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing case that renders two start events for the same rubric under two different lap identifiers and asserts the two lines differ, with each carrying the tag derived from its own identifier.
2. Write a failing case for a lap identifier shorter than the tag length, asserting the line renders the whole identifier without throwing and without padding.
3. Verify both fail (RED).
4. Extract the lap-tag derivation into one small local helper in the renderer file and use it from every rubric case, so the tag cannot drift between cases.
5. Verify both pass (GREEN), rerun the narrow test invocation, and commit.

**Done when:**
1. Two rendered lines for one rubric under different lap identifiers carry different lap tags.
2. A lap identifier shorter than the tag length renders in full without throwing.
3. Every rubric case in the switch derives its tag through the single shared helper.

### Task 3: State the judged verdict and the neutral skip
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-build-review-rubrics.test.ts
**Dependencies:** 2

**Steps:**
1. Write failing cases asserting that a rubric result event renders one line naming the rubric and stating `PASS`, that a result event with the failing verdict renders one line stating `FAIL`, and that a skip event renders one line naming the rubric, marking it skipped, and carrying the event's reason verbatim.
2. Assert in the skip case that the line contains no failure wording, so a neutral skip can never be read as a judged failure.
3. Verify all three fail (RED).
4. Add the result and skip cases to the switch, reusing the file's existing success, failure, and skip glyph conventions.
5. Verify all three pass (GREEN), rerun the narrow test invocation, and commit.

**Done when:**
1. A result line names the rubric and states PASS or FAIL as judged.
2. A skip line carries its reason verbatim and contains no failure wording.
3. The result and skip lines contain no serialized JSON object.

### Task 4: State the lap's outer verdict
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-build-review-rubrics.test.ts
**Dependencies:** 3

**Steps:**
1. Write failing cases for four outer-verdict shapes: raw and effective agreeing, raw and effective differing, a deterministic pass reason present, and an unresolved-marker list present.
2. Assert the agreeing case names the verdict once, the differing case names both the raw and the effective verdict, the reason case carries the reason, and the marker case carries the marker count.
3. Verify all four fail (RED).
4. Add the outer-verdict case to the switch, reading the optional reason and marker fields defensively and omitting each fragment when its field is absent.
5. Verify all four pass (GREEN), rerun the narrow test invocation, and commit.

**Done when:**
1. An outer-verdict line whose raw and effective verdicts agree names that verdict once.
2. An outer-verdict line whose raw and effective verdicts differ names both.
3. A deterministic pass reason and an unresolved-marker count appear only when the event supplies them.

### Task 5: Separate infrastructure failure from judged failure and keep the stream machine-safe
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-build-review-rubrics.test.ts
**Dependencies:** 4

**Steps:**
1. Write a failing case asserting that an infrastructure-failure event renders one line naming the rubric, wording the outcome as an infrastructure failure, and carrying the event's reason.
2. Write a failing case asserting the excerpt appears when supplied and that an event with no excerpt renders without a trailing empty fragment and without throwing.
3. Write a failing case that renders the infrastructure-failure line and the judged failure line for one rubric and asserts the two differ with color disabled, so the distinction survives a plain-text log.
4. Write a failing case that renders all six event kinds through the renderer and asserts that no produced line contains a serialized JSON object, and a case that passes a frozen event through the renderer and asserts the object is structurally identical afterwards.
5. Verify the set fails (RED), add the infrastructure-failure case to the switch, verify GREEN, then run the narrow test invocation, the test-inclusive typecheck target, and the lint command, and commit.

**Done when:**
1. An infrastructure-failure line names the rubric and words its outcome differently from the judged failure line with color disabled.
2. The failure reason always appears and the excerpt appears only when the event supplies one.
3. Rendering all six event kinds produces no line containing a serialized JSON object.
4. A frozen event rendered by the daemon is structurally identical afterwards.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a rubric branch begins a fresh dispatch, when the daemon renders its start event, then the log line names the build_review step, names that rubric, and marks the branch as started. | 1 | "A rendered start line contains the step name, the rubric name, and a started marker." | diff-local |
| Story 1 happy: Given a rubric branch is served from a cached judgement, when the daemon renders its cache-hit event, then the log line names that rubric and marks the branch as served from cache rather than freshly dispatched. | 1 | "A rendered cache-hit line for the same rubric is textually distinguishable from the start line." | diff-local |
| Story 1 negative: Given two rubric events for the same rubric belong to different laps, when the daemon renders both, then each line carries a short lap tag derived from its own lap identifier so the two branches are not conflated. | 2 | "Two rendered lines for one rubric under different lap identifiers carry different lap tags." | diff-local |
| Story 2 happy: Given a rubric branch settles with a judged verdict, when the daemon renders its result event, then the log line names that rubric and states PASS or FAIL as judged. | 3 | "A result line names the rubric and states PASS or FAIL as judged." | diff-local |
| Story 2 happy: Given a rubric branch is neutrally skipped before dispatch, when the daemon renders its skip event, then the log line names that rubric, marks it skipped rather than failed, and carries the skip reason. | 3 | "A skip line carries its reason verbatim and contains no failure wording." | diff-local |
| Story 2 happy: Given a lap reaches its outer verdict, when the daemon renders that event, then the log line states the effective verdict, additionally states the raw verdict whenever the two differ, and carries the deterministic pass reason and unresolved-marker count when the event supplies them. | 4 | "An outer-verdict line whose raw and effective verdicts differ names both." | diff-local |
| Story 2 negative: Given a rubric branch ends in an infrastructure failure, when the daemon renders that event, then the log line names that rubric, is textually distinct from a judged FAIL line, and carries the failure reason together with the excerpt when one is supplied. | 5 | "An infrastructure-failure line names the rubric and words its outcome differently from the judged failure line with color disabled." | diff-local |
| Story 2 negative: Given any of the six build_review rubric events is rendered, when the daemon produces its log lines, then no line contains a serialized JSON object and the event object passed to the renderer is left unchanged. | 5 | "Rendering all six event kinds produces no line containing a serialized JSON object." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: the subject is a pure synchronous formatter over an in-memory event, and no commit outside this diff can change whether a rendered line names its rubric. Unit level is the lowest sufficient layer for all of them, and the exported `renderDaemonEvent` is the entry point the daemon itself calls, so a unit test of that export is also the integration proof — there is no intervening wiring between the daemon's event subscription and this function. Task 1 owns the in-flight labeling cases, Task 2 owns lap separability, Task 3 owns judged verdict and neutral skip, Task 4 owns the outer verdict, and Task 5 owns the infrastructure-failure distinction plus the cross-cutting machine-safety assertions over all six kinds. No third-party boundary is reached, so no fake is required and no smoke test is added. No aggregate or end-to-end test is introduced and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 3 -> Task 4
Task 4 -> Task 5

Small tier: architecture and coherence artifacts are skipped. No ADR is created or amended, because the event union, its emitters, and every consumer contract are unchanged.
