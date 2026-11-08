# Halt record

Status: halted
Slug: code-formatting-is-entirely-unenforced-no-formatte
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-code-formatting-is-entirely-unenforced-no-formatte
Head SHA: 0a491dc8e049b8c29124df5cf59bc9f6f2ac86d8
Halted at: 2026-11-08T10:33:33.401Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-0a491dc8e049b8c29124df5cf59bc9f6f2ac86d8: testQuality closed cause malformed-artifact (invalid-provider-result: build_review grader invocation ended without a result. claude subprocess exited without a classifiable result: exitCode=1 stdoutBytes=8966 stderrBytes=0).
1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-0a491dc8e049b8c29124df5cf59bc9f6f2ac86d8 --rubric testQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
