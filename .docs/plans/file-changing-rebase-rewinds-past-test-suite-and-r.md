# Implementation Plan: Selective verification after a completed rebase

**Date:** 2026-09-11
**Source-Ref:** jstoup111/ai-conductor#2253
**Stories:** .docs/stories/file-changing-rebase-rewinds-past-test-suite-and-r.md
**Design:** adr-2026-09-11-selective-post-rebase-verification
**Conflict check:** PASS, 2026-09-11; operator accepted the reconciled report.

## Summary

Deliver the approved whole post-rebase flow in 19 bounded behavior-owning tasks: prove replay, select and persist explicit gate effects, and consume them consistently through finish and resume. No task builds a second entry policy or recovery owner.

## Technical Approach

Extend the delivered rebase classifier with immutable P/B/O/H and exact clean expected-tree evidence. Preserve only an applicable original PASS with unchanged relevant review inputs. The combined tree remains the input to native suite/runtime verification. Unknown reconstruction conservatively revalidates reviews; unavailable completed-BUILD evidence blocks for recovery; actual test failure retains ordinary repair.

One shared application service updates named fields through ConductStateStore.applyBatch. Keep a bounded applying/applied operation descriptor in the existing rebase gate evidence and preservation metadata in existing gate records. Bind the original artifact and attempt, keep original judge identities, and require applied consistency at readers. Interrupted writes reconcile by expected identity, never by reviving an old PASS. These records are durable gate evidence (event-spine exception C); occurrences remain on the existing event spine.

Reuse the existing GitRunner adapter, completion context, state mutation port, native suite runner, coverage runner/cache/envelope, and event emitter/persister. The relevant local fixture pattern is a real Conductor over a temporary Git repository with faithful fake provider/process/PR boundaries, as in rebase-tail-preserve and rebase-loop. Reuse its traits, not stale comments or exact copies. New helper-only tests stay at the unit layer; application boundary owners are named below.

## Prerequisites

- Dispatch this implementation only after #2211 / PR #2453 and #415 / PR #2495 are delivered on the implementation base. They own active-input projection and pre-rebase collision recovery respectively. Existing issue dependency machinery must enforce this before spec handoff; a prose warning alone is insufficient.
- Read their landed versions before Task 1; reuse their exported seams. If a prerequisite changes the approved behavior or removes the named integration seam, return to DECIDE rather than copying an inflight branch or inventing a replacement policy.
- Preserve #1207/#2515 normal-finish policy, mandatory re-kick play-forward, base-code/test safeguards, protected-artifact validation, evidence translation, suite reuse/drift policy, and ordinary repair budgets. #2462 and #2488 remain separate work.
- No consumer configuration, CLI, or hook schema change is required. No production directory deletion is planned.

## Task execution and coverage disposition

Each task is one scoped RED/GREEN change: add its named failing behavioral fixture, run its selectors through ai-conductor scoped-run, implement only the stated behavior, rerun those selectors, and commit. The concrete assertions and layer are specified in each task. An existing assertion already sufficient for a preserved case is retained and cited rather than duplicated. No ordinary documentation or terminal aggregate-validation task is assigned.

Every mapped criterion is diff-local: it states behavior of this implementation under controlled inputs, including failure and changed-upstream fixtures. No criterion asserts a live third-party outcome or that an independently owned PR has merged. Prerequisite delivery is a dispatch precondition, not a test assertion. BUILD-entry acceptance disposition should cite these lower-layer/production-flow proofs where sufficient; do not duplicate every negative permutation into system specs.

## Tasks

### Task 1: Capture immutable replay identities at the existing driver seam
**Story:** 1 happy 1; 2 happy 1; 7 negative 1
**Type:** infrastructure

**Steps:**
1. Use the existing injected GitRunner and resolver outcome pattern; extend successful rebase evidence with validated object ids P (pre-rebase HEAD), B (merge-base), O (resolved target), and H (completed HEAD). Capture P/B/O before replay, retain them in the existing rebase evidence across resolver continuation, and never replace them with a later ORIG_HEAD. This is an additive outcome field, not a second rebase driver.
2. Scoped lower-layer fixtures drive performRebase and resolveRebaseConflicts with scripted Git results. Preserve the existing translation, seal, and intent guards; attach completed identities only after those guards succeed. Task 11 owns clean-flow dispatch proof; Task 17 owns re-kick wiring.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement capture immutable replay identities at the existing driver seam`.

**Done when:**
- performRebase and resolveRebaseConflicts return the same captured P/B/O and the final H in a resolver-continuation fixture even when ORIG_HEAD changes.
- The rebase driver produces no completed replay authority for unresolved conflicts or failed seal/intent checks.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/rebase.test.ts`, `src/conductor/test/engine/rebase-resolution.test.ts`

**Dependencies:** none

### Task 2: Compare the expected replay tree with the completed result
**Story:** 1 happy 1; 2 happy 1
**Type:** happy-path

**Steps:**
1. Add a focused replay-comparison module behind GitRunner. Compute git merge-tree --write-tree --merge-base B P O; accept only a successful clean result with one valid tree id equal to H^{tree}. Return unchanged, changed, or unproved with bounded reason data. Do not use patch-id, path overlap, or an LLM equivalence judgement.
2. Use a fixture-owned temporary Git repository: feature changes one line and target changes a disjoint line in the same file. Compare a clean replay and a completed result with an extra edit. Keep all Git commands inside that fixture; no remote service. This is a lower-layer proof of the algorithm; Task 11 owns application reachability.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement compare the expected replay tree with the completed result`.

**Done when:**
- The replay comparator returns unchanged for clean same-file disjoint replay and changed when H contains an additional resolution edit.
- The successful comparison binds its exact expected tree and P/B/O/H objects without altering the working tree or original review identity.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/rebase-replay.ts`, `src/conductor/test/engine/rebase-replay.test.ts`

**Dependencies:** Task 1

