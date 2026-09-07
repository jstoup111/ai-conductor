# Intake origin: fail-closed-when-build-review-cannot-resolve-which

Source-Ref: jstoup111/ai-conductor#2179
Owner: jstoup111

## Desired outcome
- Plan-resolution ambiguity (cannot determine which plan) produces a halt/failure naming the ambiguity, never a PASS verdict.
- A genuinely empty review scope still passes as today.
