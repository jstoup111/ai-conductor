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

### Task rem-prd-audit-rem-s14-1: conductor.ts serial over-scope-refusal-rework branch (~12172): build the planRemediation dispatch context as the same 'Blocking prd_audit gaps at .pipeline/prd-audit.md … Plan remediation per the /remediate skill and write .pipeline/remediation.json.' base context the FIXABLE serial path uses, then append renderRefusalReworkContext(refusals); extract one shared helper used by both this branch and the validation-group withRefusalReworkContext (conductor.ts:9362) so serial and grouped contexts stay identical (Task 6 parity test keeps passing)
**Gate:** prd-audit
**Rationale:** Serial refusal branch (conductor.ts ~12172) dispatches planRemediation with renderRefusalReworkContext(refusals) only, so a refused+FIXABLE report never names .pipeline/prd-audit.md or the FIXABLE row, and REWORK_ONLY_SENTENCE (prd-widening-refusal-rework.ts:77) forbids new behavior for 'every task in this round', including the FIXABLE repair. Plan Task 5 Done-when (provenance cites .pipeline/prd-audit.md carrying the FIXABLE row) admits the fix; the grouped join's withRefusalReworkContext (conductor.ts:9362) is the matched counterpart and must share one helper so the two shapes cannot drift (Task 6 parity). Preserves Task 5's existing serial-tail and fallback tests.
**Criterion:** S1.4
**Parent task:** 5
**Done when:**
- [test] S1.4 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s14-1 is complete.

### Task rem-prd-audit-rem-s14-2: prd-widening-refusal-rework.ts:77 REWORK_ONLY_SENTENCE: scope the removal/rework-only restriction to the refusal-<decisionId> gaps listed below it (not 'every task in this remediation round'), keeping the sentence text asserted by prd-widening-refusal-rework.test.ts and remediate-skill-contract.test.ts (Tasks 1, 10) in sync; then in prd-audit-kickback.test.ts 'records one remediation dispatch for a refusal riding with a FIXABLE row' assert the retryReason contains '.pipeline/prd-audit.md' and the FIXABLE criterion id (e.g. S2.2), so the fixture planner no longer masks the missing pointer
**Gate:** prd-audit
**Rationale:** Serial refusal branch (conductor.ts ~12172) dispatches planRemediation with renderRefusalReworkContext(refusals) only, so a refused+FIXABLE report never names .pipeline/prd-audit.md or the FIXABLE row, and REWORK_ONLY_SENTENCE (prd-widening-refusal-rework.ts:77) forbids new behavior for 'every task in this round', including the FIXABLE repair. Plan Task 5 Done-when (provenance cites .pipeline/prd-audit.md carrying the FIXABLE row) admits the fix; the grouped join's withRefusalReworkContext (conductor.ts:9362) is the matched counterpart and must share one helper so the two shapes cannot drift (Task 6 parity). Preserves Task 5's existing serial-tail and fallback tests.
**Criterion:** S1.4
**Parent task:** 5
**Done when:**
- [test] S1.4 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s14-2 is complete.

### Task rem-prd-audit-rem-s33-1: prd-audit-kickback.test.ts: add the Task 7(b) over-cap refusal fixture — planner returns more refusal tasks than the remaining prd_audit growth allowance; assert .pipeline/HALT class kickback-cap whose body contains 'Findings:' listing every refused key (story key and NC key), contains no bare rem-prd-audit-refusal-* id list in place of the keys, and build remains not done in conduct state
**Gate:** prd-audit
**Rationale:** Task 7 Done-when requires an over-cap fixture whose kickback-cap HALT names every refused key; the diff has none and the BUILD-boundary formatter (conductor.ts ~10265) prints 'Pending remediation tasks: rem-prd-audit-refusal-…' because prdAuditCriteriaForGapIds (conductor.ts:5163) misses refusal gap ids. The implementation fix is tasked under AB-4; this task adds the Task 7(b) test.
**Criterion:** S3.3
**Parent task:** 7
**Done when:**
- [test] S3.3 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s33-1 is complete.

