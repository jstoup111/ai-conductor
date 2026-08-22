# Intake origin: one-rubric-s-rejected-contract-discards-the-whole-

Source-Ref: jstoup111/ai-conductor#1740
Owner: jstoup111

## Desired outcome

- When one rubric's result is rejected on its contract, the rubrics that *did* return
  well-formed judgments on that lap still count toward the lap's recorded outcome — their
  verdicts are not discarded and replaced by a prior lap's.
- A kickback's stated reason always names findings judged on the lap that produced it; a
  build is never re-opened for findings that the current lap judged resolved.
- When a rubric's result is rejected, the concern it was reporting is preserved somewhere
  an operator or a downstream step can read as a first-class record — not only as a
  truncated excerpt inside a failure string in the daemon log.
- The stale-verdict condition is observable: if the recorded aggregate does not correspond
  to the lap just judged, that is surfaced rather than inferable only by comparing
  `lapId` fields by hand.
- Negative path: a rubric that is rejected still blocks the lap from passing — recovering
  the other rubrics' verdicts must not let a lap with an unjudged rubric reach PASS.
