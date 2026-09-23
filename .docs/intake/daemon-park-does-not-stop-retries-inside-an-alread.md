# Intake origin: daemon-park-does-not-stop-retries-inside-an-alread

Source-Ref: jstoup111/ai-conductor#2103
Owner: jstoup111

## Desired outcome

- A parked feature stops launching new provider attempts, including retries inside a step that was
- The operator can tell from the park command's own output whether the feature actually stopped or
- Stopping an in-flight parked feature does not require stopping the daemon, so unrelated queued
- Whatever the in-flight behaviour ends up being, it is documented where an operator looks during an
- An already-running provider that a park cannot interrupt is at least reported as still running,
