# Implementation Plan: Show provider activity age on the build quiet warning

**Date:** 2026-09-28
**Stories:** .docs/stories/show-provider-activity-age-on-the-build-quiet-warn.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the approved intra-step build-progress contract: the same watcher, lifecycle, quiet-episode state machine, and threshold, one additive optional event field, and no new observer.

## Summary

Four bounded tasks deliver #1815 by reading a fact that already exists on disk when the build quiet warning fires, the activity pulse the running provider dispatch stamps into the build worktree, carrying its timestamp on the quiet event the watcher already emits, and naming its age on the daemon warning line that already renders the event beside the last-commit age added by #1715. The quiet threshold, poll cadence, pulse writer, periodic progress tick, stall breaker, interactive terminal renderer, and OpenTelemetry attributes are outside this slice.

## Technical Approach

The heartbeat module already exports a tolerant reader returning a parsed pulse or null for a missing or malformed file, a predicate answering whether a pulse belongs to the dispatch currently running (same step, stamped at or after the dispatch start), and a short age formatter. The watcher is constructed once per build-step attempt and started immediately before the step's await, so the instant the watcher starts is the dispatch boundary the predicate needs. Record that instant from the watcher's injected clock in its start method and hold it for the watcher's life.

On the quiet branch, which has already decided to fire, read the pulse, run the ownership predicate against the held instant and the watcher's step, and when it passes report the parsed timestamp as an additional optional epoch-millisecond field on the quiet event. When the pulse is absent, malformed, owned by another step, or older than the held instant, report nothing and leave every existing field as it is. The read is wrapped so nothing it does can prevent the warning from being emitted on that tick; this is the second desired outcome's hard constraint and why the evidence enriches the existing emission rather than feeding the decision to emit.

Reporting an absolute timestamp rather than an age or a live-or-wedged verdict is deliberate: the age is computed against each reader's own clock, no freshness threshold is invented inside the engine, and the field stays meaningful to every consumer of the persisted event, which is the third desired outcome.

The daemon renderer appends one fragment to its existing quiet case, after the last-commit fragment and before the slug, computing the age against the render clock, clamping a future timestamp to zero, and formatting it with the heartbeat module's exported age formatter. When the field is absent the case renders exactly the string it renders today.

This adds no channel: an existing watcher performs one extra best-effort read on a branch it already reaches, and the fact rides the existing emitter on an existing variant. No sidecar, no second ledger, no new event kind.

Tests follow the repository's test-design guidance. Watcher tests drive the real watcher's private tick against a temporary directory with an injected clock, writing the pulse by hand with a timestamp derived from that clock; the existing quiet-episode fixture block already provides the tick driver, clock, and emitter spy. Renderer tests call the exported daemon renderer with color disabled and a fixed system time. No test reaches a language model, network service, or hosting provider.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, and both stories on 2026-09-28 (delegated); the fact-over-verdict choice repeats the one approved for closed spec PR #2340.
- Verified: #1715 is closed and its implementation shipped; the quiet variant now carries an optional last-commit time and the daemon quiet case renders it through `formatCommitAge`.
- Verified: `src/conductor/src/engine/build-progress-watcher.ts` emits `build_no_progress` from one site in the unchanged-tick branch of `tick()`, guarded by `quietFired`, with `resolved`, `total`, `currentTaskId`, `lastCommitAt`, and `featureSlug` in hand.
- Verified: the watcher's options carry `projectRoot` and an injectable `now` defaulting to `Date.now`, and `start()` is where the dispatch instant can be recorded.
- Verified: `src/conductor/src/engine/conductor.ts` constructs the watcher only for the build step with `projectRoot: this.projectRoot` and starts it immediately before the build step's await, stopping it in a finally.
- Verified: `src/conductor/src/engine/step-heartbeat.ts` exports `readStepHeartbeat`, `heartbeatBelongsToDispatch(heartbeat, step, dispatchStartedAtMs)`, and `formatHeartbeatAge(ageMs)`.
- Verified: `src/conductor/src/engine/step-runners.ts` creates the pulse with `createHeartbeatPulse(this.projectDir, step)` inside `dispatchProviderWithLifecycleSupervision`, writing into the worktree the watcher polls with the same step name; the issue's own evidence shows a pulse naming the build step in the build worktree.
- Verified: the pulse file is overwritten and never cleared, which is why the ownership predicate is required.
- Verified: `src/conductor/src/types/events.ts` declares the quiet variant with optional `currentTaskId`, `lastCommitAt`, and `featureSlug`, so one more optional field needs no persister or exhaustiveness-list change.
- Verified: `src/conductor/src/daemon-cli.ts` renders the quiet case from `displayBuildPosition`, `formatCommitAge`, the step, the quiet minutes, and the slug.
- Verified: `src/conductor/test/build-progress-watcher.test.ts` has a quiet-episode block driving the private tick with an injected clock and an emitter spy; `src/conductor/test/daemon-render-progress.test.ts` calls the exported renderer and collects its lines.
- Verified: the approved decision record `adr-2026-07-10-intra-step-build-progress-events` fixes the watcher lifecycle and quiet determination, neither of which changes; no decision record is created or amended.
- Scope check: A consumer-facing engine and daemon-CLI code, no rules file changes; B no new skill; C provider-agnostic.
- Event spine: no new channel; one additive optional field on an existing variant.
- Verify-claims verdict: CLEAR.

