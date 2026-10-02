# Implementation Plan: PRD audit receives bounded inputs and returns validated typed verdicts

**Date:** 2026-09-30
**Source:** jstoup111/ai-conductor#2521; incorporates the remaining #2875 outcomes
**Stories:** .docs/stories/prd-audit-receives-bounded-inputs-and-returns-vali.md
**Conflict check:** Clean after operator-approved resolutions on 2026-09-30

## Technical Approach

Migrate PRD audit onto the shipped native-schema one-shot boundary. Add a bounded feature projection, typed judgment validator and atomic verdict store beside the as-built equivalents. The typed `.pipeline/prd-audit.json` is authoritative; its Markdown report is a derived human view. Resolve criterion/task/requirement references independently, keep incomplete evidence explicit, and preserve existing grade routes and operator-decision ownership. Integrate dispatch before migrating every consumer, then remove obsolete current-verdict Markdown parsing after the survivor checks pass.

Use the local as-built projection, contract and verdict-store patterns for feature resolution, schema-derived prompt rendering, discriminated validation and atomic replacement. These are semantic patterns, not exact-copy/rename declarations: PRD has different grades, partial-entry validation and widening ownership. Find them under `as-built-projection.ts`, `as-built-contract.ts`, `as-built-verdict-store.ts` and `step-runners-as-built*.test.ts`. Use the existing shared plan-task resolver, feature resolvers, nativeSchema invocation and widening entry/coordinator owners. No generic registry or replacement adapter is needed.

All production paths below are repo-relative. New focused test names are proposed beside existing fixtures. Faithful injected provider/process/filesystem boundaries and temporary local Git fixtures prove the behavior; no default test calls a real model, GitHub, ambient tmux or destructive external process. A task may reuse an existing fixture instead of duplicating it, provided its checks stay explicit. Unit-level foundations do not claim dispatch integration; the owner table below assigns that proof. Aggregate suites remain with test_suite.

## Scope and sequencing

33 tasks in three implementation slices, approximately 1–3 hours of scoped task work before managed review/runtime overhead. This exceeds the 20-task warning threshold. Splitting into separate features would leave competing verdict authorities; the approved architecture keeps the carrier migration together. Slices below organize implementation without implying independently publishable partial migrations. Each task is a focused RED/GREEN increment around an existing seam; if a verified seam change makes one exceed that scope, re-decompose during DECIDE rather than broadening a BUILD obligation.

The confirmed scope excludes new history capabilities, combined budgets, cross-gate equivalence and a generic step-contract platform. The only as-built functional change is missing-current-output diagnostics. Existing provider candidate policy, operator approval/refusal, grade routing and BUILD-dispatch charging remain authoritative.

> **Amended 2026-09-30 by #2521:** BUILD requires #2753 (kickback-cap remediation-to-BUILD settlement) to land first. Its approved ADR is present at this spec base, but its `pendingRepair` implementation is not: `readRemediationGateAppendBudget` still charges through the older append path. Preserve the approved future accounting contract after that prerequisite lands; do not implement #2753 inside this migration. Before spec publication, register #2753 as a native blocking dependency of #2521 so daemon scheduling enforces the order. Recheck the accounting seam against the delivered prerequisite before BUILD. This corrects the earlier description of BUILD-dispatch accounting as already implemented.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Projection, validation and persistence | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 |
| 2 | Dispatch, completion and routing | 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23 |
| 3 | Durable decisions and remaining consumers | 24, 25, 26, 27, 28, 29, 30, 31, 32, 33 |

## Tasks

### Task 1: Resolve feature obligations and explicit optional absence

**Story:** Story 1; c2
**Type:** happy-path
**Dependencies:** none
**Files:** `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/test/engine/prd-audit-projection.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Build the feature-scoped versioned projection through the existing active-plan, Stories, criterion, task and PRD resolvers. Reuse as-built-projection traits: independent authoritative resolution and structured fields; PRD-specific content replaces its architecture inputs.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Projection fixtures for technical work without PRD or prior history contain explicit absence fields plus every active story criterion and task completion condition; no obligation disappears with either optional source.
- Populated projection fixtures retain criterion identifiers and happy/negative kinds, task ownership and Done-when blocks, plan intent, path-qualified PRD requirements, available coherence rows, scoped changes and attributable original history.

### Task 2: Reject missing or foreign required sources

**Story:** Story 1; foundation for c1–c7, dispatch proof in Task 13
**Type:** negative-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/test/engine/prd-audit-projection.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Return typed preparation faults for each required resolver/read/parse failure; do not search unrelated artifacts as a fallback.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Preparation fixtures for unresolved active plan, unreadable sealed stories or required PRD, and unparseable criteria or task completion conditions identify the affected source and dimension and return no dispatchable projection.
- Fixtures containing valid foreign plan, story and history documents cannot replace a missing active-feature source; the builder returns a named preparation fault and no dispatchable projection.

### Task 3: Bound diff excerpts without shortening obligations

**Story:** Story 1; c3
**Type:** happy-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/test/engine/prd-audit-projection.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Use the as-built excerpt/omission design with 256 KiB per file and 512 KiB total; preserve read-only source locators and content digests.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Projection tests exceeding each diff cap emit omitted file paths and content digests with read-only inspection locators, while the full structured criterion/task/requirement sets remain equal to their independent source sets.
- At-limit excerpts are retained; over-limit file and total fixtures produce deterministic omission metadata rather than partial structured obligations.

### Task 4: Set corpus-based structured limits and refuse overflow

**Story:** Story 1; foundation for c1–c7, dispatch proof in Task 13
**Type:** negative-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/test/engine/prd-audit-projection.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Measure plan/criteria, applicable PRD intent, coherence and available-history corpus sizes at BUILD; round limits upward, use at least 256 KiB for plan and criteria, and allow component maxima plus envelope overhead in the total. Keep existing reconciliation caps separate.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Finite named constants record measured normal corpus maxima and limits; plan/criteria limits are at least 256 KiB and every normal measured input fits its dimension and the total envelope.
- Every structured-dimension and total-limit overflow fixture returns a diagnostic containing dimension, actual size and allowed limit, and yields no dispatchable or shortened replacement projection.

### Task 5: Reject corrupt or foreign present history

**Story:** Story 1; c6
**Type:** negative-path
**Dependencies:** Task 1
**Files:** `src/conductor/src/engine/prd-audit-projection.ts`, `src/conductor/test/engine/prd-audit-projection.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Read original cases, decisions and prior evidence through their existing validated owners; distinguish optional absence from present defects.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Corrupt, foreign-feature and unsupported-version history fixtures each identify the faulty source, leave its bytes unchanged for recovery and fail preparation rather than dispatching empty approved history.
- Absent history remains the explicit empty-history case from Task 1; existing tighter widening-context bounds remain in force.

### Task 6: Define judgment schema and legitimate grades

**Story:** Story 3; c15, c17
**Type:** happy-path
**Dependencies:** none
**Files:** `src/conductor/src/engine/prd-audit-contract.ts`, `src/conductor/test/engine/prd-audit-contract.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Own a versioned JSON Schema and render the shape from it. Keep criterion judgments and no-owner observations distinct; the engine assigns NC presentation ordinals.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Complete fixtures spanning PASS, FIXABLE, PLAN_GAP and OVER_SCOPE resolve each judgment to an independently supplied active criterion and retain evidence, rationale and permitted path-qualified requirement associations.
- Accepted FIXABLE fixtures resolve exactly one existing repair owner; valid no-owner entries retain OVER_SCOPE and an explicit closed intent relation, receive unique engine presentation ordinals, and those ordinals grant no semantic identity or operator authority.

### Task 7: Resolve citations and reject invalid repair ownership

**Story:** Story 3; c16, c19
**Type:** negative-path
**Dependencies:** Task 6
**Files:** `src/conductor/src/engine/prd-audit-contract.ts`, `src/conductor/test/engine/prd-audit-contract.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Feed structured story/ordinal references into the existing criterion normalization, and task reference arrays through resolvePlanTaskReference; never recreate numeric-only grammar.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Validator fixtures resolve letter-containing and nested story IDs with supported case normalization, remediation task IDs, tolerated annotations and multiple evidence-task citations under the shared rules.
- Invented criteria, unresolved task or requirement references, and zero/multiple FIXABLE owners each reject the entry with the exact reference or ownership defect named; rejected entries are absent from the validated repair inputs.

### Task 8: Retain valid siblings and reject every duplicate carrier

