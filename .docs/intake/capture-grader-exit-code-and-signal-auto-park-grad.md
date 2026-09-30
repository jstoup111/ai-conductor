# Intake origin: capture-grader-exit-code-and-signal-auto-park-grad

Source-Ref: jstoup111/ai-conductor#823
Owner: jstoup111

## Desired outcome

- When a grader subprocess dies without a classifiable result, the daemon **captures and logs its
- A grader-**dispatch** infrastructure failure that exhausts its bounded retries **parks the
- A transient grader failure never leaves a complete build stranded behind a manual recovery
- (Negative) A genuinely persistent grader failure (binary missing, auth truly dead) still
