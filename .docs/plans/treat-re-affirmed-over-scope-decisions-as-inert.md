# Implementation Plan: Treat re-affirmed over-scope decisions as inert

**Date:** 2026-09-28
**Stories:** .docs/stories/treat-re-affirmed-over-scope-decisions-as-inert.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to the durable PRD widening reconciliation contract: identical replays are inert, supersession names the latest decision, and pending entries record nothing.

## Summary

Four bounded tasks deliver #2681. A same-authority revision of the latest decision becomes an inert reaffirmation in the decision store. Capture carries the store's invalid-decision rejection as an invalid-decision defect instead of write-failed, and PRD entry reports it through a new invalid-decision recovery reason naming the entry. The over-scope decision block tells the operator that leaving a revise entry pending keeps the prior decision. Genuine reversal semantics, store schema, reconciliation, routing, and projection are unchanged.

## Technical Approach

In AcceptedWideningDecisionStore.append, inside the existing supersedes branch, after the existing replay-of-recorded-supersession check: when prior exists, the supersedes reference names exactly the prior id and revision, and the authority equals the prior authority, return ok with the prior decision and write nothing. Keep every other rejection: a supersedes naming a non-latest decision, a missing prior, or a first decision that omits supersedes while a prior exists all still return invalid-decision. The new rationale is not persisted because the decision in force is unchanged; the durable-reconciliation ADR already treats identical replays as inert and does not require rejecting reaffirmation.

In capturePrdWideningDecisions, on the modern path, map a failed append whose reason is invalid-decision to an invalid-decision defect carrying the offer entry id. All other append failures (lock-timeout, lock-failed, atomic-replace-failed, lease-operation-failed, malformed-state, unsupported-version, foreign-feature, unreadable) remain write-failed. The legacy fenced-clear path is out of scope and keeps its current mapping.

Add invalid-decision to PrdWideningRecoveryReason with action text directing the operator to correct the named entry against the latest halt, or leave its decision pending to keep the prior decision, then clear the halt. In preparePrdWideningBeforeAudit, keep missing-operator and persistence-failed precedence first, then select invalid-decision when any capture defect has kind invalid-decision, before the existing unsupported-history and malformed-history fallbacks. The existing emitPrdWideningRejections loop already emits defect.kind as the prd_widening_reconciled reason, so the event reason becomes invalid-decision with no event schema change.

In renderOverScopeDecisionBlock, extend the revision instruction line to state that leaving decision as pending keeps the prior decision unchanged. Pending-only blocks keep their current text. Capture already skips pending entries, so no parser change is needed.

Tests follow the repository write-tests rules: store and capture unit tests use the real store on a mkdtemp root or the existing injected fake decision store; the conductor integration uses the existing PRD entry fixture, which calls preparePrdWideningBeforeAudit directly with real stores and a mocked feature identity, never a full lifecycle run or a provider.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, and all three stories on 2026-09-28 (delegated).
- Verified: src/conductor/src/engine/accepted-widenings.ts append returns invalid-decision in its supersedes branch when parsedInput.authority equals prior.authority, after a replay check that only matches an already-recorded supersession.
- Verified: src/conductor/src/engine/prd-widening-capture.ts modern path pushes a write-failed defect with offerEntryId for every failed append, and skips entries whose decision is pending.
- Verified: src/conductor/src/engine/conductor.ts preparePrdWideningBeforeAudit maps write-failed or offer-read-failed defects to persistence-failed and every non-listed defect to malformed-history, and emits each defect kind as the rejection reason.
- Verified: src/conductor/src/engine/prd-widening-recovery.ts persistence-failed text reads resolve the store or lease failure; the ACTIONS map is a Record keyed by PrdWideningRecoveryReason.
- Verified: renderOverScopeDecisionBlock in accepted-widenings.ts renders revise-decision entries with decision pending and an instruction to edit each decision to accept or refuse.
- Verified: prd_widening_reconciled in src/conductor/src/types/events.ts has an optional free-string reason field.
- Verified: tests exist at src/conductor/test/engine/accepted-widenings.test.ts, src/conductor/test/engine/prd-widening-capture.test.ts, src/conductor/test/engine/prd-widening-recovery.test.ts, src/conductor/test/engine/conductor-prd-widening-capture.test.ts, and src/conductor/test/prd-audit-kickback.test.ts.
- Scope check: engine behavior, no HARNESS.md change; no skill addition; provider-agnostic. Event-spine: no new channel or variant.
- Verify-claims verdict: CLEAR. No pending product or scope assumptions.

