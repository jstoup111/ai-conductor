# Implementation Plan: Reduce mechanical restack resolver cost

**Date:** 2026-11-15
**Stories:** .docs/stories/reduce-resolver-cost-for-mechanical-restack-confli.md
**Design:** .docs/decisions/adr-2026-11-15-accepted-restack-resolution-reuse.md
**Conflict check:** Clean; reporting ownership sequenced behind approved prerequisite #3653.

## Technical Approach

Extend replay's explicit bookkeeping rules, preserve accepted automatic results in feature-scoped Git authority, and share acceptance between normal execution and recovery. Automatic-result identity is stricter than operator-tip identity; their provenance and matching rules remain separate. Existing journal transactions still own stack movement. Extend #3653's event correlation and Restack report; do not recreate that foundation or alter fold scheduling.

Use the current conflict-record/journal patterns for parsed domain identities, expected-old-value transactions and finite ref names. A JSON reference to a commit does not make it reachable: retain the candidate under a companion Git ref. Events use the existing union and active persister, including an authoritative-state outbox when needed, never a new telemetry schema. Tests use the narrow production boundary with local Git and injected provider/process failures; no full Conductor run or real provider calls are needed.

## Prerequisites

- Operator-approved dependency: jstoup111/ai-conductor#3653 must ship before BUILD. Its approved plan tasks 25–26 own provider-attempt correlation and appendRestackSection; resolve these symbols on the BUILD checkout. If their delivered contract differs, return to DECIDE rather than duplicate them.
- Single implementation PR; no slice manifest.
- Existing explicit operator-tip precedence, strong-resolver intent checks, routing eligibility and all flat-feature behavior are preserved.

## Tasks

### Task 1: Compose eligible bookkeeping rules across all conflicted paths
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Refactor the existing replay conflict-path evaluation into an exhaustive per-path result. Apply existing halt-record and routed remediation-block rules without broadening eligibility; build a candidate tree only when every conflict is covered. Preserve the current mismatch exception and source handoff.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Implementation constraints:** Preserve the existing replayedMessage commit-tree call and first-parent tree reads in restack-replay.ts. Return original conflict commit and paths with any deterministic candidate so a later predicate rejection retains a real resolver handoff context.

**Done when:**
- [test] replayChildRange local-Git fixtures prove: Given a replay with multiple conflicts each eligible under the existing halt-record or remediation-block rules, when the child replays, then the rule-defined content survives and no provider is invoked.
- [test] replayChildRange local-Git fixtures prove: Given eligible bookkeeping conflicts mixed with a source-code conflict, when replay runs, then the unresolved source conflict reaches the configured resolver and no partially resolved child is accepted.
- [test] replayChildRange local-Git fixtures prove: Given conflicting bodies for the same remediation identifier, when deterministic resolution runs, then its existing mismatch refusal remains and stack refs do not move.
- [test] replayChildRange local-Git fixtures prove: Given adjacent-line source edits or conflicting memory content without an eligible rule, when replay runs, then neither proximity nor the file path authorizes automatic union.
- [implementation] Refactor the existing replay conflict-path evaluation into an exhaustive per-path result. Apply existing halt-record and routed remediation-block rules without broadening eligibility; build a candidate tree only when every conflict is covered. Preserve the current mismatch exception and source handoff. [implementation] Preserve the existing replayedMessage commit-tree call and first-parent tree reads in restack-replay.ts. Return original conflict commit and paths with any deterministic candidate so a later predicate rejection retains a real resolver handoff context.

**Files:** `src/conductor/src/engine/restack/restack-replay.ts`, `src/conductor/test/engine/restack/restack-mechanical-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-replay.ts`
- `src/conductor/test/engine/restack/restack-mechanical-resolution.test.ts`

**Dependencies:** none

### Task 2: Preserve replay candidate history through the new rule composition
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Keep selectReplayCandidates semantics unchanged while connecting multi-path handling; exercise intentional revert/reapply and originally empty commits through replayChildRange, asserting content and exact rewrite correspondence rather than commit counts alone.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Done when:**
- [test] replayChildRange local-Git fixtures prove: Given intentional revert/reapply history and originally empty evidence commits, when prevention selects replay candidates, then their required effects and rewrite correspondences survive.
- [implementation] Keep selectReplayCandidates semantics unchanged while connecting multi-path handling; exercise intentional revert/reapply and originally empty commits through replayChildRange, asserting content and exact rewrite correspondence rather than commit counts alone.

**Files:** `src/conductor/src/engine/restack/restack-replay.ts`, `src/conductor/src/engine/restack/restack-replay-candidates.ts`, `src/conductor/test/engine/restack/restack-mechanical-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-replay.ts`
- `src/conductor/src/engine/restack/restack-replay-candidates.ts`
- `src/conductor/test/engine/restack/restack-mechanical-resolution.test.ts`

**Dependencies:** Task 1

### Task 3: Persist accepted automatic results with reachable Git objects
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Add a focused automatic-result record beside the existing conflict-record module. Parse a versioned record with feature/child identity, original range, exact replay-parent SHA, candidate tip/tree, ordered rewrite pairs, replay policy inputs, validation version and operator-decision identity. Pin the candidate commit in a companion ref: a SHA inside JSON does not keep a commit reachable. Atomically write record and pin with expected old OIDs. Keep one accepted record per child. Distinguish absent, invalid and unavailable; never treat an I/O failure as absence.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Implementation constraints:** Keep the new module outside the existing restack/rebase value-import cycle: import domain types with import type and inject the Git runner and acceptance collaborators; do not import makeGitRunner, ownership, journal or replay implementations by value. Follow the existing conflict-record local runner interface pattern.

