# Implementation Plan: Stacked rounds reach whole-feature validation

**Date:** 2026-11-19
**Source-Ref:** jstoup111/ai-conductor#3682
**Stories:** .docs/stories/stacked-rounds-halt-before-final-gates-on-feature-.md
**Design:** [approved architecture review](../decisions/architecture-review-2026-11-19-stacked-rounds-halt-before-final-gates-on-feature-.md)
**Conflict check:** [clean report](../conflicts/stacked-rounds-halt-before-final-gates-on-feature-.md), operator approved

## Summary

Seven scoped implementation tasks restore authoritative child validation at live routed return and restart. Delivery is one implementation PR; there is no slice manifest.

## Technical Approach

Refresh feature-owned state at a settled return, then resolve and adopt the authoritative leaf region through the existing child overlay and routed mutation port. Apply the same preparation before resumed entry derivation. Existing selector verdict precedence, tree-attesting completion checks and state-only prerequisites keep their semantics; correct their context rather than inventing a new completion authority. A genuinely pending suite/review runs at its child owner within the same run. Outstanding routing still takes precedence and invalid evidence still blocks.

The focused source precedent is `activateChildRegionState` plus `readConductStateOverlay` and `createRoutedConductStateStore`: missing child region fields mask old flat fields, feature fields remain root-owned, and cursor writes align their compare-and-swap expectation with the target store. Preserve these traits; private factoring within the conductor is allowed. The existing `restoreWholeFeatureState` refresh remains necessary. Do not retain the old host or blindly set root suite completion.

The test precedent is `conductor-routed-leaf-return.realgit.test.ts`: local Git records establish route/cursor semantics, an injected StepRunner records dispatch, and an explicit park/sentinel bounds execution before unrelated FINISH. Its existing all-done root fixture hides this defect; new cases omit root region keys and seed the authoritative leaf. Some old assertions pin root store object identity and undefined activeRegionChild. Replace those incidental details with scope and persistence assertions without relaxing actual ownership guarantees. No third-party service is real in these tests.

## Prerequisites and boundaries

- Accepted Stories 1–4 and the approved architecture review are the requirements. Existing per-child region and routed-repair ADRs retain authority; no new ADR is introduced.
- Existing routing preflight, cursor, overlay and gate APIs are used; no new configuration, persistence schema, module, dependency, or external call is planned.
- No generic BUILD task-counter bypass is added. Completed BUILD means authoritative completion is satisfied. Fold and abandon modes keep their existing preservation decisions; run only actually pending whole-feature work.
- Use `ai-conductor scoped-run` with the affected test selector for each scoped RED/GREEN cycle. `test_suite` owns aggregate checks, including this repository's integrity suite. No implementation occurs during composer.
- All tasks touch the same conductor/test seam, so BUILD must serialize overlapping file edits. Dependencies below express required behavior foundations rather than arbitrary ordering.
- Each task owns a distinct integration scenario listed below. The first dispatch, terminal refusal, or named group join ends its fixture; supply needed verdict/artifact evidence and await cleanup. Test names below describe required cases and may be adapted without changing assertions.

## Tasks

### Task 1: Restore leaf evidence at the live handoff and preserve write ownership
**Story:** 1
**Story:** 4
**Type:** happy-path
**Dependencies:** none
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts

**Steps:**
1. Extend the existing routed-leaf-return fixture with absent root region keys, distinct host and leaf child evidence, and different host/leaf/feature cursors. Drive the live host exit through Conductor.run with an injected runner; stop after the first intended validation group joins. Establish RED for the missing-root-suite handoff. After the existing routed continuation settles, refresh feature-owned state and adopt the resolved leaf through the existing overlay/routed-store APIs before whole-feature entry; retain the refreshed compare-and-swap baseline. Preserve whole-feature verdict routing. Replace private assertions that require rootStateStore identity or undefined activeRegionChild with assertions about observable scope and actual write ownership; these private implementation choices are not the acceptance contract. Do not erase assertions about pending root whole-feature verdicts or unrelated state preservation. Use the existing local-Git fixture and bounded park/sentinel termination; do not launch a provider or continue to FINISH.
2. Establish scoped RED for changed behavior, implement only this task's transition, then run scoped GREEN and commit the code and its behavioral evidence together. For retained negative contracts, preserve existing sufficient proof rather than inventing a production edit just to make a test fail.

