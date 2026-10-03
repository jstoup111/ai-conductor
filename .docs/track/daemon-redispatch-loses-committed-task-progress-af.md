# Track: Daemon redispatch loses committed task progress after abrupt death

Track: technical

Scope boundary: minimal — (1) restore a single missing task-status row as completed from its reachable `Task:` trailer on any re-seed (additive only: existing rows, including deliberately reverted `pending` rows, are never upgraded); (2) reset stale `in_progress` rows to `pending` only at the pre-BUILD dispatch seed boundary; (3) restore the original #2673 acceptance assertions in `daemon-death-resume.acceptance.test.ts`. Excluded: in_progress-with-trailer → completed, clearing `.pipeline/current-task`, moving task progress out of the worktree, and the #2261 completion-authority consolidation.

Internal engine recovery behavior in `task-seed.ts` with no user-facing surface, so no PRD.
