# Implementation Plan: PRD and as-built finding continuity

**Date:** 2026-09-30
**Status:** Accepted
**Approval:** Operator approved the 40-task plan and plan-aligned diagrams in chat on 2026-09-30.
**Stories:** .docs/stories/prd-and-as-built-review-retain-finding-history-acr.md
**Design:** .docs/decisions/adr-2026-09-30-gate-local-review-finding-continuity.md
**Conflict check:** Clean after operator-approved corrections on 2026-09-30; .docs/conflicts/prd-and-as-built-review-retain-finding-history-acr.md.

## Summary

Forty tasks implement complete history within each review gate while preserving original authority,
actual repair provenance, existing budgets, and one final effective result. All 89 accepted criteria
have a concrete behavioral proof disposition. This is a technical-track plan with no PRD.

## Technical Approach

Extend RemediationCaseStore to a v3 envelope, preserving build_review and prd_widening alongside
separate PRD/as-built histories. Engine-owned ids identify occurrences; one constrained current
judgment establishes semantic relationships. Original operator authority stays in its existing
owner. Enrollment and current receipt references live in conduct-state through its mutation port.
Legacy import retains attributable facts; only an explicit bound operator choice can acknowledge
a valid legacy coverage gap, and that choice grants no finding approval.

Reuse the local patterns in RemediationCaseStore.mutate (leased read-modify-write and atomic
replacement), coordinatePrdWidening (structured output, immutable source snapshot, case-then-decision
lock order), and StepRunOptions.remediationRequest (nativeSchema/finalStructuredResult). Find their
companion tests by these same stems under src/conductor/test/engine. The new history domains need
an approved v3 extension and per-gate completeness checkpoints because the existing NC-only contract
cannot represent them; copying NC authority rules onto non-NC findings would be incorrect.

New review-history modules separate contract, projection, coordination, evidence, completion,
recovery, and rendering. Exact helper names are implementation choices within those modules.
Serial preparation and group fan-out receive immutable per-member context. Only the serial owner
or group join publishes history; branch retry validation checks raw review output first. Publication
writes a case receipt then a conduct-state reference, with replay recognizing its own revision.
The shared effective reader feeds routing, reuse, objective completion, and the FINISH fence without
provider calls. Repair admission/execution owners supply facts; history does not append work or
charge budgets. Events extend the existing union/emitter/persister.

The inspected base exposes v1/v2 case records, explicit v2 writers in PRD capture/offers/migration/
coordination, StepRunOptions.remediationRequest, and typed as-built projection/clear paths. These
are verified source facts. New review-history files below are proposed implementation locations,
not claims that these modules already exist. Consume a subsequently landed PRD typed contract via
its public adapter; do not implement #2521's parser migration. Cross-gate equivalence and combined
routing remain out of scope. There are no unconfirmed load-bearing environment assumptions.

## Prerequisites and execution discipline

- Accepted stories, approved D1-D12 and approved older-contract amendments, clean conflict report.
- Preserve current #2429 widening authority, #2188 typed as-built behavior, #2753 repair settlement,
  and #1831 repair obligations through their existing seams. No external service is needed.
- Every task uses scoped RED/GREEN via `ai-conductor scoped-run <listed test path>`. The engine's
  test_suite owns aggregate verification; these tasks never launch it or create a terminal catch-all.
- Use parameterized fixtures for related negatives in the same task, retaining every listed failure
  permutation. Integration owners below exercise real internal entry points with fake external
  adapters. Unit fixtures cover internal contracts without duplicating whole-flow acceptance specs.
- For Conductor fixtures, pre-resolve unrelated steps, declare exact expected dispatches, supply
  current evidence for participating validators, terminate at the observed boundary and await cleanup.
  Process/provider boundaries are injected and observed before error/destructive permutations.
- Shared files create scheduler serialization where needed; dependencies state behavioral prerequisites.
  Helpers may be introduced before wiring, but no production path may bypass required-history checks
  once the feature is enabled. The complete implementation lands together.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Durable state and enrollment | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| 2 | Review inputs and semantic authority | 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22 |
| 3 | Publication and actual repair facts | 23, 24, 25, 26, 27, 28, 29, 30 |
| 4 | Effective completion and providers | 31, 32, 33, 34, 35, 36, 37 |
| 5 | Attributable views and recovery | 38, 39, 40 |

## Tasks

### Task 1: Add the v3 history envelope and lossless migration
**Story:** 1 (S1H1, S1H3)
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-store.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-store.test.ts`.
3. Add separate prd_audit and architecture_review_as_built history records to the v3 envelope. Normalize supported v1/v2 under mutate; preserve feature identity, full cases/effects/suppressions/widening provenance. Engine-owned occurrence and case ids include domain ownership. Compare before/after record inventories and reread with a fresh store instance.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): add the v3 history envelope and lossless migration`.

**Done when:**
- The integration fixture `S1H1` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given a feature with supported older history containing build-review cases, effects, suppressions, and PRD widening provenance, when history is upgraded, then every original record and reference remains attributable to the same feature with unchanged authority.
- The integration fixture `S1H3` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given both review gates have a finding with the same report-local label, when their histories are recorded and reread after restart, then their observations remain separate and neither gate inherits the other's relationships or approval.
- The v3 migration reaches the existing leased atomic replacement and retains immutable original observations, subsequent observations, decisions by reference, repair facts, resolution/reopening evidence, and receipts; no second storage path is created.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`, `src/conductor/src/engine/remediation-case-artifact.ts`, `src/conductor/src/engine/review-history-contract.ts`, `src/conductor/test/engine/review-history-store.test.ts`

### Task 2: Preserve v3 in existing domain writers
**Story:** 1 (S1H2)
**Type:** happy-path
**Dependencies:** Tasks 1

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-store.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-store.test.ts`.
3. Replace explicit v2 reconstructions and v2-only selectors in capture, offers, migration, and NC coordination with shared domain-preserving updates. Exercise actual writer entry points against mixed-domain state, including a build-review suppression/effect update; do not merely unit-test object spread.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): preserve v3 in existing domain writers`.

**Done when:**
- The integration fixture `S1H2` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given upgraded history containing both review gates, when a build-review or widening operation updates its own records, then both review histories and all unrelated records remain intact.
- Actual capture, offer, migration, NC relationship, and build-review mutation paths retain both review-history domains and all unrelated records; existing build-review effect/suppression results and NC authority remain unchanged.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`, `src/conductor/src/engine/remediation-case-artifact.ts`, `src/conductor/src/engine/prd-widening-capture.ts`, `src/conductor/src/engine/prd-widening-offers.ts`, `src/conductor/src/engine/prd-widening-migration.ts`, `src/conductor/src/engine/prd-widening-coordinator.ts`, `src/conductor/test/engine/review-history-store.test.ts`

### Task 3: Refuse corrupt state and downgrade writes
**Story:** 1 (S1N1, S1N2)
**Type:** negative-path
**Dependencies:** Tasks 1

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-store.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-store.test.ts`.
3. Validate supported envelope and feature/domain ownership before replacement. Reject a replacement that removes an enrolled v3 domain, even when an older-shape record would otherwise parse. Table-drive malformed/version/foreign/downgrade cases and compare exact original bytes.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): refuse corrupt state and downgrade writes`.

