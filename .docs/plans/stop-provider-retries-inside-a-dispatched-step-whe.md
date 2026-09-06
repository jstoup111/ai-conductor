# Implementation Plan: Stop provider retries inside a dispatched step when a park lands

**Date:** 2026-09-06
**Stories:** .docs/stories/stop-provider-retries-inside-a-dispatched-step-whe.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent adds one call to an existing run-scoped helper and one advisory report to an existing CLI verb, introducing no marker, event, class, config key, or selection rule that another feature's contract could interact with.

## Summary

Five bounded tasks deliver #2103: one call to the conductor's existing operator-park helper at the
top of the step retry loop so a park landing mid-step declines the next provider attempt, one
in-flight report added to the park CLI verb so the operator learns whether an attempt is still
running, and the unit and acceptance coverage that pins both directions of each.

## Technical Approach

The defect is one missing call site. `run()` in `src/conductor/src/engine/conductor.ts` declares a
single run-scoped helper, `stopAtOperatorParkBoundary`, that reads the injected operator-park
boundary, emits the existing park-boundary event, detaches the signal handlers, and returns the
typed operator-parked termination. Five sites call it, and the last of them sits immediately before
the serial step's in-progress write — that is, before the step's FIRST dispatch. The step's
`while (attempt < stepMaxRetries)` retry loop below it never calls the helper, so every attempt
after the first launches a provider without re-reading the marker. That is exactly the reported
incident: one unchanged attempt id producing `build:2` and `build:3` after the marker was already on
disk.

Add the call at the very top of that loop body, before the counter increment, and return its
termination when it fires. Place it unconditionally rather than gating it on the attempt number: the
loop has non-consuming re-entry paths (a rate-limit wait, a stale session, an auth park) that
decrement the counter and continue, and those are precisely the long waits during which an operator
parks. An unconditional read gives one simple invariant — no attempt is launched without a fresh
marker read — and costs one file stat per attempt. Nothing else in the loop moves: the per-attempt
build watcher and closeout tail are constructed after this point and stopped in their own inner
finally, so a return at the top of an iteration leaks no watcher, timer, or marker. The step is
already recorded as in progress by that point, and the resume index calculation selects an
in-progress step first, so a mid-step park stays resumable without any state rewrite.

The park CLI verb in `src/conductor/src/engine/daemon-park-cli.ts` already resolves the main repo
root and writes the marker. After the existing park branch reports its result, read the feature
worktree's step-activity record through the existing reader in
`src/conductor/src/engine/step-heartbeat.ts` and print one additional line: the running step and the
statement that the attempt already in flight is not cancelled when the record is inside the
freshness window; that nothing is running when the worktree directory is absent; that no in-flight
attempt was observed when the record is missing or out of window; and that status could not be
determined when the read or parse fails. This adds no channel — the record is existing production
telemetry that the daemon dashboard already consumes, and the output is the command's own stdout.
Take the clock through a new optional dependency on the verb's existing injectable dependency
object so the window classification is deterministic in tests; the verb's exit code never changes,
because an advisory report must never turn a successful park into a failure.

Park stays advisory in both halves: it declines the next attempt and describes what is still
running. It does not signal, kill, or otherwise interrupt a provider call that has already started.

Follow the repository's test-design rules for every task. Unit cases inject the step runner and the
park-boundary reader, keep artifact verification off, and let mocked runner success or failure be
their authority. The acceptance case exercises the real internal path — a real daemon-mode conductor
and the real park-marker reader and writer over a temporary directory — with the injected step
runner writing the marker from inside its own first call, so the race is modelled by causation
rather than by timing, and with no provider, package registry, or network call. Bound every
conductor fixture before writing it: pre-resolve unrelated steps in the persisted state, target the
transition with the from-step option, and let the park end the run so no cleanup races a live loop.
Comparable fixtures already exist in the park-boundary unit suite and the park acceptance suite;
reuse their temporary-root, state-writing, and no-external-io helpers rather than inventing new
ones. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the advisory-park approach, and both stories on 2026-09-06 (delegated).
- Verified: `stopAtOperatorParkBoundary` is declared once inside `run()` in the conductor, returns the typed operator-parked termination, and is called from exactly five sites, the last immediately before the serial step's in-progress write.
- Verified: the step retry loop `while (attempt < stepMaxRetries)` sits below that last call site and contains no call to the helper, so no attempt after the first re-reads the marker.
- Verified: the helper resolves a rejecting boundary read as parked, so a retry-boundary call inherits that reading with no new error handling.
- Verified: the per-attempt build watcher and closeout tail are constructed inside the loop after its opening statements and stopped in an inner finally, so an early return at the top of an iteration leaks neither.
- Verified: the loop's rate-limit path decrements the attempt counter and continues, which is why the new call is unconditional rather than gated on the attempt number.
- Verified: `saveConductorStepStatus` persists the in-progress status immediately, and `findResumeIndex` selects an in-progress step ahead of the first pending step, so a mid-step park resumes at the same step.
- Verified: `daemon-cli.ts` injects the marker reader as the boundary reader, and that reader stats the marker per call rather than caching a run-scoped answer.
- Verified: the park CLI verb owns a dependency object carrying the cwd, the output sink, and injectable runners, so an optional clock dependency is additive.
- Verified: the step-activity record is written per step by the step runner into the feature worktree and read by the daemon dashboard through an exported reader that returns null on a missing or malformed file.
- Verified: the park-boundary unit suite carries a structural inventory that anchors on the existing serial guard's declaration text; the new call uses a distinct name so that anchor is unaffected.
- Verified: the release gate's breaking-surface classifier keys on the repository's CLI entry script, its installer, hook paths, and settings schema — none of which this change touches — so no migration block or waiver is owed.
- Scope check: consumer-facing engine defect fix; no new skill; provider-agnostic. Event spine: no new event, ledger, watcher, or stamped field — the existing park-boundary event is emitted by the unchanged helper, and the CLI reads an existing record through its existing reader.
- Sequencing note, not a blocker: an in-flight spec for #1803 changes the same method's markerless-exit backstop so a park-terminated run stops writing a needs-human halt. That change is disjoint from this one — it edits the helper's tail and the finally block, while this edits the retry loop — and it applies to every guarded site including the one added here. Until it lands, a mid-step park produces the same backstop halt an existing pre-dispatch park already produces; this feature neither improves nor worsens that, and no task here asserts marker presence or absence.
- Verify-claims verdict: CLEAR. Every path, symbol, and control-flow claim above was read in this worktree at the current base commit; no unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Consult the park boundary before every provider attempt
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/operator-park-boundary.test.ts
**Dependencies:** none

