# Intake origin: daemon-cannot-switch-to-higher-priority-queued-wor

Source-Ref: jstoup111/ai-conductor#1929
Owner: jstoup111

## Desired outcome

- When work of a strictly higher priority band than the running feature enters the backlog, the running feature stops at its next step/group boundary and the higher-priority feature dispatches.
- The preempted feature resumes automatically from where it stopped once it is again the head of the backlog — no operator unpark required.
- A feature preempted this way is distinguishable in logs/status from an operator park.
- Equal-or-lower-priority arrivals never interrupt a running feature.
