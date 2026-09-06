# Complexity: Classify Claude weekly-limit messages as rate limits

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change edits one classification pattern in one production file and adds regression coverage in two existing test files. It introduces no module, no seam, no configuration key, no event, metric, span, or report, and no schema. Every downstream consumer of the classification — the wait derivation, the deadline, the episode coordinator, and the retry policy — is reached through fields that already exist and are left untouched. The recognized-vocabulary widening is a bounded edit inside anchors that already exist, so there is no new failure surface to design around. Small-tier architecture, conflict-check, and coherence artifacts are not required.