### Task 3: Reject unavailable or conflicting replay reconstruction
**Story:** 2 happy 2; 2 negative 1
**Type:** negative-path

**Steps:**
1. Extend the comparator with explicit unproved results for missing P/B/O/H, missing objects, unsupported merge-tree options, nonzero command exit, malformed output, and a conflicting merge reconstruction. Reuse GitRunner result injection rather than requiring different host Git versions.
2. Keep unproved separate from changed and unchanged. The classifier receives a reason, never a fabricated tree. These lower-layer fixtures retain all failure permutations; Task 11 supplies one unavailable-comparison production flow.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement reject unavailable or conflicting replay reconstruction`.

**Done when:**
- The replay comparator returns unproved with no preservation claim for every missing-object, unsupported-option, command-error, malformed-output, and conflicting-reconstruction fixture.
- A comparison failure leaves completion evidence untouched and supplies the conservative-classification branch rather than a BUILD dispatch request.

**Files:** `src/conductor/src/engine/rebase-replay.ts`, `src/conductor/test/engine/rebase-replay.test.ts`

**Dependencies:** Task 2

### Task 4: Refine the prerequisite classifier with replay proof
**Story:** 1 negative 1; 2 happy 1; 2 happy 2; 7 happy 2
**Type:** happy-path

**Steps:**
1. Extend the landed #2453 projectGateSurfaces/classification seam; reuse its active document resolver without copying it. Feed full combined-tree delta to suite/manual runtime policy and only a verified unchanged feature contribution to feature-scoped review preservation. Active input changes retain their owning gate effects.
2. Return one explicit per-gate candidate decision and source data for applied events. Lower-layer matrix cases distinguish unchanged replay, changed replay, unproved replay, active documents, unrelated documents, and skipped gates. Task 11 owns normal-flow integration and Task 18 owns entry-policy compatibility.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement refine the prerequisite classifier with replay proof`.

**Done when:**
- The shared classifier preserves eligible feature reviews for unchanged replay, reopens affected reviews for changed or unproved replay, and still invalidates reviews with changed active inputs.
- The classifier retains full suite/runtime inputs and the prerequisite document-only matrix, including no BUILD or aggregate invalidation solely for document changes.

**Files:** `src/conductor/src/engine/gate-invalidation.ts`, `src/conductor/test/engine/rebase-path-classification.test.ts`

**Dependencies:** Task 2, Task 3

### Task 5: Require an applicable original PASS before preservation
**Story:** 1 negative 2; 5 negative 1
**Type:** negative-path

**Steps:**
1. Before granting candidate preservation, validate the original passing artifact and its stamp against P using existing gate completion/validity rules. Include original artifact identity and active input identities in the decision. Do not treat state=done, skip verdict, or artifact presence as a judged PASS.
2. Lower-layer verdict fixtures cover an older invalid stamp, absent evidence, a pending failure, ordinary kickback, and a later successful verdict. Preserve later work by comparing the captured original identity before applying. Task 10 covers interrupted application; Task 8 covers consumers.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement require an applicable original pass before preservation`.

**Done when:**
- applyRebaseVerdicts grants preservation only to a previously applicable original PASS and never converts failing, pending-repair, missing-evidence, or skipped cases into a judged PASS.
- A superseding verdict or ordinary repair obligation defeats an older replay-preservation candidate without replacing the newer authority.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/gate-code-validity.ts`, `src/conductor/test/engine/rebase-verdicts.test.ts`

**Dependencies:** Task 4

### Task 6: Persist bounded replay authority in existing gate evidence
**Story:** 5 happy 1; 5 happy 2; 6 happy 1
**Type:** infrastructure

**Steps:**
1. Add optional typed post-rebase metadata to the existing .pipeline/gates/<gate>.json contract. Bind gate, original artifact digest and judge attempt/run identity, original code stamp, P/B/O/H, expected tree, relevant input identities, and operation id. Preserve original judge artifacts and identities; do not restamp them as a new attempt.
2. Store the transition descriptor and applying/applied status in the existing rebase gate record. Atomically replace individual gate records; this is not an atomic transaction across files. Readers must require the matching applied operation. A genuine new verdict drops prior preservation metadata unless explicitly revalidated. Unit round trips exercise optional legacy fields and identity retention.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement persist bounded replay authority in existing gate evidence`.

**Done when:**
- Gate evidence round trips the bound preservation and rebase-operation records while retaining the original passing artifact and judge attempt identity.
- A new ordinary verdict does not inherit obsolete preservation metadata, and legacy records without the optional metadata keep existing semantics.

**Files:** `src/conductor/src/engine/gate-verdicts.ts`, `src/conductor/src/engine/rebase.ts`, `src/conductor/test/engine/gate-verdicts.test.ts`

**Dependencies:** Task 5

### Task 7: Validate replay-bound authority at the shared validity helper
**Story:** 5 negative 1; 5 negative 2
**Type:** negative-path

**Steps:**
1. Extend gateVerdictStillValid through a focused shared preservation validator. Require matching gate/artifact/attempt, applied operation, available replay objects, matching expected/actual replay tree, unchanged relevant inputs since H, and no superseding failure. Preserve existing legacy/opt-out behavior and the existing path-only fallback when no valid new authority exists.
2. Use lower-layer fixtures for absent/malformed fields, wrong gate/verdict, unavailable objects, applying operation, post-H relevant code/input changes, and outstanding repair. A valid record is a bounded explanation for this replay, never permanent approval of future changes.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement validate replay-bound authority at the shared validity helper`.

**Done when:**
- gateVerdictStillValid accepts a fully bound applied replay with unchanged relevant inputs, including same-file upstream edits that the old path-only rule would reject.
- The validity helper grants no replay authority for absent, malformed, wrong-gate, wrong-verdict, missing-object, unapplied-operation, changed-input, or outstanding-repair fixtures.

**Files:** `src/conductor/src/engine/gate-code-validity.ts`, `src/conductor/test/engine/gate-code-validity.test.ts`

