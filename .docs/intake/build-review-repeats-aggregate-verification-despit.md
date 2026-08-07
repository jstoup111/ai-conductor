# Intake origin: build-review-repeats-aggregate-verification-despit

Source-Ref: jstoup111/ai-conductor#1173
Owner: jstoup111

## Desired outcome

- A scoped BUILD or review command cannot silently expand into the aggregate suite.
- For an unchanged code state, one current authoritative aggregate-suite result is reused rather than recomputed by multiple steps.
- Missing, stale, or failed aggregate evidence still causes the authoritative suite to run and block progression on failure.
- Semantic review receives a bounded structured summary of verification results, with raw logs retained outside the prompt for drill-down.
- Review output size and duration fall materially from the measured baseline without reducing calibrated defect-detection performance.
- Any model-tier or reasoning-effort reduction is evaluated against the current reviewer in shadow before it changes a blocking verdict.
