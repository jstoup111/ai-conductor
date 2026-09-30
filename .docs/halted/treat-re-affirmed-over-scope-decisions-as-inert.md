# Halt record

Status: halted
Slug: treat-re-affirmed-over-scope-decisions-as-inert
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-treat-re-affirmed-over-scope-decisions-as-inert
Head SHA: bac9a1e5448148ef1d2e16d5e758059ea2d1c92e
Halted at: 2026-09-30T00:52:41.368Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 2 happy: Given the decision store rejects a cleared entry as invalid-decision, when PRD entry prepares the audit, then the halt reason is invalid-decision, it names the entry's offer id, and its recovery text tells the operator to correct the entry or leave it pending to keep the prior decision.
Task ids: 2, 4
Done when checks: Capture maps a store invalid-decision result to an invalid-decision defect with the offer entry id. | Capture still maps lock, lease, and atomic-replace append failures to write-failed. | The invalid-decision recovery text mentions pending and contains neither store failure nor lease failure wording. | A refuse reaffirmation at PRD entry returns no halt text and leaves the decision inventory unchanged. | A stale same-authority revision at PRD entry returns invalid-decision naming the offer id and never persistence-failed. | The rejection event for the stale revision carries reason invalid-decision and never write-failed.
Missing assertion: The cited checks do not require recovery text to tell the operator to correct the entry.

Criterion: Story 2 negative: Given the decision store fails an append with a lock, lease, or atomic-replace failure, when PRD entry prepares the audit, then the halt reason remains persistence-failed naming the entry.
Task ids: 2
Done when checks: Capture maps a store invalid-decision result to an invalid-decision defect with the offer entry id. | Capture still maps lock, lease, and atomic-replace append failures to write-failed. | The invalid-decision recovery text mentions pending and contains neither store failure nor lease failure wording.
Missing assertion: The cited checks require write-failed mapping, but do not explicitly require a persistence-failed halt naming the entry.
```