**Dependencies:** Task 6

### Task 8: Wire preservation into completion, sweep, and finish consumers
**Story:** 5 happy 1; 5 happy 2; 5 negative 1; 5 negative 2
**Type:** happy-path

**Steps:**
1. Route in-scope completion and sweep checks through the shared validity helper without bypassing original artifact validation or current attempt floors for gates actually rerun. Search existing stepVerdictCodeValid, sweepStaleReviewArtifacts, gateVerdictStillValid, and finish fence callers; use their completion context construction rather than a second policy.
2. Own consumer integration: seed real bound gate evidence, restart the conductor, invoke production completion/sweep and the finish path with a faithful fake PR boundary, and assert retained evidence/no judge dispatch. Pair with changed-input and outstanding-failure cases plus representative invalid binding; Task 7 owns the detailed malformed permutations.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement wire preservation into completion, sweep, and finish consumers`.

> **Amended 2026-09-11 by #2253:** Coherence review makes the already-approved publication/transition boundary explicit in the additional completion check below; scope and routing are unchanged.

**Done when:**
- Production completion, stale-artifact sweep, restarted conductor, and finish consumers retain a valid preserved review with zero extra judge dispatches and unchanged original identity.
- Those consumers reject stale-input, outstanding-failure, and wrong-verdict preservation without allowing publication; an actually rerun gate still requires fresh attempt evidence.
- Completion, resume, and finish refuse publication whenever the existing rebase gate record describes an applying or inconsistent operation, even if ordinary pre-operation verdicts would otherwise pass.

**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/artifacts.test.ts`, `src/conductor/test/integration/rebase-preserved-readers.test.ts`

**Dependencies:** Task 7

### Task 9: Apply one explicit rebase state transition
**Story:** 6 happy 1; 6 negative 2
**Type:** happy-path

**Steps:**
1. Introduce a shared transition application service using ConductStateStore.applyBatch, not writeState or navigateBack. Its named expected-value batch updates exactly invalidated gates, required publication continuation, and a rebase-operation identity; it leaves acceptance_specs, established BUILD completion, skipped gates, and unrelated fields untouched.
2. Use the existing store port/fake-store pattern; no new persistence channel or bypass of the filesystem lease. Record the applying descriptor before effects and applied only after state/verdict agreement. Return the applied decision for event delivery. Own the application-service boundary proof with real state-store persistence in an isolated directory.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement apply one explicit rebase state transition`.

> **Amended 2026-09-11 by #2253:** Coherence review makes the already-approved publication/transition boundary explicit in the additional completion check below; scope and routing are unchanged.

**Done when:**
- The shared transition service applies one expected-value state batch for the explicit gate set and retains acceptance_specs, established BUILD, skipped states, and unrelated fields.
- Same-field conflict or held state-mutation lease causes a refusal with no overwritten conflicting update and no applied-operation success.
- The transition service marks an operation applied only when the written gate verdicts and persisted step fields agree with its explicit decision; skipped and unrelated gates acquire no new effects.

**Files:** `src/conductor/src/engine/rebase-transition.ts`, `src/conductor/src/engine/conduct-state-store.ts`, `src/conductor/src/types/state.ts`, `src/conductor/test/engine/rebase-transition.test.ts`

**Dependencies:** Task 6

### Task 10: Reconcile interrupted or repeated transition application
**Story:** 6 happy 2; 6 negative 1; 6 negative 2
**Type:** negative-path

**Steps:**
1. Use the applying/applied descriptor in the existing rebase gate record as restart authority. Before each write, compare the original gate/state identity or the exact already-applied result. Reapply only missing effects; any distinct newer result requires reconciliation/refusal, not replacement with the saved PASS. Block publication while a descriptor is applying or inconsistent.
2. Record operation-scoped convergence credit in the existing kickback ledger mutation, so retry cannot credit build_review twice. Inject stops after preparation, a gate write, the state batch, and credit application. Application-service integration owns these write-boundary cases; no generic transaction store is added.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement reconcile interrupted or repeated transition application`.

**Done when:**
- Restart reconciliation after each injected write boundary either completes the same validated operation or blocks progress, and an incomplete operation never permits publication.
- Repeated application leaves newer verdicts untouched and does not duplicate gate reopening or build_review convergence credit.

**Files:** `src/conductor/src/engine/rebase-transition.ts`, `src/conductor/src/engine/gate-verdicts.ts`, `src/conductor/src/engine/kickback-ledger.ts`, `src/conductor/test/engine/rebase-transition.test.ts`

**Dependencies:** Task 9

### Task 11: Wire the conductor rebase tail to selective continuation
**Story:** 1 happy 1; 1 happy 2; 2 happy 1; 2 happy 2
**Type:** happy-path

**Steps:**
1. Have runRebaseStep and advanceTail consume the same applied transition result. Remove the rebase-only positional navigateStateBack loop; retain ordinary non-rebase navigation. After required coverage refresh, select required test_suite-or-later work and publication continuation from actual unsatisfied gates.
2. Own normal-flow integration with a real isolated Git repo and fake provider/PR boundaries, following the existing rebase-tail-preserve fixture pattern. Assert runner counts for same-file disjoint replay, changed resolution, and unproved comparison. Exercise real predicates and suite adapter outcomes; do not stub the new decision/helper.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement wire the conductor rebase tail to selective continuation`.

> **Amended 2026-09-11 by #2253:** Coherence review makes the already-approved publication/transition boundary explicit in the additional completion check below; scope and routing are unchanged.

**Done when:**
- A real conductor rebase flow records zero additional acceptance_specs, BUILD, build_review, prd_audit, and as-built dispatches for valid same-file disjoint replay while establishing current suite proof and running applicable manual testing.
- Changed-resolution and unproved-comparison conductor flows dispatch the explicit affected review set, never acceptance_specs or established BUILD by position, and never report unproved replay as unchanged.
- After a completed code-changing rebase, the next selected lifecycle step is test_suite or later; required coverage refresh runs in place and cannot select an intervening authoring or BUILD step.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/rebase.ts`, `src/conductor/test/integration/rebase-tail-preserve.test.ts`

