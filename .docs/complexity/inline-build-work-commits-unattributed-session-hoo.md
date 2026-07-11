# Complexity: inline-build-work-commits-unattributed-session-hoo

Tier: M

## Rationale

- Three enforcement surfaces, each an extension of an existing seam rather than new
  architecture: (1) fail-closed branch in the worktree `commit-msg` git hook
  (`git-hook-assets.ts`), (2) new session PreToolUse matcher on file-mutation tools
  (`session-hook-assets.ts` + `worktree-prepare.ts` wiring), (3) session-end /
  build-step-end zero-work-product net (engine side).
- One config cutover flag following the established `owner_gate_cutover` precedent
  (`config.ts`) — additive schema, known validation pattern.
- Rich negative-path matrix (merge commits, amend/rebase, `Task: none`, empty+Evidence,
  /rebase conflict resolution, non-pipeline steps) that must not regress — drives story
  count up and demands adversarial specs.
- No new models, integrations, auth, or persistent state machines; no product surface.
- Not Small: multiple coordinated surfaces + a breaking-adjacent hook-wiring change
  warrant architecture-diagram, lightweight architecture-review, and conflict-check.
- Not Large: no cross-system integration, no schema/data migration, bounded blast radius
  (build worktrees only), all primitives already exist.
