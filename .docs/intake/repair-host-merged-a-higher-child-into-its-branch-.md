# Intake origin: repair-host-merged-a-higher-child-into-its-branch-

Source-Ref: jstoup111/ai-conductor#3676
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3676 digest=b1df944e5d947c2eace810f0ae18a348078ca903d6f6b5733597971100d3e8a3 >>>
## Desired outcome

- A repair host's branch never gains commits reachable from a higher child's branch, whether by merge, cherry-pick of a range or reset. Any attempt is refused at commit time with a clear message.
- A task whose prerequisite code exists only in a higher child is never routed to a lower host, or it has a working "move up" path the builder can use.
- If a host's tree ever contains a higher child's commits, its gates refuse to pass, and the halt names the cause.
- Negative path: normal host repair commits and restack replays are unaffected.
<<< END INBOUND >>>