**Done when:**
- [test] The live Conductor.run handoff with settled routing, valid required child evidence and absent root region fields uses the resolved leaf overlay and dispatches the first pending whole-feature gate in the same run, with no pending-test_suite prerequisite HALT and no repeated completed BUILD dispatch.
- [test] With the last host different from the leaf, the live handoff dispatches whole-feature validation against the leaf branch and the whole implementation, not the former host scope.
- [test] After that whole-feature result and resume position are persisted through the routed state port, root holds the feature-owned result and cursor, child validation records retain child ownership, and no synthetic child-region completion fields appear in root.
- [test] Distinct former-host, leaf and feature cursors cross the handoff without overwriting the former host region cursor and without a concurrent-state conflict caused solely by the ownership change.

### Task 2: Use the same authoritative context during restarted entry
**Story:** 2
**Story:** 4
**Type:** happy-path
**Dependencies:** Task 1
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts

**Steps:**
1. Add resume fixtures for already-settled leaf return and interruption after durable return but before validation. Remove root-region success seeding and preserve actual child-owned state and verdicts. Establish RED against the settled-return resume path that skips child activation. Reuse Task 1 transition preparation after stack preflight and before state-derived indexing, verdict reads, tree-attesting completion checks, and the existing prerequisite clamp. Preserve the backward-only clamp and explicit fromStep behavior. The no-child path must continue through existing flat logic. Reuse bounded runner/park termination and inspect the first dispatch, not just a private derived index.
2. Establish scoped RED for changed behavior, implement only this task's transition, then run scoped GREEN and commit the code and its behavioral evidence together. For retained negative contracts, preserve existing sufficient proof rather than inventing a production edit just to make a test fail.

**Done when:**
- [test] With settled routing, satisfied required leaf validation, absent root region fields and pending whole-feature validation, Conductor.run(resume:true) prepares the leaf overlay before entry selection and first dispatches that pending whole-feature validation, with no completed BUILD dispatch and no false pending-suite HALT.
- [test] A restart after durable leaf return but before whole-feature validation completes real preflight recovery and selects the same next validation as the equivalent uninterrupted run, with no operator edits to engine state.
- [test] For a flat feature with no durable children, Conductor.run ordinary gate checks and resume selection retain the existing dispatch and persistence results and do not require stacked evidence.

### Task 3: Select the required leaf suite or review before whole-feature gates
**Story:** 1
**Story:** 3
**Type:** happy-path
**Dependencies:** Task 1, Task 2
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts

**Steps:**
1. Add parameterized live/resume cases for leaf suite pending and leaf review pending, including a passing former host that is not the leaf. Establish RED for dispatch selection at the handoff. Before entering whole-feature validation, use the existing child verdict/status satisfaction and completion rules to select the earliest unmet leaf region gate; enter through the normal child region path with its owner. A pending suite runs as the child suite, not a root suite. A valid suite with review pending goes to review. Do not create a synthetic root completion, new satisfaction predicate, or intermediate HALT solely to force redispatch. Keep exact test scopes bounded to the named first dispatch and its ordering.
2. Establish scoped RED for changed behavior, implement only this task's transition, then run scoped GREEN and commit the code and its behavioral evidence together. For retained negative contracts, preserve existing sufficient proof rather than inventing a production edit just to make a test fail.

**Done when:**
- [test] In live and resumed Conductor.run cases with settled routing, complete leaf BUILD and a required leaf suite, selection dispatches the leaf test_suite before any whole-feature validator, with no completed BUILD rerun and no HALT solely to redispatch that runnable suite.
- [test] In live and resumed cases with valid leaf suite and only build_review unmet, existing gate selection dispatches leaf build_review before whole-feature validation, without repeating that valid suite or completed BUILD solely because root region fields are absent.
- [test] A passing previous host with incomplete leaf validation cannot admit a whole-feature gate at host exit: the transition selects and runs the missing leaf validation first.

### Task 4: Keep active routed work ahead of the leaf transition
**Story:** 1
**Story:** 2
**Type:** negative-path
**Dependencies:** Task 1, Task 2
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts

