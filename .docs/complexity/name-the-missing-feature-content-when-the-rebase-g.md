# Complexity: Name the missing feature content when the rebase guard rejects

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to the diagnostic surface of two existing, already-correct acceptance guards. It widens two internal return types from booleans to discriminated verdicts, threads the resulting evidence into the strings the two guard-rejection sites already build, and adds one optional resume-shape field so the existing halt-marker writer can template a second procedure. It reuses the existing content-based supersession check, the existing halt-marker writer and halt classification, the existing `RebaseOutcome` union, and the existing real-local-Git test harnesses. It introduces no new module, event, metric, config key, CLI flag, schema, storage, or telemetry channel, and no third-party boundary. The guard's accept/reject decision is deliberately unchanged: only the words it produces on rejection change. Small-tier architecture, conflict-check, and coherence artifacts are not required.
