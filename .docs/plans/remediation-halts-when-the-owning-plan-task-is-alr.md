# Implementation Plan: Reopened task resolution

**Date:** 2026-09-06
**Stories:** .docs/stories/remediation-halts-when-the-owning-plan-task-is-alr.md
**Conflict check:** Clean after operator-approved resolutions on 2026-09-06.
**Status:** Approved by the operator in the composer session on 2026-09-06.

## Summary

Eleven implementation tasks make explicit owning-task repair durable, dispatchable, closable, and bounded. Scope acceptance closes only the covered objection before repair is admitted.

## Technical Approach

Use the existing engine-state.json as durable control state, with a shared serialized atomic store and a versioned plan-scoped repair section. The obligation is the identity and freshness boundary of current repair, not a new correctness judge. Migrate both existing engine-state writers first; then connect shared resolution, task seeding, and the current task-close boundary. Preserve ordinary trailer/row semantics for untouched tasks.

Persist an engine-issued admitted-round identity before side effects. Settle its lap charge with an idempotency receipt atomically alongside the lap delta in the existing kickback ledger; on restart, the engine-state round plus receipt makes the two-file sequence replayable. Retain the original tree/resolved baseline. Current acceptance is evaluated before admission and on replay. Current task-close evidence or a strictly post-boundary matching task commit permits review; only the existing effective review/acceptance authority ends its blocker. Unchanged unresolved work retains the existing bounds.

Local patterns: createConductStateLease provides bounded filesystem serialization; task-seed distinguishes recovery from ordinary merges; task-progress is the shared resolver; runTaskDone validates per-check close evidence; the existing accepted-widenings classifier owns scope decisions. Existing engine-state direct writes and getEvidenceRange fallback are verified no-fit for the new authoritative state/strict boundary. Their replacements are limited to these specific needs. No exact-copy Pattern-source contract is declared.

## Preconditions and verification basis

Accepted technical/M scope, seven accepted stories, the approved reopened-task ADR, and the clean conflict report are present. Source inspection verified the named production seams and existing two engine-state writers (99%, verified). Lap charging currently writes the existing ledger after admission, while restage context is partly in memory; the explicit receipt and persisted baseline above implement the approved replay requirement. No new third-party dependency is needed. Tests use temporary local Git/filesystem state and faithful provider fakes; external services remain smoke-only.

## Tasks

### Task 1: Serialize engine-state mutations and reject unreadable control state

**Story:** 4 happy/negative
**Type:** infrastructure
**Files:** `src/conductor/src/engine/engine-state-store.ts`, `src/conductor/test/engine/engine-state-store.test.ts`

**Steps:**
1. Write focused filesystem tests for concurrent read-modify-write operations, absent legacy state, malformed JSON/present incompatible repair section, lease refusal, and failed temporary-write/rename. Assert persisted values and operation results, not method-call counts.
2. Observe RED, then add a shared typed reader and update operation over the existing engine-state.json. Reuse createConductStateLease(statePath) with its bounded acquisition and owner recovery; write a unique temporary file in the target directory and rename under the lease. Read inside the lease, preserve unknown sibling fields, release in finally, and report typed failures. Only ENOENT is absence; malformed present control state is not a new empty object.
3. Use the existing conduct-state-lease behavior as the concurrency pattern; vary only the store label/path and injected filesystem. Do not use the current tolerant direct-write engine-state callers as a pattern: they can erase sibling state. Run the named unit file to GREEN.

**Done when:**
1. engine-state-store.test.ts observes both concurrent successful mutations in the persisted object and preserves unrelated fields.
2. engine-state-store.test.ts distinguishes absent legacy state from malformed JSON and incompatible present repair state.
3. engine-state-store.test.ts reports lease refusal, temporary-write failure, and rename failure without publishing a partial object or losing the prior durable object.

**Dependencies:** none

### Task 2: Move both engine-state bookkeeping writers onto the shared store