**Story:** Story 3; c18, c20
**Type:** negative-path
**Dependencies:** Task 6
**Files:** `src/conductor/src/engine/prd-audit-contract.ts`, `src/conductor/test/engine/prd-audit-contract.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Validate independent entries only after recognizing a supported root; collect entry/field diagnostics and reject all normalized duplicates.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- A supported readable envelope containing valid siblings and an invalid entry retains every valid sibling, names the rejected entry and defective field, and marks the result incomplete.
- Duplicate normalized criterion fixtures reject every carrier, preserve unrelated entries, name the duplicated criterion and cannot produce a complete passing result by selecting one carrier.

### Task 9: Check criterion and requirement completeness

**Story:** Story 3; c21, c23
**Type:** negative-path
**Dependencies:** Task 7, Task 8
**Files:** `src/conductor/src/engine/prd-audit-contract.ts`, `src/conductor/test/engine/prd-audit-contract.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Compare against complete resolved input sets; retain the existing PRD-story traceability exception for valid criterion PLAN_GAP evidence without inventing a requirement-only finding.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Omitted required criteria, invalid grades and missing/invalid OVER_SCOPE relations produce explicit named incompleteness; their validation status cannot be changed by scope acceptance or negative-gap recording.
- An uncovered resolved PRD requirement remains an explicit blocker unless valid existing criterion PLAN_GAP evidence accounts for it; fixtures create no fabricated criterion, no-owner substitute or new repair authority.

### Task 10: Reject unusable roots and reviewer authority fields

**Story:** Story 3; c22, c24
**Type:** negative-path
**Dependencies:** Task 6
**Files:** `src/conductor/src/engine/prd-audit-contract.ts`, `src/conductor/test/engine/prd-audit-contract.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Keep root-unusable outcomes distinct from readable incomplete results; use only the terminal structured result and reject unsupported authority fields.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Missing/malformed terminal envelopes and unsupported root versions produce no new usable judgment; fixtures containing plausible chat and intermediate tool results yield no replacement findings.
- Reviewer-supplied accept/refuse, engine identity, code stamp or recorded-disposition fields produce a named mechanical diagnostic and grant no operator or engine authority.

### Task 11: Persist typed evidence and render the corresponding report

**Story:** Story 4; c25
**Type:** happy-path
**Dependencies:** Task 6, Task 8, Task 9, Task 10
**Files:** `src/conductor/src/engine/prd-audit-verdict-store.ts`, `src/conductor/test/engine/prd-audit-verdict-store.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Follow as-built-verdict-store atomic replacement and discriminated reader traits; persist original judgment, diagnostics and engine metadata separately from derived recorded dispositions.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Store round trips preserve complete and incomplete validated judgments, their diagnostics, engine-owned attempt identity and reviewed code stamp; the generated human report reflects the same judgment.
- The success result is returned only after typed persistence and report rendering complete; neither reviewer metadata nor an existing old file supplies the current attempt identity.

### Task 12: Surface persistence, rendering and reader faults

**Story:** Story 4; c28, c29, c30
**Type:** negative-path
**Dependencies:** Task 11
**Files:** `src/conductor/src/engine/prd-audit-verdict-store.ts`, `src/conductor/test/engine/prd-audit-verdict-store.test.ts`

**Steps:**
1. Add or adapt unit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Inject filesystem and renderer failures at the store boundary; do not catch them as absent or parse the human report.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- An authority-write failure reports persistence failure and cannot count the prior verdict as current output; a post-persistence renderer failure names the failed report output, reports no successful dispatch and leaves durable operator decisions byte-identical.
- Unreadable, corrupt and unsupported typed-state fixtures beside plausible Markdown return a named invalid-evidence diagnostic and never return report-derived findings.

### Task 13: Connect PRD projection and native-schema dispatch for both adapters

**Story:** Story 1, Story 2; c1, c8, c9, c10, c4, c5, c7
**Type:** happy-path
**Dependencies:** Task 2, Task 3, Task 4, Task 5, Task 9, Task 10, Task 11
**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners-prd-audit.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Extend executeProviderAwareSkillOneShot using the as-built invocation traits, without a new provider adapter. Own projection→dispatch→validation→persistence integration through DefaultStepRunner.run, with injected adapter process boundaries.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- DefaultStepRunner.run fixtures dispatch one versioned evidence input containing every independently expected authoritative criterion and happy/negative kind, task owner and completion condition, plan intent, applicable requirement and coherence mapping, scoped change and attributable available history.
- Claude and Codex adapter fixtures request the same engine-owned native output schema and engine-rendered evidence/judgment responsibilities; equal valid judgments settle to equivalent validated findings and gate outcomes apart from engine attempt metadata.
- Auto and managed interactive run fixtures invoke a fresh one-shot with interactive false; returned terminal judgment is validated, persisted with the actual attempt and rendered before success, while standalone human invocation remains available.
- DefaultStepRunner fixtures for unresolved active plan, unreadable sealed stories or required PRD, unparseable criteria/task completion conditions, and otherwise valid foreign replacement plan/stories/history all stop before provider invocation with the affected source and dimension named; unrelated input never substitutes for the missing active authority.
- DefaultStepRunner fixtures exceeding each structured engineering limit or the total stop before invocation with dimension, actual size and limit and dispatch no shortened obligation set.

### Task 14: Enforce native capability and deterministic preparation failures

**Story:** Story 2, Story 5; c11, c34
**Type:** negative-path
**Dependencies:** Task 13
**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners-prd-audit.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Route nativeSchema capability and typed projection faults through existing candidate preparation and unretryable outcomes.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- A candidate lacking native structured output records zero invocations; existing candidate policy either invokes a capable candidate or reports the missing capability and its recovery action.
- Missing required input and unsupported required-capability fixtures name the input/capability and recovery and terminate without repeating an invocation that cannot succeed.

### Task 15: Preserve provider error precedence and cleanup

**Story:** Story 2, Story 5; c13, c14, c38
**Type:** negative-path
**Dependencies:** Task 13
**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners-prd-audit.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Use existing provider result facets and cleanup/finally paths; faithful fakes exercise auth, rate, unavailable model, unresolved skill, setup failure and timeout.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Auth, rate-limit, model-unavailable and unresolved-skill fixtures retain their dedicated classification and recovery before missing-judgment handling; generic no-verdict text never replaces them.
- Setup-failure and timeout fixtures settle through their existing bounded handling and release invocation scratch resources, with no accepted audit for the failed attempt.

### Task 16: Name absent current output for PRD and as-built

**Story:** Story 2, Story 5; c12, c32, c35
**Type:** negative-path
**Dependencies:** Task 13
**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/prd-audit-handshake.test.ts`, `src/conductor/test/engine/as-built-dispatch-classification.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Extend the existing verdictDispatchHandshake typed outcomes, not diagnostic text matching. Handle structured-result-missing explicitly for both validators and preserve more specific provider facets.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- PRD and as-built handshake fixtures with no terminal judgment name the step, current attempt and expected output and explicitly state that this dispatch produced no verdict.
- A successful prose-only PRD response remains missing terminal judgment even when chat has a well-formatted verdict; older typed artifacts with refreshed mtime or separately refreshed stamps are rejected as this dispatch output.
- Terminal success, error and halt paths retain their handshake observation through existing lifecycle/event seams.

### Task 17: Use bounded serial retry for absent or invalid judgments

**Story:** Story 5; c33, c36
**Type:** negative-path
**Dependencies:** Task 14, Task 15, Task 16
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/prd-audit-retry.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Connect runner/handshake outcomes to the existing absent-result lane. Use a bounded conductor fixture and fake providers; no new budgets or message matching.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- The serial conductor fixture retries missing or invalid reviewer output only within the resolved existing allowance, creates a fresh invocation each time and accepts only the new attempt valid result.
- Exhausted missing/invalid-result fixtures halt needs-human with the current-output reason and zero synthetic substantive findings or remediation/BUILD dispatches; clearing that halt permits the existing fresh-review recovery without hand-deleting old evidence.

### Task 18: Join no-verdict branches without inventing repair work

**Story:** Story 5; c37
**Type:** negative-path
**Dependencies:** Task 17
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/prd-audit-group-join.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Own typed PRD→validation-group join integration, preserving group-core retry ownership and independently verified sibling commits.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- A real validation-group join fixture exhausts the PRD member allowance without a verdict, emits the existing no-verdict halt and creates no remediation finding for that member.
- The same join retains done only for siblings whose successful dispatch and objective current gate evidence the join verified; failed, handshake-invalid and unverified siblings are not retained.

