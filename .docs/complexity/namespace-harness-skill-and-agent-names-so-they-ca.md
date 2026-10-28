# Complexity: Namespace harness skill names with an install-time `ac-` prefix

Tier: M

## Rationale

One coherent naming change applied through existing choke points — no new subsystem, data model,
or external integration:

- `src/conductor/src/engine/skill-invocation.ts` step→skill dispatch plus ~30 direct engine
  skill-name sites (`steps.ts`, `build-review-registry.ts`, `engine-cli.ts`, `monitor/session.ts`,
  `project-prelude.ts`, `worktree-prepare.ts` operator-only overrides, Pi prompt parsing).
- `bin/install` link naming, one-release bare-name aliases, obsolete-link reconcile, and new
  collision detection, across Claude (`~/.claude/skills`) and Codex/Pi (`~/.agents/skills`).
- `test/test_harness_integrity.sh` cross-reference checks, model-table generation, and ~570 prose
  `/name` references.

Classified **Medium** rather than Small because it is cross-provider, changes a consumer-facing
breaking surface (skill symlink targets → migration block required), and a defect breaks every
skill invocation on every consumer install. Not Large: the work is mechanical rename plus bounded
install/integrity machinery; source directories are not renamed (no directory deletion, no
two-feature split). Intake issue #885 carries `size: M`.

Operator confirmed MEDIUM on 2026-10-14.