**Done when:**
- The unit fixture `S1N1` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given malformed, unsupported-version, or foreign-feature history, when an upgrade or mutation is requested, then the operation reports the specific defect and leaves the stored bytes unchanged.
- The unit fixture `S1N2` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given an older writer attempts to replace an upgraded envelope without its new histories, when the write reaches validation, then it is refused and none of the histories is lost.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`, `src/conductor/test/engine/review-history-store.test.ts`

### Task 4: Keep upgrade failures recoverable
**Story:** 1 (S1N4)
**Type:** negative-path
**Dependencies:** Tasks 1

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-store.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-store.test.ts`.
3. Use the store filesystem and lease injection seams to fail acquisition and temporary-file replacement. Preserve existing atomic-write cleanup; return typed failure and prove the prior snapshot remains readable. No lease redesign.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): keep upgrade failures recoverable`.

**Done when:**
- The unit fixture `S1N4` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given a lease failure or failed atomic replacement during upgrade, when the operation settles, then the original history is readable and no successful migration or gate completion is claimed.
- The upgrade failure return cannot publish an enrollment/completion reference or report a migrated generation; storage success and checkpoint success remain distinct.

**Files:** `src/conductor/src/engine/remediation-case-store.ts`, `src/conductor/test/engine/review-history-store.test.ts`

### Task 5: Enroll fresh histories and resume initialized state
**Story:** 2 (S2H1, S2H2, S2H3)
**Type:** happy-path
**Dependencies:** Tasks 1, 3, 4

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-entry.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-entry.test.ts`.
3. Add per-gate initialized generation and required-history references to ConductState, its validation, and the mutation port. Prepare history before review dispatch: distinguish genuine first use from existing review evidence, persist store first then checkpoint, recover the matching first-write receipt on restart. Reuse expected-revision/idempotent mutations, never direct conduct-state writes.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): enroll fresh histories and resume initialized state`.

**Done when:**
- The integration fixture `S2H1` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given a feature has never run the gate and has no evidence of earlier review, when the first review begins, then it starts with an explicitly fresh history and establishes that history as required before dispatch.
- The integration fixture `S2H2` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given initialized history was persisted but execution stopped before its enrollment reference was saved, when the feature resumes, then the matching initialized history is recovered without inventing a legacy gap or another initialization.
- The integration fixture `S2H3` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given an enrolled gate has complete matching history after restart, when entry or completion is checked, then the same required-history identity is used and existing current evidence can proceed.

**Files:** `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/types/state.ts`, `src/conductor/src/engine/state.ts`, `src/conductor/src/engine/conduct-state-store.ts`, `src/conductor/src/engine/filesystem-conduct-state-store.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/review-history-entry.test.ts`

### Task 6: Guard lost enrollment at every entry and reader
**Story:** 2 (S2N1, S2N2, S2N3)
**Type:** negative-path
**Dependencies:** Tasks 5

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-entry.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-entry.test.ts`.
3. Implement a common typed required-history guard consumed by entry and effective completion. An enrolled ENOENT is lost history, not the store empty seed. Reject feature/gate/generation mismatch. Inject enrollment failure after successful initialization and preserve its recoverable receipt; use the same guard at retained-result/fence callers.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): guard lost enrollment at every entry and reader`.

**Done when:**
- The integration fixture `S2N1` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given an enrolled gate's history has disappeared, when any entry, completion, retained-result, or final-publication check runs, then it returns a lost-required-history result and cannot pass using an empty history.
- The integration fixture `S2N2` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given an enrollment reference names another feature, gate, or unavailable history generation, when it is read, then the mismatch is reported and neither a provider dispatch nor a success verdict is authorized.
- The integration fixture `S2N3` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given history initialization succeeds but the required enrollment write fails, when the first review is prepared, then the provider is not invoked and the matching initialized history remains recoverable.

**Files:** `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/review-history-entry.test.ts`

### Task 7: Import attributable legacy facts once
**Story:** 3 (S3H1, S3H2, S3N1)
**Type:** happy-path
**Dependencies:** Tasks 1, 5

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-recovery.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-recovery.test.ts`.
3. Inventory existing PRD report/decisions, widening sources, typed as-built recorded fields, pending kickback evidence, and available repair/task records. Derive immutable import keys from original provenance; import attributable facts only. Record incomplete intervals explicitly and route valid-but-incomplete history to a named stop. Missing execution evidence is not a completed attempt.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): import attributable legacy facts once`.

**Done when:**
- The integration fixture `S3H1` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given supported legacy review evidence includes attributable decisions, findings, pending repairs, and recorded outcomes, when it is imported, then all recoverable facts retain their original provenance and repeated import creates no duplicate fact.
- The integration fixture `S3H2` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a valid legacy feature has an unreconstructable earlier interval, when recovery is evaluated, then it stops with legacy-history-incomplete and identifies the missing interval and the known evidence it retained.
- The integration fixture `S3N1` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a legacy source cannot prove whether a repair ran or succeeded, when import runs, then no attempted/completed/resolved fact is invented and the missing provenance remains explicit.

**Files:** `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/review-history-evidence.ts`, `src/conductor/src/engine/prd-widening-migration.ts`, `src/conductor/src/engine/as-built-verdict-store.ts`, `src/conductor/test/engine/review-history-recovery.test.ts`

### Task 8: Bind explicit legacy coverage acknowledgements
**Story:** 3 (S3H3)
**Type:** happy-path
**Dependencies:** Tasks 7

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-recovery.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-recovery.test.ts`.
3. Persist a feature/gate/evidence-digest-bound recovery offer through the conduct-state port. Extend the existing HALT/cleared-choice capture to accept an attributed explicit choice and nonempty rationale; retain the gap permanently and leave all known records/authority intact. Consume the offer once before dispatching from the accepted boundary.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): bind explicit legacy coverage acknowledgements`.

**Done when:**
- The integration fixture `S3H3` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given the engine offered a new coverage boundary for that valid legacy gap, when the attributed operator explicitly selects it with a rationale against the same feature/gate/evidence, then the gap and approval remain visible in subsequent history while review begins from the approved boundary and all known prior records remain.
- The persisted acknowledgement is coverage provenance only, contains the original immutable offer reference and operator attribution, and never writes accepted-widenings or a success verdict.

**Files:** `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/types/state.ts`, `src/conductor/src/engine/conduct-state-store.ts`, `src/conductor/test/engine/review-history-recovery.test.ts`

### Task 9: Reject inert and stale coverage choices
**Story:** 3 (S3N2, S3N3)
**Type:** negative-path
**Dependencies:** Tasks 8

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-recovery.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-recovery.test.ts`.
3. Table-drive untouched clears, missing rationale/operator, altered offer reference, evidence/feature/gate change, and exact replay. Capture against the original stored offer rather than the current rendered halt. Return a named recovery state; replay of a consumed identical choice adds no record.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): reject inert and stale coverage choices`.

**Done when:**
- The unit fixture `S3N2` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a recovery halt was cleared without an explicit choice, rationale, or attributable operator, when recovery resumes, then no coverage-boundary approval is recorded and the gap still blocks.
- The unit fixture `S3N3` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given the offer's evidence, feature, gate, or immutable reference changed, when an earlier choice is replayed, then it cannot authorize the changed boundary; replay of an already-applied unchanged choice is inert.

**Files:** `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/test/engine/review-history-recovery.test.ts`

### Task 10: Prevent baseline acknowledgements from granting authority
**Story:** 3 (S3N4, S3N5)
**Type:** negative-path
**Dependencies:** Tasks 8

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-recovery.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-recovery.test.ts`.
3. Gate coverage-start offers on validated legacy state and known incompleteness only. Exclude lost enrolled, corrupt, and foreign state. Feed refusal/current-blocker fixtures through effective completion after acknowledgement; never erase damaged bytes or manufacture restored evidence.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): prevent baseline acknowledgements from granting authority`.

**Done when:**
- The unit fixture `S3N4` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given corrupt, foreign, or previously enrolled lost history, when a coverage-boundary choice is supplied, then that path is refused and restoration remains required.
- The unit fixture `S3N5` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a valid boundary acknowledgement coexists with a refused widening or current blocking finding, when completion is checked, then the acknowledgement does not accept that finding, erase the refusal, or pass the gate.

**Files:** `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/test/engine/review-history-recovery.test.ts`

### Task 11: Thread immutable complete history into both review shapes
**Story:** 4 (S4H1, S4H2, S4H3, S4N3)
**Type:** happy-path
**Dependencies:** Tasks 5, 7

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-projection.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-projection.test.ts`.
3. Build immutable per-gate history after original PRD decision capture. Thread it through StepRunOptions and group-core member options into step-runners and the as-built input projection. Preserve all open/resolved/absent/uncertain/reopened records and provenance. Extend the two existing review skills with judgment-only use of supplied history; schemas and file recipes stay engine-owned. Capture production dispatch inputs with fake runners, then terminate at that boundary.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): thread immutable complete history into both review shapes`.

**Done when:**
- The integration fixture `S4H1` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given a gate has open, resolved, absent, uncertain, and reopened cases, when its next review is dispatched, then its input includes each case with original/current evidence, applicable decision references, repair facts, resolution evidence, and any acknowledged legacy gap.
- The integration fixture `S4H2` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given equivalent feature state is reviewed serially or in a concurrent validation group, when the reviewers are dispatched, then each receives the same gate-local history content and authority for the same evidence snapshot.
- The integration fixture `S4H3` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given both gates run concurrently, when one gate's history differs from the other's, then each input remains attributable to its intended member with no transfer of sibling-only case authority.
- The integration fixture `S4N3` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given a sibling gate changes after one member's immutable input was prepared, when that member is dispatched, then it receives its own prepared history and never the sibling's replacement context.

**Files:** `src/conductor/src/engine/review-history-projection.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/group-core.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/as-built-projection.ts`, `skills/prd-audit/SKILL.md`, `skills/architecture-review/SKILL.md`, `src/conductor/test/engine/review-history-projection.test.ts`

### Task 12: Enforce complete history limits without trimming
**Story:** 4 (S4H4, S4N2)
**Type:** happy-path
**Dependencies:** Tasks 11

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-projection.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-projection.test.ts`.
3. Count UTF-8 bytes and all nested decisions/attempts/evidence in the serialized projection. Constants: 512 current sources/gate,128 cases/gate,512 observations/case,64 references/source or resolution,256 bytes/identifier,8000 bytes/prose field,512 KiB history/reconciliation input. Keep existing PRD/as-built contract bounds independently. Test exact-boundary and boundary-plus-one values, including multibyte text.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): enforce complete history limits without trimming`.

**Done when:**
- The unit fixture `S4H4` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given inputs fit all approved history limits, including values exactly at an individual boundary while other dimensions fit, when prepared, then they are retained completely; the gate's pre-existing input requirements remain enforced.
- The unit fixture `S4N2` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given any approved count or byte bound is exceeded, when input is prepared, then the result names the dimension, actual value, and limit and preserves the untrimmed stored history without a provider call.
- The projection tests enforce exactly these limits without trimming: 512 current sources per gate, 128 cases per gate, 512 observations per case, 64 evidence references per source/resolution, 256 UTF-8 bytes per identifier/reference, 8000 bytes per prose field, and 512 KiB total serialized history/reconciliation input; decisions, attempts, and evidence count toward the total and prior review-contract limits remain independently enforced.

**Files:** `src/conductor/src/engine/review-history-contract.ts`, `src/conductor/src/engine/review-history-projection.ts`, `src/conductor/test/engine/review-history-projection.test.ts`

### Task 13: Stop projection on missing evidence or capture failure
**Story:** 4 (S4N1, S4N4)
**Type:** negative-path
**Dependencies:** Tasks 11

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-projection.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-projection.test.ts`.
3. Propagate typed evidence-read and original-decision-capture failures before projection dispatch. Reuse existing capture ordering; no fallback projection with empty authority. Inject unreadable original evidence/ADR reference and failed PRD capture; observe zero provider invocations.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): stop projection on missing evidence or capture failure`.

**Done when:**
- The integration fixture `S4N1` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given required original evidence or governing references cannot be read, when a history projection is prepared, then the affected gate and evidence are named and no incomplete projection is dispatched.
- The integration fixture `S4N4` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given PRD decision capture fails before review, when general history preparation is attempted, then the failure remains blocking and an input without the required original authority is not substituted.

**Files:** `src/conductor/src/engine/review-history-projection.ts`, `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/review-history-projection.test.ts`

### Task 14: Collect complete source sets and coordinate initial histories
**Story:** 5 (S5H1, S5H2, S5H3, S5H4)
**Type:** happy-path
**Dependencies:** Tasks 1, 11, 12, 13

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Introduce engine-owned occurrence snapshots for all non-PASS PRD rows/NC sources and BLOCKED/PLAN_GAP/drift as-built fields. Successful/PASS/reachability evidence is context. Assign source ids independently of semantic case ids. For known-empty history record explicit initial observations without a model call; otherwise dispatch one general-history reconciliation and validate source/prior coverage before publication. Multiple current sources may bind one existing case without replacing originals.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): collect complete source sets and coordinate initial histories`.

**Done when:**
- The integration fixture `S5H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a review contains criterion failures and NC findings, or as-built BLOCKED findings, PLAN_GAP findings, and nonblocking drift notes, when reconciliation is published, then every current finding has exactly one traceable result and every supplied prior case has an accounted-for outcome.
- The integration fixture `S5H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given two current observations describe the same retained case, when a valid relationship judgment relates them, then both source observations remain individually traceable to that case without replacing the original evidence.
- The integration fixture `S5H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a known fresh history has no prior obligations, when current observations are recorded, then the engine establishes the explicit initial history without paying for an unnecessary semantic comparison; PASS evidence creates no fabricated defect.
- The integration fixture `S5H4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a changed non-NC source has relevant prior history, when reconciliation judges it, then it records new-case, same-case, or uncertain with reasons and supplied evidence references, and new durable identities remain engine-owned.

**Files:** `src/conductor/src/engine/review-history-contract.ts`, `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/as-built-verdict-store.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 15: Reject incomplete and foreign relationship sets
**Story:** 5 (S5N1, S5N2)
**Type:** negative-path
**Dependencies:** Tasks 14

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-contract.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-contract.test.ts`.
3. Define the closed general-history output schema and engine validation: exact current/prior id coverage, unique source outcomes, allowed gate/feature memberships, and supplied evidence-reference membership. Return specific coverage/reference diagnostics before any authoritative batch write.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): reject incomplete and foreign relationship sets`.

**Done when:**
- The unit fixture `S5N1` in `src/conductor/test/engine/review-history-contract.test.ts` exercises the engine-owned review-history contract validator: Given a result omits or duplicates a current source or prior case, when validation runs, then publication is rejected with the coverage defect and no partial batch becomes effective.
- The unit fixture `S5N2` in `src/conductor/test/engine/review-history-contract.test.ts` exercises the engine-owned review-history contract validator: Given a result cites an unknown, foreign-feature, sibling-gate, or unsupported evidence reference, when validation runs, then the result is rejected without linking the source to that record.
- The engine-owned closed output contract admits only new-case, same-case, or uncertain current-source relationships; same-case assertion outcomes are upheld, resolved-by-current-evidence, or uncertain, and prior-case outcomes are still-reported, resolved, not-observed, or uncertain, with supplied-reference checks and exact coverage before publication.

**Files:** `src/conductor/src/engine/review-history-contract.ts`, `src/conductor/test/engine/review-history-contract.test.ts`

### Task 16: Reject contradictory outcomes and model-authored authority
**Story:** 1 (S1N3)
**Story:** 5 (S5N3)
**Type:** negative-path
**Dependencies:** Tasks 15

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-contract.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-contract.test.ts`.
3. Validate source/case transition consistency and reject provider keys for durable ids, operator decisions, or sibling relationships. The model may cite engine-supplied case/source ids, never mint them. New identities are assigned only after a validated new-case result.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): reject contradictory outcomes and model-authored authority`.

**Done when:**
- The unit fixture `S1N3` in `src/conductor/test/engine/review-history-contract.test.ts` exercises the engine-owned review-history contract validator: Given a model attempts to supply an original operator decision, durable identifier, or another gate's relationship, when its result is consumed, then those unauthorized fields/references are rejected without altering authority.
- The unit fixture `S5N3` in `src/conductor/test/engine/review-history-contract.test.ts` exercises the engine-owned review-history contract validator: Given source-level and case-level outcomes contradict one another, when they are validated, then the contradiction is reported and cannot become effective history.

**Files:** `src/conductor/src/engine/review-history-contract.ts`, `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/test/engine/review-history-contract.test.ts`

### Task 17: Require both PRD reconciliation partitions
**Story:** 5 (S5N4)
**Type:** negative-path
**Dependencies:** Tasks 14, 15, 16

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Treat validated NC-owner output and general-history output as separate required partitions of one complete PRD source set. Persist no effective complete PRD batch while NC fails or is unaccounted for; retain independently durable original NC decisions. Do not call a second NC semantic judge.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): require both prd reconciliation partitions`.

**Done when:**
- The integration fixture `S5N4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the existing NC reconciliation partition fails or remains unaccounted for while general PRD reconciliation succeeds, when the PRD batch is assembled, then no complete PRD result or clean completion is claimed.
- The coordinator reports the incomplete NC partition and leaves PRD final satisfaction false even when every general-history source has a valid outcome.

**Files:** `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/prd-widening-coordinator.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 18: Record current resolution, recurrence, and non-observation
**Story:** 6 (S6H1, S6H2, S6H3, S6H4)
**Type:** happy-path
**Dependencies:** Tasks 14, 15, 16

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Implement explicit same-case assertion outcomes and prior-case outcomes. Resolution retains current criterion/clause evidence and reason; reopening retains a material reason plus former resolution. Absent findings become not-observed unless current evidence supports resolution. Historical text, ordinal, or hash is not a semantic matcher. Extend remediate judgment guidance to demand assertion-by-assertion supplied evidence.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): record current resolution, recurrence, and non-observation`.

**Done when:**
- The unit fixture `S6H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an earlier resolved finding reappears with changed wording, order, or report-local label and unchanged underlying facts, when current evidence supports the same case and its resolution, then the repeat remains attached to that case and does not create a new unresolved obligation.
- The unit fixture `S6H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a previously resolved defect materially recurs or changes, when current evidence establishes recurrence, then the case reopens with the reason and evidence retained alongside its prior resolution.
- The unit fixture `S6H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an earlier finding is absent and current evidence establishes that its criterion or approved clause is satisfied, when reconciliation records resolution, then that evidence and the current judgment are retained without deleting the original finding.
- The unit fixture `S6H4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an earlier finding is absent but current evidence cannot establish resolution, when its history is reconciled, then it is recorded as not-observed and its prior resolution/refusal evidence remains intact.

**Files:** `src/conductor/src/engine/review-history-contract.ts`, `src/conductor/src/engine/review-history-coordinator.ts`, `skills/remediate/SKILL.md`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 19: Reject unsupported resolution and reopening
**Story:** 6 (S6N1, S6N2, S6N3, S6N4)
**Type:** negative-path
**Dependencies:** Tasks 18

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Validate resolution evidence against current supplied facts, not prior dismissal, another gate, matching prose, or task status alone. Unsupported reopening stays unresolved. Persist an uncertain successful judgment for unchanged-input reuse, preserving the uncertainty rather than retrying for a different answer.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): reject unsupported resolution and reopening`.

