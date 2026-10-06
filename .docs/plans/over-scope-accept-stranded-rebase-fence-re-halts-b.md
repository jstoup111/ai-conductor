# Implementation Plan: Over-scope accept stranded behind the resume-time rebase fence

**Date:** 2026-10-04
**Design:** .docs/decisions/adr-2026-10-04-resume-completes-interrupted-rebase-operation.md
**Stories:** .docs/stories/over-scope-accept-stranded-rebase-fence-re-halts-b.md
**Conflict check:** Clean as of 2026-10-04 (.docs/conflicts/2026-10-04-over-scope-accept-stranded-rebase-fence-re-halts-b.md)

## Summary

Split the rebase publication fence into a typed classification so resume blocks only on integrity
faults while finish keeps the full fence; persist preservation evidence on the rebase operation so
resume can complete an interrupted (`applying`) operation; name pending over-scope decisions in
resume-fence halts; and report the reconciled classification in the prd_audit verdict reason.
13 tasks in 4 slices.

## Technical Approach

- **Fence classification (ADR D4, D5).** `src/conductor/src/engine/gate-code-validity.ts` gains an
  exported `classifyRebaseOperation(projectRoot)` returning a discriminated union:
  `{ kind: 'clear' }`, `{ kind: 'applying'; operation }`, `{ kind: 'integrity-fault'; message }`,
  `{ kind: 'outstanding-gate'; gate; message }`. `outstanding-gate` is exactly a preserved gate whose
  verdict is unsatisfied with `checkedAt` strictly newer than the applied-at time (`appliedAt`, else
  the rebase verdict's `checkedAt`). Everything else the current fence rejects is `integrity-fault`
  (malformed, absent verdict, unsatisfied at/before applied-at, unstamped PASS). The existing
  `rebaseOperationPublicationBlocker` becomes a thin wrapper returning the same strings for every
  non-`clear` kind, so the finish predicate in `artifacts.ts` and its tests are untouched. The fence
  module must not import prd-widening code.
- **Persisted preservation evidence (D1).** `RebaseOperationRecord` (`gate-verdicts.ts`) gains an
  optional `preservationEvidence: RebasePreservedCandidate-shaped[]` (`gate`, `original`,
  `originalVerdictDigest`, `relevantInputIdentities`). `applyRebaseTransition`
  (`rebase-transition.ts`) writes it in the same `applying` descriptor write that names the
  transition, and the `applied` write retains it. `validRebaseOperationRecord` accepts absent
  evidence; when present it must be an array whose gate set equals `transition.preserved` and whose
  entries each carry a non-empty `originalVerdictDigest`.
- **Completion (D2, D3).** `rebase-transition.ts` gains `completeInterruptedRebaseOperation(options)`
  taking the persisted record, the state store/path, a `preVerify(step)` capability, and the ordered
  list of steps downstream of `rebase`. Full descriptor with evidence: for each preserved gate whose
  current verdict digest equals its evidence digest, keep it preserved; a mismatched gate is removed
  from `preserved` and classified by the existing post-rebase rule — reverified when the step
  declares `treeAttestingCompletion` and `preVerify(gate).done`, otherwise invalidated with an
  unsatisfied kickback-shaped verdict — then it calls the existing `applyRebaseTransition` with the
  same operation id (idempotent `already-applied` on a second call). No evidence: invalidated ∪
  preserved are all invalidated, `preserved: []`. Provisional `preparing-…` descriptor: every
  downstream gate invalidated, `preserved: []`. Reuse `applyRebaseVerdicts`' existing per-gate
  writers in `rebase.ts` (search hints: `treeAttestingCompletion`, `kickedBack.push`,
  `writeVerdict(projectRoot, gate.name`) instead of new verdict writers.
- **Resume wiring (D2–D4, D6).** In `Conductor.run()`'s `this.resume` branch (`conductor.ts`,
  before `findResumeIndex`): call `classifyRebaseOperation`; on `applying`, run completion with the
  conductor's existing `preVerify` closure (search hint: `const preVerify = async (step: StepName)`)
  and re-classify; on `refused`, halt with the existing string `rebase continuation state transition
  was refused; inspect concurrent state updates before resuming`; on `integrity-fault`, halt
  `needs-human` with the fault text plus the decision note; on `outstanding-gate` or `clear`,
  continue to the existing verdict-aware clamp.
- **Decision note (D6).** New `src/conductor/src/engine/rebase-fence-decision-note.ts` exports
  `renderRebaseFenceDecisionNote(projectRoot)` composing from `parseClearedOverScopeDecisions` over
  `.pipeline/HALT.cleared`, the `AcceptedWideningDecisionStore`, and the remediation-case offers. It
  only reads; it returns `''` when no offer/decision exists, and a fixed unreadable-state line when a
  store fails to parse.
- **prd_audit reason (track item 3).** The prd_audit completion predicate scores before
  `routeCurrentPrdAudit` reconciles the offer, so a brand-new NC source classifies
  `missing-relation`. After reconciliation in the prd_audit post-step path (`routeCurrentPrdAudit`
  → `routeCurrentPrdAuditOverScope`), re-score with `classifyPrdAuditWideningProjection` and rewrite
  the persisted `.pipeline/gates/prd_audit.json` reason before the `gate_verdict` event is emitted,
  so file and event agree. A `missing-decision` OVER_SCOPE row renders `NC.n (OVER_SCOPE)
  [awaiting-decision] — record a decision with \`ai-conductor halt clear\``; other classifications
  keep their current bracket tag and text.

## Prerequisites
- None.

## Slices

| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Fence classification and resume routing | 1, 2, 3 |
| 2 | Persisted evidence and completion | 4, 5, 6, 7, 8, 12, 13 |
| 3 | Decision-naming halts | 9, 10 |
| 4 | prd_audit reason | 11 |

## Tasks

### Task 1: Typed rebase fence classification with finish behavior unchanged
**Story:** Story 2 (all criteria)
**Type:** refactor

**Steps:**
1. Write failing tests in `src/conductor/test/engine/gate-code-validity.test.ts` for `classifyRebaseOperation`: `clear` for stamped/fresh-passing preserved gates; `outstanding-gate` (gate `prd_audit`) for an unsatisfied verdict newer than `appliedAt`; `applying` for `status: applying`; `integrity-fault` for absent verdict, unsatisfied at/before applied-at, unstamped PASS, malformed record.
2. Add finish-fence assertions that `rebaseOperationPublicationBlocker` returns the exact existing strings, including `rebase transition still has an outstanding prd_audit repair or re-verification` for the `outstanding-gate` fixture.
3. Implement the classifier; reimplement the blocker as a wrapper mapping every non-`clear` kind to its existing string.

