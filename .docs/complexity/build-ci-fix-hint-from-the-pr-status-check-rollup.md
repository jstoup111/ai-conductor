# Complexity: Build the ci-fix hint from the PR status check rollup

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one exported function in the CI-fix engine module, its unit test block, and the single daemon call site that supplies the logger. It reuses the existing gh runner seam, the existing error classifier, and the existing outcome log line; it adds no configuration key, no persisted state, no event union member, and no telemetry channel. It touches neither the eligibility gates nor the non-terminal classification helper in the same module, and it changes no type in the merge-state module. Two production files and one test file change. Small-tier architecture, conflict, and coherence artifacts are not required.