**Story:** 4 happy/negative
**Type:** refactor
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/engine-state-store.test.ts`

**Steps:**
1. Add RED integration cases invoking exported recordActivePlanPath and recordAppendedRemediationTaskIds concurrently with a repair-state mutation; assert all successful updates survive.
2. Replace their catch-and-reset/direct writes with the Task 1 update seam, preserving their public contracts and propagating a named persistence failure to existing callers. Reuse the lease/atomic-rename pattern; no ad-hoc lock or second state file. Search engine-state.json production writes and ensure every actual writer uses this seam.
3. Run the scoped store tests to GREEN, including malformed-state and sibling-bookkeeping assertions.

**Done when:**
1. Through recordActivePlanPath and recordAppendedRemediationTaskIds, concurrent updates preserve active-plan data, appended-task ids, and sibling repair state in engine-state-store.test.ts.
2. Both production engine-state writers use the shared serialized update seam and cannot replace malformed present state with an empty object.

**Dependencies:** 1

### Task 3: Persist plan-scoped repair identities and guarded closure transitions

**Story:** 3 negative; 4 happy/negative
**Type:** infrastructure
**Files:** `src/conductor/src/engine/repair-obligations.ts`, `src/conductor/test/engine/repair-obligations.test.ts`

**Steps:**
1. Write RED transition tests for canonical aliases, duplicate replay, later distinct repair, multiple task obligations, plan identity isolation, and stale closure compare-and-set.
2. Add the versioned repair section reader and transition functions using Task 1. Persist an engine-issued round id, canonical active-plan identity, bound task ids, source finding/authority and instruction, immutable HEAD/tree/resolved baseline, settlement state, and per-task open/resolved records. Resolve plan identity using normalized active plan path rather than a mutable plan-content hash. Keep earlier records for replay/history; a later admitted effect has a new identity.
3. Closure must compare the current obligation id captured by its caller, preserve siblings, and store accepted evidence provenance. Replaying an admitted id returns its persisted result without resetting a closure or replacing its boundary. Reject incompatible fields and propagate store failures; do not infer finding equivalence from summary strings. Run the scoped transition tests to GREEN.

**Done when:**
1. repair-obligations.test.ts observes one immutable obligation on replay, a new open obligation for a distinct later repair, and no task-id leakage across active plans.
2. repair-obligations.test.ts folds task aliases, preserves sibling obligations, and rejects closure against a superseded obligation id.
3. repair-obligations.test.ts preserves source findings, repair instructions, original evidence/progress boundaries, and open/resolved state across serialization.

**Dependencies:** 1

### Task 4: Apply strict repair freshness in shared task resolution

**Story:** 1 negative; 2 happy/negative
**Type:** happy-path
**Files:** `src/conductor/src/engine/autoheal.ts`, `src/conductor/src/engine/task-progress.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/task-progress.test.ts`

**Steps:**
1. Add RED resolver fixtures using local temporary Git repositories: old matching commit, post-boundary matching alias, unrelated later commit, raw terminal row, unavailable/non-ancestor boundary, malformed repair state, and untouched legacy tasks.
2. Extend the existing trailer parser with an explicit strict repair-range path. Verify the saved commit exists and is an ancestor of HEAD before reading boundary..HEAD; return a typed unavailable result on either failure. Do not reuse getEvidenceRange fallback unchanged. Legacy unbounded/plan-anchor callers keep their current range rules.
3. Use the shared obligation reader in resolveTaskIds. For open repair, ignore prior rows/Done-when records and pre-boundary trailers; accept current persisted close or matching strict-range routing evidence. All outstanding obligations for a task must be satisfied. Preserve countResolvedTasks delegation and provide the build predicate with a named unavailable/malformed-state reason without turning historical evidence into completion. Run task-progress tests to GREEN.

**Done when:**
1. Through checkStepCompletion(build) and countResolvedTasks, task-progress.test.ts keeps old trailers, unrelated commits, and manually completed rows unresolved for an open repair while a matching post-boundary task commit permits routing.
2. task-progress.test.ts leaves an unavailable or non-ancestor repair boundary unresolved with a named reason and never substitutes older branch history; a persisted valid current close remains usable.
3. task-progress.test.ts preserves unreopened terminal-row, trailer, legacy no-context, and Git-read-failure outcomes while malformed present repair state cannot produce historical completion.

**Dependencies:** 3

### Task 5: Keep current repairs open during task-status reconstruction

**Story:** 3 happy/negative
**Type:** happy-path
**Files:** `src/conductor/src/engine/task-seed.ts`, `src/conductor/test/engine/task-seed.test.ts`

**Steps:**
1. Write RED seedTaskStatus cases for missing status, ordinary reseed of a terminal row, corrupt status, open repair plus untouched completed sibling, and persisted resolved repair.
2. Apply the shared repair reader/resolution in both reconstruction and merge/reseed paths. Preserve the existing distinction between missing-file recovery and ordinary row merge, but never let trailerProvenCompletions or terminal-state ranking override an open obligation. Keep unrelated row evidence/history and canonical ids. A malformed control section produces a typed seed refusal, not legacy recovery.
3. Run task-seed tests to GREEN; use real temporary plans and status files, with faithful Git fixtures at the existing boundary.

**Done when:**
1. Through seedTaskStatus, task-seed.test.ts reconstructs a missing or corrupt status file with the open repair unresolved and an untouched completed sibling resolved.
2. Through seedTaskStatus, task-seed.test.ts preserves a durably closed repair on replay and prevents ordinary reseeding from resurrecting old completion for an open repair.

**Dependencies:** 4

### Task 6: Bind fresh task-close evidence to the current repair

**Story:** 2 happy/negative; 3 happy; 4 negative
**Type:** happy-path
**Files:** `src/conductor/src/engine/task-progress.ts`, `src/conductor/src/engine/task-cli.ts`, `src/conductor/test/engine/task-progress.test.ts`, `src/conductor/test/engine/task-cli.test.ts`

**Steps:**
1. Add RED CLI-boundary cases for current per-check evidence and permitted verify-only close on unchanged HEAD, missing evidence, stored prior-round evidence, stale obligation identity, and a failed closure write.
2. At runTaskDone/completeTaskDoneWhen, capture canonical plan/task/current obligation before evidence validation; never repurpose old doneWhen records as supplied current evidence. Preserve the current validation grammar and legacy plans. Persist the accepted current closure using an obligation-id compare-and-set only after all applicable checks and task-row validation pass. Do not clear the current-task marker or report success on failed persistence.
3. Treat task-status as the recoverable projection: publish the durable accepted closure before the final row projection, and make a retry repair a failed projection from that same accepted closure. Missing current-task legacy idempotence must not silently skip an open repair; it must either perform valid current close or name the unresolved requirement. Recheck captured obligation identity under the store lease so a concurrent new repair cannot be closed by the old operation.
4. Run the task-progress and task-cli files to GREEN. Preserve no-Done-when legacy behavior for untouched tasks; a legacy close without validated current proof does not alone resolve an explicit repair.

**Done when:**
1. Through runTaskDone, task-cli.test.ts closes a current evidenced or permitted verify-only repair with unchanged HEAD, and shared resolution observes its durable accepted closure.
2. Through runTaskDone, task-cli.test.ts refuses missing required evidence, prior-record-only evidence, stale obligation identity, and persistence failure without closing the current repair or clearing its marker.
3. Task-close tests retain untouched legacy behavior and recover an interrupted row projection from the same durable accepted closure without reopening it.

**Dependencies:** 3

### Task 7: Apply current scope acceptance before repair admission

**Story:** 5 happy/negative
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-remediation-authority-routing.test.ts`, `src/conductor/test/acceptance/prd-audit-no-owner-over-scope.acceptance.test.ts`

