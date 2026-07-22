# Complexity: idea-scoped land artifact resolution

Tier: S

## Rationale

- Single module touched: `src/conductor/src/engine/engineer/land-spec.ts`
  (artifact resolver) plus its test file. No CLI surface, schema, hook wiring,
  or skill-contract changes.
- No data models, migrations, external integrations, auth, or state machines.
- Deterministic replacement of an mtime-based picker with a git-attribution
  set (`base...HEAD` diff + untracked); expected story count 3–5.
- Operator-confirmed Tier S in the 2026-07-22 engineer session
  (intake jstoup111/ai-conductor#488).
