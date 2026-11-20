# Track: Repair host merged a higher child into its branch; no guard refused it

Track: technical

Scope boundary: a shared stack-containment check that stops a lower stack child's branch from gaining commits unique to a higher child. It covers merges, fast-forwards, resets, `update-ref`, and range cherry-picks, which it detects by patch-id. Moves the engine originates, the `#3653` fold and the restack replay, are exempt. The check is enforced at three layers:

1. the git wrapper refuses before anything mutates;
2. `reference-transaction` is the backstop for every ref move;
3. the routed host gates (`test_suite`, `build_review`, routed exit) halt and name the cause.

Excluded:

- Routing changes. Outcome 2 relies on `#3653`'s leaf execution for audit rounds.
- Fixes to prerequisite-claim ergonomics, which stay with `#3674`.

This spec is blocked by `#3653`.

Internal engine guard machinery with no user-facing product requirements; acceptance criteria live in stories. The operator confirmed this on 2026-11-15. Source: jstoup111/ai-conductor#3676.

Chosen approach: B, one shared containment predicate enforced at three layers. The alternatives were rejected for these reasons:

- **A, the filer's pre-commit-only guard.** Pre-commit never fires on a fast-forward merge, a reset, `update-ref`, or a cherry-pick.
- **C, gate-only detection with an automatic revert.** It wastes the build effort spent before the gate, and it does not refuse at commit time.

A veto in the `reference-transaction` `prepared` stage has been verified on git 2.53: it refuses a fast-forward merge and `reset --keep`. However, it fires after the index and worktree have already been updated. That is why the wrapper refuses first.
