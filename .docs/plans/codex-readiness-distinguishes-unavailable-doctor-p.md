# Implementation Plan: Codex Readiness Probe Failure Separation (#1039)

**Date:** 2026-07-30
**Design:** `.docs/specs/codex-readiness-distinguishes-unavailable-doctor-p.md`
**Stories:** `.docs/stories/codex-readiness-distinguishes-unavailable-doctor-p.md`
**Conflict check:** Clean as of 2026-07-30
**Approval:** James Stoup approved this plan and its plan-updated architecture on 2026-07-30.

## Summary

This plan separates inconclusive Codex doctor probes from affirmative credential verdicts, lets normal dispatch continue with bounded diagnostics, and gives an active recovery episode one non-recursive real invocation trial. Twenty small TDD tasks cover the provider contract, secret-safe evidence, configuration wiring, every recovery call shape, progress events, and stale acceptance expectations.

## Technical Approach

- Replace the flat readiness state with an exhaustive discriminated union whose `probe-failed` member carries a closed failure kind and bounded allowlisted facts. Preserve the existing selected-source, unrelated-health, `missing`, and `unusable` meanings.
- Keep the classification and diagnostic boundary in `CodexProvider`: doctor execution and parsing failures become `probe-failed`, unattended invocation proceeds, and the real invocation result remains authoritative. No raw doctor output, arbitrary exception text, path, credential material, or hashes cross the provider boundary.
- Resolve `codex_doctor_timeout_seconds` during normal config loading, validate it as finite and positive, and inject milliseconds through both composition roots into `registerBuiltins` and `CodexProvider` without changing any other timeout.
- Change auth recovery to return `recovered`, `trial-required`, or `halt`. Serial, group, and auxiliary callers consume `trial-required` exactly once; an auth-failed trial halts probe-specifically and cannot recurse, while success and non-auth failures resume their existing handling.
- Widen the existing `credentials_park_progress` event with closed probe-failure metadata and disposition, then update persistence, rendering, and completeness fixtures exhaustively. All tests fake the doctor/Codex boundary and use injected clocks or sleeps.

## Prerequisites

- The approved #1039 PRD amendment, architecture review, ADR, accepted stories, and clean conflict check remain authoritative.
- Before editing the high-contention provider contract, refresh `llm-provider.ts` and `codex-provider.ts` signatures against the feature branch.
- Use injected doctor/Codex runners and deterministic clocks only; no ordinary test may invoke the real Codex CLI, service, network, or credential store.

## Tasks

### Task 1: Introduce the discriminated readiness contract
**Story:** Story 1 AC-1.1, AC-1.2, AC-1.3; Story 2 AC-2.3
**Type:** infrastructure

**Steps:**
1. Write failing compile-time/unit assertions for exhaustive `ready`, `missing`, `unusable`, and `probe-failed` members, including required selected-source and closed probe metadata.
2. Verify the assertions fail (RED).
3. Implement the discriminated `AuthenticationReadiness` union and closed probe-failure fact types without free-form payload or message fields.
4. Verify the assertions pass (GREEN).
5. Commit with message: "define Codex probe-failure readiness contract"

**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invoke`, `src/conductor/src/execution/codex-provider.ts#CodexProvider.invokeInteractive`, `src/conductor/src/engine/conductor.ts#Conductor.parkOnAuthFailure`
**Dependencies:** none

### Task 2: Preserve ready evidence and unrelated-health separation
**Story:** Story 1 AC-1.1, AC-1.1N
**Type:** happy-path

**Steps:**
1. Add a failing doctor-evidence table proving ready selected-source evidence stays `ready` even when unrelated checks are degraded.
2. Verify the table fails under the new exhaustive contract (RED).
3. Adapt the Codex readiness classifier to emit the ready member while retaining bounded unrelated-health facts.
4. Verify the table passes and invocation remains authorized (GREEN).
5. Commit with message: "preserve affirmative Codex readiness evidence"

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Preserve conclusive missing and unusable verdicts
**Story:** Story 1 AC-1.3, AC-1.3N
**Type:** negative-path

**Steps:**
1. Add failing cases for explicit missing and rejected selected-source evidence, including mixed output that must not be relabeled as probe failure.
2. Verify the cases fail (RED).
3. Adapt the classifier and provider gate so conclusive `missing` and `unusable` remain blocking credential verdicts.
4. Verify no substantive invoke runner starts for either verdict (GREEN).
5. Commit with message: "preserve conclusive Codex credential verdicts"

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 4: Classify doctor execution errors and timeouts
**Story:** Story 1 AC-1.2; Story 2 AC-2.1
**Type:** negative-path

