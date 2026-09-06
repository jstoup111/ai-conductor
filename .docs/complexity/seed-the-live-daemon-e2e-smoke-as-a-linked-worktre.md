# Complexity: Seed the live daemon E2E smoke as a linked worktree

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is confined to three existing test files: the shared live-provider run body, its unit-test sibling, and the structural guard over that body. No production source file changes; no engine behavior, CLI surface, settings schema, hook wiring, or skill symlink target is touched, so no migration block or waiver applies. The work is one seeding restructure (`mkdtemp` main checkout plus `git worktree add`), one deletion of an injected resolver override, and one terminal-state assertion moved onto the production park-marker reader. It introduces no new module, event, metric, span, or report, so the event-spine decision procedure does not apply. Small-tier architecture, conflict-check, and coherence artifacts are not required.
