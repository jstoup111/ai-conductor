# Implementation plan for protected SHIP validation

**Date:** 2026-11-19
**Stories:** .docs/stories/manual-test-gate-commits-product-code-invalidating.md
**Delivery:** One implementation PR, selected by the operator.

## Technical approach

Use the existing validator dispatch, repair ownership, verdict stores and single-writer join. Protection availability controls how a process launches. Code validity controls which results may be consumed. Bind both decisions to the actual attempt and revision. A capability warning permits validation to proceed. A stale verdict schedules another validation attempt. A product change independently requires BUILD verification.

## Tasks

### Task 1: Protect validator execution at launch
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Add failing focused tests for the observable checks below and confirm RED.
2. Extend the provider execution boundary for the three SHIP members, including serial, parallel and retry launches. Bind the input revision before launch. Probe the effective child process permissions on product files and Git state and verify writable owned evidence and runtime scratch. Exercise manual-test server and browser/API capabilities with controlled fixtures.
3. Verify GREEN with the affected selectors and commit the change.

**Done when:**
- [test] Through serial and grouped dispatch of each SHIP member, a protected validator reads the fixture source, runs its required validation tools and writes its own .pipeline evidence.
- [test] A validator and its spawned child each attempt a product write and Git mutation. Both are refused, and a concurrent sibling observes original bytes and revision throughout.

**Files likely touched:**
- src/conductor/src/engine/provider-execution.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/provider-execution.test.ts

**Dependencies:** none

### Task 2: Warn and launch validators in independent fallback checkouts
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Add failing focused tests for the observable checks below and confirm RED.
2. On unavailable or inconclusive protection, publish the warning through ConductorEventEmitter and its operator display before launching. Prepare a checkout at the dispatch revision with independent Git metadata, provision the necessary project inputs, scratch and evidence destinations, and return validated member evidence to the group owner. Retain source material across interrupted attempts.
3. Verify GREEN with the affected selectors and commit the change.

**Done when:**
- [test] For both an absent capability and an inconclusive probe, captured operator output identifies validator and reason prominently before the launch trace. The gate runs without acknowledgment and produces evidence in that attempt.
- [test] Two concurrent fallback members can run against the same input revision. A commit in one checkout leaves the sibling and feature HEAD unchanged.

**Files likely touched:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/src/engine/provider-execution.ts
- src/conductor/src/daemon-cli.ts

**Dependencies:** Task 1

### Task 3: Capture and transfer product edits to the repair owner
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Add failing focused tests for the observable checks below and confirm RED.
2. Compare fallback checkout state with dispatch baseline across HEAD, index and working tree. Capture changed content, including binary files, additions, modes and deletions. Exclude declared evidence and pass ambiguous files to BUILD for classification. Verify recoverable content before source cleanup. Use durable repair identity and existing routed host ownership to acknowledge delivery. Preserve conflicting destination bytes for BUILD resolution.
3. Verify GREEN with the affected selectors and commit the change.

**Done when:**
- [test] For committed or uncommitted fallback product edits, dispatch settlement preserves the edited content and automatically routes it to BUILD, test_suite and build_review before SHIP can finish.
- [test] With a different owning BUILD worktree and pre-existing operator edits, interrupt before cleanup and after application. Recovery verifies a durable copy before cleanup, delivers the exact delta once to the owner and preserves operator bytes and index state.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/routing/host-region-entry.ts
- src/conductor/test/engine/routing/host-region-entry.realgit.test.ts

**Dependencies:** Task 2

### Task 4: Route current defect findings and preserve evidence-only build proof
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Add failing focused tests for the observable checks below and confirm RED.
2. Integrate the captured product delta and current validator outcomes with existing manual-test kickback and remediation routing. Let the owning BUILD task reconcile actual unverified code, then require current aggregate and review evidence. Distinguish explicit gate evidence from product changes before residue cleanup.
3. Verify GREEN with the affected selectors and commit the change.

**Done when:**
- [test] A current product defect reported by a SHIP validator follows its normal repair path and the run records BUILD, test_suite and build_review on the repaired code before shipping.
- [test] When the only writes are harness-owned evidence, settlement retains that evidence and the previous build proof without scheduling another BUILD.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/validation-group-handshake-retry.test.ts

**Dependencies:** Task 3

### Task 5: Rerun stale validators before consuming findings
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Add failing focused tests for the observable checks below and confirm RED.
2. Check run identity, schema and the actual dispatch input before consuming a member verdict or FAIL rows. Compare the reviewed revision against current code using the existing gate-specific validity decision. Preserve unaffected members and redispatch invalidated members through the same launch path following required build verification. Recheck at join on retry. Retain existing errors for corrupt evidence and enforce existing retry limits.
3. Verify GREEN with the affected selectors and commit the change.

