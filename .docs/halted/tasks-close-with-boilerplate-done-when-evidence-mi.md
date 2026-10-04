# Halt record

Status: halted
Slug: tasks-close-with-boilerplate-done-when-evidence-mi
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-tasks-close-with-boilerplate-done-when-evidence-mi
Head SHA: 22f60d5f52c8f6af117c03904793204f638b6882
Halted at: 2026-10-04T01:09:16.017Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 4 negative: Given a verify-only task with a tagged check, when `conduct task done` closes the task with no evidence for that check, then the close is refused naming the check, while its untagged checks still close by the prove-closed path.
Task ids: 6
Done when checks: On a `Verify-only: yes` task, `conduct task done --unverified 1=<reason>` for its tagged check completes the task and records that check with source `unverified`, as asserted by the verify-only unverified test. | On a `Verify-only: yes` task, `conduct task done` with no evidence for its tagged check exits non-zero naming the check and leaves the task not completed, as asserted by the verify-only refusal test. | On a `Verify-only: yes` task whose tagged check is closed with a verified reference, its untagged check is recorded with source `verify-only` without supplied evidence, as asserted by the verify-only prove-closed test.
Missing assertion: while its untagged checks still close by the prove-closed path.
```
