# Intake origin: manual-test-gate-commits-product-code-invalidating

Source-Ref: jstoup111/ai-conductor#3685
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3685 digest=f510a0886ce6626cbb93fb90dc8cdfd7dce62cc56254e334459010374e63d74e >>>
## Desired outcome

- A validation gate (manual_test, prd_audit, architecture_review_as_built) never changes product code. A defect it finds is reported as a finding and fixed through the normal build → test_suite → build_review path.
- If code does change while gates run in parallel, the stale gates rerun automatically. There's no needs-human halt.
- Negative path: gate evidence artifacts that the harness owns under `.pipeline/` are still written.
<<< END INBOUND >>>