## Tasks

### Task 1: Make a same-authority revision of the latest decision inert
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/accepted-widenings.ts, src/conductor/test/engine/accepted-widenings.test.ts
**Dependencies:** none

**Steps:**
1. Add RED store tests on a mkdtemp root: append a refuse decision with an offer entry id, then append a refuse revision whose supersedes names that decision; expect ok with the first decision and a stored history of one decision.
2. Add a store test where a reversal creates revision 2 and a same-authority revision then names revision 1; expect invalid-decision and an unchanged two-decision history.
3. Implement the inert branch described in the Technical Approach inside the existing supersedes branch.
4. Run the focused test file through ai-conductor scoped-run and commit.

**Done when:**
1. A same-authority revision naming the latest decision returns that decision and the store still holds exactly one decision.
2. A same-authority revision naming a superseded decision returns invalid-decision and the stored history is byte-identical.
3. The existing reversal test that reuses its rendered offer id still appends revision 2.

### Task 2: Report an unapplicable decision as invalid-decision at PRD entry
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/prd-widening-capture.ts, src/conductor/src/engine/prd-widening-recovery.ts, src/conductor/src/engine/conductor.ts, src/conductor/test/engine/prd-widening-capture.test.ts, src/conductor/test/engine/prd-widening-recovery.test.ts
**Dependencies:** none

**Steps:**
1. Add RED capture unit tests with the existing injected fake decision store: an append returning invalid-decision yields an invalid-decision defect with the offer id; an append returning atomic-replace-failed still yields write-failed.
2. Add a RED recovery unit case for invalid-decision asserting the text mentions leaving the decision pending and does not mention a store or lease failure.
3. Implement the capture mapping, the new recovery reason and action text, and the reason-selection branch in preparePrdWideningBeforeAudit.
4. Run the focused test files through ai-conductor scoped-run and commit.

**Done when:**
1. Capture maps a store invalid-decision result to an invalid-decision defect with the offer entry id.
2. Capture still maps lock, lease, and atomic-replace append failures to write-failed, and PRD entry then halts with reason persistence-failed naming the entry.
3. The invalid-decision recovery text mentions pending and contains neither store failure nor lease failure wording, and tells the operator to correct the entry or leave it pending to keep the prior decision.
4. When the decision store rejects a cleared entry as invalid-decision, PRD entry halts with reason invalid-decision naming the entry's offer id, and the emitted rejection event for that cleared entry carries reason invalid-decision and never write-failed.

### Task 3: Tell the operator how to keep a prior decision
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/accepted-widenings.ts, src/conductor/test/prd-audit-kickback.test.ts
**Dependencies:** none

**Steps:**
1. Add a RED rendering test beside the existing renderOverScopeDecisionBlock cases: a revise-decision offer renders the keep-prior instruction; a pending-only block does not.
2. Extend the revision instruction line in renderOverScopeDecisionBlock.
3. Run the focused test file through ai-conductor scoped-run and commit.

**Done when:**
1. A rendered block with a revise-decision entry states that leaving decision as pending keeps the prior decision unchanged.
2. A rendered block with only pending entries contains no keep-prior instruction.

### Task 4: Prove PRD entry outcomes with the real stores
**Story:** Story 1
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/conductor-prd-widening-capture.test.ts
**Dependencies:** 1, 2

