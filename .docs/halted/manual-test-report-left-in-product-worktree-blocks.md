# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-11-20T17:44:49.349Z
Slug: manual-test-report-left-in-product-worktree-blocks
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-manual-test-report-left-in-product-worktree-blocks
Head SHA: 38eeeeeaeb67821c5146f4cc56fbdefe761dc3a9
Halted at: 2026-11-20T15:48:54.131Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
build_review mechanical fault allowance exhausted: 3 of 3 shared faults consumed.
Current lap lap-38eeeeeaeb67821c5146f4cc56fbdefe761dc3a9: testQuality closed cause malformed-artifact (invalid-provider-result: build_review grader invocation ended without a result. claude subprocess exited without a classifiable result: exitCode=1 stdoutBytes=9170 stderrBytes=0).
1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --lap lap-38eeeeeaeb67821c5146f4cc56fbdefe761dc3a9 --rubric testQuality --rationale "<rationale>".
2. Clear the documented terminal state: rm -f .pipeline/HALT .pipeline/HALT.class.
```
