# Intake origin: stop-refuting-blanket-environment-denial-claims-th

Source-Ref: jstoup111/ai-conductor#1298
Owner: jstoup111

## Desired outcome
- A refutation fires only when the engine's evidence contradicts the claim actually made, not a narrower claim that happens to share vocabulary.
- A deny-all or unconditional-failure claim about the fence is not refuted by the absence of an operation-specific fence rule, because that evidence cannot bear on it.
- Where the engine cannot decide, the claim is left alone — consistent with the documented asymmetry.
- The refutation message states which proposition was disproved and by what evidence, so a wrong refutation is visible in the log rather than indistinguishable from a right one.
- Regression coverage: a claim naming a specific fenced operation is still refuted (the #1106 behavior must not regress); a claim asserting blanket Bash denial is not refuted on operation-name evidence alone.
