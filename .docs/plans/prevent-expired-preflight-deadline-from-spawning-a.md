# Implementation Plan: Bound the build_review counterfactual scoped run to its deadline

**Date:** 2026-09-06
**Stories:** .docs/stories/prevent-expired-preflight-deadline-from-spawning-a.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent keeps the existing preflight contract intact — one AbortController armed from the configured test-suite timeout, the same scoped-run result union, and the same infrastructure-failure reason mapping.

## Summary

Three bounded tasks deliver #2177 by extracting the build_review counterfactual launch into a guarded runner that refuses to launch after its deadline has expired and that ends a running child before reporting a timeout. The preflight timeout value, the materializer's own abort checkpoints, the aggregate test-suite runner, and every other engine spawn site are outside this small slice.

## Technical Approach

The defect is in the private counterfactual runner in the step-runner module: it spawns the child first and only afterwards calls `signal.addEventListener('abort', …)`. An `AbortSignal` that is already aborted never fires a listener registered later, so that child has no kill path at all. The window is reachable today: the preflight materializer brackets most of its awaits with abort checks, but its rename branch and its added-path branch both continue the loop after an await with no following check, so the last materialized path can hand an expired deadline straight to the scoped run.

Introduce one new module, `src/conductor/src/engine/build-review-scoped-run.ts`, holding the whole launch-and-terminate concern as an exported function over injected seams: a launcher that produces a child exposing `stdout`, `stderr`, `once`, and `kill`, and an escalation scheduler. Both default to the `node:child_process` spawn adapter and to `setTimeout`/`clearTimeout` with the timer unreferenced. Extraction is what makes the behavior unit-testable without launching a real process; the step-runner class keeps no spawn of its own.

Guard before launching: an already-aborted signal returns the union's timeout member with empty captured output and never calls the launcher; an absent command template or an empty selector list keeps today's launch-error member, also without a launch. The timeout member is deliberate — the existing reason mapper turns `timeout` into the scoped-run timeout reason and `launch-error` into the scoped-run launch-failure reason, and an expired deadline is a timeout. This is why Node's own `signal` option on the spawn call is not used: that path surfaces an `AbortError` on the child's `error` event, which the existing mapping would record as a launch failure.

Terminate before reporting: on abort, send SIGTERM, arm the injected escalation with the module's exported bounded grace constant, and resolve the timeout member only once the child's exit has been observed or the escalation has fired. On escalation, send SIGKILL and resolve with the output captured so far; on an observed exit, cancel the armed escalation. Keeping the promise pending until the child is gone is what stops the preflight's disposable-checkout removal from racing a live test process. Retain the existing settle-once guard so a late abort cannot replace an already-reported outcome and no signal is delivered to a reaped child.

Wire the class through the established test-only injection pattern already used by `gitRunner`, `worktreeLifecycle`, and `buildReviewCoordinator`: add one optional launcher field to the step-runner options interface, store it, default it to the new module's adapter, and reduce the private counterfactual runner to a delegation. That injection point is what lets a test prove the class actually reaches the guard rather than only proving the helper works in isolation; Task 3 owns that integration.

Follow the local test pattern already used by the step-runner and preflight suites: table-driven cases over injected fakes, no real process launch, no real timers, and no conductor run. A fake child records every signal it receives and exposes explicit hooks to report data, exit, or error, so ordering assertions are deterministic. Variation in fixture builders and assertion grouping is allowed; what must be preserved is that the launcher and the scheduler are the only boundaries and that neither is replaced by real time or a real subprocess. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the selected approach, and both stories on 2026-09-06 (delegated).
- Verified: the private counterfactual runner at `src/conductor/src/engine/step-runners.ts:2394-2419` spawns first and registers the abort listener afterwards, and `spawn` is imported at line 3 and used at exactly that one call site.
- Verified: `src/conductor/src/engine/step-runners.ts:2326-2328` arms one `AbortController` from `test_suite.timeout_seconds`, defaulting to 300 seconds, and clears it in a `finally`.
- Verified: `src/conductor/src/engine/build-review-test-quality-preflight.ts` lines 419 and 426 continue the materialization loop after an await with no following abort check, so `runScoped` at line 438 is reachable with an already-aborted signal.
- Verified: `scopedRunFailure` at `src/conductor/src/engine/build-review-test-quality-preflight.ts:319-327` maps `timeout` to `scoped-run-timeout`, `launch-error` to `scoped-run-launch-failed`, and `signal` to `scoped-run-signaled`.
- Verified: `TautologyScopedRunResult` at `src/conductor/src/engine/build-review-test-quality-preflight.ts:29-35` already carries the timeout and launch-error members this change returns; no union change is needed.
- Verified: the step-runner options interface already declares optional test-only injection points around line 491, and the constructor resolves them with `??` defaults around line 674.
- Verified: `src/conductor/test/engine/step-runners.test.ts` already reaches private build_review internals directly, so a wiring test needs no new harness.
- Verified: no repository test currently exercises the counterfactual scoped-run command; the two new behaviors arrive with new coverage rather than amended coverage.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no event, metric, span, log line, or report is added or changed — the outcome travels on the existing preflight result union.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree. No load-bearing assumption remains open.

