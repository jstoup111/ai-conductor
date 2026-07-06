# Conflict Check: manual-test-fail-routing

**Date:** 2026-07-06
**Stories checked:** .docs/stories/manual-test-fail-routing.md (Stories 1–7)
**Result:** No blocking conflicts. One degrading conflict with mitigation; two textual-only
merge risks noted.

## Degrading conflict — shared kickback→build hazard with #302 (OPEN)

Issue #302: a prd_audit→build kickback can wipe/desync `.pipeline/task-status.json`,
producing a build HALT loop. Our Story 3 adds a second kickback route into build through the
same `navigateBack` + restage machinery, so it inherits whatever produces that wipe until
#302's engine-owned task-status fix (spec PR #349, not yet built) lands.

**Mitigations (folded into the plan):**
- Story 3 gains an explicit scenario: the manual_test→build kickback itself must not clobber
  `.pipeline/task-status.json`, and the re-entered build must be able to complete (the
  existing `attemptAutoHeal` git-log reconciliation at the build gate is the current
  backstop — the acceptance spec asserts the loop converges rather than HALT-looping).
- Tests assert behavior (build re-runs, loop converges), not task-status file internals, so
  #302's engine-owned rewrite won't invalidate them.
- No hard sequencing dependency: this feature does not wait for #302, but if #302 builds
  first, nothing here changes.

## Textual merge risks (no semantic conflict)

- `make-daemon-build-push-pr-timing-…` (in-flight, currently rebase-parked): touches
  `conductor.ts` in the finish/push-timing region, not the failure-routing block. Merge-time
  textual conflict possible; resolve by region.
- Spec branches re-based by the daemon (standard drift risk): this branch bases on
  origin/main @ 022f156a which already includes #365 (verified ancestor), the strongest
  coupling this change had.

## Checked and clean

- #324 (build_review judgement gate): operator-decided independent; this change adds no step
  and leaves the build→manual_test seam free for it.
- State-machine overlap: the fail-evidence marker is a new gitignored `.pipeline/` file; no
  other component reads or writes that path (grep: zero references).
- Resource contention: no shared config keys, no settings.json/hook changes, no new skill
  symlinks.
