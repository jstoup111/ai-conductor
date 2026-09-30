# Implementation Plan: Capture provider exit code and signal on unclassified subprocess failure

**Date:** 2026-09-29
**Stories:** .docs/stories/capture-grader-exit-code-and-signal-auto-park-grad.md
**Conflict check:** Not required (Tier S)

## Summary

Diagnostics-only fix for jstoup111/ai-conductor#823 (rescoped; E2BIG root cause fixed by #829): every provider records the raw exit code, terminating signal, and output byte counts when a subprocess fails without a classifiable result, and surfaces them in daemon.log, on the existing step_retry/step_failed events, and in the build_review grader-dispatch HALT reason. 5 tasks. HALT class, retry budgets, and park behavior are unchanged.

## Technical Approach

- **One helper, three providers.** Codex already derives closed exit facts (`executionProbeFacts`) for its readiness probe. Task 1 moves that logic into the existing `src/conductor/src/execution/provider-diagnostics.ts` as `deriveProviderExitFacts` plus a `formatProviderExitFacts` line renderer, and introduces `ProviderExitFacts` in `llm-provider.ts` (which `CodexProbeFailureFacts` extends). Closed value sets (known signals and error codes, else UNKNOWN) keep arbitrary strings out of logs.
- **Capture before coalescing.** Each provider currently collapses a missing exit code to 1 (`exitCode ?? 1`) and never reads `signal`. Facts are derived from the raw subprocess result before that coalesce, and attached as `InvokeResult.exitFacts` only on the generic unclassified-failure return, so classified causes (missing binary, auth, rate limit, model unavailable, unresolved command, structured-result) and successes are untouched.
- **Event spine, not a new channel.** Surfacing reuses the existing `diagnosticLog` sink (daemon.log), adds one optional `providerExit` field to the existing `step_retry`/`step_failed` ConductorEvent members, and threads the formatted facts into the existing build_review dispatch-failure detail that `renderExhaustedMechanicalBuildReviewHalt` already prints. No new file, log, event type, or sidecar.
- **Preserve the build_review reason.** A cause-less dispatch-failure is classified `invalid-structured-result` by the coordinator, so the grader path gets an explicit `invalid-provider-result` cause that maps to the reason it has today.
- **Out of scope (operator-confirmed Minimal):** auto-park or auto-retry of grader-dispatch exhaustion; the HALT stays `needs-human`. The legacy `graderDispatchFailed` path, which no production code sets, is not touched.
- **Sequencing:** Task 1 (helper) → Task 2 (claude + InvokeResult field) → Tasks 3, 4, 5 in parallel.

## Prerequisites

- None.

## Tasks

### Task 1: Shared provider exit-facts helper
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/execution/provider-diagnostics.test.ts` for a new exported `deriveProviderExitFacts(value)` and `formatProviderExitFacts(provider, facts)`: known signal SIGTERM kept, signal SIGUSR1 becomes UNKNOWN, process error code EACCES kept and ECONNRESET becomes UNKNOWN, exit codes -1, 1.5 and "1" omitted, integer exit code 1 kept, stdout/stderr byte counts derived from string or Buffer output.
2. Verify tests fail (RED).
3. Implement: add `ProviderExitFacts` (processErrorCode, exitCode, signal, stdoutBytes, stderrBytes, using the closed value sets already declared on `CodexProbeFailureFacts`) to `src/conductor/src/execution/llm-provider.ts`, and make `CodexProbeFailureFacts` extend it. Move the body of the private `executionProbeFacts`/`outputByteLength` in `codex-provider.ts` into `deriveProviderExitFacts` in the existing `src/conductor/src/execution/provider-diagnostics.ts` module; `executionProbeFacts` becomes a call to it. `formatProviderExitFacts` renders `<provider> subprocess exited without a classifiable result:` followed by space-separated `key=value` pairs for exactly the present fields, in the order processErrorCode, exitCode, signal, stdoutBytes, stderrBytes.
4. Verify tests pass (GREEN), including the existing codex readiness-probe tests in `src/conductor/test/execution/codex-provider.test.ts` unchanged.
5. Commit: "feat(providers): extract shared provider exit-facts helper".

**Done when:**
- `deriveProviderExitFacts` returns signal UNKNOWN for SIGUSR1 and processErrorCode UNKNOWN for ECONNRESET, as asserted by the provider-diagnostics unit tests.
- `deriveProviderExitFacts` omits exitCode for -1, 1.5 and the string "1" and keeps an integer 1, as asserted by the provider-diagnostics unit tests.
- `CodexProvider.executionProbeFacts` delegates to `deriveProviderExitFacts`, and the existing codex readiness-diagnostic tests pass without edits to their expected log text.
- `formatProviderExitFacts` emits only the present fields, as asserted by a unit test whose facts lack signal and whose output contains no `signal=`.

**Files:** src/conductor/src/execution/provider-diagnostics.ts, src/conductor/src/execution/llm-provider.ts, src/conductor/src/execution/codex-provider.ts, src/conductor/test/execution/provider-diagnostics.test.ts

**Dependencies:** none

### Task 2: Claude provider records and logs exit facts for an unclassified failure
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/claude-provider.test.ts` using the existing mocked-subprocess pattern: (a) exit 1, no signal, empty stdout/stderr, with a `diagnosticLog` spy; (b) exitCode null, signal SIGKILL, empty output; (c) signal SIGUSR1; (d) each classified failure fixture already in the file (ENOENT/127, auth, rate limit, model unavailable); (e) exit 0 success.
2. Verify tests fail (RED).
3. Implement: add optional `exitFacts?: ProviderExitFacts` to `InvokeResult` in `llm-provider.ts`. In `claude-provider.ts` `classifyCompletion`, compute `deriveProviderExitFacts(result)` from the raw subprocess result (before the `exitCode ?? 1` coalesce) and attach it only on the terminal generic failure return, i.e. a non-success that matched none of the missing-binary, auth, rate-limit, model-unavailable, unresolved-command, or structured-result classifiers; on that same return call `diagnosticLog(formatProviderExitFacts('claude', facts))` once when a diagnosticLog is supplied. Classified returns and successful returns are left byte-for-byte as they are today.
4. Verify tests pass (GREEN).
5. Commit: "feat(claude-provider): record exit code and signal for unclassified failures".