## Tasks

### Task 1: Carry the running dispatch's activity timestamp on the quiet warning
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/build-progress-watcher.ts, src/conductor/test/build-progress-watcher.test.ts
**Dependencies:** none

**Steps:**
1. In the existing quiet-episode block, write failing watcher tests that start the watcher on an injected clock and write the worktree activity pulse by hand as JSON naming the build step with a timestamp derived from that clock.
2. Assert the emitted quiet warning carries an activity timestamp equal to the pulse's timestamp in epoch milliseconds.
3. Assert that with a pulse stamped seconds before the quiet window elapses the warning fires on the first tick past the window and exactly once for the episode.
4. Assert that after progress re-arms the episode and a newer pulse is written, the second quiet warning carries the newer pulse's timestamp.
5. Verify the tests fail (RED).
6. Add one optional epoch-millisecond activity-timestamp field to the quiet variant of the event union beside its optional last-commit field.
7. Record the dispatch instant from the injected clock in the watcher's start method; on the quiet branch read the pulse, apply the dispatch-ownership predicate with the watcher's step and that instant, and set the field from the parsed pulse timestamp when it passes.
8. Verify the tests pass (GREEN), run the scoped test file and the typecheck target covering tests, and commit.

**Done when:**
1. The quiet variant of the event union declares exactly one new optional epoch-millisecond activity-timestamp field and no other field of that variant changed.
2. A watcher fixture whose pulse names the build step and is stamped after the watcher started asserts the emitted quiet warning's activity timestamp equals that pulse's timestamp in epoch milliseconds.
3. A watcher fixture with a pulse stamped seconds before the quiet window elapses asserts the quiet warning fires on the first tick past the window and that exactly one quiet warning is emitted for that episode.
4. A watcher fixture that re-arms the episode with task progress and then writes a newer pulse asserts the second quiet warning carries the newer pulse's timestamp and not the first episode's.

### Task 2: Degrade the activity read without misattributing or suppressing the warning
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/build-progress-watcher.ts, src/conductor/test/build-progress-watcher.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing watcher tests for four degradations, each asserting the quiet warning is still emitted on the tick past the quiet window with the activity timestamp absent.
2. Cover: no pulse file present; a pulse naming a step other than the watcher's; a pulse stamped before the watcher started; and a pulse file holding unparseable content.
3. For the no-pulse case, assert the whole emitted event deep-equals the pre-existing field set with no activity-timestamp key.
4. Verify the tests fail (RED).
5. Guard the activity read so a thrown error, a null parse, a failed ownership check, or a non-finite timestamp leaves the field absent and never aborts the tick or the emission.
6. Verify the tests pass (GREEN), run the scoped test file and the typecheck target covering tests, and commit.

