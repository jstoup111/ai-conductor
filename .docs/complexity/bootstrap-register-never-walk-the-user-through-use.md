# Complexity: Guided bootstrap setup for user and project config

Tier: M

## Rationale

Medium. The change spans four surfaces but breaks no existing contract:

- `skills/bootstrap/SKILL.md` Step 1b-i grows from two questions into a guided interview over
  every decidable project-config key, each with an explanation, allowed values, default, and
  consequence.
- The deterministic project-config writer (`runConfigInit`, `src/conductor/src/engine/registry-cli.ts`)
  must accept operator-chosen values for keys it cannot express today — notably the test-suite
  command, which is currently hardcoded to `npm test` in `renderVerificationBlock` regardless of
  the project's stack.
- A user-config write path for `spec_owner`, which no CLI can set today
  (`userConfigSetCommand` rejects every path outside `conductor.*`).
- `templates/project-config.yml.template` gains in-place explanations for the keys the interview
  does not ask about.

Not Small: it adds CLI surface, touches user-scoped state governed by a fail-closed identity ADR
(adr-2026-07-01-machine-scoped-operator-identity D1-D3), and needs an architecture decision about
where interview answers are persisted. Not Large: no new subsystem, no schema migration, no
cross-component protocol, and the existing skill-asks/engine-writes split already carries the shape.
