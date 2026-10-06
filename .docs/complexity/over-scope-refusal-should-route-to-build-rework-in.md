# Complexity: over-scope-refusal-should-route-to-build-rework-in

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None new. Adds a refusal-evidence variant to the existing `planRemediation` evidence input |
| External integrations | None |
| Auth / permission surface | None |
| State machines | Changes the SHIP prd_audit routing branch: a refused finding moves from HALT to the remediation kickback, bounded by the existing lap cap |
| Story count | ~4–6 (refuse→remediate, lap-cap halt, mixed pending+refused halts, accept unchanged, serial and group-join parity) |
| Files touched | `conductor.ts` (route + both SHIP call sites + planRemediation evidence), remediation dispatch context, the `/remediate` skill evidence contract, ADR amendment |
| New runtime code | Moderate: a route variant, evidence plumbing and tests |

## Rationale

The change crosses decided architecture (adr-2026-08-24 D6 needs an additive amendment), and
it touches two SHIP execution shapes (serial tail and validation-group join) that have to stay
in parity. It also hands new evidence to the `/remediate` planner contract. It reuses existing
machinery (planRemediation, `rem-prd-audit-*` append, `max_remediation_laps`) and adds no new
stores or integrations, so it is not Large. → **Medium**: architecture-diagram, a lightweight
architecture-review, conflict-check and coherence-check apply.
