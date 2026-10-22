# Complexity: Remediation tasks close on a reported commit that never implemented them (#3190)

Tier: M

## Rationale

- **New judgement seam, existing pattern.** Adds one auxiliary, schema-constrained judgement
  ("does this remediation finding still hold at HEAD?") modeled on the shipped
  `rebase-regrade-judgement.ts`: injected provider boundary, closed result schema, fail-closed
  handling, a verdict event on the event spine. No new provider path or layer.
- **Several coupled engine seams.** The BUILD hand-off boundary in `conductor.ts`, the
  task-status reopen path for engine-appended `rem-*` tasks, a retry bound per task, a new
  `ConductorEvent` variant, and the shipped judgement skill that carries the policy and result
  contract. Cross-file agreement between those seams needs an ADR and a diagram.
- **Not Large.** No new module boundary beyond one judgement module, no persisted-format
  migration, no CLI/hook/settings change; scope is confined to `rem-*` tasks (track scope
  boundary), with ordinary tasks and `[test]` verification unchanged.

Ceremony for Tier M: track, architecture diagram, lightweight architecture review (ADR approved),
stories, conflict-check, plan, coherence-check, plan-review; no PRD (technical track).