**Done when:**
- For exit 1 with empty output, the claude `classifyCompletion` generic failure path calls diagnosticLog exactly once with a line containing `claude`, `exitCode=1`, `stdoutBytes=0` and `stderrBytes=0`, and the returned result has `exitFacts` equal to {exitCode: 1, stdoutBytes: 0, stderrBytes: 0}.
- For a SIGKILL termination with a null exit code, the diagnostic line contains `signal=SIGKILL` and no `exitCode=`, and the returned `exitFacts` has signal SIGKILL and no exitCode property.
- For a SIGUSR1 termination, the returned `exitFacts.signal` is UNKNOWN and no diagnosticLog call contains the string `SIGUSR1`.
- Each classified failure fixture (missing binary, auth, rate limit, model unavailable) returns a result deep-equal to its pre-change expectation with no `exitFacts` property and emits no exit-facts diagnostic line.
- A successful exit-0 dispatch returns no `exitFacts` property and emits no line starting `claude subprocess exited without a classifiable result`.

**Files:** src/conductor/src/execution/claude-provider.ts, src/conductor/src/execution/llm-provider.ts, src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** 1

### Task 3: Codex and pi providers record and log exit facts for an unclassified failure
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/codex-provider.test.ts` (non-zero exit, empty output, no classified cause) and `src/conductor/test/execution/pi-provider.test.ts` (signal SIGTERM, null exit code, empty output), each with a `diagnosticLog` spy.
2. Verify tests fail (RED).
3. Implement: mirror Task 2 in `codex-provider.ts` `classifyCompletion` and `pi-provider.ts` completion handling — derive facts with `deriveProviderExitFacts` from the raw subprocess result before the `exitCode ?? 1` coalesce, attach `exitFacts` only on the generic unclassified failure return, and log `formatProviderExitFacts('codex'|'pi', facts)` once through diagnosticLog. pi currently has no diagnosticLog wiring; read it from the invoke options the same way codex does. Classified and successful returns are unchanged.
4. Verify tests pass (GREEN).
5. Commit: "feat(providers): record exit facts for codex and pi unclassified failures".

**Done when:**
- A codex unclassified non-zero exit with empty output calls diagnosticLog with a line containing `codex subprocess exited without a classifiable result` and the same exit-fact keys the claude line uses, and the result carries `exitFacts`.
- A pi SIGTERM termination with empty output calls diagnosticLog with a line containing `pi` and `signal=SIGTERM`, and the result `exitFacts.signal` is SIGTERM with no exitCode property.
- Existing codex and pi classified-failure tests (missing binary and codex auth) pass unchanged and their results carry no `exitFacts` property.

**Files:** src/conductor/src/execution/codex-provider.ts, src/conductor/src/execution/pi-provider.ts, src/conductor/test/execution/codex-provider.test.ts, src/conductor/test/execution/pi-provider.test.ts

**Dependencies:** 1, 2

### Task 4: Exit facts on step_retry and step_failed events
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-step-events.test.ts` driving a serial step through the Conductor with a mocked provider whose results carry `exitFacts`: (a) first attempt fails unclassified then succeeds; (b) all attempts fail unclassified with distinct exitFacts per attempt; (c) one fixture per classified cause (missing binary, auth failure, rate limit, model unavailable), each failing with no exitFacts; (d) the step fails with a real FAIL verdict (a successful invoke whose completion check fails) and no exitFacts. Also add a test that feeds a pre-change `step_retry` and `step_failed` JSON line (no providerExit) through the existing `EventPersister` read path.
2. Verify tests fail (RED).
3. Implement: add optional `providerExit?: ProviderExitFacts` to the `step_retry` and `step_failed` members of the `ConductorEvent` union in `src/conductor/src/types/events.ts`. In `src/conductor/src/engine/step-runners.ts`, carry `exitFacts` through wherever the runner rebuilds the invoke result (the same spread that already carries `observedIntervals`). In `src/conductor/src/engine/conductor.ts`, spread `providerExit: result.exitFacts` onto the serial-step `step_retry` emission and `providerExit: failedStepResult.exitFacts` onto the serial-step `step_failed` emission only when present. No new event type, file, or log is added.
4. Verify tests pass (GREEN).
5. Commit: "feat(events): carry provider exit facts on step_retry and step_failed".

