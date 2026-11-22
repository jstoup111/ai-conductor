# Implementation Plan: Recover suite proof before build review (#3586)

**Date:** 2026-11-21
**Design:** .docs/specs/2026-11-21-recover-automatically-when-build-review-needs-fres.md
**Stories:** .docs/stories/recover-automatically-when-build-review-needs-fres.md
**Conflict check:** Tier S. The accepted routing story and D3 have been reconciled in DECIDE.

## Technical Approach

Handle freshness in the active build region, where the conductor and review assembler know the child and base. Restage the native suite step and resume review through ordinary scheduling. This keeps executable tests, proof publication, and genuine suite failures with their current owner. The early check must run after child activation and before a review prerequisite refusal or review dispatch. The late check must independently inspect the same scope at input assembly, since a tree can change between checks.

Recovery belongs to the whole feature. Persist a small optional recovery record in conduct state through the existing compare-and-set store. Distinguish a pending request from a started suite attempt and keep an attempt identity so restart/replay cannot debit a single admission twice. The verifier reserves capacity after its locked freshness recheck. The selected suite executor itself owns the durable start transition. An interrupted reservation can be resumed under the same identity. An interrupted started attempt stays spent. Existing tests, preservation, and public verifier callers that do not request proof recovery retain their ordinary paths. Keep existing retry_decision and suite telemetry on the event spine.

## Tasks

### Task 1: Unify child scope for suite proof inspection

**Story:** Story 1
**Type:** negative-path
**Dependencies:** none
**Files:** `src/conductor/src/engine/build-review-inputs.ts`, `src/conductor/test/engine/build-review-inputs.test.ts`

**Steps:**

1. Exercise review input assembly with a scoped stacked child whose selection base differs from the feature base. Supply actual child-local evidence for the desired selectors and a sibling with a different fingerprint. Establish RED for the current default verifier call.
2. Pass the resolved childBase and activeChild to the default proof inspection as the conductor does in fullSuiteVerifyOptions. Preserve the injected inspection seam, the later frozen inspection reuse, and root behavior. Run the focused cases to GREEN and commit.

**Done when:**

- [test] The default assembleBuildReviewInputs verifier accepts current proof selected against the active child’s own base in scoped mode.
- [test] With current sibling proof and stale active-child proof the assembler returns the typed TestSuiteProofError before freezing inputs.

### Task 2: Admit at most two recovery executions for the feature

**Story:** Story 3
**Type:** infrastructure
**Dependencies:** none
**Files:** `src/conductor/src/types/state.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/full-suite-verifier.ts`, `src/conductor/src/engine/full-suite-executor.ts`, `src/conductor/test/engine/full-suite-verifier.test.ts`, `src/conductor/test/engine/conductor.test.ts`

**Steps:**

1. Test a feature-level pending request, executable admission, and settlement using the conductor state store and the actual locked verifier decision with a fake executor. Include old state with no record, a peer publishing a PASS before lock acquisition, a restarted conductor, and a competing admission. Establish the missing accounting behavior in RED.
2. Add an optional root-owned recovery state field. Associate a pending request with its review context, including child identity when present. Preserve the count of started attempts across context changes and process restarts. Restaging/reinspection is idempotent. On a fresh feature initialize from zero. Use compare-and-set mutations and reread on a conflicting admission to avoid lost reservations or charges. After restart, reconcile current proof, then reclaim a reserved-but-unstarted identity under the suite lock. Fence off a superseded owner so it cannot begin the same attempt later.
3. After the verifier’s locked reuse decision, reserve capacity without charging it and pass an identity-bound start callback to the selected aggregate, changed, or scoped suite executor. After that executor has actually entered and validated its inputs, its first execution action is to atomically mark the reserved attempt started and spend one slot. Persist this transition through the existing state store before running suite commands. A failed transition cannot proceed to commands. One executor invocation covering multiple commands starts one attempt. Restart before the start transition leaves the count unchanged; after it the already-started attempt stays spent even if interrupted. A refusal must release the suite lock and propagate an explicit exhausted result to the conductor before any command starts. Do not reinterpret exhaustion as a test failure. Run the scoped cases to GREEN and commit.

**Done when:**