## Tasks

### Task 1: Extract a guarded counterfactual runner that refuses an expired deadline
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/build-review-scoped-run.ts, src/conductor/test/engine/build-review-scoped-run.test.ts
**Dependencies:** none

**Steps:**
1. Add a new unit test file at the second path above. Cover an already-aborted signal, an unexpired signal with a zero exit, a nonzero exit, an exit terminated by a signal, a launcher error, an absent command template, and an empty selector list. Drive every case through an injected fake launcher that records each invocation and returns a controllable fake child exposing `stdout`, `stderr`, `once`, and `kill`.
2. Verify the file fails for the right reason, then add the new module at the first path above, exporting the runner function, the launcher and child structural types, and the default spawn adapter. Declare the return type as the existing scoped-run result union; do not introduce a new result shape.
3. Implement the pre-launch guard: an already-aborted signal returns the timeout member with empty captured output and never calls the launcher; an absent template or an empty selector list returns the launch-error member and never calls the launcher.
4. Move the existing selector quoting and template substitution, the stream accumulation, and the exit and error mapping into the module unchanged, so a launched run's reported outcome is identical to today's.
5. Run the focused test file through ai-conductor scoped-run, run the project's typecheck target that includes test files, and commit.

**Done when:**
1. A case with an already-aborted signal returns the timeout member and the injected launcher records zero invocations.
2. A case with an unexpired signal returns the child's exit status, standard output, and standard error unchanged after exactly one launcher invocation.
3. An absent command template and an empty selector list each return the launch-error member with zero launcher invocations.
4. The project's typecheck target that includes test files passes with the runner's declared return type being the existing scoped-run result union.

### Task 2: End an aborted counterfactual before reporting its timeout
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/build-review-scoped-run.ts, src/conductor/test/engine/build-review-scoped-run.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the unit file with abort-while-running cases over the fake child and an injected escalation scheduler: a child that reports its exit on SIGTERM, a child that never reports an exit, a child that reports its exit inside the grace window, and a child whose exit was already reported before the abort fires.
2. Verify the new cases fail for the right reason, then on abort send SIGTERM, arm the injected escalation with the module's exported bounded grace constant, and resolve the timeout member only when the child's exit is observed or the escalation fires.
3. On escalation send SIGKILL and resolve the timeout member carrying the output captured so far. On an observed exit cancel the armed escalation.
4. Keep the existing settle-once guard, so an abort arriving after an outcome was reported delivers no signal and replaces no outcome.
5. Default the escalation scheduler parameter to `setTimeout`/`clearTimeout` with the timer unreferenced, and assert in the tests that no case advances real time.
6. Run the focused test file through ai-conductor scoped-run, run the typecheck target that includes test files, and commit.

**Done when:**
1. After an abort, the runner's promise is still unresolved until the fake child reports its exit, and that child records exactly one SIGTERM.
2. A fake child that never reports an exit records a SIGKILL once the injected escalation fires, and the runner then resolves to the timeout member carrying the output captured before the abort.
3. A fake child that reports its exit inside the grace window records no SIGKILL and the injected scheduler's cancel handle is invoked.
4. A fake child whose outcome was already reported records no signal when the abort fires afterwards and keeps that original outcome.

### Task 3: Route the step runner's counterfactual through the guarded runner
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/step-runners.test.ts
**Dependencies:** 2

