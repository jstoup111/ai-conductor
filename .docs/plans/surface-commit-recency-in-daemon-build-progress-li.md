# Implementation Plan: Surface commit recency in daemon build progress lines

**Date:** 2026-09-06
**Stories:** .docs/stories/surface-commit-recency-in-daemon-build-progress-li.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the approved intra-step build-progress contract — the same watcher, the same change-driven tick, the same quiet-episode state machine, one additive optional event field, and no new observer.

## Summary

Four bounded tasks deliver #1715 by carrying a fact the build-progress watcher already observes — the build worktree's newest commit — onto the two events it already emits, and naming that commit's age on the two daemon log lines that already render them. The quiet threshold, the halt ceilings, the post-hoc stall breaker, the interactive terminal renderer, and the OpenTelemetry span attributes are outside this small slice.

## Technical Approach

The watcher already runs a head probe through the shared Git runner on every poll tick and diffs the resulting sha, so commit movement is an observed fact today; only the commit's timestamp is discarded. Hold that timestamp in the watcher alongside the sha it belongs to. When a tick's head probe returns a sha different from the held one, run a single `show -s --format=%ct <sha>` through the same runner and store the parsed seconds as epoch milliseconds; when the sha is unchanged, reuse the held value and issue no probe. The extra Git call therefore occurs only on ticks where a commit actually landed, and the heartbeat and quiet ticks — the ones that make a healthy build look pinned — cost exactly what they cost today.

Report the held value as an optional `lastCommitAt` field on the change-driven tick, the heartbeat tick, and the quiet warning. The quiet variant already declares that field and the governing approved decision record for intra-step build progress already names it in that payload, so populating it completes an existing contract. Adding the same optional field to the sibling progress variant is additive and backward-compatible: every consumer reads named fields, and no consumer that ignores it changes behavior. No new event kind is introduced, so the persister's event-type list is untouched.

This adds no channel. There is no watcher, poller, sidecar file, bespoke ledger, or timestamp stamped into an artifact for a later reader; the fact rides the existing emitter on existing events, and the two rejected alternatives from the issue — a status ticker shelling out to a Git log on its own cadence, and a post-commit hook pushing from a separate process — are exactly the parallel channels that rule forbids.

Formatting is display-only and belongs beside the existing build-position helper rather than in either renderer, so both daemon lines and any later consumer share one implementation. The helper takes the timestamp and the render clock and returns an empty string when the timestamp is absent, clamping a future timestamp to zero so clock skew reports a zero-length age instead of a negative one. Because the age is computed at render time rather than stored, a heartbeat that repeats a pinned counter still shows the age growing.

The daemon renderer is the entry point that owns the observable behavior for both stories: the operator's contact with this feature is the log line, and Task 4 is the single task that proves the line through the exported daemon event renderer. Tests follow the repository's test-design guidance: the formatter is a pure unit, the watcher tests drive the real watcher against a temporary local Git repository because local Git semantics are the boundary under test, and the renderer tests call the exported renderer directly with color disabled rather than starting a daemon. No test reaches a language model, a network service, or a hosting provider.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: the watcher's tick runs `rev-parse HEAD` through `makeGitRunner(projectRoot)`, records the sha on its tick snapshot, and treats a sha move as a change; a failed probe deliberately reuses the previous sha rather than clearing it.
- Verified: a change-driven tick re-arms the quiet episode, so a commit with no task-row movement already suppresses the quiet warning — only the naming half of the issue's second desired outcome is missing.
- Verified: the conductor constructs the watcher for the build step only, with `projectRoot` set to the feature worktree, so the probed head is the feature branch's.
- Verified: the event union declares `lastCommitAt?: number` on the quiet variant and does not declare it on the progress variant; no source file populates it and the only references outside the union are an event-shape test.
- Verified: the exported daemon event renderer builds both build lines from the task counter, the current task, and the feature slug, discarding the commit facts the events already carry.
- Verified: `displayBuildPosition` lives in the retry-line formatting module and is already imported by the daemon renderer, so a sibling display helper needs no new import path.
- Verified: the watcher's existing test file drives the watcher against a temporary local Git repository and already injects a head-probe failure by wrapping the Git runner, so the negative cases have a working seam.
- Verified: the daemon progress render test already exercises both build lines through the exported renderer with color disabled.
- Verified: the approved intra-step build-progress decision record lists the commit-time field in the quiet event's payload contract, so no decision record is created or amended by this work.
- Scope check: A — engine and daemon-CLI code, not a behavioral rule, so no rules file changes; B — no new skill; C — provider-agnostic, the signal comes from Git and the event bus with no model-provider coupling.
- Event spine: no new channel; one additive optional field on an existing variant, emitted by the existing emitter.
- Verify-claims verdict: CLEAR. Every claim above was read in the worktree; no load-bearing assumption remains open.