**Steps:**
1. Add a unit case to the park-boundary suite whose injected step runner returns failure and, on its first invocation, flips a local flag that the injected park-boundary reader returns, so the park becomes true only after one attempt has been dispatched.
2. Assert the run returns the operator-parked termination and the step runner was invoked exactly once, and read the persisted state to assert the targeted step is still recorded as in progress. Establish RED on both assertions.
3. Add the boundary call at the top of the step retry loop body, before the attempt counter increment, under a local name distinct from the existing pre-dispatch guard so the suite's structural dispatch inventory keeps anchoring on that guard, and return its termination when it fires.
4. Verify GREEN, confirm no existing dispatch guard, halt path, or event payload changed, then run the focused file through scoped-run plus the repository typecheck target that covers test files, and commit.

**Done when:**
1. A daemon-mode run whose park boundary turns true after its first failing attempt dispatches the step runner exactly once and returns the operator-parked termination.
2. The persisted step status after that termination is the in-progress status for the step the run stopped inside.
3. The retry loop's only change is that boundary call and its return, and the suite's structural dispatch inventory still passes unchanged.

### Task 2: Keep the retry budget and the fail-closed read intact
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/engine/operator-park-boundary.test.ts
**Dependencies:** 1

**Steps:**
1. Add a case whose injected park-boundary reader resolves normally for the pre-dispatch read and then rejects once an attempt has been dispatched, and assert the run returns the operator-parked termination after exactly one step-runner invocation.
2. Add a sibling case whose injected park-boundary reader always reports no park, with a failing step runner and an explicitly configured retry budget, and assert the runner is invoked once per attempt in that budget and the run returns no operator-parked termination.
3. Leave the suite's existing pre-dispatch and group-boundary cases untouched so the behaviour they own stays asserted by the coverage that already owns it.
4. Run the focused file through scoped-run plus the typecheck target that covers test files, and commit.

**Done when:**
1. A rejecting park boundary read at the retry boundary returns the operator-parked termination after exactly one step-runner dispatch.
2. With the park boundary reporting no park, the same failing step dispatches the step runner once per attempt in the configured retry budget and returns no operator-parked termination.

### Task 3: Report in-flight provider activity from the park command
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/daemon-park-cli.ts, src/conductor/test/engine/daemon-park-cli.test.ts
**Dependencies:** none

**Steps:**
1. Add unit cases to the park CLI suite that create a temporary root, write a feature worktree carrying a step-activity record stamped inside the freshness window, invoke the park verb with an injected output sink and an injected clock, and assert the captured output names the recorded step and states that the attempt already in flight is not cancelled.
2. Add a sibling case with no worktree directory asserting the output states nothing is running for that slug, and a third case that parks the same slug twice asserting the second invocation prints the same in-flight report. Establish RED on all three.
3. Add an optional clock to the verb's dependency object, and after the existing park branch reports its result, read the worktree's activity record through the exported step-activity reader and print the matching single line, leaving the verb's exit code untouched.
4. Verify GREEN, then run the focused file through scoped-run plus the typecheck target that covers test files, and commit.

**Done when:**
1. Park output for a worktree whose activity record is inside the freshness window names that record's step and states that the attempt already in flight is not cancelled.
2. Park output for a slug with no worktree directory states that nothing is running for it.
3. Re-parking an already-parked slug prints the same in-flight report as a first park, and the verb's exit code is unchanged in every case.

### Task 4: Never report a stopped feature on a missing or unreadable record
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/daemon-park-cli.test.ts
**Dependencies:** 3

