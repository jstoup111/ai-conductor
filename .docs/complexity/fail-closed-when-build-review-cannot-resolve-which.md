# Complexity: Fail closed when build_review cannot resolve which plan

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to two production files: one additive exported helper in the artifacts module that reports why feature-plan selection failed, and the branch in the build_review step runner that consumes it. The existing path-returning resolver becomes a thin delegation so its other call sites are untouched. It reuses the existing typed step refusal, the existing halt-marker seam, and the existing verdict publisher. It introduces no CLI flag, no configuration key, no schema change, no hook wiring change, no skill symlink change, no new event or telemetry channel, and no new halt class. It amends no approved architecture decision and deletes no directory. Small-tier architecture, conflict-check, and coherence artifacts are not required.
