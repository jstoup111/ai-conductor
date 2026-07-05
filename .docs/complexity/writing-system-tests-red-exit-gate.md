# Complexity: writing-system-tests-red-exit-gate

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None |
| Story count | 3 (one skill-contract behavior, happy + negatives) |
| Files touched | 1 prose file (`skills/writing-system-tests/SKILL.md`); optional CHANGELOG + VERSION-independent |
| New runtime code | None — Markdown skill-contract wording only |

## Rationale

This is a single-skill, prose-only contract fix: reframe the existing §6 RED-run + evidence
step as a **hard self-enforced exit gate** and add explicit retry/resumption guidance so a
session that finds committed-but-unexecuted specs is required to execute them. No engine code
changes (per the "fix the skill, not the engine workaround" convention). No new integrations,
models, or auth. → **Small.** Architecture-diagram, architecture-review, and conflict-check are
skipped for this tier.