### Task rem-prd-audit-rem-s34-1: prd-audit-kickback.test.ts: add Task 7(c) malformed-ledger fixtures for the serial refusal branch — (a) gates.prd_audit with a malformed lap record and readable growth, (b) malformed record with unreadable growth; each asserts .pipeline/HALT class over-scope with body byte-identical to renderPrdAuditScopeHalt(detail, renderOverScopeDecisionBlock(refused, refused, [])), zero remediate and zero build dispatches, and no appended rem-prd-audit-refusal-* task
**Gate:** prd-audit
**Rationale:** Task 7 Done-when requires a malformed gates.prd_audit fixture writing the refused over-scope HALT with zero remediate/build dispatches; today planRemediation dispatches remediate (conductor.ts:5012) before reading the ledger (:5544), and an unreadable-growth record returns an exhausted-looking budget without throwing (conductor.ts:930-940), reaching a needs-human 'allowance unavailable' halt. The pre-dispatch fail-closed read is tasked under AB-3; this task adds both malformed-ledger fixtures.
**Criterion:** S3.4
**Parent task:** 7
**Done when:**
- [test] S3.4 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s34-1 is complete.

### Task rem-as-built-rem-adr-ab1-1: prd-widening-refusal-rework.ts renderRefusalReworkContext (~:88): when refusal.caseId is defined push '- Original case id: <caseId>' into the refusal block; extend prd-widening-refusal-rework.test.ts two-refusal renderer test to assert the NC block contains its case id (and the story block has no case line), and the prd-audit-kickback.test.ts serial and grouped refusal tests to assert retryReason contains the NC case id
**Gate:** as-built
**Rationale:** prd-widening-refusal-rework.ts:83-96 renderRefusalReworkContext emits key, decision id, revision, gap id, rationale and snapshot but never refusal.caseId (field declared at :23), so both SHIP shapes dispatch without the durable case identity ADR adr-2026-10-03 decision 2 requires; the fix is within Task 1's renderer and preserves its existing assertions.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 2
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 2 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab1-1 is complete.

### Task rem-as-built-rem-adr-ab2-1: conductor.ts validation-group join: when prdAuditRoute.kind === 'over-scope-refusal-rework', wrap every grouped planRemediation call (:9525, :9617, :9790, :9959) in the same try/catch as the serial branch, and route every non-'route' outcome (rejected plan :9581/:9856/:10008, unusable/absent remediation.json :9597/:9646/:9871, exhausted or unavailable remediation :10062) to one shared helper that writes renderPrdAuditScopeHalt(detail, renderOverScopeDecisionBlock(refused, refused, [])) under OVER_SCOPE_HALT_CLASS — the same helper the serial branch's refusedHalt uses — leaving non-refusal grouped halts unchanged
**Gate:** as-built
**Rationale:** ADR decision 6 requires the grouped join to fall back exactly like the serial refused over-scope HALT, but in conductor.ts rejected plans reach generic halts at :9581/:9856/:10008, unusable plans reach alternate fallbacks at :9597/:9646/:9871/:10062, and planner calls at :9525/:9617/:9790/:9959 lack the serial try/catch (conductor.ts ~12190); Task 6 admits grouped parity. All grouped call sites are swept here; the serial branch is the reference behavior and stays unchanged.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 6
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab2-1 is complete.

### Task rem-as-built-rem-adr-ab2-2: prd-audit-kickback.test.ts: extend the Task 6 serial/grouped parametrized test with fallback fixtures (admission rejected, planner throws, missing/unparseable remediation.json, lap/remediation exhausted) asserting the grouped shape writes .pipeline/HALT class over-scope with a body byte-identical to the serial shape's refused HALT and appends no rem-prd-audit-refusal-* task
**Gate:** as-built
**Rationale:** ADR decision 6 requires the grouped join to fall back exactly like the serial refused over-scope HALT, but in conductor.ts rejected plans reach generic halts at :9581/:9856/:10008, unusable plans reach alternate fallbacks at :9597/:9646/:9871/:10062, and planner calls at :9525/:9617/:9790/:9959 lack the serial try/catch (conductor.ts ~12190); Task 6 admits grouped parity. All grouped call sites are swept here; the serial branch is the reference behavior and stays unchanged.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 6
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab2-2 is complete.

