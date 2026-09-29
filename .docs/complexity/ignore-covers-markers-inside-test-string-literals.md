# Complexity: Ignore Covers markers inside test string literals

Tier: S

Operator scope: small, confirmed 2026-09-28 (option A).

The change is bounded to the comment collector in build-review-test-bindings.ts, one pure HALT-detail renderer in build-review-outcome.ts, and appending that rendering at the existing build_review infrastructure-halt branch in conductor.ts. It reuses the existing TypeScript parser dependency, the Covers grammar, the scope analyzer, and the aggregate's retained scope-incomplete faults. It introduces no service, schema, projection version, persisted format, or telemetry channel, and it amends no ADR. Small-tier architecture, conflict, and coherence artifacts are not required.