**Done when:**
- In the retry-then-succeed fixture, the persisted `step_retry` event has `providerExit` deep-equal to the first attempt's exitFacts, as asserted through the Conductor serial-step path.
- In the all-attempts-fail fixture, the persisted `step_failed` event has `providerExit` deep-equal to the final attempt's exitFacts, not an earlier attempt's.
- In each classified-failure fixture (missing binary, auth failure, rate limit, model unavailable) and the real-FAIL-verdict fixture, neither the `step_retry` nor the `step_failed` event has a `providerExit` property, and the retry count, retry-versus-HALT routing, and terminal HALT class each equal the values produced before this change.
- A pre-change `step_retry` and `step_failed` JSON line without providerExit is read by `EventPersister` without error and yields events deep-equal to their input.

**Files:** src/conductor/src/types/events.ts, src/conductor/src/engine/conductor.ts, src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/conductor-step-events.test.ts

**Dependencies:** 2

### Task 5: build_review grader-dispatch HALT names the final exit facts
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-coordinator.test.ts` and the build_review step-runner tests: a grader invoke returning `success: false` with `exitFacts` {exitCode: 1, stdoutBytes: 0, stderrBytes: 0}, repeated until the mechanical fault allowance is exhausted; and a grader returning a real FAIL verdict.
2. Verify tests fail (RED).
3. Implement: in `src/conductor/src/engine/step-runners.ts`, replace the bare `if (!initial.success) return undefined;` with a `makeBuildReviewDispatchFailure` whose detail is the existing "ended without a result" wording followed by `formatProviderExitFacts(provider, initial.exitFacts)` when exitFacts is present, stamped with a new `cause: 'invalid-provider-result'`. Add that cause to `BuildReviewDispatchFailure`, `makeBuildReviewDispatchFailure` and `parseBuildReviewDispatchFailure` in `src/conductor/src/engine/build-review-domain.ts`, and in `src/conductor/src/engine/build-review-coordinator.ts` map it to the infrastructure reason `invalid-provider-result` (a dispatch-failure without a cause is otherwise classified `invalid-structured-result`, which would change the reason). `renderExhaustedMechanicalBuildReviewHalt` already renders the failure detail; the HALT class and the mechanical-fault allowance are not changed.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-review): name grader exit facts in dispatch-failure HALT".

**Done when:**
- When the grader invoke fails with exitFacts and the mechanical fault allowance is exhausted, the HALT text from `renderExhaustedMechanicalBuildReviewHalt` contains `exitCode=1` and the infrastructure reason `invalid-provider-result`.
- The exhausted grader-dispatch HALT is written with HALT class `needs-human`, identical to the class written before this change, and no park or re-dispatch is scheduled.
- A grader that returns a real FAIL verdict produces no dispatch-failure, no `invalid-provider-result` infrastructure result, and kicks back to build as before.

**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/src/engine/build-review-domain.ts, src/conductor/src/engine/build-review-coordinator.ts, src/conductor/test/engine/build-review-coordinator.test.ts

**Dependencies:** 2

### Task 6: Exit facts on step_retry and step_failed events for group members
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-step-events.test.ts` driving (a) a built-in validation-group member (for example `prd_audit` in the `prd_audit` group) and (b) a member of a configured parallel group (through `runParallelGroupViaCore`) with a mocked provider whose results carry `exitFacts`: first attempt fails unclassified then succeeds; all attempts fail unclassified with distinct exitFacts per attempt; and one classified-cause fixture with no exitFacts.
2. Verify tests fail (RED).
3. Implement: in `src/conductor/src/engine/conductor.ts`, spread `providerExit` from the member's attempt result onto every validation-group and parallel-group member `step_retry` and `step_failed` emission, only when exitFacts are present, exactly as Task 4 does for the serial path. No new event type, file, or log is added.
4. Verify tests pass (GREEN).
5. Commit: "feat(events): carry provider exit facts for group-member step events".