**Done when:**
- The unit fixture `S6N1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given only an earlier autonomous dismissal, another gate's approval, or a matching summary supports a proposed resolution, when the result is checked, then it cannot clear the current finding.
- The unit fixture `S6N2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a proposed reopening cites only changed wording, ordering, or labels without material current evidence, when it is checked, then it cannot create a justified reopened obligation; the unsupported judgment remains unresolved.
- The unit fixture `S6N3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a repair task is merely admitted, started, or marked complete without current criterion/clause evidence, when resolution is proposed, then it is not accepted as a verified repair.
- The unit fixture `S6N4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the available evidence cannot distinguish same-case from a different defect, when judgment returns uncertainty, then the affected source remains explicitly unresolved and the engine does not repeatedly ask for a more favorable answer on identical input.

**Files:** `src/conductor/src/engine/review-history-contract.ts`, `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 20: Adapt existing authority without rematching NC decisions
**Story:** 7 (S7H1, S7H2, S7H3)
**Type:** happy-path
**Dependencies:** Tasks 17, 18

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Integrate coordinatePrdWidening validated bindings into full PRD history. Retain original case/decision references and criterion-scoped authority; keep DESIGN with its governing decision owner. Exercise actual NC coordinator/classification entry seams with a fake general-history judge, asserting zero second semantic judgment of NC sources.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): adapt existing authority without rematching nc decisions`.

**Done when:**
- The integration fixture `S7H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an accepted or refused NC widening has a fresh relationship established by its existing authority owner, when complete PRD history is published, then that same relationship and original decision scope govern its current classification without a second semantic override.
- The integration fixture `S7H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a story-criterion decision applies to one criterion, when nearby findings are reconciled, then the decision remains scoped to its original criterion and unrelated criteria retain their own grades.
- The integration fixture `S7H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an as-built finding requires an unapproved architectural decision, when its history is reconciled, then it remains a human decision under the governing ADR/plan authority even when another gate approved related work.

**Files:** `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/prd-widening-coordinator.ts`, `src/conductor/src/engine/prd-widening-classification.ts`, `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 21: Reject NC overrides and replayed reversals
**Story:** 7 (S7N1, S7N2)
**Type:** negative-path
**Dependencies:** Tasks 20

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Validate the adapted NC partition against the latest original decision revision and binding. Reject a general-history result that contradicts/broadens it. Replay older acceptances, unedited clears, and coverage-start acknowledgements after refusal; none changes authority.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): reject nc overrides and replayed reversals`.

**Done when:**
- The unit fixture `S7N1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given general-history judgment contradicts or broadens a validated NC binding, when the complete result is assembled, then it is rejected and the original widening authority is retained.
- The unit fixture `S7N2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the latest operator revision refuses a widening, when an older acceptance, ordinary cleared halt, or legacy coverage acknowledgement is replayed, then it cannot supersede that refusal.

**Files:** `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 22: Refuse unauthorized architectural conversions
**Story:** 7 (S7N3)
**Type:** negative-path
**Dependencies:** Tasks 18, 20

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-completion.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-completion.test.ts`.
3. Keep raw DESIGN classification and governing approval requirements when history alone proposes REMEDIABLE or an unapproved choice. Return unresolved human-owned evidence, never a new BUILD route. This guard is separate from valid current evidence showing the repeated defect no longer exists.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): refuse unauthorized architectural conversions`.

**Done when:**
- The unit fixture `S7N3` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a result converts DESIGN to REMEDIABLE or grants a missing architectural choice solely from prior history, when effective classification is evaluated, then that conversion is refused and no unauthorized repair route is created.
- A fake routing consumer observes no admitted repair for a history-only DESIGN conversion; approved current-evidence resolutions remain scoped to their exact assertion.

**Files:** `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/test/engine/review-history-completion.test.ts`

### Task 23: Publish atomic batches and recover the checkpoint window
**Story:** 8 (S8H1, S8H2)
**Type:** happy-path
**Dependencies:** Tasks 5, 14, 18, 20

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Under case-store mutate recheck the frozen relevant snapshot, then atomically write observations, transitions, and a receipt with pre-judgment and post-publication revisions. Release the case lease before conduct-state checkpoint mutation; preserve case-then-decision lock order when sampling NC revision. Recover matching published receipt after restart without judging or applying effects again.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): publish atomic batches and recover the checkpoint window`.

**Done when:**
- The integration fixture `S8H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a reconciliation batch is published against a frozen gate input, when the same input is encountered again, then the stored result is reused without another judgment, duplicated observation, or repeated effect.
- The integration fixture `S8H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the process stops after history publication but before its completion reference is recorded, when it resumes, then the matching receipt completes that reference and keeps the same judgment and case identities.
- Publication holds no lease across a provider call; the receipt recognizes its own post-publication revision and cannot invalidate itself merely because its batch appended history.

**Files:** `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/types/state.ts`, `src/conductor/src/engine/conduct-state-store.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 24: Preserve unrelated and valid sibling history at join
**Story:** 8 (S8H3, S8H4)
**Type:** happy-path
**Dependencies:** Tasks 23

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Key freshness/revision checks to the affected gate and relevant decisions, not the entire shared envelope. At the single-writer validation join publish valid available history even if another member has no verdict; preserve failed-member status and its normal error. Use barriers instead of sleeps for interleaving fixtures.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): preserve unrelated and valid sibling history at join`.

**Done when:**
- The integration fixture `S8H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given another gate publishes an unrelated history update, when this gate checks its unchanged relevant snapshot, then the unrelated update neither erases records nor invalidates its usable judgment.
- The integration fixture `S8H4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given one concurrent member supplies valid current history while a sibling fails to produce a verdict, when the join settles, then valid sibling history is retained and the failed sibling is not marked satisfied.

**Files:** `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 25: Refuse stale publication against every relevant input
**Story:** 8 (S8N1)
**Type:** negative-path
**Dependencies:** Tasks 23

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Freeze source/code/diff, governing artifact identities, operator revision, repair evidence, contract version, and gate-local history revision before judging. Mutate each dimension in a table-driven test before publication and re-read under the existing lock discipline; reject without overwriting newer authority.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): refuse stale publication against every relevant input`.

**Done when:**
- The unit fixture `S8N1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given source evidence, code, governing artifacts, operator revision, repair evidence, or the relevant contract changes during judgment, when publication rechecks its snapshot, then stale output is refused and prior authority is not overwritten.
- The freshness comparator excludes unrelated sibling history while covering every governing input; matching ids or unchanged summaries cannot authorize stale output.

**Files:** `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/review-history-projection.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 26: Keep failed publications and invalidated receipts non-publishable
**Story:** 8 (S8N2, S8N3, S8N4)
**Type:** negative-path
**Dependencies:** Tasks 23, 25

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Inject case replacement and completion-reference failures independently. Distinguish missing/mismatched receipt from a recoverable matching write. Hook existing rebase/invalidation eligibility into receipt consumption without deleting history; raw review invalidation cannot be overridden by retained cases.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): keep failed publications and invalidated receipts non-publishable`.

**Done when:**
- The integration fixture `S8N2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given history replacement or the completion-reference write fails, when execution stops, then no incomplete batch qualifies a gate and the recoverable persisted state identifies which publication step remains incomplete.
- The integration fixture `S8N3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a current reference names a missing or mismatched receipt, when reuse is attempted, then no success is granted and the named inconsistency remains recoverable.
- The integration fixture `S8N4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given rebase or normal invalidation makes current review evidence unusable, when reuse is considered, then its existing authority rules prevent reuse while the historical cases remain available for fresh review.

**Files:** `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 27: Import actual admission receipts idempotently
**Story:** 9 (S9H1, S9H4, S9N1)
**Type:** happy-path
**Dependencies:** Tasks 1, 14, 20

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-evidence.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-evidence.test.ts`.
3. At existing planRemediation admission and repair-obligation transitions bind exact canonical tasks and durable repair/admission identity to source/case. Import that owner receipt into history after admission. On import failure replay the existing receipt, never rerun append or settlement; unsupported legacy binding stops explicitly. Cover appended and existing-task admissions.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): import actual admission receipts idempotently`.

**Done when:**
- The integration fixture `S9H1` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given an existing repair path admits appended or existing tasks for a finding, when admission is recorded, then history binds the exact admitted tasks and repair identity to that finding without independently appending work.
- The integration fixture `S9H4` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given repair admission was durable but history import failed, when the feature resumes, then the existing admission is imported once without another task append, budget charge, or invented repair execution.
- The integration fixture `S9N1` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given append/admission fails or its binding cannot be proven, when repair history is assembled, then no successful admission is invented and the missing binding produces a named recoverable result.

**Files:** `src/conductor/src/engine/review-history-evidence.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/repair-obligations.ts`, `src/conductor/src/engine/remediation-append.ts`, `src/conductor/src/engine/kickback-ledger.ts`, `src/conductor/test/engine/review-history-evidence.test.ts`

### Task 28: Retain actual execution states and unexecuted admissions
**Story:** 9 (S9H2, S9N2)
**Type:** happy-path
**Dependencies:** Tasks 27

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-evidence.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-evidence.test.ts`.
3. Observe existing BUILD work-order/repair obligation execution and task-close outcomes with durable identity. Record admitted, started, completed, failed, interrupted distinctly; a cap stop before dispatch remains unexecuted. Consume actual engine/task-close evidence and do not infer success from task existence or event timing.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): retain actual execution states and unexecuted admissions`.

**Done when:**
- The integration fixture `S9H2` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given that repair starts and later completes, fails, or is interrupted, when the responsible execution transition records its evidence, then history distinguishes those actual states and retains them for the next review.
- The integration fixture `S9N2` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given an admitted task never dispatched because an existing cap stopped BUILD, when the next history is read, then it remains admitted/unexecuted and cannot be presented as completed or resolved.

**Files:** `src/conductor/src/engine/review-history-evidence.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/repair-obligations.ts`, `src/conductor/src/engine/work-order.ts`, `src/conductor/test/engine/review-history-evidence.test.ts`

### Task 29: Retain pending findings before clearing or replacement
**Story:** 9 (S9H3, S9N3)
**Type:** happy-path
**Dependencies:** Tasks 27, 28

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-evidence.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-evidence.test.ts`.
3. Place the durable-history retention before projectPendingAsBuiltRemediationFindings clears the ledger and before later verdict replacement can discard its projection. Reuse the pending ledger accessor and typed verdict store. On retention failure leave the pending evidence intact and surface the exact write fault.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): retain pending findings before clearing or replacement`.

**Done when:**
- The integration fixture `S9H3` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given successful as-built review projects pending repair findings into its current verdict, when pending evidence is cleared or a later verdict replaces it, then attributable finding, attempt, and outcome facts remain available from durable history.
- The integration fixture `S9N3` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given history cannot retain pending finding/outcome evidence, when clearing or replacement would occur, then the required pending evidence is kept and the persistence failure blocks that transition.

**Files:** `src/conductor/src/engine/review-history-evidence.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/as-built-verdict-store.ts`, `src/conductor/src/engine/kickback-ledger.ts`, `src/conductor/test/engine/review-history-evidence.test.ts`

### Task 30: Supply repair history without acquiring routing authority
**Story:** 9 (S9N4)
**Type:** negative-path
**Dependencies:** Tasks 27, 28

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-evidence.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-evidence.test.ts`.
3. Pass retained attempts as immutable context to the existing remediation planner. Keep the history module effect-free: planner dispositions, admission, consolidated manual_test routing, lap settlement, and growth remain their existing owners. Exercise repeat-case input with spy appender/ledger adapters and compare before/after budgets.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): supply repair history without acquiring routing authority`.

**Done when:**
- The unit fixture `S9N4` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given a matched case already has recorded attempts, when history is supplied to remediation, then history itself neither appends tasks nor changes planner dispositions, kickback caps, plan-growth accounting, or combined routing policy.
- The history projection exposes actual prior attempt outcomes to the existing planner but makes zero append/restage/charge calls; existing unresolved-remedy routing still applies outside this projection.

**Files:** `src/conductor/src/engine/review-history-evidence.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/review-history-evidence.test.ts`

### Task 31: Derive exact-source effective grades and delivery
**Story:** 10 (S10H2, S10H3, S10N2, S10N3)
**Type:** happy-path
**Dependencies:** Tasks 18, 19, 20, 21, 22, 23

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-completion.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-completion.test.ts`.
3. Derive effective judgment from valid raw review plus current validated receipt. Resolve only the matched assertion with evidence of current criterion satisfaction or explicit delivered PLAN_GAP outcome. Revalidate the gate vocabulary/completeness and retain unrelated failures, unexplained violations, and raw parser faults. No text equality or historical status shortcut.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): derive exact-source effective grades and delivery`.

**Done when:**
- The unit fixture `S10H2` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a repeated criterion failure is resolved by evidence of that exact criterion's current satisfaction, when the effective result is derived, then that source can clear while unrelated grades remain unchanged.
- The unit fixture `S10H3` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a repeated as-built PLAN_GAP is resolved with explicit evidence that its affected outcome is currently delivered, when the effective result is validated, then existing delivery and gate rules apply to that outcome rather than a guessed success.
- The unit fixture `S10N2` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given one resolved source coexists with an unrelated criterion failure, unexplained violation, or parser/completeness fault, when effective classification runs, then the unrelated failure remains and prevents any success it previously blocked.
- The unit fixture `S10N3` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given an as-built outcome is claimed delivered without current evidence, when resolution would clear a PLAN_GAP, then that resolution is rejected and the original delivery failure remains.

**Files:** `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/src/engine/prd-widening-classification.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/review-history-completion.test.ts`

