# Complexity: Render kickback and BUILD re-entry counts in the run report

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

One production file changes: the report renderer gains a pure aggregation helper and one section function, composed into the existing section list. The data source, the parser, the event union, the emitter, the persister, and the CLI branch are all reused unchanged, so there is no schema, storage, telemetry-channel, or interface work. The remaining edits are the report's own test file, which already exercises every neighbouring section, and the three documentation pages that currently record the missing section as a known limitation. No new ADR is required and no approved ADR is amended: the report stays derived solely from the persisted ledger. Small-tier architecture, conflict-check, and coherence artifacts are not required.
