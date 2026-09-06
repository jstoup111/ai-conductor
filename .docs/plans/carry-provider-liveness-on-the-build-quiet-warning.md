# Implementation Plan: Carry provider liveness on the build quiet warning

**Date:** 2026-09-06
**Stories:** .docs/stories/carry-provider-liveness-on-the-build-quiet-warning.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the approved intra-step build-progress contract — the same watcher, the same lifecycle, the same quiet-episode state machine and threshold, one additive optional event field, and no new observer.

## Summary

Four bounded tasks deliver #1815 by reading a fact that already exists on disk at the moment the build quiet warning fires — the activity pulse the running provider dispatch stamps into the build worktree — carrying its timestamp on the quiet event the watcher already emits, and naming that timestamp's age on the daemon warning line that already renders the event. The quiet threshold, the poll cadence, the pulse's own writer, the periodic progress tick, the post-hoc stall breaker, the interactive terminal renderer, and the OpenTelemetry attributes are outside this slice.

## Technical Approach

The heartbeat module already owns everything this needs and exports it: a tolerant reader that returns a parsed pulse or null for a missing or malformed file, a predicate that answers whether a pulse belongs to the dispatch currently running (it must name the same step and be stamped at or after that dispatch started), and a short age formatter. The watcher is constructed once per build-step attempt and started immediately before the step's await, so the moment it starts is the dispatch boundary the predicate needs; record that instant when the watcher starts and hold it for the watcher's life.

On the quiet branch — the branch that has already decided to fire, after the quiet window elapsed with no task or commit movement — read the pulse, run the ownership predicate against the held dispatch instant, and when it passes, parse the pulse's timestamp and report it as an additional optional epoch-millisecond field on the quiet event. When the pulse is absent, malformed, owned by another step, or older than the dispatch instant, report nothing and leave every existing field exactly as it is. The read is wrapped so nothing it can do prevents the warning from being emitted on that tick: this is the second desired outcome's hard constraint, and it is why the evidence is an enrichment of the existing emission rather than an input to the decision to emit.

Reporting an absolute timestamp rather than a computed age or a live-or-wedged verdict is deliberate. The age is then computed against the reader's own clock, so a line rendered later reports a larger age without the event lying; and no freshness threshold is invented inside the engine, so the operator reads the number rather than the engine's opinion of it. This also keeps the field meaningful to every other consumer of the persisted event, which is the third desired outcome stated literally.

The daemon renderer appends one fragment to the quiet case it already has, computing the age against the render clock, clamping a future timestamp to zero so clock skew reports a zero-length age instead of a negative one, and reusing the exported age formatter rather than introducing a second one. When the field is absent the case renders exactly the string it renders today.

This adds no channel. Nothing new observes, polls, or coordinates; an existing watcher performs one extra best-effort read on a branch it already reaches, and the fact rides the existing emitter on an existing variant. No sidecar file, no second ledger, no timestamp stamped into an artifact for a later reader, and no new event kind — so the persister's event-type list is untouched.

Tests follow the repository's test-design guidance. The watcher tests drive the real watcher's tick directly against a temporary directory with an injected clock, writing the activity pulse by hand with a timestamp derived from that same injected clock so ownership and age comparisons stay deterministic; the existing quiet-episode fixtures in that file already establish this exact shape, including the private tick driver and the emitter spy, so the new cases extend a working seam rather than inventing one. The renderer tests call the exported daemon renderer directly with color disabled and a fixed system time. No test reaches a language model, a network service, or a hosting provider.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: the watcher's quiet branch emits its warning from one site inside the unchanged-tick path, guarded by a once-per-episode flag, with the tick's resolved count, total, current task id, and feature slug already in hand.
- Verified: the watcher's options carry the feature worktree root and an injectable clock defaulting to the system clock, and its start method is where a dispatch instant can be recorded.
- Verified: the conductor constructs the watcher only for the build step, passes the worktree root as the project root, and starts it immediately before the build step's await and stops it in a finally.
- Verified: the heartbeat module exports a tolerant reader returning null for a missing or malformed file, a dispatch-ownership predicate taking a step name and a dispatch-start epoch, and an age formatter rendering a millisecond span as a short string.
- Verified: the provider dispatch path creates the throttled activity pulse for the step it is running, writing it into the same worktree root the watcher polls, so the pulse's step name and the watcher's step name are the same value.
- Verified: the pulse file is overwritten and never cleared, which is exactly why the ownership predicate exists and why a bare age read would misattribute an earlier step's pulse.
- Verified: the event union declares the quiet variant with an optional commit-time field already, so an additional optional field matches the variant's existing shape and requires no persister or exhaustiveness-list change.
- Verified: the daemon log renderer has a case for the quiet variant that builds its line from the counter helper, the step, the quiet minutes, and the feature slug, and the whole render switch is already wrapped so a formatter fault degrades to a dropped line rather than a crash.
- Verified: the watcher's existing test file drives the private tick directly, injects a clock, spies on the emitter, and filters the quiet events out of the spy's calls; the renderer's existing test file calls the exported renderer with color disabled and collects its lines.
- Verified: the approved intra-step build-progress decision record fixes the watcher lifecycle, the quiet determination, and the render paths, none of which change here; its payload sketch lists optional fields, so one more optional field is additive and no decision record is created or amended.
- Scope check: A — consumer-facing engine and daemon-CLI code, not a behavioral rule, so no rules file changes; B — no new skill; C — provider-agnostic, the pulse is written by the shared dispatch path for every provider.
- Event spine: no new channel; one additive optional field on an existing variant, emitted by the existing emitter.
- Verify-claims verdict: CLEAR. Every claim above was read in the worktree; no load-bearing assumption remains open.

