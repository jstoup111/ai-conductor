# Complexity: Render every declared render event in inline runs

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

Two production files change: the terminal subscriber's subscription and forwarding predicate, and the inline dashboard renderer's switch. Both already exist, both already import from the modules the change reaches for, and the accessor that removes the drift (`renderedEventTypes()`) is already exported and already used by the daemon path. No event union member, sink declaration, config key, CLI flag, hook, or schema changes, so no migration block is owed. The change adds no service, storage, telemetry channel, or external dependency. Coverage is proven by unit tests against the existing injected live-region and recording-renderer seams; no conductor run is required. Small-tier architecture, conflict-check, and coherence artifacts are not required.
