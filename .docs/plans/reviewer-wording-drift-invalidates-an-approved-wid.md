# Implementation Plan: Durable PRD widening decisions

**Date:** 2026-09-07
**Status:** Accepted — operator approved the 24-task plan on 2026-09-07; coherence corrections below clarify its existing obligations.
**Design:** .docs/decisions/adr-2026-09-07-durable-prd-widening-decision-reconciliation.md
**Stories:** .docs/stories/reviewer-wording-drift-invalidates-an-approved-wid.md
**Conflict check:** Clean after approved-contract corrections on 2026-09-07

## Summary

Deliver the complete #2429 widening-decision lifecycle in 24 scoped tasks. The native predecessor is #2383; later slices #2440, #2060, and #2441 remain separate. The operator explicitly accepted the 24-task count above the normal 20-task band.

## Technical Approach

Extend the existing leased case store with a distinct PRD widening domain while retaining #2383 suppression history and build-review effects. Keep operator authority in its separate versioned decision store; save original offers and explicit decisions before reading a replacement report for reconciliation. Project a complete bounded current/history snapshot, invoke existing remediate in a narrow native-schema mode, validate the final result and snapshot freshness, then make all routing/completion readers consume one effective classification.

The local storage precedent is RemediationCaseStore.mutate: feature-scoped filesystem state, leased read-modify-replace, discriminated errors, preservation of untouched fields. The #2383 suppression writer is the preservation precedent; task-level steps repeat those traits where needed. This is semantic reuse, not an exact-copy Pattern-source contract. New module names below are intended ownership seams, not claims that the files already exist; consolidate a proposed helper only if the same ownership and task checks remain true.

Provider support extends the existing invoke member and streams. Only this mode requests a native schema; other mode behavior remains unchanged. No third-party calls are allowed in ordinary tests. Adapter fixtures simulate native terminal envelopes; the gate integration fixtures run only the affected PRD transition and terminate before unrelated lifecycle steps.

## Prerequisites

- #2383 must ship before BUILD. Authoring uses inspected PR #2393 revision bf6a0336cb184894097b132f9fd227b4f89bf54c as explicitly authorized; compare its eventual changed contracts before land/BUILD. This is external sequencing, not a task claiming to complete another feature.
- Approved architecture, accepted stories, and the conflict report are the spec baseline. Superseded older DECIDE assertions have already been corrected here; no task mutates another feature’s protected artifacts.
- Existing selected-provider invocation, state leases, and event spine are available. Optional native-schema plumbing is implemented by Tasks 14-17, not assumed from #2188.

## Tasks

### Task 1: Represent separate PRD and build-review case domains
**Story:** Story 4
**Type:** infrastructure
**Files:** `src/conductor/src/engine/remediation-case-artifact.ts`, `src/conductor/src/engine/remediation-case-store.ts`, `src/conductor/test/engine/remediation-case-store.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Define a discriminated prd_widening record with source snapshots and relationships, distinct from the existing build_review disposition/effect record. Add exhaustive domain selection helpers; the shared envelope owns both collections. Do not make PRD records satisfy the old act/defer union.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The case parser accepts each approved domain shape and rejects PRD records carrying build-review effects or autonomous accept/refuse authority, as asserted by domain-shape fixtures.
- The domain selectors return only their own cases; identical NC display ordinals across domains do not create shared source identity.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-artifact.ts
- src/conductor/src/engine/remediation-case-store.ts
- src/conductor/test/engine/remediation-case-store.test.ts

**Dependencies:** none

### Task 2: Migrate the shared case envelope without losing suppression history
**Story:** Story 3, Story 4
**Type:** happy-path
**Files:** `src/conductor/src/engine/remediation-case-store.ts`, `src/conductor/test/engine/remediation-case-store.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Add v1-to-v2 loading and leased atomic replacement. Preserve the independently versioned feature identity, every build-review record/source/effect, and #2383 suppression entry. Use the existing mutate lease and temporary-file replacement; never hold a lease during a provider call.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- RemediationCaseStore migration preserves the independently versioned feature identity and exact build-review case, source, effect, and suppression inventories and initializes the new domain without invented PRD records.
- Repeated or interrupted migration through the real filesystem store produces one valid v2 state or leaves the original v1 state readable; foreign-feature, corrupt, and unknown-version inputs return distinct failures without overwrite.
- The store decoder rejects malformed domain records and duplicate source ownership within a domain; the predecessor v1 decoder rejects the v2 envelope before an old writer can overwrite it.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-store.ts
- src/conductor/test/engine/remediation-case-store.test.ts

**Dependencies:** Task 1

### Task 3: Preserve both domains through existing case writers
**Story:** Story 4
**Type:** negative-path
**Files:** `src/conductor/src/engine/remediation-case-reconciler.ts`, `src/conductor/src/engine/remediation-case-effects.ts`, `src/conductor/src/engine/build-review-adjudication-coordinator.ts`, `src/conductor/src/engine/build-review-adjudication-context.ts`, `src/conductor/src/engine/build-review-suppression-history.ts`, `src/conductor/test/engine/remediation-case-reconciler.test.ts`, `src/conductor/test/engine/build-review-suppression-history.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Route existing build-review readers through the build-review selector and preserve all other-domain state on replacement. Follow #2383 persistBuildReviewSuppressions: idempotent upsert through mutate, retaining stopped/settled history. Exercise actual existing writer entry points with mixed-domain state.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- Build-review reconciliation, suppression persistence, and effect updates preserve PRD records byte-for-byte in mixed-domain fixtures, while build-review outcomes and suppression history match the predecessor.
- Concurrent cross-domain mutations serialize through the store lease without lost records; failed replacement leaves the last valid state and a named failure.
- PRD-only records never create a BUILD work order or deferral effect; existing build-review no-PRD and flag-off behavior retains its original dispatch and storage-access conditions.

**Files likely touched:**
- src/conductor/src/engine/remediation-case-reconciler.ts
- src/conductor/src/engine/remediation-case-effects.ts
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/src/engine/build-review-adjudication-context.ts
- src/conductor/src/engine/build-review-suppression-history.ts
- src/conductor/test/engine/remediation-case-reconciler.test.ts
- src/conductor/test/engine/build-review-suppression-history.test.ts

**Dependencies:** Task 2

### Task 4: Version the operator decision store with explicit authority
**Story:** Story 1, Story 2, Story 3
**Type:** infrastructure
**Files:** `src/conductor/src/engine/accepted-widenings.ts`, `src/conductor/test/engine/accepted-widenings.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Introduce a version-2 typed decision read result distinguishing absent, valid, malformed, unsupported, and foreign-feature state. Store decision IDs, immutable original source/case references, rationale, operator identity, ordered revision, and optional supersedes. Use a decision-store lease and atomic replacement. Preserve criterion-keyed decisions.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The decision-store parser represents authoritative accept/refuse separately from absent and invalid storage; malformed JSON, unsupported version, and foreign-feature data cannot read as an empty successful history.
- The decision writer persists attributable source-linked records with engine-ordered revisions and refuses missing identity/rationale or malformed authority fields before a write.

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts
- src/conductor/test/engine/accepted-widenings.test.ts

