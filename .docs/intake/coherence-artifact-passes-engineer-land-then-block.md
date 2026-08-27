# Intake origin: coherence-artifact-passes-engineer-land-then-block

Source-Ref: jstoup111/ai-conductor#1881
Owner: jstoup111

## Desired outcome

- A coherence artifact accepted by `engineer land` is always one the daemon can parse — no artifact can merge and then be rejected as missing or unparseable at dispatch.
- The defect is caught while it is still cheap to fix — on the feature branch, before the spec merges — rather than after it reaches the default branch.
- When a coherence artifact is genuinely rejected as unparseable, the rejection names the specific structural defect (which line, and what disagrees with what), so the remedy does not require reading the parser.
- A genuinely absent, empty, or table-less coherence artifact is still blocked at dispatch for non-S tiers; the fix does not widen acceptance.
- The documented ragged shape — five-cell legacy rows beside six-cell `criterion` rows under one header — continues to land and dispatch.
