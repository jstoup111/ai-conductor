# Intake origin: stack-preflight-refusals-end-the-run-with-no-halt-

Source-Ref: jstoup111/ai-conductor#3446
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3446 digest=7d78819ca373bff394bda88cdbbf0c6dfe8aa801bdeadd33bdfa8eedae09d1b5 >>>
## Desired outcome

- Every preflight result that stops a run leaves a HALT whose first line states the specific reason (for example `round advance cas-failed`, `live HALT without resume authorization`, or the routed-exit detail).
- The same reason appears on the event spine, so `events.jsonl` explains the stop.
- `loop ended without DONE or HALT marker` no longer occurs after a stack preflight refusal.
<<< END INBOUND >>>