**Dependencies:** none

### Task 5: Make decision supersession and replay idempotent
**Story:** Story 2
**Type:** negative-path
**Files:** `src/conductor/src/engine/accepted-widenings.ts`, `src/conductor/test/engine/accepted-widenings.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Use an immutable offer-entry identity plus stored decision relationship to distinguish replay from a new explicit reversal. A revision names the effective prior decision of the same case; re-read it under the decision lease. Never order authority by provider text or wall-clock timestamp.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The supersession transition preserves both attributed records and makes only a valid same-case explicit reversal effective; foreign-case and stale-revision attempts leave authority unchanged.
- The replay transition consumes an already-recorded offer entry as a no-op even after a later refusal, so a duplicate old acceptance never overrides that refusal.

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts
- src/conductor/test/engine/accepted-widenings.test.ts

**Dependencies:** Task 4

### Task 6: Persist original decision offers before halt rendering
**Story:** Story 1, Story 2
**Type:** happy-path
**Files:** `src/conductor/src/engine/prd-widening-offers.ts`, `src/conductor/src/engine/accepted-widenings.ts`, `src/conductor/test/engine/prd-widening-offers.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Add engine-stamped offers inside PRD case state, carrying feature, report/source snapshot, original evidence, and offered case reference. renderOverScopeDecisionBlock receives persisted offers. Refusals may receive explicit revision entries with a prior-decision reference; ordinary pending offers remain outside-visible and undecided only.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The offer service persists original evidence and a stable offer reference before returning any editable halt block; persistence failure returns no usable offer and names the cause.
- The block renderer distinguishes undecided pending entries from explicit refusal-revision entries and emits no default acceptance, harmless-finding offer, or already-accepted offer.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-offers.ts
- src/conductor/src/engine/accepted-widenings.ts
- src/conductor/test/engine/prd-widening-offers.test.ts

**Dependencies:** Task 2, Task 4

### Task 7: Validate cleared offers and preserve valid siblings
**Story:** Story 1
**Type:** negative-path
**Files:** `src/conductor/src/engine/prd-widening-capture.ts`, `src/conductor/src/engine/accepted-widenings.ts`, `src/conductor/test/engine/prd-widening-capture.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Parse the complete cleared block into per-entry outcomes. Compare immutable references with original stored offers, not current report text. Require explicit decision and rationale plus resolved machine owner. Save source/case before authority; surface row defects while allowing valid sibling writes.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- capturePrdWideningDecisions stores every valid original-offer decision once and returns per-row defects for changed references, bad decision words, missing rationale, and unresolved identity without granting authority.
- Pending entries, absent decisions, unrelated clears, and machine-cleared untouched blocks record no authority; one defective row does not erase a valid sibling decision.
- Lease/write failure or interruption between case and decision writes leaves no source-less acceptance; replay resumes safely with no duplicated record.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-capture.ts
- src/conductor/src/engine/accepted-widenings.ts
- src/conductor/test/engine/prd-widening-capture.test.ts

**Dependencies:** Task 5, Task 6

### Task 8: Migrate supported decision rows preserving original ordering
**Story:** Story 3
**Type:** happy-path
**Files:** `src/conductor/src/engine/prd-widening-migration.ts`, `src/conductor/src/engine/accepted-widenings.ts`, `src/conductor/test/engine/prd-widening-migration.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Read valid v1 decisions without filtering against current findings. Preserve original evidence/attribution and append order; derive deterministic migration entry identities from the legacy document plus row identity. Materialize legacy source snapshots before recording v2 authority. Duplicate rows must not invent later reversals.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The migration service retains all supported v1 records with original evidence, attribution, decisions, and relative authority, including criteria and NC rows.
- Migration repeated after each persistence interruption produces the same effective history without duplicate decisions, reordered reversals, or a partial state that appears accepted.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-migration.ts
- src/conductor/src/engine/accepted-widenings.ts
- src/conductor/test/engine/prd-widening-migration.test.ts

**Dependencies:** Task 2, Task 4, Task 5

### Task 9: Recover legacy clears and report unsupported history
**Story:** Story 3
**Type:** negative-path
**Files:** `src/conductor/src/engine/prd-widening-migration.ts`, `src/conductor/src/engine/prd-widening-capture.ts`, `src/conductor/test/engine/prd-widening-migration.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Accept supported pre-offer fenced clears using original summary plus explicit decision/rationale and existing owner resolution. Mark legacy provenance, preserving its authority as unbound until judged. Distinguish unsupported entries-shape/single-line formats, corrupt stores, and absent state; preserve raw sources on failure.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- Legacy-clear capture retains the original decision even when its ordinal or summary differs from the current report; a legacy provenance marker prevents fabricated modern-offer evidence.
- The recovery reader names corrupt, unsupported, foreign-feature, and unknown-version inputs without replacing them with empty state, and ambiguity leaves stored decisions unbound rather than approved.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-migration.ts
- src/conductor/src/engine/prd-widening-capture.ts
- src/conductor/test/engine/prd-widening-migration.test.ts

**Dependencies:** Task 7, Task 8

### Task 10: Wire capture into PRD entry and both routing paths
**Story:** Story 1, Story 3
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/conductor-prd-widening-capture.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Call one capture/migration entry at PRD preparation before provider dispatch, and idempotently from serial and concurrent-join over-scope routing. Inject owner resolution and test with the minimum PRD step fixture, stopping after observation. Carry capture defects forward instead of returning before they reach routing.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The production PRD entry fixture observes durable original acceptance and evidence before the fake audit reviewer runs; serial-tail and concurrent-join routes produce the same decision inventory on repeat.
- The actual entry path preserves valid sibling decisions and passes capture/legacy failures to the gate, including absent current report and replacement-summary cases; no unrelated lifecycle steps run in the fixture.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/conductor-prd-widening-capture.test.ts

**Dependencies:** Task 7, Task 9

### Task 11: Project every current NC source and relevant prior case
**Story:** Story 5
**Type:** happy-path
**Files:** `src/conductor/src/engine/prd-widening-context.ts`, `src/conductor/test/engine/prd-widening-context.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Build current sources from the real parsed PRD report, retaining NC grades/intent/evidence and rejected-row diagnostics separately. Include complete PRD case/source/decision history, including accepted, refused, superseded, absent, and unresolved cases; exclude build-review suppressions from current sources. Bind source IDs to engine snapshots, not summary-equivalence.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The context assembler consumes actual parsePrdAuditReport output and preserves every valid current NC source plus complete retained PRD history; source-to-normalized fixtures cover no-owner section, renumbering, mixed grades, and malformed rows.
- The assembler retains original/current evidence and decision revisions and does not turn build-review suppression history or story-criterion decisions into NC matching subjects.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-context.ts
- src/conductor/test/engine/prd-widening-context.test.ts

