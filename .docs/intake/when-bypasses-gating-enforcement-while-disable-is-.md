# Intake origin: when-bypasses-gating-enforcement-while-disable-is-

Source-Ref: jstoup111/ai-conductor#1777
Owner: jstoup111

## Desired outcome

- A `when:`-driven skip of a step whose enforcement level disallows `disable:` is rejected or surfaced with the same rigor as `disable:` — a gating step can no longer be silently skipped via a deterministically-false `when:` expression.
- When a gating or structural step is skipped via `when:` under any allowed configuration, the skip is visibly rendered in the run log rather than suppressed.
- Negative path: legitimately conditional steps (`configDisableAllowed` steps, and steps whose enforcement permits skipping) keep working `when:` behavior unchanged.