**Done when:**
- [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given an accepted automatic result, when its operation aborts on a higher child, then its durable evidence and referenced objects remain reachable for a matching retry.
- [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given disk, permission, or Git persistence failure before durable acceptance, when execution handles the failure, then it does not advertise a reusable result or apply the stack from that unrecorded acceptance.
- [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given a concurrent replacement of retained evidence, when an older operation attempts to replace or retire it, then the newer evidence survives the expected-value refusal.
- [implementation] Add a focused automatic-result record beside the existing conflict-record module. Parse a versioned record with feature/child identity, original range, exact replay-parent SHA, candidate tip/tree, ordered rewrite pairs, replay policy inputs, validation version and operator-decision identity. Pin the candidate commit in a companion ref: a SHA inside JSON does not keep a commit reachable. Atomically write record and pin with expected old OIDs. Keep one accepted record per child. Distinguish absent, invalid and unavailable; never treat an I/O failure as absence.
- [implementation] Keep the new module outside the existing restack/rebase value-import cycle: import domain types with import type and inject the Git runner and acceptance collaborators; do not import makeGitRunner, ownership, journal or replay implementations by value. Follow the existing conflict-record local runner interface pattern.

**Files:** `src/conductor/src/engine/restack/restack-automatic-resolution.ts`, `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-automatic-resolution.ts`
- `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`

**Dependencies:** none

### Task 4: Match automatic evidence against the complete replay context
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Implement an exhaustive matcher in the automatic-result module. Compare original range and exact parent, ordered comparison commits and candidate list, routing/normalization policy, rule version and supplied decision identity. Verify pinned commit/tree and recorded rewrite objects exist. Return a typed miss reason for a valid stale record; malformed or unreadable authority is refusal. Do not key by opId or new committer timestamp, which would forbid cross-operation reuse; preserve the recorded tip instead of rewriting it.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Implementation constraints:** Exact parent SHA is intentionally conservative: when a lower replay re-stamps commits in a new operation, reuse above it misses even if the tree is unchanged. Guarantee cross-operation reuse only where the replay parent SHA remains stable, including adopted feature-repair origins; never claim universal base-refresh reuse. A same-tree/different-parent-SHA fixture must report a replay-parent mismatch and invoke ordinary resolution.

**Done when:**
- [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given a change to the child's range, replay parent, replay policy, validation version, or supplied operator decision, when reuse is attempted, then the old automatic result is not applied and reporting names the invalidating input.
- [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given malformed evidence, missing reachable objects, or evidence from another feature or child, when reuse is attempted, then that evidence cannot authorize acceptance or move stack refs.
- [implementation] Implement an exhaustive matcher in the automatic-result module. Compare original range and exact parent, ordered comparison commits and candidate list, routing/normalization policy, rule version and supplied decision identity. Verify pinned commit/tree and recorded rewrite objects exist. Return a typed miss reason for a valid stale record; malformed or unreadable authority is refusal. Do not key by opId or new committer timestamp, which would forbid cross-operation reuse; preserve the recorded tip instead of rewriting it.
- [implementation] Exact parent SHA is intentionally conservative: when a lower replay re-stamps commits in a new operation, reuse above it misses even if the tree is unchanged. Guarantee cross-operation reuse only where the replay parent SHA remains stable, including adopted feature-repair origins; never claim universal base-refresh reuse. A same-tree/different-parent-SHA fixture must report a replay-parent mismatch and invoke ordinary resolution.

**Files:** `src/conductor/src/engine/restack/restack-automatic-resolution.ts`, `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-automatic-resolution.ts`
- `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`

**Dependencies:** Task 3

### Task 5: Share rule-evidence acceptance and bounded escalation
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Extract shared candidate acceptance used by executor and recovery. Recheck the deterministic predicate against original inputs and candidate tree, or check matching accepted-result evidence, before existing ownership and exact-rewrite checks. Distinguish accepted, escalate and unavailable/refused results. Do not change strong-resolver FR-8/FR-9 intent safeguards, permit a cheap model, or turn a failed strong attempt back into a shortcut.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Implementation constraints:** Make the new acceptance module a pure coordinator with injected predicate, ownership and rewrite checks and type-only domain imports, avoiding any new value edge into the existing restack/rebase cycle. Existing executor/recovery modules supply production checks. Carry original conflict commit and paths from Task 1 in the candidate context; only an unresolved eligible source conflict may escalate; invalid bookkeeping evidence returns a validation error before any resolver handoff, so the halt-record driver cannot reapply a rejected rule. An eligible escalate result uses that context to call the existing prepareRestackDecisionDelivery → resolveRestackConflict path explicitly, not a fabricated merge-tree error. Unavailable context is a typed refusal, never acceptance. Refusal events use emitRestackRefused. First-parent Git reads stay behind the injected replay collaborator.

**Done when:**
- [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given an unresolved source conflict lacking an applicable deterministic rule and eligible for the existing strong resolver, when acceptance checks it, then the configured strong resolver receives the unresolved work within the existing bounded attempt policy.
- [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given invalid bookkeeping evidence or an owned-path bookkeeping candidate that violates its deterministic rule, when checked, then a validation error is reported, no provider is invoked, and no stack ref moves; ownership alone cannot authorize it.
- [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given an unrelated path edit, invalid rewrite evidence, or a forbidden parent revert, when checked, then the candidate is refused under the applicable existing safeguards.
- [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given resolver timeout, unavailability, or exhausted attempts, when escalation ends, then an explicit failure outcome is reported without cycling back through shortcuts or claiming a design decision was necessarily required.
- [implementation] Extract shared candidate acceptance used by executor and recovery. Recheck the deterministic predicate against original inputs and candidate tree, or check matching accepted-result evidence, before existing ownership and exact-rewrite checks. Distinguish accepted, escalate and unavailable/refused results. Do not change strong-resolver FR-8/FR-9 intent safeguards, permit a cheap model, or turn a failed strong attempt back into a shortcut. [implementation] Make the new acceptance module a pure coordinator with injected predicate, ownership and rewrite checks and type-only domain imports, avoiding any new value edge into the existing restack/rebase cycle. Existing executor/recovery modules supply production checks. Carry original conflict commit and paths from Task 1 in the candidate context; only an unresolved eligible source conflict may escalate; invalid bookkeeping evidence returns a validation error before any resolver handoff, so the halt-record driver cannot reapply a rejected rule. An eligible escalate result uses that context to call the existing prepareRestackDecisionDelivery → resolveRestackConflict path explicitly, not a fabricated merge-tree error. Unavailable context is a typed refusal, never acceptance. Refusal events use emitRestackRefused. First-parent Git reads stay behind the injected replay collaborator.

**Files:** `src/conductor/src/engine/restack/restack-acceptance.ts`, `src/conductor/src/engine/restack/restack-executor.ts`, `src/conductor/src/engine/restack/restack-recovery.ts`, `src/conductor/test/engine/restack/restack-mechanical-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-acceptance.ts`
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/test/engine/restack/restack-mechanical-resolution.test.ts`

**Dependencies:** Task 1, Task 4

### Task 6: Wire durable reuse into normal restack execution
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. In runRestack, after existing explicit operator-tip handling and before invoking a resolver, try exact automatic reuse. A changed supplied decision invalidates a prior automatic result. After a new resolver result passes existing checks and shared acceptance, persist the automatic record and pin before marking child resolved or progressing. Capture exact rewrites from the settled result. This task owns the cross-operation integration boundary: real local Git, fake resolver, accepted lower child then higher-child halt then new operation.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Done when:**
- [test] The cross-operation reuse fixture uses feature-repair with child 1 as an adopted origin; child 2 has the identical replay-parent SHA in both operations, retains its accepted tip, and invokes no second resolver.
- [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given child 2 has a durably accepted automatic resolution and child 3 subsequently halts, when a new operation retries with child 2's exact inputs unchanged, then child 2 retains its accepted tip with zero new resolver calls.
- [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given a crash before durable acceptance, when execution resumes, then another provider attempt is allowed and the report does not claim the earlier result was reused.
- [implementation] In runRestack, after existing explicit operator-tip handling and before invoking a resolver, try exact automatic reuse. A changed supplied decision invalidates a prior automatic result. After a new resolver result passes existing checks and shared acceptance, persist the automatic record and pin before marking child resolved or progressing. Capture exact rewrites from the settled result. This task owns the cross-operation integration boundary: real local Git, fake resolver, accepted lower child then higher-child halt then new operation.

**Files:** `src/conductor/src/engine/restack/restack-executor.ts`, `src/conductor/src/engine/restack/restack-automatic-resolution.ts`, `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-automatic-resolution.ts`
- `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`

**Dependencies:** Task 4, Task 5

### Task 7: Wire identical acceptance into interrupted-journal recovery
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Have resumePlanned use the same matcher and acceptance routine for pending children; retain its existing non-pending staging-ref fast path. Persist newly accepted results before progressing. A crash before the durable record exists permits another attempt but cannot generate a reused outcome. This task owns recovery-path wiring, not a second independent acceptance implementation.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Implementation constraints:** The new recovery integration fixture crashes after the automatic record and candidate pin commit but before updateRestackChildStatus: the journal child remains pending. resumePlanned must consume that record with zero provider calls. Retain existing non-pending recovery tests as existing proof rather than inventing a RED claim for them.

**Done when:**
- [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given an interrupted operation with an accepted child, when journal recovery resumes, then it uses the same acceptance rules and avoids another resolver invocation for that child.
- [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given a crash before durable acceptance, when execution resumes, then another provider attempt is allowed and the report does not claim the earlier result was reused.
- [implementation] Have resumePlanned use the same matcher and acceptance routine for pending children; retain its existing non-pending staging-ref fast path. Persist newly accepted results before progressing. A crash before the durable record exists permits another attempt but cannot generate a reused outcome. This task owns recovery-path wiring, not a second independent acceptance implementation.
- [implementation] The new recovery integration fixture crashes after the automatic record and candidate pin commit but before updateRestackChildStatus: the journal child remains pending. resumePlanned must consume that record with zero provider calls. Retain existing non-pending recovery tests as existing proof rather than inventing a RED claim for them.

**Files:** `src/conductor/src/engine/restack/restack-recovery.ts`, `src/conductor/src/engine/restack/restack-automatic-resolution.ts`, `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/src/engine/restack/restack-automatic-resolution.ts`
- `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`

**Dependencies:** Task 6

### Task 8: Carry accepted candidates through existing atomic application
**Story:** 3
**Type:** happy-path
**Verify-only:** yes

**Steps:**
1. Inspect existing CAS and transition test evidence against the checks below.
2. Run only missing targeted proof through scoped-run; report existing proof without claiming new RED.
3. Record verification evidence; if a new defect is found, return to its behavior-owning task rather than expanding this task.

**Implementation constraints:** This is a verify-only task over existing CAS and transition behavior, not a new transaction implementation. Reuse the existing move and transition real-Git tests; no fresh RED is claimed for unchanged behavior. Tasks 6 and 7 own proof that new accepted automatic tips actually enter that existing path. Preserve child-region-access-audit readVerdict call counts; no transition edit is expected.

**Done when:**
- [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given all children have accepted candidates and expected refs remain unchanged, when the cascade applies, then refs move atomically and existing invalidation and revalidation requirements still apply.
- [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given another actor changes an expected ref, when application is attempted, then no subset of the planned ref transaction is applied.
- [implementation] Carry accepted tips and exact rewrite maps through the existing journal-to-move transaction. Preserve expected-ref checks, rollback and transition invalidation; do not replace them with a new transaction. This task owns application-boundary proof using runRestack and its existing move/transition seams, covering successful application and a concurrent ref change.
- [implementation] This is a verify-only task over existing CAS and transition behavior, not a new transaction implementation. Reuse the existing move and transition real-Git tests; no fresh RED is claimed for unchanged behavior. Tasks 6 and 7 own proof that new accepted automatic tips actually enter that existing path. Preserve child-region-access-audit readVerdict call counts; no transition edit is expected.

**Files:** `src/conductor/src/engine/restack/restack-executor.ts`, `src/conductor/src/engine/restack/restack-recovery.ts`, `src/conductor/src/engine/restack/restack-move.ts`, `src/conductor/src/engine/restack/restack-transition.ts`, `src/conductor/test/engine/restack/restack-mechanical-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/src/engine/restack/restack-move.ts`
- `src/conductor/src/engine/restack/restack-transition.ts`
- `src/conductor/test/engine/restack/restack-mechanical-resolution.test.ts`

**Dependencies:** Task 6, Task 7

### Task 9: Retire only consumed automatic evidence and preserve legacy state
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Add automatic record and candidate-pin names to the existing finite featureConductorRefNames list. On applied completion retire only the exact record/pin consumed, guarded by old OIDs; journal abort cleanup does not delete them. If retirement fails, leave retryable state with explicit failure rather than deleting a replacement. Preserve the existing operator-tip parsing and normalization behavior and legacy journals without automatic records. Include exact feature-scoped cleanup through deleteFeatureConductorRefs.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Done when:**
- [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given successful application or existing feature cleanup, when retained evidence is retired, then only the owned automatic-resolution state is retired.
- [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given a concurrent replacement of retained evidence, when an older operation attempts to replace or retire it, then the newer evidence survives the expected-value refusal.
- [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given legacy state without automatic-acceptance evidence, when read, then existing operator-tip behavior remains available but the new automatic shortcut is not inferred.
- [implementation] Add automatic record and candidate-pin names to the existing finite featureConductorRefNames list. On applied completion retire only the exact record/pin consumed, guarded by old OIDs; journal abort cleanup does not delete them. If retirement fails, leave retryable state with explicit failure rather than deleting a replacement. Preserve the existing operator-tip parsing and normalization behavior and legacy journals without automatic records. Include exact feature-scoped cleanup through deleteFeatureConductorRefs.

**Files:** `src/conductor/src/engine/restack/restack-refs-cleanup.ts`, `src/conductor/src/engine/restack/restack-automatic-resolution.ts`, `src/conductor/src/engine/restack/restack-executor.ts`, `src/conductor/src/engine/restack/restack-recovery.ts`, `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-refs-cleanup.ts`
- `src/conductor/src/engine/restack/restack-automatic-resolution.ts`
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`

**Dependencies:** Task 8

### Task 10: Emit typed tier outcomes through existing event persistence
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Extend ConductorEvent with a typed automatic-resolution outcome event carrying eventId, opId, child, original conflict commit, origin tier, disposition and reason, plus available round context inherited from #3653. Assign stable outcome identity from operation, child, conflict and transition; a cross-operation reuse is a distinct outcome with a reference to its source acceptance. Separate rejected candidate events from accepted outcomes. Wire the exhaustive sink registry and existing persister deduplication. For a child with multiple conflicts retain each original conflict identity, not only a final child count.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Implementation constraints:** Register the new type explicitly in observationEventId dedup eligibility and in the occurrence-time handling used by EventPersister, and add its classification and fixture to src/conductor/test/integration/audit-trail-completeness.integration.test.ts. Assert canonical eventId replay is written once and its original occurredAt becomes persisted ts. Preserve existing routing event behavior.

**Done when:**
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given recovery reports an already recorded terminal outcome, when totals are calculated, then that outcome counts once while genuinely distinct provider attempts each remain counted.
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given an invalidated reuse candidate followed by a provider resolution, when totals are calculated, then the rejected candidate is not counted as a completed reused resolution.
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given two distinct conflicts in one child or two operations in one round, when aggregated, then distinct conflict units and provider attempts are not collapsed together.
- [implementation] Extend ConductorEvent with a typed automatic-resolution outcome event carrying eventId, opId, child, original conflict commit, origin tier, disposition and reason, plus available round context inherited from #3653. Assign stable outcome identity from operation, child, conflict and transition; a cross-operation reuse is a distinct outcome with a reference to its source acceptance. Separate rejected candidate events from accepted outcomes. Wire the exhaustive sink registry and existing persister deduplication. For a child with multiple conflicts retain each original conflict identity, not only a final child count.
- [implementation] Register the new type explicitly in observationEventId dedup eligibility and in the occurrence-time handling used by EventPersister, and add its classification and fixture to src/conductor/test/integration/audit-trail-completeness.integration.test.ts. Assert canonical eventId replay is written once and its original occurredAt becomes persisted ts. Preserve existing routing event behavior.

**Files:** `src/conductor/src/engine/restack/restack-events.ts`, `src/conductor/src/engine/restack/restack-executor.ts`, `src/conductor/src/engine/restack/restack-recovery.ts`, `src/conductor/src/engine/event-persister.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/types/events.ts`, `src/conductor/test/engine/restack/restack-tier-report.test.ts`, `src/conductor/test/integration/audit-trail-completeness.integration.test.ts`
**Files likely touched:**
- `src/conductor/test/integration/audit-trail-completeness.integration.test.ts`
- `src/conductor/src/engine/restack/restack-events.ts`
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/src/engine/event-persister.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/src/types/events.ts`
- `src/conductor/test/engine/restack/restack-tier-report.test.ts`

**Dependencies:** Task 6, Task 7

### Task 11: Retain undelivered accepted outcomes across event-write failures
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Store an event-schema outbox with accepted state using the existing authoritative-record/outbox pattern, then drain through the active event persister. Preserve original eventId and occurrence timestamp on retry. Do not erase accepted state when append fails. Before applied-state retirement require its pending outcomes to be acknowledged; cleanup follows existing teardown authority. This task owns failure and resume event delivery, not a new ledger or writer.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Implementation constraints:** Inject append failure after acceptance, restart the persister, redrain the original event, and assert one canonical ledger row with the original eventId and timestamp while retained candidate evidence survives. The active persister owns the write; no second writer is created.

**Done when:**
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given event persistence fails after durable acceptance, when the operation reports failure and later resumes, then it does not erase accepted state, fabricate a successful report, or double-count terminal outcomes.
- [implementation] Store an event-schema outbox with accepted state using the existing authoritative-record/outbox pattern, then drain through the active event persister. Preserve original eventId and occurrence timestamp on retry. Do not erase accepted state when append fails. Before applied-state retirement require its pending outcomes to be acknowledged; cleanup follows existing teardown authority. This task owns failure and resume event delivery, not a new ledger or writer.
- [implementation] Inject append failure after acceptance, restart the persister, redrain the original event, and assert one canonical ledger row with the original eventId and timestamp while retained candidate evidence survives. The active persister owns the write; no second writer is created.

**Files:** `src/conductor/src/engine/restack/restack-automatic-resolution.ts`, `src/conductor/src/engine/restack/restack-events.ts`, `src/conductor/src/engine/restack/restack-executor.ts`, `src/conductor/src/engine/restack/restack-recovery.ts`, `src/conductor/src/engine/event-persister.ts`, `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/restack/restack-automatic-resolution.ts`
- `src/conductor/src/engine/restack/restack-events.ts`
- `src/conductor/src/engine/restack/restack-executor.ts`
- `src/conductor/src/engine/restack/restack-recovery.ts`
- `src/conductor/src/engine/event-persister.ts`
- `src/conductor/test/engine/restack/restack-automatic-resolution.test.ts`

**Dependencies:** Task 10, Task 9

### Task 12: Extend the prerequisite Restack report with tier counts and truthful costs
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write the smallest failing tests for the checks below; use local temporary Git only where object/ref semantics matter and fake all provider/network boundaries.
2. Run scoped RED through `ai-conductor scoped-run` with the affected selectors.
3. Extend #3653 appendRestackSection and its existing event reader. Aggregate accepted outcomes by operation and round and show child/conflict/tier detail; rejected candidates never increment accepted counts. Join provider attempts using explicit operation correlation, keeping distinct attempt identities. Known zero attempts means zero cost; missing cost on an actual attempt means unknown; preserve the existing unattributed row. Do not guess round attribution by time or double-count Restack subtotals in KPI totals. This task owns emitter-to-persister-to-report integration with fake provider events.
4. Run the same scoped GREEN selectors and commit the completed behavior and tests.

**Done when:**
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given deterministic, reused, and strong-resolver outcomes in a routed operation, when reporting reads the persisted event stream, then it groups outcomes by operation and round and identifies child, conflict commit, tier, provider attempts, and recorded cost.
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given recovery reports an already recorded terminal outcome, when totals are calculated, then that outcome counts once while genuinely distinct provider attempts each remain counted.
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given missing cost or historical events without correlation, when reporting aggregates them, then it marks the value unknown or unattributed rather than assigning zero or guessing a round by time.
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given an invalidated reuse candidate followed by a provider resolution, when totals are calculated, then the rejected candidate is not counted as a completed reused resolution.
- [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given two distinct conflicts in one child or two operations in one round, when aggregated, then distinct conflict units and provider attempts are not collapsed together. [implementation] Extend #3653 appendRestackSection and its existing event reader. Aggregate accepted outcomes by operation and round and show child/conflict/tier detail; rejected candidates never increment accepted counts. Join provider attempts using explicit operation correlation, keeping distinct attempt identities. Known zero attempts means zero cost; missing cost on an actual attempt means unknown; preserve the existing unattributed row. Do not guess round attribution by time or double-count Restack subtotals in KPI totals. This task owns emitter-to-persister-to-report integration with fake provider events.

**Files:** `src/conductor/src/engine/shipped-record.ts`, `src/conductor/test/engine/restack/restack-tier-report.test.ts`
**Files likely touched:**
- `src/conductor/src/engine/shipped-record.ts`
- `src/conductor/test/engine/restack/restack-tier-report.test.ts`

**Dependencies:** Task 10, Task 11

## Integration Points

Task 1 owns replay eligibility; Task 6 owns cross-operation reuse; Task 7 owns recovery; Task 8 owns atomic apply; Task 9 owns teardown; Task 11 owns durable event retry; Task 12 owns persisted reporting. No terminal aggregate test task is added.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a replay with multiple conflicts each eligible under the existing halt-record or remediation-block rules, when the child replays, then the rule-defined content survives and no provider is invoked. | 1 | [test] replayChildRange local-Git fixtures prove: Given a replay with multiple conflicts each eligible under the existing halt-record or remediation-block rules, when the child replays, then the rule-defined content survives and no provider is invoked. | diff-local |
| Story 1 happy: Given intentional revert/reapply history and originally empty evidence commits, when prevention selects replay candidates, then their required effects and rewrite correspondences survive. | 2 | [test] replayChildRange local-Git fixtures prove: Given intentional revert/reapply history and originally empty evidence commits, when prevention selects replay candidates, then their required effects and rewrite correspondences survive. | diff-local |
| Story 1 negative: Given eligible bookkeeping conflicts mixed with a source-code conflict, when replay runs, then the unresolved source conflict reaches the configured resolver and no partially resolved child is accepted. | 1 | [test] replayChildRange local-Git fixtures prove: Given eligible bookkeeping conflicts mixed with a source-code conflict, when replay runs, then the unresolved source conflict reaches the configured resolver and no partially resolved child is accepted. | diff-local |
| Story 1 negative: Given conflicting bodies for the same remediation identifier, when deterministic resolution runs, then its existing mismatch refusal remains and stack refs do not move. | 1 | [test] replayChildRange local-Git fixtures prove: Given conflicting bodies for the same remediation identifier, when deterministic resolution runs, then its existing mismatch refusal remains and stack refs do not move. | diff-local |
| Story 1 negative: Given adjacent-line source edits or conflicting memory content without an eligible rule, when replay runs, then neither proximity nor the file path authorizes automatic union. | 1 | [test] replayChildRange local-Git fixtures prove: Given adjacent-line source edits or conflicting memory content without an eligible rule, when replay runs, then neither proximity nor the file path authorizes automatic union. | diff-local |
| Story 2 happy: Given child 2 has a durably accepted automatic resolution and child 3 subsequently halts, when a new operation retries with child 2's exact inputs unchanged, then child 2 retains its accepted tip with zero new resolver calls. | 6 | [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given child 2 has a durably accepted automatic resolution and child 3 subsequently halts, when a new operation retries with child 2's exact inputs unchanged, then child 2 retains its accepted tip with zero new resolver calls. | diff-local |
| Story 2 happy: Given an interrupted operation with an accepted child, when journal recovery resumes, then it uses the same acceptance rules and avoids another resolver invocation for that child. | 7 | [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given an interrupted operation with an accepted child, when journal recovery resumes, then it uses the same acceptance rules and avoids another resolver invocation for that child. | diff-local |
| Story 2 negative: Given a change to the child's range, replay parent, replay policy, validation version, or supplied operator decision, when reuse is attempted, then the old automatic result is not applied and reporting names the invalidating input. | 4 | [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given a change to the child's range, replay parent, replay policy, validation version, or supplied operator decision, when reuse is attempted, then the old automatic result is not applied and reporting names the invalidating input. | diff-local |
| Story 2 negative: Given malformed evidence, missing reachable objects, or evidence from another feature or child, when reuse is attempted, then that evidence cannot authorize acceptance or move stack refs. | 4 | [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given malformed evidence, missing reachable objects, or evidence from another feature or child, when reuse is attempted, then that evidence cannot authorize acceptance or move stack refs. | diff-local |
| Story 2 negative: Given a crash before durable acceptance, when execution resumes, then another provider attempt is allowed and the report does not claim the earlier result was reused. | 6, 7 | [test] runRestack and resumePlanned local-Git fixtures with a fake resolver prove: Given a crash before durable acceptance, when execution resumes, then another provider attempt is allowed and the report does not claim the earlier result was reused. | diff-local |
| Story 3 happy: Given an unresolved source conflict lacking an applicable deterministic rule and eligible for the existing strong resolver, when acceptance checks it, then the configured strong resolver receives the unresolved work within the existing bounded attempt policy. | 5 | [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given an unresolved source conflict lacking an applicable deterministic rule and eligible for the existing strong resolver, when acceptance checks it, then the configured strong resolver receives the unresolved work within the existing bounded attempt policy. | diff-local |
| Story 3 happy: Given all children have accepted candidates and expected refs remain unchanged, when the cascade applies, then refs move atomically and existing invalidation and revalidation requirements still apply. | 8 | [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given all children have accepted candidates and expected refs remain unchanged, when the cascade applies, then refs move atomically and existing invalidation and revalidation requirements still apply. | diff-local |
| Story 3 negative: Given invalid bookkeeping evidence or an owned-path bookkeeping candidate that violates its deterministic rule, when checked, then a validation error is reported, no provider is invoked, and no stack ref moves; ownership alone cannot authorize it. | 5 | [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given invalid bookkeeping evidence or an owned-path bookkeeping candidate that violates its deterministic rule, when checked, then a validation error is reported, no provider is invoked, and no stack ref moves; ownership alone cannot authorize it. | diff-local |
| Story 3 negative: Given an unrelated path edit, invalid rewrite evidence, or a forbidden parent revert, when checked, then the candidate is refused under the applicable existing safeguards. | 5 | [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given an unrelated path edit, invalid rewrite evidence, or a forbidden parent revert, when checked, then the candidate is refused under the applicable existing safeguards. | diff-local |
| Story 3 negative: Given another actor changes an expected ref, when application is attempted, then no subset of the planned ref transaction is applied. | 8 | [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given another actor changes an expected ref, when application is attempted, then no subset of the planned ref transaction is applied. | diff-local |
| Story 3 negative: Given resolver timeout, unavailability, or exhausted attempts, when escalation ends, then an explicit failure outcome is reported without cycling back through shortcuts or claiming a design decision was necessarily required. | 5 | [test] shared acceptance and runRestack boundary fixtures with injected Git/provider failures prove: Given resolver timeout, unavailability, or exhausted attempts, when escalation ends, then an explicit failure outcome is reported without cycling back through shortcuts or claiming a design decision was necessarily required. | diff-local |
| Story 4 happy: Given an accepted automatic result, when its operation aborts on a higher child, then its durable evidence and referenced objects remain reachable for a matching retry. | 3 | [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given an accepted automatic result, when its operation aborts on a higher child, then its durable evidence and referenced objects remain reachable for a matching retry. | diff-local |
| Story 4 happy: Given successful application or existing feature cleanup, when retained evidence is retired, then only the owned automatic-resolution state is retired. | 9 | [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given successful application or existing feature cleanup, when retained evidence is retired, then only the owned automatic-resolution state is retired. | diff-local |
| Story 4 negative: Given disk, permission, or Git persistence failure before durable acceptance, when execution handles the failure, then it does not advertise a reusable result or apply the stack from that unrecorded acceptance. | 3 | [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given disk, permission, or Git persistence failure before durable acceptance, when execution handles the failure, then it does not advertise a reusable result or apply the stack from that unrecorded acceptance. | diff-local |
| Story 4 negative: Given a concurrent replacement of retained evidence, when an older operation attempts to replace or retire it, then the newer evidence survives the expected-value refusal. | 3, 9 | [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given a concurrent replacement of retained evidence, when an older operation attempts to replace or retire it, then the newer evidence survives the expected-value refusal. | diff-local |
| Story 4 negative: Given legacy state without automatic-acceptance evidence, when read, then existing operator-tip behavior remains available but the new automatic shortcut is not inferred. | 9 | [test] automatic-result store and finite cleanup local-Git fixtures with injected write failures prove: Given legacy state without automatic-acceptance evidence, when read, then existing operator-tip behavior remains available but the new automatic shortcut is not inferred. | diff-local |
| Story 5 happy: Given deterministic, reused, and strong-resolver outcomes in a routed operation, when reporting reads the persisted event stream, then it groups outcomes by operation and round and identifies child, conflict commit, tier, provider attempts, and recorded cost. | 12 | [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given deterministic, reused, and strong-resolver outcomes in a routed operation, when reporting reads the persisted event stream, then it groups outcomes by operation and round and identifies child, conflict commit, tier, provider attempts, and recorded cost. | diff-local |
| Story 5 happy: Given recovery reports an already recorded terminal outcome, when totals are calculated, then that outcome counts once while genuinely distinct provider attempts each remain counted. | 10, 12 | [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given recovery reports an already recorded terminal outcome, when totals are calculated, then that outcome counts once while genuinely distinct provider attempts each remain counted. | diff-local |
| Story 5 negative: Given missing cost or historical events without correlation, when reporting aggregates them, then it marks the value unknown or unattributed rather than assigning zero or guessing a round by time. | 12 | [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given missing cost or historical events without correlation, when reporting aggregates them, then it marks the value unknown or unattributed rather than assigning zero or guessing a round by time. | diff-local |
| Story 5 negative: Given an invalidated reuse candidate followed by a provider resolution, when totals are calculated, then the rejected candidate is not counted as a completed reused resolution. | 10, 12 | [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given an invalidated reuse candidate followed by a provider resolution, when totals are calculated, then the rejected candidate is not counted as a completed reused resolution. | diff-local |
| Story 5 negative: Given two distinct conflicts in one child or two operations in one round, when aggregated, then distinct conflict units and provider attempts are not collapsed together. | 10, 12 | [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given two distinct conflicts in one child or two operations in one round, when aggregated, then distinct conflict units and provider attempts are not collapsed together. | diff-local |
| Story 5 negative: Given event persistence fails after durable acceptance, when the operation reports failure and later resumes, then it does not erase accepted state, fabricate a successful report, or double-count terminal outcomes. | 11 | [test] ConductorEventEmitter → EventPersister → appendRestackSection integration fixtures prove: Given event persistence fails after durable acceptance, when the operation reports failure and later resumes, then it does not erase accepted state, fabricate a successful report, or double-count terminal outcomes. | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-15-accepted-restack-resolution-reuse#D1 | task | task-8 | [implementation] Carry accepted tips and exact rewrite maps through the existing journal-to-move transaction. Preserve expected-ref checks, rollback and transition invalidation; do not replace them with a new transaction. This task owns application-boundary proof using runRestack and its existing move/transition seams, covering successful application and a concurrent ref change. |
| adr-2026-11-15-accepted-restack-resolution-reuse#D2 | task | task-5, task-6, task-7 | [implementation] Extract shared candidate acceptance used by executor and recovery. Recheck the deterministic predicate against original inputs and candidate tree, or check matching accepted-result evidence, before existing ownership and exact-rewrite checks. Distinguish accepted, escalate and unavailable/refused results. Do not change strong-resolver FR-8/FR-9 intent safeguards, permit a cheap model, or turn a failed strong attempt back into a shortcut. [implementation] Make the new acceptance module a pure coordinator with injected predicate, ownership and rewrite checks and type-only domain imports, avoiding any new value edge into the existing restack/rebase cycle. Existing executor/recovery modules supply production checks. Carry original conflict commit and paths from Task 1 in the candidate context; only an unresolved eligible source conflict may escalate; invalid bookkeeping evidence returns a validation error before any resolver handoff, so the halt-record driver cannot reapply a rejected rule. An eligible escalate result uses that context to call the existing prepareRestackDecisionDelivery → resolveRestackConflict path explicitly, not a fabricated merge-tree error. Unavailable context is a typed refusal, never acceptance. Refusal events use emitRestackRefused. First-parent Git reads stay behind the injected replay collaborator. |
| adr-2026-11-15-accepted-restack-resolution-reuse#D3 | task | task-1, task-2 | [implementation] Refactor the existing replay conflict-path evaluation into an exhaustive per-path result. Apply existing halt-record and routed remediation-block rules without broadening eligibility; build a candidate tree only when every conflict is covered. Preserve the current mismatch exception and source handoff. [implementation] Preserve the existing replayedMessage commit-tree call and first-parent tree reads in restack-replay.ts. Return original conflict commit and paths with any deterministic candidate so a later predicate rejection retains a real resolver handoff context. |
| adr-2026-11-15-accepted-restack-resolution-reuse#D4 | task | task-3, task-4, task-6, task-7 | [implementation] Add a focused automatic-result record beside the existing conflict-record module. Parse a versioned record with feature/child identity, original range, exact replay-parent SHA, candidate tip/tree, ordered rewrite pairs, replay policy inputs, validation version and operator-decision identity. Pin the candidate commit in a companion ref: a SHA inside JSON does not keep a commit reachable. Atomically write record and pin with expected old OIDs. Keep one accepted record per child. Distinguish absent, invalid and unavailable; never treat an I/O failure as absence. |
| adr-2026-11-15-accepted-restack-resolution-reuse#D5 | task | task-3, task-4, task-7, task-9 | [implementation] Add a focused automatic-result record beside the existing conflict-record module. Parse a versioned record with feature/child identity, original range, exact replay-parent SHA, candidate tip/tree, ordered rewrite pairs, replay policy inputs, validation version and operator-decision identity. Pin the candidate commit in a companion ref: a SHA inside JSON does not keep a commit reachable. Atomically write record and pin with expected old OIDs. Keep one accepted record per child. Distinguish absent, invalid and unavailable; never treat an I/O failure as absence. |
| adr-2026-11-15-accepted-restack-resolution-reuse#D6 | task | task-5 | [implementation] Extract shared candidate acceptance used by executor and recovery. Recheck the deterministic predicate against original inputs and candidate tree, or check matching accepted-result evidence, before existing ownership and exact-rewrite checks. Distinguish accepted, escalate and unavailable/refused results. Do not change strong-resolver FR-8/FR-9 intent safeguards, permit a cheap model, or turn a failed strong attempt back into a shortcut. [implementation] Make the new acceptance module a pure coordinator with injected predicate, ownership and rewrite checks and type-only domain imports, avoiding any new value edge into the existing restack/rebase cycle. Existing executor/recovery modules supply production checks. Carry original conflict commit and paths from Task 1 in the candidate context; only an unresolved eligible source conflict may escalate; invalid bookkeeping evidence returns a validation error before any resolver handoff, so the halt-record driver cannot reapply a rejected rule. An eligible escalate result uses that context to call the existing prepareRestackDecisionDelivery → resolveRestackConflict path explicitly, not a fabricated merge-tree error. Unavailable context is a typed refusal, never acceptance. Refusal events use emitRestackRefused. First-parent Git reads stay behind the injected replay collaborator. |
| adr-2026-11-15-accepted-restack-resolution-reuse#D7 | task | task-10, task-11, task-12 | [implementation] Extend ConductorEvent with a typed automatic-resolution outcome event carrying eventId, opId, child, original conflict commit, origin tier, disposition and reason, plus available round context inherited from #3653. Assign stable outcome identity from operation, child, conflict and transition; a cross-operation reuse is a distinct outcome with a reference to its source acceptance. Separate rejected candidate events from accepted outcomes. Wire the exhaustive sink registry and existing persister deduplication. For a child with multiple conflicts retain each original conflict identity, not only a final child count. |

## Verification ownership

Scoped RED/GREEN belongs to each behavior-owning task. Aggregate tests belong to test_suite. Independent coverage judgement: 27/27 asserts. The plan review owns cross-task contradictions. No implementation is authorized in this composer session.