**Dependencies:** Task 2, Task 4

### Task 12: Reject context overflow without pruning history
**Story:** Story 5
**Type:** negative-path
**Files:** `src/conductor/src/engine/prd-widening-context.ts`, `src/conductor/test/engine/prd-widening-context.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Enforce D7 limits at the projection boundary: 512 current sources, 128 PRD cases, 512 source links/case, 64 pointers/source, 256-byte references, 8000-byte prose, 128KiB total serialized input. Count encoded bytes, not string length. Check each limit and whole serialization before dispatch.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The context boundary reports dimension, actual size, and limit for each individual and total-byte overflow, without dispatching a judge or silently truncating any source/history record.
- Exactly-at-limit inputs remain representable; multibyte text and many small fields cannot bypass byte/count limits, and overflow never mutates or prunes the persistent store.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-context.ts
- src/conductor/test/engine/prd-widening-context.test.ts

**Dependencies:** Task 11

### Task 13: Define and validate the closed reconciliation result
**Story:** Story 5, Story 6
**Type:** infrastructure
**Files:** `src/conductor/src/engine/prd-widening-contract.ts`, `src/conductor/test/engine/prd-widening-contract.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Export one engine-owned JSON schema and parser for a versioned result covering each current source exactly once: same-case(existing case ID and reason), different(reason), or uncertain(candidate IDs and reason). Provider output cannot contain operator decisions or engine-minted new IDs. Validate structure first, then source/case cross-references.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The contract validator accepts the three approved outcomes and rejects unknown fields, missing/duplicate source results, unknown case references, and contradictory bindings before publishing any relationship.
- The same engine-owned contract supplies the provider schema and result validation; invalid JSON or absent structured output produces a named field/shape failure rather than markdown extraction or an acceptance default.
- Result validation rejects invalid outcome values, empty same-case explanations, provider-authored decisions or new case IDs, and unrepresentable source references before any case mutation.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-contract.ts
- src/conductor/test/engine/prd-widening-contract.test.ts

**Dependencies:** Task 11

### Task 14: Thread an optional native schema request through provider execution
**Story:** Story 6
**Type:** infrastructure
**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/test/engine/provider-execution.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Add optional engine-owned output-contract request and a distinct final structured-result field to the existing invoke request/result, with explicit unsupported capability failure. Keep the single invoke dispatch member and existing stream/usage/fresh-session behavior. Do not use prose retryReason as the output contract.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- Provider execution forwards an optional schema request and preserves a distinct terminal structured result; missing capability is a typed mechanical failure rather than silent unconstrained execution.
- No-schema invocation fixtures retain existing args, streams, metering, and result behavior and do not materialize schema scratch or add a second provider dispatch.

**Files likely touched:**
- src/conductor/src/execution/llm-provider.ts
- src/conductor/src/engine/provider-execution.ts
- src/conductor/src/engine/provider-runtime.ts
- src/conductor/test/engine/provider-execution.test.ts

**Dependencies:** none

### Task 15: Apply Claude native schema constraints and terminal extraction
**Story:** Story 6
**Type:** happy-path
**Files:** `src/conductor/src/execution/claude-provider.ts`, `src/conductor/test/execution/claude-provider.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Extend the existing Claude invoke path with its native --json-schema option only for a requested contract. Extract structured output from the terminal result envelope; intermediate tool JSON and unrelated text cannot be mistaken for the answer. Use faithful terminal/stream fixtures, not a live provider.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- Claude invoke adapter fixtures assert the engine schema reaches the native flag and the returned structured value comes only from the terminal result envelope.
- Absent terminal result, malformed structured value, provider failure, and unsupported capability produce named failures; no-schema calls retain their original argument/result path.

**Files likely touched:**
- src/conductor/src/execution/claude-provider.ts
- src/conductor/test/execution/claude-provider.test.ts

**Dependencies:** Task 13, Task 14

### Task 16: Apply Codex native schema constraints in worktree scratch
**Story:** Story 6
**Type:** happy-path
**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/engine/self-host/provider-scratch.ts`, `src/conductor/test/execution/codex-provider.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Use the existing worktree-anchored provider scratch lifetime under .daemon/scratch for the schema file. Pass --output-schema with that path through the existing invoke path; parse only the final answer carried by the provider terminal stream. Reuse attempt teardown ownership and retain confinement under self-host containment.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- Codex invoke fixtures assert the native output-schema argument names the engine-authored file in authorized worktree scratch and only the final structured response becomes the contract result.
- Normal exit, timeout, spawn failure, invalid final JSON, and absent terminal output return the appropriate result and complete owned scratch cleanup without touching the primary checkout; no-schema invocations create no schema file.

**Files likely touched:**
- src/conductor/src/execution/codex-provider.ts
- src/conductor/src/engine/self-host/provider-scratch.ts
- src/conductor/test/execution/codex-provider.test.ts

**Dependencies:** Task 13, Task 14

### Task 17: Wire the reconciliation mode into the existing remediate dispatch
**Story:** Story 6
**Type:** happy-path
**Files:** `src/conductor/src/engine/step-runners.ts`, `skills/remediate/SKILL.md`, `src/conductor/test/engine/step-runners.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Add a typed mode request for prd-widening-reconciliation through StepRunner into provider invoke. Render the engine projection and pass the engine schema; the skill supplies equivalence judgment guidance only. Keep existing case-v1 and gap-planning dispatches unchanged. Do not invent a new lifecycle step.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The production StepRunner remediate entry forwards the typed PRD context/schema to the selected Claude or Codex adapter and returns its validated terminal result, with no markdown-output recovery.
- Existing build-review case-v1 and gap-planning mode fixtures retain their original inputs and effects; unavailable contract capability fails this mode explicitly without changing other calls.

**Files likely touched:**
- src/conductor/src/engine/step-runners.ts
- skills/remediate/SKILL.md
- src/conductor/test/engine/step-runners.test.ts

