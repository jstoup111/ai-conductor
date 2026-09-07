# Complexity: Batch git blob reads in backlog discovery and protected-artifact seal

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one focused helper module and rewires two existing read sites to it — the production backlog tree source and the two commit-side protected-artifact readers. Three production files in total. It introduces no new interface: `BacklogTreeSource` keeps its exact four-method contract, the seal record schema is untouched, and every existing refusal, warning, and fingerprint stays byte-identical. It adds no CLI flag, no configuration key, no hook wiring, no skill symlink target, and no settings schema change, so no migration block is owed. It adds no event, metric, span, log line, or report, so it opens no new telemetry channel. It needs no new architecture decision record and amends none: the committed-tree-only read contract and the fail-closed seal semantics both survive unchanged. Small-tier architecture, conflict, and coherence artifacts are not required.
