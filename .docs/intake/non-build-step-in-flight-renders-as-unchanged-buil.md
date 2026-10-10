# Intake origin: non-build-step-in-flight-renders-as-unchanged-buil

Source-Ref: jstoup111/ai-conductor#2806
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2806 digest=44d539d9060d108a514116fe9004c930e8825909ce55624b018c9bded9973650 >>>
## Desired outcome

- While a non-build step is executing, the daemon line and `daemon status` name that step and show it is still running.
- A step running as a member of a multi-member verification group is identified by its own name, not only by the group's first member.
- Build-progress lines stop claiming the current position once `build` has closed (negative path: a real `build` step still shows its task progress as today).
<<< END INBOUND >>>
