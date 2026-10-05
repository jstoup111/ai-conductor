# Halt record

Status: halted
Slug: new-review-concern-at-a-resolved-anchor-halts-as-m
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-new-review-concern-at-a-resolved-anchor-halts-as-m
Head SHA: bb7c429e88b66026d43c4e81ac89d130fad0760a
Halted at: 2026-10-05T10:12:57.911Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-bb7c429e88b66026d43c4e81ac89d130fad0760a: testQuality closed cause malformed-artifact (invalid-provider-result: build_review grader invocation ended without a result.).
1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-bb7c429e88b66026d43c4e81ac89d130fad0760a --rubric testQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
