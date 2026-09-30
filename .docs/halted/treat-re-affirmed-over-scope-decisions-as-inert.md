# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-30T10:49:33.816Z
Slug: treat-re-affirmed-over-scope-decisions-as-inert
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-treat-re-affirmed-over-scope-decisions-as-inert
Head SHA: 184ad4b3069ccc774a6bed6da1ec5e1fb018c956
Halted at: 2026-09-30T02:07:04.310Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 2 happy: Given the decision store rejects a cleared entry as invalid-decision, when PRD entry prepares the audit, then the halt reason is invalid-decision, it names the entry's offer id, and its recovery text tells the operator to correct the entry or leave it pending to keep the prior decision.
Task ids: 2, 4
Done when checks: Capture maps a store invalid-decision result to an invalid-decision defect with the offer entry id. | Capture still maps lock, lease, and atomic-replace append failures to write-failed, and PRD entry then halts with reason persistence-failed naming the entry. | The invalid-decision recovery text mentions pending and contains neither store failure nor lease failure wording, and tells the operator to correct the entry or leave it pending to keep the prior decision. | A refuse reaffirmation at PRD entry returns no halt text and leaves the decision inventory unchanged. | A stale same-authority revision at PRD entry returns invalid-decision naming the offer id and never persistence-failed. | The rejection event for the stale revision carries reason invalid-decision and never write-failed.
Missing assertion: No cited check explicitly requires a cleared invalid-decision entry at PRD entry to halt with reason invalid-decision.

Criterion: Story 2 negative: Given the decision store rejects a cleared entry as invalid-decision, when capture records the defect, then the rejection event reason is invalid-decision and never write-failed.
Task ids: 2, 4
Done when checks: Capture maps a store invalid-decision result to an invalid-decision defect with the offer entry id. | Capture still maps lock, lease, and atomic-replace append failures to write-failed, and PRD entry then halts with reason persistence-failed naming the entry. | The invalid-decision recovery text mentions pending and contains neither store failure nor lease failure wording, and tells the operator to correct the entry or leave it pending to keep the prior decision. | A refuse reaffirmation at PRD entry returns no halt text and leaves the decision inventory unchanged. | A stale same-authority revision at PRD entry returns invalid-decision naming the offer id and never persistence-failed. | The rejection event for the stale revision carries reason invalid-decision and never write-failed.
Missing assertion: No cited check explicitly requires the rejection event for a cleared invalid-decision entry to carry reason invalid-decision and never write-failed.
```