### Task 32: Use one effective reader at all final boundaries
**Story:** 10 (S10H1, S10N1, S10N4)
**Type:** happy-path
**Dependencies:** Tasks 6, 10, 26, 31

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-completion.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-completion.test.ts`.
3. Wire shared effective evidence through artifact predicates, gate verdict computation, serial routing, validation join/retained-sibling checks and the current-HEAD FINISH fence. Preserve existing raw code/run validity checks. Feed the same fixture matrix through the minimum production reader entry points and assert equal classification/source trace; inject a provider spy to prove reads never judge.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): use one effective reader at all final boundaries`.

**Done when:**
- The integration fixture `S10H1` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given raw review and current validated reconciliation jointly establish satisfaction, when serial routing, group completion, retained-sibling reuse, or final publication is evaluated, then each uses the same effective classification and source trace.
- The integration fixture `S10N1` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given raw reviewer success coexists with pending, corrupt, missing, stale, or uncertain required history, when any completion boundary runs, then the gate cannot pass and the specific history condition is returned.
- The integration fixture `S10N4` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given the history result is unavailable at a completion reader, when completion is queried repeatedly, then the reader reports its state without invoking a provider, matching prose, or turning absence into a pass.

**Files:** `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/gate-verdicts.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/review-history-completion.test.ts`

### Task 33: Let raw-valid branches reach join-owned reconciliation
**Story:** 10 (S10H4)
**Type:** happy-path
**Dependencies:** Tasks 24, 32

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-completion.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-completion.test.ts`.
3. Separate review-artifact validity from final history-qualified completion in runGroupBranch dependencies. A raw-valid review returns to the join once; join invokes the coordinator, then computes the objective verdict. Preserve malformed-provider retries and other member completion semantics. Bound the production group fixture at join settlement, with valid participating evidence and fake providers.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): let raw-valid branches reach join-owned reconciliation`.

**Done when:**
- The integration fixture `S10H4` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a concurrent branch has valid reviewer output but awaits join-owned reconciliation, when branch validation finishes, then it reaches the join without retrying solely because final history publication has not yet occurred.
- The branch/join fixture has exactly one raw review invocation and one current reconciliation, no retry solely for a not-yet-published receipt, and no satisfied gate before the final validated receipt/checkpoint is available.

**Files:** `src/conductor/src/engine/group-core.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/test/engine/review-history-completion.test.ts`

### Task 34: Persist bounded reconciliation attempts and reuse outcomes
**Story:** 11 (S11H2, S11H3, S11N4, S11N5)
**Type:** happy-path
**Dependencies:** Tasks 23, 26

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-coordinator.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-coordinator.test.ts`.
3. Persist consumed terminal mechanical attempts per frozen gate/input in the existing history domain. Use the resolved remediate allowance and original provider category. Commit attempt outcome before retry/stop; same input after restart resumes remaining allowance. Reuse both successful and uncertain receipts. Authentication/rate-limit/availability precedence remains in provider handling; a wait or skipped candidate is not a consumed judging attempt.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): persist bounded reconciliation attempts and reuse outcomes`.

**Done when:**
- The unit fixture `S11H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the configured reconciliation allowance is two attempts and one mechanical attempt failed before restart, when the resumed second attempt fails, then the same gate/input reaches exhaustion without resetting the allowance or charging BUILD/plan growth.
- The unit fixture `S11H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a successful or uncertain result already exists for unchanged frozen input, when either provider would otherwise be invoked again, then the recorded result is reused and no additional semantic opinion is requested.
- The unit fixture `S11N4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given repeated mechanical failures exhaust the configured allowance, when execution settles, then a named recovery stop preserves prior history and no successful relationship or repair is manufactured.
- The unit fixture `S11N5` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the provider times out or becomes unavailable during reconciliation, when the attempt settles, then that failure category and spent attempt survive restart while prior authority is preserved and no partial relationship is accepted.

**Files:** `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/review-history-contract.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/review-history-coordinator.test.ts`

### Task 35: Dispatch the new mode through both native-schema adapters
**Story:** 11 (S11H1)
**Type:** happy-path
**Dependencies:** Tasks 14, 15, 16, 34

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-provider.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-provider.test.ts`.
3. Extend StepRunOptions.remediationRequest with review-history-reconciliation using the same projection/nativeSchema path as prd-widening-reconciliation. Use finalStructuredResult only. Run production StepRunner and actual Claude/Codex argument/result adapters against fake process boundaries, inspect schema args/files and scratch cleanup, and return equivalent structured judgments. Never spawn either CLI.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): dispatch the new mode through both native-schema adapters`.

**Done when:**
- The integration fixture `S11H1` in `src/conductor/test/engine/review-history-provider.test.ts` exercises the existing remediate native-schema provider dispatch: Given equivalent Claude and Codex adapter fixtures return the same valid structured reconciliation, when invoked through the production provider path, then both receive the engine-owned contract and produce equivalent history results apart from engine run identity.
- The new mode uses one existing provider invoke member, engine-owned nativeSchema, invocation-local scratch, and engine-stamped identity; the prompt shape is derived from the same schema passed to both adapters.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/execution/claude-provider.ts`, `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/engine/review-history-provider.test.ts`

### Task 36: Refuse missing structured-output capability
**Story:** 11 (S11N1)
**Type:** negative-path
**Dependencies:** Tasks 35

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-provider.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-provider.test.ts`.
3. Gate the selected reconciliation candidate with the existing nativeOutputSchema capability seam. Return provider and missing capability in the existing typed failure/recovery channel; do not fall back to unconstrained prose. Prove the fake process boundary is not reached by the refused candidate.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): refuse missing structured-output capability`.

**Done when:**
- The unit fixture `S11N1` in `src/conductor/test/engine/review-history-provider.test.ts` exercises the existing remediate native-schema provider dispatch: Given the selected provider cannot enforce the required native output contract, when dispatch is prepared, then it is refused with the provider and missing capability named and no unconstrained fallback result is accepted.
- Unsupported-candidate handling preserves the configured provider selection/fallback policy and cannot turn an unconstrained candidate result into an accepted relationship.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/test/engine/review-history-provider.test.ts`

### Task 37: Preserve output-failure and provider-category precedence
**Story:** 11 (S11N2, S11N3)
**Type:** negative-path
**Dependencies:** Tasks 34, 35

**Steps:**
1. Add a failing unit fixture in `src/conductor/test/engine/review-history-provider.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-provider.test.ts`.
3. Reuse current terminal result extraction and hasRecoveryPrecedence handling. Table-drive missing/malformed terminal result with plausible prose, authentication failure, rate-limit wait, and unavailable candidate. Mechanical schema faults enter durable attempt handling; provider categories retain their existing handling and never become content findings.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): preserve output-failure and provider-category precedence`.

**Done when:**
- The unit fixture `S11N2` in `src/conductor/test/engine/review-history-provider.test.ts` exercises the existing remediate native-schema provider dispatch: Given terminal structured output is missing or malformed but prose contains a plausible result, when it is consumed, then the attempt is a mechanical failure and prose is not parsed as successful reconciliation.
- The unit fixture `S11N3` in `src/conductor/test/engine/review-history-provider.test.ts` exercises the existing remediate native-schema provider dispatch: Given authentication, rate-limit, or provider availability handling applies, when an incomplete result is received, then the original provider category retains precedence rather than being relabeled as a finding or ordinary schema error.

**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/test/engine/review-history-provider.test.ts`

### Task 38: Render source-case history without granting text authority
**Story:** 12 (S12H1, S12N2)
**Type:** happy-path
**Dependencies:** Tasks 29, 32

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-rendering.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-rendering.test.ts`.
3. Add one deterministic history view renderer used by current PRD/as-built and shipped projections. Keep original raw evidence separate; expose references, reasons, attempts, current resolution, and acknowledged legacy gap. Mark generated PRD history as engine-owned projection so the existing raw parser cannot ingest it as reviewer findings. No new Markdown judgment parser.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): render source-case history without granting text authority`.

**Done when:**
- The integration fixture `S12H1` in `src/conductor/test/engine/review-history-rendering.test.ts` exercises the review-history renderer consumed by current and shipped views: Given a finding is reconciled, reused, resolved, reopened, or uncertain, when its human-readable current/shipped view is produced, then it names the source and case references, reason, relevant repair outcome, and any acknowledged legacy gap without replacing the original reviewer evidence.
- The integration fixture `S12N2` in `src/conductor/test/engine/review-history-rendering.test.ts` exercises the review-history renderer consumed by current and shipped views: Given rendered report text is edited or contains history-like material, when effective completion is read, then it cannot create relationships or approvals; derived as-built text and generated history sections are not reparsed as authority.

**Files:** `src/conductor/src/engine/review-history-renderer.ts`, `src/conductor/src/engine/as-built-verdict-store.ts`, `src/conductor/src/engine/shipped-record.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/review-history-completion.ts`, `src/conductor/test/engine/review-history-rendering.test.ts`

### Task 39: Emit attributable transitions on the existing spine
**Story:** 12 (S12H2, S12N1)
**Type:** happy-path
**Dependencies:** Tasks 23, 34, 38

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-events.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-events.test.ts`.
3. Extend ConductorEvent and total sink declarations for history started/completed/reused/reopened/uncertain/failed transitions. Emit at the owning state boundary with gate, execution and applicable batch/source/case ids and bounded reasons; state publication failure emits failure, never success. Feed real emitter-to-EventPersister with temporary ledger and no remote exporter.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): emit attributable transitions on the existing spine`.

**Done when:**
- The integration fixture `S12H2` in `src/conductor/test/engine/review-history-events.test.ts` exercises the history transition emitter through EventPersister: Given a reconciliation transition starts, completes, reuses a result, reopens a case, or fails, when its owning transition is recorded, then the occurrence reaches the existing event stream with gate and execution attribution plus applicable batch/source/case references and bounded reasons.
- The integration fixture `S12N1` in `src/conductor/test/engine/review-history-events.test.ts` exercises the history transition emitter through EventPersister: Given a state publication fails, when reports/events are emitted, then they do not claim that the unpublished resolution or completion succeeded; the failure remains attributable to the attempted transition.
- Every history event declares a row in the existing exhaustive sink registry and is emitted through the existing ConductorEvent spine with execution context; no side log, watcher, timestamp inference, or second emitter/persister path supplies history authority.

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/engine/review-history-coordinator.ts`, `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/review-history-renderer.ts`, `src/conductor/test/engine/review-history-events.test.ts`

### Task 40: Render typed non-destructive recovery at the halt boundary
**Story:** 12 (S12H3, S12N3)
**Type:** happy-path
**Dependencies:** Tasks 6, 9, 10, 12, 13, 17, 19, 21, 22, 26, 34, 36, 37, 39

**Steps:**
1. Add a failing integration fixture in `src/conductor/test/engine/review-history-recovery.test.ts` for the criteria and observable checks below; use injected adapters and isolated temporary state at the named boundary.
2. Confirm RED through `ai-conductor scoped-run src/conductor/test/engine/review-history-recovery.test.ts`.
3. Map closed history failures to existing HALT classes and actionable bounded messages: restore matching evidence for loss/corruption, explicit valid-legacy coverage choice, provide missing evidence/decision for uncertainty, refresh stale input, repair permissions/lease or provider capability. Name gate/evidence and retain valid authority; never recommend pruning/reset/deletion as restoration. Reuse writeHaltMarker and cleared-decision capture.
4. Confirm GREEN through the same scoped selector and commit this behavior with message `feat(review-history): render typed non-destructive recovery at the halt boundary`.

**Done when:**
- The integration fixture `S12H3` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a recovery condition names lost history, malformed/foreign/unsupported state, incomplete legacy provenance, overflow, missing evidence, uncertainty, stale input, provider failure, or publication failure, when it is surfaced, then the operator sees the affected gate/evidence and the corresponding recoverable action while valid retained authority remains available.
- The integration fixture `S12N3` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given an overflow or corruption report, when recovery is presented, then it does not silently prune, reset, or delete history or represent such destruction as restoration.

**Files:** `src/conductor/src/engine/review-history-recovery.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/review-history-recovery.test.ts`

## Integration ownership

Each row assigns exactly one owner for a distinct changed production boundary. Other tasks exercise
its negative conditions or internal permutations using that owner's fixture seam; they do not add
another full-flow proof of the same behavior.

| Boundary / observable behavior | Owning task | Proof layer |
| --- | --- | --- |
| Store migration and restart domain isolation | 1 | Real store/temporary filesystem |
| Existing domain writers preserve new histories | 2 | Existing writer entry points |
| Review enrollment before dispatch | 5 | Entry/state mutation boundary |
| Legacy evidence import | 7 | Recovery/import boundary |
| Explicit legacy coverage choice | 8 | Existing halt/clear capture |
| Immutable per-member history delivery | 11 | Real serial/group dispatch input |
| Complete source collection and initial-history shortcut | 14 | Coordinator entry |
| NC sole authority adapted into complete history | 20 | Existing NC owner plus new adapter |
| Atomic batch and checkpoint replay | 23 | Publisher/restart boundary |
| Valid sibling publication at failed group join | 24 | Join/state boundary |
| Actual repair admission import | 27 | Real append/existing-task admission |
| Actual repair execution state | 28 | Existing BUILD/task-close transition |
| Retention before pending clear/verdict replacement | 29 | Existing projection owner |
| Consistent final completion/routing/reuse/fence | 32 | Production completion callers |
| Raw-valid branch reaches history-owning join | 33 | Bounded real group execution |
| Both native-schema provider adapters | 35 | Actual argument/result adapters, fake processes |
| Current/shipped views with inert generated text | 38 | Real view consumers |
| Existing event stream receives truthful transitions | 39 | Emitter → EventPersister |
| Actionable non-destructive stop | 40 | Existing halt owner |