### Task 19: Read typed completeness in artifact completion

**Story:** Story 5, Story 6; c39, c40
**Type:** happy-path
**Dependencies:** Task 9, Task 11
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/prd-audit-completion.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Make the PRD completion predicate consume one validated reader. Own store→completion integration; retain complete/incomplete discrimination before grade overrides.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Production completion fixtures pass complete clean criterion evidence under existing completion and pre-dispatch preservation rules, while rejected-entry results remain blocked with each diagnostic named.
- Applying scope or negative-gap override routes to incomplete fixtures never yields PASS or an inferred user decision; the reader retains the original validated findings and defects.

### Task 20: Feed typed FIXABLE evidence into bounded repair admission

**Story:** Story 6; c41, c44, c45
**Type:** happy-path
**Dependencies:** Task 7, Task 19
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/prd-audit-kickback-typed.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Own typed finding→planRemediation admission integration. Preserve existing-task/restage and append paths, pendingRepair receipts and charging only at BUILD dispatch.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Conductor repair fixtures admit valid FIXABLE evidence with an active owner to the established append or existing-task disposition; append retains bounded growth, existing-task adds no growth, and each charges its lap only at admitted BUILD dispatch.
- An unowned proposed repair receives no authority from Markdown, a requirement association or a no-owner observation and produces no admitted repair work.
- Exhausted lap and growth fixtures keep pending repair tasks/receipt and the existing cap halt at BUILD dispatch, charge nothing and do not reset allowances during typed conversion.

### Task 21: Route typed PLAN_GAP by authoritative criterion kind

**Story:** Story 6; c42, c46
**Type:** happy-path
**Dependencies:** Task 19
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/prd-audit-plan-gap-typed.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Reuse the active criterion happy/negative classification and halt_all policy; never infer it from prose or task numbering.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Conductor fixtures route happy-path PLAN_GAP to the existing human plan decision and negative-path PLAN_GAP to recorded shipment unless halt-all configuration is enabled.
- Unresolvable criterion kind and halt-all fixtures halt and never use the record-and-ship branch.

### Task 22: Classify scope without masking other blockers

**Story:** Story 6; c43, c47
**Type:** happy-path
**Dependencies:** Task 19
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/accepted-widenings.ts`, `src/conductor/test/engine/prd-audit-scope-typed.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Supply typed relations to existing widening classification; keep outside-visible decisions and scope precedence over repair unchanged.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Typed within-intent and outside-harmless OVER_SCOPE fixtures are recorded and non-blocking under existing policy without minting new operator approval authority.
- Mixed blocking grades or incomplete evidence remain blocked when a recordable PLAN_GAP or widening is present; accepted/recordable items never override rejected entries or other blockers.
- Outside-visible pending/refused decisions retain the original offer/revision halt behavior and scope-before-remediation precedence.

### Task 23: Persist recorded dispositions separately from judgment

**Story:** Story 4; c26, c31
**Type:** happy-path
**Dependencies:** Task 11, Task 21, Task 22
**Files:** `src/conductor/src/engine/prd-audit-verdict-store.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/prd-audit-recorded-projection.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Own routing→typed disposition projection integration; regenerate the human view through the store after deriving dispositions from current authority.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- PLAN_GAP and OVER_SCOPE projection fixtures preserve original judgment separately from recorded grade/decision/rationale and attributable operator authority in display and shipment data.
- A failed disposition projection/write leaves routing blocked with that projection named, without claiming recorded acceptance or a deliverable gap; original decisions remain available.

### Task 24: Capture original decisions before typed review entry

**Story:** Story 7; c48, c51, c54
**Type:** happy-path
**Dependencies:** Task 13
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/prd-widening-entry.ts`, `src/conductor/test/engine/prd-widening-entry.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Keep preparePrdWideningEntry ahead of dispatch on serial and group entries, reusing its migration and lease owners rather than moving decisions into the new verdict store.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- PRD dispatch-entry fixtures show accepted/refused original cases captured with order, attribution/provenance and explicit reversal chain intact before current finding reconciliation.
- Replaying an old cleared acceptance after a newer explicit refusal leaves that refusal effective; corrupt authority and failed lease/write cases name the recovery fault and never become empty approved history.

### Task 25: Reconcile typed no-owner sources against original cases

**Story:** Story 7; c49, c53
**Type:** happy-path
**Dependencies:** Task 22, Task 24
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/prd-widening-context.ts`, `src/conductor/src/engine/prd-widening-coordinator.ts`, `src/conductor/test/engine/prd-widening-projection.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Own typed verdict→widening coordinator integration. Preserve source identity ingredients, historical snapshots, case-domain isolation and existing semantic relationship judgment.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Current no-owner sources established as the same case retain original accept/refuse authority despite rewording or changed NC presentation ordinal, through the production reconciliation/classification path.
- Uncertain and different-case fixtures inherit no unrelated approval, retain original decisions and create no BUILD work for a no-owner finding.

### Task 26: Bind reconciliation reuse to canonical typed source identity

**Story:** Story 7; c50, c52, c55
**Type:** negative-path
**Dependencies:** Task 25
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/prd-widening-context.ts`, `src/conductor/src/engine/prd-widening-coordinator.ts`, `src/conductor/test/engine/prd-widening-projection.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Replace current Markdown digesting with canonical source-bearing typed content excluding derived dispositions; bump the projection contract version and keep optimistic freshness checks.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Unchanged source/code/feature/decision revision and contract-version fixtures reuse existing relationships with zero new semantic judgment; rerendering recorded dispositions preserves that reuse.
- Concurrent source or decision-revision changes reject publication of stale relationships and retain original decisions byte-identically.
- An old projection contract version cannot reuse its relationships under the new digest convention; original decisions/cases survive for fresh reconciliation with no reapproval caused solely by presentation drift.

### Task 27: Preserve typed verdicts across resume and proven rebase

**Story:** Story 8; c56, c57, c60
**Type:** happy-path
**Dependencies:** Task 19, Task 26
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/gate-code-validity.ts`, `src/conductor/test/engine/prd-audit-preservation.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Own typed reader→code-validity→resume/rebase integration. Reuse gate surfaces, engine rebase translation and selective-replay validation without changing judge identity.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Conductor resume fixtures with complete typed evidence and valid reviewed-input/code-stamp/current-decision checks reuse the audit with zero reviewer calls before a new dispatch.
- Valid engine rebase translation and selective replay fixtures preserve the same original judgment; gate-relevant story and PRD changes invalidate that preservation.
- Relevant input change, unreachable/unexplained stamp, uncomputable validity and currently blocking decision fixtures all reject reuse and prevent the old PASS from authorizing publication.

### Task 28: Require fresh audit for legacy and opted-out evidence

**Story:** Story 8; c59, c61
**Type:** negative-path
**Dependencies:** Task 27
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/gate-code-validity.ts`, `src/conductor/test/engine/prd-audit-preservation.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Remove the PRD legacy/opt-out mtime route; do not convert historical reports. Keep operator history and legacy-clear capture inputs intact.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Legacy Markdown-only lifecycle fixtures require a new audit while accepted-widening decisions and legacy-clear import bytes survive unchanged.
- With code-validity preservation disabled, legacy or stale PRD evidence cannot satisfy completion through Markdown presence or timestamp freshness.

### Task 29: Clear and restore the typed evidence family on sweep and rewind

**Story:** Story 8; c62
**Type:** negative-path
**Dependencies:** Task 27
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/rewind.ts`, `src/conductor/test/engine/rewind-prd-audit-pair.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Extend the existing derived evidence family and rewind rollback snapshot; preserve immutable original offers and decision stores.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Stale sweep and operator rewind fixtures treat the typed verdict and derived report as one invalidated evidence family while preserving durable widening decisions and original offers.
- Injected rewind failure restores both removed evidence files byte-identically alongside existing step-state rollback, and reports the original failure ahead of any rollback failure.

### Task 30: Publish recorded findings from typed authority

**Story:** Story 8; c58, c63
**Type:** happy-path
**Dependencies:** Task 23, Task 27
**Files:** `src/conductor/src/engine/finish-publication-production.ts`, `src/conductor/src/engine/shipment-association.ts`, `src/conductor/test/engine/finish-publication-production-wiring.test.ts`, `src/conductor/test/engine/shipment-association.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Own typed reader→pre-finish fence→shipment integration. Replace report-file parsing at production publication and shared shipment collection.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Production publication fixtures pass the same validated typed evidence through the pre-finish fence and shipment collection and retain recorded grade, decision and rationale in the shipped record.
- Forged recorded Markdown findings and plausible reports beside unusable typed evidence never reach shipped findings or satisfy the publication fence.