- [test] Through the native verifier, ordinary suite executions, repeated inspections, and reuse after a peer publishes current proof each spend zero recovery attempts; one recovery execution observed by multiple inspections spends exactly one.
- [test] After loading pre-feature state or a saved recovery in a new conductor, admission starts at zero or the stored count respectively; contending writers cannot admit a third execution, and a refused admission releases the verifier lock.

- [test] Cutting execution after reservation but before executor start leaves the spent count unchanged on restart; cutting it after the executor records its start leaves exactly one spent attempt for that identity.

### Task 3: Restage the active suite before dispatching review

**Story:** Story 1
**Type:** happy-path
**Dependencies:** Task 1, Task 2
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`

**Steps:**

1. Using Conductor.run() and its controlled verifier/runner fixtures, exercise ordinary, direct, routed and resumed entry with unusable proof, plus current and preserved proof. Include a resumed child with a sibling PASS. Verify that missing or stale proof can currently cause review or a prerequisite halt before recovery.
2. Extend the common review entry in the outer step loop after child activation and before checkGate for a review that would otherwise be reached. Preserve unrelated prerequisite, applicability and safety checks. Resolve missing proof even when test_suite is not marked done. Keep the existing preservation treatment including recording before proof is considered current. Use fresh, child-aware inspection, independent of retained suite results.
3. For daemon proof-verified runs with retry routing enabled, persist the pending recovery for this context and restage the child-aware suite and review statuses via the existing state store. Use the registry index to revisit test_suite and continue the loop. Reconcile pending work on resume before any skip based on old done statuses. Keep checkGate, ordinary native suite execution, child overlays and review completion authoritative. Run focused tests to GREEN and commit.

**Done when:**

- [test] Through Conductor.run() each of ordinary progression, direct entry, routed entry and resume with missing or stale proof and an available attempt executes test_suite for the active context before its first build_review dispatch, then reaches that review verdict once proof is current.
- [test] With current proof and with successfully preserved proof, Conductor.run() dispatches review and reaches its verdict with exactly zero recovery suite executions.
- [test] With current proof for a sibling and stale proof for the active stacked child, a resumed conductor executes the active child’s suite, obtains current proof for that child, then dispatches that child’s first review and records its verdict.

### Task 4: Route late proof failure and preserve suite failure handling

**Story:** Story 2
**Type:** negative-path
**Dependencies:** Task 3
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/engine/conductor-halt.test.ts`

**Steps:**

1. Make early inspection current, then change proof before runner assembly so the established typed retryAfterStep route fires. Exercise both passing recovery and nonzero suite exit via the native suite failure path. Establish RED for the immediate needs-human halt.
2. After the existing first-attempt retry_decision (route, unretryable-inputs) and before the generic terminal halt, handle only verified daemon build_review naming test_suite with retry routing enabled. Reuse the same pending recovery and normal step scheduler as early entry; finish the previous attempt lifecycle before continuing. Settle the recovery request when the native suite reports its result. A nonzero exit follows the existing suite-to-BUILD repair path; preserve infrastructure failure classification. Run focused seam tests and commit.

**Done when:**

- [test] When the early check passes and proof becomes stale at assembly with an attempt available, Conductor.run() automatically executes the suite once for the original feature or child and resumes its review to a verdict after the proof becomes current.
- [test] For early and late recovery, a nonzero test exit follows the same immediate test_suite-to-BUILD repair route as an ordinary suite failure, with zero review dispatches on those results and zero further recovery attempts spent repeating that failure.
- [test] With retry routing disabled the recovery route is bypassed; unrelated typed failures retain existing routing and advisory steps retain their skip.

### Task 5: Report recovery exhaustion and honor successful final attempts

