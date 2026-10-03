# Intake origin: daemon-records-that-a-build-is-not-advancing-head-

Source-Ref: jstoup111/ai-conductor#2102
Owner: jstoup111

## Desired outcome

- A build that has not advanced HEAD for a bounded period, while its provider is still active, is surfaced without an operator inspecting `events.jsonl` or the process table.
- The surfaced signal distinguishes three states that currently look alike: provider quiet (existing stall path), provider active and committing, provider active and not committing.
- The daemon takes a bounded, configurable action when the third state persists — at minimum recording it as a classified condition an operator can find; ideally ending the attempt rather than letting it run unbounded.
- A legitimately long step that is doing real work is not killed: whatever bound is chosen is expressed in terms an operator can set per project, and a step that resumes committing clears the condition on its own.
- Whatever the daemon decides is visible in the same place as the rest of the run — no new channel, no second log to consult.