## Coverage Check

Every criterion is diff-local: behavior is established using committed implementation plus controlled
local fixtures and fake external adapters. No criterion depends on another feature delivering new
behavior. Existing predecessor seams are verified prerequisites, not outsourced deliverables.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature with supported older history containing build-review cases, effects, suppressions, and PRD widening provenance, when history is upgraded, then every original record and reference remains attributable to the same feature with unchanged authority. | 1 | "The integration fixture `S1H1` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given a feature with supported older history containing build-review cases, effects, suppressions, and PRD widening provenance, when history is upgraded, then every original record and reference remains attributable to the same feature with unchanged authority." | diff-local |
| Story 1 happy: Given upgraded history containing both review gates, when a build-review or widening operation updates its own records, then both review histories and all unrelated records remain intact. | 2 | "The integration fixture `S1H2` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given upgraded history containing both review gates, when a build-review or widening operation updates its own records, then both review histories and all unrelated records remain intact." | diff-local |
| Story 1 happy: Given both review gates have a finding with the same report-local label, when their histories are recorded and reread after restart, then their observations remain separate and neither gate inherits the other's relationships or approval. | 1 | "The integration fixture `S1H3` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given both review gates have a finding with the same report-local label, when their histories are recorded and reread after restart, then their observations remain separate and neither gate inherits the other's relationships or approval." | diff-local |
| Story 1 negative: Given malformed, unsupported-version, or foreign-feature history, when an upgrade or mutation is requested, then the operation reports the specific defect and leaves the stored bytes unchanged. | 3 | "The unit fixture `S1N1` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given malformed, unsupported-version, or foreign-feature history, when an upgrade or mutation is requested, then the operation reports the specific defect and leaves the stored bytes unchanged." | diff-local |
| Story 1 negative: Given an older writer attempts to replace an upgraded envelope without its new histories, when the write reaches validation, then it is refused and none of the histories is lost. | 3 | "The unit fixture `S1N2` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given an older writer attempts to replace an upgraded envelope without its new histories, when the write reaches validation, then it is refused and none of the histories is lost." | diff-local |
| Story 1 negative: Given a model attempts to supply an original operator decision, durable identifier, or another gate's relationship, when its result is consumed, then those unauthorized fields/references are rejected without altering authority. | 16 | "The unit fixture `S1N3` in `src/conductor/test/engine/review-history-contract.test.ts` exercises the engine-owned review-history contract validator: Given a model attempts to supply an original operator decision, durable identifier, or another gate's relationship, when its result is consumed, then those unauthorized fields/references are rejected without altering authority." | diff-local |
| Story 1 negative: Given a lease failure or failed atomic replacement during upgrade, when the operation settles, then the original history is readable and no successful migration or gate completion is claimed. | 4 | "The unit fixture `S1N4` in `src/conductor/test/engine/review-history-store.test.ts` exercises RemediationCaseStore.mutate and its persisted v3 reader: Given a lease failure or failed atomic replacement during upgrade, when the operation settles, then the original history is readable and no successful migration or gate completion is claimed." | diff-local |
| Story 2 happy: Given a feature has never run the gate and has no evidence of earlier review, when the first review begins, then it starts with an explicitly fresh history and establishes that history as required before dispatch. | 5 | "The integration fixture `S2H1` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given a feature has never run the gate and has no evidence of earlier review, when the first review begins, then it starts with an explicitly fresh history and establishes that history as required before dispatch." | diff-local |
| Story 2 happy: Given initialized history was persisted but execution stopped before its enrollment reference was saved, when the feature resumes, then the matching initialized history is recovered without inventing a legacy gap or another initialization. | 5 | "The integration fixture `S2H2` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given initialized history was persisted but execution stopped before its enrollment reference was saved, when the feature resumes, then the matching initialized history is recovered without inventing a legacy gap or another initialization." | diff-local |
| Story 2 happy: Given an enrolled gate has complete matching history after restart, when entry or completion is checked, then the same required-history identity is used and existing current evidence can proceed. | 5 | "The integration fixture `S2H3` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given an enrolled gate has complete matching history after restart, when entry or completion is checked, then the same required-history identity is used and existing current evidence can proceed." | diff-local |
| Story 2 negative: Given an enrolled gate's history has disappeared, when any entry, completion, retained-result, or final-publication check runs, then it returns a lost-required-history result and cannot pass using an empty history. | 6 | "The integration fixture `S2N1` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given an enrolled gate's history has disappeared, when any entry, completion, retained-result, or final-publication check runs, then it returns a lost-required-history result and cannot pass using an empty history." | diff-local |
| Story 2 negative: Given an enrollment reference names another feature, gate, or unavailable history generation, when it is read, then the mismatch is reported and neither a provider dispatch nor a success verdict is authorized. | 6 | "The integration fixture `S2N2` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given an enrollment reference names another feature, gate, or unavailable history generation, when it is read, then the mismatch is reported and neither a provider dispatch nor a success verdict is authorized." | diff-local |
| Story 2 negative: Given history initialization succeeds but the required enrollment write fails, when the first review is prepared, then the provider is not invoked and the matching initialized history remains recoverable. | 6 | "The integration fixture `S2N3` in `src/conductor/test/engine/review-history-entry.test.ts` exercises the review-history entry guard through the conduct-state mutation port: Given history initialization succeeds but the required enrollment write fails, when the first review is prepared, then the provider is not invoked and the matching initialized history remains recoverable." | diff-local |
| Story 3 happy: Given supported legacy review evidence includes attributable decisions, findings, pending repairs, and recorded outcomes, when it is imported, then all recoverable facts retain their original provenance and repeated import creates no duplicate fact. | 7 | "The integration fixture `S3H1` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given supported legacy review evidence includes attributable decisions, findings, pending repairs, and recorded outcomes, when it is imported, then all recoverable facts retain their original provenance and repeated import creates no duplicate fact." | diff-local |
| Story 3 happy: Given a valid legacy feature has an unreconstructable earlier interval, when recovery is evaluated, then it stops with legacy-history-incomplete and identifies the missing interval and the known evidence it retained. | 7 | "The integration fixture `S3H2` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a valid legacy feature has an unreconstructable earlier interval, when recovery is evaluated, then it stops with legacy-history-incomplete and identifies the missing interval and the known evidence it retained." | diff-local |
| Story 3 happy: Given the engine offered a new coverage boundary for that valid legacy gap, when the attributed operator explicitly selects it with a rationale against the same feature/gate/evidence, then the gap and approval remain visible in subsequent history while review begins from the approved boundary and all known prior records remain. | 8 | "The integration fixture `S3H3` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given the engine offered a new coverage boundary for that valid legacy gap, when the attributed operator explicitly selects it with a rationale against the same feature/gate/evidence, then the gap and approval remain visible in subsequent history while review begins from the approved boundary and all known prior records remain." | diff-local |
| Story 3 negative: Given a legacy source cannot prove whether a repair ran or succeeded, when import runs, then no attempted/completed/resolved fact is invented and the missing provenance remains explicit. | 7 | "The integration fixture `S3N1` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a legacy source cannot prove whether a repair ran or succeeded, when import runs, then no attempted/completed/resolved fact is invented and the missing provenance remains explicit." | diff-local |
| Story 3 negative: Given a recovery halt was cleared without an explicit choice, rationale, or attributable operator, when recovery resumes, then no coverage-boundary approval is recorded and the gap still blocks. | 9 | "The unit fixture `S3N2` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a recovery halt was cleared without an explicit choice, rationale, or attributable operator, when recovery resumes, then no coverage-boundary approval is recorded and the gap still blocks." | diff-local |
| Story 3 negative: Given the offer's evidence, feature, gate, or immutable reference changed, when an earlier choice is replayed, then it cannot authorize the changed boundary; replay of an already-applied unchanged choice is inert. | 9 | "The unit fixture `S3N3` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given the offer's evidence, feature, gate, or immutable reference changed, when an earlier choice is replayed, then it cannot authorize the changed boundary; replay of an already-applied unchanged choice is inert." | diff-local |
| Story 3 negative: Given corrupt, foreign, or previously enrolled lost history, when a coverage-boundary choice is supplied, then that path is refused and restoration remains required. | 10 | "The unit fixture `S3N4` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given corrupt, foreign, or previously enrolled lost history, when a coverage-boundary choice is supplied, then that path is refused and restoration remains required." | diff-local |
| Story 3 negative: Given a valid boundary acknowledgement coexists with a refused widening or current blocking finding, when completion is checked, then the acknowledgement does not accept that finding, erase the refusal, or pass the gate. | 10 | "The unit fixture `S3N5` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a valid boundary acknowledgement coexists with a refused widening or current blocking finding, when completion is checked, then the acknowledgement does not accept that finding, erase the refusal, or pass the gate." | diff-local |
| Story 4 happy: Given a gate has open, resolved, absent, uncertain, and reopened cases, when its next review is dispatched, then its input includes each case with original/current evidence, applicable decision references, repair facts, resolution evidence, and any acknowledged legacy gap. | 11 | "The integration fixture `S4H1` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given a gate has open, resolved, absent, uncertain, and reopened cases, when its next review is dispatched, then its input includes each case with original/current evidence, applicable decision references, repair facts, resolution evidence, and any acknowledged legacy gap." | diff-local |
| Story 4 happy: Given equivalent feature state is reviewed serially or in a concurrent validation group, when the reviewers are dispatched, then each receives the same gate-local history content and authority for the same evidence snapshot. | 11 | "The integration fixture `S4H2` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given equivalent feature state is reviewed serially or in a concurrent validation group, when the reviewers are dispatched, then each receives the same gate-local history content and authority for the same evidence snapshot." | diff-local |
| Story 4 happy: Given both gates run concurrently, when one gate's history differs from the other's, then each input remains attributable to its intended member with no transfer of sibling-only case authority. | 11 | "The integration fixture `S4H3` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given both gates run concurrently, when one gate's history differs from the other's, then each input remains attributable to its intended member with no transfer of sibling-only case authority." | diff-local |
| Story 4 happy: Given inputs fit all approved history limits, including values exactly at an individual boundary while other dimensions fit, when prepared, then they are retained completely; the gate's pre-existing input requirements remain enforced. | 12 | "The unit fixture `S4H4` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given inputs fit all approved history limits, including values exactly at an individual boundary while other dimensions fit, when prepared, then they are retained completely; the gate's pre-existing input requirements remain enforced." | diff-local |
| Story 4 negative: Given required original evidence or governing references cannot be read, when a history projection is prepared, then the affected gate and evidence are named and no incomplete projection is dispatched. | 13 | "The integration fixture `S4N1` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given required original evidence or governing references cannot be read, when a history projection is prepared, then the affected gate and evidence are named and no incomplete projection is dispatched." | diff-local |
| Story 4 negative: Given any approved count or byte bound is exceeded, when input is prepared, then the result names the dimension, actual value, and limit and preserves the untrimmed stored history without a provider call. | 12 | "The unit fixture `S4N2` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given any approved count or byte bound is exceeded, when input is prepared, then the result names the dimension, actual value, and limit and preserves the untrimmed stored history without a provider call." | diff-local |
| Story 4 negative: Given a sibling gate changes after one member's immutable input was prepared, when that member is dispatched, then it receives its own prepared history and never the sibling's replacement context. | 11 | "The integration fixture `S4N3` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given a sibling gate changes after one member's immutable input was prepared, when that member is dispatched, then it receives its own prepared history and never the sibling's replacement context." | diff-local |
| Story 4 negative: Given PRD decision capture fails before review, when general history preparation is attempted, then the failure remains blocking and an input without the required original authority is not substituted. | 13 | "The integration fixture `S4N4` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given PRD decision capture fails before review, when general history preparation is attempted, then the failure remains blocking and an input without the required original authority is not substituted." | diff-local |
| Story 5 happy: Given a review contains criterion failures and NC findings, or as-built BLOCKED findings, PLAN_GAP findings, and nonblocking drift notes, when reconciliation is published, then every current finding has exactly one traceable result and every supplied prior case has an accounted-for outcome. | 14 | "The integration fixture `S5H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a review contains criterion failures and NC findings, or as-built BLOCKED findings, PLAN_GAP findings, and nonblocking drift notes, when reconciliation is published, then every current finding has exactly one traceable result and every supplied prior case has an accounted-for outcome." | diff-local |
| Story 5 happy: Given two current observations describe the same retained case, when a valid relationship judgment relates them, then both source observations remain individually traceable to that case without replacing the original evidence. | 14 | "The integration fixture `S5H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given two current observations describe the same retained case, when a valid relationship judgment relates them, then both source observations remain individually traceable to that case without replacing the original evidence." | diff-local |
| Story 5 happy: Given a known fresh history has no prior obligations, when current observations are recorded, then the engine establishes the explicit initial history without paying for an unnecessary semantic comparison; PASS evidence creates no fabricated defect. | 14 | "The integration fixture `S5H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a known fresh history has no prior obligations, when current observations are recorded, then the engine establishes the explicit initial history without paying for an unnecessary semantic comparison; PASS evidence creates no fabricated defect." | diff-local |
| Story 5 happy: Given a changed non-NC source has relevant prior history, when reconciliation judges it, then it records new-case, same-case, or uncertain with reasons and supplied evidence references, and new durable identities remain engine-owned. | 14 | "The integration fixture `S5H4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a changed non-NC source has relevant prior history, when reconciliation judges it, then it records new-case, same-case, or uncertain with reasons and supplied evidence references, and new durable identities remain engine-owned." | diff-local |
| Story 5 negative: Given a result omits or duplicates a current source or prior case, when validation runs, then publication is rejected with the coverage defect and no partial batch becomes effective. | 15 | "The unit fixture `S5N1` in `src/conductor/test/engine/review-history-contract.test.ts` exercises the engine-owned review-history contract validator: Given a result omits or duplicates a current source or prior case, when validation runs, then publication is rejected with the coverage defect and no partial batch becomes effective." | diff-local |
| Story 5 negative: Given a result cites an unknown, foreign-feature, sibling-gate, or unsupported evidence reference, when validation runs, then the result is rejected without linking the source to that record. | 15 | "The unit fixture `S5N2` in `src/conductor/test/engine/review-history-contract.test.ts` exercises the engine-owned review-history contract validator: Given a result cites an unknown, foreign-feature, sibling-gate, or unsupported evidence reference, when validation runs, then the result is rejected without linking the source to that record." | diff-local |
| Story 5 negative: Given source-level and case-level outcomes contradict one another, when they are validated, then the contradiction is reported and cannot become effective history. | 16 | "The unit fixture `S5N3` in `src/conductor/test/engine/review-history-contract.test.ts` exercises the engine-owned review-history contract validator: Given source-level and case-level outcomes contradict one another, when they are validated, then the contradiction is reported and cannot become effective history." | diff-local |
| Story 5 negative: Given the existing NC reconciliation partition fails or remains unaccounted for while general PRD reconciliation succeeds, when the PRD batch is assembled, then no complete PRD result or clean completion is claimed. | 17 | "The integration fixture `S5N4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the existing NC reconciliation partition fails or remains unaccounted for while general PRD reconciliation succeeds, when the PRD batch is assembled, then no complete PRD result or clean completion is claimed." | diff-local |
| Story 6 happy: Given an earlier resolved finding reappears with changed wording, order, or report-local label and unchanged underlying facts, when current evidence supports the same case and its resolution, then the repeat remains attached to that case and does not create a new unresolved obligation. | 18 | "The unit fixture `S6H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an earlier resolved finding reappears with changed wording, order, or report-local label and unchanged underlying facts, when current evidence supports the same case and its resolution, then the repeat remains attached to that case and does not create a new unresolved obligation." | diff-local |
| Story 6 happy: Given a previously resolved defect materially recurs or changes, when current evidence establishes recurrence, then the case reopens with the reason and evidence retained alongside its prior resolution. | 18 | "The unit fixture `S6H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a previously resolved defect materially recurs or changes, when current evidence establishes recurrence, then the case reopens with the reason and evidence retained alongside its prior resolution." | diff-local |
| Story 6 happy: Given an earlier finding is absent and current evidence establishes that its criterion or approved clause is satisfied, when reconciliation records resolution, then that evidence and the current judgment are retained without deleting the original finding. | 18 | "The unit fixture `S6H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an earlier finding is absent and current evidence establishes that its criterion or approved clause is satisfied, when reconciliation records resolution, then that evidence and the current judgment are retained without deleting the original finding." | diff-local |
| Story 6 happy: Given an earlier finding is absent but current evidence cannot establish resolution, when its history is reconciled, then it is recorded as not-observed and its prior resolution/refusal evidence remains intact. | 18 | "The unit fixture `S6H4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an earlier finding is absent but current evidence cannot establish resolution, when its history is reconciled, then it is recorded as not-observed and its prior resolution/refusal evidence remains intact." | diff-local |
| Story 6 negative: Given only an earlier autonomous dismissal, another gate's approval, or a matching summary supports a proposed resolution, when the result is checked, then it cannot clear the current finding. | 19 | "The unit fixture `S6N1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given only an earlier autonomous dismissal, another gate's approval, or a matching summary supports a proposed resolution, when the result is checked, then it cannot clear the current finding." | diff-local |
| Story 6 negative: Given a proposed reopening cites only changed wording, ordering, or labels without material current evidence, when it is checked, then it cannot create a justified reopened obligation; the unsupported judgment remains unresolved. | 19 | "The unit fixture `S6N2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a proposed reopening cites only changed wording, ordering, or labels without material current evidence, when it is checked, then it cannot create a justified reopened obligation; the unsupported judgment remains unresolved." | diff-local |
| Story 6 negative: Given a repair task is merely admitted, started, or marked complete without current criterion/clause evidence, when resolution is proposed, then it is not accepted as a verified repair. | 19 | "The unit fixture `S6N3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a repair task is merely admitted, started, or marked complete without current criterion/clause evidence, when resolution is proposed, then it is not accepted as a verified repair." | diff-local |
| Story 6 negative: Given the available evidence cannot distinguish same-case from a different defect, when judgment returns uncertainty, then the affected source remains explicitly unresolved and the engine does not repeatedly ask for a more favorable answer on identical input. | 19 | "The unit fixture `S6N4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the available evidence cannot distinguish same-case from a different defect, when judgment returns uncertainty, then the affected source remains explicitly unresolved and the engine does not repeatedly ask for a more favorable answer on identical input." | diff-local |
| Story 7 happy: Given an accepted or refused NC widening has a fresh relationship established by its existing authority owner, when complete PRD history is published, then that same relationship and original decision scope govern its current classification without a second semantic override. | 20 | "The integration fixture `S7H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an accepted or refused NC widening has a fresh relationship established by its existing authority owner, when complete PRD history is published, then that same relationship and original decision scope govern its current classification without a second semantic override." | diff-local |
| Story 7 happy: Given a story-criterion decision applies to one criterion, when nearby findings are reconciled, then the decision remains scoped to its original criterion and unrelated criteria retain their own grades. | 20 | "The integration fixture `S7H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a story-criterion decision applies to one criterion, when nearby findings are reconciled, then the decision remains scoped to its original criterion and unrelated criteria retain their own grades." | diff-local |
| Story 7 happy: Given an as-built finding requires an unapproved architectural decision, when its history is reconciled, then it remains a human decision under the governing ADR/plan authority even when another gate approved related work. | 20 | "The integration fixture `S7H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an as-built finding requires an unapproved architectural decision, when its history is reconciled, then it remains a human decision under the governing ADR/plan authority even when another gate approved related work." | diff-local |
| Story 7 negative: Given general-history judgment contradicts or broadens a validated NC binding, when the complete result is assembled, then it is rejected and the original widening authority is retained. | 21 | "The unit fixture `S7N1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given general-history judgment contradicts or broadens a validated NC binding, when the complete result is assembled, then it is rejected and the original widening authority is retained." | diff-local |
| Story 7 negative: Given the latest operator revision refuses a widening, when an older acceptance, ordinary cleared halt, or legacy coverage acknowledgement is replayed, then it cannot supersede that refusal. | 21 | "The unit fixture `S7N2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the latest operator revision refuses a widening, when an older acceptance, ordinary cleared halt, or legacy coverage acknowledgement is replayed, then it cannot supersede that refusal." | diff-local |
| Story 7 negative: Given a result converts DESIGN to REMEDIABLE or grants a missing architectural choice solely from prior history, when effective classification is evaluated, then that conversion is refused and no unauthorized repair route is created. | 22 | "The unit fixture `S7N3` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a result converts DESIGN to REMEDIABLE or grants a missing architectural choice solely from prior history, when effective classification is evaluated, then that conversion is refused and no unauthorized repair route is created." | diff-local |
| Story 8 happy: Given a reconciliation batch is published against a frozen gate input, when the same input is encountered again, then the stored result is reused without another judgment, duplicated observation, or repeated effect. | 23 | "The integration fixture `S8H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a reconciliation batch is published against a frozen gate input, when the same input is encountered again, then the stored result is reused without another judgment, duplicated observation, or repeated effect." | diff-local |
| Story 8 happy: Given the process stops after history publication but before its completion reference is recorded, when it resumes, then the matching receipt completes that reference and keeps the same judgment and case identities. | 23 | "The integration fixture `S8H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the process stops after history publication but before its completion reference is recorded, when it resumes, then the matching receipt completes that reference and keeps the same judgment and case identities." | diff-local |
| Story 8 happy: Given another gate publishes an unrelated history update, when this gate checks its unchanged relevant snapshot, then the unrelated update neither erases records nor invalidates its usable judgment. | 24 | "The integration fixture `S8H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given another gate publishes an unrelated history update, when this gate checks its unchanged relevant snapshot, then the unrelated update neither erases records nor invalidates its usable judgment." | diff-local |
| Story 8 happy: Given one concurrent member supplies valid current history while a sibling fails to produce a verdict, when the join settles, then valid sibling history is retained and the failed sibling is not marked satisfied. | 24 | "The integration fixture `S8H4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given one concurrent member supplies valid current history while a sibling fails to produce a verdict, when the join settles, then valid sibling history is retained and the failed sibling is not marked satisfied." | diff-local |
| Story 8 negative: Given source evidence, code, governing artifacts, operator revision, repair evidence, or the relevant contract changes during judgment, when publication rechecks its snapshot, then stale output is refused and prior authority is not overwritten. | 25 | "The unit fixture `S8N1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given source evidence, code, governing artifacts, operator revision, repair evidence, or the relevant contract changes during judgment, when publication rechecks its snapshot, then stale output is refused and prior authority is not overwritten." | diff-local |
| Story 8 negative: Given history replacement or the completion-reference write fails, when execution stops, then no incomplete batch qualifies a gate and the recoverable persisted state identifies which publication step remains incomplete. | 26 | "The integration fixture `S8N2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given history replacement or the completion-reference write fails, when execution stops, then no incomplete batch qualifies a gate and the recoverable persisted state identifies which publication step remains incomplete." | diff-local |
| Story 8 negative: Given a current reference names a missing or mismatched receipt, when reuse is attempted, then no success is granted and the named inconsistency remains recoverable. | 26 | "The integration fixture `S8N3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a current reference names a missing or mismatched receipt, when reuse is attempted, then no success is granted and the named inconsistency remains recoverable." | diff-local |
| Story 8 negative: Given rebase or normal invalidation makes current review evidence unusable, when reuse is considered, then its existing authority rules prevent reuse while the historical cases remain available for fresh review. | 26 | "The integration fixture `S8N4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given rebase or normal invalidation makes current review evidence unusable, when reuse is considered, then its existing authority rules prevent reuse while the historical cases remain available for fresh review." | diff-local |
| Story 9 happy: Given an existing repair path admits appended or existing tasks for a finding, when admission is recorded, then history binds the exact admitted tasks and repair identity to that finding without independently appending work. | 27 | "The integration fixture `S9H1` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given an existing repair path admits appended or existing tasks for a finding, when admission is recorded, then history binds the exact admitted tasks and repair identity to that finding without independently appending work." | diff-local |
| Story 9 happy: Given that repair starts and later completes, fails, or is interrupted, when the responsible execution transition records its evidence, then history distinguishes those actual states and retains them for the next review. | 28 | "The integration fixture `S9H2` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given that repair starts and later completes, fails, or is interrupted, when the responsible execution transition records its evidence, then history distinguishes those actual states and retains them for the next review." | diff-local |
| Story 9 happy: Given successful as-built review projects pending repair findings into its current verdict, when pending evidence is cleared or a later verdict replaces it, then attributable finding, attempt, and outcome facts remain available from durable history. | 29 | "The integration fixture `S9H3` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given successful as-built review projects pending repair findings into its current verdict, when pending evidence is cleared or a later verdict replaces it, then attributable finding, attempt, and outcome facts remain available from durable history." | diff-local |
| Story 9 happy: Given repair admission was durable but history import failed, when the feature resumes, then the existing admission is imported once without another task append, budget charge, or invented repair execution. | 27 | "The integration fixture `S9H4` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given repair admission was durable but history import failed, when the feature resumes, then the existing admission is imported once without another task append, budget charge, or invented repair execution." | diff-local |
| Story 9 negative: Given append/admission fails or its binding cannot be proven, when repair history is assembled, then no successful admission is invented and the missing binding produces a named recoverable result. | 27 | "The integration fixture `S9N1` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given append/admission fails or its binding cannot be proven, when repair history is assembled, then no successful admission is invented and the missing binding produces a named recoverable result." | diff-local |
| Story 9 negative: Given an admitted task never dispatched because an existing cap stopped BUILD, when the next history is read, then it remains admitted/unexecuted and cannot be presented as completed or resolved. | 28 | "The integration fixture `S9N2` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given an admitted task never dispatched because an existing cap stopped BUILD, when the next history is read, then it remains admitted/unexecuted and cannot be presented as completed or resolved." | diff-local |
| Story 9 negative: Given history cannot retain pending finding/outcome evidence, when clearing or replacement would occur, then the required pending evidence is kept and the persistence failure blocks that transition. | 29 | "The integration fixture `S9N3` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given history cannot retain pending finding/outcome evidence, when clearing or replacement would occur, then the required pending evidence is kept and the persistence failure blocks that transition." | diff-local |
| Story 9 negative: Given a matched case already has recorded attempts, when history is supplied to remediation, then history itself neither appends tasks nor changes planner dispositions, kickback caps, plan-growth accounting, or combined routing policy. | 30 | "The unit fixture `S9N4` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given a matched case already has recorded attempts, when history is supplied to remediation, then history itself neither appends tasks nor changes planner dispositions, kickback caps, plan-growth accounting, or combined routing policy." | diff-local |
| Story 10 happy: Given raw review and current validated reconciliation jointly establish satisfaction, when serial routing, group completion, retained-sibling reuse, or final publication is evaluated, then each uses the same effective classification and source trace. | 32 | "The integration fixture `S10H1` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given raw review and current validated reconciliation jointly establish satisfaction, when serial routing, group completion, retained-sibling reuse, or final publication is evaluated, then each uses the same effective classification and source trace." | diff-local |
| Story 10 happy: Given a repeated criterion failure is resolved by evidence of that exact criterion's current satisfaction, when the effective result is derived, then that source can clear while unrelated grades remain unchanged. | 31 | "The unit fixture `S10H2` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a repeated criterion failure is resolved by evidence of that exact criterion's current satisfaction, when the effective result is derived, then that source can clear while unrelated grades remain unchanged." | diff-local |
| Story 10 happy: Given a repeated as-built PLAN_GAP is resolved with explicit evidence that its affected outcome is currently delivered, when the effective result is validated, then existing delivery and gate rules apply to that outcome rather than a guessed success. | 31 | "The unit fixture `S10H3` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a repeated as-built PLAN_GAP is resolved with explicit evidence that its affected outcome is currently delivered, when the effective result is validated, then existing delivery and gate rules apply to that outcome rather than a guessed success." | diff-local |
| Story 10 happy: Given a concurrent branch has valid reviewer output but awaits join-owned reconciliation, when branch validation finishes, then it reaches the join without retrying solely because final history publication has not yet occurred. | 33 | "The integration fixture `S10H4` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a concurrent branch has valid reviewer output but awaits join-owned reconciliation, when branch validation finishes, then it reaches the join without retrying solely because final history publication has not yet occurred." | diff-local |
| Story 10 negative: Given raw reviewer success coexists with pending, corrupt, missing, stale, or uncertain required history, when any completion boundary runs, then the gate cannot pass and the specific history condition is returned. | 32 | "The integration fixture `S10N1` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given raw reviewer success coexists with pending, corrupt, missing, stale, or uncertain required history, when any completion boundary runs, then the gate cannot pass and the specific history condition is returned." | diff-local |
| Story 10 negative: Given one resolved source coexists with an unrelated criterion failure, unexplained violation, or parser/completeness fault, when effective classification runs, then the unrelated failure remains and prevents any success it previously blocked. | 31 | "The unit fixture `S10N2` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given one resolved source coexists with an unrelated criterion failure, unexplained violation, or parser/completeness fault, when effective classification runs, then the unrelated failure remains and prevents any success it previously blocked." | diff-local |
| Story 10 negative: Given an as-built outcome is claimed delivered without current evidence, when resolution would clear a PLAN_GAP, then that resolution is rejected and the original delivery failure remains. | 31 | "The unit fixture `S10N3` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given an as-built outcome is claimed delivered without current evidence, when resolution would clear a PLAN_GAP, then that resolution is rejected and the original delivery failure remains." | diff-local |
| Story 10 negative: Given the history result is unavailable at a completion reader, when completion is queried repeatedly, then the reader reports its state without invoking a provider, matching prose, or turning absence into a pass. | 32 | "The integration fixture `S10N4` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given the history result is unavailable at a completion reader, when completion is queried repeatedly, then the reader reports its state without invoking a provider, matching prose, or turning absence into a pass." | diff-local |
| Story 11 happy: Given equivalent Claude and Codex adapter fixtures return the same valid structured reconciliation, when invoked through the production provider path, then both receive the engine-owned contract and produce equivalent history results apart from engine run identity. | 35 | "The integration fixture `S11H1` in `src/conductor/test/engine/review-history-provider.test.ts` exercises the existing remediate native-schema provider dispatch: Given equivalent Claude and Codex adapter fixtures return the same valid structured reconciliation, when invoked through the production provider path, then both receive the engine-owned contract and produce equivalent history results apart from engine run identity." | diff-local |
| Story 11 happy: Given the configured reconciliation allowance is two attempts and one mechanical attempt failed before restart, when the resumed second attempt fails, then the same gate/input reaches exhaustion without resetting the allowance or charging BUILD/plan growth. | 34 | "The unit fixture `S11H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the configured reconciliation allowance is two attempts and one mechanical attempt failed before restart, when the resumed second attempt fails, then the same gate/input reaches exhaustion without resetting the allowance or charging BUILD/plan growth." | diff-local |
| Story 11 happy: Given a successful or uncertain result already exists for unchanged frozen input, when either provider would otherwise be invoked again, then the recorded result is reused and no additional semantic opinion is requested. | 34 | "The unit fixture `S11H3` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a successful or uncertain result already exists for unchanged frozen input, when either provider would otherwise be invoked again, then the recorded result is reused and no additional semantic opinion is requested." | diff-local |
| Story 11 negative: Given the selected provider cannot enforce the required native output contract, when dispatch is prepared, then it is refused with the provider and missing capability named and no unconstrained fallback result is accepted. | 36 | "The unit fixture `S11N1` in `src/conductor/test/engine/review-history-provider.test.ts` exercises the existing remediate native-schema provider dispatch: Given the selected provider cannot enforce the required native output contract, when dispatch is prepared, then it is refused with the provider and missing capability named and no unconstrained fallback result is accepted." | diff-local |
| Story 11 negative: Given terminal structured output is missing or malformed but prose contains a plausible result, when it is consumed, then the attempt is a mechanical failure and prose is not parsed as successful reconciliation. | 37 | "The unit fixture `S11N2` in `src/conductor/test/engine/review-history-provider.test.ts` exercises the existing remediate native-schema provider dispatch: Given terminal structured output is missing or malformed but prose contains a plausible result, when it is consumed, then the attempt is a mechanical failure and prose is not parsed as successful reconciliation." | diff-local |
| Story 11 negative: Given authentication, rate-limit, or provider availability handling applies, when an incomplete result is received, then the original provider category retains precedence rather than being relabeled as a finding or ordinary schema error. | 37 | "The unit fixture `S11N3` in `src/conductor/test/engine/review-history-provider.test.ts` exercises the existing remediate native-schema provider dispatch: Given authentication, rate-limit, or provider availability handling applies, when an incomplete result is received, then the original provider category retains precedence rather than being relabeled as a finding or ordinary schema error." | diff-local |
| Story 11 negative: Given repeated mechanical failures exhaust the configured allowance, when execution settles, then a named recovery stop preserves prior history and no successful relationship or repair is manufactured. | 34 | "The unit fixture `S11N4` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given repeated mechanical failures exhaust the configured allowance, when execution settles, then a named recovery stop preserves prior history and no successful relationship or repair is manufactured." | diff-local |
| Story 11 negative: Given the provider times out or becomes unavailable during reconciliation, when the attempt settles, then that failure category and spent attempt survive restart while prior authority is preserved and no partial relationship is accepted. | 34 | "The unit fixture `S11N5` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the provider times out or becomes unavailable during reconciliation, when the attempt settles, then that failure category and spent attempt survive restart while prior authority is preserved and no partial relationship is accepted." | diff-local |
| Story 12 happy: Given a finding is reconciled, reused, resolved, reopened, or uncertain, when its human-readable current/shipped view is produced, then it names the source and case references, reason, relevant repair outcome, and any acknowledged legacy gap without replacing the original reviewer evidence. | 38 | "The integration fixture `S12H1` in `src/conductor/test/engine/review-history-rendering.test.ts` exercises the review-history renderer consumed by current and shipped views: Given a finding is reconciled, reused, resolved, reopened, or uncertain, when its human-readable current/shipped view is produced, then it names the source and case references, reason, relevant repair outcome, and any acknowledged legacy gap without replacing the original reviewer evidence." | diff-local |
| Story 12 happy: Given a reconciliation transition starts, completes, reuses a result, reopens a case, or fails, when its owning transition is recorded, then the occurrence reaches the existing event stream with gate and execution attribution plus applicable batch/source/case references and bounded reasons. | 39 | "The integration fixture `S12H2` in `src/conductor/test/engine/review-history-events.test.ts` exercises the history transition emitter through EventPersister: Given a reconciliation transition starts, completes, reuses a result, reopens a case, or fails, when its owning transition is recorded, then the occurrence reaches the existing event stream with gate and execution attribution plus applicable batch/source/case references and bounded reasons." | diff-local |
| Story 12 happy: Given a recovery condition names lost history, malformed/foreign/unsupported state, incomplete legacy provenance, overflow, missing evidence, uncertainty, stale input, provider failure, or publication failure, when it is surfaced, then the operator sees the affected gate/evidence and the corresponding recoverable action while valid retained authority remains available. | 40 | "The integration fixture `S12H3` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given a recovery condition names lost history, malformed/foreign/unsupported state, incomplete legacy provenance, overflow, missing evidence, uncertainty, stale input, provider failure, or publication failure, when it is surfaced, then the operator sees the affected gate/evidence and the corresponding recoverable action while valid retained authority remains available." | diff-local |
| Story 12 negative: Given a state publication fails, when reports/events are emitted, then they do not claim that the unpublished resolution or completion succeeded; the failure remains attributable to the attempted transition. | 39 | "The integration fixture `S12N1` in `src/conductor/test/engine/review-history-events.test.ts` exercises the history transition emitter through EventPersister: Given a state publication fails, when reports/events are emitted, then they do not claim that the unpublished resolution or completion succeeded; the failure remains attributable to the attempted transition." | diff-local |
| Story 12 negative: Given rendered report text is edited or contains history-like material, when effective completion is read, then it cannot create relationships or approvals; derived as-built text and generated history sections are not reparsed as authority. | 38 | "The integration fixture `S12N2` in `src/conductor/test/engine/review-history-rendering.test.ts` exercises the review-history renderer consumed by current and shipped views: Given rendered report text is edited or contains history-like material, when effective completion is read, then it cannot create relationships or approvals; derived as-built text and generated history sections are not reparsed as authority." | diff-local |
| Story 12 negative: Given an overflow or corruption report, when recovery is presented, then it does not silently prune, reset, or delete history or represent such destruction as restoration. | 40 | "The integration fixture `S12N3` in `src/conductor/test/engine/review-history-recovery.test.ts` exercises the review-history recovery handler at the existing halt/clear boundary: Given an overflow or corruption report, when recovery is presented, then it does not silently prune, reset, or delete history or represent such destruction as restoration." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-10-concurrent-group-core#D1 | no-change | none | GroupCore semaphore and validation_concurrency admission remain unchanged; history preparation supplies member inputs without changing width or scheduling. |
| adr-2026-07-10-concurrent-group-core#D2 | no-change | none | Existing per-member step/skill dispatch stays in group-core.ts; this feature changes supplied context, not member selection. |
| adr-2026-07-10-concurrent-group-core#D3 | no-change | none | runGroupBranch continues minting fresh member sessions; gate history is durable engine state, not conversational session reuse. |
| adr-2026-07-10-concurrent-group-core#D4 | no-change | none | The existing shared rate-limit episode owns waits; history bookkeeping does not charge waits or change group backoff. |
| adr-2026-07-10-concurrent-group-core#D5 | task | task-33 | The integration fixture `S10H4` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a concurrent branch has valid reviewer output but awaits join-owned reconciliation, when branch validation finishes, then it reaches the join without retrying solely because final history publication has not yet occurred. |
| adr-2026-07-10-concurrent-group-core#D6 | no-change | none | GroupCore and Conductor retain sole conduct-state commit ownership; provider branches never mutate that store. |
| adr-2026-07-10-concurrent-group-core#D7 | no-change | none | The existing group-core/configured-group delegation is reused; no second parallel executor or DSL change is introduced. |
| adr-2026-07-10-concurrent-group-core#D8 | no-change | none | Existing parallel and step lifecycle events retain their owners; the new history occurrence events extend the same spine without changing group lifecycle semantics. |
| adr-2026-07-13-retry-classify-rerun-vs-route#D1 | task | task-32, task-33 | The integration fixture `S10H1` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given raw review and current validated reconciliation jointly establish satisfaction, when serial routing, group completion, retained-sibling reuse, or final publication is evaluated, then each uses the same effective classification and source trace. |
| adr-2026-07-13-retry-classify-rerun-vs-route#D2 | no-change | none | classifyRetryDecision stays pure and typed; it consumes the final effective result supplied by Task 32 and does not acquire a provider or new similarity matcher. |
| adr-2026-07-13-retry-classify-rerun-vs-route#D3 | no-change | none | The existing retry-routing switch and short-circuit ownership remain unchanged; history reconciliation settles upstream of final routing. |
| adr-2026-07-13-retry-classify-rerun-vs-route#D4 | no-change | none | Existing retry_decision emission remains in its current owner; no second retry telemetry channel is introduced. |
| adr-2026-07-13-retry-classify-rerun-vs-route#D5 | no-change | none | Existing unchanged-input diagnostic/halt behavior remains; new history recovery diagnostics are independently covered by the new ADR D10. |
| adr-2026-07-13-retry-classify-rerun-vs-route#D6 | no-change | none | retry_routing.enabled configuration/defaults and its effect on ordinary reviewer retry policy are unchanged; no opt-out may fabricate valid required history. |
| adr-2026-08-22-as-built-review-runs-always-with-plan-gap#D1 | no-change | none | Existing step registry and resolved as-built check policy still choose tier/presence checks; history adds evidence without changing participation. |
| adr-2026-08-22-as-built-review-runs-always-with-plan-gap#D2 | task | task-31, task-32, task-38 | The unit fixture `S10H3` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a repeated as-built PLAN_GAP is resolved with explicit evidence that its affected outcome is currently delivered, when the effective result is validated, then existing delivery and gate rules apply to that outcome rather than a guessed success. |
| adr-2026-08-22-as-built-review-runs-always-with-plan-gap#D3 | no-change | none | This old no-BUILD clause was superseded by the bounded-route ADR; its surviving constraint is the same existing remediation owner/budget, which history never replaces. |
| adr-2026-08-22-as-built-review-runs-always-with-plan-gap#D4 | no-change | none | The S-tier pinned set remains unchanged; this feature does not add or remove a lifecycle step. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D1 | no-change | none | Stories remain acceptance authority and PRD/plan remain intent context; the history projection references those existing governing inputs rather than redefining them. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D2 | no-change | none | prd_audit participation, configDisableAllowed, and gate surfaces are retained. Enrollment applies only when the existing gate participates. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D3 | task | task-31, task-32 | The unit fixture `S10N2` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given one resolved source coexists with an unrelated criterion failure, unexplained violation, or parser/completeness fault, when effective classification runs, then the unrelated failure remains and prevents any success it previously blocked. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D4 | task | task-20, task-21 | The integration fixture `S7H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an accepted or refused NC widening has a fresh relationship established by its existing authority owner, when complete PRD history is published, then that same relationship and original decision scope govern its current classification without a second semantic override. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D5 | task | task-30, task-32 | The unit fixture `S9N4` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given a matched case already has recorded attempts, when history is supplied to remediation, then history itself neither appends tasks nor changes planner dispositions, kickback caps, plan-growth accounting, or combined routing policy. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D6 | no-change | none | kickback-ledger growth and pendingRepair settlement at BUILD dispatch remain the accounting owner; history imports the existing receipt without another charge (Task 27). |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D7 | task | task-31, task-32 | The unit fixture `S10H2` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a repeated criterion failure is resolved by evidence of that exact criterion's current satisfaction, when the effective result is derived, then that source can clear while unrelated grades remain unchanged. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D8 | task | task-38, task-40 | The integration fixture `S12H1` in `src/conductor/test/engine/review-history-rendering.test.ts` exercises the review-history renderer consumed by current and shipped views: Given a finding is reconciled, reused, resolved, reopened, or uncertain, when its human-readable current/shipped view is produced, then it names the source and case references, reason, relevant repair outcome, and any acknowledged legacy gap without replacing the original reviewer evidence. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D1 | no-change | none | The existing typed as-built verdict schema still validates REMEDIABLE/DESIGN and structural governing references; historical relationships do not rewrite raw classification. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D2 | no-change | none | The existing native as-built validator/reference resolver and bounded absent-result retry remain the raw-output owner; Task 33 separates that raw validity from final history satisfaction. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D3 | task | task-32 | The integration fixture `S10H1` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given raw review and current validated reconciliation jointly establish satisfaction, when serial routing, group completion, retained-sibling reuse, or final publication is evaluated, then each uses the same effective classification and source trace. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D4 | no-change | none | Existing gate-local lap cap, shared growth, and BUILD-dispatch pendingRepair settlement remain unchanged; no history transition spends those allowances. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D5 | no-change | none | planRemediation/remediation-append and existing-task admission remain the only repair owners; history cannot append plan tasks or authorize off-plan work. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D6 | task | task-29, task-38, task-39 | The integration fixture `S12H1` in `src/conductor/test/engine/review-history-rendering.test.ts` exercises the review-history renderer consumed by current and shipped views: Given a finding is reconciled, reused, resolved, reopened, or uncertain, when its human-readable current/shipped view is produced, then it names the source and case references, reason, relevant repair outcome, and any acknowledged legacy gap without replacing the original reviewer evidence. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D7 | task | task-29, task-27, task-28 | The integration fixture `S9H3` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given successful as-built review projects pending repair findings into its current verdict, when pending evidence is cleared or a later verdict replaces it, then attributable finding, attempt, and outcome facts remain available from durable history. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D8 | no-change | none | Existing consolidated manual_test FAIL precedence and one work-order merge remain unchanged; new history resolves only its own current sources before that existing route. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D9 | no-change | none | Shared canonical task resolution, existing-task restage-before-rewind, dispatch-time lap-only settlement, and no-growth behavior are preserved; history records their actual receipts without recreating them. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | task | task-20, task-21 | The integration fixture `S7H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an accepted or refused NC widening has a fresh relationship established by its existing authority owner, when complete PRD history is published, then that same relationship and original decision scope govern its current classification without a second semantic override. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | task | task-1, task-2, task-3 | The v3 migration reaches the existing leased atomic replacement and retains immutable original observations, subsequent observations, decisions by reference, repair facts, resolution/reopening evidence, and receipts; no second storage path is created. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | no-change | none | Existing capturePrdWideningDecisions original-offer validation and decision revision owner remain; Task 13 blocks new history preparation if that existing capture fails. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | no-change | none | Existing supported widening-decision/legacy-clear migration and provenance are retained in prd-widening-migration.ts; the v3 adapter preserves those records and does not guess new authority. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | task | task-20, task-17 | The integration fixture `S7H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an accepted or refused NC widening has a fresh relationship established by its existing authority owner, when complete PRD history is published, then that same relationship and original decision scope govern its current classification without a second semantic override. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | task | task-35, task-36, task-37 | The new mode uses one existing provider invoke member, engine-owned nativeSchema, invocation-local scratch, and engine-stamped identity; the prompt shape is derived from the same schema passed to both adapters. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | task | task-12, task-34 | The projection tests enforce exactly these limits without trimming: 512 current sources per gate, 128 cases per gate, 512 observations per case, 64 evidence references per source/resolution, 256 UTF-8 bytes per identifier/reference, 8000 bytes per prose field, and 512 KiB total serialized history/reconciliation input; decisions, attempts, and evidence count toward the total and prior review-contract limits remain independently enforced. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | task | task-20, task-21, task-23, task-25, task-32 | The integration fixture `S7H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an accepted or refused NC widening has a fresh relationship established by its existing authority owner, when complete PRD history is published, then that same relationship and original decision scope govern its current classification without a second semantic override. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | task | task-38, task-39, task-40 | The integration fixture `S12H1` in `src/conductor/test/engine/review-history-rendering.test.ts` exercises the review-history renderer consumed by current and shipped views: Given a finding is reconciled, reused, resolved, reopened, or uncertain, when its human-readable current/shipped view is produced, then it names the source and case references, reason, relevant repair outcome, and any acknowledged legacy gap without replacing the original reviewer evidence. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | The earlier slice boundary explicitly assigns this full-history work to #2440 and leaves consolidation/cross-gate identity to #2060/#2441. Its old amendments remain intact; this DECIDE diff applies only the new approved qualifications. |
| adr-2026-09-30-gate-local-review-finding-continuity#D1 | task | task-1, task-2, task-20 | The v3 migration reaches the existing leased atomic replacement and retains immutable original observations, subsequent observations, decisions by reference, repair facts, resolution/reopening evidence, and receipts; no second storage path is created. |
| adr-2026-09-30-gate-local-review-finding-continuity#D2 | task | task-1, task-2, task-3, task-4, task-5, task-6, task-7, task-8, task-9, task-10 | The v3 migration reaches the existing leased atomic replacement and retains immutable original observations, subsequent observations, decisions by reference, repair facts, resolution/reopening evidence, and receipts; no second storage path is created. |
| adr-2026-09-30-gate-local-review-finding-continuity#D3 | task | task-14, task-15, task-16 | The integration fixture `S5H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a review contains criterion failures and NC findings, or as-built BLOCKED findings, PLAN_GAP findings, and nonblocking drift notes, when reconciliation is published, then every current finding has exactly one traceable result and every supplied prior case has an accounted-for outcome. |
| adr-2026-09-30-gate-local-review-finding-continuity#D4 | task | task-11, task-12, task-13 | The integration fixture `S4H1` in `src/conductor/test/engine/review-history-projection.test.ts` exercises the review-history projection and StepRunOptions dispatch boundary: Given a gate has open, resolved, absent, uncertain, and reopened cases, when its next review is dispatched, then its input includes each case with original/current evidence, applicable decision references, repair facts, resolution evidence, and any acknowledged legacy gap. |
| adr-2026-09-30-gate-local-review-finding-continuity#D5 | task | task-14, task-15, task-16, task-17, task-18, task-20, task-35, task-36, task-37 | The integration fixture `S5H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given a review contains criterion failures and NC findings, or as-built BLOCKED findings, PLAN_GAP findings, and nonblocking drift notes, when reconciliation is published, then every current finding has exactly one traceable result and every supplied prior case has an accounted-for outcome. |
| adr-2026-09-30-gate-local-review-finding-continuity#D6 | task | task-18, task-19, task-20, task-21, task-22, task-31 | The unit fixture `S6H1` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given an earlier resolved finding reappears with changed wording, order, or report-local label and unchanged underlying facts, when current evidence supports the same case and its resolution, then the repeat remains attached to that case and does not create a new unresolved obligation. |
| adr-2026-09-30-gate-local-review-finding-continuity#D7 | task | task-23, task-24, task-25, task-26, task-33 | Publication holds no lease across a provider call; the receipt recognizes its own post-publication revision and cannot invalidate itself merely because its batch appended history. |
| adr-2026-09-30-gate-local-review-finding-continuity#D8 | task | task-27, task-28, task-29, task-30 | The integration fixture `S9H1` in `src/conductor/test/engine/review-history-evidence.test.ts` exercises the review-history evidence importer at the existing repair owner: Given an existing repair path admits appended or existing tasks for a finding, when admission is recorded, then history binds the exact admitted tasks and repair identity to that finding without independently appending work. |
| adr-2026-09-30-gate-local-review-finding-continuity#D9 | task | task-31, task-32, task-33, task-38 | The unit fixture `S10H2` in `src/conductor/test/engine/review-history-completion.test.ts` exercises the shared review-history effective-completion reader: Given a repeated criterion failure is resolved by evidence of that exact criterion's current satisfaction, when the effective result is derived, then that source can clear while unrelated grades remain unchanged. |
| adr-2026-09-30-gate-local-review-finding-continuity#D10 | task | task-34, task-36, task-37, task-40 | The unit fixture `S11H2` in `src/conductor/test/engine/review-history-coordinator.test.ts` exercises the review-history coordinator and its gate-local publication transition: Given the configured reconciliation allowance is two attempts and one mechanical attempt failed before restart, when the resumed second attempt fails, then the same gate/input reaches exhaustion without resetting the allowance or charging BUILD/plan growth. |
| adr-2026-09-30-gate-local-review-finding-continuity#D11 | task | task-39, task-35 | Every history event declares a row in the existing exhaustive sink registry and is emitted through the existing ConductorEvent spine with execution context; no side log, watcher, timestamp inference, or second emitter/persister path supplies history authority. |
| adr-2026-09-30-gate-local-review-finding-continuity#D12 | no-change | none | D12 defines delivery/scope constraints and DECIDE-owned amendments rather than another BUILD mechanism. This spec applies those approved amendments; D1-D11 map every functional obligation above. Existing finish accompaniment requirements remain owned by that gate. No task changes another feature artifact, routing/budget policy, or cross-gate equivalence. |

