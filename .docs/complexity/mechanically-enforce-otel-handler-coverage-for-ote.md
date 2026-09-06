# Complexity: Mechanically enforce OTel handler coverage for traced events

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

Two production files change: the sink registry gains a derived type alias and no new runtime behavior, and the OTel visualizer's private dispatch becomes a compile-checked table with a fail-loud fallback. Every span, metric, attribute and exporter behavior is preserved as-is; the sixteen currently traced types keep the exact effects their switch cases had. No event variant is added, no sink declaration changes, no configuration key or CLI flag is introduced, and no new telemetry channel, ledger, or artifact appears. The two supporting test files already exist and already carry the `@ts-expect-error` and module-mock patterns this work reuses. Small-tier architecture, conflict-check, and coherence artifacts are not required, and no ADR is created or amended.
