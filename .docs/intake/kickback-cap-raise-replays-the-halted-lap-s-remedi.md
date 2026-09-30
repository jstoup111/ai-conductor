# Intake origin: kickback-cap-raise-replays-the-halted-lap-s-remedi

Source-Ref: jstoup111/ai-conductor#2753
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2753 digest=77ebefc97c3fe316d59e3258a146791b81d6fa67c021096b9c9266b5d3dd74a0 >>>
## Desired outcome

- After a consumed raise on a halt that fired before appending fix tasks, the next dispatch runs `build` on exactly the tasks remediate already produced for that lap. It does not re-run prd_audit/as-built review first.
- Those tasks appear as pending in the plan's task status before build starts, with the same ids and titles remediate wrote.
- A resume that also rebases still re-opens downstream gates, but they run after that build, not instead of it.
- A raise on a halt that has no persisted remediation keeps today's behavior.
<<< END INBOUND >>>
