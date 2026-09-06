# Complexity: Report untracked overlap-scan candidate paths instead of a false clean verdict

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one engine module and one argv parser: a new candidate-path classification helper in the overlap-scan module, a few lines wiring its result into the existing advisory-note list that `runOverlapScan` already assembles, and a greedier `--files` capture in the existing `detectOverlapScanCommand`. It reuses the report shape, the existing note channel, the existing clean-line suppression rule, the injected `GitRunner` seam, and the advisory always-exit-0 contract. It introduces no new report field, no new command, no new option, no schema, no storage, and no telemetry channel, so the event-spine decision procedure returns "no new channel". Rename and name-only-diff detection, the intersection rule, and branch enumeration are excluded. Small-tier architecture, conflict-check, and coherence artifacts are not required.