**Done when:**
- For a built-in validation-group member and for a configured parallel-group member, the retry-then-succeed fixture persists a `step_retry` event whose `providerExit` is deep-equal to the first attempt's exitFacts, as asserted in conductor-step-events.test.ts.
- For a built-in validation-group member and for a configured parallel-group member, the all-attempts-fail fixture persists a `step_failed` event whose `providerExit` is deep-equal to the final attempt's exitFacts.
- For a group member failing with a classified cause, neither its `step_retry` nor its `step_failed` event has a `providerExit` property.

**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/conductor-step-events.test.ts

**Dependencies:** 4

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──┬──▶ Task 3
                    ├──▶ Task 4
                    └──▶ Task 5
Task 4 ──▶ Task 6
(Task 3 also depends on Task 1)
```

## Integration Points

- After Task 2: a claude empty-output crash is diagnosable from daemon.log.
- After Task 4: exit facts are queryable from `.pipeline/events.jsonl`.
- After Task 6: exit facts also reach step events for validation-group and parallel-group members.
- After Task 5: a build_review grader-dispatch HALT file names the exit code or signal.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a claude dispatch whose subprocess exits with code 1, no signal, and empty stdout and stderr, when the dispatch completes, then daemon.log receives one diagnostic line naming provider claude with exitCode=1, stdoutBytes=0, and stderrBytes=0. | 2 | "For exit 1 with empty output, the claude `classifyCompletion` generic failure path calls diagnosticLog exactly once with a line containing `claude`, `exitCode=1`, `stdoutBytes=0` and `stderrBytes=0`, and the returned result has `exitFacts` equal to {exitCode: 1, stdoutBytes: 0, stderrBytes: 0}." | diff-local |
| Story 1 happy: Given a claude dispatch whose subprocess is terminated by SIGKILL with a null exit code and empty output, when the dispatch completes, then the diagnostic line names signal=SIGKILL and omits exitCode rather than reporting exitCode=1. | 2 | "For a SIGKILL termination with a null exit code, the diagnostic line contains `signal=SIGKILL` and no `exitCode=`, and the returned `exitFacts` has signal SIGKILL and no exitCode property." | diff-local |
| Story 1 happy: Given a claude dispatch that fails without a classifiable result, when the result is returned, then the result carries the same exit facts (exitCode, signal, stdoutBytes, stderrBytes) as structured fields. | 2 | "For exit 1 with empty output, the claude `classifyCompletion` generic failure path calls diagnosticLog exactly once with a line containing `claude`, `exitCode=1`, `stdoutBytes=0` and `stderrBytes=0`, and the returned result has `exitFacts` equal to {exitCode: 1, stdoutBytes: 0, stderrBytes: 0}." | diff-local |
| Story 1 negative: Given a claude subprocess terminated by a signal outside the known set (for example SIGUSR1), when the dispatch completes, then the recorded signal is UNKNOWN and no raw unrecognized string reaches the log. | 2 | "For a SIGUSR1 termination, the returned `exitFacts.signal` is UNKNOWN and no diagnosticLog call contains the string `SIGUSR1`." | diff-local |
| Story 1 negative: Given a claude dispatch that fails with a classified cause (missing binary, auth failure, rate limit, or model unavailable), when the dispatch completes, then the existing classification and its HALT or retry routing are unchanged. | 2, 4 | "In each classified-failure fixture (missing binary, auth failure, rate limit, model unavailable) and the real-FAIL-verdict fixture, neither the `step_retry` nor the `step_failed` event has a `providerExit` property, and the retry count, retry-versus-HALT routing, and terminal HALT class each equal the values produced before this change." | diff-local |
| Story 1 negative: Given a claude dispatch that succeeds with exit code 0, when it completes, then no exit-facts diagnostic line is written. | 2 | "A successful exit-0 dispatch returns no `exitFacts` property and emits no line starting `claude subprocess exited without a classifiable result`." | diff-local |
| Story 2 happy: Given a codex dispatch whose subprocess exits non-zero with empty output and no classifiable cause, when the dispatch completes, then daemon.log receives a diagnostic line naming provider codex with the same exit-fact fields as claude. | 3 | "A codex unclassified non-zero exit with empty output calls diagnosticLog with a line containing `codex subprocess exited without a classifiable result` and the same exit-fact keys the claude line uses, and the result carries `exitFacts`." | diff-local |
| Story 2 happy: Given a pi dispatch whose subprocess is terminated by SIGTERM with empty output, when the dispatch completes, then daemon.log receives a diagnostic line naming provider pi with signal=SIGTERM. | 3 | "A pi SIGTERM termination with empty output calls diagnosticLog with a line containing `pi` and `signal=SIGTERM`, and the result `exitFacts.signal` is SIGTERM with no exitCode property." | diff-local |
| Story 2 happy: Given the codex readiness probe fails, when it logs its readiness diagnostic, then the logged facts are identical in content to what the probe logged before this change. | 1 | "`CodexProvider.executionProbeFacts` delegates to `deriveProviderExitFacts`, and the existing codex readiness-diagnostic tests pass without edits to their expected log text." | diff-local |
| Story 2 negative: Given a process error code outside the known set (not EACCES, EAGAIN, ENOENT, or EPERM), when exit facts are derived for any provider, then processErrorCode is recorded as UNKNOWN. | 1 | "`deriveProviderExitFacts` returns signal UNKNOWN for SIGUSR1 and processErrorCode UNKNOWN for ECONNRESET, as asserted by the provider-diagnostics unit tests." | diff-local |
| Story 2 negative: Given an exit code that is negative, non-integer, or non-numeric, when exit facts are derived, then exitCode is omitted rather than coerced. | 1 | "`deriveProviderExitFacts` omits exitCode for -1, 1.5 and the string "1" and keeps an integer 1, as asserted by the provider-diagnostics unit tests." | diff-local |
| Story 3 happy: Given a step whose provider dispatch fails without a classifiable result and is retried, when the step_retry event is persisted, then it carries an optional providerExit field with the recorded exit facts. | 4 | "In the retry-then-succeed fixture, the persisted `step_retry` event has `providerExit` deep-equal to the first attempt's exitFacts, as asserted through the Conductor serial-step path." | diff-local |
| Story 3 happy: Given a step whose provider dispatch fails without a classifiable result and exhausts its retries, when the step_failed event is persisted, then it carries the providerExit field with the exit facts of the final attempt. | 4 | "In the all-attempts-fail fixture, the persisted `step_failed` event has `providerExit` deep-equal to the final attempt's exitFacts, not an earlier attempt's." | diff-local |
| Story 3 happy: Given a build_review grader dispatch that fails without a result and exhausts its retries, when the HALT is written, then the HALT reason text includes the final attempt's exit code and/or signal. | 5 | "When the grader invoke fails with exitFacts and the mechanical fault allowance is exhausted, the HALT text from `renderExhaustedMechanicalBuildReviewHalt` contains `exitCode=1` and the infrastructure reason `invalid-provider-result`." | diff-local |
| Story 3 negative: Given a step that fails with a real FAIL verdict or a classified provider cause, when its events are persisted, then no providerExit field is present and the HALT class and routing are unchanged. | 4 | "In each classified-failure fixture (missing binary, auth failure, rate limit, model unavailable) and the real-FAIL-verdict fixture, neither the `step_retry` nor the `step_failed` event has a `providerExit` property, and the retry count, retry-versus-HALT routing, and terminal HALT class each equal the values produced before this change." | diff-local |
| Story 3 negative: Given an events.jsonl written before this change with no providerExit field, when it is read by existing event consumers, then it parses without error. | 4 | "A pre-change `step_retry` and `step_failed` JSON line without providerExit is read by `EventPersister` without error and yields events deep-equal to their input." | diff-local |
| Story 3 negative: Given a grader dispatch failure that exhausts its retries, when the HALT is written, then its HALT class is the same as before this change (no auto-park or auto-retry is introduced). | 5 | "The exhausted grader-dispatch HALT is written with HALT class `needs-human`, identical to the class written before this change, and no park or re-dispatch is scheduled." | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
