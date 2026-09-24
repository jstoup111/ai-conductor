# Complexity: post-plan-decide-amendments-never-reconcile-with-t

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — extends `coverage_binding` obligation inputs with ADR decision and amendment-clause rows |
| External integrations | None |
| Auth / permission surface | None — operator reseal authority unchanged |
| State machines | Touches existing step-verdict invalidation and the #1831 reopened-task path; no new states |
| Story count | ~3 (obligation extraction, reseal-triggered re-judgement, contradicted-task reopen), each happy + negative |
| Files touched | Engine: coverage-binding inputs/runner, protected-artifact seal/reseal, reopen wiring; skill prose for the judge; ADR amendment |
| New runtime code | Yes — deterministic obligation extraction and verdict invalidation; judgement stays in the existing judge |

## Rationale

Engine change across three existing seams, reusing the `coverage_binding` judge, retry budget, and
event spine rather than adding a parallel check. It amends `adr-2026-08-31-coverage-binding-judge-step`
instead of introducing a new ADR. More than a single-module fix, but no new subsystem or
integration → **Medium**: lightweight architecture review, architecture diagram, conflict-check,
and coherence-check apply.
