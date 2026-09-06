# Intake origin: compose-sealed-content-and-engine-remediation-appe

Source-Ref: jstoup111/ai-conductor#2120
Owner: jstoup111

## Desired outcome
- An engine-authored remediation append to a plan does not halt the feature, whether or not an
  operator amended and resealed that same plan earlier in the run.
- A genuinely feature-authored edit to a DECIDE artifact still halts exactly as it does today,
  including an edit that arrives in the same commit as a legitimate append.
- When a protected-artifact halt does fire, its message distinguishes "a human edited this" from
  "an engine append could not be vouched for", so an operator is not told to revert content the
  engine itself wrote.
- Whatever the resolution, an operator can tell from the halt which of the two authorship exits was
  consulted and why it refused.