### Task 31: Retire Markdown verdict parsing after consumer migration

**Story:** Story 4; c27
**Type:** refactor
**Dependencies:** Task 18, Task 20, Task 21, Task 22, Task 23, Task 26, Task 28, Task 29, Task 30
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/accepted-widenings.ts`, `src/conductor/src/engine/shipment-association.ts`, `src/conductor/test/engine/prd-audit-authority.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Remove parsePrdAuditReport and obsolete machine table/relation parsing after survivor fixtures pass; migrate incidental behavior fixtures and retire only parser-format tests. Preserve historical snapshot reading. No directory deletion or absence test.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Consumer survivor fixtures edit only human report wording/presentation while keeping typed evidence and current decisions fixed; production completion, routing and publication return the same substantive outcomes.
- Fixtures with typed evidence absent or invalid cannot recover findings from either legacy Markdown or forged recorded sections; original history remains readable as historical evidence only.

### Task 32: Align managed and standalone reviewer responsibilities

**Story:** Story 9; c64, c65, c67
**Type:** happy-path
**Dependencies:** Task 13
**Files:** `skills/prd-audit/SKILL.md`, `skills/architecture-review/SKILL.md`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners-prd-audit.test.ts`

**Steps:**
1. Add or adapt focused integration fixtures for the named checks; confirm the new behavior fails before implementation.
2. Retain judgment guidance, standalone human review and existing project-code/write restrictions; remove managed report/store-write permissions and machine recipes. Own provider-rendered role integration, using schema-derived shape rather than prose grammar.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Managed PRD invocation fixtures receive engine-owned bounded input/output shape and skill-owned judgment guidance requiring terminal structured judgment, with no instruction to persist verdicts or accepted/refused decisions.
- Standalone invocation fixtures can present human judgments without asserting current managed gate evidence.
- PRD and as-built reviewer/delegate brief fixtures retain bans on executing project tests/builds/lint/modules and unrelated writes, and require all delegated work to finish before the reviewer returns.

### Task 33: Enforce the migrated provider skill contract

**Story:** Story 9; c66, c68, c69
**Type:** negative-path
**Dependencies:** Task 32
**Files:** `test/test_provider_skill_contracts.sh`, `skills/prd-audit/SKILL.md`

**Steps:**
1. Add or adapt contract audit fixtures for the named checks; confirm the new behavior fails before implementation.
2. Extend the established semantic contract audit with positive and negative fixtures; avoid phrase matching unrelated prose and removal-absence assertions.
3. Run the focused fixtures to GREEN and commit the scoped behavior change.

**Done when:**
- Existing contract-audit fixtures permit judgment guidance and standalone human presentation while retaining engine ownership of the machine contract.
- Fixtures granting managed reviewer acceptance/refusal writes or substituting report authoring for terminal judgment are rejected for conflicting output responsibility.
- Fixtures reintroducing engine-input recipes or machine-output table grammar into the migrated PRD skill fail the contract audit with the relevant contract violation.

## Integration proof owners

Each row assigns one changed behavior boundary; other tasks test constituent rules or distinct error conditions.

| Changed production boundary | Owning task | Entry point / observation |
| --- | --- | --- |
| Feature artifacts → projection → native provider → validated persistence | 13 | DefaultStepRunner.run, real projection/validator/store with adapter fakes |
| Candidate capability and deterministic preparation refusal | 14 | Existing candidate preparation, zero unsupported invocations |
| Adapter failure precedence and cleanup | 15 | DefaultStepRunner settlement, classified result and scratch cleanup |
| Current PRD/as-built output → handshake | 16 | verdictDispatchHandshake on terminal outcomes |
| Absent judgment → serial retry/halt | 17 | Bounded conductor serial fixture |
| Absent judgment → parallel join and sibling retention | 18 | Validation-group join |
| Typed evidence → artifact completion | 19 | Production PRD completion predicate |
| Typed FIXABLE → admission and BUILD charge | 20 | Conductor remediation and BUILD transition |
| Typed PLAN_GAP → human or recorded route | 21 | Conductor plan-gap route |
| Typed scope → classification and mixed blockers | 22 | Shared classifier and conductor scope route |
| Recorded dispositions → typed projection and human view | 23 | Routing projection through verdict store |
| Original operator clear → audit entry | 24 | Serial/group pre-review entry |
| Typed current source → semantic reconciliation | 25 | Widening coordinator/classification |
| Canonical source identity → reconciliation reuse/publication | 26 | Coordinator optimistic commit boundary |
| Typed authority → resume/rebase preservation | 27 | Conductor resume and existing preservation readers |
| Legacy/disabled preservation → fresh review selection | 28 | Completion before dispatch |
| Evidence family → cleanup/rollback | 29 | Sweep and operator rewind |
| Typed recorded findings → fence/shipment | 30 | Production finish publication and shared shipment collection |
| Human report → no machine authority after parser removal | 31 | Completion, routing and publication survivors |
| Managed/standalone skill role → invocation contract | 32 | Provider-rendered skill invocation |
| Skill machine-responsibility violations → contract audit | 33 | Existing provider-skill contract audit |

## Coverage Check

All 69 criteria are diff-local: their contract is the feature's reader/dispatch/routing behavior under specified fixture inputs, including cases where other commits change those inputs. No criterion claims that arbitrary future commits cannot change runtime behavior. Quoted checks are exact fragments of the cited task's Done when block. The c-numbers are review handles only; the Criterion column is the complete extracted story text.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an active plan with sealed stories, applicable PRD intent, coherence mapping, changes and available prior findings/decisions, when an audit is prepared, then the reviewer receives one versioned input containing every authoritative criterion and its happy/negative classification, task ownership and completion conditions, plan intent, applicable requirements and mappings, changes, and attributable available history. | 13 | "DefaultStepRunner.run fixtures dispatch one versioned evidence input containing every independently expected authoritative criterion and happy/negative kind, task owner and completion condition, plan intent, applicable requirement and coherence mapping, scoped change and attributable available history." | diff-local |
| Story 1 happy: Given technical-track work with no applicable PRD and no prior history, when an audit is prepared, then those absences are explicit and the complete story/task evidence remains available. | 1 | "Projection fixtures for technical work without PRD or prior history contain explicit absence fields plus every active story criterion and task completion condition; no obligation disappears with either optional source." | diff-local |
| Story 1 happy: Given changed-source excerpts that exceed the permitted diff capacity, when the audit is prepared, then the omitted files are identified with their content identity and remain available for read-only inspection, while structured obligations stay complete. | 3 | "Projection tests exceeding each diff cap emit omitted file paths and content digests with read-only inspection locators, while the full structured criterion/task/requirement sets remain equal to their independent source sets." | diff-local |
| Story 1 negative: Given an unresolved active plan, an unreadable sealed story/required PRD, or unparseable required criteria/task completion conditions, when preparation runs, then the audit stops before provider invocation with the affected source and dimension named. | 13 | "DefaultStepRunner fixtures for unresolved active plan, unreadable sealed stories or required PRD, unparseable criteria/task completion conditions, and otherwise valid foreign replacement plan/stories/history all stop before provider invocation with the affected source and dimension named; unrelated input never substitutes for the missing active authority." | diff-local |
| Story 1 negative: Given a required structured input exceeding its configured engineering limit, when preparation runs, then it stops before invocation with the dimension, actual size and limit; it does not dispatch a shortened obligation set. | 13 | "DefaultStepRunner fixtures exceeding each structured engineering limit or the total stop before invocation with dimension, actual size and limit and dispatch no shortened obligation set." | diff-local |
| Story 1 negative: Given present history that is corrupt, foreign to the feature or of an unsupported version, when preparation runs, then it names the faulty source and preserves it for recovery rather than treating it as empty history. | 5 | "Corrupt, foreign-feature and unsupported-version history fixtures each identify the faulty source, leave its bytes unchanged for recovery and fail preparation rather than dispatching empty approved history." | diff-local |
| Story 1 negative: Given another feature's otherwise valid plan, stories or history in the repository, when this feature's audit is prepared, then that unrelated material cannot substitute for its unresolved authoritative input. | 13 | "DefaultStepRunner fixtures for unresolved active plan, unreadable sealed stories or required PRD, unparseable criteria/task completion conditions, and otherwise valid foreign replacement plan/stories/history all stop before provider invocation with the affected source and dimension named; unrelated input never substitutes for the missing active authority." | diff-local |
| Story 2 happy: Given either supported provider, when managed PRD audit runs, then the invocation requests the engine-owned native structured-output contract and receives the same engine-rendered evidence and judgment responsibilities. | 13 | "DefaultStepRunner.run fixtures dispatch one versioned evidence input containing every independently expected authoritative criterion and happy/negative kind, task owner and completion condition, plan intent, applicable requirement and coherence mapping, scoped change and attributable available history." | diff-local |
| Story 2 happy: Given auto mode or interactive conduct mode, when the managed audit dispatches, then it obtains its judgment through a fresh one-shot invocation while standalone interactive skill use remains available for human review. | 13 | "DefaultStepRunner.run fixtures dispatch one versioned evidence input containing every independently expected authoritative criterion and happy/negative kind, task owner and completion condition, plan intent, applicable requirement and coherence mapping, scoped change and attributable available history." | diff-local |
| Story 2 happy: Given equal valid judgments returned by the two provider fixtures, when their audits settle, then they yield equivalent validated findings and gate behavior apart from engine-owned attempt metadata. | 13 | "DefaultStepRunner.run fixtures dispatch one versioned evidence input containing every independently expected authoritative criterion and happy/negative kind, task owner and completion condition, plan intent, applicable requirement and coherence mapping, scoped change and attributable available history." | diff-local |
| Story 2 negative: Given a selected candidate without native structured-output capability, when audit dispatch is prepared, then that candidate is not invoked without the capability and the existing candidate policy either selects a capable candidate or reports the missing capability and recovery. | 14 | "A candidate lacking native structured output records zero invocations; existing candidate policy either invokes a capable candidate or reports the missing capability and its recovery action." | diff-local |
| Story 2 negative: Given a successful prose-only provider response, when the managed audit settles, then a well-formatted chat verdict cannot substitute for the missing terminal structured judgment. | 16 | "PRD and as-built handshake fixtures with no terminal judgment name the step, current attempt and expected output and explicitly state that this dispatch produced no verdict." | diff-local |
| Story 2 negative: Given authentication failure, rate limiting, model unavailability or an unresolved skill command, when the adapter reports that condition, then its existing dedicated handling takes precedence over a generic missing-judgment diagnosis. | 15 | "Auth, rate-limit, model-unavailable and unresolved-skill fixtures retain their dedicated classification and recovery before missing-judgment handling; generic no-verdict text never replaces them." | diff-local |
| Story 2 negative: Given a provider invocation that times out or fails during setup, when it settles, then its existing cleanup and bounded failure handling complete without leaving that attempt accepted as an audit. | 15 | "Auth, rate-limit, model-unavailable and unresolved-skill fixtures retain their dedicated classification and recovery before missing-judgment handling; generic no-verdict text never replaces them." | diff-local |
| Story 3 happy: Given a complete valid set of criterion judgments using PASS, FIXABLE, PLAN_GAP and OVER_SCOPE, when it is validated, then each judgment resolves to its active criterion and retains its evidence, rationale and permitted requirement associations. | 6 | "Complete fixtures spanning PASS, FIXABLE, PLAN_GAP and OVER_SCOPE resolve each judgment to an independently supplied active criterion and retain evidence, rationale and permitted path-qualified requirement associations." | diff-local |
| Story 3 happy: Given active story IDs containing letters or nested numbering and active task IDs including remediation IDs, when judgments cite them, then the references resolve under the existing shared rules, including supported case normalization and multiple evidence-task citations. | 7 | "Validator fixtures resolve letter-containing and nested story IDs with supported case normalization, remediation task IDs, tolerated annotations and multiple evidence-task citations under the shared rules." | diff-local |
| Story 3 happy: Given a FIXABLE judgment, when it is accepted, then exactly one existing task is identified as its repair owner; no-owner scope observations instead retain OVER_SCOPE with an explicit intent relation and receive only a presentation ordinal. | 6 | "Complete fixtures spanning PASS, FIXABLE, PLAN_GAP and OVER_SCOPE resolve each judgment to an independently supplied active criterion and retain evidence, rationale and permitted path-qualified requirement associations." | diff-local |
| Story 3 happy: Given independently valid entries beside an invalid entry in a readable supported result envelope, when validation runs, then valid siblings remain available with a diagnostic identifying the rejected entry and field, and the result remains incomplete. | 8 | "A supported readable envelope containing valid siblings and an invalid entry retains every valid sibling, names the rejected entry and defective field, and marks the result incomplete." | diff-local |
| Story 3 negative: Given an invented criterion, unresolved task or requirement reference, or a FIXABLE entry with zero or multiple owners, when validation runs, then that entry is rejected with its reference or ownership defect named and cannot become repair work. | 7 | "Validator fixtures resolve letter-containing and nested story IDs with supported case normalization, remediation task IDs, tolerated annotations and multiple evidence-task citations under the shared rules." | diff-local |
| Story 3 negative: Given duplicated normalized criterion references, when validation runs, then every carrier of that duplicate is rejected and the gate cannot pass by choosing one arbitrarily. | 8 | "A supported readable envelope containing valid siblings and an invalid entry retains every valid sibling, names the rejected entry and defective field, and marks the result incomplete." | diff-local |
| Story 3 negative: Given an omitted required criterion, an invalid grade, or an absent/invalid OVER_SCOPE intent relation, when validation runs, then the resulting incompleteness is explicit and cannot be accepted through a scope or negative-gap override. | 9 | "Omitted required criteria, invalid grades and missing/invalid OVER_SCOPE relations produce explicit named incompleteness; their validation status cannot be changed by scope acceptance or negative-gap recording." | diff-local |
| Story 3 negative: Given a missing/malformed result envelope or unsupported root version, when settlement runs, then there is no new usable judgment and neither chat nor intermediate tool output is scraped for replacement findings. | 10 | "Missing/malformed terminal envelopes and unsupported root versions produce no new usable judgment; fixtures containing plausible chat and intermediate tool results yield no replacement findings." | diff-local |
| Story 3 negative: Given a resolved PRD requirement lacking story coverage, when coverage is checked, then it remains an explicit blocking gap unless valid existing criterion PLAN_GAP evidence accounts for it; the audit cannot invent a criterion or a new repair authority. | 9 | "Omitted required criteria, invalid grades and missing/invalid OVER_SCOPE relations produce explicit named incompleteness; their validation status cannot be changed by scope acceptance or negative-gap recording." | diff-local |
| Story 3 negative: Given reviewer fields claiming operator acceptance, refusal, engine identity or recorded disposition, when validation runs, then those claims grant no authority and the offending unsupported fields produce a mechanical diagnostic. | 10 | "Missing/malformed terminal envelopes and unsupported root versions produce no new usable judgment; fixtures containing plausible chat and intermediate tool results yield no replacement findings." | diff-local |
| Story 4 happy: Given a validated current-dispatch judgment, when settlement succeeds, then the engine persists it with its own attempt identity and reviewed code stamp and produces the corresponding human-readable report. | 11 | "Store round trips preserve complete and incomplete validated judgments, their diagnostics, engine-owned attempt identity and reviewed code stamp; the generated human report reflects the same judgment." | diff-local |
| Story 4 happy: Given recorded PLAN_GAP or OVER_SCOPE dispositions, when the engine projects them for display and shipment, then the original judgment remains distinguishable from recorded dispositions and attributable operator authority. | 23 | "PLAN_GAP and OVER_SCOPE projection fixtures preserve original judgment separately from recorded grade/decision/rationale and attributable operator authority in display and shipment data." | diff-local |
| Story 4 happy: Given a report whose wording or presentation is edited after a valid judgment, when completion, routing or publication reads the audit, then its substantive result still follows the authoritative typed evidence and current decision state. | 31 | "Consumer survivor fixtures edit only human report wording/presentation while keeping typed evidence and current decisions fixed; production completion, routing and publication return the same substantive outcomes." | diff-local |
| Story 4 negative: Given failure writing the authoritative verdict, when settlement completes, then it reports a persistence failure and cannot count an older verdict as this dispatch's output. | 12 | "An authority-write failure reports persistence failure and cannot count the prior verdict as current output; a post-persistence renderer failure names the failed report output, reports no successful dispatch and leaves durable operator decisions byte-identical." | diff-local |
| Story 4 negative: Given a report-render failure after typed persistence, when settlement completes, then it reports that failed output step and does not claim successful dispatch; durable operator decisions are unchanged. | 12 | "An authority-write failure reports persistence failure and cannot count the prior verdict as current output; a post-persistence renderer failure names the failed report output, reports no successful dispatch and leaves durable operator decisions byte-identical." | diff-local |
| Story 4 negative: Given unreadable, corrupt or unsupported typed evidence alongside a plausible Markdown report, when a consumer reads the audit, then it rejects the typed evidence with a named diagnostic and cannot fall back to the report. | 12 | "An authority-write failure reports persistence failure and cannot count the prior verdict as current output; a post-persistence renderer failure names the failed report output, reports no successful dispatch and leaves durable operator decisions byte-identical." | diff-local |
| Story 4 negative: Given failure while recording a disposition, when routing attempts to settle the gate, then it remains blocked with the affected projection named rather than claiming a recorded acceptance or deliverable gap. | 23 | "PLAN_GAP and OVER_SCOPE projection fixtures preserve original judgment separately from recorded grade/decision/rationale and attributable operator authority in display and shipment data." | diff-local |
| Story 5 happy: Given either managed PRD audit or the already-typed as-built review produces no terminal judgment, when the dispatch is evaluated, then its diagnostic explicitly names that step, the current attempt and expected output and explains that this dispatch produced no verdict. | 16 | "PRD and as-built handshake fixtures with no terminal judgment name the step, current attempt and expected output and explicitly state that this dispatch produced no verdict." | diff-local |
| Story 5 happy: Given a retryable missing or invalid reviewer result and remaining allowance, when the existing retry path runs, then it uses a fresh invocation and accepts only that new attempt's valid output. | 17 | "The serial conductor fixture retries missing or invalid reviewer output only within the resolved existing allowance, creates a fresh invocation each time and accepts only the new attempt valid result." | diff-local |
| Story 5 happy: Given deterministic missing input or unsupported required capability, when the failure is handled, then it identifies the input/capability and recovery without repeating an invocation that cannot succeed. | 14 | "A candidate lacking native structured output records zero invocations; existing candidate policy either invokes a capable candidate or reports the missing capability and its recovery action." | diff-local |
| Story 5 negative: Given an older verdict with a recently modified timestamp or refreshed independent stamp, when a new dispatch produces no verdict, then the older judgment is not accepted for the new attempt. | 16 | "PRD and as-built handshake fixtures with no terminal judgment name the step, current attempt and expected output and explicitly state that this dispatch produced no verdict." | diff-local |
| Story 5 negative: Given retries repeatedly produce no usable result, when the existing allowance is exhausted, then the feature halts needs-human with the missing/invalid current-output reason and no synthetic substantive gap. | 17 | "The serial conductor fixture retries missing or invalid reviewer output only within the resolved existing allowance, creates a fresh invocation each time and accepts only the new attempt valid result." | diff-local |
| Story 5 negative: Given a validation-group member exhausts its allowance without a verdict while a sibling has independently verified passing evidence, when the group joins, then the failed member is not routed as a remediation finding and valid sibling retention follows the existing join policy. | 18 | "A real validation-group join fixture exhausts the PRD member allowance without a verdict, emits the existing no-verdict halt and creates no remediation finding for that member." | diff-local |
| Story 5 negative: Given a provider-classified auth/rate/model failure, when failure reporting runs, then the missing-verdict explanation does not replace its more specific provider recovery. | 15 | "Auth, rate-limit, model-unavailable and unresolved-skill fixtures retain their dedicated classification and recovery before missing-judgment handling; generic no-verdict text never replaces them." | diff-local |
| Story 5 negative: Given an incomplete result with rejected entries, when existing override routes are considered, then those defects remain named and blocking rather than becoming PASS or an inferred user decision. | 19 | "Production completion fixtures pass complete clean criterion evidence under existing completion and pre-dispatch preservation rules, while rejected-entry results remain blocked with each diagnostic named." | diff-local |
| Story 6 happy: Given complete clean criterion evidence, when the gate is evaluated, then it passes under the existing completion and preservation rules. | 19 | "Production completion fixtures pass complete clean criterion evidence under existing completion and pre-dispatch preservation rules, while rejected-entry results remain blocked with each diagnostic named." | diff-local |
| Story 6 happy: Given a valid FIXABLE finding with an admitted existing owner, when the repair route runs, then it uses the existing bounded append or existing-task disposition and preserves the current BUILD-dispatch accounting for lap and growth allowances. | 20 | "Conductor repair fixtures admit valid FIXABLE evidence with an active owner to the established append or existing-task disposition; append retains bounded growth, existing-task adds no growth, and each charges its lap only at admitted BUILD dispatch." | diff-local |
| Story 6 happy: Given a happy-path PLAN_GAP, when it is routed, then it requires the existing human plan decision; given a negative-path PLAN_GAP, it retains the existing record-and-ship behavior unless configured to halt. | 21 | "Conductor fixtures route happy-path PLAN_GAP to the existing human plan decision and negative-path PLAN_GAP to recorded shipment unless halt-all configuration is enabled." | diff-local |
| Story 6 happy: Given an OVER_SCOPE judgment marked within intent or outside intent without user-visible impact, when it is classified, then it remains recorded and non-blocking under current policy without creating new operator approval authority. | 22 | "Typed within-intent and outside-harmless OVER_SCOPE fixtures are recorded and non-blocking under existing policy without minting new operator approval authority." | diff-local |
| Story 6 negative: Given a proposed repair not owned by an active task, when repair admission checks it, then no new repair authority is inferred from a report, a requirement association or a no-owner scope observation. | 20 | "Conductor repair fixtures admit valid FIXABLE evidence with an active owner to the established append or existing-task disposition; append retains bounded growth, existing-task adds no growth, and each charges its lap only at admitted BUILD dispatch." | diff-local |
| Story 6 negative: Given exhausted lap or growth allowance, when the next admitted BUILD repair would dispatch, then the existing cap halt and pending-repair state are preserved rather than resetting the allowance during conversion. | 20 | "Conductor repair fixtures admit valid FIXABLE evidence with an active owner to the established append or existing-task disposition; append retains bounded growth, existing-task adds no growth, and each charges its lap only at admitted BUILD dispatch." | diff-local |
| Story 6 negative: Given a happy/negative criterion classification that cannot be resolved or configuration requiring all plan gaps to halt, when a PLAN_GAP is evaluated, then it cannot silently take the record-and-ship branch. | 21 | "Conductor fixtures route happy-path PLAN_GAP to the existing human plan decision and negative-path PLAN_GAP to recorded shipment unless halt-all configuration is enabled." | diff-local |
| Story 6 negative: Given mixed blocking grades or incomplete evidence, when a recordable gap or widening is also present, then that recordable item cannot override the other blockers and pass the gate. | 22 | "Typed within-intent and outside-harmless OVER_SCOPE fixtures are recorded and non-blocking under existing policy without minting new operator approval authority." | diff-local |
| Story 7 happy: Given attributable accepted or refused widening decisions and original cases, when a new audit begins, then existing decision capture preserves their order, provenance and explicit reversals before current findings are reconciled. | 24 | "PRD dispatch-entry fixtures show accepted/refused original cases captured with order, attribution/provenance and explicit reversal chain intact before current finding reconciliation." | diff-local |
| Story 7 happy: Given a current no-owner finding established as the same case through the existing semantic reconciliation, when effective authority is evaluated, then its original acceptance or refusal remains effective despite changed wording or presentation ordinal. | 25 | "Current no-owner sources established as the same case retain original accept/refuse authority despite rewording or changed NC presentation ordinal, through the production reconciliation/classification path." | diff-local |
| Story 7 happy: Given unchanged source/code/feature/decision revision and contract version, when reconciliation is revisited, then it reuses the valid existing result without another semantic judgment; rendering recorded dispositions alone does not invalidate that reuse. | 26 | "Unchanged source/code/feature/decision revision and contract-version fixtures reuse existing relationships with zero new semantic judgment; rerendering recorded dispositions preserves that reuse." | diff-local |
| Story 7 negative: Given a stale cleared acceptance and a newer explicit refusal, when audit entry processes the old clear again, then it cannot overwrite the newer refusal. | 24 | "PRD dispatch-entry fixtures show accepted/refused original cases captured with order, attribution/provenance and explicit reversal chain intact before current finding reconciliation." | diff-local |
| Story 7 negative: Given a changed source or decision revision during reconciliation, when publication checks freshness, then stale relationships are not published and original decisions remain intact. | 26 | "Unchanged source/code/feature/decision revision and contract-version fixtures reuse existing relationships with zero new semantic judgment; rerendering recorded dispositions preserves that reuse." | diff-local |
| Story 7 negative: Given an uncertain or different-case relation, when scope classification runs, then it does not inherit an unrelated approval or turn a no-owner finding into BUILD work. | 25 | "Current no-owner sources established as the same case retain original accept/refuse authority despite rewording or changed NC presentation ordinal, through the production reconciliation/classification path." | diff-local |
| Story 7 negative: Given corrupted authority or a failed store lease/write, when capture or reconciliation runs, then it names the recovery fault and cannot treat it as empty approved history. | 24 | "PRD dispatch-entry fixtures show accepted/refused original cases captured with order, attribution/provenance and explicit reversal chain intact before current finding reconciliation." | diff-local |
| Story 7 negative: Given a changed projection contract version after upgrade, when prior relationships are considered, then they cannot bypass current freshness checks; original decisions/cases remain available for fresh reconciliation without re-approval solely for presentation drift. | 26 | "Unchanged source/code/feature/decision revision and contract-version fixtures reuse existing relationships with zero new semantic judgment; rerendering recorded dispositions preserves that reuse." | diff-local |
| Story 8 happy: Given a complete typed result whose reviewed inputs remain valid under the existing code-stamp and decision checks, when the run resumes before a new dispatch, then it reuses the evidence without another reviewer call. | 27 | "Conductor resume fixtures with complete typed evidence and valid reviewed-input/code-stamp/current-decision checks reuse the audit with zero reviewer calls before a new dispatch." | diff-local |
| Story 8 happy: Given the engine's valid rebase translation or selective replay proof, when preservation is evaluated, then the audit retains the same approved preservation behavior; gate-relevant story/PRD changes still invalidate it. | 27 | "Conductor resume fixtures with complete typed evidence and valid reviewed-input/code-stamp/current-decision checks reuse the audit with zero reviewer calls before a new dispatch." | diff-local |
| Story 8 happy: Given recorded audit dispositions, when the pre-finish fence and shipment publication run, then both consume the same validated evidence and preserve the grade, decision and rationale in the shipped record. | 30 | "Production publication fixtures pass the same validated typed evidence through the pre-finish fence and shipment collection and retain recorded grade, decision and rationale in the shipped record." | diff-local |
| Story 8 negative: Given only legacy Markdown audit evidence, when the upgraded lifecycle evaluates completion, then it requires a new audit and preserves existing widening-decision and legacy-clear import data. | 28 | "Legacy Markdown-only lifecycle fixtures require a new audit while accepted-widening decisions and legacy-clear import bytes survive unchanged." | diff-local |
| Story 8 negative: Given a relevant changed input, unreachable/unexplained code stamp, uncomputable preservation check or currently blocking decision, when reuse is considered, then the old PASS cannot authorize publication. | 27 | "Conductor resume fixtures with complete typed evidence and valid reviewed-input/code-stamp/current-decision checks reuse the audit with zero reviewer calls before a new dispatch." | diff-local |
| Story 8 negative: Given code-validity preservation is disabled, when a legacy or stale audit is considered, then the option does not enable Markdown or timestamp-based verdict authority. | 28 | "Legacy Markdown-only lifecycle fixtures require a new audit while accepted-widening decisions and legacy-clear import bytes survive unchanged." | diff-local |
| Story 8 negative: Given rewind or a stale-evidence sweep invalidates the audit, when cleanup runs, then verdict and derived report are treated as the same evidence family while durable operator decisions remain available. | 29 | "Stale sweep and operator rewind fixtures treat the typed verdict and derived report as one invalidated evidence family while preserving durable widening decisions and original offers." | diff-local |
| Story 8 negative: Given a report with forged recorded findings or a valid-looking report beside unusable typed evidence, when shipment collection runs, then those report claims cannot reach the shipped record or satisfy the publication fence. | 30 | "Production publication fixtures pass the same validated typed evidence through the pre-finish fence and shipment collection and retain recorded grade, decision and rationale in the shipped record." | diff-local |
| Story 9 happy: Given a managed PRD-audit invocation, when the reviewer receives its role and contract, then the engine supplies the bounded evidence and output shape while the skill supplies judgment guidance; it requires a terminal structured judgment without asking the reviewer to persist engine-owned verdicts or decisions. | 32 | "Managed PRD invocation fixtures receive engine-owned bounded input/output shape and skill-owned judgment guidance requiring terminal structured judgment, with no instruction to persist verdicts or accepted/refused decisions." | diff-local |
| Story 9 happy: Given standalone interactive use, when the skill is invoked for human review, then it can explain its judgment without claiming it created current managed gate evidence. | 32 | "Managed PRD invocation fixtures receive engine-owned bounded input/output shape and skill-owned judgment guidance requiring terminal structured judgment, with no instruction to persist verdicts or accepted/refused decisions." | diff-local |
| Story 9 happy: Given the existing contract audit checks the migrated skill surface, when judgment guidance and standalone human presentation are present, then they remain permitted while the machine contract stays owned by the engine. | 33 | "Existing contract-audit fixtures permit judgment guidance and standalone human presentation while retaining engine ownership of the machine contract." | diff-local |
| Story 9 negative: Given either validator delegates evidence collection, when the briefs are formed, then the prohibition on executing project code or making unrelated writes applies to reviewer and delegates, and the reviewer cannot finish with delegated work outstanding. | 32 | "Managed PRD invocation fixtures receive engine-owned bounded input/output shape and skill-owned judgment guidance requiring terminal structured judgment, with no instruction to persist verdicts or accepted/refused decisions." | diff-local |
| Story 9 negative: Given a managed instruction that grants the reviewer authority to write accepted/refused decisions or substitutes report authoring for the terminal judgment, when the migrated contract is checked, then the conflicting output responsibility is rejected. | 33 | "Existing contract-audit fixtures permit judgment guidance and standalone human presentation while retaining engine ownership of the machine contract." | diff-local |
| Story 9 negative: Given a reintroduced engine-input recipe or machine-output table grammar in the migrated PRD-audit skill surface, when the existing contract audit evaluates it, then the audit fails for the contract violation rather than silently making that prose authoritative. | 33 | "Existing contract-audit fixtures permit judgment guidance and standalone human presentation while retaining engine ownership of the machine contract." | diff-local |

## Architecture Obligation Coverage

All 43 citable whole decisions in the six changed ADRs are represented once. Subdecision amendments attach to their parent decision. Existing/no-change rows state the retained production owner or scope constraint; task rows quote completion checks.

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-13-session-fresh-verdict-artifacts#D1 | task | task-16 | PRD and as-built handshake fixtures with no terminal judgment name the step, current attempt and expected output and explicitly state that this dispatch produced no verdict. |
| adr-2026-07-13-session-fresh-verdict-artifacts#D2 | existing | none | Conductor verdict_freshness emission and EventPersister already carry the typed as-built identity vocabulary; PRD uses that existing event, with no new channel. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D1 | task | task-11 | Store round trips preserve complete and incomplete validated judgments, their diagnostics, engine-owned attempt identity and reviewed code stamp; the generated human report reflects the same judgment. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D2 | task | task-27 | Conductor resume fixtures with complete typed evidence and valid reviewed-input/code-stamp/current-decision checks reuse the audit with zero reviewer calls before a new dispatch. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D3 | task | task-28 | Legacy Markdown-only lifecycle fixtures require a new audit while accepted-widening decisions and legacy-clear import bytes survive unchanged. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D4 | task | task-29 | Stale sweep and operator rewind fixtures treat the typed verdict and derived report as one invalidated evidence family while preserving durable widening decisions and original offers. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D5 | task | task-16 | PRD and as-built handshake fixtures with no terminal judgment name the step, current attempt and expected output and explicitly state that this dispatch produced no verdict. |
| adr-2026-07-22-gate-evidence-code-validity-on-redispatch#D6 | task | task-28 | Legacy Markdown-only lifecycle fixtures require a new audit while accepted-widening decisions and legacy-clear import bytes survive unchanged. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D1 | task | task-13 | DefaultStepRunner.run fixtures dispatch one versioned evidence input containing every independently expected authoritative criterion and happy/negative kind, task owner and completion condition, plan intent, applicable requirement and coherence mapping, scoped change and attributable available history. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D2 | existing | none | steps.ts already runs prd_audit on every tier/track with configDisableAllowed, and gate-invalidation.ts declares its story/PRD input surface; this migration preserves those declarations. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D3 | task | task-6, task-7, task-8, task-9, task-10 | Complete fixtures spanning PASS, FIXABLE, PLAN_GAP and OVER_SCOPE resolve each judgment to an independently supplied active criterion and retain evidence, rationale and permitted path-qualified requirement associations. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D4 | task | task-22, task-25 | Typed within-intent and outside-harmless OVER_SCOPE fixtures are recorded and non-blocking under existing policy without minting new operator approval authority. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D5 | task | task-20 | Conductor repair fixtures admit valid FIXABLE evidence with an active owner to the established append or existing-task disposition; append retains bounded growth, existing-task adds no growth, and each charges its lap only at admitted BUILD dispatch. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D6 | no-change | none | The growth ledger and pendingRepair implementation belong to prerequisite #2753, which must land before BUILD. This feature changes only the typed input to that accounting owner; Task 20 verifies preserved admission and settlement behavior. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D7 | task | task-21 | Conductor fixtures route happy-path PLAN_GAP to the existing human plan decision and negative-path PLAN_GAP to recorded shipment unless halt-all configuration is enabled. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D8 | task | task-23, task-30 | PLAN_GAP and OVER_SCOPE projection fixtures preserve original judgment separately from recorded grade/decision/rationale and attributable operator authority in display and shipment data. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D1 | task | task-22 | Typed within-intent and outside-harmless OVER_SCOPE fixtures are recorded and non-blocking under existing policy without minting new operator approval authority. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D2 | existing | none | prd-widening-offers.ts persists original offers and conductor.ts renders the existing fenced decision block through writeHaltMarker; the operator handoff shape remains unchanged. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D3 | task | task-24 | PRD dispatch-entry fixtures show accepted/refused original cases captured with order, attribution/provenance and explicit reversal chain intact before current finding reconciliation. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D4 | task | task-6, task-24, task-25 | Complete fixtures spanning PASS, FIXABLE, PLAN_GAP and OVER_SCOPE resolve each judgment to an independently supplied active criterion and retain evidence, rationale and permitted path-qualified requirement associations. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D5 | existing | none | prd-widening-migration.ts and prd-widening-entry.ts already preserve supported version-1 decisions and legacy clears and name retired formats; Task 28 retains these inputs. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D6 | task | task-22, task-25 | Typed within-intent and outside-harmless OVER_SCOPE fixtures are recorded and non-blocking under existing policy without minting new operator approval authority. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D7 | existing | none | prd-widening-capture.ts validates original offer provenance, explicit decision and rationale, retains valid siblings and named defects; no current-report identity or new parser is introduced for this operator input. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D8 | task | task-23, task-30 | PLAN_GAP and OVER_SCOPE projection fixtures preserve original judgment separately from recorded grade/decision/rationale and attributable operator authority in display and shipment data. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D1 | existing | none | provider-lifecycle.ts owns attempt identity; DefaultStepRunner uses that identity rather than introducing a provider echo or second id generator. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D2 | task | task-11, task-13 | Store round trips preserve complete and incomplete validated judgments, their diagnostics, engine-owned attempt identity and reviewed code stamp; the generated human report reflects the same judgment. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D3 | task | task-12, task-16 | An authority-write failure reports persistence failure and cannot count the prior verdict as current output; a post-persistence renderer failure names the failed report output, reports no successful dispatch and leaves durable operator decisions byte-identical. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D4 | task | task-19, task-31 | Production completion fixtures pass complete clean criterion evidence under existing completion and pre-dispatch preservation rules, while rejected-entry results remain blocked with each diagnostic named. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D5 | task | task-17 | The serial conductor fixture retries missing or invalid reviewer output only within the resolved existing allowance, creates a fresh invocation each time and accepts only the new attempt valid result. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D6 | task | task-17 | The serial conductor fixture retries missing or invalid reviewer output only within the resolved existing allowance, creates a fresh invocation each time and accepts only the new attempt valid result. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D7 | task | task-28, task-29 | Legacy Markdown-only lifecycle fixtures require a new audit while accepted-widening decisions and legacy-clear import bytes survive unchanged. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D8 | no-change | none | manual_test remains outside the typed carrier migration; its append-only attempt, identity-first ordering and whitewash machinery are untouched. |
| adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity#D9 | existing | none | conductor.ts already emits verdict_freshness and step failure through ConductorEventEmitter; event-persister.ts and the existing halt writer remain the only telemetry/recovery spine. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | existing | none | accepted-widenings.ts owns version-2 operator authority and RemediationCaseStore owns separate prd_widening relationships; Task 25 changes current input transport without transferring authority. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | existing | none | remediation-case-store.ts already leases and atomically mutates the domain-tagged envelope, preserving foreign-domain records and rejecting malformed/unsupported state. No store migration is added. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | task | task-24 | PRD dispatch-entry fixtures show accepted/refused original cases captured with order, attribution/provenance and explicit reversal chain intact before current finding reconciliation. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | existing | none | prd-widening-migration.ts imports supported version-1 and fenced legacy decisions with original provenance; no historical snapshot rewriting occurs and Task 28 proves retention through audit upgrade. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | task | task-25 | Current no-owner sources established as the same case retain original accept/refuse authority despite rewording or changed NC presentation ordinal, through the production reconciliation/classification path. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | task | task-13, task-32, task-33 | DefaultStepRunner.run fixtures dispatch one versioned evidence input containing every independently expected authoritative criterion and happy/negative kind, task owner and completion condition, plan intent, applicable requirement and coherence mapping, scoped change and attributable available history. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | task | task-3, task-4, task-5, task-13 | Projection tests exceeding each diff cap emit omitted file paths and content digests with read-only inspection locators, while the full structured criterion/task/requirement sets remain equal to their independent source sets. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | task | task-26 | Unchanged source/code/feature/decision revision and contract-version fixtures reuse existing relationships with zero new semantic judgment; rerendering recorded dispositions preserves that reuse. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | task | task-23, task-24 | PLAN_GAP and OVER_SCOPE projection fixtures preserve original judgment separately from recorded grade/decision/rationale and attributable operator authority in display and shipment data. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | the approved DECIDE corrections are already in this spec branch, and Tasks 20/25 preserve existing budget and domain owners; BUILD receives no protected-artifact amendment task or cross-gate authority. |

## Verification and review record

- The engine criterion extractor exactly matches all 69 authored Coverage Check rows.
- A fresh independent coverage-binding judge reviewed only the exact criterion/check pairs and returned asserts for all 69 claims, with zero refusals on round 1.
- Every task has a non-empty Done when block and explicit acyclic dependencies; the three slices have no forward dependency.
- The contradiction pass compared all checks with all criteria, especially no Markdown authority, no new approval authority, no synthetic repair from missing output, and preservation only before a new dispatch. No conflicting requirement remains.
- Foundation fixtures use independently resolved source sets; Task 13 proves that production dispatch actually receives them, preventing a self-consistent helper-only proof.
- Targeted implementation fixtures belong to their behavior tasks; no final catch-all validation task or aggregate suite invocation is added.
- New module filenames are design choices beside verified existing owners. Limits are explicitly measured during BUILD rather than asserted from an unmeasured corpus.

Verify-claims: CLEAR. Existing symbols and pattern/test owners were inspected in this session; no unconfirmed load-bearing assumption remains. This spec has not implemented or behaviorally tested the migration.

## Mechanical checks and overlap

Protected-target scan: no task/path violations. Both plan-updated diagrams render. No implementation tests were run during DECIDE.

Required advisory overlap output:

```text
Overlap with origin/spec/daemon-self-host-guardrails: src/conductor/src/engine/conductor.ts
Overlap with origin/spec/self-host-phase6-wiring: src/conductor/src/engine/conductor.ts
Note: renames or name-only diffs may not be detected by this scan.
```

This affects sequencing awareness at conductor.ts, not the approved scope or plan validity.

> **Amended 2026-09-30 by #2521:** Architecture coverage D6 above corrects an invalid existing-code claim. The prerequisite, not this feature, owns pendingRepair. No task completion check or criterion mapping changed.
