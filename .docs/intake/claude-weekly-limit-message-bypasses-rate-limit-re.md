# Intake origin: claude-weekly-limit-message-bypasses-rate-limit-re

Source-Ref: jstoup111/ai-conductor#1006
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1006 digest=04165ed49e82cca5181433bf0276a3331b261a202d3593e18ce0fbc3013f49a1 >>>
## Desired outcome

- A step that fails solely because of a provider rate limit does not lose retry budget for it — the
- Hitting a rate limit does not terminate the feature; the run waits for the condition to clear (as
- Retries against a condition with a known future reset time are not issued immediately in a tight
- Negative path: an ordinary step failure still consumes budget and still halts on exhaustion; this
- Negative path: a rate-limit condition that never clears still terminates eventually rather than
- Observable: replaying the log excerpt above yields no `retries exhausted` halt attributable to the
<<< END INBOUND >>>
