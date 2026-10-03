# Intake origin: daemon-redispatch-loses-committed-task-progress-af

Source-Ref: jstoup111/ai-conductor#2673
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2673 digest=6690a72f13ef103a225e1363cc7bfeae2e26e79e2353bf997ca50c3c20f9be25 >>>
## Desired outcome

- After daemon death, a task with a reachable `Task: <id>` commit trailer is represented as completed even when only that task-status row is missing from an otherwise usable ledger.
- After daemon death, a task that was in progress without a completed commit is eligible for redispatch as pending.
- Existing completed rows, `.pipeline/events.jsonl`, and completed DECIDE-state remain unchanged during recovery.
- A feature with no HALT marker remains dispatchable on the next daemon poll without operator action.
<<< END INBOUND >>>
