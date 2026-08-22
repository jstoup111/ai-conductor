# Complexity: a-gate-halt-marks-a-completed-build-failed-and-the

Tier: M

Rationale: single engine module cluster (conductor dispatch loop, gates, halt marker, resume entry) with a `StepRunResult` type change; no new integrations, auth, or models; three refusal sites plus resume and halt wording — roughly 6–8 stories. Not S because the dispatch/outcome seam is the hottest path in the engine and needs architecture review; not L because there is no cross-service or schema surface.
