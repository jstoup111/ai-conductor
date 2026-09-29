# Track: Automatic rebase preserves merges carrying unique content

Track: technical

Scope boundary: Balanced — a pre-rebase, read-only merge audit on every engine-started feature rebase (`performRebase` and the open-PR autoresolve path, through one shared primitive — operator-confirmed 2026-09-29 to avoid duplicated replay logic): topology-only merges linearize as today; merges whose result carries unique content (non-empty remerge delta) are replayed as explicit merge-delta commits; commits patch-identical to one already in the replay list are skipped; when a delta cannot be replayed cleanly the rebase halts before modifying the worktree, naming the merge sha and delta paths with a deterministic recovery recipe. Excluded: changing the recovery skills/runbooks that produce such merges, sweeping existing branches, and merge-topology-preserving (`--rebase-merges`) replay.

Internal engine rebase behavior (src/conductor/src/engine/rebase.ts); no user-facing product requirements, so acceptance criteria live in stories.
