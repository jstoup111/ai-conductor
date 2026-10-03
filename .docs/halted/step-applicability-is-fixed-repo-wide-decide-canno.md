# Halt record

Status: halted
Slug: step-applicability-is-fixed-repo-wide-decide-canno
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-step-applicability-is-fixed-repo-wide-decide-canno
Head SHA: 33b4df13e936923c8b0c75e16ab7dcb5e64cd9b7
Halted at: 2026-10-03T20:17:30.713Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 5 happy: Given an enabled repository and an idea worktree with no applicability marker, when the spec is landed, then land behaves exactly as before.
Task ids: 4
Done when checks: `landSpec` succeeds for an enabled project whose idea worktree carries a marker declaring `manual_test` inapplicable with a non-empty reason, and the resulting land commit includes the marker file, as asserted in `test/engine/engineer/land-spec-applicability.test.ts`. | `landSpec` for an enabled project whose idea worktree has no applicability marker succeeds with the same committed file list it produces when the capability is disabled. | `validateApplicability` in `engine/feature-applicability.ts` returns ok with the parsed declarations for a valid marker and is the only validator imported by both `landSpec` and the daemon backlog.
Missing assertion: then land behaves exactly as before.
```
