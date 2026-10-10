# Intake origin: build-loop-cannot-complete-a-feature-child-by-chil

Source-Ref: jstoup111/ai-conductor#2942
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2942 digest=048d5c09c9521fb6b5841556c6ca21d28068b5d0b9c44c1d920463b5425a6ea2 >>>
## Desired outcome

- **Ordered children.** With `stacked_prs.enabled` on and a signed-off sliced plan, the build completes children strictly in declared order. No task of child k+1 starts until child k's acceptance specs, tasks, `test_suite` and (if enabled) `build_review` have all passed.
- **Acceptance specs per child.** Each child's specs cover only the stories that child owns, so every child's tree can be green on its own. A later child never invalidates an earlier child's acceptance completion.
- **Child-local review.** `build_review` for child k grades only child k's changes against its parent's tip, bound to child k's tasks, stories and Done-when criteria.
- **Commits stay in their child.** A commit carrying a task id that belongs to a different child than the checked-out branch is rejected.
- **Safe switching.** Switching between children never carries uncommitted work across, and a dirty tree refuses the switch.
- **Per-child limits.** Lap caps, including the `build_review` cumulative cap, plus stall detection and the repeated-selection guard, apply per child. Exhausting one in child k halts with child k named.
- **Survives restarts.** The active child survives daemon restarts, worktree recreation and resume. A restart never re-runs a closed child and never skips an open one.
- **Observable transitions.** Child started, child closed and child switched are observable on the event spine (`ConductorEvent` → `.pipeline/events.jsonl`), not in a side file.
- **The flag has a real consumer** (`stacked_prs.enabled`).
- **Flag off, or no slices:** the build loop behaves exactly as today.
<<< END INBOUND >>>