## Tasks

### Task 1: Carry the running dispatch's activity timestamp on the quiet warning
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/build-progress-watcher.ts, src/conductor/test/build-progress-watcher.test.ts
**Dependencies:** none

**Steps:**
1. Write failing watcher tests in the existing quiet-episode fixture block, driving the private tick with an injected clock based at a fixed epoch instant and writing the worktree activity pulse by hand as JSON naming the build step with a timestamp derived from that same clock.
2. Assert the emitted quiet warning carries an activity timestamp equal to the pulse's timestamp in epoch milliseconds.
3. Assert the warning still fires on the first tick past the configured quiet window while the pulse is seconds fresh, and fires exactly once for that episode.
4. Assert that after progress re-arms the episode and a fresher pulse is written, the second quiet warning carries the newer pulse's timestamp rather than the first episode's.
5. Verify the tests fail (RED).
6. Add one optional epoch-millisecond activity-timestamp field to the quiet variant of the event union, beside the optional commit-time field it already declares.
7. Record the watcher's dispatch instant from its injected clock when the watcher starts, and on the quiet branch read the activity pulse, run the dispatch-ownership predicate against that instant and the watcher's step, and report the parsed timestamp on the emitted warning when it passes.
8. Verify the tests pass (GREEN), run the scoped test file, run the typecheck target that covers tests, and commit.

**Done when:**
1. The quiet variant of the event union declares exactly one new optional epoch-millisecond activity-timestamp field and no other field changed.
2. A watcher fixture asserts the emitted quiet warning's activity timestamp equals the epoch-millisecond value written into the worktree activity pulse by the running dispatch.
3. A watcher fixture asserts the quiet warning fires on the first tick past the configured quiet window with a seconds-fresh pulse present, and that exactly one warning is emitted for that episode.
4. A watcher fixture asserts a re-armed second quiet episode reports the newer pulse's timestamp, not the timestamp reported by the first episode.

### Task 2: Degrade the activity read without misattributing or suppressing the warning
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/build-progress-watcher.ts, src/conductor/test/build-progress-watcher.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing watcher tests for four degradations, each asserting the quiet warning is still emitted on the same tick with its activity timestamp absent and its quiet-minute count, resolved and total counters, current task id, and feature slug unchanged.
2. Cover: no activity pulse file present at all; a pulse naming a step other than the one the watcher was constructed for; a pulse whose timestamp precedes the recorded dispatch instant; and a pulse whose file contents are not parseable JSON.
3. Verify the tests fail (RED).
4. Guard the activity read so a thrown error, a null parse, a failed ownership check, or a non-finite timestamp leaves the field absent and never aborts the tick or the emission.
5. Verify the tests pass (GREEN), run the scoped test file, run the typecheck target that covers tests, and commit.

**Done when:**
1. A watcher fixture with no activity pulse present emits the quiet warning with the activity timestamp absent and every pre-existing field unchanged.
2. A watcher fixture whose only pulse names a different step emits the quiet warning with the activity timestamp absent.
3. A watcher fixture whose pulse timestamp precedes the recorded dispatch instant emits the quiet warning with the activity timestamp absent.
4. A watcher fixture whose pulse file holds unparseable content emits the quiet warning with the activity timestamp absent and the tick resolves without throwing.

### Task 3: Name the activity age on the daemon quiet warning line
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-progress.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing renderer tests driving the exported daemon renderer with color disabled and a fixed system time: a quiet warning whose activity timestamp is twenty-seven seconds before that clock, and the same counters with a timestamp twenty-two minutes before it.
2. Assert the first line contains its existing quiet-minute text, its existing counter text, and the rendered activity age, and assert the second line reports the larger age.
3. Verify the tests fail (RED).
4. In the quiet case of the renderer, compute the age as the render clock minus the event's activity timestamp and append a fragment naming that age after the feature slug, formatting it with the age formatter the heartbeat module already exports.
5. Verify the tests pass (GREEN), run the scoped test file, run the typecheck target that covers tests, and commit.

**Done when:**
1. The rendered quiet line for a twenty-seven-second-old activity timestamp contains its existing quiet-minute count, its existing counter text, and the rendered activity age.
2. Rendering the same counters with a twenty-two-minute-old activity timestamp reports a visibly larger age than the twenty-seven-second case.
3. The renderer imports the existing age formatter rather than defining a second age-formatting helper.

### Task 4: Leave the line unchanged when there is no usable activity evidence
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-progress.test.ts
**Dependencies:** 3