**Dependencies:** Task 4, Task 8, Task 10

### Task 12: Refresh coverage through its existing runner in place
**Story:** 3 happy 1; 3 happy 2
**Type:** happy-path

**Steps:**
1. Reuse/extract the existing coverage_binding runner dispatch path, including lifecycle, digest-cache, envelope, skip configuration, and attempt accounting. Invoke it for affected coverage from selective rebase continuation without selecting acceptance_specs or BUILD. Do not add a new completion predicate or change the judge rubric.
2. Own coverage refresh integration through Conductor with a fake coverage provider: changed valid pairs refresh; identical pairs use cache; disabled configuration retains its existing result. Search coverage_binding in the ordinary dispatch path and coverage-binding-inputs/envelope for context preparation.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement refresh coverage through its existing runner in place`.

**Done when:**
- Conductor refreshes changed passing coverage through the existing runner and lifecycle, then reaches required verification with zero acceptance_specs or completed-BUILD dispatches.
- Unchanged-pair and disabled-judge conductor fixtures retain the existing cache and disabled outcomes without unnecessary coverage judge dispatch.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/integration/rebase-coverage-refresh.test.ts`

**Dependencies:** Task 11

### Task 13: Keep coverage refusal and unavailable-result ownership
**Story:** 3 negative 1; 3 negative 2
**Type:** negative-path

**Steps:**
1. Extend the same production coverage-refresh fixture with does-not-assert, unavailable provider, and malformed result responses. Preserve the existing bounded retry/refusal handling rather than translating these into suite failures or implementation tasks.
2. The integration assertion observes no appended task, no unrelated BUILD dispatch, no fabricated PASS, and no publication. Keep exhaustive envelope parsing permutations in existing lower-layer coverage tests.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement keep coverage refusal and unavailable-result ownership`.

**Done when:**
- A does-not-assert result in the conductor coverage refresh reaches the existing human-correction refusal with no appended plan task or unrelated BUILD dispatch.
- Unavailable and malformed coverage results follow the existing bounded retry/refusal route and cannot produce coverage PASS or publication.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/integration/rebase-coverage-refresh.test.ts`

**Dependencies:** Task 12

### Task 14: Block lost completed-BUILD evidence at continuation
**Story:** 2 negative 2; 1 negative 2
**Type:** negative-path

**Steps:**
1. Retain checkStepCompletion/deriveCompletion as the sole mechanical BUILD authority. For completed work after rebase, translate false/throwing derivation into the existing evidence recovery/halt diagnostic before selection, including the tree-attesting dispatch recheck. Do not make the predicate mutate state or create a second completion test.
2. Own missing-completion integration through the conductor and re-kick preflight: missing evidence, forged done state, and unreadable predicate all block. A distinct ordinary repair obligation is exempt from this missing-evidence branch and retains its normal owner.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement block lost completed-build evidence at continuation`.

**Done when:**
- Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication.
- Mechanical completion still comes from checkStepCompletion, and an independently established ordinary repair obligation remains eligible for its normal repair route.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/test/integration/rebase-loop.test.ts`

**Dependencies:** Task 11

### Task 15: Connect actual suite failure to ordinary repair after preservation
**Story:** 4 happy 1; 4 happy 2; 4 negative 2
**Type:** happy-path

**Steps:**
1. Ensure an actual failing suite result supersedes replay preservation for the ordinary repair group before the existing bounded kickback runs. Reuse the native suite failure evidence and repair ledger; no new repair budget or synthetic acceptance-authoring pass.
2. Own the actual-failure integration through Conductor with a faithful fake suite process: completed failing exit supplies diagnostics to BUILD, scoped repair changes code, native suite passes, and ordinary downstream validation follows. Include passing and permitted-reuse cases plus existing code-repair exhaustion.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement connect actual suite failure to ordinary repair after preservation`.

**Done when:**
- A completed failing suite result reaches BUILD with its failure evidence, and successful repair is followed by suite verification and ordinary downstream validation without replaying an old PASS.
- Passing or permitted-reuse suite proof causes no rebase-only BUILD repair; exhausted ordinary code-repair allowance halts before publication.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/integration/rebase-loop.test.ts`

**Dependencies:** Task 11

### Task 16: Keep suite infrastructure failures outside code repair
**Story:** 4 negative 1; 4 negative 2
**Type:** negative-path

**Steps:**
1. At the same post-rebase suite result boundary, preserve typed infrastructure outcomes. Use fake launch failure, timeout, and unavailable result; do not encode them as a completed failing exit or consume code-repair credit.
2. Own infrastructure-route integration via Conductor; retain the existing infrastructure retry/halt policy and its configured allowance, including immediate halt where that policy has no retry. These cases do not start a BUILD walk.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement keep suite infrastructure failures outside code repair`.

**Done when:**
- Conductor routes suite launch failure, timeout, and unavailable result through existing infrastructure handling with no code-repair charge or BUILD dispatch.
- The suite result routes halt before publication on exhausted code-repair allowance (Task 15 fixture) or infrastructure allowance (this fixture), without converting infrastructure failure into a test failure.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/integration/rebase-loop.test.ts`

**Dependencies:** Task 15

### Task 17: Wire mandatory re-kick through the shared completed-rebase transition
**Story:** 7 happy 1; 5 happy 2; 6 happy 2
**Type:** happy-path

