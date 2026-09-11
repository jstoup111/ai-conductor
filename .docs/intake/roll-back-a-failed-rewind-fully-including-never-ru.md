# Intake origin: roll-back-a-failed-rewind-fully-including-never-ru

Source-Ref: jstoup111/ai-conductor#2181
Owner: jstoup111

## Desired outcome
- A failed rewind rolls back fully even when the rewind demoted never-run steps: their fields return to absent, gate/HALT state is restored or the failure happens before any destructive clear.
- The operator sees the original failure, not a rollback TypeError.
