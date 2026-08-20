# Intake origin: plan-tasks-can-declare-a-protected-artifact-outcom

Source-Ref: jstoup111/ai-conductor#1736
Owner: jstoup111

## Desired outcome

- A completeness `missing-outcome` finding whose outcome is satisfied in a sealed/protected artifact
  passes without operator intervention when the artifact was resealed by the operator and the outcome
  is present in the branch's HEAD tree.
- The same holds when remediation has emitted `remediation_sealed_artifact_redirect` for that
  artifact and the outcome is present at HEAD.
- A genuinely missing outcome still FAILs completeness - a reseal of an unrelated artifact, or a
  reseal whose artifact does not contain the outcome, does not suppress the finding.
- A rerun after an operator reseal judges fresh evidence: the lap's `snapshotDigest` differs from the
  pre-reseal lap's, instead of consecutive laps sharing one digest via `provenance.kind: "cache-hit"`.
- A build kickback whose remediation disposition concludes no build change is required does not
  decrement the build-kickback budget.
- When completeness declines a finding on sealed-artifact grounds, the reason and the matching
  artifact are recorded, so the decision is auditable rather than silent.