**Done when:**
- `classifyRebaseOperation` returns `outstanding-gate` naming `prd_audit` for a preserved unsatisfied verdict whose `checkedAt` is newer than `appliedAt`, and `integrity-fault` for that verdict at or before `appliedAt`, asserted in gate-code-validity.test.ts.
- `rebaseOperationPublicationBlocker` returns no blocker when every preserved gate is stamped for the operation or freshly re-judged satisfied after the applied-at time, as asserted by a finish-fence test.
- `rebaseOperationPublicationBlocker` returns exactly `rebase transition still has an outstanding prd_audit repair or re-verification` for the post-rebase failing re-judgement fixture, and exactly `rebase transition still has an outstanding build_review repair or re-verification` when no `build_review` verdict file exists.
- `rebaseOperationPublicationBlocker` returns exactly `rebase transition is still applying; reconcile the persisted rebase operation before publication` for `status: applying`, and exactly `rebase transition preserved build_review without its replay-bound authority` for an unstamped satisfied `build_review` not newer than the applied-at time.
- Every pre-existing test in gate-code-validity.test.ts and test/integration/rebase-preserved-readers.test.ts passes without modification, and gate-code-validity.ts has no import from any prd-widening or accepted-widenings module.

**Files likely touched:**
- src/conductor/src/engine/gate-code-validity.ts — classifier + wrapper
- src/conductor/test/engine/gate-code-validity.test.ts — classifier and finish-string tests

**Dependencies:** none

### Task 2: Resume blocks only on integrity faults
**Story:** Story 1 happy 3, negatives 3–6
**Type:** happy-path

**Steps:**
1. Write failing conductor resume tests (`src/conductor/test/engine/conductor-resume-rebase-fence.test.ts`, mocked step runner) with an applied rebase record: (a) preserved `build_review` with a post-rebase failing re-judgement → `build_review` dispatched, no HALT; (b) preserved `prd_audit` unsatisfied at/before applied-at; (c) no `prd_audit.json`; (d) unstamped satisfied `build_review` not newer than applied-at; (e) malformed record (gate in both `preserved` and `invalidated`).
2. In `Conductor.run()`'s resume branch replace the blocker call with `classifyRebaseOperation`; halt `needs-human` only for `integrity-fault`; let `outstanding-gate`/`clear` fall through to the verdict-aware clamp.

