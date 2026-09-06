# Complexity: Report a failing integrity check instead of aborting the suite silently

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one existing shell gate and one new focused fixture spec beside it. The production edit is uniform and mechanical: a marked reporting region carved out of text already at the top and bottom of the file, one status-capture line added at each of 17 existing call sites, and a four-line abort trap. No check is added, removed, reordered, or given a different subject; no engine, skill, agent, template, or configuration surface is touched. There is no third-party boundary anywhere in the slice — no network, LLM, registry, or `gh` call — so no adapter or fake is required. It changes no consumer-visible CLI, hook wiring, settings schema, or skill symlink target, so no migration block is owed. Small-tier architecture, conflict-check, and coherence artifacts are not required.
