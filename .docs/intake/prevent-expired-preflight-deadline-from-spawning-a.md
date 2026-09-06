# Intake origin: prevent-expired-preflight-deadline-from-spawning-a

Source-Ref: jstoup111/ai-conductor#2177
Owner: jstoup111

## Desired outcome
- An already-expired preflight deadline prevents the spawn entirely (or kills the child immediately on spawn).
- No counterfactual test run outlives its deadline.