**Steps:**
1. Extend existing prd-audit scope fixtures with RED conductor-route observations for accepted-only, accepted-plus-independent-defect, late acceptance of a pending route, refused, partial, invalid, and attempt/budget-only decisions.
2. Reuse routeCurrentPrdAuditOverScope and classifyOverScopeCriterion before constructing actionable repair bindings and again when a persisted route resumes. Preserve the existing acceptance store, validity rules, decision status, and authority. Accepted-only work advances without entering repair admission; mixed findings retain independent blockers. Do not parse grant prose into a new permission or acceptance model.
3. Own the conductor acceptance integration here, using existing internal flows and faithful adapter fakes. Run the scoped authority and acceptance fixtures to GREEN without any external LLM/service.

**Done when:**
1. Through Conductor.run, the accepted-only scope fixture advances with unchanged HEAD, zero BUILD calls, and zero repair laps, including restart and late acceptance of the same pending route.
2. Through Conductor.run, mixed-scope fixtures close only the accepted finding and retain independent defects and missing evidence.
3. Authority-routing tests keep refused, partial, invalid, inert-clear, and attempt/budget-only decisions from completing uncovered work and preserve the actual recorded decision status.

**Dependencies:** none

### Task 8: Admit and settle each existing-task repair round once

**Story:** 1 happy/negative; 3 happy/negative; 4 negative
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/kickback-ledger.ts`, `src/conductor/test/engine/kickback-ledger.test.ts`, `src/conductor/test/acceptance/plan-growth-existing-task-restage.acceptance.test.ts`

**Steps:**
1. Add RED production-route cases for an old-completed owner, alias/multiple owners, invalid authority/owner, consolidated manual_test FAIL, admission write failure, and interruption around round settlement.
2. After existing eligibility/budget validation and Task 7 effective acceptance, persist the admitted round and immutable pre-restage baseline before row mutation or BUILD. Use existing resolvePlanTaskReference binding, not inferred prose ownership. Pass that saved round through restaging and the D1 completion check so historical evidence cannot block its dispatch.
3. Extend the existing kickback-ledger schema with a per-round settlement receipt. Persist the receipt and its owning gates’ lap deltas in the same existing atomic ledger write. Resume by checking that receipt before charging; then mark the engine-state round settled. A crash between the two files replays the receipt, not another increment. Preserve unrelated ledger fields, growth, and gate counters; validate present receipt shape. New rounds still check caps. Keep ledger mutation under the existing conductor single-writer route, not task-close callbacks.
4. Run the focused ledger and existing-task route files to GREEN. The no-growth existing-task path owns this receipt integration; do not change ordinary appended-work accounting or consolidated manual-test admission.

**Done when:**
1. Through Conductor.run, plan-growth-existing-task-restage.acceptance.test.ts dispatches historically completed bound owners with their findings, adds no plan task, folds aliases, and charges one lap per owning gate for the admitted round with zero growth.
2. The same production-route fixture refuses unknown ownership, unauthorized findings, persistence failure, and the excluded consolidated manual_test route without dispatching unauthorized or unrecorded repair.
3. kickback-ledger.test.ts and the production-route fixture observe one charge and one receipt across interruption before and after settlement, preserving sibling gate counters and plan-growth data.

**Dependencies:** 2, 3, 4, 7

### Task 9: Resume durable outstanding repair context and original baselines

**Story:** 3 happy/negative
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/plan-growth-existing-task-restage.acceptance.test.ts`