**Steps:**
1. Add failing injected-runner cases for spawn/exec rejection and doctor timeout, asserting distinct closed failure kinds and timeout facts.
2. Verify both cases fail (RED).
3. Classify doctor runner failures as `probe-failed` without converting them to credential verdicts.
4. Verify the exact failure kind and configured timeout are retained (GREEN).
5. Commit with message: "classify Codex doctor execution probe failures"

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 5: Classify parser and evidence ambiguity failures
**Story:** Story 1 AC-1.2; Story 2 AC-2.2
**Type:** negative-path

**Steps:**
1. Add failing table cases for invalid JSON, unsupported schema, unrecognized envelope, conflicting selected-source evidence, and ambiguous evidence.
2. Verify each case fails with its expected closed parser-rejection kind (RED).
3. Return `probe-failed` plus bounded allowlisted shape facts from every parser/evidence rejection branch.
4. Verify all cases are distinct from `missing` and `unusable` (GREEN).
5. Commit with message: "classify Codex doctor evidence probe failures"

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 6: Continue ordinary invocation after a failed probe
**Story:** Story 1 AC-1.2N; Story 5 AC-5.1, AC-5.1N
**Type:** happy-path

**Steps:**
1. Add a failing provider test proving `invoke()` starts the real runner after `probe-failed` and does not synthesize `authFailure` or fallback metadata.
2. Verify the runner is currently blocked (RED).
3. Make the ordinary unattended gate block only affirmative credential verdicts and proceed on probe failure.
4. Verify one real invocation occurs with retry/escalation/fallback state untouched (GREEN).
5. Commit with message: "continue Codex invoke after probe failure"

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invoke`
**Dependencies:** Tasks 2, 3, 4, 5

### Task 7: Preserve streaming and real-result precedence
**Story:** Story 5 AC-5.1, AC-5.3, AC-5.3N
**Type:** negative-path

**Steps:**
1. Add failing unattended `invokeInteractive()`/resume cases proving probe failure starts one real invocation and a table of real success, auth, unavailable, rate-limit, permission, model, session, and ordinary failures keeps its existing classification.
2. Verify the unattended path blocks or overwrites real results (RED).
3. Apply the same degraded gate to noninteractive streaming/resume while leaving true interactive behavior unchanged and preserving actual-result precedence.
4. Verify every real result is authoritative and selected provider/source context survives (GREEN).
5. Commit with message: "preserve Codex streaming result precedence"

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invokeInteractive`
**Dependencies:** Tasks 2, 3, 4, 5

### Task 8: Emit secret-safe execution diagnostics
**Story:** Story 2 AC-2.1, AC-2.1N
**Type:** negative-path

**Steps:**
1. Add failing adversarial exec-error and timeout fixtures containing credential fragments in stdout, stderr, exception text, paths, and environment-like content.
2. Verify unsafe content crosses the readiness or diagnostic-log boundary (RED).
3. Emit only the closed failure kind and allowlisted primitive process facts, including configured timeout for timeout failures.
4. Verify the feature diagnostic contains useful facts and none of the forbidden text, fragments, paths, or hashes (GREEN).
5. Commit with message: "sanitize Codex doctor execution diagnostics"

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invoke`, `src/conductor/src/execution/codex-provider.ts#CodexProvider.invokeInteractive`
**Dependencies:** Task 4

### Task 9: Bound parser diagnostics and tolerate a missing sink
**Story:** Story 2 AC-2.2, AC-2.3, AC-2.2N, AC-2.3N
**Type:** negative-path

**Steps:**
1. Add failing parser fixtures with unknown fields, sensitive summaries, and raw payloads, plus an invocation without `diagnosticLog`.
2. Verify unsafe shape content is retained or the sinkless path fails (RED).
3. Restrict parser diagnostics to allowlisted primitive shape facts/byte counts and make logging optional without changing dispatch authorization.
4. Verify no raw payload/summary appears and the sinkless real invocation proceeds (GREEN).
5. Commit with message: "bound Codex parser probe diagnostics"

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** same as Task 8
**Dependencies:** Task 5

### Task 10: Validate the readiness-timeout configuration
**Story:** Story 4 AC-4.1, AC-4.2, AC-4.1N
**Type:** infrastructure

