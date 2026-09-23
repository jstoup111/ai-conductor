# Halt record

Status: halted
Slug: build-review-rubric-findings-arrive-as-typed-struc
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-build-review-rubric-findings-arrive-as-typed-struc
Head SHA: 04f6922e143f0e65eede26bf6eb592a34ab1106b
Halted at: 2026-09-23T04:44:16.210Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: needs human DECIDE — AB-1 (architectural-clarity: Third lap on the same substance (kickback count 2, both prior laps bound AB-1 to existing-task 4/11 with the exact unify-the-coordinator task, and neither build delivered it): step-runners.ts:2316-2348 still filters entry.kind === 'custom' into dispatchInstalledBuildReviewPolicy before coordinateBuildReviewRubrics (2358-2385), and BUILD_REVIEW_CUSTOM_V1_CONTRACT.projection.build (build-review-policy-resolver.ts:20-26) has no caller because the coordinator's projection loop (build-review-coordinator.ts:630-634) is closed over the built-in BUILD_REVIEW_RUBRICS ids. The sealed plan and APPROVED adr-2026-08-13 D1.2 disagree about what 'one generic dispatch path' means: plan Task 3 Step 3 makes the custom projection 'the frozen-input view already built' and Task 4 defines the shared seam as dispatchRubricContract (all four Task 4 Done-when bullets are met at step-runners.ts:737-755), while the as-built reading of D1.2 requires coordinator-owned projection, stamping, identity, and settlement with no member-kind branch. Closing it means either (a) reworking the coordinator to be open over custom member ids (its projection, cache, artifact, and settlement types are built-in-keyed), work no Done-when requires and that two autonomous laps have not produced, or (b) a human-approved D1.2 clarification/superseding ADR accepting the shared dispatchRubricContract seam, plus updating the component and sequence diagrams (which also carry the stale event id build_review_rubric_mechanical_fault for build_review_rubric_infrastructure_failure). The gate itself states it cannot downgrade D1.2 silently and that a superseding ADR needs human approval, so a third existing-task kickback would only cycle; a human must pick (a) or (b). Confidence the gap is an architecture decision rather than plain drift: 75%, inferred from the plan/ADR text and two unproductive laps.)
```
