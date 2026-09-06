# Complexity: Exclude patch-equivalent upstream commits from the graded build_review diff

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated). The issue already carries `size: S`.

The change adds one deterministic Git-only helper beside the two pathspec exclusions the graded-diff assembly already builds, appends its result to the same `git diff` argv, and threads a small advisory provenance record along the base-telemetry path that already exists end to end. Every derived rubric input is computed from that single diff string, so no rubric, projection, cache, digest, or artifact schema changes.

Five production files are touched, but only one carries real logic: the grader-input assembly. The other four are additive one-to-five-line edits — two optional fields on an existing event variant, the same two fields on the step-result carrier, four lines in the emit call, and one clause in the daemon log renderer. No new event variant, no event-sink classification, no configuration key, no CLI surface, no hook wiring, no schema, and no skill-symlink target changes, so no migration block and no waiver are required.

It introduces no service, storage, or telemetry channel, needs no ADR (the event-spine skill's prescribed extension is additive optional fields on an existing variant), and deletes no directory. Small-tier architecture, conflict-check, and coherence artifacts are not required.