**Done when:**
- Resume fixture (a) emits `step_started` for `build_review` (the clamp's earliest unsatisfied gate) and writes no `.pipeline/HALT`.
- Resume fixtures (b) and (c) each write `.pipeline/HALT` with class `needs-human` whose body names the outstanding `prd_audit` repair, and emit no `step_started` event.
- Resume fixture (d) writes a `needs-human` HALT containing `preserved build_review without its replay-bound authority` and emits no `step_started` event.
- Resume fixture (e) writes a `needs-human` HALT containing `rebase transition record is malformed` and emits no `step_started` event.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — resume branch uses the classifier
- src/conductor/test/engine/conductor-resume-rebase-fence.test.ts — new resume tests

**Dependencies:** Task 1

### Task 3: #2983 reproduction — recorded decision reaches the prd_audit lap through resume
**Story:** Story 1 happy 1–2, negatives 1–2
**Type:** happy-path (integration owner for ADR D4)

**Steps:**
1. Write a failing integration test (`src/conductor/test/integration/rebase-fence-over-scope-resume.test.ts`) through `Conductor.run({ resume: true })` reproducing #2983: applied rebase record preserving stamped `build_review` and `prd_audit`; `prd_audit.json` unsatisfied for NC.1 OVER_SCOPE newer than `appliedAt`; an NC.1 offer in `remediation-cases.json`; `HALT.cleared` with `decision: accept` + rationale; a scripted prd_audit lap that re-grades NC.1 OVER_SCOPE for the same source.
2. Variants: `decision: refuse`; untouched decision block (no decision).
3. Fix any wiring gap so the resumed lap runs `preparePrdWideningBeforeAudit` (existing harvester).

**Done when:**
- Through `Conductor.run({ resume: true })`, the accept fixture emits `step_started` for `prd_audit` with no `loop_halt` before it, and `.pipeline/accepted-widenings.json` then contains an `accept` decision for the NC.1 case.
- In the accept fixture the persisted `.pipeline/gates/prd_audit.json` ends `satisfied: true`, a later step after `prd_audit` emits `step_started`, and the test never deletes `.pipeline/HALT`.
- The refuse fixture ends with the existing prd_audit refused-widening halt (its existing halt class and text) and the HALT body does not contain `rebase transition`.
- The no-decision fixture ends with the existing prd_audit over-scope decision block naming NC.1 as awaiting a decision.

**Files likely touched:**
- src/conductor/test/integration/rebase-fence-over-scope-resume.test.ts — new
- src/conductor/src/engine/conductor.ts — only if a wiring gap is found

**Dependencies:** Task 2

### Task 4: Persist preservation evidence on the rebase operation record
**Story:** Story 3 happy 1–2, negative 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase-transition.test.ts`: a transition preserving `build_review` and `prd_audit` persists `preservationEvidence` in the `applying` write (capture the record between writes via the state-store mock) and retains it after `applied`; a no-preservation transition persists `[]`.
2. Add the optional field to `RebaseOperationRecord` in `gate-verdicts.ts`; populate it in `applyRebaseTransition` from `preservedCandidates`.

**Done when:**
- The `rebaseOperation` written with `status: applying` by `applyRebaseTransition` carries one `preservationEvidence` entry per preserved gate with `gate`, `original`, `originalVerdictDigest` (prefix `sha256`), and `relevantInputIdentities`, observed before the state batch runs.
- After the operation is marked `applied`, the persisted record still carries the same `preservationEvidence` and `validRebaseOperationRecord` returns true for it.
- A transition preserving no gates persists `preservationEvidence: []` and validates.

**Files likely touched:**
- src/conductor/src/engine/gate-verdicts.ts — record type
- src/conductor/src/engine/rebase-transition.ts — write evidence
- src/conductor/test/engine/rebase-transition.test.ts — tests

**Dependencies:** none

### Task 5: Validate persisted preservation evidence
**Story:** Story 3 negatives 1–3
**Type:** negative-path

**Steps:**
1. Write failing validator tests (`src/conductor/test/engine/gate-verdicts.test.ts` or the existing validator test location): absent evidence valid; gate set ≠ `transition.preserved` invalid; non-array invalid; entry without `originalVerdictDigest` invalid.
2. Extend `validRebaseOperationRecord`.

**Done when:**
- `validRebaseOperationRecord` returns true for an otherwise valid record with no `preservationEvidence` field.
- `validRebaseOperationRecord` returns false when `preservationEvidence` names a gate set different from `transition.preserved`.
- `validRebaseOperationRecord` returns false when `preservationEvidence` is not an array, and false when an entry lacks a non-empty `originalVerdictDigest`.

**Files likely touched:**
- src/conductor/src/engine/gate-verdicts.ts — validator
- src/conductor/test/engine/gate-verdicts.test.ts — validator tests

**Dependencies:** Task 4

### Task 6: Complete an interrupted operation from its persisted evidence
**Story:** Story 4 happy 1, negative 1, negative 2 (test_suite reuse)
**Type:** happy-path

**Steps:**
1. Write failing tests in `rebase-transition.test.ts` for `completeInterruptedRebaseOperation` with a full `applying` record carrying evidence: (a) all preserved verdicts match → stamped, invalidated gates `pending` + unsatisfied, record `applied` with `appliedAt`; (b) `prd_audit` verdict mismatches its digest and is not tree-attesting → removed from `preserved`, `pending` + unsatisfied; (c) preserved `test_suite` mismatches and `preVerify('test_suite')` returns done → listed in `transition.reverified`, not invalidated.
2. Implement by reusing the existing per-gate reverify/kickback writers from `rebase.ts` (search hints: `treeAttestingCompletion`, `kickedBack.push`) and then calling `applyRebaseTransition` with the recorded id.

**Done when:**
- For fixture (a) the completed record has `status: applied` with an `appliedAt` stamp, every preserved gate's verdict carries `preservation.operationId` equal to the operation id, and every invalidated gate is `pending` in conduct state with an unsatisfied verdict.
- For fixture (b) `prd_audit` is absent from the completed `transition.preserved`, carries no preservation stamp, is `pending` in conduct state, and has an unsatisfied verdict.
- For fixture (c) `test_suite` appears in the completed `transition.reverified`, is not `pending`, and its verdict is satisfied.
- Reclassifying any completed fixture with `classifyRebaseOperation` returns `clear` or `outstanding-gate`, never `integrity-fault`.

**Files likely touched:**
- src/conductor/src/engine/rebase-transition.ts — completion function
- src/conductor/src/engine/rebase.ts — export the existing per-gate rerun-or-reuse helper if needed
- src/conductor/test/engine/rebase-transition.test.ts — tests

**Dependencies:** Tasks 1, 4

### Task 7: Fail-closed completion without evidence
**Story:** Story 5 happy 1–2, negative 1
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) full `applying` record without `preservationEvidence` → every gate in `invalidated` ∪ `preserved` `pending` + unsatisfied, none stamped, `transition.preserved: []`, `applied`; (b) provisional `preparing-…` record with a satisfied pre-rebase verdict on every downstream gate → every downstream gate `pending` + unsatisfied, `applied`, `transition.preserved: []`.
2. Implement both branches in `completeInterruptedRebaseOperation`, taking the downstream-step list as an input.

**Done when:**
- For fixture (a) every gate in the original `invalidated` and `preserved` sets is `pending` in conduct state with an unsatisfied verdict, none carries a preservation stamp, and the record is `applied` with `transition.preserved` empty.
- For fixture (b) every step in the supplied downstream list is `pending` with an unsatisfied verdict, the record is `applied` with `transition.preserved` empty, and no downstream gate verdict remains `satisfied: true`.
- After completing either fixture, `rebaseOperationPublicationBlocker` returns no `still applying` blocker, and `earliestUnsatisfiedGateIndex` over the persisted verdicts selects a re-checked gate before `finish`.

**Files likely touched:**
- src/conductor/src/engine/rebase-transition.ts — fallback branches
- src/conductor/test/engine/rebase-transition.test.ts — tests

**Dependencies:** Task 6

### Task 8: Resume completes interrupted operations before dispatch
**Story:** Story 4 happy 1–2 and negatives 1, 2, 4 (through resume)
**Type:** happy-path (integration owner for ADR D2/D3)

**Steps:**
1. Write failing resume tests in `conductor-resume-rebase-fence.test.ts` through `Conductor.run({ resume: true })`: (a) `applying` record with evidence and matching verdicts; (b) resume again on (a)'s result; (e) `applying` record with evidence where `prd_audit`'s verdict mismatches its digest; (h) `applying` record with evidence where preserved `test_suite` mismatches its digest and `preVerify('test_suite')` reports done; (i) `applying` record with evidence where `prd_audit`'s verdict mismatches its digest and `preVerify('prd_audit')` reports done. Fixture (e) stubs `preVerify('prd_audit')` as not done.
2. Wire the `applying` branch in the resume path to `completeInterruptedRebaseOperation` with the conductor's `preVerify` closure (search hint: `const preVerify = async (step: StepName)`) and the registry's steps after `rebase`; re-classify after completion and continue to the verdict-aware clamp.

**Done when:**
- Through `Conductor.run({ resume: true })`, fixture (a) persists `rebaseOperation.status = applied` with an `appliedAt` stamp before the first `step_started` event, preserved gates carry `preservation.operationId`, every invalidated gate is `pending` with an unsatisfied verdict, and the first `step_started` is the clamp's earliest unsatisfied gate.
- A second `Conductor.run({ resume: true })` on fixture (a)'s result leaves every `.pipeline/gates/*.json` byte-identical, writes no `.pipeline/HALT`, and applies no conduct-state mutation batch.
- Fixture (e) completes with `prd_audit` absent from `transition.preserved`, its verdict carrying no preservation stamp, `pending` with an unsatisfied verdict because its completion check does not mechanically re-verify the current tree, writes no `.pipeline/HALT`, and the first `step_started` is the clamp's earliest unsatisfied gate.
- Fixture (h), whose preserved `test_suite` verdict mismatches its persisted evidence digest and whose completion check mechanically re-verifies the current tree, completes with `test_suite` in `transition.reverified`, absent from `transition.preserved`, carrying no preservation stamp, and emits no `step_started` event for `test_suite`.
- Fixture (i), whose `prd_audit` verdict mismatches its persisted evidence digest and whose completion check mechanically re-verifies the current tree, completes with `prd_audit` in `transition.reverified`, absent from `transition.preserved`, carrying no preservation stamp, emits no `step_started` event for `prd_audit`, and writes no `.pipeline/HALT`, so together with fixture (e) `prd_audit` is re-verified or left `pending` by the same post-rebase rerun-or-reuse rule that classifies `test_suite`.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — resume `applying` branch
- src/conductor/test/engine/conductor-resume-rebase-fence.test.ts — tests

**Dependencies:** Tasks 2, 7

### Task 9: Render the pending-decision note
**Story:** Story 6 happy 1–2 (text), negatives 1–2
**Type:** happy-path

**Steps:**
1. Write failing unit tests (`src/conductor/test/engine/rebase-fence-decision-note.test.ts`) for `renderRebaseFenceDecisionNote(projectRoot)`: recorded accept in `HALT.cleared`; recorded refuse; pending offer with no decision; no offer/decision; unparseable `accepted-widenings.json`.
2. Implement in `src/conductor/src/engine/rebase-fence-decision-note.ts` using `parseClearedOverScopeDecisions`, `AcceptedWideningDecisionStore`, and the remediation-case offer reader; read-only.

**Done when:**
- With `HALT.cleared` recording `decision: accept` for NC.1, the note names `NC.1` with recorded state `accept`; with `decision: refuse` it names `NC.1` with recorded state `refuse`.
- With an NC.1 offer and no recorded decision, the note names `NC.1` as awaiting a decision and contains `ai-conductor halt clear`.
- With no offer and no decision the function returns the empty string.
- With an unparseable `.pipeline/accepted-widenings.json` the function resolves (does not throw) to a note stating the recorded decision state could not be read.

**Files likely touched:**
- src/conductor/src/engine/rebase-fence-decision-note.ts — new
- src/conductor/test/engine/rebase-fence-decision-note.test.ts — new

**Dependencies:** none

### Task 10: Resume integrity halts carry the decision note
**Story:** Story 6 happy 1–2 (through resume), negatives 1–3
**Type:** happy-path (integration owner for ADR D6)

**Steps:**
1. Write failing resume tests in `conductor-resume-rebase-fence.test.ts`: integrity-fault fixture with (a) `HALT.cleared` recording accept for NC.1; (b) pending NC.1 offer; (c) no offer/decision; (d) unparseable `accepted-widenings.json`; snapshot `HALT.cleared` bytes before/after.
2. Append `renderRebaseFenceDecisionNote` output to the resume integrity-fault halt body; next action for the fault stays the fault text's own instruction.

**Done when:**
- Through `Conductor.run({ resume: true })` with a malformed-record integrity fault, fixture (a)'s `.pipeline/HALT` contains the fault text, its next-action instruction `reconcile it before publication`, `NC.1`, and recorded state `accept`; fixture (b)'s contains `NC.1`, awaiting a decision, and `ai-conductor halt clear`.
- Fixture (c)'s `.pipeline/HALT` body equals the fault text followed by a single newline, exactly as before this feature.
- Fixture (d) still writes `.pipeline/HALT` with class `needs-human` containing the fault text and the unreadable-decision-state line.
- In every fixture `.pipeline/HALT.cleared` is byte-identical before and after the resume.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — compose halt body
- src/conductor/test/engine/conductor-resume-rebase-fence.test.ts — tests

**Dependencies:** Tasks 2, 9

### Task 11: prd_audit verdict reason uses the reconciled classification
**Story:** Story 7 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests (`src/conductor/test/engine/prd-audit-reconciled-reason.test.ts`, conductor with scripted prd_audit lap): (a) new NC.1 OVER_SCOPE source reconciled as an offer in the same lap; (b) next lap after an accept is recorded; (c) reconciliation judges NC.1 `uncertain`; (d) corrupt decision store; (e) FIXABLE-only report with no OVER_SCOPE finding; (f) reconciliation judges NC.1 `different`.
2. After `routeCurrentPrdAudit` reconciliation, re-score via `classifyPrdAuditWideningProjection` and rewrite the persisted prd_audit verdict reason before its `gate_verdict` emission; render `missing-decision` as `[awaiting-decision]` with the `ai-conductor halt clear` instruction.

**Done when:**
- For fixture (a) `.pipeline/gates/prd_audit.json` reason contains `NC.1 (OVER_SCOPE) [awaiting-decision]` and `ai-conductor halt clear`, and contains neither `[missing-relation]` nor `close the gap (BUILD)`.
- For fixture (a) the `gate_verdict` event for `prd_audit` carries a reason string identical to the persisted gate file's reason.
- For fixture (b) the persisted prd_audit reason does not list NC.1 as blocking.
- Fixture (c), whose reconciliation judges NC.1's relation `uncertain`, and fixture (f), whose reconciliation judges NC.1's relation `different`, each persist a reason containing `[uncertain-relation]`; fixture (d) reason contains `[corrupt-decision-store]` with `satisfied: false`.
- Fixture (e), a prd_audit lap with a FIXABLE criterion and no OVER_SCOPE finding, persists a reason that contains `close the gap (BUILD) or amend the PRD (DECIDE)`, contains none of `[awaiting-decision]`, `[uncertain-relation]`, or `[corrupt-decision-store]`, and equals the reason the existing prd_audit verdict renderer produces for the same report without reconciliation re-scoring.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — re-score after reconciliation
- src/conductor/src/engine/artifacts.ts — reason rendering for `missing-decision`
- src/conductor/test/engine/prd-audit-reconciled-reason.test.ts — new

**Dependencies:** none

### Task 12: Resume completion refusals and malformed applying records halt
**Story:** Story 4 negative 3; Story 5 negatives 2–3
**Type:** negative-path

**Steps:**
1. Write failing resume tests in `conductor-resume-rebase-fence.test.ts`: (c) `applying` record whose completion is refused because conduct state for an invalidated gate changed concurrently (state-store mock rejects the batch), once with evidence and once without; (d) `applying` record malformed for a reason other than missing evidence (gate in both `preserved` and `invalidated`).
2. Map a `refused` completion to the existing refusal halt; route a malformed `applying` record to the integrity-fault halt without attempting completion.

**Done when:**
- Fixture (c), with and without evidence, writes `.pipeline/HALT` with class `needs-human` containing `rebase continuation state transition was refused` and emits no `step_started` event.
- Fixture (d) leaves `rebaseOperation.status` as `applying`, writes a `needs-human` HALT containing `rebase transition record is malformed`, and emits no `step_started` event.
- In fixture (d) `completeInterruptedRebaseOperation` is never invoked, asserted via a spy on the completion module.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — refusal and malformed routing
- src/conductor/test/engine/conductor-resume-rebase-fence.test.ts — tests

**Dependencies:** Task 8

### Task 13: Resume completes evidence-less interrupted operations
**Story:** Story 5 happy 1–2 (through resume)
**Type:** happy-path

**Steps:**
1. Write failing resume tests in `conductor-resume-rebase-fence.test.ts` through `Conductor.run({ resume: true })`: (f) full `applying` record without `preservationEvidence`, with satisfied pre-rebase verdicts on its `invalidated` and `preserved` gates; (g) provisional `preparing-…` record with a satisfied verdict on every step after `rebase` in the step registry.
2. Confirm the resume `applying` branch from Task 8 passes the registry's steps after `rebase` to `completeInterruptedRebaseOperation`; fix if not.

**Done when:**
- Fixture (f) ends with `rebaseOperation.status = applied`, `transition.preserved` empty, every gate in the original `invalidated` and `preserved` sets `pending` with an unsatisfied verdict, no gate verdict carrying a preservation stamp, and no `.pipeline/HALT` written.
- Fixture (g) ends with `rebaseOperation.status = applied`, `transition.preserved` empty, every step after `rebase` in the step registry `pending` with an unsatisfied verdict, no gate verdict carrying a preservation stamp, and no `.pipeline/HALT` written.

**Files likely touched:**
- src/conductor/test/engine/conductor-resume-rebase-fence.test.ts — tests
- src/conductor/src/engine/conductor.ts — only if the downstream-step list is not passed

**Dependencies:** Task 8

## Task Dependency Graph

```
1 ──► 2 ──► 3
│     ├──────────────► 8
│     └──────────────► 10 ◄── 9
4 ──► 5
4 ─┬► 6 ──► 7 ──► 8 ──┬► 12
                      └► 13
1 ─┘
11 (independent)
```

## Integration Points
- After Task 3: the #2983 state resumes, harvests the accept, and passes prd_audit end to end.
- After Task 8: an interrupted rebase completes on resume and the clamp takes over.
- After Task 10: integrity halts name pending decisions.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an applied rebase record preserving `build_review` (stamped for that operation) and `prd_audit`, a `prd_audit` verdict that is a post-rebase failing re-judgement for an NC.1 OVER_SCOPE offer, and `.pipeline/HALT.cleared` recording `decision: accept` with a rationale for NC.1, when the conductor resumes, then it writes no HALT before dispatch, dispatches `prd_audit`, and the decision is captured into `.pipeline/accepted-widenings.json` | 3 | "emits `step_started` for `prd_audit` with no `loop_halt` before it" | diff-local |
| Story 1 happy: Given the resume above and a prd_audit report that again grades NC.1 OVER_SCOPE for the same source, when the prd_audit completion predicate runs, then the gate verdict is satisfied and the feature advances past `prd_audit` without any operator deletion of `.pipeline/HALT` | 3 | "the test never deletes `.pipeline/HALT`" | diff-local |
| Story 1 happy: Given an applied rebase record preserving `build_review` whose verdict is a post-rebase failing re-judgement, when the conductor resumes, then it dispatches `build_review` (the earliest unsatisfied gate) and writes no rebase-fence HALT | 2 | "emits `step_started` for `build_review`" | diff-local |
| Story 1 negative: Given the first happy-path setup but `HALT.cleared` records `decision: refuse` for NC.1, when the resumed `prd_audit` lap completes, then the feature halts through prd_audit exactly as it does today for a refused widening, and no rebase-fence HALT is written | 3 | "ends with the existing prd_audit refused-widening halt" | diff-local |
| Story 1 negative: Given the first happy-path setup but no recorded over-scope decision exists, when the resumed `prd_audit` lap completes, then the feature halts with the existing prd_audit over-scope decision block naming NC.1 as awaiting a decision | 3 | "existing prd_audit over-scope decision block naming NC.1" | diff-local |
| Story 1 negative: Given an applied rebase record preserving `prd_audit` and a `prd_audit` verdict that is unsatisfied with `checkedAt` equal to or older than the applied-at time, when the conductor resumes, then it writes a `needs-human` HALT naming the outstanding `prd_audit` repair and dispatches no step | 2 | "Resume fixtures (b) and (c) each write `.pipeline/HALT` with class `needs-human`" | diff-local |
| Story 1 negative: Given an applied rebase record preserving `prd_audit` and no `.pipeline/gates/prd_audit.json`, when the conductor resumes, then it writes a `needs-human` HALT and dispatches no step | 2 | "Resume fixtures (b) and (c) each write `.pipeline/HALT` with class `needs-human`" | diff-local |
| Story 1 negative: Given an applied rebase record preserving `build_review` whose verdict is satisfied but carries no preservation stamp for that operation and is not newer than the applied-at time, when the conductor resumes, then it writes a `needs-human` HALT stating the gate was preserved without its replay-bound authority and dispatches no step | 2 | "preserved build_review without its replay-bound authority" | diff-local |
| Story 1 negative: Given a rebase record whose operation fails structural validation (for example a gate named in both `preserved` and `invalidated`), when the conductor resumes, then it writes a `needs-human` HALT stating the transition record is malformed and dispatches no step | 2 | "rebase transition record is malformed" | diff-local |
| Story 2 happy: Given an applied rebase record whose preserved gates are each stamped for that operation or freshly re-judged satisfied after the applied-at time, when the finish publication fence is evaluated, then it returns no blocker | 1 | "returns no blocker when every preserved gate is stamped" | diff-local |
| Story 2 happy: Given an applied rebase record preserving `prd_audit` whose verdict is a post-rebase failing re-judgement, when the finish publication fence is evaluated, then it returns `rebase transition still has an outstanding prd_audit repair or re-verification` | 1 | "rebase transition still has an outstanding prd_audit repair or re-verification" | diff-local |
| Story 2 negative: Given a rebase record with `status: applying`, when the finish publication fence is evaluated, then it returns `rebase transition is still applying; reconcile the persisted rebase operation before publication` | 1 | "rebase transition is still applying; reconcile the persisted rebase operation before publication" | diff-local |
| Story 2 negative: Given an applied rebase record preserving `build_review` and no `build_review` verdict file, when the finish publication fence is evaluated, then it returns `rebase transition still has an outstanding build_review repair or re-verification` | 1 | "when no `build_review` verdict file exists" | diff-local |
| Story 2 negative: Given an applied rebase record preserving `build_review` whose satisfied verdict lacks its replay-bound stamp and is not newer than the applied-at time, when the finish publication fence is evaluated, then it returns `rebase transition preserved build_review without its replay-bound authority` | 1 | "for an unstamped satisfied `build_review` not newer than the applied-at time" | diff-local |
| Story 3 happy: Given a file-changing rebase that preserves `build_review` and `prd_audit`, when the transition writer persists the `applying` descriptor, then that same write carries, for each preserved gate, its gate name, original judge identity, original verdict digest, and relevant input identities | 4 | "observed before the state batch runs" | diff-local |
| Story 3 happy: Given the descriptor above, when it is marked `applied`, then the persisted preservation evidence is retained and the record still validates as well formed | 4 | "still carries the same `preservationEvidence`" | diff-local |
| Story 3 negative: Given a rebase record written before this change (no persisted preservation evidence), when it is validated, then it is accepted as well formed | 5 | "for an otherwise valid record with no `preservationEvidence` field" | diff-local |
| Story 3 negative: Given a rebase record whose persisted preservation evidence names a gate set different from `transition.preserved`, when it is validated, then it is rejected as malformed | 5 | "names a gate set different from `transition.preserved`" | diff-local |
| Story 3 negative: Given a rebase record whose persisted preservation evidence is not a list or has an entry missing its verdict digest, when it is validated, then it is rejected as malformed | 5 | "is not an array, and false when an entry lacks a non-empty `originalVerdictDigest`" | diff-local |
| Story 3 negative: Given a rebase that preserves no gates, when the `applying` descriptor is persisted, then its preservation evidence is empty and the record validates | 4 | "persists `preservationEvidence: []` and validates" | diff-local |
| Story 4 happy: Given an `applying` rebase record with a full transition and persisted preservation evidence, where each preserved gate's current verdict matches its recorded digest, when the conductor resumes, then each preserved gate is stamped for that operation, each invalidated gate is `pending` with an unsatisfied verdict, the record becomes `applied` with an `appliedAt` stamp, and resume continues at the earliest unsatisfied gate | 8 | "persists `rebaseOperation.status = applied` with an `appliedAt` stamp before the first `step_started` event" | diff-local |
| Story 4 happy: Given the completion above has already happened, when the conductor resumes again, then the operation is not re-applied, no gate verdict changes, and no HALT is written | 8 | "leaves every `.pipeline/gates/*.json` byte-identical, writes no `.pipeline/HALT`" | diff-local |
| Story 4 negative: Given an `applying` record with persisted evidence where `prd_audit`'s current verdict no longer matches its recorded digest, when the conductor resumes, then `prd_audit` is not stamped as preserved, is absent from the completed operation's `transition.preserved`, is classified by the existing post-rebase rerun-or-reuse rules (re-verified when its completion check mechanically attests the current tree, otherwise `pending` with an unsatisfied verdict), and resume writes no rebase-fence HALT for it | 8 | "`pending` with an unsatisfied verdict because its completion check does not mechanically re-verify the current tree" | diff-local |
| Story 4 negative: Given an `applying` record with persisted evidence where `test_suite` is preserved, its current verdict no longer matches its recorded digest, and its completion check mechanically re-verifies the current tree, when the conductor resumes, then `test_suite` is recorded in the completed operation's `transition.reverified` and is not re-dispatched | 8 | "completes with `test_suite` in `transition.reverified`, absent from `transition.preserved`" | diff-local |
| Story 4 negative: Given an `applying` record whose completion is refused because conduct state for an invalidated gate changed concurrently, when the conductor resumes, then it writes a `needs-human` HALT stating the rebase transition was refused and dispatches no step | 12 | "rebase continuation state transition was refused" | diff-local |
| Story 4 negative: Given an `applying` record with persisted evidence, when the conductor resumes, then no step is dispatched until the record is `applied` | 8 | "before the first `step_started` event" | diff-local |
| Story 5 happy: Given an `applying` record with a full transition but no persisted preservation evidence, when the conductor resumes, then every gate in `invalidated` and `preserved` is `pending` with an unsatisfied verdict, none carries a preservation stamp, and the record becomes `applied` with an empty preserved set | 13 | "every gate in the original `invalidated` and `preserved` sets `pending` with an unsatisfied verdict, no gate verdict carrying a preservation stamp" | diff-local |
| Story 5 happy: Given a provisional `applying` record (id beginning `preparing-`, empty transition), when the conductor resumes, then every gate downstream of `rebase` is `pending` with an unsatisfied verdict, none is preserved, and the record becomes `applied` | 13 | "every step after `rebase` in the step registry `pending` with an unsatisfied verdict" | diff-local |
| Story 5 negative: Given a provisional `applying` record, when completion runs, then no satisfied verdict written before the rebase survives as satisfied on any downstream gate | 7 | "no downstream gate verdict remains `satisfied: true`" | diff-local |
| Story 5 negative: Given an `applying` record without evidence whose completion is refused, when the conductor resumes, then it writes a `needs-human` HALT stating the rebase transition was refused and dispatches no step | 12 | "with and without evidence, writes `.pipeline/HALT` with class `needs-human`" | diff-local |
| Story 5 negative: Given an `applying` record that fails structural validation for a reason other than missing evidence, when the conductor resumes, then it is not completed and resume writes a `needs-human` HALT stating the record is malformed | 12 | "Fixture (d) leaves `rebaseOperation.status` as `applying`" | diff-local |
| Story 6 happy: Given a resume that halts on a rebase integrity fault and `.pipeline/HALT.cleared` records `decision: accept` for NC.1, when the HALT is written, then its body includes the fault text, names NC.1 with recorded state `accept`, and names the next action for the fault | 10 | "its next-action instruction `reconcile it before publication`, `NC.1`, and recorded state `accept`" | diff-local |
| Story 6 happy: Given a resume that halts on a rebase integrity fault and an over-scope offer for NC.1 with no recorded decision, when the HALT is written, then its body names NC.1 as awaiting a decision and names `ai-conductor halt clear` as the way to record it | 10 | "fixture (b)'s contains `NC.1`, awaiting a decision, and `ai-conductor halt clear`" | diff-local |
| Story 6 negative: Given a resume that halts on a rebase integrity fault and no over-scope offer or decision exists, when the HALT is written, then its body is the fault text alone, unchanged from today | 10 | "exactly as before this feature" | diff-local |
| Story 6 negative: Given a resume that halts on a rebase integrity fault and `.pipeline/accepted-widenings.json` is unparseable, when the HALT is written, then the HALT is still written with the fault text and states that the recorded decision state could not be read | 10 | "the unreadable-decision-state line" | diff-local |
| Story 6 negative: Given a resume that halts on a rebase integrity fault while `.pipeline/HALT.cleared` exists, when the HALT is written, then `.pipeline/HALT.cleared` is byte-identical afterwards | 10 | "`.pipeline/HALT.cleared` is byte-identical before and after the resume" | diff-local |
| Story 7 happy: Given a prd_audit lap whose report grades NC.1 OVER_SCOPE for a new source that the lap's reconciliation offers as a decision case, when the gate verdict is persisted, then its reason contains `NC.1 (OVER_SCOPE)` with the awaiting-decision classification and directs the operator to record a decision, not `[missing-relation]` | 11 | "contains neither `[missing-relation]` nor `close the gap (BUILD)`" | diff-local |
| Story 7 happy: Given the same lap after an `accept` decision is recorded for that case, when the gate verdict is persisted on the next lap, then NC.1 is not listed as blocking | 11 | "does not list NC.1 as blocking" | diff-local |
| Story 7 negative: Given a prd_audit lap where reconciliation judges NC.1's relation `uncertain` or `different`, when the gate verdict is persisted, then its reason carries the `[uncertain-relation]` classification as today | 11 | "fixture (f), whose reconciliation judges NC.1's relation `different`, each persist a reason containing `[uncertain-relation]`" | diff-local |
| Story 7 negative: Given a prd_audit lap where the decision store is corrupt, when the gate verdict is persisted, then its reason carries `[corrupt-decision-store]` and the gate is unsatisfied | 11 | "fixture (d) reason contains `[corrupt-decision-store]` with `satisfied: false`" | diff-local |
| Story 7 negative: Given a prd_audit lap with a FIXABLE criterion and no OVER_SCOPE finding, when the gate verdict is persisted, then its reason is the existing `close the gap (BUILD) or amend the PRD (DECIDE)` text | 11 | "Fixture (e), a prd_audit lap with a FIXABLE criterion and no OVER_SCOPE finding, persists a reason that contains `close the gap (BUILD) or amend the PRD (DECIDE)`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D1 | task | task-4, task-5 | observed before the state batch runs |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D2 | task | task-6, task-8 | Fixture (e) completes with `prd_audit` absent from `transition.preserved` |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D3 | task | task-7, task-12, task-13 | every step after `rebase` in the step registry `pending` with an unsatisfied verdict |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D4 | task | task-2, task-3 | emits `step_started` for `prd_audit` with no `loop_halt` before it |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D5 | task | task-1 | Every pre-existing test in gate-code-validity.test.ts and test/integration/rebase-preserved-readers.test.ts passes without modification |
| adr-2026-10-04-resume-completes-interrupted-rebase-operation#D6 | task | task-1, task-9, task-10 | `.pipeline/HALT.cleared` is byte-identical before and after the resume |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic

### Task rem-as-built-rem-adr-d4-1: src/conductor/src/engine/gate-code-validity.ts:82-104 — change the `applying` arm of RebaseOperationClassification to `{ kind: 'applying'; operation: RebaseOperationRecord }` carrying the record that passed validRebaseOperationRecord; update the counterpart assertion at src/conductor/test/engine/gate-code-validity.test.ts:180 to expect the validated operation; rebaseOperationPublicationBlocker keeps its exact `still applying` string (Task 1 Done when)
**Gate:** as-built
**Rationale:** Verified: classifyRebaseOperation (gate-code-validity.ts:97-104) validates one read of rebase.json and returns only `{ kind: 'applying' }`, then conductor.ts:7112 re-reads the descriptor and passes it to completeInterruptedRebaseOperation after only a truthiness check, so a replaced malformed record bypasses ADR D4's integrity halt; plan Task 12 (step 2: route a malformed applying record to the integrity-fault halt without attempting completion) admits handing completion the exact validated descriptor. Sibling sweep: the classifier's only consumers are rebaseOperationPublicationBlocker (gate-code-validity.ts:136, maps `applying` by kind only — unaffected) and conductor.ts:7110/:7148 (by kind); completeInterruptedRebaseOperation has the single caller at conductor.ts:7124. Removing the re-read and its defensive guard preserves Task 12 fixture (d) coverage (malformed applying never reaches completion), which must stay green.
**Governing clause:** adr-2026-10-04-resume-completes-interrupted-rebase-operation decision 4
**Done when:**
- adr-2026-10-04-resume-completes-interrupted-rebase-operation decision 4 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-d4-1 is complete.

### Task rem-as-built-rem-adr-d4-2: src/conductor/src/engine/conductor.ts:7110-7131 — pass `rebaseClassification.operation` to completeInterruptedRebaseOperation and delete the second readVerdict(projectRoot, 'rebase') plus its truthiness guard, so completion only ever receives the descriptor the classifier validated; in src/conductor/test/engine/conductor-resume-rebase-fence.test.ts add a resume test whose completion spy asserts it received an operation deep-equal to the validated applying record, keeping Task 12 fixture (d) (malformed applying → needs-human `rebase transition record is malformed`, completion never invoked) unchanged
**Gate:** as-built
**Rationale:** Verified: classifyRebaseOperation (gate-code-validity.ts:97-104) validates one read of rebase.json and returns only `{ kind: 'applying' }`, then conductor.ts:7112 re-reads the descriptor and passes it to completeInterruptedRebaseOperation after only a truthiness check, so a replaced malformed record bypasses ADR D4's integrity halt; plan Task 12 (step 2: route a malformed applying record to the integrity-fault halt without attempting completion) admits handing completion the exact validated descriptor. Sibling sweep: the classifier's only consumers are rebaseOperationPublicationBlocker (gate-code-validity.ts:136, maps `applying` by kind only — unaffected) and conductor.ts:7110/:7148 (by kind); completeInterruptedRebaseOperation has the single caller at conductor.ts:7124. Removing the re-read and its defensive guard preserves Task 12 fixture (d) coverage (malformed applying never reaches completion), which must stay green.
**Governing clause:** adr-2026-10-04-resume-completes-interrupted-rebase-operation decision 4
**Done when:**
- adr-2026-10-04-resume-completes-interrupted-rebase-operation decision 4 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-d4-2 is complete.

### Task rem-as-built-rem-adr-d9-1: src/conductor/src/engine/rebase-fence-decision-note.ts:27-61 — render an explicit recovery line instead of '' when readRemediationCaseStoreFeature returns ok:false or caseStore.read() fails (name .pipeline/remediation-cases.json and that it must be repaired before the decision state can be trusted); append recovery text to the existing `The recorded decision state could not be read.` line for non-absent/non-valid accepted-widenings reads; treat only ENOENT on .pipeline/HALT.cleared as absent and render any other read error as an unreadable-clear line; render each parsedClear.defects entry (kind + criterion when present) with the instruction to correct the over-scope-decisions block and re-run `ai-conductor halt clear`, alongside any valid sibling decisions; keep '' when stores are simply absent and no offer/decision exists
**Gate:** as-built
**Rationale:** Verified: renderRebaseFenceDecisionNote returns '' on case-store feature read failure (rebase-fence-decision-note.ts:28) and case-store read failure (:32), swallows every HALT.cleared read error (:53), and ignores parsedClear.defects (:58-61), while ADR-2026-09-07 D9 requires corrupted stores and malformed cleared rows to stay visible with explicit recovery text; plan Tasks 9/10 (render the note incl. an unreadable-decision-state line; append it to resume integrity halts) admit the repair. Absent stores (readRemediationCaseStoreFeature `{ ok: true, feature: undefined }`, ENOENT on HALT.cleared) must still yield '' so Task 10 fixture (c)'s exact fault-text-plus-newline body and S6.3 stay intact; the existing `could not be read` decision-store line (Task 9/10 fixture (d)) is kept. Found-and-excluded: the `.at(-1)` latest-decision-only rendering (:64-66) is not part of this finding and no criterion grades it.
**Governing clause:** adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 9
**Done when:**
- adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-d9-1 is complete.

### Task rem-as-built-rem-adr-d9-2: src/conductor/test/engine/rebase-fence-decision-note.test.ts — add cases for malformed remediation-cases.json, unreadable (EACCES/EISDIR) HALT.cleared, a cleared block with one valid NC.1 accept plus one unknown-criterion/missing-rationale row (both the decision and the defect rendered), and malformed-block JSON, asserting each yields visible recovery text; keep the existing accept/refuse/pending/empty/unparseable-store cases unchanged
**Gate:** as-built
**Rationale:** Verified: renderRebaseFenceDecisionNote returns '' on case-store feature read failure (rebase-fence-decision-note.ts:28) and case-store read failure (:32), swallows every HALT.cleared read error (:53), and ignores parsedClear.defects (:58-61), while ADR-2026-09-07 D9 requires corrupted stores and malformed cleared rows to stay visible with explicit recovery text; plan Tasks 9/10 (render the note incl. an unreadable-decision-state line; append it to resume integrity halts) admit the repair. Absent stores (readRemediationCaseStoreFeature `{ ok: true, feature: undefined }`, ENOENT on HALT.cleared) must still yield '' so Task 10 fixture (c)'s exact fault-text-plus-newline body and S6.3 stay intact; the existing `could not be read` decision-store line (Task 9/10 fixture (d)) is kept. Found-and-excluded: the `.at(-1)` latest-decision-only rendering (:64-66) is not part of this finding and no criterion grades it.
**Governing clause:** adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 9
**Done when:**
- adr-2026-09-07-durable-prd-widening-decision-reconciliation decision 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-d9-2 is complete.

### Task rem-as-built-rem-adr-d6-1: src/conductor/src/engine/conductor.ts:7150-7158 — append a next-action instruction to the resume integrity-halt text for missing-authority, missing-verdict and pre-applied-unsatisfied (e.g. `; re-run the <gate> gate or reconcile the persisted rebase operation before resuming`), leaving the malformed-record text and rebaseOperationPublicationBlocker's finish strings in gate-code-validity.ts:141-156 byte-identical
**Gate:** as-built
**Rationale:** Verified: recordedDecisionNote (rebase-fence-decision-note.ts:17-19) carries no next action, and the resume halt texts for missing-authority, missing-verdict and pre-applied-unsatisfied (conductor.ts:7150-7155) carry none either, so a decision-bearing integrity halt for those faults violates ADR D6 (criterion, recorded state, and next action); plan Task 10 step 2 (next action is the fault text's own instruction) admits giving those resume fault texts an instruction. Matched pair: conductor.ts:7150-7155 duplicates the reason→text mapping in rebaseOperationPublicationBlocker (gate-code-validity.ts:141-156); the finish strings must stay byte-exact (Task 1 / S2.2-S2.5 Done when), so the action is appended only in the resume composition, and Task 2's asserted substrings (`preserved build_review without its replay-bound authority`, outstanding prd_audit text) must remain contained.
**Governing clause:** adr-2026-10-04-resume-completes-interrupted-rebase-operation decision 6
**Done when:**
- adr-2026-10-04-resume-completes-interrupted-rebase-operation decision 6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-d6-1 is complete.

### Task rem-as-built-rem-adr-d6-2: src/conductor/test/engine/conductor-resume-rebase-fence.test.ts — extend the Task 10 recorded-accept fixture to the missing-authority, missing-verdict and pre-applied-unsatisfied faults, asserting each HALT contains the fault text, its new next-action instruction, `NC.1` and recorded state `accept`; tighten the shared regex alternation at the :365 it.each to per-case exact fault strings; keep the malformed-record fixture's `reconcile it before publication` assertion
**Gate:** as-built
**Rationale:** Verified: recordedDecisionNote (rebase-fence-decision-note.ts:17-19) carries no next action, and the resume halt texts for missing-authority, missing-verdict and pre-applied-unsatisfied (conductor.ts:7150-7155) carry none either, so a decision-bearing integrity halt for those faults violates ADR D6 (criterion, recorded state, and next action); plan Task 10 step 2 (next action is the fault text's own instruction) admits giving those resume fault texts an instruction. Matched pair: conductor.ts:7150-7155 duplicates the reason→text mapping in rebaseOperationPublicationBlocker (gate-code-validity.ts:141-156); the finish strings must stay byte-exact (Task 1 / S2.2-S2.5 Done when), so the action is appended only in the resume composition, and Task 2's asserted substrings (`preserved build_review without its replay-bound authority`, outstanding prd_audit text) must remain contained.
**Governing clause:** adr-2026-10-04-resume-completes-interrupted-rebase-operation decision 6
**Done when:**
- adr-2026-10-04-resume-completes-interrupted-rebase-operation decision 6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-d6-2 is complete.
