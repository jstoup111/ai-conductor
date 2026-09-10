# Complexity: Engine-appended remediation tasks carry a valid Done-when block

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to the two existing engine append writers, one shared criterion renderer between them, and the existing land-time refusal message. It introduces no new module boundary, no new gate, no new configuration key, no schema change, no event, and no telemetry channel. It reuses the existing task-block grammar, the existing `Done when:` parser, and the existing validator without changing the 2-5 bound. Remediation routing, dispositions, budgets, and the per-task evidence rule at task close are excluded. Small-tier architecture, conflict, and coherence artifacts are not required, and no ADR is created or amended.