**Steps:**
1. Cover a live handoff with an outstanding repair host or queued validation and a resume with an older closed leaf-return record plus a newer unfinished round. Use the existing real routing records and cursor authority; do not replace the internal outstanding-work predicate with a mock return. Preserve or adjust the transition ordering so guardOutstandingRoutedWork and preflight reconciliation retain precedence before leaf context adoption. Historical return detection must not itself override the current routed owner. Run bounded dispatch tests; no new route lock or halt policy is introduced.
2. Establish scoped RED for changed behavior, implement only this task's transition, then run scoped GREEN and commit the code and its behavioral evidence together. For retained negative contracts, preserve existing sufficient proof rather than inventing a production edit just to make a test fail.

**Done when:**
- [test] At live handoff with an outstanding repair host or revalidation entry, Conductor.run starts no whole-feature gate before that work settles, even when root statuses claim success; the existing routing fence retains precedence.
- [test] On resume with an older recorded leaf return and a newer unfinished round, preflight and entry selection retain the newer work as owner and do not admit whole-feature validation because of the older return.

### Task 5: Refuse unresolved leaf identity or unreadable child evidence
**Story:** 2
**Type:** negative-path
**Dependencies:** Task 1, Task 2
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts

**Steps:**
1. Add bounded resume cases with a typed unresolved cursor and an actually unreadable child-state fixture. Inject only the external Git/filesystem failure boundary as needed; do not hand-construct a successful overlay. Ensure context preparation preserves the existing actionable refusal path and cause rather than flattening the feature or letting missing root keys select BUILD. Assert both no validator dispatch and a named diagnostic. Keep existing halt classification and mutation behavior.
2. Establish scoped RED for changed behavior, implement only this task's transition, then run scoped GREEN and commit the code and its behavioral evidence together. For retained negative contracts, preserve existing sufficient proof rather than inventing a production edit just to make a test fail.

**Done when:**
- [test] For unresolved child identity and unreadable required child state, Conductor.run resume context preparation starts no whole-feature validator and reports the corresponding unresolved child/state problem instead of treating missing root fields as runnable BUILD work.
- [test] The unresolved/unreadable context cases dispatch no BUILD as a fallback and preserve existing child completion records without manufacturing a successful root or child verdict.

### Task 6: Reject stale or missing child completion despite old root success
**Story:** 3
**Story:** 4
**Type:** negative-path
**Dependencies:** Task 3
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts

**Steps:**
1. Add live/resume permutations with old root success plus stale child state, negative child verdict, and absent child completion. Read these through the production overlay and verdict path. Preserve gateSatisfied stale/negative precedence and existing routed-round masking; modify only the new entry integration if it would bypass those rules. No copying old root values into child state is permitted. For genuine invalidation use the existing owning-gate recovery; do not introduce a special recovery loop.
2. Establish scoped RED for changed behavior, implement only this task's transition, then run scoped GREEN and commit the code and its behavioral evidence together. For retained negative contracts, preserve existing sufficient proof rather than inventing a production edit just to make a test fail.

**Done when:**
- [test] With old root success or an old passing verdict but authoritative child validation stale or negative, Conductor.run entry uses existing overlay and gateSatisfied rules, starts no whole-feature validation from that old success, and follows the existing invalidation/recovery path.
- [test] With missing child completion and old successful root region fields, stacked entry does not substitute root success or manufacture a passing child verdict, and no whole-feature validator starts on that basis.

### Task 7: Keep a newly dispatched validation failure blocking
**Story:** 3
**Type:** negative-path
**Dependencies:** Task 3
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts
**Files likely touched:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/routing/conductor-routed-leaf-return.realgit.test.ts

**Steps:**
1. Drive the required suite/review selected by Task 3 into a deterministic failure through the injected runner or existing verifier adapter. Keep real failure handling up to its normal kickback/refusal boundary; terminate there using the existing bounded fixture mechanism. Ensure the handoff does not fall through to whole-feature validation after the failure or stamp completion. Preserve the existing failure owner and cap semantics; this task owns only failure of the newly reachable validation path, not an aggregate final check.
2. Establish scoped RED for changed behavior, implement only this task's transition, then run scoped GREEN and commit the code and its behavioral evidence together. For retained negative contracts, preserve existing sufficient proof rather than inventing a production edit just to make a test fail.

