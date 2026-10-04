# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-04T00:59:59.470Z
Slug: step-applicability-is-fixed-repo-wide-decide-canno
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-step-applicability-is-fixed-repo-wide-decide-canno
Head SHA: 985e88ce9dcff07f1f5be77b0418465f498f17f8
Halted at: 2026-10-03T22:57:29.170Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 5 happy: Given an enabled repository and an idea worktree whose applicability marker declares manual_test inapplicable with a non-empty reason, when the spec is landed, then land succeeds and the marker is committed with the other DECIDE artifacts.
Task ids: 4
Done when checks: `landSpec` succeeds for an enabled project whose idea worktree carries a marker declaring `manual_test` inapplicable with a non-empty reason, and the resulting land commit includes the marker file, as asserted in `test/engine/engineer/land-spec-applicability.test.ts`. | `landSpec` for an enabled project whose idea worktree has no applicability marker succeeds with the same committed file list it produces when the capability is disabled, so markerless land behaves exactly as before this feature, as asserted in `land-spec-applicability.test.ts`. | `validateApplicability` in `engine/feature-applicability.ts` returns ok with the parsed declarations for a valid marker and is the only validator imported by both `landSpec` and the daemon backlog.
Missing assertion: "the marker is committed with the other DECIDE artifacts"
```
