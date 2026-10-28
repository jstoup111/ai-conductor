# Complexity: Per-feature artifact manifest and one artifact lookup (#3405, spec 1 of 3)

Tier: L

Stacked-Delivery: approved

Rationale:
- **Breadth.** About 140 engine sites build a feature artifact path themselves or through one of four partial resolvers. Roughly 100 of them read kinds the manifest covers and move behind the existing `resolveArtifactFiles` seam; shipped, halted and release-waiver readers stay as they are.
- **Identity.** Readers find artifacts today by plan stem, `feature_desc`, spec-branch slug or undated stem. For new specs land forces these to match, so each reader can find the manifest with the key it already has. Legacy resolution stays as it is.
- **New durable state.** A committed per-feature manifest with a closed kind set. Composer land is its only writer.
- **Discovery.** Daemon discovery reads manifests as well as today's folders. Drift checks are spec 2.
- **Consumer-facing contract.** Consumer repositories run this engine, so specs without a manifest must keep resolving exactly as today.
- **Architecture.** A new module and a new event on the spine. Several APPROVED ADRs on protected artifacts, shipped records and the daemon backlog are in play. That needs a full architecture review.
- **Size.** Expect 4 stories and 15 to 20 plan tasks in three slices, delivered as three stacked children (operator approved 2026-10-25).
