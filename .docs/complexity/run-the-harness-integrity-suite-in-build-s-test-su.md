# Complexity: Harness integrity verification runs in BUILD, not SHIP

Tier: S

Operator scope: small, re-confirmed 2026-09-06.

The change is a deletion plus a configuration declaration. It removes one sub-gate and three options fields from a single engine module, updates that module's unit test and one acceptance fixture that stubbed the removed seam, corrects two stale comments in the gate's callers, and adds two ordered verification entries to this repository's own project configuration. It introduces no service, no schema, no storage, and no telemetry channel, and it changes no consumer-visible surface: the release gate's exported classifier, waiver parser, and migration evaluator keep their signatures.

The engine work that makes an ordered list of test-suite commands expressible is deliberately excluded and is owned by issue #2358, which this feature is blocked by. Without that dependency this slice would be Medium; with it, the configuration side is a declaration.

Small-tier architecture, conflict-check, and coherence artifacts are not required. The amendment to the governing halt-based release-gates decision record travels with this specification and is carried in the plan's architecture obligation coverage.