**Done when:**
1. A watcher fixture with no pulse file asserts the emitted quiet warning deep-equals the event expected before this change, with its step, quiet minutes, resolved count, total, current task id, last commit time, and feature slug and no activity-timestamp key.
2. A watcher fixture whose only pulse names a step other than build asserts the quiet warning is emitted with the activity timestamp absent.
3. A watcher fixture whose only pulse is stamped before the watcher started, the instant the watcher records as the dispatch start, asserts the quiet warning is emitted with the activity timestamp absent.
4. A watcher fixture whose pulse file holds unparseable content asserts the quiet warning is emitted on that tick with the activity timestamp absent and that the tick resolves without throwing.

### Task 3: Name the activity age on the daemon quiet warning line
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-progress.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing renderer tests calling the exported daemon renderer with color disabled and a fixed system time: a quiet warning with a feature slug whose activity timestamp is twenty-seven seconds before that clock, and the same counters with a timestamp twenty-two minutes before it.
2. Assert the first line contains its existing quiet-minute text, counter text, feature slug, and the rendered activity age, and that the second line reports the larger age.
3. Verify the tests fail (RED).
4. In the renderer's quiet case, compute the age as the render clock minus the event's activity timestamp, format it with the heartbeat module's exported age formatter, and append a fragment naming it after the last-commit fragment.
5. Verify the tests pass (GREEN), run the scoped test file and the typecheck target covering tests, and commit.

**Done when:**
1. With color disabled and a fixed render clock, the quiet line for a twenty-seven-second-old activity timestamp contains its existing quiet-minute text, its existing counter text, its feature slug, and the rendered twenty-seven-second activity age.
2. With color disabled and a fixed render clock, the quiet line for identical counters with a twenty-two-minute-old activity timestamp reports a larger rendered age than the twenty-seven-second line.
3. The renderer formats the activity age with the heartbeat module's exported age formatter rather than a new helper.

### Task 4: Leave the line unchanged when there is no usable activity evidence
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-progress.test.ts
**Dependencies:** 3

**Steps:**
1. Write a failing renderer test asserting a quiet warning with no activity timestamp renders exactly a hardcoded expected line equal to what the renderer produces before this change for that event.
2. Write a failing renderer test asserting a quiet warning whose activity timestamp is five minutes after the fixed render clock renders a zero-length age and does not throw.
3. Verify the tests fail (RED).
4. Omit the fragment entirely when the field is absent, and clamp the computed age at zero before formatting.
5. Verify the tests pass (GREEN), run the scoped test file and the typecheck target covering tests, and commit.

