# Complexity: Compose sealed content and engine remediation appends in seal rotation

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one engine module's rotation evaluator, the in-repository resolver that feeds it, and one additive refusal condition on an existing event variant. It reuses the existing commit-blob reader, the existing recorded-appended-id reader, the existing fingerprint helper, and the existing refusal-emission path. It introduces no new file, service, seal schema field, ledger, telemetry channel, or command. The reseal command, its terminal gate, the append renderer, and halt retention are excluded. Small-tier architecture, conflict-check, and coherence artifacts are not required.