**Steps:**
1. Write a failing renderer test asserting that a quiet warning carrying no activity timestamp renders exactly the line the renderer produces today for the same event, with no activity fragment appended.
2. Write a failing renderer test asserting that a quiet warning whose activity timestamp is five minutes after the fixed render clock renders a zero-length age rather than a negative or non-numeric one, and does not throw.
3. Verify the tests fail (RED).
4. Omit the fragment entirely when the field is absent, and clamp the computed age at zero before formatting it.
5. Verify the tests pass (GREEN), run the scoped test file, run the typecheck target that covers tests, run the configured aggregate test command, and commit.

**Done when:**
1. The quiet line rendered for an event with no activity timestamp equals the line rendered today for that same event, character for character.
2. A quiet warning whose activity timestamp is five minutes after the render clock renders a zero-length age and the renderer returns without throwing.
3. The configured aggregate test command passes.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the build worktree carries an activity pulse stamped by the build dispatch that is currently running, when the quiet warning is emitted, then the event carries the epoch-millisecond timestamp of that most recent pulse. | 1 | "A watcher fixture asserts the emitted quiet warning's activity timestamp equals the epoch-millisecond value written into the worktree activity pulse by the running dispatch." | diff-local |
| Story 1 happy: Given that pulse is only seconds old at the moment the quiet window elapses with no task or commit movement, when the tick runs, then the warning still fires on that same tick and exactly once for the episode. | 1 | "A watcher fixture asserts the quiet warning fires on the first tick past the configured quiet window with a seconds-fresh pulse present, and that exactly one warning is emitted for that episode." | diff-local |
| Story 1 happy: Given the pulse is refreshed and a later quiet episode fires for the same build, when that second warning is emitted, then it carries the newer pulse's timestamp rather than the first episode's. | 1 | "A watcher fixture asserts a re-armed second quiet episode reports the newer pulse's timestamp, not the timestamp reported by the first episode." | diff-local |
| Story 1 negative: Given the build worktree carries no activity pulse at all, when the quiet warning is emitted, then it carries no activity timestamp and its quiet-minute count, resolved and total counters, current task, and feature slug are exactly what they are today. | 2 | "A watcher fixture with no activity pulse present emits the quiet warning with the activity timestamp absent and every pre-existing field unchanged." | diff-local |
| Story 1 negative: Given the only activity pulse on disk names a different step, or was stamped before the running build dispatch started, when the quiet warning is emitted, then it carries no activity timestamp, so a pulse left behind by earlier work is never reported as this dispatch's liveness. | 2 | "A watcher fixture whose only pulse names a different step emits the quiet warning with the activity timestamp absent." | diff-local |
| Story 1 negative: Given the activity pulse is unreadable or malformed, when the quiet tick runs, then the warning is still emitted at that tick with no activity timestamp and the tick does not throw. | 2 | "A watcher fixture whose pulse file holds unparseable content emits the quiet warning with the activity timestamp absent and the tick resolves without throwing." | diff-local |
| Story 2 happy: Given a quiet warning carrying an activity timestamp twenty-seven seconds before the render clock, when the daemon renders it, then the line keeps its existing quiet-duration, counter, and slug text and additionally names that activity age. | 3 | "The rendered quiet line for a twenty-seven-second-old activity timestamp contains its existing quiet-minute count, its existing counter text, and the rendered activity age." | diff-local |
| Story 2 happy: Given two quiet warnings with identical counters whose activity timestamps are twenty-seven seconds and twenty-two minutes before the render clock, when the daemon renders them, then the second line reports the visibly larger age, so a silent provider reads differently from an active one. | 3 | "Rendering the same counters with a twenty-two-minute-old activity timestamp reports a visibly larger age than the twenty-seven-second case." | diff-local |
| Story 2 negative: Given a quiet warning carrying no activity timestamp, when the daemon renders it, then the line is exactly its existing text with no activity fragment appended. | 4 | "The quiet line rendered for an event with no activity timestamp equals the line rendered today for that same event, character for character." | diff-local |
| Story 2 negative: Given a quiet warning whose activity timestamp is later than the render clock, when the daemon renders it, then it reports a zero-length age rather than a negative or non-numeric one. | 4 | "A quiet warning whose activity timestamp is five minutes after the render clock renders a zero-length age and the renderer returns without throwing." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: each is decided by this feature's own watcher branch and renderer case against controlled fixtures, and no commit outside the diff can change whether they hold. Tasks 1 and 2 own watcher-to-filesystem integration through the existing quiet-episode seam — the private tick driver, the injected clock, and the emitter spy — writing the activity pulse by hand because the pulse's on-disk contents and their attribution to a dispatch are the boundary under test; no provider process is started and no dispatch is run. Tasks 3 and 4 own the single operator-visible integration proof: the exported daemon renderer is the line the operator actually reads, and both of Story 2's paths are asserted there directly with color disabled. Existing watcher, renderer, and event-shape tests remain authoritative for the counter arithmetic, the quiet threshold, the re-arm semantics, and the stall breaker, none of which this slice changes. Existing heartbeat-module tests remain authoritative for the reader, the ownership predicate, and the age formatter, all of which are reused unmodified. No aggregate, external-service, or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 3 -> Task 4
