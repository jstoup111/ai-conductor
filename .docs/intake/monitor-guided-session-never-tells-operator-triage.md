# Intake origin: monitor-guided-session-never-tells-operator-triage

Source-Ref: jstoup111/ai-conductor#2986
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2986 digest=523274ab1fd4f50e27064ae9715a2c9b657febbebd4743efa4ea0bab7adfff31 >>>
## Desired outcome

- When triage in a monitor-launched session reaches its end (diagnosis reported, and every approved action finished or declined), the operator sees an explicit message that the session is complete and that quitting returns them to the monitor queue.
- The message names how to quit for the active provider.
- The message does not appear while recovery actions are still pending or awaiting approval.
- Triage sessions started outside the monitor do not show monitor-queue wording.
<<< END INBOUND >>>
