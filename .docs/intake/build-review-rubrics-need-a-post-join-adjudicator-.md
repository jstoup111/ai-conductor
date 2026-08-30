# Intake origin: build-review-rubrics-need-a-post-join-adjudicator-

Source-Ref: jstoup111/ai-conductor#2033
Owner: jstoup111

## Desired outcome

- With multiple rubrics enabled, each lap yields exactly one prioritized, deduplicated action list; the build never receives two findings prescribing contradictory changes to the same code.
- A finding equivalent in substance to one already dispositioned in a prior lap is recognized as such and not re-raised as new (no budget consumed, no re-litigation).
- Every raw rubric finding remains traceable to its adjudicated outcome (acted on, deferred, rejected-with-reason, or merged into another), observable in the lap's persisted artifacts.
- A finding judged real but out of scope for this build is deferred into a filed intake issue rather than silently dropped.
- Only findings adjudicated as actionable consume the build_review kickback budget.
- Adjudication failures fail closed: a lap whose adjudication cannot complete never publishes a PASS.
