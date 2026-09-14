# Intake origin: file-changing-rebase-rewinds-past-test-suite-and-r

Source-Ref: jstoup111/ai-conductor#2253
Owner: jstoup111

## Desired outcome

- After a successful rebase, the loop resumes no earlier than `test_suite`.
- A rebase followed by a passing `test_suite` continues into the SHIP tail without re-running `acceptance_specs`, `build`, `prd_audit`, or `architecture_review_as_built`, when the feature's own diff is byte-identical across the rebase.
- A rebase followed by a failing `test_suite` routes back to `build`, and the loop proceeds forward from there through the ordinary gates.
- A rebase that changes the feature's own diff (a conflict resolution edited feature-owned files) still re-verifies the judged gates the classifier names.
- No step outside the classifier's table is re-run purely because it sits between the rewind target and the current step.
