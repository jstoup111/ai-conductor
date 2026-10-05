# Complexity: coherence-check-l-tier-model-escalation-is-documen

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None |
| Story count | ~1 (L-tier coherence_check dispatch escalates model on both providers) |
| Files touched | `src/conductor/src/engine/provider-model-policy-defaults.ts`, its test, `skills/coherence-check/SKILL.md` |
| New runtime code | One declarative tier-override entry per provider policy |

## Rationale

A data-only addition that mirrors the existing `conflict_check` L-tier pin, plus a doc sentence
correction. No new behavior shape, no cross-module design; architecture, conflict, and coherence
passes are not required at this tier.