**Steps:**
1. Add a case whose worktree carries no activity record and a sibling whose record is stamped outside the freshness window, and assert both print the line stating no in-flight attempt was observed rather than any claim that the feature stopped.
2. Add a case whose record file contains bytes that are not valid JSON, and a case whose record parses but carries no step field, and assert both print the undetermined-status line.
3. Assert the park verb returns exit code 0 in every case above and that the marker was still written, so an advisory report can never turn a successful park into a failure.
4. Run the focused file through scoped-run plus the typecheck target that covers test files, and commit.

**Done when:**
1. Park output for an absent or out-of-window activity record states that no in-flight attempt was observed.
2. An unreadable or malformed activity record leaves the park exit code at 0 and prints the undetermined-status line.
3. Every negative case above still finds the park marker on disk after the verb returns.

### Task 5: Prove the retry boundary against the real park marker
**Story:** Story 1
**Type:** happy-path
**Dependencies:** 1
**Files:** src/conductor/test/acceptance/operator-park-boundary.acceptance.test.ts

**Steps:**
1. Add an acceptance case that builds a temporary project root with the suite's existing helper and drives a real daemon-mode conductor at a targeted step whose injected step runner returns failure.
2. Wire the conductor's park boundary to the real marker reader against that root, and have the injected step runner call the real marker writer for the same slug from inside its first invocation, so the marker lands while the attempt is in flight without any timer or sleep.
3. Assert the run returns the operator-parked termination and the injected step runner was invoked exactly once, and assert no case-local stub stands in for the marker read or write.
4. Run the focused acceptance file through scoped-run plus the typecheck target that covers test files, and commit.

**Done when:**
1. An acceptance case driving a real daemon-mode run against the real park-marker reader returns the operator-parked termination after exactly one step-runner dispatch.
2. The marker in that case is written by the failing attempt itself through the real marker writer, with no stubbed reader or writer in the case.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon-mode run whose current step has dispatched an attempt that fails, when the operator park boundary reports a park before the next attempt, then the run returns the operator-parked termination and the step runner is not dispatched again. | 1, 5 | "A daemon-mode run whose park boundary turns true after its first failing attempt dispatches the step runner exactly once and returns the operator-parked termination." | diff-local |
| Story 1 happy: Given that same run returns the operator-parked termination from inside the retry loop, when its persisted state is read afterwards, then the step it stopped inside is still recorded as in progress so a later dispatch resumes at that step. | 1 | "The persisted step status after that termination is the in-progress status for the step the run stopped inside." | diff-local |
| Story 1 negative: Given a daemon-mode run whose operator park boundary read rejects at a retry boundary, when the retry loop reaches the next attempt, then it fails closed to the operator-parked termination and the step runner is not dispatched again. | 2 | "A rejecting park boundary read at the retry boundary returns the operator-parked termination after exactly one step-runner dispatch." | diff-local |
| Story 1 negative: Given a daemon-mode run whose operator park boundary reports no park, when its first attempt fails, then the retry loop keeps dispatching the configured attempt budget and the run returns no operator-parked termination. | 2 | "With the park boundary reporting no park, the same failing step dispatches the step runner once per attempt in the configured retry budget and returns no operator-parked termination." | diff-local |
| Story 2 happy: Given the parked feature's worktree shows provider activity inside the freshness window, when the park command runs, then its output names the step that is still running and states that the attempt already in flight is not cancelled. | 3 | "Park output for a worktree whose activity record is inside the freshness window names that record's step and states that the attempt already in flight is not cancelled." | diff-local |
| Story 2 happy: Given the parked feature has no worktree on disk, when the park command runs, then its output states that nothing is running for that slug. | 3 | "Park output for a slug with no worktree directory states that nothing is running for it." | diff-local |
| Story 2 negative: Given the parked feature's worktree carries no activity record, or one older than the freshness window, when the park command runs, then its output states that no in-flight attempt was observed rather than that the feature stopped. | 4 | "Park output for an absent or out-of-window activity record states that no in-flight attempt was observed." | diff-local |
| Story 2 negative: Given the activity record exists but cannot be read or parsed, when the park command runs, then the park still succeeds with exit code 0 and the output states that in-flight status could not be determined. | 4 | "An unreadable or malformed activity record leaves the park exit code at 0 and prints the undetermined-status line." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled temporary fixtures; no criterion depends on a
commit outside this feature's diff. Task 1 owns the production guard and its unit proof at the
conductor's own retry boundary, the narrowest seam that holds the behaviour. Task 2 owns the two
regressions that keep the guard narrow — the fail-closed read and the untruncated retry budget — in
the suite that already owns park-boundary behaviour rather than duplicating it elsewhere. Task 5
owns Story 1's cross-boundary integration proof: the observable behaviour is that a marker written
by a running attempt stops the next one, proved through the real marker writer and the real marker
reader against a real daemon-mode run, not through a stubbed boundary. Task 3 owns Story 2's entry
point directly, because the park verb is itself the operator-facing boundary, and Task 4 owns its
mirrored refusals. Third-party boundaries are faked or absent throughout; no test reaches a
provider, a package registry, or the network, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 5
Task 3 -> Task 4