**Dependencies:** Task 13, Task 15, Task 16

### Task 18: Coordinate same, different, uncertain, and replay outcomes
**Story:** Story 2, Story 3, Story 5
**Type:** happy-path
**Files:** `src/conductor/src/engine/prd-widening-coordinator.ts`, `src/conductor/test/engine/prd-widening-coordinator.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Implement a PRD-only coordinator using the shared store, decision history, context builder, injected typed judge, and effect-free domain. Same-case links only to known cases; different mints an engine case; uncertain retains candidate evidence without choosing. Reuse only an identical validated snapshot; store successful and uncertain outcomes for restart.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The coordinator fixtures reproduce the original 1000ms-to-5000ms lease finding and expanded summary as one decided case, while a different behavior sharing commit/path/prose remains independently undecided.
- Uncertain or ambiguous legacy outcomes retain all original decisions, create no automatic approval or repair effect, and do not retry for a more favorable semantic answer.
- Identical validated source/code/decision/contract snapshots reuse completed results after restart without another successful judgment; absence of a current refused finding retains its historical refusal.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-coordinator.ts
- src/conductor/test/engine/prd-widening-coordinator.test.ts

**Dependencies:** Task 3, Task 5, Task 12, Task 13, Task 17

### Task 19: Commit only fresh relations and bound mechanical failures
**Story:** Story 5, Story 6, Story 7
**Type:** negative-path
**Files:** `src/conductor/src/engine/prd-widening-coordinator.ts`, `src/conductor/test/engine/prd-widening-coordinator.test.ts`, `src/conductor/src/engine/prd-widening-capture.ts`, `src/conductor/src/engine/prd-widening-migration.ts`, `src/conductor/src/engine/accepted-widenings.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Read source/report digest, code/diff identity, decision revision, and contract version before judgment; compare them again while holding leases in case-store then decision-store order, with capture/supersession using the same order whenever both stores are touched. No lease spans the provider call. The source digest excludes only engine-owned decision projection rows so rendering the result cannot invalidate itself; original reviewer source/intent changes still invalidate it. A changed snapshot returns stale and preserves authority. Use configured remediate attempt allowance for mechanical failure, never BUILD/growth counters.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The relation publication transition rejects a concurrent refusal/reversal, changed report/source set, changed code snapshot, feature identity, or contract revision and preserves the newer authoritative state; stale evidence cannot be reused and engine-owned projection rendering alone does not stale the source digest.
- Provider timeout, unavailable result, invalid judgment, and exhaustion of the configured remediate attempt allowance produce a named terminal failure with unchanged BUILD and plan-growth counters, while interruption before publication leaves decisions intact.
- Publication, capture, migration, and supersession fixtures use case-store then decision-store lease order whenever both are acquired, and no provider call runs with either lease held.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-coordinator.ts
- src/conductor/test/engine/prd-widening-coordinator.test.ts
- src/conductor/src/engine/prd-widening-capture.ts
- src/conductor/src/engine/prd-widening-migration.ts
- src/conductor/src/engine/accepted-widenings.ts

**Dependencies:** Task 18, Task 10

