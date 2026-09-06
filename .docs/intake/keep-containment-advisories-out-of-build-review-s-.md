# Intake origin: keep-containment-advisories-out-of-build-review-s-

Source-Ref: jstoup111/ai-conductor#1651
Owner: jstoup111

## Desired outcome
- An advisory-classified condition never consumes step retry budget: it is recorded once per lap and the step proceeds.
- Advisory log lines render as warnings, not ✗ step failures.
- A genuinely enforcing containment violation (if that mode ever ships) still fails as a failure.
