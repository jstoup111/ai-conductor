# Track: technical

Source: jstoup111/ai-conductor#546

## Why technical

This is a pure observability/diagnostics change inside the conductor engine and
its renderers. There are no user-facing product requirements, no new
capabilities, and no external contract change — the fix surfaces information the
engine already computes (the completion-check reason and the resolved-task
progress delta) onto the daemon's `↻ <step> retry` log line so `tail`-level
triage can tell a healthy pacing retry from a wedged one.

The `step_retry` event already carries `reason` and both emit sites already have
the progress-delta variables in scope; the work is threading two existing values
into an event payload and three render lines. No product decision, no PRD, no
new user story surface beyond the log-line behavior itself. Technical track.
