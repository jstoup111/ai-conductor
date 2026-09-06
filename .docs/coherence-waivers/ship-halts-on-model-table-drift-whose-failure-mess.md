# Coherence Waivers: ship-halts-on-model-table-drift-whose-failure-mess

Waives: outcome-2

Rationale: Intake outcome 2 ("alternatively/complementarily: the build phase runs
`bin/generate-model-table` whenever `model-table-metadata.ts` changes, so drift never reaches
the ship gate") is the issue's own stated alternative to outcome 1. The operator selected the
general mechanical-remediation lane (track scope boundary, 2026-09-06), which delivers outcome 1
and explicitly excludes edit-time or build-time prevention of drift. Prevention remains available
as a follow-up feature and is not silently dropped: the scope boundary and
`.memory/decisions/2026-09-06-release-gate-mechanical-remediation.md` both record it as out of
this spec.
