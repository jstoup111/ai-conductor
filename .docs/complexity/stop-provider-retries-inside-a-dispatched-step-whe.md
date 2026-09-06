# Complexity: Stop provider retries inside a dispatched step when a park lands

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one call to an existing run-scoped helper at the top of an existing retry loop, and
one reporting block to an existing CLI verb that reads an existing telemetry file through its
existing reader. Two production files change. It introduces no new event, marker, class, config key,
flag, schema, or module; it changes no selection rule, no marker format, and no provider adapter. No
ADR is created or amended, no directory is deleted, and no migration surface is touched. Small-tier
architecture, conflict-check, and coherence artifacts are not required.
