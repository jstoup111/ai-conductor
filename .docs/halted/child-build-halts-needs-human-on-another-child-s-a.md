# Halt record

Status: halted
Slug: child-build-halts-needs-human-on-another-child-s-a
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-child-build-halts-needs-human-on-another-child-s-a
Head SHA: 3428aca6da4e9b0e4460aae64186a89d98621275
Halted at: 2026-11-21T22:05:45.600Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-3428aca6da4e9b0e4460aae64186a89d98621275: implementationQuality closed cause malformed-artifact (invalid-provider-result: build_review grader invocation ended without a result.).
1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-3428aca6da4e9b0e4460aae64186a89d98621275 --rubric implementationQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
