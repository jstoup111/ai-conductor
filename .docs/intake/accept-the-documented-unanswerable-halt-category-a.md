# Intake origin: accept-the-documented-unanswerable-halt-category-a

Source-Ref: jstoup111/ai-conductor#1076
Owner: jstoup111

## Desired outcome
- A halt disposition whose category the skill contract documents is never silently discarded —
  the contract the agent is told to follow and the contract the engine enforces agree.
- When the engine does reject a disposition, the operator-visible halt names the value that was
  rejected and why, rather than reporting the whole plan as missing or invalid.
- Negative path: a genuinely malformed or absent `remediation.json` still reports as malformed —
  this must not become a catch-all that hides real parse failures.
- Negative path: a halt gap with no category at all is still rejected.
