# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-04T13:42:10.670Z
Slug: over-scope-accept-stranded-rebase-fence-re-halts-b
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-over-scope-accept-stranded-rebase-fence-re-halts-b
Head SHA: 210f9a61e1747e30b8d6227338d2e40240695eec
Halted at: 2026-10-04T13:08:07.037Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 4 negative: Given an `applying` record with persisted evidence where `prd_audit`'s current verdict no longer matches its recorded digest, when the conductor resumes, then `prd_audit` is not stamped as preserved, is absent from the completed operation's `transition.preserved`, is classified by the existing post-rebase rerun-or-reuse rules (re-verified when its completion check mechanically attests the current tree, otherwise `pending` with an unsatisfied verdict), and resume writes no rebase-fence HALT for it
Task ids: 8
Done when checks: Through `Conductor.run({ resume: true })`, fixture (a) persists `rebaseOperation.status = applied` with an `appliedAt` stamp before the first `step_started` event, preserved gates carry `preservation.operationId`, every invalidated gate is `pending` with an unsatisfied verdict, and the first `step_started` is the clamp's earliest unsatisfied gate. | A second `Conductor.run({ resume: true })` on fixture (a)'s result leaves every `.pipeline/gates/*.json` byte-identical, writes no `.pipeline/HALT`, and applies no conduct-state mutation batch. | Fixture (e) completes with `prd_audit` absent from `transition.preserved`, its verdict carrying no preservation stamp, `pending` with an unsatisfied verdict, writes no `.pipeline/HALT`, and the first `step_started` is the clamp's earliest unsatisfied gate. | Fixture (h), whose preserved `test_suite` verdict mismatches its persisted evidence digest and whose completion check mechanically re-verifies the current tree, completes with `test_suite` in `transition.reverified`, absent from `transition.preserved`, carrying no preservation stamp, and emits no `step_started` event for `test_suite`.
Missing assertion: "is classified by the existing post-rebase rerun-or-reuse rules (re-verified when its completion check mechanically attests the current tree, otherwise `pending` with an unsatisfied verdict)"

Criterion: Story 7 negative: Given a prd_audit lap where reconciliation judges NC.1's relation `uncertain` or `different`, when the gate verdict is persisted, then its reason carries the `[uncertain-relation]` classification as today
Task ids: 11
Done when checks: For fixture (a) `.pipeline/gates/prd_audit.json` reason contains `NC.1 (OVER_SCOPE) [awaiting-decision]` and `ai-conductor halt clear`, and contains neither `[missing-relation]` nor `close the gap (BUILD)`. | For fixture (a) the `gate_verdict` event for `prd_audit` carries a reason string identical to the persisted gate file's reason. | For fixture (b) the persisted prd_audit reason does not list NC.1 as blocking. | Fixture (c) reason contains `[uncertain-relation]`; fixture (d) reason contains `[corrupt-decision-store]` with `satisfied: false`; fixture (e) reason contains `close the gap (BUILD) or amend the PRD (DECIDE)`.
Missing assertion: NC.1's relation `uncertain` or `different`

Criterion: Story 7 negative: Given a prd_audit lap with a FIXABLE criterion and no OVER_SCOPE finding, when the gate verdict is persisted, then its reason is the existing `close the gap (BUILD) or amend the PRD (DECIDE)` text
Task ids: 11
Done when checks: For fixture (a) `.pipeline/gates/prd_audit.json` reason contains `NC.1 (OVER_SCOPE) [awaiting-decision]` and `ai-conductor halt clear`, and contains neither `[missing-relation]` nor `close the gap (BUILD)`. | For fixture (a) the `gate_verdict` event for `prd_audit` carries a reason string identical to the persisted gate file's reason. | For fixture (b) the persisted prd_audit reason does not list NC.1 as blocking. | Fixture (c) reason contains `[uncertain-relation]`; fixture (d) reason contains `[corrupt-decision-store]` with `satisfied: false`; fixture (e) reason contains `close the gap (BUILD) or amend the PRD (DECIDE)`.
Missing assertion: Given a prd_audit lap with a FIXABLE criterion and no OVER_SCOPE finding
```
