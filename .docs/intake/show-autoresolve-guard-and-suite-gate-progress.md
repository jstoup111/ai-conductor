# Intake origin: show-autoresolve-guard-and-suite-gate-progress

Source-Ref: jstoup111/ai-conductor#2762
Owner: jstoup111

## Desired outcome
- While an autoresolve's suite gate is running, the daemon log and the event spine show that the suite has started, for which PR, in which worktree.
- When the suite gate passes, a line or event records the pass and its duration before the push happens.
- A passing acceptance-guard stage is likewise visible, so each stage between `tier2 outcome` and the push leaves a trace.
- Failure logging and escalation behave as today.
