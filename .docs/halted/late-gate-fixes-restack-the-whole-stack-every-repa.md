# Halt record

Status: halted
Slug: late-gate-fixes-restack-the-whole-stack-every-repa
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-late-gate-fixes-restack-the-whole-stack-every-repa
Head SHA: f5b7b714773d5e3ae91ad0b375ce204651f5c002
Halted at: 2026-11-14T06:59:40.675Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-f5b7b714773d5e3ae91ad0b375ce204651f5c002: implementationQuality closed cause malformed-artifact (invalid-provider-result: build_review grader invocation ended without a result.).
1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-f5b7b714773d5e3ae91ad0b375ce204651f5c002 --rubric implementationQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
