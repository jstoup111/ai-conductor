# Conflict Check: flow-examples (#786)

Date: 2026-07-22
Result: CLEAN (no blocking conflicts)

## Method

Checked the eight stories for contradictions, overlaps, shared-state races, and resource
contention, and cross-checked against existing repo surfaces (`test/`, `bin/`, the engine
CLIs) and the split-out eval issue (#807).

## Findings

- **No contradictions.** Each scenario owns one flow; the headless-vs-guided modes are
  disjoint per flow (only `engineer.sh` carries both, gated by `--interactive`).
- **Shared-state race — checked.** Every scenario runs inside its own `sandbox_up` throwaway
  root with per-run `AI_CONDUCTOR_REGISTRY` / `AI_CONDUCTOR_ENGINEER_DIR`, so two scenarios
  run concurrently cannot collide on registry, engineer store, `.daemon/` lock, `.worktrees/`,
  or `.pipeline/`. No shared mutable path across scenarios. ✅
- **`lib/common.sh` is a shared dependency** of all scripts (Stories 4-8 depend on Story 2).
  This is an ordering constraint, not a conflict — captured in the plan's dependency tree.
- **Teardown vs the repo's no-bulk-delete rule — checked.** `sandbox_down` removes exactly
  the single `mktemp -d` path captured by `sandbox_up`, never a glob or computed set —
  consistent with Daemon Operations Safety rule #1. ✅
- **Overlap with #807 (eval) — intentional, not conflicting.** The headless scripts are
  designed to be reused by the eval runner; #807 depends on this work (`blocked_by #786`).
  No duplication: this spec builds no runner/aggregator.
- **No overlap with `test/`.** Examples live under a new `examples/` dir, drive real
  `conduct-ts`, and must NOT set `AI_CONDUCTOR_NO_REAL_EXEC` (a test-only block) — noted so
  the plan doesn't accidentally import the test setup.

## Conclusion

No blocking conflicts. Proceed to plan. The only ordering constraint is `lib/common.sh`
(Story 2) landing before the per-flow scripts.