**Done when:**
- [test] For a parallel round with an independent code change affecting one audit, the engine automatically reruns that validator against current code after required build verification, retains the valid sibling verdict and reaches a verdict without operator intervention for staleness.
- [test] Obsolete passing evidence cannot advance SHIP and obsolete defect evidence, including a stale manual-test FAIL row, cannot route a repair on the new revision.
- [test] Malformed evidence or a wrong run identity without established code drift takes the existing evidence failure path.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/gate-code-validity.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/validation-group-handshake-retry.test.ts

**Dependencies:** Task 4

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a host with verified protection, when any of the three SHIP validators runs alone or in a group, then it can inspect product code, exercise its required tools and write its own evidence under .pipeline/. | 1 | "Through serial and grouped dispatch of each SHIP member, a protected validator reads the fixture source, runs its required validation tools and writes its own .pipeline evidence." | diff-local |
| Story 1 happy: Given a protected validator or its child attempts a product edit or Git mutation, when that operation is attempted, then it is refused before a sibling can see a change. | 1 | "A validator and its spawned child each attempt a product write and Git mutation. Both are refused, and a concurrent sibling observes original bytes and revision throughout." | diff-local |
| Story 1 negative: Given missing protection or an inconclusive protection check, when the engine dispatches the validator, then the operator sees a prominent warning naming the validator and reason before execution, and execution continues without acknowledgment. | 2 | "For both an absent capability and an inconclusive probe, captured operator output identifies validator and reason prominently before the launch trace. The gate runs without acknowledgment and produces evidence in that attempt." | diff-local |
| Story 2 happy: Given a validator reports a current product defect, when the engine routes the finding, then the normal repair path takes the fix through BUILD, test_suite and build_review before shipping. | 4 | "A current product defect reported by a SHIP validator follows its normal repair path and the run records BUILD, test_suite and build_review on the repaired code before shipping." | diff-local |
| Story 2 negative: Given unprotected validation runs after the last build review, when a product edit remains uncommitted or a product change has been committed, then the engine preserves the change and routes unverified code through those gates automatically. | 3 | "For committed or uncommitted fallback product edits, dispatch settlement preserves the edited content and automatically routes it to BUILD, test_suite and build_review before SHIP can finish." | diff-local |
| Story 2 negative: Given the repair belongs to another BUILD worktree, when the engine hands over fallback edits, then it verifies a recoverable copy before cleanup, keeps pre-existing operator edits separate, and resumes an interrupted delivery without applying it twice. | 3 | "With a different owning BUILD worktree and pre-existing operator edits, interrupt before cleanup and after application. Recovery verifies a durable copy before cleanup, delivers the exact delta once to the owner and preserves operator bytes and index state." | diff-local |
| Story 2 negative: Given only harness-owned evidence changed, when validation finishes, then evidence writes alone do not trigger a product rebuild. | 4 | "When the only writes are harness-owned evidence, settlement retains that evidence and the previous build proof without scheduling another BUILD." | diff-local |
| Story 3 happy: Given sibling verdicts in a parallel round, when code changes invalidate only some verdicts, then the engine automatically reruns affected validators against current code after any required build verification and preserves valid sibling evidence. | 5 | "For a parallel round with an independent code change affecting one audit, the engine automatically reruns that validator against current code after required build verification, retains the valid sibling verdict and reaches a verdict without operator intervention for staleness." | diff-local |
| Story 3 negative: Given an obsolete passing verdict or defect finding, when the join evaluates it, then it cannot advance SHIP or route a repair based on that obsolete result. | 5 | "Obsolete passing evidence cannot advance SHIP and obsolete defect evidence, including a stale manual-test FAIL row, cannot route a repair on the new revision." | diff-local |
| Story 3 negative: Given malformed evidence or evidence from the wrong run without established code drift, when the join checks it, then the existing evidence failure handling applies. | 5 | "Malformed evidence or a wrong run identity without established code drift takes the existing evidence failure path." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-19-ship-validator-protection-fallback#D1 | task | task-1, task-2, task-4, task-5 | The gate runs without acknowledgment and produces evidence in that attempt. |
| adr-2026-11-19-ship-validator-protection-fallback#D2 | task | task-2, task-3 | Recovery verifies a durable copy before cleanup, delivers the exact delta once to the owner and preserves operator bytes and index state. |
