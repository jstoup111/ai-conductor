# Complexity: writing-system-tests FR→acceptance-spec coverage gate

Tier: S

## Rationale

- Single-skill Markdown change: `skills/writing-system-tests/SKILL.md` plus README/CHANGELOG
  documentation. No TypeScript/engine code, no new gate wiring in the conductor.
- No models, no external integrations, no auth, no state machines.
- The gate is skill-self-enforced (consistent with the harness convention of fixing behavior
  at the skill, not via an engine workaround).
- Small story count (~3): coverage-table emission, gate-on-unresolved-FR, disposition rules /
  product-track-only scoping.

Per tier rules, architecture-diagram, architecture-review, and conflict-check are skipped.
