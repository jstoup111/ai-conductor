# Intake origin: a-halted-feature-only-re-runs-when-a-human-clears-

Source-Ref: jstoup111/ai-conductor#2190
Owner: jstoup111

## Desired outcome

- A halt whose class is mechanical and retryable (provider 5xx, live-boundary trip, seal error, suite infrastructure timeout) re-dispatches on its own after a backoff, bounded by a configurable attempt count, and the daemon log records each automatic retry and its reason.
- A halt that reaches the attempt bound becomes a normal human halt naming how many retries were spent.
- An operator can grant a feature additional remediation laps with one command that records the grant and clears the halt together; no config edit and no commit on main.
- The grant is visible in daemon status and on the event spine, and the feature resumes through the workflow after the last completed step.
- Halt classes that are judgement or decision halts (needs-human, BLOCKED, PLAN_GAP, over-scope acceptance) are never auto-retried.
