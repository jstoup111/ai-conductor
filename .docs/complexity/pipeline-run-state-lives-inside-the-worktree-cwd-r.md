# Complexity: pipeline-run-state-lives-inside-the-worktree-cwd-r

Tier: L

## Rationale

Large — this is a cross-cutting run-state storage relocation, not a localized fix.

Signals driving the tier:

- **Broad blast radius.** Run-state persistence is scattered across ~15 source
  modules (`state.ts`, `gate-verdicts.ts`, `halt-marker.ts`, `task-evidence.ts`,
  `session.ts`, `step-runners.ts`, `task-cli.ts`, `autoheal.ts`, `rebase-translate.ts`,
  `conductor.ts`, `daemon-cli.ts`, `resume.ts`, `auto-resume.ts`, `finish-record-cli.ts`,
  `daemon-dashboard.ts`). Each addresses `.pipeline/*` inline via `join(root, '.pipeline')`.
- **New shared abstraction.** Introduces a canonical feature-identity → run-state-dir
  resolver plus a canonical `~/.ai-conductor` base-path helper (none exists today; ~10
  modules duplicate the join).
- **Stateful lifecycle + durability contract.** An outward-symlink pattern with
  write-through-the-store semantics (mirroring `recordMemoryEntry`), plus create/reuse/
  cleanup of a per-feature store directory.
- **Migration.** Existing in-worktree `.pipeline/` state for in-flight builds must be
  relocated without loss.
- **Exec-time cwd coupling.** The generated session-hook scripts embed literal
  `join(process.cwd(), ".pipeline")` and must be reworked to resolve by feature identity.
- **Negative-path concurrency.** Two concurrent features must never collide on state;
  end-of-feature cleanup must remove exactly one feature's state.

Expected story count is high (resolver, project-key namespacing, symlink + durability,
hook-script relocation, migration, cleanup/concurrency isolation), well beyond the Small
threshold. Full architecture-diagram, architecture-review, conflict-check, and plan apply.
