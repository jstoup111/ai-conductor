# Complexity: Bound the build_review counterfactual scoped run to its deadline

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one extracted launch-and-terminate helper, its unit coverage, and a three-line delegation from the existing private counterfactual runner plus one optional launcher injection point on the existing step-runner options object. It reuses the existing AbortController, the existing `TautologyScopedRunResult` union, and the existing infrastructure-failure reason mapping. It introduces no new event, metric, span, report, configuration key, CLI flag, gate, or persisted artifact, and it changes no schema, hook wiring, or skill symlink target. Two production files and two test files are in reach. Small-tier architecture, conflict-check, and coherence artifacts are not required.
