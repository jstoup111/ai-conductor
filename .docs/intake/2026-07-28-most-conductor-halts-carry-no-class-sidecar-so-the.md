# Intake origin: 2026-07-28-most-conductor-halts-carry-no-class-sidecar-so-the

Source-Ref: jstoup111/ai-conductor#1077
Owner: jstoup111

## Desired outcome

- Every halt the engine writes carries a class; no engine path produces a halt marker without classification.
- A halt requiring operator judgment is never cleared automatically, regardless of which code path wrote it.
- A genuinely mechanical halt remains automatically recoverable.
- Recorded halt state exposes the class accurately without requiring source-code inspection.