**Steps:**
1. Add RED restart fixtures recreating the Conductor instance after admission, settlement, restaging, dispatch, and accepted close; inspect actual next dispatch payload and persisted accounting.
2. Restore pending route/finding instructions and pendingNoOpBaselines from the durable admitted round before build routing/captureKickbackToBuildContext. Resume outstanding task obligations only, reevaluate acceptance through Task 7, and use the settlement receipt from Task 8. Do not mint a new id or measure the baseline after rows were demoted.
3. Run the scoped restart fixture to GREEN using real state reload rather than retaining the original instance. Include a later distinct repair and a changed active-plan path. Recovery assumes engine-state survives; do not reconstruct lost obligations from historical commits.

**Done when:**
1. Through a new Conductor.run instance, restart fixtures retain the original obligation id, HEAD/tree/resolved boundary, finding hint, and one settlement charge across admission/restage/dispatch interruptions.
2. The restart fixture skips a durably closed replay, dispatches a distinct later repair as new work, and isolates reused task ids in a different active plan.

**Dependencies:** 5, 8

### Task 10: Terminate successful repair and retain unchanged-failure bounds

**Story:** 6 happy/negative; 2 happy
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/kickback-escalation.ts`, `src/conductor/test/engine/kickback-escalation.test.ts`, `src/conductor/test/engine/conductor-remediation-noop-guard.test.ts`

**Steps:**
1. Add RED effective-review cases reached after current repair close: PASS on unchanged tree, unchanged FAIL after pending-to-completed status movement, exhausted existing lap allowance, and existing configured repeated semantic case.
2. At the post-build review/escalation boundary, evaluate the effective verdict before no-progress re-dispatch decisions. PASS exits; still-failing work uses the original persisted pre-reopen tree/resolved baseline. Preserve existing kickback_escalation toggle, per-gate caps, and configured semantic-case adjudicator; do not create a second repeat detector or reset counters.
3. Run the two scoped test files to GREEN. This task owns the close-to-governing-review integration; Task 6 owns only the task-close entry point. Retain existing liveness/dirty-work completion guards, since evidence-only close does not waive them.

**Done when:**
1. Through Conductor.run, conductor-remediation-noop-guard.test.ts advances after a current evidence-only close and passing effective review on an unchanged code tree, with no further repair dispatch.
2. Through Conductor.run, the unchanged-failure fixture halts with prior/current context and no further BUILD after status-only reopen/reclose produces no net progress.
3. Kickback tests enforce existing lap exhaustion and configured semantic-repeat decisions across reopening and replay without resetting budgets or adding a repeat authority.

**Dependencies:** 6, 9

### Task 11: Report empty and refused remediation through the existing event path

**Story:** 7 happy/negative
**Type:** negative-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-remediation-noop-guard.test.ts`, `src/conductor/test/engine/remediation-disposition-rejection.test.ts`

**Steps:**
1. Add RED route observations for empty output, missing/unresolvable owner, state/restage failure, unavailable current evidence, genuinely resolved emitted work, and unsupported/malformed planner input.
2. Refine existing route/HALT detail construction to retain source gate and available finding/task ids with the actual refusal cause. Use the existing event member and its detail/evidence fields, allowing existing ConductorEventEmitter/EventPersister to carry the observation. Do not add a sidecar, poller, or independent log.
3. Run scoped no-op and disposition-rejection tests to GREEN. Valid open repairs with historical completion must reach the admitted path rather than either empty or already-resolved diagnostics; existing malformed-input rejection remains intact.

**Done when:**
1. Through the conductor remediation route, diagnostic fixtures distinguish empty output, unresolved ownership, persistence/restage failure, unavailable current evidence, and genuinely resolved emitted work with available source/finding/task context.
2. Existing event persistence receives the same refusal context as the route/HALT result; no second telemetry channel is introduced.
3. Diagnostic fixtures never label an admitted outstanding repair empty or already resolved solely from historical completion, and retain malformed/unsupported-input rejection details.

**Dependencies:** 8, 9

## Integration ownership