**Done when:**
1. With color disabled, the quiet line for an event with no activity timestamp equals character for character a hardcoded expected line matching the pre-change rendering of that event, with no activity fragment.
2. With color disabled, a quiet warning whose activity timestamp is five minutes after the render clock renders a zero-length age containing no minus sign or non-numeric age text, and the renderer returns without throwing.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the build worktree carries an activity pulse that names the build step and was stamped after the running build dispatch started, when the quiet warning is emitted, then the event carries that pulse's timestamp in epoch milliseconds. | 1 | "A watcher fixture whose pulse names the build step and is stamped after the watcher started asserts the emitted quiet warning's activity timestamp equals that pulse's timestamp in epoch milliseconds." | diff-local |
| Story 1 happy: Given that pulse is only seconds old when the quiet window elapses with no task or commit movement, when the tick runs, then the warning still fires on that same tick and exactly once for the episode. | 1 | "A watcher fixture with a pulse stamped seconds before the quiet window elapses asserts the quiet warning fires on the first tick past the window and that exactly one quiet warning is emitted for that episode." | diff-local |
| Story 1 happy: Given progress re-arms the quiet episode and a newer pulse is written, when a second quiet warning fires for the same build, then it carries the newer pulse's timestamp rather than the first episode's. | 1 | "A watcher fixture that re-arms the episode with task progress and then writes a newer pulse asserts the second quiet warning carries the newer pulse's timestamp and not the first episode's." | diff-local |
| Story 1 negative: Given the build worktree carries no activity pulse at all, when the quiet warning is emitted, then it carries no activity timestamp and its quiet minutes, resolved count, total, current task id, last commit time, and feature slug are the values it carries today. | 2 | "A watcher fixture with no pulse file asserts the emitted quiet warning deep-equals the event expected before this change, with its step, quiet minutes, resolved count, total, current task id, last commit time, and feature slug and no activity-timestamp key." | diff-local |
| Story 1 negative: Given the only activity pulse on disk names a different step, when the quiet warning is emitted, then it carries no activity timestamp. | 2 | "A watcher fixture whose only pulse names a step other than build asserts the quiet warning is emitted with the activity timestamp absent." | diff-local |
| Story 1 negative: Given the only activity pulse on disk was stamped before the running build dispatch started, when the quiet warning is emitted, then it carries no activity timestamp, so a pulse left behind by earlier work is never reported as this dispatch's liveness. | 2 | "A watcher fixture whose only pulse is stamped before the watcher started, the instant the watcher records as the dispatch start, asserts the quiet warning is emitted with the activity timestamp absent." | diff-local |
| Story 1 negative: Given the activity pulse file holds malformed content, when the quiet tick runs, then the warning is still emitted on that tick with no activity timestamp and the tick does not throw. | 2 | "A watcher fixture whose pulse file holds unparseable content asserts the quiet warning is emitted on that tick with the activity timestamp absent and that the tick resolves without throwing." | diff-local |
| Story 2 happy: Given a quiet warning carrying an activity timestamp twenty-seven seconds before the render clock, when the daemon renders it, then the line keeps its existing quiet-duration, counter, and feature slug text and additionally names that activity age. | 3 | "With color disabled and a fixed render clock, the quiet line for a twenty-seven-second-old activity timestamp contains its existing quiet-minute text, its existing counter text, its feature slug, and the rendered twenty-seven-second activity age." | diff-local |
| Story 2 happy: Given two quiet warnings with identical counters whose activity timestamps are twenty-seven seconds and twenty-two minutes before the render clock, when the daemon renders them, then the second line reports the larger age, so a silent provider reads differently from an active one. | 3 | "With color disabled and a fixed render clock, the quiet line for identical counters with a twenty-two-minute-old activity timestamp reports a larger rendered age than the twenty-seven-second line." | diff-local |
| Story 2 negative: Given a quiet warning carrying no activity timestamp, when the daemon renders it, then the line is exactly the line rendered today for that event with no activity fragment appended. | 4 | "With color disabled, the quiet line for an event with no activity timestamp equals character for character a hardcoded expected line matching the pre-change rendering of that event, with no activity fragment." | diff-local |
| Story 2 negative: Given a quiet warning whose activity timestamp is later than the render clock, when the daemon renders it, then the line reports a zero-length age rather than a negative or non-numeric one. | 4 | "With color disabled, a quiet warning whose activity timestamp is five minutes after the render clock renders a zero-length age containing no minus sign or non-numeric age text, and the renderer returns without throwing." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: each is decided by this feature's own watcher branch and renderer case against controlled fixtures, and no commit outside the diff can change whether they hold. Tasks 1 and 2 own watcher-to-filesystem integration through the existing quiet-episode seam (private tick driver, injected clock, emitter spy), writing the pulse by hand because its on-disk contents and their attribution to a dispatch are the boundary under test; no provider process is started. Tasks 3 and 4 own the operator-visible proof through the exported daemon renderer with color disabled. Existing watcher, renderer, and event-shape tests remain authoritative for counter arithmetic, the quiet threshold, re-arm semantics, the last-commit fragment, and the stall breaker. Existing heartbeat-module tests remain authoritative for the reader, the ownership predicate, and the age formatter, all reused unmodified. Aggregate test execution belongs to the `test_suite` gate; no aggregate, external-service, or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 3 -> Task 4