**Steps:**
1. Replace re-kick-specific completed-rebase application with the same transition service used by the conductor. Keep mandatory play-forward, active-input resolver, pre-rebase recovery, and completion diagnostics from the landed prerequisites. Do not run an independent projection or positional reset.
2. Own re-kick integration through resumeRebaseFirst followed by Conductor resume with isolated Git/fake provider boundaries. Coverage refresh occurs through the conductor runner after successful preflight. Retry of the same completed operation must not reopen an already-refreshed gate.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement wire mandatory re-kick through the shared completed-rebase transition`.

**Done when:**
- resumeRebaseFirst imports the required base and applies the shared transition before conductor resume, preserving valid prior reviews and completed authoring/BUILD.
- Repeated re-kick continuation consumes an already-applied operation without duplicate reopening, and affected coverage still reaches its existing conductor runner.

**Files:** `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/daemon-rekick.test.ts`

**Dependencies:** Task 10, Task 12, Task 14

### Task 18: Retain prerequisite entry, document, and protected-recovery behavior
**Story:** 7 happy 1; 7 happy 2; 7 negative 1; 7 negative 2
**Type:** negative-path

**Steps:**
1. Own the compatibility boundary checks at normal finish and re-kick entry. Extend their existing fixtures with the new transition adapter installed, using the delivered #2453/#2495 policy rather than replicating it. Cases: mergeable finish with unchanged active inputs, active-document-only changes, unrelated documents, base code/test changes, unresolved rebase, protected-evidence refusal, and collision recovery.
2. Only completed relevant rebases enter the new application. Preserve the current normal-finish skip constraints and mandatory re-kick distinction. Assert no extra collision action or entry decision from the new hook. This is scoped integration wiring, not a rewrite of entry policy.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement retain prerequisite entry, document, and protected-recovery behavior`.