**Steps:**
1. Add failing config cases for omitted/default, custom finite-positive, zero, negative, string, `NaN`, and infinity values with key-specific errors.
2. Verify the config tests fail (RED).
3. Add `codex_doctor_timeout_seconds` to the config type and fail-closed validator with a default of 10 seconds.
4. Verify default/custom values resolve and every invalid class is rejected by name (GREEN).
5. Commit with message: "validate Codex doctor readiness timeout"

**Files:** `src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`, `src/conductor/test/config-validation.test.ts`, `src/conductor/test/engine/config.test.ts`
**Wired-into:** `src/conductor/src/engine/plugin-loader.ts#registerBuiltins`
**Dependencies:** none

### Task 11: Inject the resolved timeout at both composition roots
**Story:** Story 4 AC-4.1, AC-4.2, AC-4.2N
**Type:** infrastructure

**Steps:**
1. Add failing composition tests that capture the doctor runner timeout from CLI and daemon config, plus controls for other provider/invocation/park timeouts.
2. Verify the provider still receives the private hardcoded value (RED).
3. Thread only the resolved readiness timeout through `main`, `runDaemonMode`, `registerBuiltins`, and the `CodexProvider` constructor.
4. Verify default/custom milliseconds reach the doctor boundary and no unrelated timeout changes (GREEN).
5. Commit with message: "wire Codex readiness timeout into provider"

**Files:** `src/conductor/src/index.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/plugin-loader.ts`, `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/engine/plugin-loader.test.ts`, `src/conductor/test/acceptance/daemon-merged-config-967.acceptance.test.ts`
**Wired-into:** `src/conductor/src/index.ts#main`, `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** Task 10

### Task 12: Make auth-recovery dispositions explicit
**Story:** Story 3 AC-3.1, AC-3.1N
**Type:** refactor

**Steps:**
1. Add failing coordinator tests for ready recovery, continuing missing/unusable parking, and the existing credential deadline halt.
2. Verify the old `{ timedOut, haltReason }` result cannot express the expected dispositions (RED).
3. Replace it with exhaustive `recovered`, `trial-required`, and `halt` dispositions while preserving ready and conclusive non-ready behavior.
4. Verify ready resumes, missing/unusable never authorize a trial, and the existing timeout reason remains (GREEN).
5. Commit with message: "make auth recovery dispositions explicit"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`, `src/conductor/src/engine/conductor.ts#Conductor.dispatchSpotAuditVerifier`
**Dependencies:** Task 1

### Task 13: Return trial-required for recovery probe failure
**Story:** Story 3 AC-3.2; Story 5 AC-5.2
**Type:** happy-path

**Steps:**
1. Add a failing deterministic-clock recovery test where readiness changes from affirmative auth failure to `probe-failed`.
2. Verify recovery continues parking or halts instead of returning one `trial-required` disposition (RED).
3. Return `trial-required` once for that recovery episode and emit closed provider/source, failure-kind, elapsed, and next-disposition progress facts.
4. Verify no retry/fallback/escalation budget changes and no invocation occurs inside the coordinator (GREEN).
5. Commit with message: "authorize one trial after recovery probe failure"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** same as Task 12
**Dependencies:** Tasks 4, 5, 12

### Task 14: Enforce one recovery trial in serial dispatch
**Story:** Story 3 AC-3.3, AC-3.2N, AC-3.3N; Story 5 AC-5.3
**Type:** negative-path

**Steps:**
1. Add failing serial-dispatch cases for successful, non-auth-failed, and auth-failed authorized trials, including a second simulated probe failure.
2. Verify serial handling either never trials or can recurse into another recovery episode (RED).
3. Consume `trial-required` once: resume ordinary handling for success/non-auth failure and produce a secret-safe probe-specific halt for trial auth failure.
4. Verify one invocation maximum, no recursive bypass, and unchanged retry/escalation/provider/source state (GREEN).
5. Commit with message: "bound serial Codex recovery trial"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`
**Dependencies:** Task 13

### Task 15: Enforce one recovery trial in concurrent groups
**Story:** Story 3 AC-3.3, AC-3.2N, AC-3.3N; Story 5 AC-5.1, AC-5.1N
**Type:** negative-path

**Steps:**
1. Add failing group-join cases for successful/non-auth trials and an auth-failed trial beside an already completed sibling.
2. Verify group handling retries incorrectly, loses sibling work, or re-enters recovery (RED).
3. Consume the disposition once in the group path while preserving completed siblings and existing join/result classification.
4. Verify one trial maximum, no recursion, and unchanged group budget/provider selection (GREEN).
5. Commit with message: "bound grouped Codex recovery trial"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`
**Dependencies:** Task 13