### Task 20: Derive one effective widening classification
**Story:** Story 2, Story 5, Story 7
**Type:** happy-path
**Files:** `src/conductor/src/engine/accepted-widenings.ts`, `src/conductor/src/engine/prd-widening-classification.ts`, `src/conductor/test/engine/prd-widening-classification.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Build a pure exhaustive classifier from current parsed intent, fresh validated relationships, and effective decision revisions. Preserve criterion-keyed authority. Outside-visible NC findings can be accepted, blocking-refused, or blocking-undecided; nonblocking intent remains not-blocking independent of decisions. No summary threshold or model call participates.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The classifier derives accepted/refused/undecided NC outcomes only from valid current relationships and operator authority, while within/outside-harmless inputs remain nonblocking and criterion-keyed decisions survive summary changes.
- An unbound, stale, uncertain, or reviewer-claimed acceptance never grants authority; refused findings stay blocking and the classification contains no autonomous repair route.

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts
- src/conductor/src/engine/prd-widening-classification.ts
- src/conductor/test/engine/prd-widening-classification.test.ts

**Dependencies:** Task 5, Task 18, Task 19

### Task 21: Route both PRD paths through capture and reconciliation
**Story:** Story 1, Story 2, Story 5, Story 7
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/artifacts.ts`, `skills/prd-audit/SKILL.md`, `src/conductor/test/engine/conductor-prd-widening-routing.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Connect current report parsing, shared capture, PRD reconciliation, and effective classification before serial and concurrent-join over-scope transitions. Render relevant original decisions into PRD review context through the engine and replace the in-scope copy-summary-verbatim instruction with judgment guidance. Preserve other gate member results and existing gap-planning ownership.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The real bounded PRD routing fixture drives offer -> explicit clear -> replacement report -> typed reconciliation -> accepted or refused route through both production entry paths and retains original authority across restart.
- Equivalent findings stop re-asking, different/uncertain findings get distinct unresolved decisions, and refused findings expose explicit revision without any NC work order, plan append, deferral, or charged repair lap.
- Rejected report rows and capture/reconciliation faults remain visible blockers while valid sibling decisions persist; ordinary criterion and nonblocking intent paths preserve prior routing without an unnecessary semantic dispatch.
- Mixed-report routing fixtures retain unrelated validation-member results and existing FIXABLE/PLAN_GAP dispositions and allowances; only the NC widening branch invokes this reconciliation mode.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/artifacts.ts
- skills/prd-audit/SKILL.md
- src/conductor/test/engine/conductor-prd-widening-routing.test.ts

**Dependencies:** Task 10, Task 17, Task 20

### Task 22: Bind artifact completion and rendered records to the same evidence
**Story:** Story 7
**Type:** negative-path
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/prd-widening-classification.ts`, `src/conductor/test/engine/artifacts.test.ts`, `src/conductor/test/engine/prd-widening-projection.test.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Route classifyPrdAuditGaps, report decision projection, completion checks, and ship recorded-finding rendering through the shared classification and freshness evidence. Preserve raw reviewer grade/intent alongside operator authority; do not force accepted findings into a new reviewer grade. Reject incomplete or unrenderable evidence.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- Artifact completion, routing classification, verdict projection, and shipped-record projection agree for accepted, refused, unresolved, and not-blocking fixtures and perform no independent summary matching or provider call.
- Reviewer-only claims, malformed report rows, corrupted/stale relation evidence, and projection write/render failure each prevent clean completion with a named cause and preserve the authoritative decision records.
- The production original-clear/replacement-report fixture continues through artifact completion and shipped-record projection for the observed two summaries, refusal, restart/replay, and different widening; interrupted or absent relation publication stays blocking.

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/src/engine/prd-widening-classification.ts
- src/conductor/test/engine/artifacts.test.ts
- src/conductor/test/engine/prd-widening-projection.test.ts

**Dependencies:** Task 20, Task 21

### Task 23: Emit reconciliation occurrences through existing event consumers
**Story:** Story 8
**Type:** happy-path
**Files:** `src/conductor/src/engine/prd-widening-capture.ts`, `src/conductor/src/engine/prd-widening-coordinator.ts`, `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/engine/prd-widening-events.test.ts`, `src/conductor/src/engine/prd-widening-offers.ts`, `src/conductor/src/engine/prd-widening-migration.ts`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Extend ConductorEvent and its declared sink/render handlers for offers/imports, validated binding, different/uncertain outcomes, stale/invalid rejection, legacy recovery, and exact-result reuse. Emit only after known state outcomes; use IDs and bounded reasons, not a second history log. Original rationale remains in authoritative state/report. Follow existing case-lifecycle sink ownership: persist=true, render/audit/otel=false; use the existing loop_halt renderer for operator recovery. Do not add duplicate per-occurrence renderers.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The real event emitter/persister and registered ledger consumer expose source/case/decision identifiers and bounded reasons for original offers, imports, decisions, same/different/uncertain relations, rejection, recovery, and exact-result reuse.
- Early-return failure fixtures for malformed input, missing identity, persistence failure, stale result, and overflow emit their distinct reason without hiding retained valid sibling authority or creating a parallel event format.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-capture.ts
- src/conductor/src/engine/prd-widening-coordinator.ts
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/test/engine/event-sinks.test.ts
- src/conductor/test/engine/prd-widening-events.test.ts
- src/conductor/src/engine/prd-widening-offers.ts
- src/conductor/src/engine/prd-widening-migration.ts

**Dependencies:** Task 7, Task 18, Task 19

### Task 24: Render actionable recovery without erasing valid authority
**Story:** Story 8
**Type:** negative-path
**Files:** `src/conductor/src/engine/prd-widening-recovery.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/prd-widening-recovery.test.ts`, `docs/reference/artifacts.md`, `docs/explanation/gates.md`, `docs/runbooks/stalled-or-stuck-feature.md`

**Steps:**
1. Write scoped failing behavioral fixtures for this task’s checks at the lowest sufficient layer (store/contract units unless a production entry is explicitly named below).
2. Establish RED through the affected selectors, then implement: Centralize typed recovery rendering for capture/store/schema/context/staleness/projection faults and semantic uncertainty. Use existing writeHaltMarker ownership and classes; name affected records and specific recovery actions. Connect both PRD halt exits to this renderer, preserving stored valid siblings. This task owns recovery output, not overall feature validation. Update the artifact inventory and versions, gate authority description, and over-scope recovery runbook alongside the new rendered recovery behavior.
3. Establish GREEN through the same selectors and commit the completed task.

**Done when:**
- The production PRD halt boundary renders named record references and actionable recovery for malformed/unsupported history, missing attribution, lease/write failure, invalid provider result, stale binding, overflow, and projection failure instead of a generic unresolved verdict.
- Event and halt fixtures identify the same reason and affected records on each alternate branch, retain valid sibling decisions/refusals, and create no implicit acceptance, new retry loop, or NC repair effect.
- The artifact reference, gate explanation, and over-scope runbook describe v2 storage, explicit refusal revision, preserved legacy evidence, and the exact recovery actions rendered by the production halt boundary.

**Files likely touched:**
- src/conductor/src/engine/prd-widening-recovery.ts
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/prd-widening-recovery.test.ts
- docs/reference/artifacts.md
- docs/explanation/gates.md
- docs/runbooks/stalled-or-stuck-feature.md

**Dependencies:** Task 6, Task 9, Task 19, Task 21, Task 22, Task 23

## Task Dependency Graph

Each task’s Dependencies line is authoritative. Independent roots 1, 4, and 14 may start together. Shared-file tasks serialize even when the DAG permits parallelism. Storage/capture converge at 10; projection/schema/provider support converge at 18; routing and completion converge at 22; final event/recovery ownership converges at 24. Task 24 is a scoped recovery implementation, not a catch-all completed-feature test.

## Integration Points

- Task 3 owns existing cross-domain writer preservation through production case/suppression/effect entry points.
- Task 10 owns decision capture before the PRD reviewer and entry-path parity.
- Tasks 15 and 16 own their provider adapter native-result boundaries; Task 17 owns selected StepRunner-to-provider propagation.
- Task 21 owns the full original-decision to changed-report routing flow.
- Task 22 owns completion and rendering agreement; Task 23 owns event emitter/persister integration; Task 24 owns halt recovery output.

## Coverage Check

Each criterion has a lower-layer behavioral or bounded integration proof owned by the cited task; none requires a new full-lifecycle acceptance suite. Source parsing is owned by Task 11, production capture by Task 10, and production routing by Task 21, so normalized-input helper checks do not stand in for those boundaries. Every row is diff-local: behavior is tested under controlled feature/provider/state inputs; predecessor shipping is a prerequisite rather than an assertion delegated to tests.

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an original over-scope offer and an explicit acceptance with rationale, when PRD review resumes, then the original evidence, operator attribution, and acceptance are durably available before the new reviewer runs | 10 | "The production PRD entry fixture observes durable original acceptance and evidence before the fake audit reviewer runs; serial-tail and concurrent-join routes produce the same decision inventory on repeat." | diff-local |
| Story 1 happy: Given several valid accept/refuse entries, when capture runs from either existing over-scope routing path, then each decision is retained once and can be read after restart | 7, 10 | "capturePrdWideningDecisions stores every valid original-offer decision once and returns per-row defects for changed references, bad decision words, missing rationale, and unresolved identity without granting authority." | diff-local |
| Story 1 negative: Given an untouched pending entry or a machine-cleared halt, when capture runs, then no operator decision is created | 7 | "Pending entries, absent decisions, unrelated clears, and machine-cleared untouched blocks record no authority; one defective row does not erase a valid sibling decision." | diff-local |
| Story 1 negative: Given a changed immutable offer reference, missing rationale, invalid decision word, or unresolved operator identity, when capture runs, then the affected entry produces a named defect and grants no authority | 7 | "capturePrdWideningDecisions stores every valid original-offer decision once and returns per-row defects for changed references, bad decision words, missing rationale, and unresolved identity without granting authority." | diff-local |
| Story 1 negative: Given one defective row and a valid sibling, when capture runs, then the valid decision survives and the defective row remains a visible blocker | 7, 21 | "Rejected report rows and capture/reconciliation faults remain visible blockers while valid sibling decisions persist; ordinary criterion and nonblocking intent paths preserve prior routing without an unnecessary semantic dispatch." | diff-local |
| Story 1 negative: Given a lease timeout, write failure, or interruption between source and decision persistence, when capture stops and resumes, then no acceptance exists without a valid original source and no duplicate decision is created | 7, 10 | "Lease/write failure or interruption between case and decision writes leaves no source-less acceptance; replay resumes safely with no duplicated record." | diff-local |
| Story 2 happy: Given a refusal and a later equivalent current widening, when the gate evaluates it, then the halt identifies the existing refusal and offers an explicit revision tied to that decision | 6, 21 | "Equivalent findings stop re-asking, different/uncertain findings get distinct unresolved decisions, and refused findings expose explicit revision without any NC work order, plan append, deferral, or charged repair lap." | diff-local |
| Story 2 happy: Given an explicit acceptance superseding that refusal with a rationale, when the decision is recorded, then the new decision is effective and both decisions remain attributable | 5 | "The supersession transition preserves both attributed records and makes only a valid same-case explicit reversal effective; foreign-case and stale-revision attempts leave authority unchanged." | diff-local |
| Story 2 negative: Given an old acceptance clear replayed after a newer refusal, when capture repeats, then the refusal remains effective | 5 | "The replay transition consumes an already-recorded offer entry as a no-op even after a later refusal, so a duplicate old acceptance never overrides that refusal." | diff-local |
| Story 2 negative: Given a supersession referring to another case or conflicting decision revision, when submitted, then it is rejected without changing either case authority | 5 | "The supersession transition preserves both attributed records and makes only a valid same-case explicit reversal effective; foreign-case and stale-revision attempts leave authority unchanged." | diff-local |
| Story 2 negative: Given a refused finding absent on one lap and recurring later, when reconciled, then its historical refusal has not been erased | 18 | "Identical validated source/code/decision/contract snapshots reuse completed results after restart without another successful judgment; absence of a current refused finding retains its historical refusal." | diff-local |
| Story 2 negative: Given a currently refused NC finding, when routing follows the refusal branch, then no plan task, BUILD work order, or deferral issue is created | 21 | "Equivalent findings stop re-asking, different/uncertain findings get distinct unresolved decisions, and refused findings expose explicit revision without any NC work order, plan append, deferral, or charged repair lap." | diff-local |
| Story 3 happy: Given valid version-1 decision rows, when upgraded, then their original evidence, attribution, order, and decisions remain available in the new state | 8 | "The migration service retains all supported v1 records with original evidence, attribution, decisions, and relative authority, including criteria and NC rows." | diff-local |
| Story 3 happy: Given a valid legacy fenced cleared decision and a differently worded current report, when imported, then the original decision is retained with legacy provenance before any current binding is decided | 9 | "Legacy-clear capture retains the original decision even when its ordinal or summary differs from the current report; a legacy provenance marker prevents fabricated modern-offer evidence." | diff-local |
| Story 3 negative: Given malformed decision storage or an unsupported retired format, when recovery reads it, then it names the format or corruption and leaves the original evidence intact | 9 | "The recovery reader names corrupt, unsupported, foreign-feature, and unknown-version inputs without replacing them with empty state, and ambiguity leaves stored decisions unbound rather than approved." | diff-local |
| Story 3 negative: Given a legacy decision with several plausible current matches, when reconciled, then the record survives but none of those findings inherits automatic approval | 9, 18 | "Uncertain or ambiguous legacy outcomes retain all original decisions, create no automatic approval or repair effect, and do not retry for a more favorable semantic answer." | diff-local |
| Story 3 negative: Given a crash during migration or a repeated migration attempt, when resumed, then valid records are not duplicated or reordered and partial state cannot pass completion | 8 | "Migration repeated after each persistence interruption produces the same effective history without duplicate decisions, reordered reversals, or a partial state that appears accepted." | diff-local |
| Story 3 negative: Given a store belonging to another feature or an unknown future version, when read, then it is rejected explicitly rather than converted to empty history | 4, 9 | "The decision-store parser represents authoritative accept/refuse separately from absent and invalid storage; malformed JSON, unsupported version, and foreign-feature data cannot read as an empty successful history." | diff-local |
| Story 4 happy: Given #2383 build-review cases, effects, and suppression history, when PRD history is added or migrated, then all existing build-review evidence and effective outcomes are preserved | 2, 3 | "Build-review reconciliation, suppression persistence, and effect updates preserve PRD records byte-for-byte in mixed-domain fixtures, while build-review outcomes and suppression history match the predecessor." | diff-local |
| Story 4 happy: Given PRD widening history, when build-review suppression or case state changes, then the PRD history remains available unchanged | 3 | "Build-review reconciliation, suppression persistence, and effect updates preserve PRD records byte-for-byte in mixed-domain fixtures, while build-review outcomes and suppression history match the predecessor." | diff-local |
| Story 4 negative: Given a PRD case presented for a build-review act/defer effect, when evaluated, then the foreign-domain route is rejected and no effect occurs | 1, 3 | "PRD-only records never create a BUILD work order or deferral effect; existing build-review no-PRD and flag-off behavior retains its original dispatch and storage-access conditions." | diff-local |
| Story 4 negative: Given a malformed domain record, conflicting source ownership within a domain, or an older incompatible writer, when storage is accessed, then it refuses explicitly without overwriting newer state | 1, 2, 3 | "Repeated or interrupted migration through the real filesystem store produces one valid v2 state or leaves the original v1 state readable; foreign-feature, corrupt, and unknown-version inputs return distinct failures without overwrite." | diff-local |
| Story 4 negative: Given overlapping PRD and build-review updates or a failed atomic replacement, when retried, then the successful state includes both domains without lost records | 3 | "Concurrent cross-domain mutations serialize through the store lease without lost records; failed replacement leaves the last valid state and a named failure." | diff-local |
| Story 4 negative: Given the same lap-local ordinal in unrelated domains, when histories are stored, then it does not make those findings equivalent or transfer operator authority | 1 | "The domain selectors return only their own cases; identical NC display ordinals across domains do not create shared source identity." | diff-local |
| Story 5 happy: Given the original lease-wait widening from 1000ms to 5000ms and the observed expanded reviewer summary, when reconciliation identifies the same behavior, then the current finding inherits the original decision even with shifted lines or NC ordinal | 18, 21 | "The coordinator fixtures reproduce the original 1000ms-to-5000ms lease finding and expanded summary as one decided case, while a different behavior sharing commit/path/prose remains independently undecided." | diff-local |
| Story 5 happy: Given relevant accepted, refused, superseded, absent, and unresolved PRD cases, when unmatched current findings are reconciled, then the judgment has every current source and the complete retained PRD history | 11 | "The context assembler consumes actual parsePrdAuditReport output and preserves every valid current NC source plus complete retained PRD history; source-to-normalized fixtures cover no-owner section, renumbering, mixed grades, and malformed rows." | diff-local |
| Story 5 happy: Given an identical validated source/code/decision/contract snapshot, when repeated after restart, then its completed reconciliation is reused without another successful judgment | 18 | "Identical validated source/code/decision/contract snapshots reuse completed results after restart without another successful judgment; absence of a current refused finding retains its historical refusal." | diff-local |
| Story 5 negative: Given a different behavior sharing the same commit, path, ordinal, or similar prose, when reconciled as different, then it requires its own decision and cannot inherit acceptance | 18 | "The coordinator fixtures reproduce the original 1000ms-to-5000ms lease finding and expanded summary as one decided case, while a different behavior sharing commit/path/prose remains independently undecided." | diff-local |
| Story 5 negative: Given missing evidence or ambiguous equivalence, when the result is uncertain, then the original decisions remain durable and the current finding stays unresolved without retries seeking a different answer | 18 | "Uncertain or ambiguous legacy outcomes retain all original decisions, create no automatic approval or repair effect, and do not retry for a more favorable semantic answer." | diff-local |
| Story 5 negative: Given any approved count, field, or total-input limit is exceeded, when context is assembled, then the named dimension and actual/allowed size are reported without silent truncation or pruning | 12 | "The context boundary reports dimension, actual size, and limit for each individual and total-byte overflow, without dispatching a judge or silently truncating any source/history record." | diff-local |
| Story 5 negative: Given a changed source, code snapshot, decision revision, or contract version, when prior evidence is considered for reuse, then it is not reused as current authority | 19 | "The relation publication transition rejects a concurrent refusal/reversal, changed report/source set, changed code snapshot, feature identity, or contract revision and preserves the newer authoritative state; stale evidence cannot be reused and engine-owned projection rendering alone does not stale the source digest." | diff-local |
| Story 6 happy: Given either Claude or Codex selected for reconciliation, when dispatched, then the provider receives the engine-owned input and native output constraint and the engine consumes the validated final structured result | 15, 16, 17 | "The production StepRunner remediate entry forwards the typed PRD context/schema to the selected Claude or Codex adapter and returns its validated terminal result, with no markdown-output recovery." | diff-local |
| Story 6 happy: Given an invocation that requests no schema, when dispatched, then its existing behavior is unchanged | 14, 15, 16 | "No-schema invocation fixtures retain existing args, streams, metering, and result behavior and do not materialize schema scratch or add a second provider dispatch." | diff-local |
| Story 6 negative: Given unsupported schema capability, absent terminal output, malformed JSON, an unknown field, or an invalid field value, when the result is processed, then a named mechanical error prevents acceptance | 13, 14, 15, 16 | "The same engine-owned contract supplies the provider schema and result validation; invalid JSON or absent structured output produces a named field/shape failure rather than markdown extraction or an acceptance default." | diff-local |
| Story 6 negative: Given an unknown case reference, missing/duplicate source result, or contradictory binding, when validated, then no partial relation set becomes authoritative | 13 | "The contract validator accepts the three approved outcomes and rejects unknown fields, missing/duplicate source results, unknown case references, and contradictory bindings before publishing any relationship." | diff-local |
| Story 6 negative: Given provider timeout or unavailability, when attempts are exhausted, then a named halt preserves decisions and consumes no BUILD or plan-growth allowance | 19 | "Provider timeout, unavailable result, invalid judgment, and exhaustion of the configured remediate attempt allowance produce a named terminal failure with unchanged BUILD and plan-growth counters, while interruption before publication leaves decisions intact." | diff-local |
| Story 6 negative: Given a contained self-host invocation, when the schema is materialized and the invocation ends or fails, then its scratch-file lifecycle stays within the feature’s authorized writable boundary | 16 | "Normal exit, timeout, spawn failure, invalid final JSON, and absent terminal output return the appropriate result and complete owned scratch cleanup without touching the primary checkout; no-schema invocations create no schema file." | diff-local |
| Story 7 happy: Given a complete current relationship and an authoritative acceptance, when routing, report projection, artifact completion, and ship rendering evaluate it, then they agree the widening is accepted | 20, 22 | "Artifact completion, routing classification, verdict projection, and shipped-record projection agree for accepted, refused, unresolved, and not-blocking fixtures and perform no independent summary matching or provider call." | diff-local |
| Story 7 happy: Given an ordinary story-criterion decision and a reworded report, when evaluated, then criterion-based authority is unchanged without NC semantic rematching | 20 | "The classifier derives accepted/refused/undecided NC outcomes only from valid current relationships and operator authority, while within/outside-harmless inputs remain nonblocking and criterion-keyed decisions survive summary changes." | diff-local |
| Story 7 negative: Given an operator reversal, changed report/source set, or changed code during judgment, when the result returns, then it is rejected as stale and the newer authority remains intact | 19 | "The relation publication transition rejects a concurrent refusal/reversal, changed report/source set, changed code snapshot, feature identity, or contract revision and preserves the newer authoritative state; stale evidence cannot be reused and engine-owned projection rendering alone does not stale the source digest." | diff-local |
| Story 7 negative: Given a reviewer assertion of approval without valid decision/binding evidence, when completion runs, then the assertion cannot make the gate pass | 20, 22 | "Reviewer-only claims, malformed report rows, corrupted/stale relation evidence, and projection write/render failure each prevent clean completion with a named cause and preserve the authoritative decision records." | diff-local |
| Story 7 negative: Given malformed current report rows, corrupt relation evidence, or failure to render an otherwise recorded decision, when completion is checked, then the named defect remains blocking | 22 | "Reviewer-only claims, malformed report rows, corrupted/stale relation evidence, and projection write/render failure each prevent clean completion with a named cause and preserve the authoritative decision records." | diff-local |
| Story 7 negative: Given interruption after decisions persist but before relations publish, when restarted, then decisions survive and incomplete relationships cannot satisfy completion | 19, 22 | "Provider timeout, unavailable result, invalid judgment, and exhaustion of the configured remediate attempt allowance produce a named terminal failure with unchanged BUILD and plan-growth counters, while interruption before publication leaves decisions intact." | diff-local |
| Story 8 happy: Given a recorded offer, import, binding, rejection, or exact-result reuse, when it occurs, then the existing event trail names the relevant source/case/decision and bounded reason | 23 | "The real event emitter/persister and registered ledger consumer expose source/case/decision identifiers and bounded reasons for original offers, imports, decisions, same/different/uncertain relations, rejection, recovery, and exact-result reuse." | diff-local |
| Story 8 happy: Given a recovery condition, when the engine halts, then the halt identifies the affected evidence and a concrete operator recovery action | 24 | "The production PRD halt boundary renders named record references and actionable recovery for malformed/unsupported history, missing attribution, lease/write failure, invalid provider result, stale binding, overflow, and projection failure instead of a generic unresolved verdict." | diff-local |
| Story 8 negative: Given an early return for malformed input, missing attribution, failed persistence, stale judgment, or overflow, when it occurs, then the reason remains visible instead of appearing as a generic unresolved verdict | 23, 24 | "Early-return failure fixtures for malformed input, missing identity, persistence failure, stale result, and overflow emit their distinct reason without hiding retained valid sibling authority or creating a parallel event format." | diff-local |
| Story 8 negative: Given a valid sibling decision or retained refusal during another finding’s failure, when events and reports are rendered, then neither the valid authority nor the remaining defect is hidden | 23, 24 | "Event and halt fixtures identify the same reason and affected records on each alternate branch, retain valid sibling decisions/refusals, and create no implicit acceptance, new retry loop, or NC repair effect." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | task | task-1, task-4, task-5, task-13, task-20 | The case parser accepts each approved domain shape and rejects PRD records carrying build-review effects or autonomous accept/refuse authority, as asserted by domain-shape fixtures. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | task | task-1, task-2, task-3 | The case parser accepts each approved domain shape and rejects PRD records carrying build-review effects or autonomous accept/refuse authority, as asserted by domain-shape fixtures. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | task | task-5, task-6, task-7, task-10, task-21 | The supersession transition preserves both attributed records and makes only a valid same-case explicit reversal effective; foreign-case and stale-revision attempts leave authority unchanged. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | task | task-8, task-9, task-18 | The migration service retains all supported v1 records with original evidence, attribution, decisions, and relative authority, including criteria and NC rows. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | task | task-11, task-13, task-17, task-18, task-19, task-20 | The context assembler consumes actual parsePrdAuditReport output and preserves every valid current NC source plus complete retained PRD history; source-to-normalized fixtures cover no-owner section, renumbering, mixed grades, and malformed rows. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | task | task-13, task-14, task-15, task-16, task-17 | The contract validator accepts the three approved outcomes and rejects unknown fields, missing/duplicate source results, unknown case references, and contradictory bindings before publishing any relationship. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | task | task-12, task-18, task-19 | The context boundary reports dimension, actual size, and limit for each individual and total-byte overflow, without dispatching a judge or silently truncating any source/history record. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | task | task-19, task-20, task-21, task-22 | The relation publication transition rejects a concurrent refusal/reversal, changed report/source set, changed code snapshot, feature identity, or contract revision and preserves the newer authoritative state; stale evidence cannot be reused and engine-owned projection rendering alone does not stale the source digest. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | task | task-23, task-24 | The real event emitter/persister and registered ledger consumer expose source/case/decision identifiers and bounded reasons for original offers, imports, decisions, same/different/uncertain relations, rejection, recovery, and exact-result reuse. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | DECIDE corrections are already part of this spec baseline; native issue ordering is recorded externally. No BUILD task changes another feature’s artifacts or later-slice behavior. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D1 | task | task-20, task-21 | The classifier derives accepted/refused/undecided NC outcomes only from valid current relationships and operator authority, while within/outside-harmless inputs remain nonblocking and criterion-keyed decisions survive summary changes. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D2 | task | task-6, task-21 | The offer service persists original evidence and a stable offer reference before returning any editable halt block; persistence failure returns no usable offer and names the cause. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D3 | task | task-5, task-7, task-10 | The supersession transition preserves both attributed records and makes only a valid same-case explicit reversal effective; foreign-case and stale-revision attempts leave authority unchanged. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D4 | task | task-4, task-5, task-8, task-9, task-18, task-20 | The decision-store parser represents authoritative accept/refuse separately from absent and invalid storage; malformed JSON, unsupported version, and foreign-feature data cannot read as an empty successful history. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D5 | task | task-8, task-9 | The migration service retains all supported v1 records with original evidence, attribution, decisions, and relative authority, including criteria and NC rows. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D6 | task | task-5, task-6, task-21 | The supersession transition preserves both attributed records and makes only a valid same-case explicit reversal effective; foreign-case and stale-revision attempts leave authority unchanged. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D7 | task | task-7, task-23, task-24 | capturePrdWideningDecisions stores every valid original-offer decision once and returns per-row defects for changed references, bad decision words, missing rationale, and unresolved identity without granting authority. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D8 | task | task-22, task-23, task-24 | Artifact completion, routing classification, verdict projection, and shipped-record projection agree for accepted, refused, unresolved, and not-blocking fixtures and perform no independent summary matching or provider call. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D1 | no-change | none | Existing story-authority rule remains unchanged; this plan never alters the requirement source. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D2 | no-change | none | Existing PRD run rule remains unchanged; no track/tier skip is added. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D3 | task | task-11, task-21, task-22 | The context assembler consumes actual parsePrdAuditReport output and preserves every valid current NC source plus complete retained PRD history; source-to-normalized fixtures cover no-owner section, renumbering, mixed grades, and malformed rows. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D4 | task | task-20, task-21 | The classifier derives accepted/refused/undecided NC outcomes only from valid current relationships and operator authority, while within/outside-harmless inputs remain nonblocking and criterion-keyed decisions survive summary changes. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D5 | no-change | none | Existing FIXABLE remediation and allowances are outside this slice; Task 21 retains their routing. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D6 | no-change | none | No plan growth is produced by NC reconciliation; existing growth ledger remains its owner. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D7 | no-change | none | Existing PLAN_GAP classification and routing remain outside this slice. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D8 | task | task-22, task-24 | Artifact completion, routing classification, verdict projection, and shipped-record projection agree for accepted, refused, unresolved, and not-blocking fixtures and perform no independent summary matching or provider call. |

## Verification

- Coverage rows map every happy and negative criterion to scoped behavioral checks; coherence-check must independently judge whether those checks actually deliver each Then-clause.
- Dependencies are acyclic and reference existing task IDs; file overlap further constrains the ready frontier.
- No task appends a catch-all completed-feature test or modifies another feature’s protected artifact.
- Ordinary tests inject third-party boundaries. The harness test_suite gate owns aggregate implementation proof; spec integrity/protected-target/diagram checks run before publication.