## Tasks

### Task 1: Format a commit age for progress log lines
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/format-retry-line.ts, src/conductor/test/format-retry-line.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests for a new commit-age helper exported beside `displayBuildPosition`, taking a timestamp and a render clock: an absent timestamp, one 30 seconds old, one 7 minutes old, one 125 minutes old, and one dated 5 minutes into the future.
2. Verify the tests fail (RED).
3. Implement the helper: return the empty string for an absent timestamp; otherwise clamp the elapsed span at zero and render `<1m ago` below one minute, `Nm ago` below one hour, and `Hh Mm ago` at or above one hour.
4. Verify the tests pass (GREEN), run the scoped test file, and commit.

**Done when:**
1. The helper returns the empty string for an absent timestamp and never throws for any enumerated input.
2. Unit cases assert exactly `<1m ago`, `7m ago`, and `2h 5m ago` for timestamps 30 seconds, 7 minutes, and 125 minutes before the supplied clock.
3. A timestamp five minutes after the supplied clock returns `<1m ago` rather than a negative or non-numeric string.

### Task 2: Carry the newest commit's time on build-progress ticks
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/build-progress-watcher.ts, src/conductor/test/build-progress-watcher.test.ts
**Dependencies:** none

**Steps:**
1. Write failing watcher tests over a temporary local Git repository: the first change-driven tick emits a progress event whose commit time equals the head commit's own committer time in milliseconds, and a following heartbeat tick with no new commit re-reports that same value.
2. Add a failing test that the quiet warning emitted after the configured window carries the same commit time.
3. Verify the tests fail (RED).
4. Add the optional millisecond commit-time field to the progress variant of the event union, matching the one the quiet variant already declares.
5. In the watcher, hold the last observed head sha and its commit time. When a tick's head probe returns a sha different from the held one, run one `show -s --format=%ct` for that sha through the existing Git runner and store the parsed seconds as milliseconds; when the sha is unchanged, reuse the held value without probing. Report the held value on the change-driven tick, the heartbeat tick, and the quiet warning.
6. Verify the tests pass (GREEN), run the scoped test file, and commit.

**Done when:**
1. A watcher test over a temporary local Git repository asserts the emitted progress event's commit time equals the head commit's committer time expressed in milliseconds.
2. A heartbeat tick following an unchanged head re-reports the same commit time and issues no second commit-time Git call, asserted through the wrapped Git runner.
3. The quiet warning emitted after the configured window carries that same commit time value.

### Task 3: Degrade the commit-time probe without inventing progress
**Story:** Story 1
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/build-progress-watcher.ts, src/conductor/test/build-progress-watcher.test.ts
**Dependencies:** 2

**Steps:**
1. Write failing tests for three degradations of the commit-time probe: a project root with no commits, an injected non-zero exit, and unparseable probe output. Each must leave the emitted commit time absent or unchanged while the tick still emits its task counter.
2. Write a failing test that lands a commit on the branch while the task rows stay untouched, then asserts the next tick emits progress carrying the new commit time and that no quiet warning fires for that episode.
3. Verify the tests fail (RED).
4. Guard the commit-time probe so a thrown error, a non-zero exit, or a non-finite parse leaves the previously held value untouched and never aborts the tick.
5. Verify the tests pass (GREEN), run the scoped test file, and commit.

**Done when:**
1. A watcher run against a root with no commits emits a progress event whose commit time is absent and whose counter still matches the task rows.
2. An injected probe failure occurring after a successful observation leaves the previously reported commit time unchanged rather than clearing it, and the tick still emits.
3. Unparseable probe output produces the same unchanged-value outcome as the injected failure.
4. A tick following a commit that moved no task row emits a progress event carrying the new commit time and emits no quiet warning for that episode.

### Task 4: Name commit age on the two daemon build lines
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/daemon-cli.ts, src/conductor/test/daemon-render-progress.test.ts
**Dependencies:** 1, 2