**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 4
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-halt.test.ts`

**Steps:**

1. Drive one early recovery on a child, restart on the same durable feature, and trigger a late failure on another child. Exercise separately the current-proof and stale-proof outcomes after the second recovery. Use the real scheduler, durable root state, and controlled execution, as in the existing daemon halt tests.
2. Handle exhaustion consistently for early and late requests only after determining a new run is needed. Use the existing needs-human marker and loop-halt path with the actual admission count and the unchanged input that needs replacement (unusable test-suite proof). Confirm the native suite result is considered before evaluating a further request. Run the focused cases to GREEN and commit.

**Done when:**

- [test] In Conductor.run(), an early recovery execution on child one followed by restart and a late proof failure on child two permits the second recovery execution for child two; if it yields current proof its review proceeds without an exhaustion halt.
- [test] After two recovery reruns on a feature, either the early check or late assembly asking for fresh proof produces a needs-human halt before any third execution and the halt text identifies unusable test-suite proof, build_review, test_suite, and two attempts.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given missing or stale proof and an available attempt, when review is next in ordinary progression, on direct or routed entry, or after resume, then the suite runs in the active build context before review is dispatched. When the new proof is current, review proceeds to its verdict. | 3 | "Through Conductor.run() each of ordinary progression, direct entry, routed entry and resume with missing or stale proof and an available attempt executes test_suite for the active context before its first build_review dispatch, then reaches that review verdict once proof is current." | diff-local |
| Story 1 happy: Given current proof or proof successfully preserved under existing rules, when the run reaches review, then review proceeds with zero recovery reruns. | 3 | "With current proof and with successfully preserved proof, Conductor.run() dispatches review and reaches its verdict with exactly zero recovery suite executions." | diff-local |
| Story 1 negative: Given current proof for a sibling and stale proof for the active stacked child, when the daemon prepares review for the active child, then it obtains proof for that child before dispatching its review. | 3 | "With current proof for a sibling and stale proof for the active stacked child, a resumed conductor executes the active child’s suite, obtains current proof for that child, then dispatches that child’s first review and records its verdict." | diff-local |
| Story 2 happy: Given proof that passed the early check and an available attempt, when review discovers the proof has become stale, then the daemon reruns the suite for the same feature or child. Once the new proof is current, review resumes and reaches a verdict. | 4 | "When the early check passes and proof becomes stale at assembly with an attempt available, Conductor.run() automatically executes the suite once for the original feature or child and resumes its review to a verdict after the proof becomes current." | diff-local |
| Story 2 negative: Given a recovery rerun initiated by either check, when the suite reports failing tests, then the run enters its existing test-failure route immediately without dispatching a review on those results or spending another attempt to repeat the failure. | 4 | "For early and late recovery, a nonzero test exit follows the same immediate test_suite-to-BUILD repair route as an ordinary suite failure, with zero review dispatches on those results and zero further recovery attempts spent repeating that failure." | diff-local |
| Story 3 happy: Given an early recovery rerun in one child and a subsequent daemon restart, when another child discovers a late proof problem, then the feature can use its second recovery rerun. If that rerun produces current proof, review proceeds. | 5 | "In Conductor.run(), an early recovery execution on child one followed by restart and a late proof failure on child two permits the second recovery execution for child two; if it yields current proof its review proceeds without an exhaustion halt." | diff-local |
| Story 3 happy: Given ordinary suite executions and repeated inspections of one recovery rerun, when determining the remaining allowance, then only the actual recovery rerun counts, once. | 2 | "Through the native verifier, ordinary suite executions, repeated inspections, and reuse after a peer publishes current proof each spend zero recovery attempts; one recovery execution observed by multiple inspections spends exactly one." | diff-local |
| Story 3 negative: Given two recovery reruns already spent for a feature, when either check determines another rerun is needed, then the daemon halts for operator intervention before starting a third. The halt identifies build_review, test_suite, and two attempts. | 5 | "After two recovery reruns on a feature, either the early check or late assembly asking for fresh proof produces a needs-human halt before any third execution and the halt text identifies unusable test-suite proof, build_review, test_suite, and two attempts." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D1 | existing | none | step-runners.ts catches TestSuiteProofError and sets the typed retryAfterStep facet. |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D2 | existing | none | classifyRetryDecision uses the typed signal on attempt one at the daemon step-runner seam. |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D3 | task | task-3, task-4, task-5 | After two recovery reruns on a feature, either the early check or late assembly asking for fresh proof produces a needs-human halt before any third execution and the halt text identifies unusable test-suite proof, build_review, test_suite, and two attempts. |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D4 | task | task-4 | With retry routing disabled the recovery route is bypassed; unrelated typed failures retain existing routing and advisory steps retain their skip. |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D5 | existing | none | The conductor emits retry_decision with the classifier signal at the runner failure seam. |
| adr-2026-08-19-unretryable-step-runner-failures-route-by-kind#D6 | no-change | none | Only a build_review request naming test_suite enables proof recovery; build progress accounting remains owned by its existing route. |
