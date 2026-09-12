# Halt record

Status: halted
Slug: projects-cannot-add-portable-non-competing-build-r
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-projects-cannot-add-portable-non-competing-build-r
Head SHA: 9ca6daa2c7d9691bca629e88983129637dd8ae44
Halted at: 2026-09-12T03:21:27.604Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-9ca6daa2c7d9691bca629e88983129637dd8ae44: testQuality closed cause malformed-artifact (invalid-provider-result).
1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-9ca6daa2c7d9691bca629e88983129637dd8ae44 --rubric testQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
