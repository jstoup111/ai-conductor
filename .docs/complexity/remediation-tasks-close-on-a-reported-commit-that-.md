# Complexity: Remediation tasks close on a reported commit that never implemented them (#3190)

Tier: M

## Rationale

- **New judgement seam, existing pattern.** Adds one engine-owned, schema-constrained judgement
  ("is the change this remediation task names present?") at the BUILD boundary the #3200 citation
  judgement already uses: engine-rendered input, native output schema, closed result validation, a
  bounded reopen through a repair obligation, and a verdict event on the event spine. No skill ships
  and no new provider path is added.
- **Several coupled engine seams.** The BUILD session boundary in `conductor.ts`, a step-runner
  port under the `build_review` provider policy, a `remediation-closure` repair obligation source, a
  versioned engine-state verdict section, the stall-detector exemption, and a new `ConductorEvent`
  variant. Cross-file agreement between those seams needs an ADR and a diagram.
- **Not Large.** No new module boundary beyond one judgement module, no persisted-format
  migration, no CLI/hook/settings change; scope is confined to `rem-*` tasks (track scope
  boundary), with ordinary tasks and `[test]` verification unchanged.

Ceremony for Tier M: track, architecture diagram, lightweight architecture review (ADR approved),
stories, conflict-check, plan, coherence-check, plan-review; no PRD (technical track).
