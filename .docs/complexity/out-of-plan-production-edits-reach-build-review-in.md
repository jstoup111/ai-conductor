# Complexity: Out-of-plan production edits reach build_review instead of being refused at commit

Tier: M

## Rationale

**Signals present**

- **Multi-module surface (6+).** `plan-scope-containment.ts` (floor/adjacency rules),
  `scope-check-cli.ts` (exit-code split, rationale fallback), `per-task-commit-floor.ts`
  (widening harvest), `git-hook-assets.ts` (generated `commit-msg` hook text),
  `resolved-config.ts` / `config.yml` (enforcement opt-in), plus `docs/reference/configuration.md`
  and `docs/explanation/gates.md`.
- **Telemetry schema change.** Desired outcome 4 requires an unresolvable containment check to be
  visible in the build record, which means a new `ConductorEvent` union member routed through
  `EventPersister`. Schema changes to the event spine are cross-cutting by construction.
- **Generated-asset change.** The `commit-msg` hook is emitted text installed into consumer
  worktrees; changing it has an install/refresh dimension beyond editing a module.
- **Concurrency risk is real, not hypothetical.** Four features are currently kicked back on
  `build_review` scope and two remain stuck; several in-flight worktrees touch `build_review`
  and scope machinery. Conflict-check earns its place here.

**Signals absent**

- No data models, no persistence schema, no migrations.
- No third-party integrations, no auth, no network surface.
- No state machine; the containment evaluator stays a pure function.
- Estimated 4–6 stories — well short of Large.

**Not S** — an S tier would skip conflict-check and architecture entirely, which is wrong for a
change that alters a shared evaluator, a generated hook, and the event union while sibling
features are mid-flight on the same surface.

**Not L** — no new subsystem, no cross-repo contract, no migration, and the blast radius is
deliberately fenced by keeping the consumer default at report-only.

## Tier consequences

Medium requires, and this spec will carry:

- `.docs/architecture/` — architecture diagram
- `.docs/decisions/` — lightweight architecture review + ADRs (all APPROVED before land)
- `.docs/conflicts/` — conflict-check against in-flight scope/build_review work
- `.docs/coherence/` — committed traceability mapping
