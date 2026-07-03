# Complexity: finish force-with-lease after sanctioned rebase

Tier: S

## Rationale

- Scope: prose edits to two skill files (`skills/finish/SKILL.md`, `skills/pr/SKILL.md`)
  plus docs/CHANGELOG — no TypeScript code, no new models, no integrations, no auth,
  no state machines.
- Expected story count: 2–3 (diverged-branch push rule, never-pull prohibition,
  lease-failure halt path).
- No schema, hook-wiring, or CLI changes → no migration block needed; PATCH-level semver.