**Done when:**
- [test] When required validation selected by the corrected Conductor.run handoff is dispatched and fails, the existing owning-gate failure path handles it and no whole-feature validator starts while that failure remains unsatisfied.
- [test] The failed required validation remains unsatisfied in its authoritative child evidence; the transition does not mark the failed gate complete in either child or root state.

## Coverage Check

Each row is diff-local: it specifies the behavior of this change against bounded authoritative fixtures, not the live state of another feature or service. Supporting negative assertions in the same task also apply.

| Criterion | Task id(s) | Done when quote | Disposition |
|---|---|---|---|
| Story 1 happy: Given a routed round settles on the leaf, all required child validation is satisfied, and feature-level BUILD-region statuses are absent, when the live run continues, then the first pending whole-feature gate starts in that same run without a pending-`test_suite` prerequisite HALT or repeated completed BUILD. | 1 | [test] The live Conductor.run handoff with settled routing, valid required child evidence and absent root region fields uses the resolved leaf overlay and dispatches the first pending whole-feature gate in the same run, with no pending-test_suite prerequisite HALT and no repeated completed BUILD dispatch. | diff-local |
| Story 1 happy: Given the last routed host is different from the leaf and its exit leaves routing settled with valid leaf validation, when whole-feature validation starts, then it judges the leaf's whole implementation rather than the former host's scope. | 1 | [test] With the last host different from the leaf, the live handoff dispatches whole-feature validation against the leaf branch and the whole implementation, not the former host scope. | diff-local |
| Story 1 negative: Given the previous host passed but the leaf still requires validation, when that host exits, then no whole-feature gate starts on the strength of the host's pass and the missing leaf validation runs first. | 3 | [test] A passing previous host with incomplete leaf validation cannot admit a whole-feature gate at host exit: the transition selects and runs the missing leaf validation first. | diff-local |
| Story 1 negative: Given a repair host or revalidation entry remains outstanding, when the run reaches the handoff, then no whole-feature gate starts before that work settles, even if root statuses claim success. | 4 | [test] At live handoff with an outstanding repair host or revalidation entry, Conductor.run starts no whole-feature gate before that work settles, even when root statuses claim success; the existing routing fence retains precedence. | diff-local |
| Story 2 happy: Given routing is settled, required leaf validation is satisfied, root region statuses are absent, and whole-feature validation remains pending, when the process restarts, then its first dispatched work is the pending whole-feature validation with no completed BUILD dispatch and no false pending-suite HALT. | 2 | [test] With settled routing, satisfied required leaf validation, absent root region fields and pending whole-feature validation, Conductor.run(resume:true) prepares the leaf overlay before entry selection and first dispatches that pending whole-feature validation, with no completed BUILD dispatch and no false pending-suite HALT. | diff-local |
| Story 2 happy: Given a process stops after durable leaf return but before whole-feature validation begins, when preflight completes recovery, then the resumed run reaches the same next validation as an uninterrupted run from the equivalent state without operator edits to engine state. | 2 | [test] A restart after durable leaf return but before whole-feature validation completes real preflight recovery and selects the same next validation as the equivalent uninterrupted run, with no operator edits to engine state. | diff-local |
| Story 2 negative: Given an earlier round has a recorded leaf return but a newer round still has unfinished work, when the feature resumes, then the newer work retains precedence and the older return does not admit whole-feature validation. | 4 | [test] On resume with an older recorded leaf return and a newer unfinished round, preflight and entry selection retain the newer work as owner and do not admit whole-feature validation because of the older return. | diff-local |
| Story 2 negative: Given the child identity or required child state cannot be resolved or read, when restart evaluates entry, then no whole-feature validator starts and the run reports the unresolved child/state problem rather than treating missing root fields as runnable BUILD work. | 5 | [test] For unresolved child identity and unreadable required child state, Conductor.run resume context preparation starts no whole-feature validator and reports the corresponding unresolved child/state problem instead of treating missing root fields as runnable BUILD work. | diff-local |
| Story 3 happy: Given routing is settled, leaf BUILD is complete, and the leaf suite still needs to run, when the live or resumed run selects its next work, then it runs the leaf suite before whole-feature validation without first rerunning completed BUILD or halting solely to redispatch that runnable suite. | 3 | [test] In live and resumed Conductor.run cases with settled routing, complete leaf BUILD and a required leaf suite, selection dispatches the leaf test_suite before any whole-feature validator, with no completed BUILD rerun and no HALT solely to redispatch that runnable suite. | diff-local |
| Story 3 happy: Given the leaf suite is valid and build review is the remaining unmet region gate, when selection runs, then build review runs before whole-feature validation; the valid suite and completed BUILD are not repeated solely because root region fields are absent. | 3 | [test] In live and resumed cases with valid leaf suite and only build_review unmet, existing gate selection dispatches leaf build_review before whole-feature validation, without repeating that valid suite or completed BUILD solely because root region fields are absent. | diff-local |
| Story 3 negative: Given root state or an old verdict claims success but authoritative child validation is stale or has a negative verdict, when entry is evaluated, then the old success does not admit whole-feature validation and the existing invalidation/recovery rules apply. | 6 | [test] With old root success or an old passing verdict but authoritative child validation stale or negative, Conductor.run entry uses existing overlay and gateSatisfied rules, starts no whole-feature validation from that old success, and follows the existing invalidation/recovery path. | diff-local |
| Story 3 negative: Given required validation is dispatched and fails, when that failure is processed, then whole-feature validation remains blocked and the existing failure path handles it; the transition correction does not mark the failed gate complete. | 7 | [test] When required validation selected by the corrected Conductor.run handoff is dispatched and fails, the existing owning-gate failure path handles it and no whole-feature validator starts while that failure remains unsatisfied. | diff-local |
| Story 4 happy: Given a stacked feature enters whole-feature validation using valid child completion, when the whole-feature result and resume position are recorded, then they remain feature-owned while the child validation records retain their ownership; root region fields are not populated with synthetic child completion. | 1 | [test] After that whole-feature result and resume position are persisted through the routed state port, root holds the feature-owned result and cursor, child validation records retain child ownership, and no synthetic child-region completion fields appear in root. | diff-local |
| Story 4 happy: Given a flat feature with no durable children, when ordinary gate checks and restart selection run, then they keep their existing dispatch and persistence behavior without requiring stacked evidence. | 2 | [test] For a flat feature with no durable children, Conductor.run ordinary gate checks and resume selection retain the existing dispatch and persistence results and do not require stacked evidence. | diff-local |
| Story 4 negative: Given the previous host has a different resume position from the leaf and feature, when the leaf transition records the next whole-feature step, then it neither overwrites the former host's region cursor nor reports a false concurrent-state conflict solely because the cursor owner changed. | 1 | [test] Distinct former-host, leaf and feature cursors cross the handoff without overwriting the former host region cursor and without a concurrent-state conflict caused solely by the ownership change. | diff-local |
| Story 4 negative: Given child completion is missing while root region fields contain old success, when stacked entry evaluates completion, then it does not substitute root success or manufacture a passing child verdict. | 6 | [test] With missing child completion and old successful root region fields, stacked entry does not substitute root success or manufacture a passing child verdict, and no whole-feature validator starts on that basis. | diff-local |

## Integration ownership

Task 1 owns live successful handoff, scope and write ownership. Task 2 owns restarted successful handoff and flat compatibility. Task 3 owns runnable leaf suite/review selection. Tasks 4–7 respectively own outstanding-routing precedence, unreadable context, stale/missing completion, and dispatched-validation failure at those entry paths. No terminal catch-all validation task is added.

## Verify-Claims

Verified against the source named above: root-only restoration loses child region fields; the manual-test prerequisite and resume clamp read state; the selector reads verdicts; the routed store separates region and whole-feature writes. The design uses those existing seams. No unconfirmed load-bearing assumption, outside-diff waiver, or new architectural obligation is asserted. Independent coverage judgement passed all sixteen claims (16 asserts, 0 refusals) in a fresh context using only exact criteria and cited Done-when checks. Medium plan review separately judges contradictions and task interactions.

## Validation responsibilities

Each implementation task supplies its scoped behavioral RED/GREEN evidence. The managed aggregate and SHIP gates remain responsible for completed-feature validation. This specification changes no executable code; no implementation test result is claimed here.