### Task 16: Enforce one recovery trial in auxiliary verification
**Story:** Story 3 AC-3.3, AC-3.2N, AC-3.3N; Story 5 AC-5.1, AC-5.1N
**Type:** negative-path

**Steps:**
1. Add failing judged-step and spot-audit verifier cases for success/non-auth and auth-failed authorized trials.
2. Verify an auxiliary caller drops `trial-required`, retries, or re-enters recovery (RED).
3. Consume the disposition once in auxiliary callers and route the real result through existing verdict/audit adapters.
4. Verify one trial maximum and unchanged budget, escalation, provider/source, and completed primary work (GREEN).
5. Commit with message: "bound auxiliary Codex recovery trial"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.dispatchSpotAuditVerifier`, `src/conductor/src/engine/conductor.ts#Conductor.run`
**Dependencies:** Task 13

### Task 17: Persist and render probe-failure progress exhaustively
**Story:** Story 5 AC-5.2, AC-5.2N
**Type:** infrastructure

**Steps:**
1. Add failing event type, persister, sink-policy, terminal-subscriber, CLI renderer, daemon renderer, and audit-completeness fixtures for probe-failure kind and next disposition.
2. Verify at least one production subscription or exhaustive consumer rejects or ignores the widened variant (RED).
3. Extend `credentials_park_progress` with closed probe metadata and disposition, subscribe both operator surfaces, and update every existing consumer without changing its audit allowlist.
4. Verify provider/source/kind/elapsed/disposition persist and render in CLI and daemon modes while audit persistence remains unchanged (GREEN).
5. Commit with message: "report Codex recovery probe-failure progress"

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-persister.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/ui/subscriber.ts`, `src/conductor/src/ui/create-renderer.ts`, `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/event-persister.test.ts`, `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/ui/subscriber-events.test.ts`, `src/conductor/test/ui/create-renderer.test.ts`, `src/conductor/test/ui/terminal-renderer.test.ts`, `src/conductor/test/daemon-render-progress.test.ts`, `src/conductor/test/integration/audit-trail-completeness.integration.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.parkOnAuthFailure`, `src/conductor/src/ui/subscriber.ts#TerminalSubscriber.start`, `src/conductor/src/ui/create-renderer.ts#createRenderer`, `src/conductor/src/ui/terminal-renderer.ts#TerminalRenderer.handle`, `src/conductor/src/daemon-cli.ts#renderDaemonEvent`
**Dependencies:** Task 13

### Task 18: Replace stale fail-closed provider acceptance expectations
**Story:** Story 1 AC-1.1 through AC-1.3N; Story 2 AC-2.1N, AC-2.2N, AC-2.3N; Story 5 AC-5.1, AC-5.1N
**Type:** negative-path

**Steps:**
1. Change the existing #905 acceptance expectations to require degraded dispatch for each inconclusive probe class while retaining affirmative credential blocking, and run them to expose the production gap (RED).
2. Verify the amended scenarios fail against incomplete wiring (RED).
3. Make only the smallest provider/runtime adapter corrections revealed by the acceptance path.
4. Verify every amended provider scenario passes with a fake Codex runner and no real third-party call (GREEN).
5. Commit with message: "accept degraded Codex readiness dispatch"

**Files:** `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/test/engine/provider-runtime.test.ts`, `src/conductor/test/acceptance/codex-auth-sandbox-readiness.acceptance.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`
**Dependencies:** Tasks 6, 7, 8, 9

### Task 19: Cover bounded recovery as an acceptance flow
**Story:** Story 3 AC-3.1 through AC-3.3N; Story 5 AC-5.2
**Type:** negative-path