**Steps:**
1. Write failing renderer tests driving the exported daemon event renderer with color disabled: a progress event whose commit time is seven minutes before the render clock, the same counter with a commit time nine minutes before the render clock, a progress event with the commit time absent, and a quiet warning with and without a commit time.
2. Verify the tests fail (RED).
3. Build the age fragment with the Task 1 helper against the current clock and append `last commit <age>` to the progress line after the feature slug and to the quiet warning after its counter, omitting the fragment entirely when the helper returns the empty string.
4. Verify the tests pass (GREEN), run the scoped test file, and commit.

**Done when:**
1. The rendered progress line for a seven-minute-old commit contains both its existing counter text and `last commit 7m ago`.
2. Rendering the same counter with a nine-minute-old commit reports the larger age, showing the age is computed against the render clock rather than stored in the event.
3. The progress line and the quiet warning each render with no commit fragment, and with their existing counter, task, slug, and quiet-minute text intact, when the commit time is absent.
4. The quiet warning for a populated commit time contains both its quiet-minute count and the commit age.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the build worktree has at least one commit, when the watcher emits a change-driven or heartbeat progress tick, then the event carries the commit time of the worktree's current head and the daemon line names that commit's age beside the task counter. | 2, 4 | "The rendered progress line for a seven-minute-old commit contains both its existing counter text and `last commit 7m ago`." | diff-local |
| Story 1 happy: Given a heartbeat tick repeats a pinned task counter with no new commit, when the daemon renders it, then the age is computed against the render clock, so an older commit time renders a larger age for the same counter. | 4 | "Rendering the same counter with a nine-minute-old commit reports the larger age, showing the age is computed against the render clock rather than stored in the event." | diff-local |
| Story 1 negative: Given the build worktree has no commits or its commit-time probe fails, when the watcher emits a tick and the daemon renders it, then the commit time is absent and the line keeps its existing counter, task, and slug text with no commit fragment. | 3, 4 | "A watcher run against a root with no commits emits a progress event whose commit time is absent and whose counter still matches the task rows." | diff-local |
| Story 1 negative: Given the recorded commit time is later than the render clock, when the daemon renders the line, then it reports a zero-length age rather than a negative one. | 1 | "A timestamp five minutes after the supplied clock returns `<1m ago` rather than a negative or non-numeric string." | diff-local |
| Story 2 happy: Given a quiet episode fires after the configured quiet window, when the daemon renders the warning, then it names the age of the newest branch commit alongside the quiet duration. | 2, 4 | "The quiet warning for a populated commit time contains both its quiet-minute count and the commit age." | diff-local |
| Story 2 happy: Given a commit lands on the build branch while the task counter stays pinned, when the next poll tick runs, then no quiet warning is emitted for that episode and the tick reports the new commit's time. | 3 | "A tick following a commit that moved no task row emits a progress event carrying the new commit time and emits no quiet warning for that episode." | diff-local |
| Story 2 negative: Given no commit time was ever observed for the build worktree, when the quiet warning renders, then it keeps its existing quiet-duration and counter text with no commit fragment. | 4 | "The progress line and the quiet warning each render with no commit fragment, and with their existing counter, task, slug, and quiet-minute text intact, when the commit time is absent." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local: every one is decided by this feature's own watcher, formatter, and renderer against controlled fixtures, and no commit outside the diff can change whether they hold. Task 1 owns the pure formatting unit cases, including the absent and future-dated boundaries. Task 2 owns watcher-to-Git integration for the happy population path, using a temporary local Git repository because local Git semantics are the boundary under test. Task 3 owns the watcher's degradation and quiet-episode re-arm cases through the same seam, reusing the existing wrapped Git runner for injected failures. Task 4 owns the single cross-boundary integration proof: the exported daemon event renderer is the entry point the operator actually reads, and both stories' observable behavior is asserted there. Existing watcher, renderer, and event-shape tests remain authoritative for the counter arithmetic, the quiet threshold, and the stall breaker, none of which this slice changes. No aggregate, external-service, or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 4
Task 2 -> Task 3
Task 2 -> Task 4

Small tier: architecture and coherence artifacts are skipped. No decision record is created or amended — the approved intra-step build-progress record already names the commit-time field in the quiet event's payload contract, and the sibling progress variant gains only a backward-compatible optional field.