**Steps:**
1. Extend the existing PRD entry fixture: seed a refuse decision through the real AcceptedWideningDecisionStore for the fixture offer, then write a cleared HALT whose revise entry names that decision with decision refuse and a rationale.
2. Call preparePrdWideningBeforeAudit directly and assert it returns undefined and the decision inventory is unchanged.
3. Add a stale-revision case whose revise entry names a superseded decision with the same authority; assert the returned text contains invalid-decision and the offer id and does not contain persistence-failed.
4. Assert the emitted prd_widening_reconciled rejection reason is invalid-decision through the injected ConductorEventEmitter.
5. Run the focused test file through ai-conductor scoped-run and commit.

**Done when:**
1. A refuse reaffirmation at PRD entry returns no halt text and leaves the decision inventory unchanged.
2. A stale same-authority revision at PRD entry returns invalid-decision naming the offer id and never persistence-failed.
3. The rejection event for the stale revision carries reason invalid-decision and never write-failed.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the latest decision for an over-scope case is refuse, when the operator clears its revise-decision entry naming that decision with decision refuse and a rationale, then the store returns the prior decision unchanged and appends no new revision. | 1 | "A same-authority revision naming the latest decision returns that decision and the store still holds exactly one decision." | diff-local |
| Story 1 happy: Given a cleared HALT re-affirms the latest decision's authority, when PRD entry prepares the audit, then it returns no halt and the stored decision history is unchanged. | 4 | "A refuse reaffirmation at PRD entry returns no halt text and leaves the decision inventory unchanged." | diff-local |
| Story 1 negative: Given a revise-decision entry names a decision that is not the latest one for its case, when it is appended with the same authority, then the store still rejects it as invalid-decision and the stored history is unchanged. | 1 | "A same-authority revision naming a superseded decision returns invalid-decision and the stored history is byte-identical." | diff-local |
| Story 2 happy: Given the decision store rejects a cleared entry as invalid-decision, when PRD entry prepares the audit, then the halt reason is invalid-decision, it names the entry's offer id, and its recovery text tells the operator to correct the entry or leave it pending to keep the prior decision. | 2, 4 | "A stale same-authority revision at PRD entry returns invalid-decision naming the offer id and never persistence-failed." | diff-local |
| Story 2 negative: Given the decision store fails an append with a lock, lease, or atomic-replace failure, when PRD entry prepares the audit, then the halt reason remains persistence-failed naming the entry. | 2 | "Capture still maps lock, lease, and atomic-replace append failures to write-failed." | diff-local |
| Story 2 negative: Given the decision store rejects a cleared entry as invalid-decision, when capture records the defect, then the rejection event reason is invalid-decision and never write-failed. | 2, 4 | "The rejection event for the stale revision carries reason invalid-decision and never write-failed." | diff-local |
| Story 3 happy: Given a refused finding renders a revise-decision entry, when the over-scope decision block is rendered, then its instructions say that leaving decision as pending keeps the prior decision unchanged. | 3 | "A rendered block with a revise-decision entry states that leaving decision as pending keeps the prior decision unchanged." | diff-local |
| Story 3 negative: Given only undecided pending entries and no revise-decision entry are rendered, when the over-scope decision block is rendered, then the keep-prior instruction is absent. | 3 | "A rendered block with only pending entries contains no keep-prior instruction." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns store unit coverage for reaffirmation and stale revisions. Task 2 owns capture mapping and recovery text units. Task 3 owns decision-block rendering. Task 4 owns the PRD entry integration through preparePrdWideningBeforeAudit with the real decision and case stores, a mocked feature identity and machine owner, and the injected event emitter; it stops at the entry boundary and never dispatches a provider or runs the full lifecycle. Existing reversal, lease-failure, and atomic-replace tests remain authoritative for unchanged behavior. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 4
Task 2 -> Task 4

Task 3 has no dependencies.

Small tier: architecture and coherence artifacts are skipped. No new ADR or amendment is required because reaffirmation-as-replay is consistent with the durable-reconciliation ADR's inert-replay rule.
