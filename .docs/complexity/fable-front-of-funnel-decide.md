# Complexity: Adopt Fable for front-of-funnel DECIDE steps

Tier: S

## Rationale

Declarative model-policy flip with no new mechanisms:

- 5 model-string edits in one constants file (`src/conductor/src/engine/resolved-config.ts`:
  `explore`, `prd`, `architecture_review` defaults + `plan.L` and `conflict_check.L` tier
  overrides). Efforts unchanged.
- 4 SKILL.md frontmatter pins (flip explore/prd/architecture-review; **add** to engineer,
  which had none).
- 1 HARNESS.md model-table sync (rows + rationale).
- CHANGELOG + docs upkeep.

No new models of computation, integrations, auth, state machines, or schema changes.
Validation is the existing `test/test_harness_integrity.sh` suite plus the conductor unit
suite. Story count small (2–3). Degradation on fable-unavailability is out of scope
(deferred to #186's fallback ladder).

Operator confirmed Tier S on 2026-07-02 (skips architecture-diagram, architecture-review,
conflict-check; technical track also skips /prd).