### Task rem-as-built-rem-adr-ab3-1: conductor.ts serial refusal branch (~12168) and grouped refusal path: before calling planRemediation, read the durable gates.prd_audit allowance from the kickback ledger (priorLaps vs ledger effectiveLapCap ?? remediationLapCapForGate('prd_audit'), growth remaining); a malformed record (including unreadable growth, conductor.ts:930-940) or exhausted laps/growth takes the refused over-scope HALT with no remediate dispatch; replace the process-local `remediationRounds < prdAuditRemediationLapCap` refusal guard with this durable check so a raised allowance (Task 9 test) still admits
**Gate:** as-built
**Rationale:** ADR decision 5 requires admission-time refused HALT on exhausted durable allowance, but the serial guard (conductor.ts:12168) compares process-local remediationRounds with configured prdAuditRemediationLapCap, planRemediation dispatches at :5012 before reading the ledger at :5544, and :5575 appends without comparing priorLaps to effectiveLapCap (readRemediationGateAppendBudget :910-950). Task 7 step 3 admits the pre-dispatch read; Task 9 (raised cap re-admits) must keep passing, so the guard must use effectiveLapCap rather than config. Sibling: the grouped join refusal path is swept into the same helper.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 5
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 5 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab3-1 is complete.

### Task rem-as-built-rem-adr-ab4-1: conductor.ts planRemediation: record each admitted refusal gap's current key (gap.criterion from admitRefusalReworkPlan) and make prdAuditCriteriaForGapIds (:5163) resolve refusal-<decisionId> gap ids to that key as well as FIXABLE ids, so recordPendingRepair's prdAuditCriteria (:5676) carries every refused key and the BUILD-boundary cap halt (:10266) prints them under 'Findings:'
**Gate:** as-built
**Rationale:** conductor.ts:5163 prdAuditCriteriaForGapIds resolves criteria only via prdAuditFindings (FIXABLE map, :5180), so refusal gap ids lose their keys in the pending receipt (:5676) and the growth-overflow formatter (:10266) lists task ids instead of every refused key, contrary to ADR decision 5 and Task 7 Done-when; the test is tasked under S3.3.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 5
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 5 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab4-1 is complete.

### Task rem-as-built-rem-adr-ab5-1: remediation-append.ts appendRemediationTasks (~:198-225): when refusalGapBaseId(gap) is defined and the canonical rem-prd-audit-refusal-<decisionId> id already exists in the plan, push the existing canonical id and continue regardless of title (no ordinal bump, plan text unchanged); keep title-drift ordinal bumping for non-refusal gaps; add a remediation-append.test.ts case appending the same decision with a reworded title and asserting one heading and the same returned id
**Gate:** as-built
**Rationale:** remediation-append.ts:203-213 derives the decision-bound id via refusalGapBaseId but then compares titles, bumping to an -<ordinal> suffix when the planner rewords the same decision's task, so recurrence duplicates work instead of upserting by durable identity (ADR decision 4; Task 8 Done-when requires exactly one block). Non-refusal gaps keep the existing title-drift ordinal behavior, which remediation-append.test.ts already covers.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab5-1 is complete.

### Task rem-as-built-rem-adr-ab6-1: conductor.ts planRemediation: exclude refusal tasks whose decision-bound id rem-prd-audit-refusal-<decisionId> already exists in activePlanText from prdAuditGrowthTasks (:5296) before the budget read (:5550), so the pending-repair growth charge (:5669) counts only newly appended tasks; extend the Task 8 renumbered-NC test in prd-audit-kickback.test.ts to assert gates.prd_audit growth added totals 1 across both rounds, with a reworded second-round title
**Gate:** as-built
**Rationale:** conductor.ts:5296 pushes every requested refusal task into prdAuditGrowthTasks, :5550 passes that count to readRemediationGateAppendBudget and :5669 charges it in the receipt, although appendRemediationTasks (remediation-append.ts:204) returns existing ids for no-op appends, so recurrence charges growth for no added task (ADR decision 4; Task 8 Done-when: growth total equals one task across both rounds).
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab6-1 is complete.

