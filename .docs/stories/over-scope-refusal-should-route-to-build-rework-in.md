**Status:** Accepted

# Stories: Over-scope refusal routes to BUILD rework

Track: technical. Source: jstoup111/ai-conductor#2931 and
`adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework` (APPROVED).

Technical intents:
- **TI-1** — A durable refusal of every blocking OVER_SCOPE finding sends the feature back to BUILD for bounded removal/rework instead of re-halting (ADR D1, D3).
- **TI-2** — Pending decisions, projection defects and accept keep their current behavior (ADR D1).
- **TI-3** — Refusal rework is identified by durable decision/case identity and bounded by the existing `prd_audit` lap and growth allowance (ADR D2, D4).
- **TI-4** — When rework is not possible or the allowance is spent, the existing refused HALT is the outcome (ADR D3, D5).
- **TI-5** — Both SHIP execution shapes behave identically, and modes without prd_audit remediation are unchanged (ADR D6).

## Story 1: Refusing every blocking finding routes the feature to BUILD rework

**Requirement:** TI-1

As an operator who refused an OVER_SCOPE criterion, I want the feature to go back to BUILD to
remove the refused behavior so that my refusal ends in rework rather than an identical re-halt.

### Acceptance Criteria

#### Happy Path
- Given a daemon run whose SHIP `prd_audit` report has outside-visible OVER_SCOPE findings, all with a recorded `refuse` decision, the `prd_audit` remediation allowance unspent, and no other blocking grade, when the gate is routed, then no HALT file is written and the `/remediate` planner is dispatched with one refusal evidence entry per refused finding.
- Given that dispatch returns admissible removal/rework tasks, when the route completes, then each task is appended to the active plan as a `rem-prd-audit-*` task whose governing clause names the refusal decision id and whose text cites the finding's current criterion or `NC.<n>` key; a `kickback` event from `prd_audit` to `build` is emitted, and BUILD is the next dispatched step.
- Given BUILD completes those tasks and the next `prd_audit` no longer flags the refused criterion, when the gate is routed, then the gate is satisfied by that criterion's absence and the stored refusal decision remains in the decision store unchanged.

#### Negative Paths
- Given a refused finding that is also accompanied by a FIXABLE finding on the same report, when the gate is routed, then both are offered to the same single remediation dispatch and charged as one `prd_audit` lap, never two.
- Given a refusal decision whose `rationale` is empty, when decisions are read, then it is not a recorded refusal (existing D3/D7 defect handling) and the finding is treated as pending, so no remediation is dispatched.
- Given the refusal evidence for an NC finding whose persisted original-source snapshot cannot be read from the case store, when the route is computed, then no remediation is dispatched and the existing over-scope HALT is written with the `persistence-failed` recovery text naming that criterion.

### Done When
- [ ] A fixture report with only refused outside-visible findings produces a remediation dispatch and no `.pipeline/HALT`.
- [ ] The appended plan task block contains the `rem-prd-audit-` id, the refusal decision id as governing clause, and the current presentation key.
- [ ] `.pipeline/events.jsonl` contains a `kickback` event `from: prd_audit`, `to: build`.
- [ ] `.pipeline/accepted-widenings.json` is byte-identical before and after the route.

## Story 2: Pending decisions, projection defects and acceptance keep today's behavior

**Requirement:** TI-2

As an operator, I want any still-undecided finding to stop the feature for my decision so that
rework never skips a decision I have not made.

### Acceptance Criteria

#### Happy Path
- Given a report with one refused and one pending (undecided) outside-visible finding, when the gate is routed, then the existing over-scope HALT is written with the decision block offering only the pending finding and naming the refused one as "refused — rework required", and no remediation is dispatched.
- Given every outside-visible finding is accepted, when the gate is routed, then the findings are recorded as accepted risk exactly as before and no remediation is dispatched.

#### Negative Paths
- Given the over-scope projection reports a defect (`projection-failed`, `foreign-feature`, or `persistence-failed`) alongside refused findings, when the gate is routed, then the existing named-defect HALT is written and no remediation is dispatched.
- Given a HALT was cleared by a machine clear (daemon rekick rename) with every decision left `pending`, when the next lap routes, then no refusal is minted, no remediation is dispatched, and the same pending HALT is written again.
- Given a later `accept` revises a prior `refuse` for the same case, when the gate is routed, then the finding is accepted and no refusal remediation is dispatched for it.

### Done When
- [ ] Fixture: refused + pending → HALT body contains the pending decision entry and the refused label; no `planRemediation` dispatch recorded.
- [ ] Fixture: projection defect + refused → HALT detail matches the existing defect recovery text.
- [ ] Fixture: all accepted → verdict artifact records the accepted findings; no HALT and no dispatch.

