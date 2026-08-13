# Complexity: Operator reseal visible to build_review's Scope rubric

Tier: M

## Rationale

Mechanically the change is small — one optional field on `BuildReviewInputs`, one reader
over the existing `.pipeline/protected-artifact-seal.json` rebaseline list, one rendered
prompt section, and tests. No new models, integrations, auth, or state machines. On raw
build signals alone this would score S.

It is graded **M** for two reasons that the S-tier step skipping would leave unchecked:

- **Concurrent work on the same surface.** Spec PR #1526
  (`repeated-build-review-semantic-failures-can-churn-`) is open and changes `build_review`
  kickback/convergence semantics; `#1517` (wiring judgement moved into `build_review`) and
  `#1452` (wiring_check kickbacks as scope evidence) landed on
  `build-review-prompt.ts` within the last few merges. A conflict-check over the Scope
  rubric's evidence channels is exactly the coordination this tier buys.
- **It changes a judgement gate's rubric semantics**, not just plumbing. Widening what
  Scope accepts as justification has blast radius across every feature the daemon grades,
  so the outcome→FR→story→task traceability of the coherence artifact is worth carrying.

Architecture review is warranted at the **lightweight** level appropriate to M: the design
question is confined to whether a third evidence channel is the right seam alongside the two
existing ones, not to any new component.
