# Complexity: Daemon runs export branch and engine version as unknown

Tier: S

Rationale: This is a bounded repair to the existing shared OTel wiring seam: require two identity inputs, pass the daemon's already-available worktree branch and existing engine-version result, preserve explicit unresolved state, and add focused parity/negative-path coverage plus the canonical telemetry documentation update. It introduces no new event, dependency, configuration, state machine, or integration and matches issue #1999's `size: S` classification.