| Boundary behavior | Sole integration owner |
| --- | --- |
| Existing engine-state writers preserve repair and plan bookkeeping | Task 2 |
| Shared build-completion and progress observe current repair freshness | Task 4 |
| Missing/ordinary task-status seeding preserves repair state | Task 5 |
| CLI task close accepts only current valid repair evidence | Task 6 |
| Effective scope acceptance prevents accepted-only repair | Task 7 |
| Admitted repair dispatch and idempotent lap settlement | Task 8 |
| A new conductor instance restores durable work/context | Task 9 |
| Closed repair reaches PASS or bounded unchanged-failure halt | Task 10 |
| Refusal causes reach existing route/HALT/event consumers | Task 11 |

Each owner’s Done when names the entry point and observation; internal helper tests alone do not close that task. Tasks 1 and 3 own lower-layer state permutations. Story-level acceptance specs are authored at BUILD entry only where the named multi-step flow requires them; negative permutations remain in the lowest sufficient layer identified by the owning task. There is no terminal aggregate-validation task.

## Coverage Check

All criteria below concern behavior against the current feature checkout and explicit local fixtures; none requires an unrelated future commit to make it true. Each proof disposition is diff-local. Test layer and assertion are specified in the cited task’s Steps and Done when.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an admitted existing-task repair whose owning task has prior completion evidence, when the repair route is taken, then BUILD is dispatched for that task with the current finding and repair instruction, without appending a duplicate plan task. | 8 | "Through Conductor.run, plan-growth-existing-task-restage.acceptance.test.ts dispatches historically completed bound owners with their findings, adds no plan task, folds aliases, and charges one lap per owning gate for the admitted round with zero growth." | diff-local |
| Story 1 happy: Given one admitted round binding several valid task references, including tolerated aliases, when the round is dispatched, then each distinct owning task receives its relevant findings and the existing gate lap is charged once for the round while plan-growth usage remains unchanged. | 8 | "Through Conductor.run, plan-growth-existing-task-restage.acceptance.test.ts dispatches historically completed bound owners with their findings, adds no plan task, folds aliases, and charges one lap per owning gate for the admitted round with zero growth." | diff-local |
| Story 1 negative: Given old completion evidence for an explicitly reopened task, when completion is checked before the repair has supplied current evidence, then the task remains unresolved and the route is not refused as already complete. | 4 | "Through checkStepCompletion(build) and countResolvedTasks, task-progress.test.ts keeps old trailers, unrelated commits, and manually completed rows unresolved for an open repair while a matching post-boundary task commit permits routing." | diff-local |
| Story 1 negative: Given an unknown task reference or a finding not authorized for existing-task repair, when admission runs, then the engine refuses that repair with the finding and invalid ownership/authority identified and does not append substitute work or grant an extra lap. | 8 | "The same production-route fixture refuses unknown ownership, unauthorized findings, persistence failure, and the excluded consolidated manual_test route without dispatching unauthorized or unrecorded repair." | diff-local |
| Story 2 happy: Given an open repair obligation and a later matching task commit, when shared task resolution evaluates the current repair, then the task can route forward to its governing review while all applicable completion checks still apply. | 4 | "Through checkStepCompletion(build) and countResolvedTasks, task-progress.test.ts keeps old trailers, unrelated commits, and manually completed rows unresolved for an open repair while a matching post-boundary task commit permits routing." | diff-local |
| Story 2 happy: Given an open repair whose applicable Done when checks are satisfied and freshly evidenced, including the existing permitted verify-only path, when the engine accepts task close, then the repair resolves and may reach a passing review without requiring another commit. | 6, 10 | "Through runTaskDone, task-cli.test.ts closes a current evidenced or permitted verify-only repair with unchanged HEAD, and shared resolution observes its durable accepted closure." | diff-local |
| Story 2 happy: Given a plan task that has never been explicitly reopened, when completion is evaluated, then its existing terminal-row, trailer, and legacy task-close behavior remains unchanged. | 4 | "task-progress.test.ts preserves unreopened terminal-row, trailer, legacy no-context, and Git-read-failure outcomes while malformed present repair state cannot produce historical completion." | diff-local |
| Story 2 negative: Given only a pre-reopen commit, an unrelated later commit, or a manually flipped completed row, when the current repair is evaluated, then none of those inputs alone resolves the repair. | 4 | "Through checkStepCompletion(build) and countResolvedTasks, task-progress.test.ts keeps old trailers, unrelated commits, and manually completed rows unresolved for an open repair while a matching post-boundary task commit permits routing." | diff-local |
| Story 2 negative: Given a repair close missing required current evidence or evidence belonging only to a prior repair, when closure is attempted, then the close is refused and the current repair remains open with the missing evidence identified. | 6 | "Through runTaskDone, task-cli.test.ts refuses missing required evidence, prior-record-only evidence, stale obligation identity, and persistence failure without closing the current repair or clearing its marker." | diff-local |
| Story 2 negative: Given an unavailable repair freshness boundary, when historical commit evidence is examined, then older branch history is not substituted to close the repair; the affected task remains unresolved with a diagnostic, while a valid current evidence-based close remains usable. | 4 | "task-progress.test.ts leaves an unavailable or non-ancestor repair boundary unresolved with a named reason and never substitutes older branch history; a persisted valid current close remains usable." | diff-local |
| Story 3 happy: Given a durable admitted repair interrupted before or after its tasks are restaged, when the process resumes, then it uses the same repair obligation and original evidence boundary, dispatches its outstanding work with the finding context, and does not charge the admitted round again. | 9 | "Through a new Conductor.run instance, restart fixtures retain the original obligation id, HEAD/tree/resolved boundary, finding hint, and one settlement charge across admission/restage/dispatch interruptions." | diff-local |
| Story 3 happy: Given an open repair and a missing task-status file while the durable repair state survives, when task state is reconstructed, then the reopened task remains unresolved and untouched previously completed tasks are restored according to their existing rules. | 5 | "Through seedTaskStatus, task-seed.test.ts reconstructs a missing or corrupt status file with the open repair unresolved and an untouched completed sibling resolved." | diff-local |
| Story 3 happy: Given a repair whose current closure was durably accepted before interruption, when the process resumes, then that repair remains resolved rather than being reopened by replay of the same admitted round. | 5 | "Through seedTaskStatus, task-seed.test.ts preserves a durably closed repair on replay and prevents ordinary reseeding from resurrecting old completion for an open repair." | diff-local |
| Story 3 negative: Given an interruption between admission persistence, lap settlement, restaging, and dispatch, when recovery runs, then it does not omit outstanding work, advance the original evidence boundary, duplicate a charge, or create a second obligation for that same effect. | 8, 9 | "Through a new Conductor.run instance, restart fixtures retain the original obligation id, HEAD/tree/resolved boundary, finding hint, and one settlement charge across admission/restage/dispatch interruptions." | diff-local |
| Story 3 negative: Given a later genuinely distinct admitted repair for the same task, when it is reopened, then the previous repair's closure does not close the new one and replay deduplication does not suppress the new work. | 3 | "repair-obligations.test.ts observes one immutable obligation on replay, a new open obligation for a distinct later repair, and no task-id leakage across active plans." | diff-local |
| Story 3 negative: Given a task id reused in another active plan, when recovery evaluates current work, then completion or repair state from the previous plan does not resolve or reopen the new plan's task. | 9 | "The restart fixture skips a durably closed replay, dispatches a distinct later repair as new work, and isolates reused task ids in a different active plan." | diff-local |
| Story 4 happy: Given concurrent updates for distinct tasks and ordinary plan bookkeeping, when those updates finish, then each successful update remains visible and no sibling repair or unrelated bookkeeping is lost. | 2 | "Through recordActivePlanPath and recordAppendedRemediationTaskIds, concurrent updates preserve active-plan data, appended-task ids, and sibling repair state in engine-state-store.test.ts." | diff-local |
| Story 4 happy: Given a legacy run without repair state, when it enters the shared state path, then normal operation continues under the prior completion rules until an explicit repair is admitted. | 1 | "engine-state-store.test.ts distinguishes absent legacy state from malformed JSON and incompatible present repair state." | diff-local |
| Story 4 negative: Given a persistence failure or unavailable mutation lease during repair admission or close, when the operation reports its result, then it reports the failure and does not dispatch an unrecorded repair or claim an unpersisted closure; previously durable sibling state remains intact. | 1, 6, 8 | "The same production-route fixture refuses unknown ownership, unauthorized findings, persistence failure, and the excluded consolidated manual_test route without dispatching unauthorized or unrecorded repair." | diff-local |
| Story 4 negative: Given malformed or incompatible present repair state, when an affected task is evaluated, then the engine identifies the unreadable state and refuses to derive completion from historical evidence rather than treating the state as a legacy absence. | 1 | "engine-state-store.test.ts distinguishes absent legacy state from malformed JSON and incompatible present repair state." | diff-local |
| Story 5 happy: Given completed work whose only remaining blocker is a current OVER_SCOPE finding, when a valid explicit acceptance of that finding is recorded and effective evaluation runs, then the blocker is resolved and the workflow advances without reopening the task, dispatching BUILD, demanding a new commit, or charging a repair lap. | 7 | "Through Conductor.run, the accepted-only scope fixture advances with unchanged HEAD, zero BUILD calls, and zero repair laps, including restart and late acceptance of the same pending route." | diff-local |
| Story 5 happy: Given that acceptance and an unchanged code tree, when the process restarts or the same pending route is reevaluated, then the acceptance remains effective under the existing decision authority and that accepted finding does not create a repair obligation. | 7 | "Through Conductor.run, the accepted-only scope fixture advances with unchanged HEAD, zero BUILD calls, and zero repair laps, including restart and late acceptance of the same pending route." | diff-local |
| Story 5 happy: Given a valid acceptance covering one scope finding alongside an independent actionable defect, when routing runs, then the acceptance closes only its covered scope blocker and the remaining defect is handled through its existing authorized path. | 7 | "Through Conductor.run, mixed-scope fixtures close only the accepted finding and retain independent defects and missing evidence." | diff-local |
| Story 5 negative: Given only permission for another attempt, a budget increase, an inert halt clear, or an invalid acceptance, when completion is evaluated, then the engine does not treat it as acceptance of completed scope or proof of repair. | 7 | "Authority-routing tests keep refused, partial, invalid, inert-clear, and attempt/budget-only decisions from completing uncovered work and preserve the actual recorded decision status." | diff-local |
| Story 5 negative: Given a refused or still-unaccepted scope finding, when the workflow resumes, then that finding remains blocking with its actual decision status identified rather than being silently accepted or repeatedly offered as though no decision had been made. | 7 | "Authority-routing tests keep refused, partial, invalid, inert-clear, and attempt/budget-only decisions from completing uncovered work and preserve the actual recorded decision status." | diff-local |
| Story 5 negative: Given an acceptance for a different finding or only part of the current blocking set, when effective evaluation runs, then unrelated findings and missing completion evidence remain blocking. | 7 | "Through Conductor.run, mixed-scope fixtures close only the accepted finding and retain independent defects and missing evidence." | diff-local |
| Story 6 happy: Given a repaired task with valid current completion evidence, when the governing effective review passes, then the repair cycle ends and the workflow advances even when no code-tree change was necessary. | 10 | "Through Conductor.run, conductor-remediation-noop-guard.test.ts advances after a current evidence-only close and passing effective review on an unchanged code tree, with no further repair dispatch." | diff-local |
| Story 6 happy: Given a genuinely new admitted repair within the existing allowance, when the round runs, then the existing progress and review safeguards remain active and its budget accounting follows the owning gate's existing rules. | 10 | "Kickback tests enforce existing lap exhaustion and configured semantic-repeat decisions across reopening and replay without resetting budgets or adding a repeat authority." | diff-local |
| Story 6 negative: Given a repair that only reopens and recloses task status without net progress and whose effective review still fails unchanged, when the existing no-progress check runs, then it stops the cycle with the prior and current failure context rather than granting another lap because status moved. | 10 | "Through Conductor.run, the unchanged-failure fixture halts with prior/current context and no further BUILD after status-only reopen/reclose produces no net progress." | diff-local |
| Story 6 negative: Given exhausted existing lap allowance, or a repeated unresolved semantic case where the existing adjudicator governs it, when another repair route is considered, then the existing bound stops the route; reopening does not reset counters or bypass that authority. | 10 | "Kickback tests enforce existing lap exhaustion and configured semantic-repeat decisions across reopening and replay without resetting budgets or adding a repeat authority." | diff-local |
| Story 7 happy: Given remediation that emits no concrete work and no valid owning-task binding, when the route cannot proceed, then its diagnostic identifies empty output rather than claiming completed tasks prevented dispatch. | 11 | "Through the conductor remediation route, diagnostic fixtures distinguish empty output, unresolved ownership, persistence/restage failure, unavailable current evidence, and genuinely resolved emitted work with available source/finding/task context." | diff-local |
| Story 7 happy: Given emitted work that cannot be dispatched, when the engine refuses it, then its diagnostic identifies the relevant cause and finding/task context: unresolved ownership, persistence/restaging failure, unavailable current evidence, or genuinely already-resolved emitted work. | 11 | "Through the conductor remediation route, diagnostic fixtures distinguish empty output, unresolved ownership, persistence/restage failure, unavailable current evidence, and genuinely resolved emitted work with available source/finding/task context." | diff-local |
| Story 7 negative: Given a valid outstanding owning-task repair with historical completion, when diagnostics are produced, then it is not mislabeled as empty output or genuinely already-resolved work. | 11 | "Diagnostic fixtures never label an admitted outstanding repair empty or already resolved solely from historical completion, and retain malformed/unsupported-input rejection details." | diff-local |
| Story 7 negative: Given a malformed remediation result or an unrecognized disposition, when it is rejected, then the existing failure is surfaced with its rejected input identified and is not silently converted into an accepted repair or a generic empty-work success. | 11 | "Diagnostic fixtures never label an admitted outstanding repair empty or already resolved solely from historical completion, and retain malformed/unsupported-input rejection details." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-06-reopened-task-resolution#D1 | task | task-3 | repair-obligations.test.ts preserves source findings, repair instructions, original evidence/progress boundaries, and open/resolved state across serialization. |
| adr-2026-09-06-reopened-task-resolution#D2 | task | task-3, task-8, task-9 | Through a new Conductor.run instance, restart fixtures retain the original obligation id, HEAD/tree/resolved boundary, finding hint, and one settlement charge across admission/restage/dispatch interruptions. |
| adr-2026-09-06-reopened-task-resolution#D3 | task | task-1, task-2, task-3 | Through recordActivePlanPath and recordAppendedRemediationTaskIds, concurrent updates preserve active-plan data, appended-task ids, and sibling repair state in engine-state-store.test.ts. |
| adr-2026-09-06-reopened-task-resolution#D4 | task | task-4, task-6 | Through runTaskDone, task-cli.test.ts closes a current evidenced or permitted verify-only repair with unchanged HEAD, and shared resolution observes its durable accepted closure. |
| adr-2026-09-06-reopened-task-resolution#D5 | task | task-4 | task-progress.test.ts leaves an unavailable or non-ancestor repair boundary unresolved with a named reason and never substitutes older branch history; a persisted valid current close remains usable. |
| adr-2026-09-06-reopened-task-resolution#D6 | task | task-4, task-5, task-6, task-9 | Through a new Conductor.run instance, restart fixtures retain the original obligation id, HEAD/tree/resolved boundary, finding hint, and one settlement charge across admission/restage/dispatch interruptions. |
| adr-2026-09-06-reopened-task-resolution#D7 | task | task-7 | Through Conductor.run, the accepted-only scope fixture advances with unchanged HEAD, zero BUILD calls, and zero repair laps, including restart and late acceptance of the same pending route. |
| adr-2026-09-06-reopened-task-resolution#D8 | task | task-10 | Through Conductor.run, the unchanged-failure fixture halts with prior/current context and no further BUILD after status-only reopen/reclose produces no net progress. |
| adr-2026-09-06-reopened-task-resolution#D9 | task | task-8, task-11 | Through Conductor.run, plan-growth-existing-task-restage.acceptance.test.ts dispatches historically completed bound owners with their findings, adds no plan task, folds aliases, and charges one lap per owning gate for the admitted round with zero growth. |
| adr-2026-07-13-kickback-build-no-op-escalation#D1 | task | task-11 | Through the conductor remediation route, diagnostic fixtures distinguish empty output, unresolved ownership, persistence/restage failure, unavailable current evidence, and genuinely resolved emitted work with available source/finding/task context. |
| adr-2026-07-13-kickback-build-no-op-escalation#D2 | task | task-10 | Through Conductor.run, the unchanged-failure fixture halts with prior/current context and no further BUILD after status-only reopen/reclose produces no net progress. |
| adr-2026-07-13-kickback-build-no-op-escalation#D3 | task | task-11 | Existing event persistence receives the same refusal context as the route/HALT result; no second telemetry channel is introduced. |
| adr-2026-07-23-trailer-union-build-step-routing#D1 | task | task-10 | Through Conductor.run, conductor-remediation-noop-guard.test.ts advances after a current evidence-only close and passing effective review on an unchanged code tree, with no further repair dispatch. |
| adr-2026-07-23-trailer-union-build-step-routing#D2 | task | task-4 | Through checkStepCompletion(build) and countResolvedTasks, task-progress.test.ts keeps old trailers, unrelated commits, and manually completed rows unresolved for an open repair while a matching post-boundary task commit permits routing. |
| adr-2026-07-23-trailer-union-build-step-routing#D3 | task | task-4 | Through checkStepCompletion(build) and countResolvedTasks, task-progress.test.ts keeps old trailers, unrelated commits, and manually completed rows unresolved for an open repair while a matching post-boundary task commit permits routing. |
| adr-2026-07-23-trailer-union-build-step-routing#D4 | task | task-4 | task-progress.test.ts leaves an unavailable or non-ancestor repair boundary unresolved with a named reason and never substitutes older branch history; a persisted valid current close remains usable. |
| adr-2026-07-23-trailer-union-build-step-routing#D5 | task | task-4 | task-progress.test.ts preserves unreopened terminal-row, trailer, legacy no-context, and Git-read-failure outcomes while malformed present repair state cannot produce historical completion. |
| adr-2026-07-23-trailer-union-build-step-routing#D6 | no-change | none | Historical #859 contract-text synchronization is not a new implementation obligation in #1831; the current routing/task-close/review authority is governed by the already-approved successor decisions. |

## Completion of plan authoring

The task graph is acyclic: 1 → 2/3; 3 → 4/6; 4 → 5; 2/3/4/7 → 8; 5/8 → 9; 6/9 → 10; 8/9 → 11. Task 7 is independent and preserves the existing scope-decision authority. All 34 acceptance criteria have an explicit coverage row; all 18 citable changed-ADR decisions have one disposition. No BUILD task directs amendment of another feature’s protected artifact.
