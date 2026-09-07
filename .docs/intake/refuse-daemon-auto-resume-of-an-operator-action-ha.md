# Intake origin: refuse-daemon-auto-resume-of-an-operator-action-ha

Source-Ref: jstoup111/ai-conductor#1713
Owner: jstoup111

## Desired outcome

- A halt whose class is needs-human is never resumed by the daemon; only an explicit operator action (halt-clear, grant, park/unpark) makes the feature dispatchable again.
- If a resume decision must read the halt class, it reads it atomically with the halt (no window where HALT exists but its class is unreadable/unwritten defaults to resumable).
- When the daemon declines to resume a halted feature, the log says which class blocked it, so the operator can distinguish "waiting on human" from "stuck."
