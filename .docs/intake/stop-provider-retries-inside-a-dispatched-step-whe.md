# Intake origin: stop-provider-retries-inside-a-dispatched-step-whe

Source-Ref: jstoup111/ai-conductor#2103
Owner: jstoup111

## Desired outcome
- A parked feature stops launching new provider attempts, including retries inside a step that was
  already dispatched when the park landed.
- The operator can tell from the park command's own output whether the feature actually stopped or
  whether something is still running for it.
- Stopping an in-flight parked feature does not require stopping the daemon, so unrelated queued
  work keeps moving.
- Whatever the in-flight behaviour ends up being, it is documented where an operator looks during an
  emergency — the park/emergency-stop runbook — including what to do when a step is mid-dispatch.
- An already-running provider that a park cannot interrupt is at least reported as still running,
  rather than leaving the operator to discover it in the process table.
