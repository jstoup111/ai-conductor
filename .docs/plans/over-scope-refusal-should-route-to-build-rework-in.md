# Implementation Plan: Over-scope refusal routes to BUILD rework

**Date:** 2026-10-03
**Design:** `.docs/decisions/adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework.md` (technical track, no PRD)
**Stories:** `.docs/stories/over-scope-refusal-should-route-to-build-rework-in.md` (accepted stories)
**Conflict check:** Clean as of 2026-10-03 (`.docs/conflicts/over-scope-refusal-should-route-to-build-rework-in.md`)

## Summary

When every blocking outside-visible OVER_SCOPE finding carries a durable `refuse` decision, the
SHIP `prd_audit` gate stops re-halting. It routes the refusals as engine-supplied evidence to the
existing `/remediate` planner, which produces bounded, decision-bound `rem-prd-audit-*`
removal/rework tasks for BUILD. The plan has 10 tasks.

## Technical Approach

- **One new route variant, computed once.** `routePrdAuditOverScopeV2` (`src/conductor/src/engine/conductor.ts`) keeps today's `halt`/`record`/`none` results and adds `{ kind: 'refusal-rework', refusals, findings }`. It is returned only when the blocking set is non-empty, every blocking finding is `refused`, and no projection defect exists. `routeCurrentPrdAudit` surfaces it as a new `CurrentPrdAuditRoute` member `over-scope-refusal-rework`, so the serial SHIP tail and the validation-group join read the same result (ADR D6).
- **Refusal evidence is a typed value, rendered into the existing dispatch context.** A new pure module `src/conductor/src/engine/prd-widening-refusal-rework.ts` owns three things. (a) The `RefusalReworkEvidence` type: presentation key, decision id, revision, rationale, and, for NC findings, case id and original-source snapshot, all taken from the decision and case records. (b) `renderRefusalReworkContext`, which turns the evidence into the `/remediate` `retryReason` text and names the required gap id `refusal-<decisionId>` for each refusal. (c) `admitRefusalReworkPlan`, which accepts a parsed `RemediationPlan` only if every refusal has a `build` gap with that id and at least one task. It returns `CriterionBoundRemediationGap`s whose `governingClause` is `Refused <key> (decision <id> r<rev>)` and whose `criterion` is the current key. No new file, sidecar, or event type is added.
- **Reuse the remediation machinery unchanged.** Admission goes through `planRemediation` with `source: 'prd-audit'` and `prd_audit` provenance. The `planRemediation` pre-dispatch over-scope re-check currently turns any over-scope `halt` into needs-human. It must let the `refusal-rework` variant through and append the refusal context. Append, ids (`rem-prd-audit-refusal-<decisionId>`), dispatch-time lap/growth charging (`gates.prd_audit`, #2753), the `kickback` event and `checkKickbackToBuildEscalation('prd_audit')` are all reused.
- **Halt fallback is the existing refused HALT.** Several cases fall back to the existing over-scope HALT body, built by `renderPrdAuditScopeHalt` + `renderOverScopeDecisionBlock` with `OVER_SCOPE_HALT_CLASS`: the run is not a daemon run, the lap cap is spent, the planner returns no usable plan, or admission rejects. An exception is a spent growth allowance at dispatch, which keeps the existing `kickback-cap` halt.
- **Local pattern basis:** follow the existing daemon `prd_audit` FIXABLE remediation branch (search `planRemediation(` with `source: 'prd-audit'`, `remediationRounds < prdAuditRemediationLapCap`, `captureKickbackToBuildContext('prd_audit')`, `navigateBack`). Keep from it: the escalation check runs before dispatch; a `route` outcome increments `remediationRounds`, emits `kickback`, sets `prd_audit` stale and navigates to `build`; a `halt` outcome writes through `writeHaltMarker`. Allowed variation: the halt body on refusal fallback is the over-scope refused block, not `needs-human` prose.
- **Sequencing:** pure types and helpers first (Tasks 1–3), then route projection (Task 4), then the two SHIP integration sites (Tasks 5–6), then bound/identity behavior (Tasks 7–8), then the operator lever (Task 9) and the planner contract (Task 10).

## Prerequisites

- None. All stores, the append seam and the ledger exist on `main`.

## Tasks

### Task 1: Refusal evidence type and dispatch-context renderer
**Story:** Story 1 happy 1 (evidence entries); Story 3 happy 1 (identity from the decision, not the ordinal)
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/prd-widening-refusal-rework.test.ts`. `renderRefusalReworkContext` given two refusals (one story criterion `S2.1`, one `NC.2` with case id and snapshot) returns text with one block per refusal. Each block contains the key, the decision id, `r<revision>`, the rationale, the NC snapshot, the required gap id `refusal-<decisionId>`, and the sentence restricting tasks to removing or reworking the refused behavior.
2. Verify RED.
3. Implement `RefusalReworkEvidence` and `renderRefusalReworkContext` in `src/conductor/src/engine/prd-widening-refusal-rework.ts`. The gap id is derived from `decisionId` only, never from the presentation key.
4. Verify GREEN; commit.

**Done when:**
- `renderRefusalReworkContext` output for the two-refusal fixture contains, per refusal, the key, decision id, revision, rationale, and (NC only) snapshot text, as asserted by the renderer test.
- The rendered required gap id for the NC refusal is `refusal-<decisionId>` and is identical when the fixture key changes from `NC.2` to `NC.1`, as asserted by the renderer test.
- The rendered context contains the removal/rework-only instruction sentence, as asserted by the renderer test.

**Files likely touched:**
- `src/conductor/src/engine/prd-widening-refusal-rework.ts` — new module (type + renderer)
- `src/conductor/test/engine/prd-widening-refusal-rework.test.ts` — new tests

**Dependencies:** none

### Task 2: Admission of planner output against refusals
**Story:** Story 1 happy 2 (decision-bound tasks); Story 4 negative 1 (human/empty/unbound → no task)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/prd-widening-refusal-rework.test.ts` for `admitRefusalReworkPlan(plan, refusals)`. (a) A plan with a `build` gap `refusal-<id>` carrying tasks returns `{ kind: 'admitted', gaps }`; each gap has `gateSource: 'prd-audit'`, `criterion: <current key>`, `governingClause: 'Refused <key> (decision <id> r<rev>)'`. (b) The gap is `halt`/deferral, has an empty task list, or the refusal has no matching gap id: each case returns `{ kind: 'rejected', criteria }` naming every unbound refusal key.
2. Verify RED.
3. Implement `admitRefusalReworkPlan` in `prd-widening-refusal-rework.ts`, returning `CriterionBoundRemediationGap[]` (import the type from `remediation-append.ts`).
4. Verify GREEN; commit.

**Done when:**
- `admitRefusalReworkPlan` returns `admitted` with one `CriterionBoundRemediationGap` per refusal, each carrying `gateSource` `prd-audit`, the current key as `criterion`, and the `Refused <key> (decision <id> r<rev>)` governing clause, as asserted by the admission test.
- `admitRefusalReworkPlan` returns `rejected` naming the refusal key for each of three fixtures: human/deferral disposition, empty task list, missing `refusal-<id>` gap, as asserted by the admission test.

**Files likely touched:**
- `src/conductor/src/engine/prd-widening-refusal-rework.ts` — add admission
- `src/conductor/test/engine/prd-widening-refusal-rework.test.ts` — add tests

**Dependencies:** Task 1

### Task 3: Refusal-rework task block renders the decision binding
**Story:** Story 1 happy 2 (task text cites key and decision id); Story 3 negative 3 (non-H9 id fails named)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/remediation-append.test.ts`. Appending an admitted refusal gap (gap id `refusal-<uuid>`) through `appendRemediationTasks` with gate source `prd-audit` yields a task headed `### Task rem-prd-audit-refusal-<uuid>:` whose block contains the `Refused <key> (decision <uuid> r<rev>)` clause and the current key. Refusal gaps from an empty decision id, and from a decision id made only of non-H9 characters (which reduces to empty), throw the existing `does not reduce to a non-empty deterministic id` error.
2. Verify RED (the clause rendering is new for a refusal gap, if absent; otherwise record satisfied-by evidence).
3. Implement any needed rendering in `src/conductor/src/engine/remediation-append.ts` so `governingClause` appears in the task block and Done-when checks. Sanitize the decision-id segment on its own under the H9 grammar *before* adding the `refusal-` prefix, so that an empty or all-non-H9 decision id throws the named error instead of collapsing to `refusal-`.
4. Verify GREEN; commit.

**Done when:**
- `appendRemediationTasks` output for an admitted refusal gap contains the heading `### Task rem-prd-audit-refusal-<uuid>:`, the governing clause naming the decision id and revision, and the current presentation key, as asserted by the append test.
- `appendRemediationTasks` throws the named H9 id error for two refusal gaps, one from an empty decision id and one from a decision id made only of characters outside `[A-Za-z0-9._-]`, and the caller fixture's plan text is unchanged, as asserted by the append test.

**Files likely touched:**
- `src/conductor/src/engine/remediation-append.ts` — governing-clause rendering if needed
- `src/conductor/test/remediation-append.test.ts` — tests

**Dependencies:** Task 2

### Task 4: Route projection emits `refusal-rework` only for all-refused, defect-free sets
**Story:** Story 1 happy 1 (route side), Story 1 negative 2, Story 1 negative 3; Story 2 happy 1, Story 2 happy 2, Story 2 negative 1, Story 2 negative 2, Story 2 negative 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-prd-widening-routing.test.ts` against `routePrdAuditOverScopeV2`. (a) All blocking findings refused, with no defect, returns `kind: 'refusal-rework'` with one `RefusalReworkEvidence` per refusal built from the decision and case records. (b) Refused + pending returns the existing `halt` with the pending entry in `undecided` and the refused one in `refused`. (c) All accepted returns `record`. (d) A refused NC whose offer lacks an original-source snapshot returns `halt` whose detail is `renderPrdWideningRecovery('persistence-failed', [criterion])`. (e) A projection defect (`projection-failed`) alongside refusals returns `halt` with the defect text. (f) A later `accept` revision for the same case classifies as accepted, so the result is not `refusal-rework`. (g) A cleared block with a `refuse` entry and an empty rationale is harvested; no decision is recorded, the finding stays pending, and the result is `halt`.
2. Add a `routeCurrentPrdAudit` test asserting that `refusal-rework` surfaces as `CurrentPrdAuditRoute` `{ kind: 'over-scope-refusal-rework' }`. Add a test that a machine-cleared all-pending block produces the same `halt` with no `refusal-rework`.
3. Verify RED.
4. Implement the variant in `PrdAuditOverScopeRoute`, `routePrdAuditOverScopeV2` and `CurrentPrdAuditRoute`, and keep the `persistRecordedFindings` projection for the new variant.
5. Verify GREEN; commit.

**Done when:**
- `routePrdAuditOverScopeV2` returns `refusal-rework` carrying evidence with decision id, revision, rationale and (NC) snapshot for an all-refused defect-free fixture, as asserted by the routing test.
- `routePrdAuditOverScopeV2` returns the existing `halt` (undecided contains the pending finding, refused contains the refused one) for refused+pending, and returns `record` for all-accepted, as asserted by the routing test.
- `routePrdAuditOverScopeV2` returns `halt` with `persistence-failed` recovery text naming the criterion for a refused NC lacking its snapshot, and returns `halt` with the defect text when a projection defect accompanies refusals, as asserted by the routing test.
- An accept revision of a prior refusal yields no `refusal-rework` result and marks that finding `accepted: true` in the route's findings, and an all-pending machine-cleared block yields the same pending `halt`, as asserted by the routing test. Also, a cleared block whose `refuse` entry has an empty rationale records no decision through the existing harvest, and `routePrdAuditOverScopeV2` then returns the pending `halt` with that finding in `undecided` and no `refusal-rework`, as asserted by the routing test.
- `routeCurrentPrdAudit` maps `refusal-rework` to `over-scope-refusal-rework`, as asserted by the routing test.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — route variant and projection
- `src/conductor/test/engine/conductor-prd-widening-routing.test.ts` — tests

**Dependencies:** Task 1

### Task 5: Serial SHIP tail dispatches refusal rework through planRemediation
**Story:** Story 1 happy 1, Story 1 happy 2, Story 1 happy 3, Story 1 negative 1; Story 4 happy 1, Story 4 negative 1, Story 4 negative 2, Story 4 negative 3; Story 5 negative 1
**Type:** happy-path

**Steps:**
1. Write failing Conductor-level tests in `src/conductor/test/prd-audit-kickback.test.ts`, with a stub step runner and a fixture `/remediate` result. The daemon serial SHIP tail with an all-refused report and an unspent lap must: write no `.pipeline/HALT`; dispatch `remediate` once with a `retryReason` containing `renderRefusalReworkContext` output; append `rem-prd-audit-refusal-<id>` tasks to the active plan; emit `kickback` `from: prd_audit` `to: build`; and dispatch `build` next. The same report plus a FIXABLE row produces a single dispatch and one lap. A following lap whose report no longer flags the criterion satisfies the gate. `.pipeline/accepted-widenings.json` is byte-identical before and after.
2. Add fallback tests, each writing the existing over-scope refused HALT body (refused label + revise-decision entry, `OVER_SCOPE_HALT_CLASS`) and dispatching no further remediation. The cases: lap spent and criterion still flagged; planner disposition rejected by `admitRefusalReworkPlan`; append throwing the H9 id error; missing, stale-session, or unparseable `remediation.json`; non-daemon run. Add a test that a no-op BUILD lap followed by an unchanged verdict halts through `checkKickbackToBuildEscalation('prd_audit')`.
3. Verify RED.
4. Implement in the serial SHIP prd_audit branch (search `prdAuditRoute.kind === 'over-scope-halt'`). Handle `over-scope-refusal-rework` in this order: run the escalation check; if `this.daemon` and `remediationRounds < prdAuditRemediationLapCap`, call `planRemediation` with the refusal context; otherwise write the refused HALT. In `planRemediation`'s pre-dispatch over-scope re-check, let `refusal-rework` through, and run `admitRefusalReworkPlan` before the append. A rejection returns a halt carrying the refused block.
5. Verify GREEN; commit.

**Done when:**
- The daemon serial SHIP test with an all-refused report writes no `.pipeline/HALT`, records one `remediate` dispatch whose retry reason contains each refusal's decision id, appends `rem-prd-audit-refusal-<id>` to the plan, emits a `kickback` `prd_audit`→`build` event to `.pipeline/events.jsonl`, and dispatches `build` next.
- The refused+FIXABLE serial test records exactly one `remediate` dispatch, whose retry reason contains the refusal decision id and whose provenance cites `.pipeline/prd-audit.md` carrying the FIXABLE row, with `remediationRounds` equal to 1.
- The post-rework lap with the criterion absent completes `prd_audit`; `.pipeline/accepted-widenings.json` is byte-identical to its pre-route content, and a decision-store re-read returns the same `refuse` decision id and revision.
- Each fallback fixture (lap spent and still flagged; rejected admission; append throwing the H9 id error; missing, stale-session, and unparseable `remediation.json`; non-daemon run) writes `.pipeline/HALT` with class `over-scope`, a body byte-identical to `renderPrdAuditScopeHalt(detail, renderOverScopeDecisionBlock(...))` for the same route (refused label "refused — rework required" plus revise-decision entry), zero further `remediate` dispatches, and zero appended tasks.
- A no-op BUILD lap followed by an unchanged prd_audit verdict writes the `prd_audit kickback-to-build no-op` needs-human halt from `checkKickbackToBuildEscalation`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — serial branch and `planRemediation` pre-check/admission
- `src/conductor/test/prd-audit-kickback.test.ts` — Conductor-level tests

**Dependencies:** Tasks 2, 3, 4

### Task 6: Validation-group join routes refusals identically and merges dispatch
**Story:** Story 5 happy 1, Story 5 happy 2, Story 5 negative 2
**Type:** happy-path

**Steps:**
1. Write a failing parametrized test in `src/conductor/test/prd-audit-kickback.test.ts` that drives the same fixtures through the serial tail and the validation-group join (including an empty-rationale refusal clear and an accept that revises a refusal, both of which must dispatch nothing). For all-refused, both make one `remediate` dispatch with identical refusal context and no HALT. For refused+pending, both write byte-identical HALT bodies. Add a join test where the as-built review is also BLOCKED with a remediable finding: the join makes exactly one `remediate` dispatch whose evidence lists both `prd_audit` and `architecture_review_as_built`, and whose retry reason contains the refusal context.
2. Verify RED.
3. Implement the `over-scope-refusal-rework` handling at the validation-group join (search `prdAuditRoute?.kind === 'over-scope-halt'` in the group join). Fold the refusal context into the existing group `planRemediation` call's evidence and dispatch context, with no second call.
4. Verify GREEN; commit.

**Done when:**
- The parametrized test asserts the serial and group-join shapes record the same single `remediate` dispatch with identical refusal retry-reason text and no `.pipeline/HALT` for the all-refused fixture.
- The parametrized test asserts byte-identical `.pipeline/HALT` bodies from both shapes for the refused+pending fixture, in which the pending finding's entry is the only entry with `decision: "pending"` and the refused criterion is named "refused — rework required", with zero `remediate` dispatches.
- For the empty-rationale refusal fixture and the accept-revises-refusal fixture, both shapes record zero `remediate` dispatches and append no `rem-prd-audit-refusal-*` task.
- The group-join test with a blocked as-built review records exactly one `remediate` dispatch whose provenance contains both `prd_audit` and `architecture_review_as_built` and whose retry reason contains each refusal's decision id.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — group-join branch
- `src/conductor/test/prd-audit-kickback.test.ts` — parity tests

**Dependencies:** Task 5

### Task 7: Refusal rework charges the existing prd_audit lap and growth bounds
**Story:** Story 3 happy 2, Story 3 negative 1, Story 3 negative 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/prd-audit-kickback.test.ts`. (a) After one admitted refusal round reaches BUILD dispatch, the `gates.prd_audit` ledger shows one lap and growth `added` equal to the appended task count. (b) A planner returning more refusal tasks than the remaining growth allowance writes the `kickback-cap` HALT listing every refused key, and leaves `build` not done. (c) A malformed `gates.prd_audit` ledger record makes a refusal round write the refused HALT and dispatch nothing.
2. Verify RED.
3. Implement whatever the refusal path needs so it reaches the existing dispatch-time settlement (#2753). Before calling `planRemediation`, read the `gates.prd_audit` allowance from the kickback ledger; a malformed record reads as exhausted (adr-2026-08-31-kickback-ledger-read-fails-closed) and takes the refused HALT path with no dispatch. Include refused keys in the cap-halt finding list.
4. Verify GREEN; commit.

**Done when:**
- The kickback ledger read after one admitted refusal round shows `gates.prd_audit` laps equal to 1 and a growth `added` delta equal to the number of appended `rem-prd-audit-refusal-*` tasks.
- The over-cap fixture writes `.pipeline/HALT` with class `kickback-cap` whose body names every refused key, and `build` remains not done in conduct state.
- The malformed-ledger fixture writes the refused over-scope HALT and records zero `remediate` and zero `build` dispatches.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — cap-halt finding list for refusals
- `src/conductor/test/prd-audit-kickback.test.ts` — bound tests

**Dependencies:** Task 5

### Task 8: Renumbered NC refusal upserts the same rework task
**Story:** Story 3 happy 1
**Type:** happy-path

**Steps:**
1. Write a failing Conductor-level test in `src/conductor/test/prd-audit-kickback.test.ts`. It runs two refusal rounds (cap raised to 2 in the fixture config) where the same validated case is reported as `NC.2` then `NC.1`. The plan contains one `rem-prd-audit-refusal-<decisionId>` block after both, and the second append returns the existing id.
2. Verify RED, then implement any id derivation fix so the gap id is decision-derived end to end.
3. Verify GREEN; commit.

**Done when:**
- After two rounds with renumbered NC keys for the same case, the active plan contains exactly one `### Task rem-prd-audit-refusal-<decisionId>:` block, and the second `appendRemediationTasks` call returns that same id, as asserted by the Conductor-level test.
- Across both renumbered rounds the `gates.prd_audit` growth `added` total equals the single appended task, not two, as read from the kickback ledger in the same test.

**Files likely touched:**
- `src/conductor/test/prd-audit-kickback.test.ts` — renumber test
- `src/conductor/src/engine/prd-widening-refusal-rework.ts` — id derivation fix if needed

**Dependencies:** Task 5

### Task 9: A raised budget re-admits refusal rework after the refused halt
**Story:** Story 4 happy 2
**Type:** happy-path

**Steps:**
1. Write a failing Conductor-level test in `src/conductor/test/prd-audit-kickback.test.ts`. A refused HALT written because the lap is spent is followed by a consumed `kickback-budget raise` for `prd_audit` and a clear. The next lap with the refusal still flagged makes one `remediate` dispatch carrying the refusal context.
2. Verify RED; implement whatever lets the raise-resume path reach the refusal route (no new lever).
3. Verify GREEN; commit.

**Done when:**
- After a consumed `kickback-budget raise` and a clear of the refused HALT, the next lap records exactly one `remediate` dispatch whose retry reason contains the refusal decision id, and writes no new `.pipeline/HALT`.
- Before the raise, the same fixture with the lap allowance spent records zero `remediate` dispatches and writes the refused over-scope HALT, as asserted by the same test.

**Files likely touched:**
- `src/conductor/test/prd-audit-kickback.test.ts` — raise test
- `src/conductor/src/engine/conductor.ts` — only if the resume path skips the refusal route

**Dependencies:** Task 5

### Task 10: /remediate planner contract accepts refusal evidence and is removal-only
**Story:** Story 1 happy 2 (planner produces decision-bound removal tasks)
**Type:** infrastructure

**Steps:**
1. Write a failing contract test in `src/conductor/test/remediate-skill-contract.test.ts` (follow the existing skill-text assertions in `src/conductor/test/acceptance/remediation-authority-routing.acceptance.test.ts`, which reads `skills/remediate/SKILL.md`). It asserts that the skill text defines the refusal evidence block, the required `refusal-<decisionId>` gap id, the `build` disposition with concrete tasks, and the rule forbidding new capability for a refusal gap.
2. Verify RED.
3. Edit `skills/remediate/SKILL.md` to add the refusal evidence section and the removal/rework-only rule.
4. Verify GREEN; commit.

**Done when:**
- The skill contract test asserts `skills/remediate/SKILL.md` contains the refusal evidence definition, the `refusal-<decisionId>` gap-id requirement, and the removal/rework-only rule, and it passes.
- The same contract test fails when run against the pre-change `skills/remediate/SKILL.md`, which lacks the refusal evidence section.

**Files likely touched:**
- `skills/remediate/SKILL.md` — refusal evidence contract
- `src/conductor/test/remediate-skill-contract.test.ts` — new contract assertions

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──┬─> Task 2 ──> Task 3 ──┐
         ├─> Task 4 ─────────────┼─> Task 5 ──┬─> Task 6
         └─> Task 10             │            ├─> Task 7
                                 │            ├─> Task 8
                                 │            └─> Task 9
```

## Integration Points

- After Task 5: daemon serial SHIP all-refused → `remediate` → BUILD is exercisable end to end.
- After Task 6: both SHIP shapes share the route.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon run whose SHIP `prd_audit` report has outside-visible OVER_SCOPE findings, all with a recorded `refuse` decision, the `prd_audit` remediation allowance unspent, and no other blocking grade, when the gate is routed, then no HALT file is written and the `/remediate` planner is dispatched with one refusal evidence entry per refused finding. | 5 | "writes no `.pipeline/HALT`, records one `remediate` dispatch whose retry reason contains each refusal's decision id" | diff-local |
| Story 1 happy: Given that dispatch returns admissible removal/rework tasks, when the route completes, then each task is appended to the active plan as a `rem-prd-audit-*` task whose governing clause names the refusal decision id and whose text cites the finding's current criterion or `NC.<n>` key; a `kickback` event from `prd_audit` to `build` is emitted, and BUILD is the next dispatched step. | 3, 5 | "the governing clause naming the decision id and revision, and the current presentation key" | diff-local |
| Story 1 happy: Given BUILD completes those tasks and the next `prd_audit` no longer flags the refused criterion, when the gate is routed, then the gate is satisfied by that criterion's absence and the stored refusal decision remains in the decision store unchanged. | 5 | "a decision-store re-read returns the same `refuse` decision id and revision" | diff-local |
| Story 1 negative: Given a refused finding that is also accompanied by a FIXABLE finding on the same report, when the gate is routed, then both are offered to the same single remediation dispatch and charged as one `prd_audit` lap, never two. | 5 | "records exactly one `remediate` dispatch, whose retry reason contains the refusal decision id and whose provenance cites `.pipeline/prd-audit.md` carrying the FIXABLE row" | diff-local |
| Story 1 negative: Given a refusal decision whose `rationale` is empty, when decisions are read, then it is not a recorded refusal (existing D3/D7 defect handling) and the finding is treated as pending, so no remediation is dispatched. | 4, 6 | "both shapes record zero `remediate` dispatches and append no `rem-prd-audit-refusal-*` task" | diff-local |
| Story 1 negative: Given the refusal evidence for an NC finding whose persisted original-source snapshot cannot be read from the case store, when the route is computed, then no remediation is dispatched and the existing over-scope HALT is written with the `persistence-failed` recovery text naming that criterion. | 4 | "returns `halt` with `persistence-failed` recovery text naming the criterion for a refused NC lacking its snapshot" | diff-local |
| Story 2 happy: Given a report with one refused and one pending (undecided) outside-visible finding, when the gate is routed, then the existing over-scope HALT is written with the decision block offering only the pending finding and naming the refused one as "refused — rework required", and no remediation is dispatched. | 4, 6 | "in which the pending finding's entry is the only entry with `decision:" | diff-local |
| Story 2 happy: Given every outside-visible finding is accepted, when the gate is routed, then the findings are recorded as accepted risk exactly as before and no remediation is dispatched. | 4 | "returns `record` for all-accepted" | diff-local |
| Story 2 negative: Given the over-scope projection reports a defect (`projection-failed`, `foreign-feature`, or `persistence-failed`) alongside refused findings, when the gate is routed, then the existing named-defect HALT is written and no remediation is dispatched. | 4 | "returns `halt` with the defect text when a projection defect accompanies refusals" | diff-local |
| Story 2 negative: Given a HALT was cleared by a machine clear (daemon rekick rename) with every decision left `pending`, when the next lap routes, then no refusal is minted, no remediation is dispatched, and the same pending HALT is written again. | 4 | "an all-pending machine-cleared block yields the same pending `halt`" | diff-local |
| Story 2 negative: Given a later `accept` revises a prior `refuse` for the same case, when the gate is routed, then the finding is accepted and no refusal remediation is dispatched for it. | 4, 6 | "both shapes record zero `remediate` dispatches and append no `rem-prd-audit-refusal-*` task" | diff-local |
| Story 3 happy: Given a refused NC finding whose report ordinal changes from `NC.2` to `NC.1` between laps while its validated case relationship stays the same, when rework tasks are appended on each lap, then both laps resolve to the same `rem-prd-audit-*` task id, and the second append is an idempotent no-op. | 8, 1 | "the active plan contains exactly one `### Task rem-prd-audit-refusal-<decisionId>:` block, and the second `appendRemediationTasks` call returns that same id" | diff-local |
| Story 3 happy: Given an admitted refusal-rework round, when BUILD is dispatched, then exactly one lap is charged to the `gates.prd_audit` kickback ledger and the appended task count is charged to the existing growth record. | 7 | "shows `gates.prd_audit` laps equal to 1 and a growth `added` delta equal to the number of appended `rem-prd-audit-refusal-*` tasks" | diff-local |
| Story 3 negative: Given the remediation planner returns more refusal-rework tasks than the remaining growth allowance (5 tasks or 25% of authored tasks, whichever is lower), when the round reaches BUILD dispatch, then the existing `kickback-cap` HALT is written listing every refused finding, and BUILD is left not done. | 7 | "writes `.pipeline/HALT` with class `kickback-cap` whose body names every refused key, and `build` remains not done in conduct state" | diff-local |
| Story 3 negative: Given the `gates.prd_audit` ledger record is malformed, when a refusal round is admitted, then the allowance reads as exhausted (fail-closed) and the refused HALT is written; no task is dispatched. | 7 | "The malformed-ledger fixture writes the refused over-scope HALT and records zero `remediate` and zero `build` dispatches" | diff-local |
| Story 3 negative: Given a refusal-rework task id would be derived from an empty or non-H9 decision/case id, when the task is appended, then the append fails with the named id error and the refused HALT is written instead of an unaddressable task. | 3, 5 | "one from an empty decision id and one from a decision id made only of characters outside `[A-Za-z0-9._-]`" | diff-local |
| Story 4 happy: Given a refusal-rework lap has been spent and the next `prd_audit` still flags the refused criterion, when the gate is routed, then the over-scope HALT is written naming the criterion as "refused — rework required" with its revise-decision entry, and no further remediation is dispatched. | 5 | "zero further `remediate` dispatches, and zero appended tasks" | diff-local |
| Story 4 happy: Given that HALT, when the operator raises the budget with `kickback-budget raise` and clears it, then the next lap may dispatch refusal rework again within the raised allowance. | 9 | "the next lap records exactly one `remediate` dispatch whose retry reason contains the refusal decision id" | diff-local |
| Story 4 negative: Given the remediation planner returns a human/deferral disposition, an empty task list, or a task not bound to a refusal decision id for any refused finding, when the plan is consumed, then no task is appended for that finding and the refused HALT is written. | 2, 5 | "returns `rejected` naming the refusal key for each of three fixtures" | diff-local |
| Story 4 negative: Given the remediation planner produces no usable plan (missing, stale, or unparseable `.pipeline/remediation.json`), when the route completes, then the refused HALT is written, never a generic needs-human halt that drops the decision block. | 5 | "missing, stale-session, and unparseable `remediation.json`" | diff-local |
| Story 4 negative: Given BUILD completes the rework lap without changing the tree (no-op), when `prd_audit` re-fails on the unchanged verdict, then the existing kickback-to-build no-op escalation halts the feature. | 5 | "writes the `prd_audit kickback-to-build no-op` needs-human halt from `checkKickbackToBuildEscalation`" | diff-local |
| Story 5 happy: Given the same all-refused report and allowance state, when it is routed once through the serial SHIP tail and once through the validation-group join, then both dispatch refusal rework with identical evidence entries and neither writes a HALT. | 6 | "record the same single `remediate` dispatch with identical refusal retry-reason text and no `.pipeline/HALT`" | diff-local |
| Story 5 happy: Given the same refused + pending report, when it is routed through either shape, then both write the identical over-scope HALT body. | 6 | "byte-identical `.pipeline/HALT` bodies from both shapes for the refused+pending fixture" | diff-local |
| Story 5 negative: Given a run where `prd_audit` remediation is not available (non-daemon interactive run), when an all-refused report is routed, then the existing refused HALT is written exactly as before this change. | 5 | "a body byte-identical to `renderPrdAuditScopeHalt(detail, renderOverScopeDecisionBlock(...))` for the same route" | diff-local |
| Story 5 negative: Given the validation-group join where another member (as-built review) also requests remediation, when the refusal route is admitted, then only one remediation dispatch occurs for the group and it carries both the as-built evidence and the refusal evidence. | 6 | "records exactly one `remediate` dispatch whose provenance contains both `prd_audit` and `architecture_review_as_built`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D1 | task | task-4, task-5 | `routePrdAuditOverScopeV2` returns `refusal-rework` carrying evidence with decision id, revision, rationale and (NC) snapshot for an all-refused defect-free fixture |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D2 | task | task-1, task-4 | The rendered required gap id for the NC refusal is `refusal-<decisionId>` and is identical when the fixture key changes from `NC.2` to `NC.1` |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D3 | task | task-2, task-10 | `admitRefusalReworkPlan` returns `rejected` naming the refusal key for each of three fixtures |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D4 | task | task-3, task-7, task-8 | shows `gates.prd_audit` laps equal to 1 and a growth `added` delta equal to the number of appended `rem-prd-audit-refusal-*` tasks |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D5 | task | task-5, task-9 | writes `.pipeline/HALT` with class `over-scope`, a body byte-identical to `renderPrdAuditScopeHalt(detail, renderOverScopeDecisionBlock(...))` |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D6 | task | task-6 | The parametrized test asserts the serial and group-join shapes record the same single `remediate` dispatch |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D1 | no-change | none | Stories remain the contract; this feature adds no new authority source and its criteria come only from the accepted stories file. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D2 | no-change | none | The run rule is untouched; refusal rework changes routing only after prd_audit has already run. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D3 | task | task-2 | returns `rejected` naming the refusal key for each of three fixtures |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D4 | task | task-4 | `routePrdAuditOverScopeV2` returns `refusal-rework` carrying evidence with decision id, revision, rationale and (NC) snapshot |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D5 | task | task-7 | The over-cap fixture writes `.pipeline/HALT` with class `kickback-cap` whose body names every refused key |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D6 | task | task-7 | a growth `added` delta equal to the number of appended `rem-prd-audit-refusal-*` tasks |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D7 | no-change | none | PLAN_GAP routing is evaluated before over-scope in routeCurrentPrdAudit and is not modified by this feature. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D8 | existing | none | persistRecordedFindings in conductor.ts already projects halted and recorded over-scope findings into the verdict artifact; Task 4 keeps that projection for the new variant without changing its shape. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D1 | existing | none | classifyPrdWideningProjection in prd-widening-classification.ts is the shared blocking predicate; the new route consumes its classifications unchanged. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D2 | existing | none | renderOverScopeDecisionBlock and writeHaltMarker already render the fenced decision block; every fallback in this feature reuses them unchanged. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D3 | task | task-4 | an all-pending machine-cleared block yields the same pending `halt` |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D4 | task | task-5 | a decision-store re-read returns the same `refuse` decision id and revision |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D5 | no-change | none | No compatibility shim is added or removed; the decision store format is untouched. |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D6 | task | task-5 | appends `rem-prd-audit-refusal-<id>` to the plan |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D7 | task | task-4 | records no decision through the existing harvest |
| adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D8 | existing | none | Decision-recorded ConductorEvents, loop_halt re-halts and persistRecordedFindings verdict projection already exist; this feature records no new decisions and keeps that projection unchanged (Task 4). |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | no-change | none | The route reads accepted-widenings.json and remediation-cases.json and writes neither; rework tasks bind the decision id in the plan, never a case-record work order. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | no-change | none | No storage format or migration changes; both stores are read through their existing readers. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | existing | none | Capture before reconciliation already runs in reconcileCurrentPrdWidening ahead of routePrdAuditOverScopeV2; the new variant is computed after it. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | no-change | none | Legacy authority handling is untouched; legacy decisions classify through the same projection the new route consumes. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | no-change | none | Unmatched-NC judgment is reconciliation-mode behavior and is not invoked or changed by refusal rework. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | no-change | none | The native reconciliation output contract is unchanged; Task 10 edits only /remediate gap-planning guidance. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | no-change | none | Reconciliation bounds and retries are untouched; refusal rework is charged to the gates.prd_audit lap, never a reconciliation allowance. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | task | task-4 | `routeCurrentPrdAudit` maps `refusal-rework` to `over-scope-refusal-rework` |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | task | task-4 | returns `halt` with `persistence-failed` recovery text naming the criterion for a refused NC lacking its snapshot |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | The amendments this feature needs were made during DECIDE in this spec; no BUILD task edits an ADR. |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
