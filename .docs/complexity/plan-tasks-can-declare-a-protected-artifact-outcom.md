# Complexity: Plan tasks can declare a protected-artifact outcome BUILD cannot deliver

Tier: M

## Signals

| Signal | Reading |
| --- | --- |
| Models / persistence | None. No schema, no migration, no new store. |
| Integrations | None. No third-party boundary; the change is in-process. |
| Auth / permissions | None. |
| State machines | None. |
| Story count | 5 — the union, the CLI message, the authoring contract, the ADR correction, the runbook. |
| Blast radius | **High.** `scanPlanProtectedTargets` gates `engineer land` in every consumer repository. A false positive blocks every spec land; a false negative restores the deadlock. |
| Contract surface | Amends an **APPROVED** ADR (`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`, §3) and the normative prohibition in the shipped `skills/plan`. |

## Rationale

The signals alone read Small — one pure function, one CLI string, one skill section, one ADR note,
one runbook, no schema, no integration, no state. Two factors hold it at **M**:

1. **It amends an APPROVED ADR.** Correcting §3's sealed-directory list from four to five is a
   normative change to a governing decision. Landing that without an architecture review would
   mean editing the corpus's own design law unreviewed.
2. **Blast radius is repository-wide and consumer-wide.** The scanner is the single gate standing
   between a violating plan and every daemon build, in every repo that installs the harness. A
   regression is not contained to this feature.

Not **L**: no new subsystem, no schema, no auth, no integration, no state machine, and the design
question is already settled by the governing ADR — this feature implements the enforcement that
ADR's §4 already ordered rather than deciding anything new.

**M** therefore carries: architecture diagram, a lightweight architecture review, conflict-check,
and a coherence mapping.
