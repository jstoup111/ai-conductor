# Complexity: Stage intake outcomes when the Desired-outcome heading is plural

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to the heading recognition inside one pure extractor function in a single engine module, plus its existing unit test file. It adds no module, no seam, no configuration key, no telemetry channel, and no new gate; the section-terminating scan, the bullet filter, the written heading constant, the staged-file reader, and every downstream consumer stay as they are. Claim-body resolution and the coherence refusal wording are excluded and owned elsewhere. Small-tier architecture, conflict-check, and coherence artifacts are not required.