**Steps:**
1. Amend the #970 acceptance flow with failing `probe-failed` recovery scenarios for one real trial, conclusive non-ready timeout, success/non-auth continuation, and auth-failed no-recursion halt.
2. Verify the old recovery behavior fails the amended scenarios (RED).
3. Correct only integration gaps between the coordinator, callers, and progress event exposed by the acceptance flow.
4. Verify deterministic serial, grouped, and auxiliary scenarios pass with fake providers and bounded clocks (GREEN).
5. Commit with message: "accept bounded Codex recovery trial"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/codex-readiness-park-970.acceptance.test.ts`
**Wired-into:** same as Task 12
**Dependencies:** Tasks 14, 15, 16, 17

### Task 20: Prove the full propagation matrix and actual-failure precedence
**Story:** Story 5 AC-5.1, AC-5.1N, AC-5.3, AC-5.3N
**Type:** negative-path

**Steps:**
1. Add failing table-driven integration cases spanning initial, model-ladder, serial, group, resumed-equivalent, judged, and auxiliary adapters after degraded preflight.
2. Verify at least one adapter drops probe distinction, synthesizes auth failure, bypasses invocation, or overwrites a real non-auth result (RED).
3. Make exhaustive adapter corrections only where the matrix exposes a gap.
4. Verify every call shape invokes once, preserves actual result precedence, and leaves fallback/retry/escalation/source state unchanged (GREEN).
5. Commit with message: "prove Codex probe-failure propagation matrix"

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`, `src/conductor/test/engine/provider-runtime.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.run`, `src/conductor/src/engine/conductor.ts#Conductor.dispatchSpotAuditVerifier`
**Dependencies:** Tasks 18, 19

## Task Dependency Graph

```text
1 ─┬─> 2 ─┐
   ├─> 3 ─┼─> 6 ─┐
   ├─> 4 ─┤      ├─> 18 ─┐
   └─> 5 ─┘ 7 ───┘       │
        │     8 ──────────┤
        └────> 9 ─────────┘

10 ─> 11

1 ─> 12 ─> 13 ─┬─> 14 ─┐
       ^        ├─> 15 ─┼─> 19 ─> 20
       └─ 4,5 ──┼─> 16 ─┤
                └─> 17 ─┘

18 ─────────────────────────> 20
```

## Integration Points

- After Task 9: every normal Codex invocation path can be exercised end-to-end from doctor failure through sanitized diagnostic to a real classified result.
- After Task 11: both CLI and daemon config paths can prove the exact readiness timeout reaches the doctor runner without affecting other timeouts.
- After Task 17: the coordinator can emit a probe-failure trial disposition through persistence and rendering with exhaustive closed fields.
- After Task 19: serial, grouped, and auxiliary auth recovery can be exercised as bounded fake-provider flows.
- After Task 20: the full provider/runtime/caller propagation matrix is covered before aggregate verification.

## Acceptance-Criteria Coverage

| Story | Happy-path criteria | Negative-path criteria | Tasks |
|---|---|---|---|
| Story 1 | AC-1.1, AC-1.2, AC-1.3 | AC-1.1N, AC-1.2N, AC-1.3N | 1-6, 18 |
| Story 2 | AC-2.1, AC-2.2, AC-2.3 | AC-2.1N, AC-2.2N, AC-2.3N | 1, 4, 5, 8, 9, 18 |
| Story 3 | AC-3.1, AC-3.2, AC-3.3 | AC-3.1N, AC-3.2N, AC-3.3N | 12-16, 19 |
| Story 4 | AC-4.1, AC-4.2 | AC-4.1N, AC-4.2N | 10, 11 |
| Story 5 | AC-5.1, AC-5.2, AC-5.3 | AC-5.1N, AC-5.2N, AC-5.3N | 6, 7, 13-20 |

## Verification

- [x] Stories exist, every story has happy and negative paths, and conflict-check passed cleanly.
- [x] Every acceptance criterion maps to at least one task; every negative path has an explicit negative-path task.
- [x] Tasks are scoped to a single small test/implementation seam and target 2-5 minutes each.
- [x] Every task has an explicit RED/GREEN cycle, authoritative repo-relative `Files`, valid architecture-derived `Wired-into`, and acyclic dependencies.
- [x] Configuration, doctor/Codex execution, clocks, and sleeps use deterministic injected fakes; no task requires a real third-party call.
- [x] Ordinary documentation is excluded from the implementation plan.
- [x] Advisory overlap scan completed against the union of task files; output was broad historical `spec/*` scanner noise with no specific blocking dependency.
- [x] Architecture diagram updated in plan-update mode and re-rendered successfully.
- [x] Architecture review validated the plan; operator approval recorded on 2026-07-30.

## Verify-Claims Verdict

**CLEAR:** every named production symbol, config composition root, recovery caller, event consumer, and test seam was verified in the current branch. The only intentionally deferred uncertainty is whether a specific adapter needs code after its RED test; those integration tasks prescribe the smallest correction revealed by evidence rather than assuming a change.
