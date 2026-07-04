# Complexity: auto-resolve-open-pr-conflicts

Tier: M

## Rationale

- **Models/schema:** none — extends the existing `.daemon/mergeable-watch.jsonl`
  registry entries (attempt count / cooldown fields), no new stores.
- **Integrations:** none new — reuses the existing `gh` runner, git runner,
  worktree helpers, `resolveRebaseConflicts` loop, and gated `/rebase` skill
  dispatch already present in the engine.
- **State machine:** moderate — per-PR lifecycle (conflicting → deterministic
  resolve → skill resolve → verify → lease-push | escalate to
  needs-remediation) with bounded attempts and per-PR cooldown.
- **Risk surface:** force-pushes real open PR branches; mitigated by
  FR-8/FR-9 acceptance guards, full-suite verification, --force-with-lease,
  and abort-on-failure leaving branches untouched.
- **Estimated stories:** 6–10.

Medium ⇒ architecture-diagram required, lightweight architecture-review,
conflict-check required.
