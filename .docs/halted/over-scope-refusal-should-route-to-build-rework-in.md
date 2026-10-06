# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-06T16:29:35.906Z
Slug: over-scope-refusal-should-route-to-build-rework-in
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-over-scope-refusal-should-route-to-build-rework-in
Head SHA: e1ae8f50acb5410ce5884fa2a508c727fe274dd5
Halted at: 2026-10-06T16:05:44.470Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

`````text
coverage_binding refused: plan tasks conflict with sealed criteria or ADR decisions.

Claim: adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D2
Text: 2. **One fenced decision block, all blocking findings.** The halt body (composed and passed to
   `writeHaltMarker` — never written directly, per adr-2026-07-28 D5) carries one fenced
   ```` ```json over-scope-decisions ```` block: an array with one entry per blocking finding —
   `{ criterion, summary, relation, decision: "pending" }`. The body keeps human prose naming
   the blocking set and the operator lever ("edit each `decision` to `accept` or `refuse` with a
   `rationale`, then clear"), per adr-2026-08-08 and adr-2026-08-05
   (every-dispatch-outcome-leaves-an-operator-lever). Machine data rides in the operator-owned
   body — inverting the sidecar-for-machine-data pattern (adr-2026-08-05 build-settle D7) —
   because the operator must *author* the decisions, which no engine-written sidecar affords.

**Amended 2026-09-07 by #2429:** New offers persist original source/case provenance before rendering an editable decision block; explicit offer references accompany the human-editable decision and rationale under adr-2026-09-07-durable-prd-widening-decision-reconciliation D3. This extends the operator handoff without using report prose as identity.
Task ids: 5, 6
Done when checks: The daemon serial SHIP test with an all-refused report writes no `.pipeline/HALT`, records one `remediate` dispatch whose retry reason contains each refusal's decision id, appends `rem-prd-audit-refusal-<id>` to the plan, emits a `kickback` `prd_audit`→`build` event to `.pipeline/events.jsonl`, and dispatches `build` next. | The refused+FIXABLE serial test records exactly one `remediate` dispatch, whose retry reason contains the refusal decision id and whose provenance cites `.pipeline/prd-audit.md` carrying the FIXABLE row, with `remediationRounds` equal to 1. | The post-rework lap with the criterion absent completes `prd_audit`; `.pipeline/accepted-widenings.json` is byte-identical to its pre-route content, and a decision-store re-read returns the same `refuse` decision id and revision. | Each fallback fixture (lap spent and still flagged; rejected admission; append throwing the H9 id error; missing, stale-session, and unparseable `remediation.json`; non-daemon run) writes `.pipeline/HALT` with class `over-scope`, a body byte-identical to `renderPrdAuditScopeHalt(detail, renderOverScopeDecisionBlock(...))` for the same route (refused label "refused — rework required" plus revise-decision entry), zero further `remediate` dispatches, and zero appended tasks. | A no-op BUILD lap followed by an unchanged prd_audit verdict writes the `prd_audit kickback-to-build no-op` needs-human halt from `checkKickbackToBuildEscalation`. | The parametrized test asserts the serial and group-join shapes record the same single `remediate` dispatch with identical refusal retry-reason text and no `.pipeline/HALT` for the all-refused fixture. | The parametrized test asserts byte-identical `.pipeline/HALT` bodies from both shapes for the refused+pending fixture, in which the pending finding's entry is the only entry with `decision: "pending"` and the refused criterion is named "refused — rework required", with zero `remediate` dispatches. | For the empty-rationale refusal fixture and the accept-revises-refusal fixture, both shapes record zero `remediate` dispatches and append no `rem-prd-audit-refusal-*` task. | The group-join test with a blocked as-built review records exactly one `remediate` dispatch whose provenance contains both `prd_audit` and `architecture_review_as_built` and whose retry reason contains each refusal's decision id.
Conflict: Tasks 5 and 6 require refused findings to render as “refused — rework required” with a revise-decision entry, rather than one pending-decision entry for every blocking finding.

Claim: adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D4
Text: 4. **Durable decisions, one record, format overwritten in place.** `.pipeline/accepted-widenings.json`
   keeps `version: 1` but its schema is redefined: `decisions: [{ criterion, summary,
   decision: accept|refuse, rationale, operator, decidedAt }]`. No version bump — the tolerant
   reader treats any store failing the new validator (including every old-shape store) as
   absent, which is the identical outcome with less ceremony. Operator identity resolves per adr-2026-07-01
   (machine-scoped-operator-identity); rationale is never absent (adr-2026-08-09
   non-blocking-plan-scope-containment D2). One writer (the conductor's harvest); atomic
   temp+rename; tolerant read; the write is best-effort and never throws into the halt/clear
   seam (adr-2026-07-11 D1). A later `accept` for a criterion overrides a prior `refuse`
   (append-only entries; last decision wins per criterion). A refusal is moot once the audit no
   longer flags the criterion. These are **operator decisions on prd_audit OVER_SCOPE findings**
   — a distinct concern from the commit-trailer `Scope:` "accepted scope widenings" harvest
   (adr-2026-08-09 hook-owned-containment-event-ledger Concern 2); the shared filename is
   historical and the schemas are disjoint.

**Amended 2026-08-25 by #1848:** the `criterion` field now carries either a story-criterion id
(`S<s>.<c>`) or a no-owner OVER_SCOPE finding key (`NC.<n>` — a report-scoped ordinal the
audit author assigns within the report's `## Findings without an owning criterion` section;
valid only there, and that section admits only grade `OVER_SCOPE`). For `NC.*` entries the
decision binds on `criterion` AND `summary` together: a decision applies on a later lap only
when both match the re-reported finding; any mismatch (renumbered, reworded) leaves the
finding `blocking-undecided` and the operator is re-asked — never wrong, occasionally
re-asks. Story-criterion entries keep criterion-only matching (criterion ids are stable
across re-audits; `NC.*` ordinals are not). Last-decision-wins is per matched identity.
Task ids: 8
Done when checks: After two rounds with renumbered NC keys for the same case, the active plan contains exactly one `### Task rem-prd-audit-refusal-<decisionId>:` block, and the second `appendRemediationTasks` call returns that same id, as asserted by the Conductor-level test. | Across both renumbered rounds the `gates.prd_audit` growth `added` total equals the single appended task, not two, as read from the kickback ledger in the same test.
Conflict: Task 8 requires renumbered NC refusals for the same case to upsert one rework task bound to the same decision id, while the claim requires a renumbered NC key to leave the finding blocking-undecided.

Claim: adr-2026-08-24-over-scope-decision-block-and-durable-refusals#D6
Text: 6. **Refusal semantics.** A refused criterion still blocks the gate, but the next halt is a
   changed body: it names the refused criteria as "refused — rework required" and offers
   decisions only for still-pending blocking findings (partial coverage still blocks, naming
   the remainder — adr-2026-07-22 coherence-waiver precedent). A refusal never routes to
   DECIDE, never appends plan tasks, and never becomes off-plan work (adr-2026-08-22
   one-owner-per-review-question; adr-2026-08-22 done-when-evidence D: plan-gap-shaped halts).
   The same halt with the same blocking set never reappears unchanged after a decided clear.

**Amended 2026-09-07 by #2429:** A currently refused finding remains blocking and creates no repair task. It may expose an explicit revise-decision entry naming the prior decision, with no default acceptance; an old clear cannot reverse it. See adr-2026-09-07-durable-prd-widening-decision-reconciliation D3 and D8.

**Amended 2026-10-03 by #2931:** A durable refusal is no longer a dead end. When every blocking finding is refused (none pending, no projection defect), the gate routes to the existing `prd_audit` remediation planner with engine-supplied refusal evidence. Removal/rework-only `rem-prd-audit-*` tasks are bound to the refusal decision id and bounded by the existing `gates.prd_audit` lap and growth allowance. A spent lap allowance halts with this decision's refused block (growth overflow at BUILD dispatch keeps the `kickback-cap` halt). Pending and accept are unchanged. See adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework.
Task ids: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
Done when checks: `renderRefusalReworkContext` output for the two-refusal fixture contains, per refusal, the key, decision id, revision, rationale, and (NC only) snapshot text, as asserted by the renderer test. | The rendered required gap id for the NC refusal is `refusal-<decisionId>` and is identical when the fixture key changes from `NC.2` to `NC.1`, as asserted by the renderer test. | The rendered context contains the removal/rework-only instruction sentence, as asserted by the renderer test. | `admitRefusalReworkPlan` returns `admitted` with one `CriterionBoundRemediationGap` per refusal, each carrying `gateSource` `prd-audit`, the current key as `criterion`, and the `Refused <key> (decision <id> r<rev>)` governing clause, as asserted by the admission test. | `admitRefusalReworkPlan` returns `rejected` naming the refusal key for each of three fixtures: human/deferral disposition, empty task list, missing `refusal-<id>` gap, as asserted by the admission test. | `appendRemediationTasks` output for an admitted refusal gap contains the heading `### Task rem-prd-audit-refusal-<uuid>:`, the governing clause naming the decision id and revision, and the current presentation key, as asserted by the append test. | `appendRemediationTasks` throws the named H9 id error for two refusal gaps, one from an empty decision id and one from a decision id made only of characters outside `[A-Za-z0-9._-]`, and the caller fixture's plan text is unchanged, as asserted by the append test. | `routePrdAuditOverScopeV2` returns `refusal-rework` carrying evidence with decision id, revision, rationale and (NC) snapshot for an all-refused defect-free fixture, as asserted by the routing test. | `routePrdAuditOverScopeV2` returns the existing `halt` (undecided contains the pending finding, refused contains the refused one) for refused+pending, and returns `record` for all-accepted, as asserted by the routing test. | `routePrdAuditOverScopeV2` returns `halt` with `persistence-failed` recovery text naming the criterion for a refused NC lacking its snapshot, and returns `halt` with the defect text when a projection defect accompanies refusals, as asserted by the routing test. | An accept revision of a prior refusal yields no `refusal-rework` result and marks that finding `accepted: true` in the route's findings, and an all-pending machine-cleared block yields the same pending `halt`, as asserted by the routing test. Also, a cleared block whose `refuse` entry has an empty rationale records no decision through the existing harvest, and `routePrdAuditOverScopeV2` then returns the pending `halt` with that finding in `undecided` and no `refusal-rework`, as asserted by the routing test. | `routeCurrentPrdAudit` maps `refusal-rework` to `over-scope-refusal-rework`, as asserted by the routing test. | The daemon serial SHIP test with an all-refused report writes no `.pipeline/HALT`, records one `remediate` dispatch whose retry reason contains each refusal's decision id, appends `rem-prd-audit-refusal-<id>` to the plan, emits a `kickback` `prd_audit`→`build` event to `.pipeline/events.jsonl`, and dispatches `build` next. | The refused+FIXABLE serial test records exactly one `remediate` dispatch, whose retry reason contains the refusal decision id and whose provenance cites `.pipeline/prd-audit.md` carrying the FIXABLE row, with `remediationRounds` equal to 1. | The post-rework lap with the criterion absent completes `prd_audit`; `.pipeline/accepted-widenings.json` is byte-identical to its pre-route content, and a decision-store re-read returns the same `refuse` decision id and revision. | Each fallback fixture (lap spent and still flagged; rejected admission; append throwing the H9 id error; missing, stale-session, and unparseable `remediation.json`; non-daemon run) writes `.pipeline/HALT` with class `over-scope`, a body byte-identical to `renderPrdAuditScopeHalt(detail, renderOverScopeDecisionBlock(...))` for the same route (refused label "refused — rework required" plus revise-decision entry), zero further `remediate` dispatches, and zero appended tasks. | A no-op BUILD lap followed by an unchanged prd_audit verdict writes the `prd_audit kickback-to-build no-op` needs-human halt from `checkKickbackToBuildEscalation`. | The parametrized test asserts the serial and group-join shapes record the same single `remediate` dispatch with identical refusal retry-reason text and no `.pipeline/HALT` for the all-refused fixture. | The parametrized test asserts byte-identical `.pipeline/HALT` bodies from both shapes for the refused+pending fixture, in which the pending finding's entry is the only entry with `decision: "pending"` and the refused criterion is named "refused — rework required", with zero `remediate` dispatches. | For the empty-rationale refusal fixture and the accept-revises-refusal fixture, both shapes record zero `remediate` dispatches and append no `rem-prd-audit-refusal-*` task. | The group-join test with a blocked as-built review records exactly one `remediate` dispatch whose provenance contains both `prd_audit` and `architecture_review_as_built` and whose retry reason contains each refusal's decision id. | The kickback ledger read after one admitted refusal round shows `gates.prd_audit` laps equal to 1 and a growth `added` delta equal to the number of appended `rem-prd-audit-refusal-*` tasks. | The over-cap fixture writes `.pipeline/HALT` with class `kickback-cap` whose body names every refused key, and `build` remains not done in conduct state. | The malformed-ledger fixture writes the refused over-scope HALT and records zero `remediate` and zero `build` dispatches. | After two rounds with renumbered NC keys for the same case, the active plan contains exactly one `### Task rem-prd-audit-refusal-<decisionId>:` block, and the second `appendRemediationTasks` call returns that same id, as asserted by the Conductor-level test. | Across both renumbered rounds the `gates.prd_audit` growth `added` total equals the single appended task, not two, as read from the kickback ledger in the same test. | After a consumed `kickback-budget raise` and a clear of the refused HALT, the next lap records exactly one `remediate` dispatch whose retry reason contains the refusal decision id, and writes no new `.pipeline/HALT`. | Before the raise, the same fixture with the lap allowance spent records zero `remediate` dispatches and writes the refused over-scope HALT, as asserted by the same test. | The skill contract test asserts `skills/remediate/SKILL.md` contains the refusal evidence definition, the `refusal-<decisionId>` gap-id requirement, and the removal/rework-only rule, and it passes. | The same contract test fails when run against the pre-change `skills/remediate/SKILL.md`, which lacks the refusal evidence section.
Conflict: These tasks require all-refused, defect-free findings to enter bounded refusal rework, admit refusal evidence, append refusal-bound remediation tasks, and dispatch build through remediation; the claim prohibits refusal routing to remediation or appending plan tasks.

Claim: adr-2026-08-31-kickback-ledger-read-fails-closed#D1
Text: 1. **A kickback ledger read never yields a more permissive budget than the durable record.** When
   enforcement state cannot be validated, the read fails closed: the affected gate is treated as
   exhausted and routed to the existing `needs-human` halt class. Falling through to an empty budget
   is forbidden, for missing, malformed, and version-incompatible ledgers alike.

   A genuinely absent ledger — a feature that has never been kicked back — remains the empty-budget
   base case. Absence is not corruption, and this decision does not turn a first dispatch into a
   halt.
Task ids: 7
Done when checks: The kickback ledger read after one admitted refusal round shows `gates.prd_audit` laps equal to 1 and a growth `added` delta equal to the number of appended `rem-prd-audit-refusal-*` tasks. | The over-cap fixture writes `.pipeline/HALT` with class `kickback-cap` whose body names every refused key, and `build` remains not done in conduct state. | The malformed-ledger fixture writes the refused over-scope HALT and records zero `remediate` and zero `build` dispatches.
Conflict: Task 7 requires the malformed-ledger fixture to write a refused over-scope HALT, incompatible with routing invalid enforcement state to the existing needs-human halt class.
`````
