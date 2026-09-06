# Complexity: Scan overlap against each branch's own merge-base diff

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one new merge-base-relative changed-path helper beside the existing two-endpoint one, the single per-branch comparison call inside the scan loop, and the advisory note the loop already knows how to emit. It reuses the existing branch enumerator, path intersection, blocker sweep, report renderer, command dispatch, and injected git runner unchanged. It introduces no new module boundary, command flag, configuration key, persisted state, record schema, or telemetry channel, and it changes no other caller of the existing helper. Small-tier architecture, conflict, and coherence artifacts are not required.
