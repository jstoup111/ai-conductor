# Complexity: Recoverable gate verdicts

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one sink declaration, one missing emission site on the existing validation-group join, and the two render branches that already handle this event type. It adds no event variant, no field, no ledger, no configuration key, and no new module. Persistence and rendering both reuse machinery that already exists and is already exercised by tests; the only new test surface is one focused integration file over the group join. Renaming the audit gate and rewording a gate report's summary line are excluded, as is any change to the audit trail or the OpenTelemetry projection. Small-tier architecture, conflict, and coherence artifacts are not required.
