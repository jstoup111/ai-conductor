# Intake origin: one-transient-failure-in-a-validation-group-member

Source-Ref: jstoup111/ai-conductor#1425
Owner: jstoup111

## Desired outcome

- A transient failure in one validation-group member does not discard the completed verdicts of its siblings.
- A validation-group member gets a retry allowance comparable to what the same step gets on the serial path, or the difference is a deliberate, documented decision rather than an unexplained asymmetry.
- A genuine, non-transient failure still halts the group rather than being retried indefinitely.
- An operator can tell from the normal observability surfaces which member failed and whether its siblings' verdicts were retained.
