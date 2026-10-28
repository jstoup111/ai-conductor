# Implementation Plan: build_review halts when a judgement re-raises a source a resolved case owns

**Date:** 2026-10-19
**Stories:** .docs/stories/build-review-halts-when-a-judgement-re-raises-a-so.md
**Conflict check:** Clean as of 2026-10-19 (.docs/conflicts/2026-10-19-build-review-halts-when-a-judgement-re-raises-a-so.md)

## Summary

Scope the build_review case store's source-ownership invariant to open cases. Read every source that
resolved history shares through one authoritative link. Admit an unbound re-raise as a new, charged
case, and make decision stops converge on replay and name their refused transitions. 8 tasks.
Source: jstoup111/ai-conductor#3292, which also delivers #2464's core outcome.

## Technical Approach

- **Governing decisions.** adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication
  D5.4–D5.7, plus the predecessor's D7 note. The track marker's exclusions are binding:
  - no `distinctFrom` declarations;
  - no recurrence-keeps-limits semantics (#3124);
  - no supersession of an open owner by a stop (#3005);
  - no operator-acceptance carry-over (#3271);
  - no schema field or store version change;
  - no prd_widening change.
- **Store (Task 1).** `parseBuildReviewCases` in `src/conductor/src/engine/remediation-case-store.ts`
  is the only enforcement point for `source-linked-by-multiple-cases`. Owner tracking narrows to
  `resolution: open` records. The rejected-transition plumbing from #3171 (`mutate` → `violation`)
  is reused unchanged. Existing tests that used a resolved owner as the refusal fixture move to an
  open owner, because that fixture is now admissible history.
- **Authoritative link (Tasks 2–3).** A new pure exported selector, `currentBuildReviewSourceLinks`,
  lives next to `finalizedBuildReviewSourceIds`. Only two build_review readers span resolved cases:
  `finalizedBuildReviewSourceIds` and the reducer's `currentSourceCoverageIsConsistent`. Both read
  through the selector. Readers already restricted to open cases are left alone. On a store with no
  shared source the selector reproduces today's results, and the tests prove that against a
  reference copy of the old rule.
- **Unbound re-raise (Tasks 4–5).** No reconciler change is expected. `reconcileState` already mints
  a new case for an unbound proposal, and the post-reconcile regression check skips a case id absent
  from the prior store. Task 4 is the coordinator integration owner for Story 3. Task 5 owns the
  conductor entry point for the charge and the cap halt.
- **Decision stops (Tasks 6–8).** `persistBuildReviewDecisionStop` in `remediation-case-effects.ts`
  gets three changes:
  - `recordedAt` no longer affects stop identity;
  - an unbound stop converges on an open stop with the same owner and source set, mirroring the
    reconciler's `convergedCaseFor`;
  - the store's violation propagates the way its sibling helpers already return it.

  The coordinator's existing `failStore` renders the named halt. Task 8 owns the conductor entry
  point for Story 4.
- **Event spine.** No new event. The existing optional
  `remediation_adjudication_failed.rejectedTransition` field carries the decision-stop violation.

## Prerequisites

- None. Every seam named above exists on `main` (verified by reading the source).

## Tasks

### Task 1: Scope the source-ownership invariant to open cases
**Story:** Story 1
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing store tests (`remediation-case-store.test.ts`): resolved R plus a proposed open N on S is written; two resolved owners plus one open owner are written; O plus N, and N1 plus N2 over R, are refused naming the invariant, case ids and S. Retarget the existing test "rejects a proposed case that links a source owned by a resolved case without writing history" to an open owner O.
2. Verify RED.
3. Implement in `parseBuildReviewCases` (`remediation-case-store.ts`): track source owners only for records with `resolution: open`. A source repeated within one case stays refused exactly as today. The `duplicate-case-id` and `duplicate-effect-id` checks are unchanged. Do not touch `parsePrdWideningCases`: prd_widening keeps per-domain uniqueness (adr-2026-09-07 D2). No schema field or store version changes.
4. Retarget the rejected-transition fixtures that relied on a resolved owner: the reconciler test "carries a rejected source-link transition and leaves the valid store bytes unchanged", the coordinator test "emits the rejected case transition detail from reconciliation", the recovery integration test "recovers from a cleared rejected-transition halt without changing its valid persisted history", and both conductor build_review rejected-transition and corrupt-store fixtures. Each one switches resolved R to open O and keeps its existing assertions.
5. Verify GREEN and commit: "fix(remediation): scope source ownership to open build_review cases".

**Done when:**
- [test] `RemediationCaseStore.mutate` over a store holding resolved R that proposes open N also linking S writes the next state, a following `read()` and a second `mutate()` over the written file each return R then N, and R's serialized row in the written file is byte-identical to its row before the mutation.
- [test] A store holding two resolved cases that both link S admits a mutation adding one open case linking S, and the written store then parses through both `read()` and a second `mutate()` returning the same cases in the same order, with both resolved rows byte-identical.
- [test] `mutate` returns reason `rejected-transition` with invariant `source-linked-by-multiple-cases`, caseIds [O, N] and sourceIds [S] for open O plus proposed open N, and caseIds [N1, N2] and sourceIds [S] for proposed N1 and N2 over resolved R, and in both cases the file is byte-identical and no `writeFile` or `rename` was recorded.
- [test] `mutate` returns reason `rejected-transition` with invariant `duplicate-case-id` for a repeated case id and `duplicate-effect-id` for a repeated effect id, refuses a same-case repeated source, and in all three leaves the file byte-identical with no `writeFile` or `rename` recorded, and a persisted file linking S from two open cases still fails `read()` and `mutate()` with `malformed-state` and no violation.
- [test] The reconciler, coordinator, recovery-integration and conductor build_review rejected-transition tests use an open owner O in place of resolved R and still assert the emitted `remediation_adjudication_failed` event's `rejectedTransition` invariant, case ids and S, the HALT text naming them, and the byte-identical store.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/test/engine/remediation-case-store.test.ts; src/conductor/test/engine/remediation-case-reconciler.test.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/test/integration/remediation-case-recovery.integration.test.ts; src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 2: Read each source through one authoritative link
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 1

**Steps:**
1. Write failing tests for a new exported pure selector `currentBuildReviewSourceLinks(cases)` in `remediation-case-store.ts`, and for `finalizedBuildReviewSourceIds` over stores where resolved history shares a source.
2. Verify RED.
3. Implement the selector. It returns one link per source id: the open case's link when one exists, otherwise the link with the latest `recordedAt`, with ties broken by later store order. It also returns the owning record, so callers can read disposition and effect. Re-express `finalizedBuildReviewSourceIds` so that each source's authoritative link decides settlement with the existing disposition and effect rules. Keep the function's signature, so the coordinator, `build-review-cli.ts` and `build-review-effective.ts` keep calling it unchanged.
4. Verify GREEN and commit: "fix(remediation): settle sources through their authoritative link".

**Done when:**
- [test] `currentBuildReviewSourceLinks(cases)` returns, per source id, the link on the open case when one exists, otherwise the link with the latest `recordedAt`, and for two resolved links with equal `recordedAt` returns the later case in store order on every call.
- [test] `finalizedBuildReviewSourceIds` reads each source's authoritative link: S is settled when the later-recorded resolved link settles it, not settled when the settling link is the earlier one, and not settled when a resolved applied deferral link is followed by an open action case N on S.
- [test] On a fixture store in which no source is linked by more than one case, `finalizedBuildReviewSourceIds` returns the same set as the test's reference copy of the pre-change any-link rule.
- [test] For a store holding R and N on S, the settled set the `build-review findings` command passes to `deriveComposedBuildReviewEffectiveVerdict` and the set `build-review-effective.ts` derives from the store both equal `finalizedBuildReviewSourceIds` over the same cases, which is the set the coordinator removes from its live source set for that store.

**Files:** src/conductor/src/engine/remediation-case-store.ts; src/conductor/test/engine/remediation-case-store.test.ts; src/conductor/test/engine/build-review-effective.test.ts; src/conductor/test/engine/build-review-cli.test.ts

### Task 3: Derive reducer coverage from the authoritative link
**Story:** Story 2
**Type:** happy-path
**Dependencies:** Task 2

**Steps:**
1. Write failing reducer tests in which resolved R and an open case share S.
2. Verify RED.
3. Implement in `currentSourceCoverageIsConsistent` (`build-review-adjudication.ts`): take each current source's outcome from `currentBuildReviewSourceLinks` instead of scanning every link of every case. The duplicate-current-id check and the every-source-covered check are unchanged. The decision-owner, consistency-stop and build-route filters already read only open cases and are not changed.
4. Verify GREEN and commit: "fix(build-review): reduce coverage from authoritative source links".

**Done when:**
- [test] `reduceBuildReviewAdjudication` with R (`acted` on S) and an open escalation decision stop (`escalate` on S, owner architecture) returns route `halt` with reason `architecture decision is required for current remediation sources`, not the coverage-contradiction reason.
- [test] With R (`acted` on S) and open action case N (`acted`, applied effect) on S, the reducer returns route `build`, and the coordinator's durable BUILD-route `repairCaseIds` for the same store are exactly [N].
- [test] Every existing reducer case in `build-review-adjudication.test.ts` passes with no expected route or reason edited, and a no-shared-source fixture yields the same coverage verdict as the test's reference copy of the pre-change any-link check.
- [test] With current source S linked by no case, the reducer still returns route `halt` with reason `current remediation source coverage is incomplete or contradictory`.

**Files:** src/conductor/src/engine/build-review-adjudication.ts; src/conductor/test/engine/build-review-adjudication.test.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

### Task 4: Admit an unbound re-raise over resolved history as a new case
**Story:** Story 3
**Type:** happy-path
**Dependencies:** Task 1, Task 3

**Steps:**
1. Write failing coordinator tests (`build-review-adjudication-coordinator.test.ts`) that replay the 2026-10-18 `daemon-reconciliation-delays-first-feature-dispatc` shape through `coordinateBuildReviewAdjudication` with the real store and reconciler, and an injected `chargeEffect` adapter.
2. Verify RED before Tasks 1 and 3 land. After they land, a remaining failure is a defect in the coordinator path: fix it in `build-review-adjudication-coordinator.ts` without widening scope. The unbound path must not call `classifyRemediationCaseReuse` for a newly minted case. The explicit `act` rebind path keeps its regression halt.
3. Verify GREEN and commit: "test(build-review): admit unbound re-raises over resolved cases".

**Done when:**
- [test] Replaying the `daemon-reconciliation-delays-first-feature-dispatc` shape (resolved act R with a failed effect on S; judgement with an unbound act case whose sources are S as `merged` plus another live source) through `coordinateBuildReviewAdjudication` with the real store and reconciler persists new case N with a reserved action effect, emits no `remediation_adjudication_failed`, and leaves R's serialized row byte-identical.
- [test] An unbound `defer` case and an unbound `reject` case on S over resolved R with an `applied` action effect each persist a new case with that disposition and leave R byte-identical.
- [test] Reconciling the same judgement a second time after N exists converges on N: the store holds no second case or effect id and the charge adapter records no second charge.
- [test] A judgement binding the current finding to resolved R by `existingCaseId` with disposition `act`, for R failed and for R applied, halts with detail `semantic remediation case regression R` and persists no new case.
- [test] With open action case O on S, an unbound act case on S with a different source set halts with `case transition rejected: source-linked-by-multiple-cases` naming O, the proposed case id and S, and the store file is byte-identical.

**Files:** src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/src/engine/build-review-adjudication-coordinator.ts

### Task 5: Charge a re-raised action and stop on the kickback cap through the conductor
**Story:** Story 3
**Type:** negative-path
**Dependencies:** Task 4

**Steps:**
1. Write failing conductor build_review tests (`conductor-build-review-adjudication.test.ts`) on the incident-1 shape: one with kickback budget remaining, and one with the cumulative cap exhausted. Each step must assert per-child ledgers when the fixture is stacked (per-child-build-region D10). Flat fixtures use the flat ledger.
2. Verify RED, implement any coordinator wiring the tests expose, verify GREEN, and commit: "test(build-review): charge re-raised actions against the kickback cap".

**Done when:**
- [test] Through the conductor build_review step on the incident-1 shape with kickback budget remaining, the charge adapter records exactly one charge for N's effect id and BUILD is dispatched with a work order carrying N.
- [test] With the cumulative kickback cap exhausted, the same lap halts with `build-review kickback budget exhausted (cumulative): blocked cases` naming N and N's effect id, the HALT text and emitted events contain none of `case transition rejected`, `source-linked-by-multiple-cases`, `duplicate-case-id`, `duplicate-effect-id` or `invalid-next-state`, no emitted event carries `rejectedTransition`, and R's row is byte-identical.

**Files:** src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 6: Converge a replayed decision stop on its own open stop
**Story:** Story 4
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing tests for `persistBuildReviewDecisionStop` (`remediation-case-effects.test.ts`) covering bound replay with fresh timestamps, unbound replay, and a changed owner or source set.
2. Verify RED.
3. Implement in `remediation-case-effects.ts`. `sameDecisionStop` compares source ids and outcomes but not `recordedAt`. Before appending an unbound stop, look for an open decision stop with the same escalation owner (or the same consistency stop), disposition `escalate`, and exactly the same source-id and outcome set. If one exists, return `already-persisted` with that case id and no `nextState`. Mirror the reconciler's `convergedCaseFor`, which matches on exact source ids and outcomes and never on rationale prose.
4. Verify GREEN and commit: "fix(remediation): converge replayed decision stops".

**Done when:**
- [test] `persistBuildReviewDecisionStop` for a record bound to open stop D's id with the same owner, disposition, source ids and outcomes but fresh `recordedAt` values returns status `already-persisted` with caseId D and the store records no write.
- [test] For an unbound record carrying a fresh case id, the same owner and exactly D's source-id and outcome set, `persistBuildReviewDecisionStop` returns status `already-persisted` with caseId D and writes nothing.
- [test] A record bound to D's id with a different source set, and one with a different owner, each return reason `conflicting-case-id` and write nothing.

**Files:** src/conductor/src/engine/remediation-case-effects.ts; src/conductor/test/engine/remediation-case-effects.test.ts

### Task 7: Propagate a refused decision-stop transition to the halt
**Story:** Story 5
**Type:** negative-path
**Dependencies:** Task 6

**Steps:**
1. Write failing tests: function-level tests for the `persistBuildReviewDecisionStop` failure shape, and coordinator-level tests for refused explicit-escalation and blocked-consistency stops.
2. Verify RED.
3. Implement in `persistBuildReviewDecisionStop`. When `mutate` fails with `rejected-transition` and a violation, return `{ ok: false, reason: 'rejected-transition', violation }`, matching the three sibling helpers in the same module. Every other store failure keeps reason `case store <reason>` with no violation. Widen `PersistBuildReviewDecisionStopResult` with the optional violation. The coordinator's existing `failStore('decision stop' | 'blocked consistency stop', ...)` calls then render the named halt with no coordinator change.
4. Verify GREEN and commit: "fix(remediation): name the invariant on refused decision stops".

**Done when:**
- [test] `persistBuildReviewDecisionStop` returns `{ ok: false, reason: 'rejected-transition', violation }` carrying the store's invariant, case ids and source ids when `mutate` rejects the next state, and returns reason `case store lock-timeout` and `case store malformed-state` with no violation for those two store failures.
- [test] `coordinateBuildReviewAdjudication` whose explicit escalation over S is refused by an open owner emits one `remediation_adjudication_failed` with `rejectedTransition` carrying `source-linked-by-multiple-cases`, the open owner's id, the proposed stop id and S, and returns a detail containing `case transition rejected: source-linked-by-multiple-cases`, those ids, S and `persisted case history is valid and unchanged`.
- [test] A blocked-consistency stop refused by an open owner of one of its sources emits `remediation_adjudication_failed` whose `rejectedTransition` carries `source-linked-by-multiple-cases`, the owner's id, the stop id and that source, and returns a detail containing `case transition rejected: source-linked-by-multiple-cases`, those ids, the source and `persisted case history is valid and unchanged`.
- [test] When decision-stop persistence fails with `case store lock-timeout`, `case store malformed-state` or `conflicting-case-id`, `coordinateBuildReviewAdjudication` returns details `decision stop case store lock-timeout`, `decision stop case store malformed-state` and `decision stop conflicting-case-id`, each with no `rejectedTransition` on the emitted event and without `persisted case history is valid`.
- [test] Through the conductor build_review step, the refused explicit-escalation lap and the refused blocked-consistency lap each write a `needs-human` HALT containing `case transition rejected: source-linked-by-multiple-cases`, the owner id, the proposed stop id, the source id and `persisted case history is valid and unchanged`, and a lap whose decision-stop persistence fails `case store malformed-state` writes a HALT containing `decision stop case store malformed-state` and none of `case transition rejected`, `source-linked-by-multiple-cases` or `persisted case history is valid`.

**Files:** src/conductor/src/engine/remediation-case-effects.ts; src/conductor/test/engine/remediation-case-effects.test.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts; src/conductor/test/engine/conductor-build-review-adjudication.test.ts

### Task 8: Persist decision stops over resolved history through the conductor
**Story:** Story 4
**Type:** happy-path
**Dependencies:** Task 1, Task 3, Task 7

**Steps:**
1. Write failing conductor build_review tests (`conductor-build-review-adjudication.test.ts`) that replay the 2026-10-18 `a-routed-fix-cannot-be-built-charged-and-reviewed-` shape, and coordinator tests for the bound, unbound-replay and open-owner variants.
2. Verify RED before Tasks 1, 3 and 7 land. Fix any remaining coordinator wiring, verify GREEN, and commit: "test(build-review): decision stops over resolved history".

**Done when:**
- [test] Replaying the `a-routed-fix-cannot-be-built-charged-and-reviewed-` shape (resolved act R with an applied effect on S; judgement escalating S to architecture as an unbound case) through the conductor build_review step persists one new open decision stop, leaves R's row byte-identical, and writes a HALT containing `decision stop`, the new case id, `owner: architecture` and S.
- [test] An escalation naming R as `existingCaseId` with sources differing from R's persists a new open stop whose case id differs from R and leaves R byte-identical.
- [test] A later lap escalating S unbound to the same owner over open stop D, and a later lap re-escalating bound to D with fresh timestamps, each leave the store file byte-identical and halt with a `decision stop D` line.
- [test] A later lap escalating S unbound to a different owner over open stop D, and an unbound escalation of S over open action case O, each halt with `case transition rejected: source-linked-by-multiple-cases` naming the existing owner (D or O), the proposed stop id and S, with the store file byte-identical.

**Files:** src/conductor/test/engine/conductor-build-review-adjudication.test.ts; src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

## Task Dependency Graph

```text
Task 1 ─▶ Task 2 ─▶ Task 3 ─┬─▶ Task 4 ─▶ Task 5
                            └─▶ Task 8
Task 6 ─▶ Task 7 ─────────────▶ Task 8
Task 1 ──────────────────────▶ Task 4, Task 8
```

## Integration Points

- After Task 4, an unbound re-raise over a resolved case reconciles through `coordinateBuildReviewAdjudication`.
- After Task 5, the conductor build_review step charges the re-raise and stops on the named kickback-cap halt.
- After Task 8, the conductor build_review step persists and halts on a decision stop over resolved history.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a valid store holding R and a mutation proposing open case N that also links S, when the store applies it, then the next state is written, R's row is byte-identical, and a read returns both R and N. | 1 | "`RemediationCaseStore.mutate` over a store holding resolved R that proposes open N also linking S writes the next state, a following `read()` and a second `mutate()` over the written file each return R then N, and R's serialized row in the written file is byte-identical to its row before the mutation." | diff-local |
| Story 1 happy: Given the store written by that mutation, when it is read or mutated again, then it parses without failure and returns the same cases in the same order. | 1 | "A store holding two resolved cases that both link S admits a mutation adding one open case linking S, and the written store then parses through both `read()` and a second `mutate()` returning the same cases in the same order, with both resolved rows byte-identical." | diff-local |
| Story 1 happy: Given two resolved cases that both link S, when a mutation proposes one open case N linking S, then the next state is written and both resolved rows are byte-identical. | 1 | "A store holding two resolved cases that both link S admits a mutation adding one open case linking S, and the written store then parses through both `read()` and a second `mutate()` returning the same cases in the same order, with both resolved rows byte-identical." | diff-local |
| Story 1 negative: Given a valid store holding O, when a mutation proposes open case N also linking S, then the store returns rejected-transition with invariant `source-linked-by-multiple-cases`, case ids O and N, and source id S, and the file is byte-identical to before. | 1 | "`mutate` returns reason `rejected-transition` with invariant `source-linked-by-multiple-cases`, caseIds [O, N] and sourceIds [S] for open O plus proposed open N, and caseIds [N1, N2] and sourceIds [S] for proposed N1 and N2 over resolved R, and in both cases the file is byte-identical and no `writeFile` or `rename` was recorded." | diff-local |
| Story 1 negative: Given a valid store holding R, when a mutation proposes two open cases N1 and N2 that both link S, then the store returns rejected-transition naming the invariant, N1, N2 and S, and writes nothing. | 1 | "`mutate` returns reason `rejected-transition` with invariant `source-linked-by-multiple-cases`, caseIds [O, N] and sourceIds [S] for open O plus proposed open N, and caseIds [N1, N2] and sourceIds [S] for proposed N1 and N2 over resolved R, and in both cases the file is byte-identical and no `writeFile` or `rename` was recorded." | diff-local |
| Story 1 negative: Given a mutation that repeats a case id or a durable effect id, when the store applies it, then it still returns rejected-transition naming `duplicate-case-id` or `duplicate-effect-id`, and writes nothing. | 1 | "`mutate` returns reason `rejected-transition` with invariant `duplicate-case-id` for a repeated case id and `duplicate-effect-id` for a repeated effect id, refuses a same-case repeated source, and in all three leaves the file byte-identical with no `writeFile` or `rename` recorded, and a persisted file linking S from two open cases still fails `read()` and `mutate()` with `malformed-state` and no violation." | diff-local |
| Story 1 negative: Given a mutation in which one case links S twice, when the store applies it, then it is refused and the file is byte-identical to before. | 1 | "`mutate` returns reason `rejected-transition` with invariant `duplicate-case-id` for a repeated case id and `duplicate-effect-id` for a repeated effect id, refuses a same-case repeated source, and in all three leaves the file byte-identical with no `writeFile` or `rename` recorded, and a persisted file linking S from two open cases still fails `read()` and `mutate()` with `malformed-state` and no violation." | diff-local |
| Story 1 negative: Given a persisted store file that itself links S from two open cases, when it is read or mutated, then the store fails with the existing malformed-state reason and never with a rejected transition. | 1 | "`mutate` returns reason `rejected-transition` with invariant `duplicate-case-id` for a repeated case id and `duplicate-effect-id` for a repeated effect id, refuses a same-case repeated source, and in all three leaves the file byte-identical with no `writeFile` or `rename` recorded, and a persisted file linking S from two open cases still fails `read()` and `mutate()` with `malformed-state` and no violation." | diff-local |
| Story 2 happy: Given R linking S with outcome `acted` and an open escalation decision stop linking S with outcome `escalate`, when the reducer derives the route, then coverage is consistent and the route is the decision-stop halt for that owner, not "current remediation source coverage is incomplete or contradictory". | 3 | "`reduceBuildReviewAdjudication` with R (`acted` on S) and an open escalation decision stop (`escalate` on S, owner architecture) returns route `halt` with reason `architecture decision is required for current remediation sources`, not the coverage-contradiction reason." | diff-local |
| Story 2 happy: Given R linking S with outcome `acted` and an open action case N with an applied effect linking S, when the reducer derives the route, then it routes BUILD and the BUILD route's repair case ids are exactly N. | 3 | "With R (`acted` on S) and open action case N (`acted`, applied effect) on S, the reducer returns route `build`, and the coordinator's durable BUILD-route `repairCaseIds` for the same store are exactly [N]." | diff-local |
| Story 2 happy: Given two resolved cases linking S where the later-recorded link settles S and the earlier one does not, when the settled-source predicate is computed, then S is settled; with the settling link recorded earlier instead, S is not settled. | 2 | "`finalizedBuildReviewSourceIds` reads each source's authoritative link: S is settled when the later-recorded resolved link settles it, not settled when the settling link is the earlier one, and not settled when a resolved applied deferral link is followed by an open action case N on S." | diff-local |
| Story 2 happy: Given a store in which no source is linked by more than one case, when coverage, the route, and the settled-source predicate are computed, then each result equals the result before this change for the same store. | 2, 3 | "On a fixture store in which no source is linked by more than one case, `finalizedBuildReviewSourceIds` returns the same set as the test's reference copy of the pre-change any-link rule." | diff-local |
| Story 2 negative: Given two resolved cases whose links on S carry the same `recordedAt`, when the authoritative link is read twice, then both reads return the link of the case later in store order. | 2 | "`currentBuildReviewSourceLinks(cases)` returns, per source id, the link on the open case when one exists, otherwise the link with the latest `recordedAt`, and for two resolved links with equal `recordedAt` returns the later case in store order on every call." | diff-local |
| Story 2 negative: Given a current source S that no case links, when the reducer derives the route, then it still halts with "current remediation source coverage is incomplete or contradictory". | 3 | "With current source S linked by no case, the reducer still returns route `halt` with reason `current remediation source coverage is incomplete or contradictory`." | diff-local |
| Story 2 negative: Given a resolved deferral whose applied link on S would settle it and a later open action case N linking S, when the settled-source predicate is computed, then S is not settled and stays a live source. | 2 | "`finalizedBuildReviewSourceIds` reads each source's authoritative link: S is settled when the later-recorded resolved link settles it, not settled when the settling link is the earlier one, and not settled when a resolved applied deferral link is followed by an open action case N on S." | diff-local |
| Story 2 negative: Given the `build-review findings` command and the effective-verdict path read a store holding R and N on S, when each derives its settled sources, then both report the same settled set as the coordinator. | 2 | "For a store holding R and N on S, the settled set the `build-review findings` command passes to `deriveComposedBuildReviewEffectiveVerdict` and the set `build-review-effective.ts` derives from the store both equal `finalizedBuildReviewSourceIds` over the same cases, which is the set the coordinator removes from its live source set for that store." | diff-local |
| Story 3 happy: Given R is an action case whose effect `failed` and the judgement proposes an unbound action case whose sources include S as `merged` plus another live source, when the lap reconciles, then a new case N with a freshly reserved action effect is persisted, R is byte-identical, and no `remediation_adjudication_failed` event is emitted. | 4 | "Replaying the `daemon-reconciliation-delays-first-feature-dispatc` shape (resolved act R with a failed effect on S; judgement with an unbound act case whose sources are S as `merged` plus another live source) through `coordinateBuildReviewAdjudication` with the real store and reconciler persists new case N with a reserved action effect, emits no `remediation_adjudication_failed`, and leaves R's serialized row byte-identical." | diff-local |
| Story 3 happy: Given N's new action effect and kickback budget remaining, when the effect stage applies it, then the kickback budget is charged exactly once for N's effect id and the lap routes BUILD with N. | 5 | "Through the conductor build_review step on the incident-1 shape with kickback budget remaining, the charge adapter records exactly one charge for N's effect id and BUILD is dispatched with a work order carrying N." | diff-local |
| Story 3 happy: Given R is an action case with an `applied` effect and the judgement proposes an unbound `defer` or `reject` case on S, when the lap reconciles, then a new case with that disposition is persisted and R is byte-identical. | 4 | "An unbound `defer` case and an unbound `reject` case on S over resolved R with an `applied` action effect each persist a new case with that disposition and leave R byte-identical." | diff-local |
| Story 3 happy: Given N was persisted for the re-raise, when the same judgement is reconciled again, then it converges on N with no second case, effect or kickback charge. | 4 | "Reconciling the same judgement a second time after N exists converges on N: the store holds no second case or effect id and the charge adapter records no second charge." | diff-local |
| Story 3 negative: Given N's new action effect and an exhausted cumulative kickback cap, when the effect stage runs, then the lap halts with the existing kickback-cap halt naming N's effect and no case-store invariant appears in the halt or the event. | 5 | "With the cumulative kickback cap exhausted, the same lap halts with `build-review kickback budget exhausted (cumulative): blocked cases` naming N and N's effect id, the HALT text and emitted events contain none of `case transition rejected`, `source-linked-by-multiple-cases`, `duplicate-case-id`, `duplicate-effect-id` or `invalid-next-state`, no emitted event carries `rejectedTransition`, and R's row is byte-identical." | diff-local |
| Story 3 negative: Given R is an action case, failed or applied, that holds no operator acceptance and no operator resolution, and the judgement binds the current finding to R by `existingCaseId` with disposition `act`, when the lap runs, then it halts `semantic remediation case regression R` and persists no new case. | 4 | "A judgement binding the current finding to resolved R by `existingCaseId` with disposition `act`, for R failed and for R applied, halts with detail `semantic remediation case regression R` and persists no new case." | diff-local |
| Story 3 negative: Given O is an open action case on S and the judgement proposes an unbound action case on S with a different source set, when the lap reconciles, then it halts with a rejected transition naming `source-linked-by-multiple-cases`, O, the proposed case id and S, and the store is byte-identical. | 4 | "With open action case O on S, an unbound act case on S with a different source set halts with `case transition rejected: source-linked-by-multiple-cases` naming O, the proposed case id and S, and the store file is byte-identical." | diff-local |
| Story 4 happy: Given R is an action case with an `applied` effect and the judgement escalates S to architecture as an unbound case, when the lap runs, then a new open decision stop is persisted, R is byte-identical, and the feature halts with the existing decision-stop halt naming the architecture owner, the new case id and S. | 8 | "Replaying the `a-routed-fix-cannot-be-built-charged-and-reviewed-` shape (resolved act R with an applied effect on S; judgement escalating S to architecture as an unbound case) through the conductor build_review step persists one new open decision stop, leaves R's row byte-identical, and writes a HALT containing `decision stop`, the new case id, `owner: architecture` and S." | diff-local |
| Story 4 happy: Given R holds no operator acceptance and no operator resolution, and the judgement names R as `existingCaseId` on an escalation whose sources differ from R's, when the stop is persisted, then a new open stop with a fresh case id is written and R is byte-identical. | 8 | "An escalation naming R as `existingCaseId` with sources differing from R's persists a new open stop whose case id differs from R and leaves R byte-identical." | diff-local |
| Story 4 happy: Given an open decision stop D on S from an earlier lap, when a later lap's judgement escalates the same sources with the same owner, disposition and outcomes bound to D's id but with fresh link timestamps, then persistence reports already-persisted and writes nothing. | 6 | "`persistBuildReviewDecisionStop` for a record bound to open stop D's id with the same owner, disposition, source ids and outcomes but fresh `recordedAt` values returns status `already-persisted` with caseId D and the store records no write." | diff-local |
| Story 4 happy: Given an open decision stop D on S from an earlier lap, when a later lap escalates the same source set to the same owner as an unbound case, then persistence converges on D, writes nothing, and the halt names D. | 6, 8 | "For an unbound record carrying a fresh case id, the same owner and exactly D's source-id and outcome set, `persistBuildReviewDecisionStop` returns status `already-persisted` with caseId D and writes nothing." | diff-local |
| Story 4 negative: Given an open decision stop D on S, when a later lap escalates S as an unbound case to a different owner, then the lap halts with a rejected transition naming `source-linked-by-multiple-cases`, D, the proposed stop id and S, and the store is byte-identical. | 8 | "A later lap escalating S unbound to a different owner over open stop D, and an unbound escalation of S over open action case O, each halt with `case transition rejected: source-linked-by-multiple-cases` naming the existing owner (D or O), the proposed stop id and S, with the store file byte-identical." | diff-local |
| Story 4 negative: Given an open decision stop D, when a later lap binds an escalation to D's id with a different source set or owner, then persistence still fails `conflicting-case-id` and writes nothing. | 6 | "A record bound to D's id with a different source set, and one with a different owner, each return reason `conflicting-case-id` and write nothing." | diff-local |
| Story 4 negative: Given O is an open action case on S, when the judgement escalates S as an unbound case, then the lap halts with a rejected transition naming the invariant, O, the proposed stop id and S, and O is byte-identical. | 8 | "A later lap escalating S unbound to a different owner over open stop D, and an unbound escalation of S over open action case O, each halt with `case transition rejected: source-linked-by-multiple-cases` naming the existing owner (D or O), the proposed stop id and S, with the store file byte-identical." | diff-local |
| Story 5 happy: Given an escalation whose decision-stop persistence is refused as a rejected transition, when the lap halts, then `remediation_adjudication_failed` carries `rejectedTransition` with the invariant, case ids and source ids, and the HALT text names them and states that persisted case history is valid and unchanged. | 7 | "Through the conductor build_review step, the refused explicit-escalation lap and the refused blocked-consistency lap each write a `needs-human` HALT containing `case transition rejected: source-linked-by-multiple-cases`, the owner id, the proposed stop id, the source id and `persisted case history is valid and unchanged`, and a lap whose decision-stop persistence fails `case store malformed-state` writes a HALT containing `decision stop case store malformed-state` and none of `case transition rejected`, `source-linked-by-multiple-cases` or `persisted case history is valid`." | diff-local |
| Story 5 happy: Given a blocked-consistency stop whose persistence is refused as a rejected transition, when the lap halts, then the event and HALT text carry the same invariant, case ids and source ids. | 7 | "Through the conductor build_review step, the refused explicit-escalation lap and the refused blocked-consistency lap each write a `needs-human` HALT containing `case transition rejected: source-linked-by-multiple-cases`, the owner id, the proposed stop id, the source id and `persisted case history is valid and unchanged`, and a lap whose decision-stop persistence fails `case store malformed-state` writes a HALT containing `decision stop case store malformed-state` and none of `case transition rejected`, `source-linked-by-multiple-cases` or `persisted case history is valid`." | diff-local |
| Story 5 happy: Given a reconciliation refused as a rejected transition, when the lap halts, then the event and HALT text still carry the invariant, case ids and source ids exactly as before this change. | 1 | "The reconciler, coordinator, recovery-integration and conductor build_review rejected-transition tests use an open owner O in place of resolved R and still assert the emitted `remediation_adjudication_failed` event's `rejectedTransition` invariant, case ids and S, the HALT text naming them, and the byte-identical store." | diff-local |
| Story 5 negative: Given decision-stop persistence fails with `lock-timeout`, when the lap halts, then the HALT reason reads `decision stop case store lock-timeout`, the event carries no `rejectedTransition`, and the text does not state that history is valid. | 7 | "When decision-stop persistence fails with `case store lock-timeout`, `case store malformed-state` or `conflicting-case-id`, `coordinateBuildReviewAdjudication` returns details `decision stop case store lock-timeout`, `decision stop case store malformed-state` and `decision stop conflicting-case-id`, each with no `rejectedTransition` on the emitted event and without `persisted case history is valid`." | diff-local |
| Story 5 negative: Given the persisted store is corrupt when a decision stop is persisted, when the lap halts, then the halt reports a malformed case store and carries no rejected-transition fields. | 7 | "Through the conductor build_review step, the refused explicit-escalation lap and the refused blocked-consistency lap each write a `needs-human` HALT containing `case transition rejected: source-linked-by-multiple-cases`, the owner id, the proposed stop id, the source id and `persisted case history is valid and unchanged`, and a lap whose decision-stop persistence fails `case store malformed-state` writes a HALT containing `decision stop case store malformed-state` and none of `case transition rejected`, `source-linked-by-multiple-cases` or `persisted case history is valid`." | diff-local |
| Story 5 negative: Given a decision stop fails `conflicting-case-id`, when the lap halts, then the halt names `conflicting-case-id` and carries no `rejectedTransition` fields. | 7 | "When decision-stop persistence fails with `case store lock-timeout`, `case store malformed-state` or `conflicting-case-id`, `coordinateBuildReviewAdjudication` returns details `decision stop case store lock-timeout`, `decision stop case store malformed-state` and `decision stop conflicting-case-id`, each with no `rejectedTransition` on the emitted event and without `persisted case history is valid`." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Infrastructure-only versus mixed-lap classification is untouched: no task changes the raw join, the mechanical lane or the coverage-retry route. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | The single remediate dispatch and its input projection are unchanged; this feature only changes how its output is persisted and read. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | task | task-4 | halts with detail `semantic remediation case regression R` and persists no new case |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | Grader confidence and the operator floor suppress findings before adjudication; source ownership after adjudication does not change that path. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-1, task-2, task-6, task-7 | writes the next state, a following `read()` and a second `mutate()` over the written file each return R then N |
| adr-2026-08-29-build-review-remediate-case-adjudication#D1 | no-change | none | Independent rubric judgement and the mechanical raw join are untouched by case-store ownership. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D2 | no-change | none | Operator dispositions in build-review-dispositions.json keep their separate, prior authority; no task reads or writes them. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D3 | no-change | none | The remediate dispatch inputs (current findings, prior cases, plan contract) are unchanged. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D4 | no-change | none | The source-complete, case-oriented judgement schema and its validator are unchanged. |
| adr-2026-08-29-build-review-remediate-case-adjudication#D5 | task | task-1 | with invariant `source-linked-by-multiple-cases`, caseIds [O, N] and sourceIds [S] for open O plus proposed open N |
| adr-2026-08-29-build-review-remediate-case-adjudication#D6 | task | task-4 | the store holds no second case or effect id and the charge adapter records no second charge |
| adr-2026-08-29-build-review-remediate-case-adjudication#D7 | task | task-4, task-5 | the charge adapter records exactly one charge for N's effect id |
| adr-2026-08-29-build-review-remediate-case-adjudication#D8 | task | task-3 | the reducer still returns route `halt` with reason `current remediation source coverage is incomplete or contradictory` |
| adr-2026-08-29-build-review-remediate-case-adjudication#D9 | task | task-7 | emits one `remediation_adjudication_failed` with `rejectedTransition` carrying `source-linked-by-multiple-cases` |
| adr-2026-08-29-build-review-remediate-case-adjudication#D10 | no-change | none | Rollout gating is unchanged; the relaxed invariant ships without a flag because every store the current engine wrote still parses identically. |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