## Verification and review record

- Forty tasks, five ordered delivery slices, all 89 happy/negative criteria covered. Each task has
  2–5 physical-line checks and explicit acyclic dependencies. Negative paths have named task/fixture
  ownership; no terminal whole-feature validation task is present.
- Fresh independent coverage judgment: round 1 asserts 89/89 claims. Supplemental contract checks
  passed fresh round 2 on all six affected claims; the evidence is kept under .pipeline.
- The plan-updated architecture diagram makes the approved checkpoint and group-join boundaries explicit and maps each responsibility to its owning tasks.
- Scope warning: this 40-task plan is at the upper end of the normal limit (roughly 2–3.5 hours at
  the harness's task granularity, excluding gate/review time). Five slices keep the implementation
  order visible; they remain one coordinated schema/authority migration, not independently shipped
  partial states. No oversized-plan exception is requested.

## Advisory overlap scan

Run with the union of all 49 declared paths and source-ref jstoup111/ai-conductor#2440. The network-enabled retry completed the dependency lookup. Report as rendered:

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/conductor.ts
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/engine/conductor.ts
Note: renames or name-only diffs may not be detected by this scan.
```

These two retained remote spec branches correspond to previously verified merged PRs #179 and #180; the shared conductor path is an advisory ownership overlap, not an unmet implementation dependency.

Authoring validation: production parsers accept all 40 task/check blocks, five dependency-ordered slices, 89 exact criterion rows, and 57 grounded ADR decision rows. Protected-target scan reports no violations. All five architecture diagrams render. No implementation or behavioral suite was run during this DECIDE pass. Operator plan/diagram acceptance is the next composer gate; coherence follows it.

> **Amended 2026-09-30 by #2440 (coherence check):** The D6 architecture mapping also cites Task 29, whose existing retention-before-clear check supplies the durable evidence consumed by Tasks 38 and 39. This corrects traceability only; all task checks and approved behavior are unchanged. The original mapping is retained below for the amendment record.
>
> | adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D6 | task | task-38, task-39 | The integration fixture `S12H1` in `src/conductor/test/engine/review-history-rendering.test.ts` exercises the review-history renderer consumed by current and shipped views: Given a finding is reconciled, reused, resolved, reopened, or uncertain, when its human-readable current/shipped view is produced, then it names the source and case references, reason, relevant repair outcome, and any acknowledged legacy gap without replacing the original reviewer evidence. |
