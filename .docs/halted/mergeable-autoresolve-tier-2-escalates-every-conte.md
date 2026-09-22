# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-22T11:31:19.551Z
Slug: mergeable-autoresolve-tier-2-escalates-every-conte
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-mergeable-autoresolve-tier-2-escalates-every-conte
Head SHA: 973888bfcb15b9f8bcb72c642a63d9da71027d77
Halted at: 2026-09-22T11:14:40.709Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-973888bfcb15b9f8bcb72c642a63d9da71027d77: testQuality closed cause malformed-artifact (invalid-provider-result).
1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-973888bfcb15b9f8bcb72c642a63d9da71027d77 --rubric testQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