**Done when:**
- Normal finish retains its existing mergeability, active-document, and base-code/test skip conditions while re-kick still plays the base forward; document-only active inputs reopen only their owning reviews.
- Unresolved rebase or failed protected checks block before preservation, and unrelated documents or collision recovery trigger no competing action from the post-rebase integration.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/test/engine/rebase-mergeable-skip-policy.test.ts`, `src/conductor/test/engine/daemon-rekick.test.ts`

**Dependencies:** Task 17

### Task 19: Emit applied gate decisions through the existing event spine
**Story:** 6 happy 1; 6 happy 2; 2 happy 2
**Type:** happy-path

**Steps:**
1. Make emitGateInvalidationEvents and conductor/re-kick kickback emission consume the applied result, never a separately recomputed classifier. Retain existing preserved/invalidated/reverified, coverage, kickback, and halt variants; optional typed operation/replay-basis fields may explain preservation without another event channel.
2. Own EventPersister integration for actual state/verdict effects, including mechanical BUILD preservation, unproved replay, skipped gates, refused state batch, and repeated application. Use the existing emitter/persister fixture and operation credit from Task 10. Do not promise transactional exactly-once event delivery; resumed delivery must identify the same applied operation and never claim a second mutation.
3. Follow the scoped RED/GREEN cycle above and commit as `Implement emit applied gate decisions through the existing event spine`.

**Done when:**
- Persisted gate and kickback events identify the actual applied gate set, including no phantom BUILD kickback and no unchanged-replay claim for an unproved comparison.
- A refused transition emits no applied-success claim; repeated application reports the same operation without duplicate reopening or convergence credit through the existing event spine.

**Files:** `src/conductor/src/engine/rebase.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/src/types/events.ts`, `src/conductor/test/integration/gate-verdict-observability.integration.test.ts`

**Dependencies:** Task 10, Task 11, Task 17

## Integration Points

Task 1 owns identity capture through the existing driver; Tasks 2–7 supply lower-layer policy/evidence. Task 8 owns completion/sweep/finish consumers. Task 9 owns state-port application and Task 10 its interruption/retry behavior. Task 11 owns normal rebase dispatch; Tasks 12–13 own coverage refresh outcomes; Task 14 owns missing completion; Tasks 15–16 own suite repair versus infrastructure outcomes; Task 17 owns re-kick wiring; Task 18 owns entry/recovery compatibility; Task 19 owns persisted-event reporting. Shared fixtures may be extended without duplicating the same boundary proof.

## Coverage Check

> **Amended 2026-09-11 by #2253:** Story 6 happy criterion 1 originally cited Task 9 alone; its complete mapping is Tasks 9 and 19 so reported events are covered alongside state and verdict effects.

> Original mapping: | Story 6 happy: Given a successful rebase produces explicit preservation and invalidation decisions, when they are applied, then state and verdicts agree with the reported decisions and skipped gates and unrelated fields remain unchanged. | 9 | "The shared transition service applies one expected-value state batch for the explicit gate set and retains acceptance_specs, established BUILD, skipped states, and unrelated fields." | diff-local |

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given completed acceptance specs and BUILD and passing feature reviews, when a successful rebase preserves the expected feature replay including disjoint upstream edits in the same file, then acceptance_specs, BUILD, build_review, prd_audit, and architecture_review_as_built are not dispatched again solely because of that rebase. | 11 | "A real conductor rebase flow records zero additional acceptance_specs, BUILD, build_review, prd_audit, and as-built dispatches for valid same-file disjoint replay while establishing current suite proof and running applicable manual testing." | diff-local |
| Story 1 happy: Given that replay changes aggregate verification or runtime inputs, when the loop continues, then current aggregate proof is established before required downstream reviews and applicable manual testing still runs for changed runtime behavior. | 11 | "A real conductor rebase flow records zero additional acceptance_specs, BUILD, build_review, prd_audit, and as-built dispatches for valid same-file disjoint replay while establishing current suite proof and running applicable manual testing." | diff-local |
| Story 1 negative: Given the implementation replay is unchanged but an active review input changed, when revalidation is selected, then the affected review is reopened and cannot inherit approval from implementation equivalence alone. | 4 | "The shared classifier preserves eligible feature reviews for unchanged replay, reopens affected reviews for changed or unproved replay, and still invalidates reviews with changed active inputs." | diff-local |
| Story 1 negative: Given a gate was already failing, pending repair, or lacked valid evidence before rebase, when unchanged replay is established, then that gate is not converted into a preserved PASS. | 5 | "applyRebaseVerdicts grants preservation only to a previously applicable original PASS and never converts failing, pending-repair, missing-evidence, or skipped cases into a judged PASS." | diff-local |
| Story 2 happy: Given a successful conflict resolution changes the feature result, when post-rebase checks are selected, then the affected judged gates and required suite verification reopen while completed acceptance authoring and BUILD are not reopened merely because of their location. | 11 | "Changed-resolution and unproved-comparison conductor flows dispatch the explicit affected review set, never acceptance_specs or established BUILD by position, and never report unproved replay as unchanged." | diff-local |
| Story 2 happy: Given replay equivalence cannot be established but completion evidence remains valid, when the loop continues, then affected reviews are conservatively revalidated and no event claims unchanged replay was proved. | 11 | "Changed-resolution and unproved-comparison conductor flows dispatch the explicit affected review set, never acceptance_specs or established BUILD by position, and never report unproved replay as unchanged." | diff-local |
| Story 2 negative: Given a missing baseline, unsupported Git capability, failed comparison command, or conflicting reconstruction, when replay preservation is considered, then no unchanged-replay approval is issued. | 3 | "The replay comparator returns unproved with no preservation claim for every missing-object, unsupported-option, command-error, malformed-output, and conflicting-reconstruction fixture." | diff-local |
| Story 2 negative: Given completed BUILD evidence cannot be established after rebase, when continuation is evaluated, then progress blocks with evidence/recovery diagnostics rather than blindly dispatching the completed task list or proceeding to publication. | 14 | "Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication." | diff-local |
| Story 3 happy: Given coverage inputs changed after a successful rebase and the refreshed claims pass, when coverage is checked, then its evidence is refreshed and continuation reaches the required verification tail without dispatching acceptance_specs or a completed BUILD. | 12 | "Conductor refreshes changed passing coverage through the existing runner and lifecycle, then reaches required verification with zero acceptance_specs or completed-BUILD dispatches." | diff-local |
| Story 3 happy: Given coverage pairs are unchanged or the judge is disabled by existing configuration, when coverage refresh is required, then the existing cache or disabled behavior is retained without unnecessary judge dispatch. | 12 | "Unchanged-pair and disabled-judge conductor fixtures retain the existing cache and disabled outcomes without unnecessary coverage judge dispatch." | diff-local |
| Story 3 negative: Given a refreshed claim does not assert its criterion, when coverage evaluates it, then the existing human-correction refusal blocks progress without appending a task or starting an unrelated BUILD. | 13 | "A does-not-assert result in the conductor coverage refresh reaches the existing human-correction refusal with no appended plan task or unrelated BUILD dispatch." | diff-local |
| Story 3 negative: Given the coverage judge or its result is unavailable or malformed, when refresh runs, then existing bounded retry/refusal handling applies and neither coverage PASS nor permission to publish is fabricated. | 13 | "Unavailable and malformed coverage results follow the existing bounded retry/refusal route and cannot produce coverage PASS or publication." | diff-local |
| Story 4 happy: Given a post-rebase suite command completes with a failing exit, when its result is processed, then BUILD receives the failure evidence for scoped repair and a successful repair is followed by suite verification and ordinary downstream validation. | 15 | "A completed failing suite result reaches BUILD with its failure evidence, and successful repair is followed by suite verification and ordinary downstream validation without replaying an old PASS." | diff-local |
| Story 4 happy: Given the native verifier establishes current passing proof through execution or permitted reuse, when the result is processed, then rebase alone causes no BUILD repair dispatch. | 15 | "Passing or permitted-reuse suite proof causes no rebase-only BUILD repair; exhausted ordinary code-repair allowance halts before publication." | diff-local |
| Story 4 negative: Given the verifier times out, cannot launch, or cannot establish a result, when failure is processed, then infrastructure recovery applies without charging a code-repair kickback as though tests failed. | 16 | "Conductor routes suite launch failure, timeout, and unavailable result through existing infrastructure handling with no code-repair charge or BUILD dispatch." | diff-local |
| Story 4 negative: Given the existing repair or infrastructure allowance is exhausted, when the next failure is processed, then the existing bounded halt occurs and publication remains blocked. | 15, 16 | "The suite result routes halt before publication on exhausted code-repair allowance (Task 15 fixture) or infrastructure allowance (this fixture), without converting infrastructure failure into a test failure." | diff-local |
| Story 5 happy: Given a review was validly preserved after rebase and its relevant inputs remain unchanged, when finish evaluates its evidence, then the review is accepted without another judge dispatch. | 8 | "Production completion, stale-artifact sweep, restarted conductor, and finish consumers retain a valid preserved review with zero extra judge dispatches and unchanged original identity." | diff-local |
| Story 5 happy: Given the same valid preservation survives a process restart, when resume and stale-artifact cleanup inspect it, then the passing evidence is retained and the review is not redispatched solely because the session changed. | 8 | "Production completion, stale-artifact sweep, restarted conductor, and finish consumers retain a valid preserved review with zero extra judge dispatches and unchanged original identity." | diff-local |
| Story 5 negative: Given relevant code or review inputs change after preservation, or an ordinary repair kickback is outstanding, when a reader checks the verdict, then the old preservation cannot satisfy the gate. | 8 | "Those consumers reject stale-input, outstanding-failure, and wrong-verdict preservation without allowing publication; an actually rerun gate still requires fresh attempt evidence." | diff-local |
| Story 5 negative: Given preservation evidence is absent, malformed, belongs to another gate or verdict, or references unavailable replay objects, when a reader evaluates it, then it grants no additional preservation authority and existing evidence rules apply. | 7 | "The validity helper grants no replay authority for absent, malformed, wrong-gate, wrong-verdict, missing-object, unapplied-operation, changed-input, or outstanding-repair fixtures." | diff-local |
| Story 6 happy: Given a successful rebase produces explicit preservation and invalidation decisions, when they are applied, then state and verdicts agree with the reported decisions and skipped gates and unrelated fields remain unchanged. | 9, 19 | "The shared transition service applies one expected-value state batch for the explicit gate set and retains acceptance_specs, established BUILD, skipped states, and unrelated fields." | diff-local |
| Story 6 happy: Given the same completed rebase result is processed again, when application repeats, then it does not duplicate reopening effects, erase newer work, or replace a later failure with an earlier PASS. | 10 | "Repeated application leaves newer verdicts untouched and does not duplicate gate reopening or build_review convergence credit." | diff-local |
| Story 6 negative: Given persistence stops between required verdict and state writes, when the process resumes, then the incomplete transition cannot permit publication and is reconciled before continuation. | 10 | "Restart reconciliation after each injected write boundary either completes the same validated operation or blocks progress, and an incomplete operation never permits publication." | diff-local |
| Story 6 negative: Given a same-field state conflict or held mutation lease prevents application, when the write is attempted, then the conflicting update is not overwritten and successful transition completion is not reported. | 9 | "Same-field conflict or held state-mutation lease causes a refusal with no overwritten conflicting update and no applied-operation success." | diff-local |
| Story 7 happy: Given normal finish or a re-kick, when entry policy runs, then the existing finish skip conditions and mandatory re-kick play-forward remain unchanged before the shared post-rebase decision is applied. | 18 | "Normal finish retains its existing mergeability, active-document, and base-code/test skip conditions while re-kick still plays the base forward; document-only active inputs reopen only their owning reviews." | diff-local |
| Story 7 happy: Given a document-only advance changes active review inputs, when the delivered input classifier processes it, then only affected review work is requested and document-only change itself does not reopen BUILD or aggregate verification. | 18 | "Normal finish retains its existing mergeability, active-document, and base-code/test skip conditions while re-kick still plays the base forward; document-only active inputs reopen only their owning reviews." | diff-local |
| Story 7 negative: Given rebase remains unresolved or protected evidence checks fail, when continuation is considered, then the existing recovery or halt remains blocking and the new preservation path cannot bypass it. | 18 | "Unresolved rebase or failed protected checks block before preservation, and unrelated documents or collision recovery trigger no competing action from the post-rebase integration." | diff-local |
| Story 7 negative: Given unrelated documents change or pre-rebase collision recovery is required, when the existing owner handles that case, then the post-rebase feature adds no competing entry decision or collision-recovery action. | 18 | "Unresolved rebase or failed protected checks block before preservation, and unrelated documents or collision recovery trigger no competing action from the post-rebase integration." | diff-local |

## Architecture Obligation Coverage

> **Amended 2026-09-11 by #2253:** Coherence review expands the task citations to cover each decision’s full obligation; the original evidence quotations remain. Prior → complete mappings: adr-2026-09-11-selective-post-rebase-verification#D1: task-18 → task-17, task-18; adr-2026-09-11-selective-post-rebase-verification#D2: task-2 → task-1, task-2, task-3; adr-2026-09-11-selective-post-rebase-verification#D3: task-4 → task-4, task-5, task-7; adr-2026-09-11-selective-post-rebase-verification#D4: task-11 → task-9, task-11, task-12, task-13, task-19; adr-2026-09-11-selective-post-rebase-verification#D5: task-8 → task-6, task-7, task-8, task-10; adr-2026-09-11-selective-post-rebase-verification#D6: task-14 → task-5, task-14, task-15, task-16; adr-2026-09-11-selective-post-rebase-verification#D8: task-11 → task-1, task-2, task-3, task-8, task-9, task-10, task-11, task-12, task-13, task-14, task-15, task-16, task-17, task-18, task-19; adr-2026-07-08-post-rebase-gate-first-mechanical-reverify#D1: task-14 → task-9, task-11, task-14; adr-2026-07-20-post-rebase-delta-aware-invalidation#D1: task-4 → task-4, task-9, task-11, task-19.

> Original mappings retained below; the amended operative table follows.
>
> | adr-2026-09-11-selective-post-rebase-verification#D1 | task | task-18 | Normal finish retains its existing mergeability, active-document, and base-code/test skip conditions while re-kick still plays the base forward; document-only active inputs reopen only their owning reviews. |
> | adr-2026-09-11-selective-post-rebase-verification#D2 | task | task-2 | The replay comparator returns unchanged for clean same-file disjoint replay and changed when H contains an additional resolution edit. |
> | adr-2026-09-11-selective-post-rebase-verification#D3 | task | task-4 | The shared classifier preserves eligible feature reviews for unchanged replay, reopens affected reviews for changed or unproved replay, and still invalidates reviews with changed active inputs. |
> | adr-2026-09-11-selective-post-rebase-verification#D4 | task | task-11 | Changed-resolution and unproved-comparison conductor flows dispatch the explicit affected review set, never acceptance_specs or established BUILD by position, and never report unproved replay as unchanged. |
> | adr-2026-09-11-selective-post-rebase-verification#D5 | task | task-8 | Production completion, stale-artifact sweep, restarted conductor, and finish consumers retain a valid preserved review with zero extra judge dispatches and unchanged original identity. |
> | adr-2026-09-11-selective-post-rebase-verification#D6 | task | task-14 | Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication. |
> | adr-2026-09-11-selective-post-rebase-verification#D8 | task | task-11 | A real conductor rebase flow records zero additional acceptance_specs, BUILD, build_review, prd_audit, and as-built dispatches for valid same-file disjoint replay while establishing current suite proof and running applicable manual testing. |
> | adr-2026-07-08-post-rebase-gate-first-mechanical-reverify#D1 | task | task-14 | Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication. |
> | adr-2026-07-20-post-rebase-delta-aware-invalidation#D1 | task | task-4 | The shared classifier preserves eligible feature reviews for unchanged replay, reopens affected reviews for changed or unproved replay, and still invalidates reviews with changed active inputs. |

> | adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D1 | task | task-6 | Gate evidence round trips the bound preservation and rebase-operation records while retaining the original passing artifact and judge attempt identity. |
> **Amended 2026-09-11 by #2253:** Original judge stamping is already implemented; its operative disposition is existing rather than Task 6. Task 6 owns only the added replay record.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-11-selective-post-rebase-verification#D1 | task | task-17, task-18 | Normal finish retains its existing mergeability, active-document, and base-code/test skip conditions while re-kick still plays the base forward; document-only active inputs reopen only their owning reviews. |
| adr-2026-09-11-selective-post-rebase-verification#D2 | task | task-1, task-2, task-3 | The replay comparator returns unchanged for clean same-file disjoint replay and changed when H contains an additional resolution edit. |
| adr-2026-09-11-selective-post-rebase-verification#D3 | task | task-4, task-5, task-7 | The shared classifier preserves eligible feature reviews for unchanged replay, reopens affected reviews for changed or unproved replay, and still invalidates reviews with changed active inputs. |
| adr-2026-09-11-selective-post-rebase-verification#D4 | task | task-9, task-11, task-12, task-13, task-19 | Changed-resolution and unproved-comparison conductor flows dispatch the explicit affected review set, never acceptance_specs or established BUILD by position, and never report unproved replay as unchanged. |
| adr-2026-09-11-selective-post-rebase-verification#D5 | task | task-6, task-7, task-8, task-10 | Production completion, stale-artifact sweep, restarted conductor, and finish consumers retain a valid preserved review with zero extra judge dispatches and unchanged original identity. |
| adr-2026-09-11-selective-post-rebase-verification#D6 | task | task-5, task-14, task-15, task-16 | Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication. |
| adr-2026-09-11-selective-post-rebase-verification#D7 | task | task-19 | Persisted gate and kickback events identify the actual applied gate set, including no phantom BUILD kickback and no unchanged-replay claim for an unproved comparison. |
| adr-2026-09-11-selective-post-rebase-verification#D8 | task | task-1, task-2, task-3, task-8, task-9, task-10, task-11, task-12, task-13, task-14, task-15, task-16, task-17, task-18, task-19 | A real conductor rebase flow records zero additional acceptance_specs, BUILD, build_review, prd_audit, and as-built dispatches for valid same-file disjoint replay while establishing current suite proof and running applicable manual testing. |
| adr-2026-07-08-post-rebase-gate-first-mechanical-reverify#D1 | task | task-9, task-11, task-14 | Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication. |
| adr-2026-07-20-post-rebase-delta-aware-invalidation#D1 | task | task-4, task-9, task-11, task-19 | The shared classifier preserves eligible feature reviews for unchanged replay, reopens affected reviews for changed or unproved replay, and still invalidates reviews with changed active inputs. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D1 | existing | none | artifacts.ts stampCode and writeGateCodeStamp plus stampGateRunIdentity already bind actual judge results to code/run identity; this feature retains those writers and adds separate replay authority without restamping the original result. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D2 | task | task-8 | Production completion, stale-artifact sweep, restarted conductor, and finish consumers retain a valid preserved review with zero extra judge dispatches and unchanged original identity. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D3 | task | task-7 | The validity helper grants no replay authority for absent, malformed, wrong-gate, wrong-verdict, missing-object, unapplied-operation, changed-input, or outstanding-repair fixtures. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D4 | task | task-8 | Production completion, stale-artifact sweep, restarted conductor, and finish consumers retain a valid preserved review with zero extra judge dispatches and unchanged original identity. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D5 | task | task-8 | Those consumers reject stale-input, outstanding-failure, and wrong-verdict preservation without allowing publication; an actually rerun gate still requires fresh attempt evidence. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D6 | no-change | none | resolveGateCodeValidityConfig retains the existing enabled switch; no configuration or opt-out semantics are changed. Task 7 retains that fallback. |
| adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch#D1 | no-change | none | The declared tree-attesting set remains build and test_suite; coverage and judged reviews are not added. Existing StepDefinition eligibility remains authoritative. |
| adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch#D2 | task | task-14 | Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication. |
| adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch#D3 | task | task-14 | Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication. |
| adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch#D4 | task | task-14 | Mechanical completion still comes from checkStepCompletion, and an independently established ordinary repair obligation remains eligible for its normal repair route. |
| adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch#D5 | task | task-14 | Conductor and re-kick continuation block missing, forged, or unreadable completed-BUILD evidence with recovery diagnostics, zero blind task-list dispatches, and no publication. |
| adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch#D6 | existing | none | applyRebaseVerdicts preverification already uses tree-attesting eligibility and the conductor injects native suite proof inspection; the new transition consumes that outcome rather than adding a predicate. |
| adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch#D7 | no-change | none | checkGate and gateSatisfied remain state-only/pure in their existing roles; selective state application and continuation checks occur outside those readers. |

## Verify-Claims and Review

Verified from current source: GitRunner rebase/resolver seams, ConductStateStore expected-value batch port and lease, original gate-stamp/validity readers, conductor positional tail handling, re-kick preflight, native suite routing, and event emitter are present. A local Git probe established clean same-file merge-tree feasibility. The prerequisite branch seams were inspected during architecture review; their landed versions are an explicit dispatch precondition. No unsupported host Git capability is assumed: Task 3 handles its absence.

The plan introduces implementation choices within the approved ADR: optional metadata in existing gate records, an operation descriptor in the rebase gate record, and one shared application service. No separate persistence or telemetry channel is introduced. Task 10 must not silently resolve conflicting newer authority; refusal/reconciliation is the approved boundary.

Coverage: 28/28 acceptance criteria mapped, including all negative paths. Dependencies are explicit and acyclic. Nineteen scoped tasks own behavior and its tests; no terminal catch-all validation task. The native aggregate verifier and SHIP validators retain completed-feature verification ownership.