**Steps:**
1. Add a step-runner test that constructs the default step runner with a scoped-command template in its config and an injected launcher that records invocations, calls the private counterfactual runner with an already-aborted signal, and asserts the launcher was never invoked and that the returned member maps through the existing scoped-run failure mapper to the scoped-run timeout reason.
2. Verify the test fails for the right reason, then add one optional launcher field to the step-runner options interface beside the existing test-only injection points, store it on the class, and resolve it with the new module's spawn adapter as the default.
3. Replace the private counterfactual runner's body with a delegation to the new module's runner, passing the configured template, the selectors, the working directory, the signal, and the stored launcher.
4. Delete the now-unused `node:child_process` import from the step-runner module, which has exactly one spawn call site.
5. Run the focused step-runner tests through ai-conductor scoped-run, run the typecheck target that includes test files, and commit.

**Done when:**
1. A step runner built with a configured scoped command and an injected launcher records zero launcher invocations when its counterfactual runner is called with an already-aborted signal.
2. That same call returns the timeout member and the existing scoped-run failure mapper turns it into the scoped-run timeout reason rather than the launch-failure reason.
3. The step-runner module contains no direct child-process spawn and no post-spawn abort-listener registration; its counterfactual runner is a delegation to the new module.
4. The project's typecheck target that includes test files passes and the focused step-runner tests are green.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the preflight deadline has already expired when the counterfactual scoped run is requested, when the run is invoked, then no process is launched and the run reports a timeout outcome with empty captured output. | 1 | "A case with an already-aborted signal returns the timeout member and the injected launcher records zero invocations." | diff-local |
| Story 1 happy: Given the preflight deadline has not expired, when the counterfactual scoped run is invoked and the process exits, then exactly one process is launched and its exit status, standard output, and standard error are reported unchanged. | 1 | "A case with an unexpired signal returns the child's exit status, standard output, and standard error unchanged after exactly one launcher invocation." | diff-local |
| Story 1 happy: Given a step runner holds a configured scoped-command template, when its counterfactual runner is invoked with an already-expired deadline, then the configured command is never launched and the outcome maps to the scoped-run timeout reason rather than the launch-failure reason. | 3 | "That same call returns the timeout member and the existing scoped-run failure mapper turns it into the scoped-run timeout reason rather than the launch-failure reason." | diff-local |
| Story 1 negative: Given no scoped-command template is configured, or the selector list is empty, when the counterfactual scoped run is invoked, then no process is launched and the run reports a launch-error outcome. | 1 | "An absent command template and an empty selector list each return the launch-error member with zero launcher invocations." | diff-local |
| Story 2 happy: Given a counterfactual process is still running, when the preflight deadline expires, then the process is sent SIGTERM and the timeout outcome is reported only after that process's exit has been observed. | 2 | "After an abort, the runner's promise is still unresolved until the fake child reports its exit, and that child records exactly one SIGTERM." | diff-local |
| Story 2 negative: Given a counterfactual process has not exited after SIGTERM, when the bounded kill grace period elapses, then the process is sent SIGKILL and the run then reports a timeout outcome carrying the output captured so far. | 2 | "A fake child that never reports an exit records a SIGKILL once the injected escalation fires, and the runner then resolves to the timeout member carrying the output captured before the abort." | diff-local |
| Story 2 negative: Given a counterfactual process exits within the kill grace period after SIGTERM, when the timeout outcome is reported, then no SIGKILL is sent and the pending escalation is cancelled. | 2 | "A fake child that reports its exit inside the grace window records no SIGKILL and the injected scheduler's cancel handle is invoked." | diff-local |
| Story 2 negative: Given a counterfactual process already exited and its outcome was reported, when the deadline later expires, then no termination signal is sent and the reported exit outcome is not replaced. | 2 | "A fake child whose outcome was already reported records no signal when the abort fires afterwards and keeps that original outcome." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against injected fakes. Task 1 owns the unit cases for the pre-launch guard and for the unchanged launched-run mapping. Task 2 owns the unit cases for termination ordering, SIGKILL escalation, escalation cancellation, and settle-once. Task 3 owns the single cross-boundary integration proof: the step-runner class, built from its own options and configuration, must actually reach the guard, which a unit test of the extracted function cannot establish. The existing preflight suite retains authority over the reason mapping and the materializer's own abort checkpoints; no new aggregate, timing-sensitive, or real-process test is introduced, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
