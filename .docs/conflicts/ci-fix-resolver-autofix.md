# Conflict Check: ci-fix-resolver-autofix

**Result: PASS (clean)** — no contradictions, overlaps, state conflicts, or resource
contention that block planning.

## Stories checked

CF-1…CF-7 (above).

## Contradiction scan

- CF-1 (dispatch a real fix) vs CF-2 (no-op leaves branch untouched): consistent — CF-2 is the
  no-change branch of the same outcome switch; only `changed` triggers the publish pipeline.
- CF-5 (preflight passes → serve) vs CF-6 (preflight fails → disable): mutually exclusive by
  construction (single probe result), not contradictory.
- CF-4 (classify + surface errors) vs the existing "log-and-swallow at daemon-cli.ts:1486":
  this change **replaces** the swallow with a classified surface — an intended supersession,
  not a live conflict.

## Overlap / duplication scan

- `resolveCiFailure` overlaps `resolveSetupFailure` by design (sibling one-shot dispatch).
  Not duplication to eliminate — deliberate reuse of the same proven mechanism (ADR-0001).
  Risk: prompt/hint divergence; mitigated by keeping the CI hint payload (`buildCiFixHint`)
  as the only CI-specific input.

## State / resource contention

- **Resolver worktree:** unchanged — still created via `withResolveWorktree`; the primary
  checkout is not mutated. No new contention.
- **Lease-protected push:** unchanged; still the only publisher of the refreshed branch, so no
  concurrent-push hazard is introduced.
- **Startup preflight:** additive, runs before the serve loop; a disabled-ci-fix state must be
  read consistently by the sweep dispatch (single flag/config read) — noted for the plan.
- **`AI_CONDUCTOR_NO_REAL_EXEC` kill-switch:** must continue to short-circuit the new dispatch
  path (tests/dry-run) exactly as it did the old spawn — carried as an explicit plan task.

## Cross-feature interactions

- **setup-triage `fixSession`:** shares the StepRunner but a different method
  (`resolveSetupFailure`); no shared mutable state — independent one-shot sessions.
- **mergeable-sweep autoresolve (`daemon-cli.ts:1431`):** the sibling `[autoresolve]` path is
  untouched; only the `[ci-fix]` dispatch body changes.

## Out-of-scope (no conflict because untouched)

- Plan-discovery / task-seed / remediate-planner (the underlying red-CI cause) — CF-7 asserts
  these files are not modified.