## Story 3: Refusal rework uses durable identity and the existing prd_audit bounds

**Requirement:** TI-3

As the engine, I want refusal rework to reuse the decision identity and the existing lap and
growth caps so that a refusal can never cause unbounded or duplicated plan growth.

### Acceptance Criteria

#### Happy Path
- Given a refused NC finding whose report ordinal changes from `NC.2` to `NC.1` between laps while its validated case relationship stays the same, when rework tasks are appended on each lap, then both laps resolve to the same `rem-prd-audit-*` task id, and the second append is an idempotent no-op.
- Given an admitted refusal-rework round, when BUILD is dispatched, then exactly one lap is charged to the `gates.prd_audit` kickback ledger and the appended task count is charged to the existing growth record.

#### Negative Paths
- Given the remediation planner returns more refusal-rework tasks than the remaining growth allowance (5 tasks or 25% of authored tasks, whichever is lower), when the round reaches BUILD dispatch, then the existing `kickback-cap` HALT is written listing every refused finding, and BUILD is left not done.
- Given the `gates.prd_audit` ledger record is malformed, when a refusal round is admitted, then the allowance reads as exhausted (fail-closed) and the refused HALT is written; no task is dispatched.
- Given a refusal-rework task id would be derived from an empty or non-H9 decision/case id, when the task is appended, then the append fails with the named id error and the refused HALT is written instead of an unaddressable task.

### Done When
- [ ] Two consecutive laps with renumbered NC keys produce one task block in the plan, not two.
- [ ] The kickback ledger shows one `prd_audit` lap and the matching growth delta after one refusal round.
- [ ] Over-cap and malformed-ledger fixtures each produce a HALT with the stated class and no BUILD dispatch.

## Story 4: Unremovable or persistent refused behavior halts with the refused block

**Requirement:** TI-4

As an operator, I want a bounded, named halt when rework cannot remove refused behavior so that I
keep my existing levers instead of a loop.

### Acceptance Criteria

#### Happy Path
- Given a refusal-rework lap has been spent and the next `prd_audit` still flags the refused criterion, when the gate is routed, then the over-scope HALT is written naming the criterion as "refused — rework required" with its revise-decision entry, and no further remediation is dispatched.
- Given that HALT, when the operator raises the budget with `kickback-budget raise` and clears it, then the next lap may dispatch refusal rework again within the raised allowance.

#### Negative Paths
- Given the remediation planner returns a human/deferral disposition or a task not bound to a refusal decision id for any refused finding, when the validated plan is consumed, then no task is appended for that finding and the refused HALT is written.
- Given the remediation planner returns `build` with an empty task list for a refused finding, when the plan is validated, then the whole plan is rejected and retried, and once the retry allowance is exhausted the refused HALT is written with no appended task.
- Given every remediate attempt within `remediate`'s retry allowance produces no usable plan (missing structured result, rejected plan, timeout, or persistence failure), when the route receives the retry-exhausted no-plan result, then the refused HALT is written, never a generic needs-human halt that drops the decision block.
- Given BUILD completes the rework lap without changing the tree (no-op), when `prd_audit` re-fails on the unchanged verdict, then the existing kickback-to-build no-op escalation halts the feature.

### Done When
- [ ] Fixture: spent allowance + still-flagged refusal → HALT body contains the refused label and revise-decision entry; zero dispatches.
- [ ] Fixtures for human disposition and unbound task produce the refused HALT on consumption; an empty-task fixture produces it after retry exhaustion; none appends a task.

## Story 5: Serial SHIP and validation-group join route refusals identically

**Requirement:** TI-5

As the engine, I want the serial SHIP tail and the concurrent validation-group join to make the
same refusal decision so that the outcome does not depend on execution shape.

### Acceptance Criteria

#### Happy Path
- Given the same all-refused report and allowance state, when it is routed once through the serial SHIP tail and once through the validation-group join, then both dispatch refusal rework with identical evidence entries and neither writes a HALT.
- Given the same refused + pending report, when it is routed through either shape, then both write the identical over-scope HALT body.

#### Negative Paths
- Given a run where `prd_audit` remediation is not available (non-daemon interactive run), when an all-refused report is routed, then the existing refused HALT is written exactly as before this change.
- Given the validation-group join where another member (as-built review) also requests remediation, when the refusal route is admitted, then only one remediation dispatch occurs for the group and it carries both the as-built evidence and the refusal evidence.

### Done When
- [ ] One parametrized test asserts identical route results for both SHIP shapes over the same fixtures.
- [ ] Interactive-mode fixture writes the pre-change refused HALT body.