### Task rem-as-built-rem-adr-ab2-3: conductor.ts validation-group join: when prdAuditRoute.kind === 'over-scope-refusal-rework' and grouped planning is excluded (guard :9688 false, guard :9862 false before the manual-test fallback :9983, guard :10005 false before the generic group halt :10160-10168), call haltGroupedRefusalRework() (:9436, the writeRefusalReworkHalt helper the serial branch uses at :12334) and return before the manual-test fallback or generic needs-human HALT; extend the Task 6 serial/grouped parity test in src/conductor/test/prd-audit-kickback.test.ts with a round-cap-exhausted grouped fixture (with and without manual_test FAIL rows) asserting .pipeline/HALT class over-scope byte-identical to the serial refused HALT, zero remediate dispatches, and no appended rem-prd-audit-refusal-* task
**Gate:** as-built
**Rationale:** ADR adr-2026-10-03 decision 6: the grouped refusal join still bypasses haltGroupedRefusalRework (conductor.ts:9436) when planning is excluded. That happens at the process-local guard at :9688 and the round-cap guards at :9862 and :10005, and their else-paths fall to the manual-test fallback at :9983 and the generic needs-human halt at :10160-10168. The serial branch (:12334 writeRefusalReworkHalt) is the reference and stays unchanged. Planner throw/reject handling at :9611, :9704, :9884 and :10059 is already repaired and preserved (Task 6, rem-as-built-rem-adr-ab2-1/ab2-2 coverage kept). Non-refusal grouped halts are found and excluded: no plan task admits changing them.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 6
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab2-3 is complete.

### Task rem-as-built-rem-adr-ab3-2: conductor.ts validation-group join: when prdAuditRoute.kind === 'over-scope-refusal-rework', call refusalReworkAllowanceAvailable() (:7591, same predicate as serial :12267) before each grouped planRemediation call (:9611, :9704, :9884, :10059) and on false call haltGroupedRefusalRework() with no remediate dispatch; replace the refusal-path use of the process-local `remediationRounds < prdAuditRemediationLapCap` guard at :9688 with that durable check so a raised effectiveLapCap re-admits (Task 9 test keeps passing); add grouped fixtures to src/conductor/test/prd-audit-kickback.test.ts for a spent prd_audit lap, a malformed gates.prd_audit record, and a raised cap, asserting refused over-scope HALT with zero remediate for the first two and one remediate dispatch for the third
**Gate:** as-built
**Rationale:** ADR adr-2026-10-03 decision 5: the durable allowance check refusalReworkAllowanceAvailable (conductor.ts:7591) gates only the serial branch (:12267). Grouped planRemediation calls at :9611, :9704, :9884 and :10059 reach dispatch (:5041) before the budget read (:5582), and the guard at :9688 compares process-local remediationRounds with the configured prdAuditRemediationLapCap, ignoring a raised effectiveLapCap. Plan Task 7 step 3 and Task 9 admit the pre-dispatch durable read. It is the same predicate the serial branch uses, so the serial and grouped sides share one source and cannot drift.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 5
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 5 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab3-2 is complete.

### Task rem-as-built-rem-adr-ab7-1: remediation-append.ts appendRemediationTasks (~:195-210): derive refusal task ids per task position — index 0 keeps rem-prd-audit-refusal-<decisionId>, index k>=1 uses rem-prd-audit-refusal-<decisionId>-<k+1> — via one exported helper (e.g. refusalTaskIds(gap)) so each position upserts on recurrence regardless of title and no task is skipped; in conductor.ts planRemediation (:5326-5334) use that same helper to count growth only for task ids absent from activePlanText, so prdAuditGrowthTasks feeds the budget read (:5588) and receipt charge (:5705) the actually appended count; keep the existing reworded-title upsert test (rem-as-built-rem-adr-ab5-1) and Task 8 renumbered-NC growth-total-1 test, and add a remediation-append.test.ts case plus a prd-audit-kickback.test.ts case where a two-task refusal appends two headings and charges gates.prd_audit growth 2, and a second identical round appends nothing and charges 0 growth
**Gate:** as-built
**Rationale:** ADR adr-2026-10-03 decision 4: remediation-append.ts:198 gives every task in a refusal gap the same canonical id, so the :204-209 upsert branch drops task 2..n. Meanwhile conductor.ts:5329-5334 tests only the gap-level canonical heading, and :5588 and :5705 charge growth for every requested task, so a two-task refusal appends one task and charges two. The fix keeps the AB-5/Task 8 guarantees: the first task id stays rem-prd-audit-refusal-<decisionId>, and a renamed or retitled recurrence upserts without growth (the rem-as-built-rem-adr-ab5-1 and ab6-1 tests are kept). The id derivation in remediation-append.ts and the existence regex in conductor.ts are a matched pair, so both are derived from one exported helper.
**Governing clause:** adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4
**Done when:**
- adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework decision 4 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-ab7-1 is complete.
